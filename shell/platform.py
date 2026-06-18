"""Platform/runtime — jeftina detekcija pri startu, bez AI/GPU importa.

QNC je multiplatform (Windows, macOS, Linux) na bilo kojem računalu.
Jetson / NVIDIA edge / CUDA su opcionalne capability grane u pluginima, ne profil produkta.
"""

from __future__ import annotations

import json
import os
import platform
from pathlib import Path
from typing import Any

_APP_ROOT = Path(__file__).resolve().parent.parent
_DATA_DIR = _APP_ROOT / "data"
_SHELL_CONFIG = _DATA_DIR / "shell_config.json"
_SHELL_API_VERSION = 1

# Eksplicitni deployment label (env). auto → portable; nema auto-pretpostavke hardvera.
_VALID_DEPLOYMENTS = frozenset(
    {"auto", "portable", "desktop", "server", "studio", "jetson", "edge"}
)


def shell_api_version() -> int:
    return _SHELL_API_VERSION


def _hardware_hints() -> list[str]:
    """Informativno — ne mijenja deployment niti capabilities."""
    hints: list[str] = []
    if Path("/etc/nv_tegra_release").is_file():
        hints.append("nvidia_tegra")
    return hints


def resolved_deployment() -> str:
    raw = os.environ.get("QNC_DEPLOYMENT", "auto").strip().lower()
    if raw in _VALID_DEPLOYMENTS and raw != "auto":
        return raw
    return "portable"


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes")


def _api_port() -> int:
    raw = os.environ.get("QNC_API_PORT", "8001").strip()
    try:
        return int(raw)
    except ValueError:
        return 8001


def load_shell_config() -> dict[str, Any]:
    if not _SHELL_CONFIG.is_file():
        return {}
    try:
        data = json.loads(_SHELL_CONFIG.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def load_network_presets() -> list[dict[str, str]]:
    cfg = load_shell_config()
    raw = cfg.get("network_presets")
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        host = str(item.get("host") or "").strip()
        if not host:
            continue
        label = str(item.get("label") or host).strip() or host
        out.append({"label": label, "host": host})
    return out


def get_capabilities() -> dict[str, Any]:
    """Env-driven — bez nvidia-smi / torch / Jetson pretpostavki pri startu."""
    from shell.design import design_editor_capability

    return {
        "core": True,
        "ingest_local": True,
        "ingest_remote_client": _flag("QNC_INGEST_REMOTE"),
        "ai_asr": _flag("QNC_AI_ENABLED"),
        "ai_gpu_encode": _flag("QNC_HW_ENCODE"),
        "deployment": resolved_deployment(),
        "design_editor": design_editor_capability(),
    }


def get_runtime_info() -> dict[str, Any]:
    cfg = load_shell_config()
    port = _api_port()
    if isinstance(cfg.get("api_port"), int):
        port = int(cfg["api_port"])

    return {
        "status": "ok",
        "shell_api_version": _SHELL_API_VERSION,
        "app_version": os.environ.get("QNC_APP_VERSION", "v2"),
        "deployment": resolved_deployment(),
        "hardware_hints": _hardware_hints(),
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        },
        "host": {
            "hostname": platform.node(),
        },
        "api_port": port,
        "capabilities": get_capabilities(),
        "network_presets": load_network_presets(),
        "labels": {
            "server": str(cfg.get("server_label") or "QNC server"),
        },
    }
