use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rusqlite::params;
use serde_json::json;
use tracing::{info, warn};

use crate::media::{import_source_path, is_breaking_news, proxy_policy_copy};
use crate::project::db::{ensure_project_dirs, project_settings_snapshot, ProjectPaths};

use super::db::{json_string, open_ingest, parse_json, thumbnail_path};
use super::store::{reconcile_thumbnail_rows, row_import_error};

#[derive(Clone)]
pub struct ImportWorker {
    paths: ProjectPaths,
    pending: Arc<Mutex<HashSet<String>>>,
    blocked: Arc<Mutex<HashSet<String>>>,
    thumbs: Arc<super::worker::ThumbWorker>,
}

impl ImportWorker {
    pub fn new(paths: ProjectPaths, thumbs: Arc<super::worker::ThumbWorker>) -> Self {
        Self {
            paths,
            pending: Arc::new(Mutex::new(HashSet::new())),
            blocked: Arc::new(Mutex::new(HashSet::new())),
            thumbs,
        }
    }

    pub fn block_project(&self, project_id: &str) {
        let pid = project_id.trim();
        if pid.is_empty() {
            return;
        }
        self.blocked
            .lock()
            .expect("import block")
            .insert(pid.to_string());
        self.pending.lock().expect("import queue").remove(pid);
        self.thumbs.block_project(pid);
    }

    fn is_blocked(&self, project_id: &str) -> bool {
        self.blocked
            .lock()
            .expect("import block")
            .contains(project_id)
    }

    pub fn enqueue(&self, project_id: &str) {
        let pid = project_id.trim();
        if pid.is_empty() || self.is_blocked(pid) {
            return;
        }
        self.pending.lock().expect("import queue").insert(pid.to_string());
    }

    pub fn spawn(self: Arc<Self>) {
        tokio::spawn(async move {
            loop {
                let batch: Vec<String> = {
                    let mut set = self.pending.lock().expect("import queue");
                    set.drain().collect()
                };
                if batch.is_empty() {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    continue;
                }
                for project_id in batch {
                    let worker = self.clone();
                    let pid_log = project_id.clone();
                    let thumbs = self.thumbs.clone();
                    let result = tokio::task::spawn_blocking(move || worker.process_project(&project_id))
                        .await;
                    match result {
                        Ok(Ok(count)) if count > 0 => {
                            info!("ingest import: project={} processed={}", pid_log, count);
                            thumbs.enqueue_proxy_generate(&pid_log, &[]);
                        }
                        Ok(Ok(_)) => {}
                        Ok(Err(e)) => warn!("ingest import: project={} err={}", pid_log, e),
                        Err(e) => warn!("ingest import: project={} task err={}", pid_log, e),
                    }
                }
            }
        });
    }

    fn process_project(&self, project_id: &str) -> Result<usize, String> {
        if self.is_blocked(project_id) {
            return Ok(0);
        }
        ensure_project_dirs(&self.paths, project_id).map_err(|e| e.to_string())?;
        let conn = open_ingest(&self.paths, project_id).map_err(|e| e.to_string())?;
        reconcile_thumbnail_rows(&self.paths, project_id, &conn).map_err(|e| e.to_string())?;

        let project = project_settings_snapshot(&self.paths, project_id).unwrap_or_else(|_| json!({}));
        let breaking = is_breaking_news(&project);
        let copy_proxy = proxy_policy_copy(&project);

        let mut stmt = conn
            .prepare(
                "SELECT source_id, clip_id, metadata_json, import_status
                 FROM ingest_assets
                 WHERE import_status IN ('queued', 'processing')
                 ORDER BY clip_id",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<(String, String, String, String)> = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;

        let proxy_dir = self.paths.project_dir(project_id).join("proxy");
        fs::create_dir_all(&proxy_dir).map_err(|e| e.to_string())?;

        let mut done = 0usize;
        for (source_id, clip_id, meta_raw, status) in rows {
            if self.is_blocked(project_id) {
                break;
            }
            if status == "processing" {
                continue;
            }
            conn.execute(
                "UPDATE ingest_assets SET import_status = 'processing' WHERE source_id = ?1 AND clip_id = ?2",
                params![source_id, clip_id],
            )
            .map_err(|e| e.to_string())?;

            let meta = parse_json(&meta_raw, json!({}));
            let result = if breaking {
                import_breaking_card(&meta, &project, copy_proxy, &proxy_dir, &clip_id)
            } else {
                let src = import_source_path(&meta, &project);
                match src {
                    Some(path) if path.is_file() => {
                        let dest = copy_into_proxy(&proxy_dir, &clip_id, &path)?;
                        Ok((dest, "ready".to_string(), false))
                    }
                    Some(path) => Err(format!("izvor ne postoji: {}", path.display())),
                    None => Err("metadata nema putanju medija".into()),
                }
            };

            match result {
                Ok((dest_or_link, asset_status, on_card)) => {
                    let mut new_meta = meta.clone();
                    if let Some(obj) = new_meta.as_object_mut() {
                        if on_card {
                            obj.insert("read_from_card".into(), json!(true));
                            obj.insert("card_locked".into(), json!(true));
                            if dest_or_link.is_file() {
                                obj.insert(
                                    "project_proxy_path".into(),
                                    json!(dest_or_link.to_string_lossy()),
                                );
                            }
                        } else {
                            obj.insert(
                                "project_proxy_path".into(),
                                json!(dest_or_link.to_string_lossy()),
                            );
                        }
                    }
                    let poster = thumbnail_path(&self.paths, project_id, &clip_id);
                    let thumb_st = if poster.is_file() { "ready" } else { "pending" };
                    let thumb_path = if poster.is_file() {
                        poster.to_string_lossy().to_string()
                    } else {
                        String::new()
                    };
                    let project_proxy_path = if dest_or_link.is_file() {
                        dest_or_link.to_string_lossy().to_string()
                    } else {
                        String::new()
                    };
                    conn.execute(
                        "UPDATE ingest_assets SET
                            import_status = 'imported',
                            status = ?4,
                            metadata_json = ?3,
                            thumb_status = ?5,
                            thumb_error = '',
                            project_proxy_path = ?6,
                            thumb_path = CASE WHEN ?7 = '' THEN thumb_path ELSE ?7 END
                         WHERE source_id = ?1 AND clip_id = ?2",
                        params![
                            source_id,
                            clip_id,
                            json_string(&new_meta),
                            asset_status,
                            thumb_st,
                            project_proxy_path,
                            thumb_path,
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                    done += 1;
                }
                Err(err) => {
                    row_import_error(&conn, &source_id, &clip_id, &err).map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(done)
    }
}

fn import_breaking_card(
    meta: &serde_json::Value,
    project: &serde_json::Value,
    copy_proxy: bool,
    proxy_dir: &Path,
    clip_id: &str,
) -> Result<(PathBuf, String, bool), String> {
    let proxy_on_card = meta
        .get("proxy_path")
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
        .filter(|p| p.is_file());
    let original_on_card = meta
        .get("original_path")
        .or_else(|| meta.get("source_path"))
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
        .filter(|p| p.is_file());

    if let Some(proxy) = proxy_on_card {
        if copy_proxy {
            let dest = copy_into_proxy(proxy_dir, clip_id, &proxy)?;
            Ok((dest, "ready".to_string(), false))
        } else {
            Ok((proxy, "on_card".to_string(), true))
        }
    } else if original_on_card.is_some() {
        // Ne kopiraj original — samo čitaj s kartice.
        let path = original_on_card.unwrap();
        Ok((path, "on_card".to_string(), true))
    } else {
        let _ = import_source_path(meta, project);
        Err("nema proxy ni originala na kartici".into())
    }
}

fn copy_into_proxy(proxy_dir: &Path, clip_id: &str, src: &Path) -> Result<PathBuf, String> {
    let safe = clip_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    let safe = if safe.is_empty() { "clip".into() } else { safe };
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("mp4");
    let dest = proxy_dir.join(format!("{}.{}", safe, ext));
    if src.canonicalize().map_err(|e| e.to_string())?
        == dest.canonicalize().unwrap_or(dest.clone())
    {
        return Ok(dest);
    }
    fs::copy(src, &dest).map_err(|e| format!("kopiranje: {e}"))?;
    Ok(dest)
}
