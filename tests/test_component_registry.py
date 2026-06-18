"""Tests for QNC v2 global component registry."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_bootstrap_filmstrip_in_registry(tmp_path, monkeypatch):
    import shell.component_registry as reg

    components = tmp_path / "app" / "components"
    components.mkdir(parents=True)
    filmstrip = components / "filmstrip-viewer"
    shutil.copytree(ROOT / "app" / "components" / "filmstrip-viewer", filmstrip)

    registry = components / "registry.json"
    monkeypatch.setattr(reg, "_COMPONENTS_ROOT", components)
    monkeypatch.setattr(reg, "_REGISTRY_PATH", registry)

    reg.bootstrap_builtin_components()
    data = json.loads(registry.read_text(encoding="utf-8"))
    assert "filmstrip-viewer" in data["components"]
    assert data["components"]["filmstrip-viewer"]["path"].startswith("/app/components/")


def test_portable_install_skips_older_version(tmp_path, monkeypatch):
    import shell.component_registry as reg

    components = tmp_path / "app" / "components"
    pkg = tmp_path / "pkg"
    pkg.mkdir()
    (pkg / "component.json").write_text(
        json.dumps({"version": "1.0.0", "component_id": "demo"}),
        encoding="utf-8",
    )
    (pkg / "component.html").write_text("<section data-qnc-panel='demo'></section>", encoding="utf-8")

    monkeypatch.setattr(reg, "_COMPONENTS_ROOT", components)
    monkeypatch.setattr(reg, "_REGISTRY_PATH", components / "registry.json")

    reg.install_portable_component(
        global_id="demo",
        source_plugin_id="test",
        package_dir=pkg,
        version="2.0.0",
    )
    reg.install_portable_component(
        global_id="demo",
        source_plugin_id="test",
        package_dir=pkg,
        version="1.5.0",
    )
    data = reg.load_registry()
    assert data["components"]["demo"]["version"] == "2.0.0"
