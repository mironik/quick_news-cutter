"""Module API registry.

Disk manifest je izvor dostupnih modula. SQLite cuva samo runtime preference:
enabled/disabled i settings namespace. Poslovni podaci modula ostaju u njihovim
tab/project API ugovorima.
"""

from __future__ import annotations

import json
import sqlite3
import time
from typing import Any

from shell.runtime_db import _connect, ensure_db

from shell.tab_loader import list_tab_manifests


def _now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _module_id(raw: str) -> str:
    module_id = str(raw or "").strip()
    if not module_id:
        raise ValueError("module_id je obavezan")
    return module_id


def _state_map() -> dict[str, bool]:
    ensure_db()
    with _connect() as conn:
        rows = conn.execute("SELECT module_id, enabled FROM module_state").fetchall()
    return {str(row["module_id"]): bool(row["enabled"]) for row in rows}


def _manifest_map() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for manifest in list_tab_manifests():
        item = dict(manifest)
        for key in {str(item.get("tab_id") or ""), str(item.get("plugin_id") or "")}:
            if key:
                out[key] = item
    return out


def list_modules() -> list[dict[str, Any]]:
    from shell.design import design_default_enabled, design_editor_capability

    states = _state_map()
    cap = design_editor_capability()
    modules: list[dict[str, Any]] = []
    for manifest in list_tab_manifests():
        module_id = str(manifest.get("tab_id") or "")
        enabled = bool(manifest.get("enabled", True))
        if module_id in states:
            enabled = states[module_id]
        elif (
            module_id == "design-tools"
            and cap.get("available")
            and design_default_enabled()
        ):
            enabled = True
        module = dict(manifest)
        module["module_id"] = module_id
        module["enabled"] = enabled
        modules.append(module)
    return modules


def get_module_manifest(module_id: str) -> dict[str, Any] | None:
    module_id = _module_id(module_id)
    manifest = _manifest_map().get(module_id)
    if not manifest:
        return None
    state = _state_map()
    manifest = dict(manifest)
    manifest["module_id"] = module_id
    if module_id in state:
        manifest["enabled"] = state[module_id]
    return manifest


def set_module_enabled(module_id: str, enabled: bool) -> dict[str, Any]:
    module_id = _module_id(module_id)
    manifest = get_module_manifest(module_id)
    if not manifest:
        raise KeyError(module_id)
    if not enabled and manifest.get("removable") is False:
        raise PermissionError(f"Modul '{module_id}' je sistemski i ne moze se iskljuciti.")
    ensure_db()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO module_state (module_id, enabled, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(module_id) DO UPDATE SET
                enabled = excluded.enabled,
                updated_at = excluded.updated_at
            """,
            (module_id, 1 if enabled else 0, _now()),
        )
        conn.commit()
    updated = get_module_manifest(module_id) or manifest
    updated["enabled"] = bool(enabled)
    return updated


def get_module_settings(module_id: str) -> dict[str, Any]:
    module_id = _module_id(module_id)
    ensure_db()
    with _connect() as conn:
        row = conn.execute(
            "SELECT settings_json FROM module_settings WHERE module_id = ?",
            (module_id,),
        ).fetchone()
    if not row:
        return {}
    try:
        data = json.loads(row["settings_json"])
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def save_module_settings(module_id: str, settings: dict[str, Any]) -> dict[str, Any]:
    module_id = _module_id(module_id)
    if get_module_manifest(module_id) is None:
        raise KeyError(module_id)
    payload = dict(settings or {})
    ensure_db()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO module_settings (module_id, settings_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(module_id) DO UPDATE SET
                settings_json = excluded.settings_json,
                updated_at = excluded.updated_at
            """,
            (module_id, json.dumps(payload, ensure_ascii=False), _now()),
        )
        conn.commit()
    return payload


def module_db_health() -> dict[str, Any]:
    from shell.runtime_db import module_db_health as _health

    return _health()
