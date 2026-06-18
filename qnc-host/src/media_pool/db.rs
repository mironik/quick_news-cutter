use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use rusqlite::{Connection, params};
use serde_json::{json, Value};

use crate::project::db::{now_str, open_project, ProjectPaths};

use super::ingest_db::read_imported_clips;

pub fn media_pool_dir(paths: &ProjectPaths, project_id: &str) -> PathBuf {
    paths.project_dir(project_id).join("media_pool")
}

fn open_db(paths: &ProjectPaths, project_id: &str) -> Result<Connection, String> {
    let root = media_pool_dir(paths, project_id);
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let conn = open_project(paths, project_id).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS pool_clips (
            clip_id TEXT PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'active',
            added_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS virtual_shots (
            shot_id TEXT PRIMARY KEY,
            clip_id TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT '',
            quality TEXT NOT NULL DEFAULT '',
            duration_seconds REAL NOT NULL DEFAULT 0,
            data_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT,
            updated_at TEXT
        );",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

/// Uskladi `pool_clips` s redovima `import_status=imported` u projektnoj bazi.
pub fn sync_pool_from_ingest_db(paths: &ProjectPaths, project_id: &str) -> Result<(), String> {
    let imported = read_imported_clips(paths, project_id)?;
    let ids: HashSet<String> = imported
        .iter()
        .filter_map(|c| c.get("clip_id").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .collect();
    let conn = open_db(paths, project_id)?;
    let now = now_str();
    if ids.is_empty() {
        conn.execute("DELETE FROM pool_clips", [])
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let existing: Vec<String> = conn
        .prepare("SELECT clip_id FROM pool_clips")
        .map_err(|e| e.to_string())?
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| e.to_string())?;
    for old in existing {
        if !ids.contains(&old) {
            conn.execute("DELETE FROM pool_clips WHERE clip_id = ?1", params![old])
                .map_err(|e| e.to_string())?;
        }
    }
    for clip_id in &ids {
        conn.execute(
            "INSERT INTO pool_clips (clip_id, status, added_at, updated_at)
             VALUES (?1, 'active', ?2, ?2)
             ON CONFLICT(clip_id) DO UPDATE SET status = 'active', updated_at = excluded.updated_at",
            params![clip_id, now],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn pool_clip_ids(paths: &ProjectPaths, project_id: &str) -> Result<Vec<String>, String> {
    let conn = open_db(paths, project_id)?;
    let mut stmt = conn
        .prepare("SELECT clip_id FROM pool_clips WHERE status = 'active' ORDER BY clip_id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

pub fn list_virtual_shots(paths: &ProjectPaths, project_id: &str) -> Result<Vec<Value>, String> {
    let conn = open_db(paths, project_id)?;
    let mut stmt = conn
        .prepare(
            "SELECT shot_id, clip_id, source, quality, duration_seconds, data_json, created_at
             FROM virtual_shots ORDER BY created_at",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let data_raw: String = row.get(5)?;
            let data = serde_json::from_str::<Value>(&data_raw).unwrap_or(json!({}));
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "shot_id": row.get::<_, String>(0)?,
                "clip_id": row.get::<_, String>(1)?,
                "source": row.get::<_, String>(2)?,
                "quality": row.get::<_, String>(3)?,
                "duration_seconds": row.get::<_, f64>(4)?,
                "data": data,
                "in_seconds": data.get("in_seconds").and_then(|v| v.as_f64()).unwrap_or(0.0),
                "out_seconds": data.get("out_seconds").and_then(|v| v.as_f64()).unwrap_or(0.0),
                "created_at": row.get::<_, Option<String>>(6)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

pub fn add_virtual_shot(
    paths: &ProjectPaths,
    project_id: &str,
    clip_id: &str,
    in_seconds: f64,
    out_seconds: f64,
) -> Result<Value, String> {
    if out_seconds <= in_seconds {
        return Err("OUT mora biti nakon IN".into());
    }
    if super::ingest_db::proxy_path_for_clip(paths, project_id, clip_id).is_none() {
        return Err(format!("Klip '{clip_id}' nije uvezen u ingest"));
    }
    let duration = round3(out_seconds - in_seconds);
    let shot_id = format!(
        "{}_{}",
        clip_id.replace(|c: char| !c.is_ascii_alphanumeric(), "_"),
        now_str()
    );
    let data = json!({
        "clip_id": clip_id,
        "in_seconds": round3(in_seconds),
        "out_seconds": round3(out_seconds),
        "duration_seconds": duration,
        "source": "manual",
    });
    let now = now_str();
    let conn = open_db(paths, project_id)?;
    conn.execute(
        "INSERT INTO virtual_shots (shot_id, clip_id, source, quality, duration_seconds, data_json, created_at, updated_at)
         VALUES (?1, ?2, 'manual', 'real', ?3, ?4, ?5, ?5)",
        params![shot_id, clip_id, duration, data.to_string(), now],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({
        "id": shot_id,
        "shot_id": shot_id,
        "clip_id": clip_id,
        "in_seconds": round3(in_seconds),
        "out_seconds": round3(out_seconds),
        "duration_seconds": duration,
        "source": "manual",
    }))
}

fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

pub fn pool_summary(clips: &[Value]) -> Value {
    json!({
        "total": clips.len(),
        "discovered": clips.iter().filter(|c| c.get("discovered").and_then(|v| v.as_bool()).unwrap_or(false)).count(),
        "validated": clips.iter().filter(|c| c.get("validated").and_then(|v| v.as_bool()).unwrap_or(false)).count(),
        "transferred": clips.iter().filter(|c| c.get("transferred").and_then(|v| v.as_bool()).unwrap_or(false)).count(),
        "transcribed": clips.iter().filter(|c| c.get("has_transcript").and_then(|v| v.as_bool()).unwrap_or(false)).count(),
    })
}
