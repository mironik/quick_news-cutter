"""Design add-on — capability, tokeni i override pohrana."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from shell.platform import load_shell_config

_APP_ROOT = Path(__file__).resolve().parent.parent
_TOKENS_PATH = _APP_ROOT / "plugins" / "design-tools" / "design" / "tokens.json"
_OVERRIDES_DIR = _APP_ROOT / "data" / "design_overrides"
_TOKEN_OVERRIDES_PATH = _OVERRIDES_DIR / "tokens.json"
_THEMES_DIR = _OVERRIDES_DIR / "themes"
_ACTIVE_THEME_PATH = _OVERRIDES_DIR / "active_theme.json"
_DEFAULT_THEME_ID = "default"

_VALID_MODES = frozenset({"open", "password", "off"})


def design_mode() -> str:
    env = os.environ.get("QNC_DESIGN_MODE", "").strip().lower()
    if env in _VALID_MODES:
        return env
    cfg = load_shell_config()
    block = cfg.get("design_editor")
    if isinstance(block, dict):
        mode = str(block.get("mode") or "").strip().lower()
        if mode in _VALID_MODES:
            return mode
    return "open"


def design_default_enabled() -> bool:
    cfg = load_shell_config()
    block = cfg.get("design_editor")
    if isinstance(block, dict) and "default_enabled" in block:
        return bool(block.get("default_enabled"))
    return design_mode() == "open"


def design_editor_capability() -> dict[str, Any]:
    mode = design_mode()
    available = mode != "off"
    return {
        "available": available,
        "mode": mode,
        "authenticated": available and mode == "open",
        "default_enabled": design_default_enabled(),
    }


def _read_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_base_tokens() -> dict[str, Any]:
    return _read_json(_TOKENS_PATH)


def _slug_theme_id(label: str) -> str:
    import re

    slug = re.sub(r"[^a-z0-9]+", "-", label.strip().lower()).strip("-")
    return slug or "tema"


def active_theme_id() -> str:
    data = _read_json(_ACTIVE_THEME_PATH)
    theme_id = str(data.get("theme_id") or _DEFAULT_THEME_ID).strip()
    return theme_id or _DEFAULT_THEME_ID


def _theme_path(theme_id: str) -> Path:
    return _THEMES_DIR / f"{theme_id}.json"


def _load_theme_doc(theme_id: str) -> dict[str, Any]:
    if theme_id == _DEFAULT_THEME_ID:
        return {
            "id": _DEFAULT_THEME_ID,
            "label": load_base_tokens().get("label", "QNC Default"),
            "built_in": True,
            "tokens": load_token_overrides(),
        }
    return _read_json(_theme_path(theme_id))


def list_themes() -> dict[str, Any]:
    base = load_base_tokens()
    themes: list[dict[str, Any]] = [
        {
            "id": _DEFAULT_THEME_ID,
            "label": str(base.get("label") or "QNC Default"),
            "built_in": True,
        }
    ]
    if _THEMES_DIR.is_dir():
        for path in sorted(_THEMES_DIR.glob("*.json")):
            doc = _read_json(path)
            theme_id = str(doc.get("id") or path.stem).strip()
            if not theme_id or theme_id == _DEFAULT_THEME_ID:
                continue
            themes.append(
                {
                    "id": theme_id,
                    "label": str(doc.get("label") or theme_id),
                    "built_in": False,
                }
            )
    active = active_theme_id()
    return {"status": "ok", "active_id": active, "themes": themes}


def load_token_overrides() -> dict[str, str]:
    data = _read_json(_TOKEN_OVERRIDES_PATH)
    tokens = data.get("tokens")
    if not isinstance(tokens, dict):
        return {}
    return {str(k): str(v) for k, v in tokens.items() if str(k).startswith("--")}


def _theme_override_tokens(theme_id: str) -> dict[str, str]:
    if theme_id == _DEFAULT_THEME_ID:
        return load_token_overrides()
    doc = _load_theme_doc(theme_id)
    raw = doc.get("tokens")
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items() if str(k).startswith("--")}


def merged_tokens() -> dict[str, Any]:
    base = load_base_tokens()
    theme_id = active_theme_id()
    overrides = _theme_override_tokens(theme_id)
    tokens = dict(base.get("tokens") or {})
    tokens.update(overrides)
    theme_doc = _load_theme_doc(theme_id)
    label = str(theme_doc.get("label") or base.get("label") or "QNC Default")
    return {
        "status": "ok",
        "version": base.get("version", 1),
        "label": label,
        "theme_id": theme_id,
        "tokens": tokens,
        "overrides": overrides,
    }


def save_token_overrides(tokens: dict[str, str], theme_id: str | None = None) -> dict[str, str]:
    clean = {str(k): str(v) for k, v in tokens.items() if str(k).startswith("--")}
    target = (theme_id or active_theme_id()).strip() or _DEFAULT_THEME_ID
    if target == _DEFAULT_THEME_ID:
        _write_json(_TOKEN_OVERRIDES_PATH, {"version": 1, "tokens": clean})
        return clean
    path = _theme_path(target)
    if not path.is_file():
        raise ValueError(f"Tema '{target}' ne postoji.")
    doc = _read_json(path)
    _write_json(
        _theme_path(target),
        {
            "version": 1,
            "id": target,
            "label": str(doc.get("label") or target),
            "tokens": clean,
        },
    )
    return clean


def create_theme(label: str) -> dict[str, Any]:
    clean_label = label.strip()
    if not clean_label:
        raise ValueError("Naziv teme je obavezan.")
    theme_id = _slug_theme_id(clean_label)
    suffix = 2
    while _theme_path(theme_id).is_file():
        theme_id = f"{_slug_theme_id(clean_label)}-{suffix}"
        suffix += 1
    snapshot = merged_tokens().get("tokens") or {}
    base = load_base_tokens().get("tokens") or {}
    overrides = {
        str(k): str(v)
        for k, v in snapshot.items()
        if str(k).startswith("--") and str(v) != str(base.get(k, ""))
    }
    _THEMES_DIR.mkdir(parents=True, exist_ok=True)
    _write_json(
        _theme_path(theme_id),
        {"version": 1, "id": theme_id, "label": clean_label, "tokens": overrides},
    )
    activate_theme(theme_id)
    return {"status": "ok", "id": theme_id, "label": clean_label, "active_id": theme_id}


def activate_theme(theme_id: str) -> dict[str, Any]:
    target = theme_id.strip() or _DEFAULT_THEME_ID
    if target != _DEFAULT_THEME_ID and not _theme_path(target).is_file():
        raise ValueError(f"Tema '{target}' ne postoji.")
    _write_json(_ACTIVE_THEME_PATH, {"theme_id": target})
    return {"status": "ok", "active_id": target}


def design_status() -> dict[str, Any]:
    cap = design_editor_capability()
    return {
        "status": "ok",
        **cap,
        "paths": {
            "tokens": "/plugins/design-tools/design/tokens.json",
            "overrides": "/data/design_overrides/tokens.json",
        },
    }
