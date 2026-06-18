use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::config::{configured_projects_root, AppConfig};

#[derive(Clone)]
pub struct ProjectPaths {
    pub data_dir: PathBuf,
    pub projects_root: PathBuf,
    pub seed_path: PathBuf,
}

impl ProjectPaths {
    pub fn from_root(root: &Path, config: &AppConfig) -> Self {
        let data_dir = root.join("data");
        let projects_root = configured_projects_root(config);
        let seed_path = root
            .join("plugins")
            .join("project")
            .join("storage")
            .join("system_seed.json");
        Self {
            data_dir,
            projects_root,
            seed_path,
        }
    }

    pub fn global_db(&self) -> PathBuf {
        self.data_dir.join("project_store.db")
    }

    pub fn project_db(&self, project_id: &str) -> PathBuf {
        self.project_dir(project_id).join("qnc_project.db")
    }

    pub fn project_dir(&self, project_id: &str) -> PathBuf {
        if let Ok(conn) = Connection::open(self.global_db()) {
            let row: Option<String> = conn
                .query_row(
                    "SELECT project_dir FROM projects WHERE project_id = ?1",
                    params![project_id.trim()],
                    |r| r.get(0),
                )
                .ok();
            if let Some(dir) = row.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
                return PathBuf::from(dir);
            }
        }
        project_dir_in_root(&self.projects_root, project_id)
    }
}

pub fn now_str() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("epoch_{secs}")
}

pub fn slug_id(name: &str) -> String {
    let mut base: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    while base.contains("__") {
        base = base.replace("__", "_");
    }
    base = base.trim_matches('_').chars().take(40).collect();
    if base.is_empty() {
        base = "projekt".into();
    }
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{base}_{ts}")
}

pub fn safe_dir_name(project_id: &str) -> String {
    let mut pid: String = project_id
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
    if pid.len() > 80 {
        pid.truncate(80);
    }
    if pid.is_empty() {
        "_invalid_project_id".into()
    } else {
        pid
    }
}

pub fn project_dir_in_root(root: &Path, project_id: &str) -> PathBuf {
    root.join(safe_dir_name(project_id))
}

pub fn project_root_from_settings(settings: &Value) -> Option<PathBuf> {
    settings
        .get("storage")
        .and_then(|v| v.get("projects_root"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

pub fn export_dir_from_settings(settings: &Value) -> Option<PathBuf> {
    settings
        .get("export")
        .and_then(|v| v.get("directory").or_else(|| v.get("output_directory")))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

pub fn project_settings_snapshot(
    paths: &ProjectPaths,
    project_id: &str,
) -> rusqlite::Result<Value> {
    let pid = project_id.trim();
    let conn = open_project(paths, pid)?;
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT template_id, settings_json FROM project_settings WHERE project_id = ?1",
            params![pid],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let Some((template_id, settings_raw)) = row else {
        return Ok(json!({}));
    };
    Ok(json!({
        "project_id": pid,
        "template_id": template_id,
        "settings": parse_json(&settings_raw, json!({})),
    }))
}

pub fn project_display_name(paths: &ProjectPaths, project_id: &str) -> String {
    let pid = project_id.trim();
    if pid.is_empty() {
        return String::new();
    }
    let Ok(conn) = Connection::open(paths.global_db()) else {
        return pid.to_string();
    };
    let name = conn
        .query_row(
            "SELECT name FROM projects WHERE project_id = ?1",
            params![pid],
            |r| r.get::<_, String>(0),
        )
        .unwrap_or_default();
    if name.trim().is_empty() {
        pid.to_string()
    } else {
        name
    }
}

pub fn open_global(paths: &ProjectPaths) -> rusqlite::Result<Connection> {
    fs::create_dir_all(&paths.data_dir).ok();
    let conn = Connection::open(paths.global_db())?;
    conn.execute("PRAGMA foreign_keys = ON", [])?;
    init_global_schema(&conn)?;
    migrate_from_projects_json(&conn, &paths.data_dir, &paths.projects_root)?;
    Ok(conn)
}

pub fn open_project(paths: &ProjectPaths, project_id: &str) -> rusqlite::Result<Connection> {
    let dir = paths.project_dir(project_id);
    fs::create_dir_all(&dir).ok();
    let conn = Connection::open(paths.project_db(project_id))?;
    init_project_schema(&conn)?;
    Ok(conn)
}

fn init_global_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS projects (
            project_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            project_dir TEXT,
            created_at TEXT,
            updated_at TEXT,
            created_by TEXT,
            updated_by TEXT
        );
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'editor',
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            station_id TEXT NOT NULL,
            client_label TEXT NOT NULL DEFAULT '',
            created_at TEXT,
            last_seen_at TEXT,
            FOREIGN KEY(user_id) REFERENCES users(user_id)
        );
        CREATE TABLE IF NOT EXISTS source_templates (
            source_template_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            source_kind TEXT NOT NULL DEFAULT 'local',
            system INTEGER NOT NULL DEFAULT 0,
            config_json TEXT NOT NULL DEFAULT '{}',
            created_by TEXT,
            updated_by TEXT,
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS project_templates (
            template_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            system INTEGER NOT NULL DEFAULT 0,
            settings_json TEXT NOT NULL DEFAULT '{}',
            source_template_ids_json TEXT NOT NULL DEFAULT '[]',
            created_by TEXT,
            updated_by TEXT,
            created_at TEXT,
            updated_at TEXT
        );
        ",
    )?;
    migrate_projects_columns(conn)?;
    Ok(())
}

fn migrate_projects_columns(conn: &Connection) -> rusqlite::Result<()> {
    let _ = conn.execute("ALTER TABLE projects ADD COLUMN last_opened_at TEXT", []);
    let _ = conn.execute("ALTER TABLE projects ADD COLUMN project_dir TEXT", []);
    Ok(())
}

fn init_project_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS project_settings (
            project_id TEXT PRIMARY KEY,
            template_id TEXT,
            settings_json TEXT NOT NULL DEFAULT '{}',
            created_by TEXT,
            updated_by TEXT,
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS project_members (
            project_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'editor',
            joined_at TEXT,
            last_seen_at TEXT,
            PRIMARY KEY(project_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS project_template_snapshot (
            project_id TEXT PRIMARY KEY,
            template_id TEXT,
            template_name TEXT NOT NULL DEFAULT '',
            template_version TEXT NOT NULL DEFAULT '',
            snapshot_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS project_workflow_steps (
            step_id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            plugin_id TEXT NOT NULL,
            tab_id TEXT NOT NULL,
            label TEXT NOT NULL,
            position INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'locked',
            next_step_id TEXT,
            settings_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS project_workflow_state (
            project_id TEXT PRIMARY KEY,
            active_step_id TEXT,
            entry_step_id TEXT,
            updated_at TEXT
        );
        ",
    )?;
    Ok(())
}

fn migrate_from_projects_json(
    conn: &Connection,
    data_dir: &Path,
    projects_root: &Path,
) -> rusqlite::Result<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }
    let json_path = data_dir.join("projects.json");
    let Ok(raw) = fs::read_to_string(&json_path) else {
        return Ok(());
    };
    let Ok(doc) = serde_json::from_str::<Value>(&raw) else {
        return Ok(());
    };
    let Some(projects) = doc.get("projects").and_then(|v| v.as_array()) else {
        return Ok(());
    };
    let active = doc
        .get("active_project_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let now = now_str();
    for p in projects {
        let id = p.get("project_id").and_then(|v| v.as_str()).unwrap_or("");
        if id.is_empty() {
            continue;
        }
        let name = p.get("name").and_then(|v| v.as_str()).unwrap_or(id);
        let created = p.get("created_at").and_then(|v| v.as_str()).unwrap_or(&now);
        conn.execute(
            "INSERT OR IGNORE INTO projects (project_id, name, project_dir, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, name, project_dir_in_root(projects_root, id).to_string_lossy(), created, now],
        )?;
    }
    set_setting(conn, "active_project_id", active)?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str, default: &str) -> rusqlite::Result<String> {
    let row: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![key],
            |r| r.get(0),
        )
        .ok();
    Ok(row.unwrap_or_else(|| default.to_string()))
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn ensure_project_store(conn: &Connection) -> rusqlite::Result<()> {
    // Projekt se ne seeda automatski — korisnik kreira projekte ručno.
    let _ = conn;
    Ok(())
}

pub fn deep_merge(base: &Value, override_val: &Value) -> Value {
    match (base, override_val) {
        (Value::Object(a), Value::Object(b)) => {
            let mut out = a.clone();
            for (k, v) in b {
                if let Some(existing) = a.get(k) {
                    out.insert(k.clone(), deep_merge(existing, v));
                } else {
                    out.insert(k.clone(), v.clone());
                }
            }
            Value::Object(out)
        }
        (_, b) => b.clone(),
    }
}

pub fn json_string(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "{}".into())
}

pub fn parse_json(raw: &str, fallback: Value) -> Value {
    serde_json::from_str(raw).unwrap_or(fallback)
}

pub fn export_projects_json(paths: &ProjectPaths, conn: &Connection) {
    let active = get_setting(conn, "active_project_id", "").unwrap_or_default();
    let mut stmt = conn
        .prepare("SELECT project_id, name, project_dir, created_at, last_opened_at FROM projects ORDER BY project_id")
        .ok();
    let Some(ref mut stmt) = stmt else { return };
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "project_id": r.get::<_, String>(0)?,
                "name": r.get::<_, String>(1)?,
                "project_dir": r.get::<_, Option<String>>(2)?,
                "created_at": r.get::<_, Option<String>>(3)?,
                "last_opened_at": r.get::<_, Option<String>>(4)?,
            }))
        })
        .ok();
    let Some(rows) = rows else { return };
    let mut projects = Vec::new();
    for row in rows.flatten() {
        projects.push(row);
    }
    let payload = json!({
        "active_project_id": active,
        "projects": projects,
    });
    if let Ok(text) = serde_json::to_string_pretty(&payload) {
        fs::create_dir_all(&paths.data_dir).ok();
        fs::write(paths.data_dir.join("projects.json"), text).ok();
    }
}

pub fn ensure_project_dirs(paths: &ProjectPaths, project_id: &str) -> std::io::Result<()> {
    let base = paths.project_dir(project_id);
    ensure_project_dirs_at(&base)
}

pub fn ensure_project_dirs_at(base: &Path) -> std::io::Result<()> {
    for sub in [
        "",
        "proxy",
        "incoming/card",
        "incoming/ftp",
        "ingest/thumbnails",
        "filmstrip",
        "media_pool",
    ] {
        let dir = if sub.is_empty() {
            base.to_path_buf()
        } else {
            base.join(sub)
        };
        fs::create_dir_all(dir)?;
    }
    Ok(())
}
