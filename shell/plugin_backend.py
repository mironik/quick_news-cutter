"""Registracija backend ruta iz plugins/*/backend/routes.py."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from fastapi import FastAPI

_PLUGINS_ROOT = Path(__file__).resolve().parent.parent / "plugins"


def register_plugin_backends(app: FastAPI) -> list[str]:
    registered: list[str] = []
    if not _PLUGINS_ROOT.is_dir():
        return registered

    for plugin_dir in sorted(_PLUGINS_ROOT.iterdir()):
        if not plugin_dir.is_dir():
            continue
        routes_path = plugin_dir / "backend" / "routes.py"
        if not routes_path.is_file():
            continue

        plugin_root = str(plugin_dir.resolve())
        if plugin_root not in sys.path:
            sys.path.insert(0, plugin_root)

        module_name = f"qnc_plugin_backend_{plugin_dir.name}"
        spec = importlib.util.spec_from_file_location(module_name, routes_path)
        if spec is None or spec.loader is None:
            continue
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        register = getattr(module, "register", None)
        if callable(register):
            register(app)
            registered.append(plugin_dir.name)
    return registered
