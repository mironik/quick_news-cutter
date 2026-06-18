use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tracing::{info, warn};

use crate::project::db::ProjectPaths;

use super::build::build_for_clip;

#[derive(Clone)]
struct FilmstripJob {
    project_id: String,
    clip_id: String,
    media_path: PathBuf,
}

#[derive(Clone)]
pub struct FilmstripWorker {
    paths: ProjectPaths,
    pending: Arc<Mutex<Vec<FilmstripJob>>>,
    blocked: Arc<Mutex<HashSet<String>>>,
    in_flight: Arc<AtomicUsize>,
}

impl FilmstripWorker {
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
            .expect("filmstrip block")
            .insert(pid.to_string());
        let mut q = self.pending.lock().expect("filmstrip queue");
        q.retain(|j| j.project_id != pid);
    }

    fn is_blocked(&self, project_id: &str) -> bool {
        self.blocked
            .lock()
            .expect("filmstrip block")
            .contains(project_id)
    }

    pub fn enqueue(&self, project_id: &str, clip_id: &str, media_path: &Path) {
        let pid = project_id.trim();
        let cid = clip_id.trim();
        if pid.is_empty() || cid.is_empty() || !media_path.is_file() {
            return;
        }
        if self.is_blocked(pid) {
            return;
        }
        self.pending
            .lock()
            .expect("filmstrip queue")
            .push(FilmstripJob {
                project_id: pid.to_string(),
                clip_id: cid.to_string(),
                media_path: media_path.to_path_buf(),
            });
    }

    pub fn spawn(self: Arc<Self>) {
        tokio::spawn(async move {
            loop {
                let job: Option<FilmstripJob> = {
                    let mut q = self.pending.lock().expect("filmstrip queue");
                    if q.is_empty() {
                        None
                    } else {
                        Some(q.remove(0))
                    }
                };
                if job.is_none() {
                    tokio::time::sleep(Duration::from_millis(400)).await;
                    continue;
                }
                let job = job.unwrap();
                if self.is_blocked(&job.project_id) {
                    continue;
                }
                let worker = self.clone();
                let in_flight = worker.in_flight.clone();
                let pid_log = job.project_id.clone();
                let cid_log = job.clip_id.clone();
                let pid = job.project_id;
                let cid = job.clip_id;
                let media = job.media_path;
                in_flight.fetch_add(1, Ordering::AcqRel);
                let result = tokio::task::spawn_blocking(move || {
                    build_for_clip(&worker.paths, &pid, &cid, &media, 10)
                })
                .await;
                in_flight.fetch_sub(1, Ordering::AcqRel);
                match result {
                    Ok(Ok(())) => info!("filmstrip: project={} clip={}", pid_log, cid_log),
                    Ok(Err(e)) => {
                        warn!("filmstrip: project={} clip={} err={}", pid_log, cid_log, e)
                    }
                    Err(e) => warn!(
                        "filmstrip: project={} clip={} task err={}",
                        pid_log, cid_log, e
                    ),
                }
            }
        });
    }
}
