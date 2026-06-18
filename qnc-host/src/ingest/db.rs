use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde_json::Value;

use crate::project::db::{open_project, ProjectPaths};

pub fn ingest_dir(paths: &ProjectPaths, project_id: &str) -> PathBuf {
    paths.project_dir(project_id).join("ingest")
}

pub fn ensure_ingest_dirs(paths: &ProjectPaths, project_id: &str) -> std::io::Result<()> {
    let base = ingest_dir(paths, project_id);
    fs::create_dir_all(base.join("thumbnails"))?;
    Ok(())
}

pub fn open_ingest(paths: &ProjectPaths, project_id: &str) -> rusqlite::Result<Connection> {
    ensure_ingest_dirs(paths, project_id).ok();
    let conn = open_project(paths, project_id)?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS ingest_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ingest_assets (
            source_id TEXT NOT NULL,
            clip_id TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            media_id TEXT NOT NULL DEFAULT '',
            duration_sec REAL NOT NULL DEFAULT 0,
            resolution TEXT NOT NULL DEFAULT '',
            codec TEXT NOT NULL DEFAULT '',
            fps REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT '',
            import_status TEXT NOT NULL DEFAULT '',
            selected INTEGER NOT NULL DEFAULT 0,
            thumb_color_a TEXT NOT NULL DEFAULT '',
            thumb_color_b TEXT NOT NULL DEFAULT '',
            thumb_status TEXT NOT NULL DEFAULT 'pending',
            thumb_error TEXT NOT NULL DEFAULT '',
            source_path TEXT NOT NULL DEFAULT '',
            original_path TEXT NOT NULL DEFAULT '',
            proxy_path TEXT NOT NULL DEFAULT '',
            project_proxy_path TEXT NOT NULL DEFAULT '',
            thumb_path TEXT NOT NULL DEFAULT '',
            card_thumb_path TEXT NOT NULL DEFAULT '',
            metadata_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY (source_id, clip_id)
        );
        ",
    )?;
    migrate_thumb_columns(conn)?;
    migrate_ingest_metadata_columns(conn)?;
    Ok(())
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
    conn.prepare(&format!("PRAGMA table_info({table})"))
        .and_then(|mut stmt| {
            stmt.query_map([], |row| row.get::<_, String>(1))
                .map(|rows| rows.filter_map(Result::ok).any(|name| name == column))
        })
        .unwrap_or(false)
}

fn migrate_ingest_metadata_columns(conn: &Connection) -> rusqlite::Result<()> {
    if !column_exists(conn, "ingest_assets", "file_extension") {
        let _ = conn.execute(
            "ALTER TABLE ingest_assets ADD COLUMN file_extension TEXT NOT NULL DEFAULT ''",
            [],
        );
    }
    if !column_exists(conn, "ingest_assets", "poster_source") {
        let _ = conn.execute(
            "ALTER TABLE ingest_assets ADD COLUMN poster_source TEXT NOT NULL DEFAULT ''",
            [],
        );
    }
    if !column_exists(conn, "ingest_assets", "read_from_card") {
        let _ = conn.execute(
            "ALTER TABLE ingest_assets ADD COLUMN read_from_card INTEGER NOT NULL DEFAULT 0",
            [],
        );
    }
    if !column_exists(conn, "ingest_assets", "card_locked") {
        let _ = conn.execute(
            "ALTER TABLE ingest_assets ADD COLUMN card_locked INTEGER NOT NULL DEFAULT 0",
            [],
        );
    }
    let mut stmt = conn.prepare(
        "SELECT source_id, clip_id, metadata_json FROM ingest_assets WHERE metadata_json != '{}'",
    )?;
    let rows: Vec<(String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    for (source_id, clip_id, raw) in rows {
        let meta = parse_json(&raw, serde_json::json!({}));
        let ext = meta.get("extension").and_then(|v| v.as_str()).unwrap_or("");
        let poster = meta
            .get("poster_source")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let read_from_card = meta
            .get("read_from_card")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let card_locked = meta
            .get("card_locked")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        conn.execute(
            "UPDATE ingest_assets SET
                file_extension = CASE WHEN file_extension = '' THEN ?3 ELSE file_extension END,
                poster_source = CASE WHEN poster_source = '' THEN ?4 ELSE poster_source END,
                read_from_card = CASE WHEN read_from_card = 0 AND ?5 = 1 THEN 1 ELSE read_from_card END,
                card_locked = CASE WHEN card_locked = 0 AND ?6 = 1 THEN 1 ELSE card_locked END,
                source_path = CASE WHEN source_path = '' THEN COALESCE(?7, '') ELSE source_path END,
                original_path = CASE WHEN original_path = '' THEN COALESCE(?8, '') ELSE original_path END,
                proxy_path = CASE WHEN proxy_path = '' THEN COALESCE(?9, '') ELSE proxy_path END,
                card_thumb_path = CASE WHEN card_thumb_path = '' THEN COALESCE(?10, '') ELSE card_thumb_path END,
                metadata_json = '{}'
             WHERE source_id = ?1 AND clip_id = ?2",
            params![
                source_id,
                clip_id,
                ext,
                poster,
                if read_from_card { 1 } else { 0 },
                if card_locked { 1 } else { 0 },
                meta.get("source_path").and_then(|v| v.as_str()).unwrap_or(""),
                meta.get("original_path").and_then(|v| v.as_str()).unwrap_or(""),
                meta.get("proxy_path").and_then(|v| v.as_str()).unwrap_or(""),
                meta.get("card_thumb_path").and_then(|v| v.as_str()).unwrap_or(""),
            ],
        )?;
    }
    Ok(())
}

fn migrate_thumb_columns(conn: &Connection) -> rusqlite::Result<()> {
    let _ = conn.execute(
        "ALTER TABLE ingest_assets ADD COLUMN thumb_status TEXT NOT NULL DEFAULT 'pending'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE ingest_assets ADD COLUMN thumb_error TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE ingest_assets ADD COLUMN source_path TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE ingest_assets ADD COLUMN original_path TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE ingest_assets ADD COLUMN proxy_path TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE ingest_assets ADD COLUMN project_proxy_path TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE ingest_assets ADD COLUMN thumb_path TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE ingest_assets ADD COLUMN card_thumb_path TEXT NOT NULL DEFAULT ''",
        [],
    );
    Ok(())
}

pub fn set_thumb_status(
    conn: &Connection,
    source_id: &str,
    clip_id: &str,
    status: &str,
    error: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE ingest_assets SET thumb_status = ?3, thumb_error = ?4
         WHERE source_id = ?1 AND clip_id = ?2",
        params![source_id, clip_id, status, error],
    )?;
    Ok(())
}

pub fn set_thumb_ready_path(
    conn: &Connection,
    source_id: &str,
    clip_id: &str,
    path: &Path,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE ingest_assets SET thumb_status = 'ready', thumb_error = '', thumb_path = ?3
         WHERE source_id = ?1 AND clip_id = ?2",
        params![source_id, clip_id, path.to_string_lossy()],
    )?;
    Ok(())
}

pub fn stored_thumbnail_path(
    paths: &ProjectPaths,
    project_id: &str,
    clip_id: &str,
) -> rusqlite::Result<Option<PathBuf>> {
    let conn = open_ingest(paths, project_id)?;
    let path: Option<String> = conn
        .query_row(
            "SELECT thumb_path FROM ingest_assets
             WHERE clip_id = ?1 AND thumb_status = 'ready'
             ORDER BY source_id LIMIT 1",
            params![clip_id],
            |r| r.get(0),
        )
        .ok();
    Ok(path
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from))
}

pub fn get_meta(conn: &Connection, key: &str, default: &str) -> rusqlite::Result<String> {
    let row: Option<String> = conn
        .query_row(
            "SELECT value FROM ingest_meta WHERE key = ?1",
            params![key],
            |r| r.get(0),
        )
        .ok();
    Ok(row.unwrap_or_else(|| default.to_string()))
}

pub fn set_meta(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO ingest_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn parse_json(raw: &str, fallback: Value) -> Value {
    serde_json::from_str(raw).unwrap_or(fallback)
}

pub fn ingest_asset_meta(
    source_path: &str,
    original_path: &str,
    proxy_path: &str,
    project_proxy_path: &str,
    card_thumb_path: &str,
    file_extension: &str,
    read_from_card: bool,
    card_locked: bool,
    poster_source: &str,
) -> Value {
    let mut obj = serde_json::Map::new();
    for (key, val) in [
        ("source_path", source_path),
        ("original_path", original_path),
        ("proxy_path", proxy_path),
        ("project_proxy_path", project_proxy_path),
        ("card_thumb_path", card_thumb_path),
        ("extension", file_extension),
        ("poster_source", poster_source),
    ] {
        if !val.trim().is_empty() {
            obj.insert(key.into(), Value::String(val.to_string()));
        }
    }
    if read_from_card {
        obj.insert("read_from_card".into(), Value::Bool(true));
    }
    if card_locked {
        obj.insert("card_locked".into(), Value::Bool(true));
    }
    Value::Object(obj)
}

pub fn thumbnail_path(paths: &ProjectPaths, project_id: &str, clip_id: &str) -> PathBuf {
    ingest_dir(paths, project_id)
        .join("thumbnails")
        .join(sanitize_name(clip_id))
        .join("poster.jpg")
}

pub fn thumbnail_url(project_id: &str, clip_id: &str) -> String {
    format!(
        "/api/ingest/thumbnail?project_id={}&clip_id={}",
        urlencoding(project_id),
        urlencoding(clip_id)
    )
}

fn urlencoding(raw: &str) -> String {
    raw.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u8),
        })
        .collect()
}

fn sanitize_name(raw: &str) -> String {
    let mut out: String = raw
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
    if out.is_empty() {
        out = "clip".into();
    }
    out
}

pub fn poster_exists(path: &Path) -> bool {
    path.is_file() && path.metadata().map(|m| m.len() > 0).unwrap_or(false)
}

/// Kopija THM/JPG s kartice u ingest poster (bez ffmpeg).
pub fn copy_card_image_to_poster(src: &Path, dest: &Path) -> std::io::Result<()> {
    if !src.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("THM/JPG ne postoji: {}", src.display()),
        ));
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(src, dest)?;
    Ok(())
}
