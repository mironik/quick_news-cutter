use std::fs;

use rusqlite::{params, Connection};
use serde_json::{json, Value};

use super::db::open_db;
use crate::project::db::{now_str, ProjectPaths};

pub fn clip_has_transcript(conn: &Connection, clip_id: &str) -> Result<bool, String> {
    let status: Option<String> = conn
        .query_row(
            "SELECT status FROM clip_transcripts WHERE clip_id = ?1",
            params![clip_id],
            |r| r.get(0),
        )
        .ok();
    Ok(status.as_deref() == Some("complete"))
}

pub fn get_transcript(
    paths: &ProjectPaths,
    project_id: &str,
    clip_id: &str,
) -> Result<Option<Value>, String> {
    let conn = open_db(paths, project_id)?;
    get_transcript_conn(&conn, clip_id)
}

fn get_transcript_conn(conn: &Connection, clip_id: &str) -> Result<Option<Value>, String> {
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT status, text_body FROM clip_transcripts WHERE clip_id = ?1",
            params![clip_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let Some((status, text)) = row else {
        return Ok(None);
    };
    if status != "complete" {
        return Ok(None);
    }
    let mut stmt = conn
        .prepare(
            "SELECT start_sec, end_sec, text FROM clip_transcript_segments
             WHERE clip_id = ?1 ORDER BY segment_index",
        )
        .map_err(|e| e.to_string())?;
    let segments: Vec<Value> = stmt
        .query_map(params![clip_id], |r| {
            Ok(json!({
                "start": r.get::<_, f64>(0)?,
                "end": r.get::<_, f64>(1)?,
                "text": r.get::<_, String>(2)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(Some(json!({
        "text": text,
        "segments": segments,
    })))
}

pub fn save_transcript(
    paths: &ProjectPaths,
    project_id: &str,
    clip_id: &str,
    status: &str,
    transcript: &Value,
) -> Result<Value, String> {
    let conn = open_db(paths, project_id)?;
    save_transcript_conn(&conn, clip_id, status, transcript)
}

fn save_transcript_conn(
    conn: &Connection,
    clip_id: &str,
    status: &str,
    transcript: &Value,
) -> Result<Value, String> {
    let now = now_str();
    let text = transcript
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    conn.execute(
        "INSERT INTO clip_transcripts (clip_id, status, text_body, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(clip_id) DO UPDATE SET
           status = excluded.status,
           text_body = excluded.text_body,
           updated_at = excluded.updated_at",
        params![clip_id, status, text, now],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM clip_transcript_segments WHERE clip_id = ?1",
        params![clip_id],
    )
    .map_err(|e| e.to_string())?;
    if let Some(segments) = transcript.get("segments").and_then(|v| v.as_array()) {
        for (idx, seg) in segments.iter().enumerate() {
            let start = seg.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let end = seg.get("end").and_then(|v| v.as_f64()).unwrap_or(start);
            let seg_text = seg.get("text").and_then(|v| v.as_str()).unwrap_or("");
            conn.execute(
                "INSERT INTO clip_transcript_segments (clip_id, segment_index, start_sec, end_sec, text)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![clip_id, idx as i64, start, end, seg_text],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(json!({
        "status": status,
        "clip_id": clip_id,
        "has_transcript": status == "complete",
    }))
}

pub fn migrate_transcript_files(
    conn: &Connection,
    paths: &ProjectPaths,
    project_id: &str,
) -> Result<(), String> {
    let dir = paths.project_dir(project_id).join("transcripts");
    if !dir.is_dir() {
        return Ok(());
    }
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM clip_transcripts WHERE clip_id = ?1",
                params![name],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if exists > 0 {
            continue;
        }
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let parsed = serde_json::from_str::<Value>(&raw).unwrap_or(json!({}));
        save_transcript_conn(conn, name, "complete", &parsed)?;
    }
    Ok(())
}
