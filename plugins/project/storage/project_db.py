"""SQLite — projektna meta baza i projektne postavke."""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from typing import Any

_APP_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_DATA_DIR = _APP_ROOT / "data"
_DB_PATH = _DATA_DIR / "project_store.db"
_PROJECTS_JSON = _DATA_DIR / "projects.json"
_GLOBAL_PROJECT_CONTENT_TABLES = (
    "project_tabs",
    "project_modules",
    "project_settings",
    "project_members",
    "activity_log",
    "object_locks",
)


def _connect() -> sqlite3.Connection:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def _project_db_path(project_id: str) -> Path:
    from .project_state import project_dir

    root = project_dir(project_id)
    root.mkdir(parents=True, exist_ok=True)
    return root / "qnc_project.db"


def _connect_project(project_id: str) -> sqlite3.Connection:
    conn = sqlite3.connect(_project_db_path(project_id), timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS projects (
            project_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS module_state (
            module_id TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS module_settings (
            module_id TEXT PRIMARY KEY,
            settings_json TEXT NOT NULL,
            updated_at TEXT
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
        """
    )
    _ensure_columns(
        conn,
        "projects",
        {
            "created_by": "TEXT",
            "updated_by": "TEXT",
        },
    )
    conn.commit()


def _init_project_schema(conn: sqlite3.Connection) -> None:
    """Schema za sadržaj jednog projekta: Projekti/<project_id>/qnc_project.db."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS qnc_project_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS project_modules (
            project_id TEXT NOT NULL,
            module_id TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            label TEXT NOT NULL DEFAULT '',
            enabled INTEGER NOT NULL DEFAULT 1,
            settings_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT,
            updated_at TEXT,
            PRIMARY KEY(project_id, module_id)
        );
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
        CREATE TABLE IF NOT EXISTS activity_log (
            event_id TEXT PRIMARY KEY,
            project_id TEXT,
            user_id TEXT,
            session_id TEXT,
            module_id TEXT,
            object_type TEXT,
            object_id TEXT,
            action TEXT NOT NULL,
            payload_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS object_locks (
            project_id TEXT NOT NULL,
            object_type TEXT NOT NULL,
            object_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            lock_kind TEXT NOT NULL DEFAULT 'soft',
            note TEXT NOT NULL DEFAULT '',
            acquired_at TEXT,
            expires_at TEXT,
            updated_at TEXT,
            PRIMARY KEY(project_id, object_type, object_id)
        );
        """
    )
    conn.execute("DROP TABLE IF EXISTS project_tabs")
    conn.commit()


def ensure_project_db(project_id: str) -> None:
    ensure_db()
    pid = str(project_id or "").strip()
    if not pid:
        raise ValueError("project_id je prazan")
    with _connect_project(pid) as conn:
        _init_project_schema(conn)


def _ensure_columns(conn: sqlite3.Connection, table: str, columns: dict[str, str]) -> None:
    existing = {
        str(row["name"])
        for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
    }
    for name, ddl in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


def ensure_db() -> None:
    with _connect() as conn:
        _init_schema(conn)
        for table in _GLOBAL_PROJECT_CONTENT_TABLES:
            conn.execute(f"DROP TABLE IF EXISTS {table}")
        conn.commit()


def _get_setting(key: str, default: str = "") -> str:
    ensure_db()
    with _connect() as conn:
        row = conn.execute(
            "SELECT value FROM app_settings WHERE key = ?",
            (key,),
        ).fetchone()
    return str(row["value"]) if row else default


def _set_setting(key: str, value: str) -> None:
    ensure_db()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO app_settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (key, value),
        )
        conn.commit()


def get_active_project_id() -> str:
    return _get_setting("active_project_id", "").strip()


def set_active_project_id(project_id: str) -> None:
    _set_setting("active_project_id", str(project_id).strip())


def list_projects() -> list[dict[str, Any]]:
    ensure_db()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT project_id, name, created_at FROM projects ORDER BY created_at, project_id"
        ).fetchall()
    projects = [dict(r) for r in rows]
    return projects


def upsert_project_meta(project_id: str, name: str, *, created_at: str | None = None) -> None:
    ensure_db()
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    with _connect() as conn:
        row = conn.execute(
            "SELECT created_at FROM projects WHERE project_id = ?",
            (project_id,),
        ).fetchone()
        conn.execute(
            """
            INSERT INTO projects (project_id, name, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET
                name = excluded.name,
                updated_at = excluded.updated_at
            """,
            (project_id, name, created_at or (row["created_at"] if row else now), now),
        )
        conn.commit()


def delete_project(project_id: str) -> None:
    ensure_db()
    with _connect() as conn:
        conn.execute("DELETE FROM projects WHERE project_id = ?", (project_id,))
        conn.commit()


def _migrate_legacy_json_once() -> None:
    return
