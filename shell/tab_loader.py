"""Ucitaj manifest datoteke samostalnih plugin tab aplikacija."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_PLUGINS_ROOT = _PROJECT_ROOT / "plugins"


def _read_manifest(path: Path, default_id: str) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    data.setdefault("plugin_id", default_id)
    data.setdefault("tab_id", data.get("plugin_id") or default_id)
    data.setdefault("enabled", True)
    return data


def list_tab_manifests() -> list[dict[str, Any]]:
    manifests: list[dict[str, Any]] = []
    if _PLUGINS_ROOT.is_dir():
        for path in sorted(_PLUGINS_ROOT.glob("*/plugin.json")):
            data = _read_manifest(path, path.parent.name)
            if data:
                manifests.append(data)

    def sort_key(item: dict[str, Any]) -> tuple[int, int, str]:
        tab_id = str(item.get("tab_id") or "")
        position = str(item.get("position") or "normal")
        if position == "first" or tab_id == "project":
            bucket = -1
        elif position == "last" or tab_id in {"preview", "export"}:
            bucket = 1
        else:
            bucket = 0
        try:
            priority = int(item.get("priority") or 0)
        except (TypeError, ValueError):
            priority = 0
        return bucket, priority, str(item.get("label") or tab_id)

    return sorted(manifests, key=sort_key)


def list_enabled_tab_manifests() -> list[dict[str, Any]]:
    """Tab manifesti s primijenjenim enabled overrideom iz Module API-ja."""
    try:
        from shell.design import design_editor_capability
        from shell.module_registry import list_modules

        cap = design_editor_capability()
        modules = [m for m in list_modules() if m.get("enabled", True)]
        out: list[dict[str, Any]] = []
        for manifest in modules:
            required = str(manifest.get("requires_capability") or "").strip()
            if required == "design_editor" and not cap.get("available"):
                continue
            out.append(manifest)
        return out
    except Exception:
        return [m for m in list_tab_manifests() if m.get("enabled", True)]
