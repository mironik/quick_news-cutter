"""Project and source templates for QNC.

Templates are recipes. Project settings are the frozen copy used by a real
project. System templates are read-only and can be duplicated into user
templates.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any

from .collaboration import log_activity
from .project_db import _connect, ensure_db
from .project_store import _slug_id, _export_projects_json


def _now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _json(data: Any, fallback: Any) -> str:
    return json.dumps(data if data is not None else fallback, ensure_ascii=False)


def _load_json(raw: Any, fallback: Any) -> Any:
    try:
        data = json.loads(str(raw or ""))
    except json.JSONDecodeError:
        return fallback
    return data if isinstance(data, type(fallback)) else fallback


def _safe_id(prefix: str, name: str) -> str:
    base = re.sub(r"[^\w\-]+", "_", str(name or "").strip().lower())[:48].strip("_")
    return f"{prefix}_{base or 'template'}_{int(time.time())}"


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = dict(base or {})
    for key, value in dict(override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(dict(out[key]), value)
        else:
            out[key] = value
    return out


def _source_row(row: Any) -> dict[str, Any]:
    item = dict(row)
    item["system"] = bool(item.get("system"))
    item["config"] = _load_json(item.pop("config_json", "{}"), {})
    return item


def _template_row(row: Any) -> dict[str, Any]:
    item = dict(row)
    item["system"] = bool(item.get("system"))
    item["settings"] = _load_json(item.pop("settings_json", "{}"), {})
    item["source_template_ids"] = _load_json(item.pop("source_template_ids_json", "[]"), [])
    return item


SYSTEM_SOURCE_TEMPLATES: tuple[dict[str, Any], ...] = (
    {
        "source_template_id": "src_card_fx6_private",
        "name": "Card reader incoming",
        "description": "Kartica se čita/kopira u lokalni QNC incoming folder na serveru.",
        "source_kind": "card_reader",
        "config": {
            "source_id": "local_incoming",
            "incoming_folder": "incoming/card",
            "proxy_policy": "copy_to_project",
        },
    },
    {
        "source_template_id": "src_camera_ftp",
        "name": "Kamera / FTP incoming",
        "description": "Kamera salje proxy i original u lokalni incoming folder.",
        "source_kind": "ftp",
        "config": {
            "source_id": "camera_ftp",
            "incoming_folder": "incoming/ftp",
            "proxy_policy": "copy_to_project",
            "expects": ["proxy", "original"],
        },
    },
    {
        "source_template_id": "src_local_incoming",
        "name": "Lokalni incoming folder",
        "description": "Materijal je već kopiran na server u incoming folder.",
        "source_kind": "local",
        "config": {
            "source_id": "local_incoming",
            "incoming_folder": "incoming",
            "proxy_policy": "copy_to_project",
        },
    },
)


SYSTEM_PROJECT_TEMPLATES: tuple[dict[str, Any], ...] = (
    {
        "template_id": "tpl_breaking_news",
        "name": "Breaking news",
        "description": "Najbrzi start: proxy ingest, story-first rad i brzi export.",
        "source_template_ids": ["src_card_fx6_private", "src_camera_ftp"],
        "settings": {
            "workflow": "news_fast",
            "video": {
                "format": "HD 1080p",
                "width": 1920,
                "height": 1080,
                "fps": 50,
                "field_order": "progressive",
                "color_space": "rec709",
                "timeline_codec": "proxy_h264",
            },
            "storage": {
                "proxy_policy": "copy_to_project",
                "original_policy": "link_when_available",
            },
            "export": {
                "default_mode": "proxy_fast",
                "container": "mp4",
                "video_codec": "h264",
                "xml_enabled": True,
            },
            "audio": {
                "sample_rate": 48000,
                "channels": 2,
                "transcribe_channel": "CH1",
                "atmosphere_channel": "CH2",
            },
            "ai": {
                "enabled": False,
                "coverage_suggestions": True,
            },
            "workspace": {
                "tabs": ["project", "ingest_proxy", "pool", "off", "storyboard", "preview"],
                "tab_labels": {
                    "ingest_proxy": "Ingest Proxy",
                    "pool": "Media",
                    "off": "OFF",
                    "storyboard": "Story",
                    "preview": "Export",
                },
            },
        },
    },
    {
        "template_id": "tpl_news_package",
        "name": "News package",
        "description": "Uravnotezen workflow za izjave, OFF i pokrivanje.",
        "source_template_ids": ["src_card_fx6_private", "src_local_incoming"],
        "settings": {
            "workflow": "news_package",
            "video": {
                "format": "HD 1080i50",
                "width": 1920,
                "height": 1080,
                "fps": 25,
                "field_order": "upper_first",
                "color_space": "rec709",
                "timeline_codec": "xdcam_hd_422",
            },
            "storage": {
                "proxy_policy": "copy_to_project",
                "original_policy": "link_when_available",
            },
            "export": {
                "default_mode": "xml_master",
                "container": "mxf_op1a",
                "video_codec": "mpeg2_422_50mbit",
                "xml_enabled": True,
            },
            "audio": {
                "sample_rate": 48000,
                "channels": 2,
                "transcribe_channel": "CH1",
                "atmosphere_channel": "CH2",
            },
            "ai": {
                "enabled": False,
                "coverage_suggestions": True,
            },
            "workspace": {
                "tabs": [
                    "project",
                    "ingest_proxy",
                    "ingest",
                    "pool",
                    "search",
                    "library",
                    "off",
                    "storyboard",
                    "audio",
                    "preview",
                ],
                "tab_labels": {
                    "ingest_proxy": "Ingest Proxy",
                    "pool": "Media",
                    "library": "Kadrovi",
                    "off": "OFF",
                    "storyboard": "Story",
                    "preview": "Export",
                },
            },
        },
    },
)


def ensure_templates_seeded() -> None:
    ensure_db()
    now = _now()
    with _connect() as conn:
        for src in SYSTEM_SOURCE_TEMPLATES:
            config_json = _json(src["config"], {})
            conn.execute(
                """
                INSERT INTO source_templates
                    (source_template_id, name, description, source_kind, system,
                     config_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, 1, ?, ?, ?)
                ON CONFLICT(source_template_id) DO NOTHING
                """,
                (
                    src["source_template_id"],
                    src["name"],
                    src["description"],
                    src["source_kind"],
                    config_json,
                    now,
                    now,
                ),
            )
            row = conn.execute(
                """
                SELECT config_json FROM source_templates
                WHERE source_template_id = ? AND system = 1
                """,
                (src["source_template_id"],),
            ).fetchone()
            existing = _load_json(row["config_json"], {}) if row else {}
            if src["source_template_id"] == "src_card_fx6_private" and existing.get("source_id") == "fx6_private":
                conn.execute(
                    """
                    UPDATE source_templates
                    SET name = ?, description = ?, source_kind = ?, config_json = ?, updated_at = ?
                    WHERE source_template_id = ? AND system = 1
                    """,
                    (
                        src["name"],
                        src["description"],
                        src["source_kind"],
                        config_json,
                        now,
                        src["source_template_id"],
                    ),
                )
        for tpl in SYSTEM_PROJECT_TEMPLATES:
            settings_json = _json(tpl["settings"], {})
            source_ids_json = _json(tpl["source_template_ids"], [])
            conn.execute(
                """
                INSERT INTO project_templates
                    (template_id, name, description, system, settings_json,
                     source_template_ids_json, created_at, updated_at)
                VALUES (?, ?, ?, 1, ?, ?, ?, ?)
                ON CONFLICT(template_id) DO NOTHING
                """,
                (
                    tpl["template_id"],
                    tpl["name"],
                    tpl["description"],
                    settings_json,
                    source_ids_json,
                    now,
                    now,
                ),
            )
            row = conn.execute(
                "SELECT settings_json FROM project_templates WHERE template_id = ? AND system = 1",
                (tpl["template_id"],),
            ).fetchone()
            existing = _load_json(row["settings_json"], {}) if row else {}
            needs_update = False
            if isinstance(existing, dict) and "workspace" not in existing:
                existing["workspace"] = dict(tpl["settings"].get("workspace") or {})
                needs_update = True
            elif isinstance(existing, dict) and isinstance(existing.get("workspace"), dict):
                for section in ("video", "audio", "export", "storage", "ai"):
                    default_section = tpl["settings"].get(section)
                    if isinstance(default_section, dict):
                        current_section = existing.get(section)
                        if not isinstance(current_section, dict):
                            existing[section] = dict(default_section)
                            needs_update = True
                        else:
                            for key, value in default_section.items():
                                if key not in current_section:
                                    current_section[key] = value
                                    needs_update = True
                tabs = existing["workspace"].get("tabs")
                if tpl["template_id"] in {"tpl_breaking_news", "tpl_news_package"} and isinstance(tabs, list):
                    if "ingest_proxy" not in tabs:
                        existing["workspace"]["tabs"] = [
                            "ingest_proxy" if tab == "ingest" else tab for tab in tabs
                        ]
                        if tpl["template_id"] == "tpl_news_package" and "ingest" not in existing["workspace"]["tabs"]:
                            try:
                                idx = existing["workspace"]["tabs"].index("ingest_proxy")
                                existing["workspace"]["tabs"].insert(idx + 1, "ingest")
                            except ValueError:
                                existing["workspace"]["tabs"].insert(1, "ingest")
                        labels = existing["workspace"].setdefault("tab_labels", {})
                        if isinstance(labels, dict):
                            labels.setdefault("ingest_proxy", "Ingest Proxy")
                        needs_update = True
                    if tpl["template_id"] == "tpl_breaking_news" and "pool" not in existing["workspace"]["tabs"]:
                        try:
                            idx = existing["workspace"]["tabs"].index("ingest_proxy")
                            existing["workspace"]["tabs"].insert(idx + 1, "pool")
                        except ValueError:
                            existing["workspace"]["tabs"].insert(1, "pool")
                        labels = existing["workspace"].setdefault("tab_labels", {})
                        if isinstance(labels, dict):
                            labels.setdefault("pool", "Media")
                        needs_update = True
            if needs_update:
                conn.execute(
                    """
                    UPDATE project_templates
                    SET settings_json = ?, updated_at = ?
                    WHERE template_id = ? AND system = 1
                    """,
                    (_json(existing, {}), now, tpl["template_id"]),
                )
        conn.commit()


def template_db_health() -> dict[str, Any]:
    ensure_templates_seeded()
    expected = {"source_templates", "project_templates"}
    with _connect() as conn:
        tables = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        counts = {
            "source_templates": conn.execute("SELECT COUNT(*) AS c FROM source_templates").fetchone()["c"],
            "project_templates": conn.execute("SELECT COUNT(*) AS c FROM project_templates").fetchone()["c"],
        }
    return {
        "status": "ok",
        "tables": {name: name in tables for name in sorted(expected)},
        "counts": counts,
    }


def list_source_templates() -> list[dict[str, Any]]:
    ensure_templates_seeded()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM source_templates ORDER BY system DESC, name"
        ).fetchall()
    return [_source_row(row) for row in rows]


def list_project_templates() -> list[dict[str, Any]]:
    ensure_templates_seeded()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM project_templates ORDER BY system DESC, name"
        ).fetchall()
    return [_template_row(row) for row in rows]


def get_project_template(template_id: str) -> dict[str, Any] | None:
    ensure_templates_seeded()
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM project_templates WHERE template_id = ?",
            (str(template_id or "").strip(),),
        ).fetchone()
    return _template_row(row) if row else None


def get_project_settings(project_id: str) -> dict[str, Any]:
    ensure_templates_seeded()
    from .project_db import _connect_project, ensure_project_db

    pid = str(project_id or "").strip()
    ensure_project_db(pid)
    with _connect_project(pid) as conn:
        row = conn.execute(
            "SELECT * FROM project_settings WHERE project_id = ?",
            (pid,),
        ).fetchone()
    if not row:
        return {}
    item = dict(row)
    item["settings"] = _load_json(item.pop("settings_json", "{}"), {})
    return item


def _workspace_from_settings(settings: dict[str, Any]) -> dict[str, Any]:
    workspace = settings.get("workspace") if isinstance(settings, dict) else {}
    return workspace if isinstance(workspace, dict) else {}


def get_project_workspace(project_id: str) -> dict[str, Any]:
    from .project_modules import list_project_modules

    modules = list_project_modules(project_id)
    if modules:
        tabs = [m["module_id"] for m in modules]
        labels = {m["module_id"]: m["label"] for m in modules if m.get("label")}
        item = get_project_settings(project_id)
        return {
            "project_id": project_id,
            "template_id": item.get("template_id", "") if item else "",
            "tabs": tabs,
            "tab_labels": labels,
            "modules": modules,
        }
    item = get_project_settings(project_id)
    settings = item.get("settings") if isinstance(item, dict) else {}
    workspace = _workspace_from_settings(settings if isinstance(settings, dict) else {})
    tabs = workspace.get("tabs") if isinstance(workspace, dict) else []
    if not isinstance(tabs, list):
        tabs = []
    labels = workspace.get("tab_labels") if isinstance(workspace, dict) else {}
    return {
        "project_id": project_id,
        "template_id": item.get("template_id", "") if item else "",
        "tabs": [str(tab) for tab in tabs if str(tab or "").strip()],
        "tab_labels": labels if isinstance(labels, dict) else {},
        "modules": [],
    }


def save_project_settings(
    project_id: str,
    settings: dict[str, Any],
    *,
    template_id: str = "",
    user_id: str = "",
) -> dict[str, Any]:
    ensure_templates_seeded()
    now = _now()
    pid = str(project_id or "").strip()
    if not pid:
        raise ValueError("project_id je obavezan")
    payload = dict(settings or {})
    from .project_db import _connect_project, ensure_project_db

    ensure_project_db(pid)
    with _connect_project(pid) as conn:
        existing = conn.execute(
            "SELECT created_at, created_by FROM project_settings WHERE project_id = ?",
            (pid,),
        ).fetchone()
        conn.execute(
            """
            INSERT INTO project_settings
                (project_id, template_id, settings_json, created_by, updated_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET
                template_id = excluded.template_id,
                settings_json = excluded.settings_json,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at
            """,
            (
                pid,
                template_id,
                _json(payload, {}),
                user_id or (existing["created_by"] if existing else ""),
                user_id,
                existing["created_at"] if existing else now,
                now,
            ),
        )
        conn.commit()
    return get_project_settings(pid)


def create_user_template(
    *,
    name: str,
    description: str = "",
    settings: dict[str, Any] | None = None,
    source_template_ids: list[str] | None = None,
    user_id: str = "",
    base_template_id: str = "",
) -> dict[str, Any]:
    ensure_templates_seeded()
    base = get_project_template(base_template_id) if base_template_id else None
    if settings is not None and base:
        payload = _deep_merge(dict(base.get("settings") or {}), settings)
    else:
        payload = dict(settings if settings is not None else (base or {}).get("settings") or {})
    source_ids = list(source_template_ids if source_template_ids is not None else (base or {}).get("source_template_ids") or [])
    now = _now()
    template_id = _safe_id("tpl_user", name)
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO project_templates
                (template_id, name, description, system, settings_json,
                 source_template_ids_json, created_by, updated_by, created_at, updated_at)
            VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(template_id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                settings_json = excluded.settings_json,
                source_template_ids_json = excluded.source_template_ids_json,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at
            """,
            (
                template_id,
                str(name or "Custom template").strip(),
                str(description or "").strip(),
                _json(payload, {}),
                _json(source_ids, []),
                user_id,
                user_id,
                now,
                now,
            ),
        )
        conn.commit()
    return get_project_template(template_id) or {}


def delete_project_template(template_id: str, admin_password: str = "") -> bool:
    ensure_templates_seeded()
    template = get_project_template(template_id)
    if not template:
        raise KeyError(template_id)
    if template.get("system"):
        expected = os.environ.get("QNC_ADMIN_PASSWORD", "")
        if not expected or admin_password != expected:
            raise PermissionError("Sistemski template zahtijeva administratorsku lozinku.")
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM project_templates WHERE template_id = ?",
            (template_id,),
        )
        conn.commit()
    return cur.rowcount > 0


def create_project_from_template(
    *,
    name: str,
    template_id: str,
    settings_override: dict[str, Any] | None = None,
    user_id: str = "",
    session_id: str = "",
) -> dict[str, Any]:
    from .project_db import set_active_project_id as db_set

    template = get_project_template(template_id)
    if not template:
        raise KeyError(template_id)
    label = str(name or "").strip() or "QNC projekt"
    project_id = _slug_id(label)
    from .project_db import upsert_project_meta
    from .project_state import ensure_project_dirs

    ensure_project_dirs(project_id)
    upsert_project_meta(project_id, label)
    settings = _deep_merge(dict(template.get("settings") or {}), settings_override or {})
    settings["template"] = {
        "template_id": template["template_id"],
        "name": template["name"],
        "system": bool(template.get("system")),
    }
    settings["source_template_ids"] = list(template.get("source_template_ids") or [])
    save_project_settings(project_id, settings, template_id=template["template_id"], user_id=user_id)
    workspace = _workspace_from_settings(settings)
    from .project_modules import set_project_modules

    set_project_modules(
        project_id,
        [str(tab) for tab in (workspace.get("tabs") or [])],
        labels=workspace.get("tab_labels") if isinstance(workspace.get("tab_labels"), dict) else {},
    )

    now = _now()
    with _connect() as conn:
        conn.execute(
            """
            UPDATE projects
            SET created_by = COALESCE(NULLIF(created_by, ''), ?),
                updated_by = ?,
                updated_at = ?
            WHERE project_id = ?
            """,
            (user_id, user_id, now, project_id),
        )
        conn.commit()
    if user_id:
        from .project_db import _connect_project, ensure_project_db

        ensure_project_db(project_id)
        with _connect_project(project_id) as conn:
            conn.execute(
                """
                INSERT INTO project_members (project_id, user_id, role, joined_at, last_seen_at)
                VALUES (?, ?, 'owner', ?, ?)
                ON CONFLICT(project_id, user_id) DO UPDATE SET
                    role = excluded.role,
                    last_seen_at = excluded.last_seen_at
                """,
                (project_id, user_id, now, now),
            )
            conn.commit()
    db_set(project_id)
    _export_projects_json()
    if user_id or session_id:
        log_activity(
            action="project_created_from_template",
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
            module_id="project",
            object_type="project",
            object_id=project_id,
            payload={"template_id": template["template_id"], "template_name": template["name"]},
        )
    return {
        "project": {
            "project_id": project_id,
            "name": label,
            "created_at": now,
            "template_id": template["template_id"],
        },
        "settings": get_project_settings(project_id),
    }
