"""Globalni registry prenosivih QNC komponenti.

Plugin pri instalaciji/enable može ponuditi portable komponentu.
Ako ista global_id već postoji u components/ s istom ili novijom verzijom,
postojeća instalacija se NE prepisuje (v1 app ostaje netaknut).
"""

from __future__ import annotations

import json
import shutil
import time
from pathlib import Path
from typing import Any

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_COMPONENTS_ROOT = _PROJECT_ROOT / "app" / "components"
_REGISTRY_PATH = _COMPONENTS_ROOT / "registry.json"


def _now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


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


def load_registry() -> dict[str, Any]:
    reg = _read_json(_REGISTRY_PATH)
    reg.setdefault("version", 1)
    reg.setdefault("components", {})
    return reg


def save_registry(reg: dict[str, Any]) -> None:
    _write_json(_REGISTRY_PATH, reg)


def _parse_version(value: Any) -> tuple[int, ...]:
    text = str(value or "0").strip()
    parts: list[int] = []
    for chunk in text.replace("-", ".").split("."):
        chunk = chunk.strip()
        if not chunk:
            continue
        digits = "".join(ch for ch in chunk if ch.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts) if parts else (0,)


def _component_package_path(plugin_root: Path, component: dict[str, Any]) -> Path | None:
    package = str(component.get("package") or "").strip()
    if package.startswith("/"):
        return (_PROJECT_ROOT / package.lstrip("/")).resolve()
    if package:
        return (plugin_root / package).resolve()
    path = str(component.get("path") or "").strip()
    if path.startswith("/app/components/"):
        return (_PROJECT_ROOT / path.lstrip("/")).parent.resolve()
    if path.startswith("/plugins/"):
        return (_PROJECT_ROOT / path.lstrip("/")).parent.resolve()
    return None


def _load_component_manifest(package_dir: Path) -> dict[str, Any]:
    manifest_path = package_dir / "component.json"
    if not manifest_path.is_file():
        return {}
    data = _read_json(manifest_path)
    return data if isinstance(data, dict) else {}


def _should_install(existing: dict[str, Any] | None, incoming_version: str) -> bool:
    if not existing:
        return True
    cur = _parse_version(existing.get("version"))
    new = _parse_version(incoming_version)
    return new > cur


def install_portable_component(
    *,
    global_id: str,
    source_plugin_id: str,
    package_dir: Path,
    version: str,
    manifest: dict[str, Any] | None = None,
) -> dict[str, Any]:
    global_id = str(global_id or "").strip()
    if not global_id:
        raise ValueError("global_id je obavezan")
    if not package_dir.is_dir():
        raise FileNotFoundError(f"Component package ne postoji: {package_dir}")

    reg = load_registry()
    components = reg.setdefault("components", {})
    existing = components.get(global_id)
    incoming_version = str(version or (manifest or {}).get("version") or "1")
    if not _should_install(existing, incoming_version):
        return dict(existing or {})

    target = _COMPONENTS_ROOT / global_id
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(
        package_dir,
        target,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".pytest_cache"),
    )

    manifest = manifest or _load_component_manifest(package_dir)
    entry = {
        "global_id": global_id,
        "component_id": manifest.get("component_id") or global_id,
        "version": incoming_version,
        "source_plugin_id": source_plugin_id,
        "installed_at": _now(),
        "path": f"/app/components/{global_id}/component.html",
        "package": f"/app/components/{global_id}",
        "assets": manifest.get("assets") or {},
        "variants": manifest.get("variants") or {},
        "contract": manifest.get("contract") or {},
        "description": manifest.get("description") or "",
    }
    components[global_id] = entry
    save_registry(reg)
    return entry


def sync_plugin_manifest(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    plugin_id = str(manifest.get("plugin_id") or "").strip()
    plugin_root = _PROJECT_ROOT / "plugins" / plugin_id
    installed: list[dict[str, Any]] = []

    for component in manifest.get("components") or []:
        if not isinstance(component, dict):
            continue
        if not component.get("portable"):
            continue
        global_id = str(component.get("global_id") or "").strip()
        if not global_id:
            global_id = str(component.get("component_id") or "").split(".")[-1]
        package_dir = _component_package_path(plugin_root, component)
        if not package_dir or not package_dir.is_dir():
            continue
        version = str(component.get("version") or "1")
        manifest_path = package_dir / "component.json"
        comp_manifest = _read_json(manifest_path) if manifest_path.is_file() else component
        try:
            entry = install_portable_component(
                global_id=global_id,
                source_plugin_id=plugin_id,
                package_dir=package_dir,
                version=version,
                manifest=comp_manifest,
            )
            installed.append(entry)
        except FileNotFoundError:
            continue
    return installed


def sync_all_plugins() -> list[dict[str, Any]]:
    from shell.tab_loader import list_tab_manifests

    installed: list[dict[str, Any]] = []
    for manifest in list_tab_manifests():
        if not manifest.get("enabled", True):
            continue
        installed.extend(sync_plugin_manifest(manifest))
    return installed


def list_global_components() -> dict[str, Any]:
    reg = load_registry()
    components = reg.get("components") or {}
    enriched: dict[str, Any] = {}
    for global_id, meta in components.items():
        item = dict(meta)
        base = f"/app/components/{global_id}"
        item["path"] = item.get("path") or f"{base}/component.html"
        assets = dict(item.get("assets") or {})
        css = assets.get("css") or []
        js = assets.get("js") or []
        item["assets"] = {
            "css": [p if p.startswith("/") else f"{base}/{p.lstrip('/')}" for p in css],
            "js": [p if p.startswith("/") else f"{base}/{p.lstrip('/')}" for p in js],
        }
        variants = dict(item.get("variants") or {})
        item["variants"] = {
            key: (val if str(val).startswith("/") else f"{base}/{Path(str(val)).name}")
            for key, val in variants.items()
        }
        enriched[global_id] = item
    return {"version": reg.get("version", 1), "components": enriched}


def register_component_in_place(
    *,
    global_id: str,
    source_plugin_id: str,
    package_dir: Path,
    version: str,
    manifest: dict[str, Any] | None = None,
) -> dict[str, Any]:
    global_id = str(global_id or "").strip()
    manifest = manifest or _load_component_manifest(package_dir)
    reg = load_registry()
    components = reg.setdefault("components", {})
    entry = {
        "global_id": global_id,
        "component_id": manifest.get("component_id") or global_id,
        "version": str(version or manifest.get("version") or "1"),
        "source_plugin_id": source_plugin_id,
        "installed_at": _now(),
        "path": f"/app/components/{global_id}/component.html",
        "package": f"/app/components/{global_id}",
        "assets": manifest.get("assets") or {},
        "variants": manifest.get("variants") or {},
        "contract": manifest.get("contract") or {},
        "description": manifest.get("description") or "",
    }
    components[global_id] = entry
    save_registry(reg)
    return entry


def bootstrap_builtin_components() -> None:
    """Registriraj ugrađene komponente koje već žive u components/."""
    package = _COMPONENTS_ROOT / "filmstrip-viewer"
    if not package.is_dir():
        return
    reg = load_registry()
    if reg.get("components", {}).get("filmstrip-viewer"):
        return
    manifest = _load_component_manifest(package)
    register_component_in_place(
        global_id="filmstrip-viewer",
        source_plugin_id="core",
        package_dir=package,
        version=str(manifest.get("version") or "1"),
        manifest=manifest,
    )
