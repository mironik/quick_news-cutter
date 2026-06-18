"""Shell Spec v1 compliance (korak 2)."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def client():
    from server import app

    with TestClient(app) as test_client:
        yield test_client


def test_runtime_exposes_shell_api_version(client):
    data = client.get("/api/shell/runtime").json()
    assert data["status"] == "ok"
    assert data["shell_api_version"] == 1


def test_server_py_has_no_plugin_business_routes():
    source = (ROOT / "server.py").read_text(encoding="utf-8")
    assert "/api/projects" not in source
    assert "project_store" not in source


def test_app_html_has_no_plugin_modals():
    from server_app_web import APP_HTML

    assert "project-new-modal" not in APP_HTML
    assert "project-new-name" not in APP_HTML


def test_shell_plugin_tab_in_component_registry(client):
    data = client.get("/api/shell/components").json()
    components = data.get("components") or {}
    assert "shell-plugin-tab" in components
    entry = components["shell-plugin-tab"]
    assert entry.get("path", "").endswith("/shell-plugin-tab/component.html")
    slots = entry.get("contract", {}).get("slots") or []
    assert "content" in slots


def test_disable_module_hides_design_tools_tab(client, tmp_path, monkeypatch):
    import shell.module_registry as mr
    import shell.runtime_db as rdb

    monkeypatch.setattr(rdb, "_DATA_DIR", tmp_path)
    monkeypatch.setattr(rdb, "_DB_PATH", tmp_path / "shell_runtime.db")
    monkeypatch.setattr(mr, "_connect", rdb._connect)
    monkeypatch.setattr(mr, "ensure_db", rdb.ensure_db)

    disable = client.post("/api/modules/design-tools/enable", json={"enabled": False})
    assert disable.status_code == 200
    assert disable.json()["module"]["enabled"] is False

    tabs = client.get("/api/shell/tabs").json()["tabs"]
    assert "design-tools" not in [t["tab_id"] for t in tabs]

    enable = client.post("/api/modules/design-tools/enable", json={"enabled": True})
    assert enable.status_code == 200
    tabs_after = client.get("/api/shell/tabs").json()["tabs"]
    assert "design-tools" in [t["tab_id"] for t in tabs_after]


def test_project_module_cannot_be_disabled(client):
    res = client.post("/api/modules/project/enable", json={"enabled": False})
    assert res.status_code == 403
