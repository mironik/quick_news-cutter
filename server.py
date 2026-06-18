"""QNC v2 — minimalni shell API server (bez tab-specifičnog koda)."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from server_app_web import register_app_routes
from shell.plugin_backend import register_plugin_backends


@asynccontextmanager
async def _app_lifespan(_app: FastAPI):
    from shell.component_registry import bootstrap_builtin_components, sync_all_plugins

    bootstrap_builtin_components()
    sync_all_plugins()
    yield


app = FastAPI(
    title="Quick News Cutter v2",
    version="2.0.0",
    description="Component-first QNC shell — tabovi se učitavaju iz plugins/.",
    lifespan=_app_lifespan,
)

register_app_routes(app)
register_plugin_backends(app)


@app.get("/api/health")
def api_health() -> dict[str, str]:
    return {"status": "ok"}
