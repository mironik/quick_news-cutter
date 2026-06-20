use serde_json::{json, Value};

use crate::filmstrip::{get_filmstrip, list_frames_for_clip, sync_filmstrip_from_disk};
use crate::project::db::{ensure_project_dirs, ProjectPaths};

use super::db::{open_db, pool_summary, sync_pool_from_ingest_db};
use super::ingest_db::read_imported_clips;
use super::transcripts::clip_has_transcript;

pub fn list_clips_enriched(paths: &ProjectPaths, project_id: &str) -> Result<Value, String> {
    ensure_project_dirs(paths, project_id).map_err(|e| e.to_string())?;
    sync_pool_from_ingest_db(paths, project_id)?;
    let conn = open_db(paths, project_id)?;
    let imported = read_imported_clips(paths, project_id)?;
    let mut clips: Vec<Value> = Vec::new();
    for row in imported {
        let clip_id = row
            .get("clip_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if clip_id.is_empty() {
            continue;
        }
        let proxy_path = row.get("proxy_path").and_then(|v| v.as_str());
        let thumb_path = row.get("thumb_path").and_then(|v| v.as_str());
        let source_path = row.get("source_path").and_then(|v| v.as_str());
        let original_path = row.get("original_path").and_then(|v| v.as_str());
        let card_thumb_path = row.get("card_thumb_path").and_then(|v| v.as_str());
        let transferred = true;
        let has_transcript = clip_has_transcript(&conn, &clip_id).unwrap_or(false);
        let transcript_status: String = conn
            .query_row(
                "SELECT status FROM clip_transcripts WHERE clip_id = ?1",
                rusqlite::params![clip_id],
                |r| r.get(0),
            )
            .unwrap_or_else(|_| "none".to_string());
        let duration = row
            .get("duration_sec")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let name = row
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(&clip_id)
            .to_string();
        let mut clip = json!({
            "clip_id": clip_id,
            "name": name,
            "discovered": true,
            "validated": transferred,
            "transferred": transferred,
            "has_transcript": has_transcript,
            "transcript_status": transcript_status,
            "proxy_path": proxy_path,
            "thumb_path": thumb_path,
            "source_path": source_path,
            "original_path": original_path,
            "card_thumb_path": card_thumb_path,
            "duration_sec": duration,
        });
        sync_filmstrip_from_disk(paths, project_id, &clip_id, duration).ok();
        if let Some(fs) = get_filmstrip(paths, project_id, &clip_id) {
            let st = fs
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("missing");
            if let Some(obj) = clip.as_object_mut() {
                obj.insert("filmstrip_status".into(), json!(st));
                if let Some(err) = fs
                    .get("error")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                {
                    obj.insert("filmstrip_error".into(), json!(err));
                }
                if st == "ready" {
                    if let Some(dur) = fs.get("duration_sec") {
                        obj.insert("timeline_duration_sec".into(), dur.clone());
                    }
                    let frames =
                        list_frames_for_clip(paths, project_id, &clip_id).unwrap_or_default();
                    if !frames.is_empty() {
                        let seeks: Vec<Value> = frames
                            .iter()
                            .map(|f| {
                                json!(f.get("seek_sec").and_then(|v| v.as_f64()).unwrap_or(0.0))
                            })
                            .collect();
                        obj.insert("timeline_seeks".into(), json!(seeks));
                        let filmstrip_frames: Vec<Value> = frames
                            .iter()
                            .map(|f| {
                                json!({
                                    "frame_index": f.get("index").and_then(|v| v.as_i64()).unwrap_or(0),
                                    "seek_sec": f.get("seek_sec").and_then(|v| v.as_f64()).unwrap_or(0.0),
                                })
                            })
                            .collect();
                        obj.insert("filmstrip_frames".into(), json!(filmstrip_frames));
                    }
                }
            }
        } else if let Some(obj) = clip.as_object_mut() {
            obj.insert("filmstrip_status".into(), json!("missing"));
        }
        clips.push(clip);
    }
    Ok(json!({
        "clips": clips,
        "summary": pool_summary(&clips),
    }))
}

pub fn mark_filmstrip_building(
    paths: &ProjectPaths,
    project_id: &str,
    clip_id: &str,
) -> Result<(), String> {
    crate::filmstrip::mark_filmstrip(paths, project_id, clip_id, "building", "")
}
