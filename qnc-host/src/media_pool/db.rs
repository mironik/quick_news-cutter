use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::project::db::{now_str, open_project, ProjectPaths};

use super::ingest_db::read_imported_clips;

pub fn media_pool_dir(paths: &ProjectPaths, project_id: &str) -> PathBuf {
    paths.project_dir(project_id).join("media_pool")
}

pub(crate) fn open_db(paths: &ProjectPaths, project_id: &str) -> Result<Connection, String> {
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
            in_seconds REAL NOT NULL DEFAULT 0,
            out_seconds REAL NOT NULL DEFAULT 0,
            data_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS media_pool_workflow (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            current_clip_id TEXT NOT NULL DEFAULT '',
            mark_in_sec REAL,
            mark_out_sec REAL,
            active_virtual_shot_id TEXT NOT NULL DEFAULT '',
            state_json TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS media_pool_workflow_selection (
            clip_id TEXT PRIMARY KEY,
            added_at TEXT
        );
        CREATE TABLE IF NOT EXISTS clip_transcripts (
            clip_id TEXT PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'none',
            text_body TEXT NOT NULL DEFAULT '',
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS clip_transcript_segments (
            clip_id TEXT NOT NULL,
            segment_index INTEGER NOT NULL,
            start_sec REAL NOT NULL DEFAULT 0,
            end_sec REAL NOT NULL DEFAULT 0,
            text TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (clip_id, segment_index)
        );",
    )
    .map_err(|e| e.to_string())?;
    migrate_media_pool_schema(&conn)?;
    super::transcripts::migrate_transcript_files(&conn, paths, project_id).ok();
    Ok(conn)
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
    conn.prepare(&format!("PRAGMA table_info({table})"))
        .and_then(|mut stmt| {
            stmt.query_map([], |row| row.get::<_, String>(1))
                .map(|rows| rows.filter_map(Result::ok).any(|name| name == column))
        })
        .unwrap_or(false)
}

fn migrate_media_pool_schema(conn: &Connection) -> Result<(), String> {
    if !column_exists(conn, "virtual_shots", "in_seconds") {
        let _ = conn.execute(
            "ALTER TABLE virtual_shots ADD COLUMN in_seconds REAL NOT NULL DEFAULT 0",
            [],
        );
    }
    if !column_exists(conn, "virtual_shots", "out_seconds") {
        let _ = conn.execute(
            "ALTER TABLE virtual_shots ADD COLUMN out_seconds REAL NOT NULL DEFAULT 0",
            [],
        );
    }
    if !column_exists(conn, "media_pool_workflow", "current_clip_id") {
        let _ = conn.execute(
            "ALTER TABLE media_pool_workflow ADD COLUMN current_clip_id TEXT NOT NULL DEFAULT ''",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE media_pool_workflow ADD COLUMN mark_in_sec REAL",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE media_pool_workflow ADD COLUMN mark_out_sec REAL",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE media_pool_workflow ADD COLUMN active_virtual_shot_id TEXT NOT NULL DEFAULT ''",
            [],
        );
    }
    migrate_workflow_json(conn)?;
    migrate_virtual_shots_json(conn)?;
    Ok(())
}

fn migrate_workflow_json(conn: &Connection) -> Result<(), String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM media_pool_workflow_selection",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if count > 0 {
        return Ok(());
    }
    let raw: Option<String> = conn
        .query_row(
            "SELECT state_json FROM media_pool_workflow WHERE id = 1",
            [],
            |r| r.get(0),
        )
        .ok();
    let Some(raw) = raw else {
        return Ok(());
    };
    let state = serde_json::from_str::<Value>(&raw).unwrap_or(json!({}));
    let Some(obj) = state.as_object() else {
        return Ok(());
    };
    let current = obj
        .get("current_clip_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let active = obj
        .get("active_virtual_shot_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let mark_in = obj.get("mark_in_sec").and_then(|v| v.as_f64());
    let mark_out = obj.get("mark_out_sec").and_then(|v| v.as_f64());
    let now = now_str();
    conn.execute(
        "INSERT INTO media_pool_workflow (id, current_clip_id, mark_in_sec, mark_out_sec, active_virtual_shot_id, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
           current_clip_id = excluded.current_clip_id,
           mark_in_sec = excluded.mark_in_sec,
           mark_out_sec = excluded.mark_out_sec,
           active_virtual_shot_id = excluded.active_virtual_shot_id,
           updated_at = excluded.updated_at",
        params![current, mark_in, mark_out, active, now],
    )
    .map_err(|e| e.to_string())?;
    if let Some(ids) = obj.get("selected_clip_ids").and_then(|v| v.as_array()) {
        for id in ids.iter().filter_map(|v| v.as_str()) {
            let trimmed = id.trim();
            if trimmed.is_empty() {
                continue;
            }
            conn.execute(
                "INSERT OR IGNORE INTO media_pool_workflow_selection (clip_id, added_at) VALUES (?1, ?2)",
                params![trimmed, now],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn migrate_virtual_shots_json(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT shot_id, data_json, in_seconds, out_seconds FROM virtual_shots
             WHERE (in_seconds = 0 AND out_seconds = 0) AND data_json != '{}'",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for (shot_id, raw) in rows {
        let data = serde_json::from_str::<Value>(&raw).unwrap_or(json!({}));
        let in_sec = data
            .get("in_seconds")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let out_sec = data
            .get("out_seconds")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        if in_sec > 0.0 || out_sec > 0.0 {
            conn.execute(
                "UPDATE virtual_shots SET in_seconds = ?1, out_seconds = ?2 WHERE shot_id = ?3",
                params![in_sec, out_sec, shot_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Uskladi `pool_clips` s redovima `import_status=imported` u projektnoj bazi.
pub fn sync_pool_from_ingest_db(paths: &ProjectPaths, project_id: &str) -> Result<(), String> {
    let imported = read_imported_clips(paths, project_id)?;
    let ids: HashSet<String> = imported
        .iter()
        .filter_map(|c| {
            c.get("clip_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
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
            "SELECT shot_id, clip_id, source, quality, duration_seconds, in_seconds, out_seconds, created_at
             FROM virtual_shots ORDER BY created_at",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "shot_id": row.get::<_, String>(0)?,
                "clip_id": row.get::<_, String>(1)?,
                "source": row.get::<_, String>(2)?,
                "quality": row.get::<_, String>(3)?,
                "duration_seconds": row.get::<_, f64>(4)?,
                "in_seconds": row.get::<_, f64>(5)?,
                "out_seconds": row.get::<_, f64>(6)?,
                "created_at": row.get::<_, Option<String>>(7)?,
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
    let in_r = round3(in_seconds);
    let out_r = round3(out_seconds);
    let shot_id = format!(
        "{}_{}",
        clip_id.replace(|c: char| !c.is_ascii_alphanumeric(), "_"),
        now_str()
    );
    let now = now_str();
    let conn = open_db(paths, project_id)?;
    conn.execute(
        "INSERT INTO virtual_shots (shot_id, clip_id, source, quality, duration_seconds, in_seconds, out_seconds, data_json, created_at, updated_at)
         VALUES (?1, ?2, 'manual', 'real', ?3, ?4, ?5, '{}', ?6, ?6)",
        params![shot_id, clip_id, duration, in_r, out_r, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({
        "id": shot_id,
        "shot_id": shot_id,
        "clip_id": clip_id,
        "in_seconds": in_r,
        "out_seconds": out_r,
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
