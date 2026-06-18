"""Project module activation state."""

from __future__ import annotations

import json
import time
from typing import Any

from .project_db import _connect_project, ensure_project_db


def _now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def set_project_modules(
    project_id: str,
    modules: list[str],
    *,
    labels: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    ensure_project_db(project_id)
    now = _now()
    clean = []
    seen = set()
    for module_id in ["project", *modules]:
        mid = str(module_id or "").strip()
        if not mid or mid in seen:
            continue
        seen.add(mid)
        clean.append(mid)
    labels = labels or {}
    with _connect_project(project_id) as conn:
        conn.execute("DELETE FROM project_modules WHERE project_id = ?", (project_id,))
        for index, module_id in enumerate(clean):
            conn.execute(
                """
                INSERT INTO project_modules
                    (project_id, module_id, position, label, enabled, settings_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, 1, '{}', ?, ?)
                """,
                (project_id, module_id, index, str(labels.get(module_id) or ""), now, now),
            )
        conn.commit()
    return list_project_modules(project_id)


def list_project_modules(project_id: str) -> list[dict[str, Any]]:
    ensure_project_db(project_id)
    with _connect_project(project_id) as conn:
        rows = conn.execute(
            """
            SELECT * FROM project_modules
            WHERE project_id = ? AND enabled = 1
            ORDER BY position, module_id
            """,
            (project_id,),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        try:
            item["settings"] = json.loads(item.pop("settings_json") or "{}")
        except json.JSONDecodeError:
            item["settings"] = {}
        item["enabled"] = bool(item.get("enabled"))
        out.append(item)
    return out
