"""Design add-on — capability i token API (dev Python server)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from server import app

    with TestClient(app) as test_client:
        yield test_client


def test_runtime_exposes_design_editor_open(client):
    data = client.get("/api/shell/runtime").json()
    design = data["capabilities"]["design_editor"]
    assert design["available"] is True
    assert design["mode"] == "open"
    assert design["authenticated"] is True


def test_design_status(client):
    data = client.get("/api/design-tools/status").json()
    assert data["status"] == "ok"
    assert data["mode"] == "open"


def test_design_tokens_include_qnc_bg(client):
    data = client.get("/api/design-tools/tokens").json()
    assert data["status"] == "ok"
    assert "--qnc-bg" in data["tokens"]


def test_design_tools_tab_when_enabled(client):
    tabs = client.get("/api/shell/tabs").json()["tabs"]
    tab_ids = [t["tab_id"] for t in tabs]
    assert "design-tools" in tab_ids


def test_design_themes_list_and_create(client):
    listed = client.get("/api/design-tools/themes").json()
    assert listed["status"] == "ok"
    assert any(t["id"] == "default" for t in listed["themes"])
    created = client.post("/api/design-tools/themes", json={"label": "Test Studio"}).json()
    assert created["status"] == "ok"
    assert created["id"]
    listed2 = client.get("/api/design-tools/themes").json()
    ids = [t["id"] for t in listed2["themes"]]
    assert created["id"] in ids


def test_save_token_overrides_open_mode(client, tmp_path, monkeypatch):
    import shell.design as design

    overrides = tmp_path / "design_overrides"
    overrides.mkdir(parents=True)
    monkeypatch.setattr(design, "_OVERRIDES_DIR", overrides)
    monkeypatch.setattr(design, "_TOKEN_OVERRIDES_PATH", overrides / "tokens.json")
    monkeypatch.setattr(design, "_THEMES_DIR", overrides / "themes")
    monkeypatch.setattr(design, "_ACTIVE_THEME_PATH", overrides / "active_theme.json")
    monkeypatch.setattr(design, "design_mode", lambda: "open")

    res = client.post(
        "/api/design-tools/overrides/tokens",
        json={"tokens": {"--qnc-bg": "#111111"}},
    )
    assert res.status_code == 200
    merged = client.get("/api/design-tools/tokens").json()
    assert merged["tokens"]["--qnc-bg"] == "#111111"
