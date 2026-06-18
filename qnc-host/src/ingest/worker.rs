use std::collections::HashSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tracing::{info, warn};

use crate::project::db::ProjectPaths;

use super::thumb_process::generate_thumbs_from_proxy;

#[derive(Clone)]
struct ProxyThumbJob {
    project_id: String,
    clip_ids: Vec<String>,
}

#[derive(Clone)]
pub struct ThumbWorker {
    paths: ProjectPaths,
    pending: Arc<Mutex<Vec<ProxyThumbJob>>>,
    blocked: Arc<Mutex<HashSet<String>>>,
    in_flight: Arc<AtomicUsize>,
}

impl ThumbWorker {
    pub fn new(paths: ProjectPaths) -> Self {
        Self {
            paths,
            pending: Arc::new(Mutex::new(Vec::new())),
            blocked: Arc::new(Mutex::new(HashSet::new())),
            in_flight: Arc::new(AtomicUsize::new(0)),
        }
    }

    pub async fn wait_drained(&self, max_ms: u64) {
        let deadline = Instant::now() + Duration::from_millis(max_ms);
        while self.in_flight.load(Ordering::Acquire) > 0 {
            if Instant::now() >= deadline {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    pub fn block_project(&self, project_id: &str) {
        let pid = project_id.trim();
        if pid.is_empty() {
            return;
        }
        self.blocked
            .lock()
            .expect("thumb block")
            .insert(pid.to_string());
        let mut q = self.pending.lock().expect("proxy thumb queue");
        q.retain(|j| j.project_id != pid);
    }

    fn is_blocked(&self, project_id: &str) -> bool {
        self.blocked
            .lock()
            .expect("thumb block")
            .contains(project_id)
    }

    /// Proces 2: generiranje postera iz proxya (orchestrator nakon copy-card).
    pub fn enqueue_proxy_generate(&self, project_id: &str, clip_ids: &[String]) {
        let pid = project_id.trim();
        if pid.is_empty() || self.is_blocked(pid) {
            return;
        }
        let ids: Vec<String> = clip_ids
            .iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        self.pending
            .lock()
            .expect("proxy thumb queue")
            .push(ProxyThumbJob {
                project_id: pid.to_string(),
                clip_ids: ids,
            });
    }

    pub fn spawn(self: Arc<Self>) {
        tokio::spawn(async move {
            loop {
                let batch: Vec<ProxyThumbJob> = {
                    let mut q = self.pending.lock().expect("proxy thumb queue");
                    if q.is_empty() {
                        Vec::new()
                    } else {
                        q.drain(..).collect()
                    }
                };
                if batch.is_empty() {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    continue;
                }
                for job in batch {
                    if self.is_blocked(&job.project_id) {
                        continue;
                    }
                    let worker = self.clone();
                    let in_flight = worker.in_flight.clone();
                    let pid_log = job.project_id.clone();
                    let clip_ids = job.clip_ids.clone();
                    in_flight.fetch_add(1, Ordering::AcqRel);
                    let result = tokio::task::spawn_blocking(move || {
                        worker.process_proxy_generate(&job.project_id, &clip_ids)
                    })
                        .await;
                    in_flight.fetch_sub(1, Ordering::AcqRel);
                    match result {
                        Ok(Ok(count)) if count > 0 => {
                            info!("ingest proxy thumbs: project={} processed={}", pid_log, count);
                        }
                        Ok(Ok(_)) => {}
                        Ok(Err(e)) => warn!("ingest proxy thumbs: project={} err={}", pid_log, e),
                        Err(e) => warn!("ingest proxy thumbs: project={} task err={}", pid_log, e),
                    }
                }
            }
        });
    }

    fn process_proxy_generate(&self, project_id: &str, clip_ids: &[String]) -> Result<usize, String> {
        if self.is_blocked(project_id) {
            return Ok(0);
        }
        generate_thumbs_from_proxy(&self.paths, project_id, clip_ids)
    }
}
