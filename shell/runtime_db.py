"""Shell runtime SQLite — module enable/settings (bez project podataka)."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_DB_PATH = _DATA_DIR / "shell_runtime.db"


def _connect() -> sqlite3.Connection:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_db() -> None:
    with _connect() as conn:
        conn.executescript(
            """
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
            """
        )
        conn.commit()


def module_db_health() -> dict[str, Any]:
    ensure_db()
    with _connect() as conn:
        tables = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
    return {
        "status": "ok",
        "db_path": str(_DB_PATH),
        "module_state": "module_state" in tables,
        "module_settings": "module_settings" in tables,
    }
