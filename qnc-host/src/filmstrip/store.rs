use std::fs;
use std::path::PathBuf;

use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::project::db::{now_str, open_project, ProjectPaths};

fn safe_name(value: &str) -> String {
    let mut out: String = value
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if out.len() > 120 {
        out.truncate(120);
    }
    if out.is_empty() {
        "clip".into()
    } else {
        out
    }
}

pub fn filmstrip_root(paths: &ProjectPaths, project_id: &str) -> PathBuf {
    paths.project_dir(project_id).join("filmstrip")
}

fn open_db(paths: &ProjectPaths, project_id: &str) -> Result<Connection, String> {
    let root = filmstrip_root(paths, project_id);
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let conn = open_project(paths, project_id).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS filmstrips (
            clip_id TEXT PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'missing',
            duration_sec REAL NOT NULL DEFAULT 0,
            frame_count INTEGER NOT NULL DEFAULT 0,
            error TEXT NOT NULL DEFAULT '',
            built_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS filmstrip_frames (
            clip_id TEXT NOT NULL,
            frame_index INTEGER NOT NULL,
            seek_sec REAL NOT NULL,
            path TEXT NOT NULL,
            updated_at TEXT,
            PRIMARY KEY (clip_id, frame_index)
        );
        CREATE INDEX IF NOT EXISTS idx_filmstrip_frames_clip ON filmstrip_frames(clip_id);",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn filmstrip_clip_dir(paths: &ProjectPaths, project_id: &str, clip_id: &str) -> PathBuf {
    let dir = filmstrip_root(paths, project_id).join(safe_name(clip_id));
    fs::create_dir_all(&dir).ok();
    dir
}

fn filmstrip_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "clip_id": row.get::<_, String>("clip_id")?,
        "status": row.get::<_, String>("status")?,
        "duration_sec": row.get::<_, f64>("duration_sec")?,
        "frame_count": row.get::<_, i64>("frame_count")?,
        "error": row.get::<_, String>("error")?,
        "built_at": row.get::<_, Option<String>>("built_at")?,
        "updated_at": row.get::<_, Option<String>>("updated_at")?,
    }))
}

pub fn get_filmstrip(paths: &ProjectPaths, project_id: &str, clip_id: &str) -> Option<Value> {
    let conn = open_db(paths, project_id).ok()?;
    conn.query_row(
        "SELECT clip_id, status, duration_sec, frame_count, error, built_at, updated_at
         FROM filmstrips WHERE clip_id = ?1",
        params![clip_id],
        filmstrip_row,
    )
    .ok()
}

pub fn list_frames_for_clip(
    paths: &ProjectPaths,
    project_id: &str,
    clip_id: &str,
) -> Result<Vec<Value>, String> {
    let conn = open_db(paths, project_id)?;
    let rows = {
        let mut stmt = conn
            .prepare(
                "SELECT frame_index, seek_sec, path FROM filmstrip_frames
                 WHERE clip_id = ?1 ORDER BY frame_index",
            )
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map(params![clip_id], |row| {
                Ok(json!({
                    "index": row.get::<_, i64>(0)?,
                    "seek_sec": row.get::<_, f64>(1)?,
                    "path": row.get::<_, String>(2)?,
                }))
            })
            .map_err(|e| e.to_string())?;
        mapped
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    Ok(rows)
}

fn write_frames(
    conn: &Connection,
    clip_id: &str,
    seeks: &[f64],
    frame_paths: &[PathBuf],
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM filmstrip_frames WHERE clip_id = ?1",
        params![clip_id],
    )
    .map_err(|e| e.to_string())?;
    for (index, sec) in seeks.iter().enumerate() {
        let path = frame_paths
            .get(index)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        if path.is_empty() {
            continue;
        }
        conn.execute(
            "INSERT INTO filmstrip_frames (clip_id, frame_index, seek_sec, path, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![clip_id, index as i64, *sec, path, now],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn pct_encode(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for b in raw.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => {
                out.push('%');
                out.push_str(&format!("{:02X}", b));
            }
        }
    }
    out
}

fn thumb_url(project_id: &str, clip_id: &str, seek_sec: f64) -> String {
    format!(
        "/api/media-pool/thumbnail?clip_id={}&seek={:.3}&w=112&project_id={}",
        pct_encode(clip_id),
        seek_sec,
        pct_encode(project_id),
    )
}

pub fn enrich_frames_with_urls(project_id: &str, clip_id: &str, frames: &[Value]) -> Vec<Value> {
    frames
        .iter()
        .map(|fr| {
            let seek = fr.get("seek_sec").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let mut obj = fr.as_object().cloned().unwrap_or_default();
            obj.insert("url".into(), json!(thumb_url(project_id, clip_id, seek)));
            Value::Object(obj)
        })
        .collect()
}

pub fn mark_filmstrip(
    paths: &ProjectPaths,
    project_id: &str,
    clip_id: &str,
    status: &str,
    error: &str,
) -> Result<(), String> {
    let conn = open_db(paths, project_id)?;
    let now = now_str();
    conn.execute(
        "INSERT INTO filmstrips (clip_id, status, error, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(clip_id) DO UPDATE SET
            status = excluded.status,
            error = excluded.error,
            updated_at = excluded.updated_at",
        params![clip_id, status, error, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn save_filmstrip(
    paths: &ProjectPaths,
    project_id: &str,
    clip_id: &str,
    duration_sec: f64,
    seeks: &[f64],
    frame_paths: &[PathBuf],
    error: &str,
) -> Result<Value, String> {
    let conn = open_db(paths, project_id)?;
    let now = now_str();
    let frame_count = frame_paths.len() as i64;
    let status = if error.is_empty() && frame_count > 0 {
        "ready"
    } else {
        "error"
    };
    let built_at = if status == "ready" {
        now.clone()
    } else {
        String::new()
    };
    conn.execute(
        "INSERT INTO filmstrips
            (clip_id, status, duration_sec, frame_count, error, built_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(clip_id) DO UPDATE SET
            status = excluded.status,
            duration_sec = excluded.duration_sec,
            frame_count = excluded.frame_count,
            error = excluded.error,
            built_at = excluded.built_at,
            updated_at = excluded.updated_at",
        params![
            clip_id,
            status,
            duration_sec,
            frame_count,
            error,
            built_at,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    if status == "ready" {
        write_frames(&conn, clip_id, seeks, frame_paths, &now)?;
    }
    get_filmstrip(paths, project_id, clip_id).ok_or_else(|| "filmstrip save failed".into())
}

pub fn frame_path_for_seek(
    paths: &ProjectPaths,
    project_id: &str,
    clip_id: &str,
    seek: f64,
) -> Option<PathBuf> {
    let fs = get_filmstrip(paths, project_id, clip_id)?;
    if fs.get("status").and_then(|v| v.as_str()) != Some("ready") {
        return None;
    }
    let frames = list_frames_for_clip(paths, project_id, clip_id).ok()?;
    let mut best_path: Option<String> = None;
    let mut best_diff = f64::MAX;
    for fr in frames {
        let sec = fr.get("seek_sec").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let path = fr.get("path").and_then(|v| v.as_str()).unwrap_or("");
        if path.is_empty() {
            continue;
        }
        let diff = (sec - seek).abs();
        if diff < best_diff {
            best_diff = diff;
            best_path = Some(path.to_string());
        }
    }
    best_path.map(PathBuf::from).filter(|p| p.is_file())
}

pub fn frame_path_for_index(
    paths: &ProjectPaths,
    project_id: &str,
    clip_id: &str,
    frame_index: i64,
) -> Option<PathBuf> {
    let conn = open_db(paths, project_id).ok()?;
    conn.query_row(
        "SELECT path FROM filmstrip_frames WHERE clip_id = ?1 AND frame_index = ?2",
        params![clip_id, frame_index],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .map(PathBuf::from)
    .filter(|p| p.is_file())
}
