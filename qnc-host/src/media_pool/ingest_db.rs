//! Read-only pogled na ingest tablice u projektnoj bazi.

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::project::db::{open_project, ProjectPaths};

const VIDEO_EXT: &[&str] = &["mp4", "mov", "m4v", "mxf", "mts", "mkv", "avi", "webm"];

fn open_ingest_readonly(paths: &ProjectPaths, project_id: &str) -> Result<Connection, String> {
    open_project(paths, project_id).map_err(|e| e.to_string())
}

fn is_video(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| VIDEO_EXT.contains(&s.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Klipovi s `import_status = imported` (rezultat ingest uvoza).
pub fn read_imported_clips(paths: &ProjectPaths, project_id: &str) -> Result<Vec<Value>, String> {
    let conn = match open_ingest_readonly(paths, project_id) {
        Ok(c) => c,
        Err(_) => return Ok(vec![]),
    };
    if !table_exists(&conn, "ingest_assets")? {
        return Ok(vec![]);
    }
    let mut stmt = conn
        .prepare(
            "SELECT clip_id, name, duration_sec, import_status, status, metadata_json,
                    project_proxy_path, proxy_path, thumb_path, source_path, original_path, card_thumb_path
             FROM ingest_assets
             WHERE import_status = 'imported'
             ORDER BY clip_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let clip_id: String = row.get(0)?;
            let meta_raw: String = row.get(5)?;
            let meta = serde_json::from_str::<Value>(&meta_raw).unwrap_or_else(|_| json!({}));
            let project_proxy_path = row.get::<_, String>(6).unwrap_or_default();
            let ingest_proxy_path = row.get::<_, String>(7).unwrap_or_default();
            let thumb_path = row.get::<_, String>(8).unwrap_or_default();
            let source_path = row.get::<_, String>(9).unwrap_or_default();
            let original_path = row.get::<_, String>(10).unwrap_or_default();
            let card_thumb_path = row.get::<_, String>(11).unwrap_or_default();
            let proxy_path = Some(project_proxy_path.as_str())
                .filter(|s| !s.trim().is_empty())
                .or_else(|| Some(ingest_proxy_path.as_str()).filter(|s| !s.trim().is_empty()))
                .or_else(|| meta.get("project_proxy_path").and_then(|v| v.as_str()))
                .or_else(|| meta.get("proxy_path").and_then(|v| v.as_str()))
                .filter(|s| !s.is_empty())
                .map(PathBuf::from)
                .filter(|p| p.is_file());
            Ok(json!({
                "clip_id": clip_id,
                "name": row.get::<_, String>(1)?,
                "duration_sec": row.get::<_, f64>(2)?,
                "import_status": row.get::<_, String>(3)?,
                "proxy_status": row.get::<_, String>(4)?,
                "metadata": meta,
                "proxy_path": proxy_path.as_ref().map(|p| p.to_string_lossy().to_string()),
                "thumb_path": empty_to_null(&thumb_path),
                "source_path": empty_to_null(&source_path),
                "original_path": empty_to_null(&original_path),
                "card_thumb_path": empty_to_null(&card_thumb_path),
            }))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn empty_to_null(value: &str) -> Value {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Value::Null
    } else {
        json!(trimmed)
    }
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, String> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1",
            params![table],
            |_| Ok(()),
        )
        .is_ok())
}

pub fn proxy_path_for_clip(
    paths: &ProjectPaths,
    project_id: &str,
    clip_id: &str,
) -> Option<PathBuf> {
    let clips = read_imported_clips(paths, project_id).ok()?;
    clips
        .iter()
        .find(|c| c.get("clip_id").and_then(|v| v.as_str()) == Some(clip_id))
        .and_then(|c| c.get("proxy_path").and_then(|v| v.as_str()))
        .map(PathBuf::from)
        .filter(|p| p.is_file() && is_video(p))
}
