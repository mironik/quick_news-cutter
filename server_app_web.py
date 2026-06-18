"""QNC v2 web shell — /app, /app/shell, /app/components, /plugins."""

from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field
from starlette.staticfiles import StaticFiles
from typing import Any

_PROJECT_ROOT = Path(__file__).resolve().parent
_APP_SHELL = _PROJECT_ROOT / "app" / "shell"
_APP_SHARED = _PROJECT_ROOT / "app" / "shared"
_APP_COMPONENTS = _PROJECT_ROOT / "app" / "components"
_PLUGINS = _PROJECT_ROOT / "plugins"


class _NoCacheStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if path.endswith((".css", ".js", ".html", ".json")):
            response.headers["Cache-Control"] = "no-store, must-revalidate"
        return response


APP_HTML = """<!DOCTYPE html>
<html lang="hr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Quick News Cutter v2</title>
  <link rel="stylesheet" href="/app/shell/app.css?v=2"/>
  <link rel="stylesheet" href="/app/shell/qnc-shell.css?v=2"/>
  <link rel="stylesheet" href="/app/shared/qnc-theme.css?v=2"/>
  <link rel="stylesheet" href="/app/shared/qnc-components.css?v=2"/>
  <link rel="stylesheet" href="/app/shared/qnc-cards.css?v=2"/>
  <link rel="stylesheet" href="/app/shared/qnc-layout.css?v=2"/>
  <link rel="stylesheet" href="/app/shared/qnc-editorial.css?v=2"/>
</head>
<body class="qshell qshell-v2">
  <div class="qmain">
    <div class="tab-widget">
      <div id="qnc-plugin-panels" class="qtab-pane"></div>
      <nav class="qtab-footer" role="tablist" aria-label="Moduli">
        <span id="active-project-label" class="qtab-footer-project" title="Aktivni projekt">Projekt: —</span>
        <div class="qtab-footer-tabs"></div>
        <select id="qnc-server-host" class="qcombo qcombo-footer" title="QNC server" aria-label="QNC server"></select>
      </nav>
    </div>
  </div>

  <div id="log-modal" class="log-modal" hidden>
    <div class="log-modal-backdrop" data-log-close></div>
    <div class="log-modal-panel" role="dialog" aria-labelledby="log-modal-title">
      <header class="log-modal-header">
        <h3 id="log-modal-title">Process log</h3>
        <button type="button" class="qbtn" id="log-modal-close" data-log-close>Zatvori</button>
      </header>
      <div id="log-modal-body" class="shell-log log-modal-body"></div>
    </div>
  </div>

  <script src="/app/shell/qnc-core.js?v=6"></script>
  <script src="/app/shell/qnc-shell.js?v=5"></script>
  <script src="/app/shell/qnc-bus.js?v=2"></script>
  <script src="/app/shell/qnc-tab-registry.js?v=4"></script>
  <script src="/app/shell/app.js?v=8"></script>
</body>
</html>"""

_NO_CACHE = {"Cache-Control": "no-store, must-revalidate"}


class ModuleEnableRequest(BaseModel):
    enabled: bool


def register_app_routes(app) -> None:
    @app.get("/app", response_class=HTMLResponse, include_in_schema=False)
    def app_page() -> HTMLResponse:
        return HTMLResponse(APP_HTML, headers=_NO_CACHE)

    @app.get("/gui", include_in_schema=False)
    def gui_redirect() -> RedirectResponse:
        return RedirectResponse(url="/app", status_code=307)

    @app.get("/api/shell/tabs")
    def api_shell_tabs() -> dict:
        from shell.tab_loader import list_enabled_tab_manifests

        return {"status": "ok", "tabs": list_enabled_tab_manifests()}

    @app.get("/api/shell/components")
    def api_shell_components() -> dict:
        from shell.component_registry import list_global_components

        return {"status": "ok", **list_global_components()}

    @app.post("/api/shell/components/sync")
    def api_shell_components_sync() -> dict:
        from shell.component_registry import sync_all_plugins

        installed = sync_all_plugins()
        return {"status": "ok", "installed": installed}

    @app.get("/api/shell/runtime")
    def api_shell_runtime() -> dict:
        from shell.platform import get_runtime_info

        return get_runtime_info()

    @app.get("/api/modules")
    def api_modules_list() -> dict:
        from shell.module_registry import list_modules

        return {"status": "ok", "modules": list_modules()}

    @app.post("/api/modules/{module_id}/enable")
    def api_module_enable(module_id: str, body: ModuleEnableRequest) -> dict:
        from shell.component_registry import sync_plugin_manifest
        from shell.module_registry import get_module_manifest, set_module_enabled

        try:
            manifest = set_module_enabled(module_id, body.enabled)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=f"Modul '{module_id}' ne postoji.") from exc
        if body.enabled:
            sync_plugin_manifest(get_module_manifest(module_id) or manifest)
        return {"status": "ok", "module": manifest}

    app.mount("/app/shell", _NoCacheStaticFiles(directory=str(_APP_SHELL)), name="app_shell")
    app.mount("/app/shared", _NoCacheStaticFiles(directory=str(_APP_SHARED)), name="app_shared")
    app.mount("/app/components", _NoCacheStaticFiles(directory=str(_APP_COMPONENTS)), name="app_components")
    app.mount("/plugins", _NoCacheStaticFiles(directory=str(_PLUGINS)), name="plugins")
