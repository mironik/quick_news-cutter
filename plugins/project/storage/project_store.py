"""Projekti — lista i aktivni projekt (SQLite, project_db)."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

_APP_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_DATA_DIR = _APP_ROOT / "data"
_PROJECTS_FILE = _DATA_DIR / "projects.json"


def _slug_id(name: str) -> str:
    base = re.sub(r"[^\w\-]+", "_", name.strip().lower())[:40].strip("_")
    if not base:
        base = "projekt"
    return f"{base}_{int(time.time())}"


def _export_projects_json() -> None:
    """Zrcalni export liste projekata (backup)."""
    from .project_db import get_active_project_id, list_projects

    data = {
        "active_project_id": get_active_project_id(),
        "projects": list_projects(),
    }
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    _PROJECTS_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def get_active_project_id() -> str:
    from .project_db import ensure_db, get_active_project_id as db_active

    ensure_db()
    return db_active()


def set_active_project_id(project_id: str) -> None:
    from .project_db import set_active_project_id as db_set

    db_set(project_id)
    _export_projects_json()


def list_projects() -> list[dict[str, Any]]:
    from .project_db import ensure_db, list_projects as db_list

    ensure_db()
    return db_list()


def create_project(name: str | None = None) -> dict[str, Any]:
    from .project_db import set_active_project_id as db_set
    from .project_db import upsert_project_meta
    from .project_state import ensure_project_dirs

    label = (name or "").strip() or f"Projekt {len(list_projects()) + 1}"
    entry = {
        "project_id": _slug_id(label),
        "name": label,
        "created_at": time.strftime("%Y-%m-%d %H:%M"),
    }
    ensure_project_dirs(entry["project_id"])
    upsert_project_meta(entry["project_id"], label, created_at=entry["created_at"])
    db_set(entry["project_id"])
    _export_projects_json()
    return entry


def delete_projects(project_ids: list[str]) -> list[str]:
    from .project_db import set_active_project_id as db_set, upsert_project_meta
    from .project_state import ensure_project_dirs
    from .project_state import delete_project_workflow

    remove = {str(x).strip() for x in project_ids if x and str(x).strip()}
    if not remove:
        return []
    before = list_projects()
    after = [p for p in before if p.get("project_id") not in remove]
    for pid in remove:
        delete_project_workflow(pid)
    active = get_active_project_id()
    if active in remove:
        active = after[0]["project_id"] if after else ""
    db_set(active)
    _export_projects_json()
    return sorted(remove)


def open_project(project_id: str) -> dict[str, Any] | None:
    pid = str(project_id).strip()
    for p in list_projects():
        if p.get("project_id") == pid:
            set_active_project_id(pid)
            entry = dict(p)
            return entry
    return None
