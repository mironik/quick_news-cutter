"""Projektni direktoriji i tanki wrapperi prema plugin-owned storageu."""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_DATA_DIR = _REPO_ROOT / "data"
_LEGACY_PROJECTS_ROOT = _DATA_DIR / "projects"
_OS = __import__("os")


def _default_projects_root() -> Path:
    if _OS.name == "nt":
        base = _OS.environ.get("LOCALAPPDATA") or _OS.environ.get("APPDATA")
        if base:
            return Path(base) / "QNC" / "Projects"
    if __import__("sys").platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "QNC" / "Projects"
    return Path(_OS.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "qnc" / "projects"


_PROJECTS_ROOT = Path(
    _OS.environ.get("QNC_PROJECTS_ROOT")
    or _OS.environ.get("QNC_PROJEKTI_ROOT")
    or _default_projects_root()
)
_LAYOUT_MIGRATED = False


def _safe_dir_name(project_id: str) -> str:
    pid = re.sub(r"[^\w\-]+", "_", (project_id or "").strip())[:80]
    return pid or "_invalid_project_id"


def _migrate_layout_once() -> None:
    """Premjesti data/projects/* → Projekti/* (jednokratno)."""
    global _LAYOUT_MIGRATED
    if _LAYOUT_MIGRATED:
        return
    _LAYOUT_MIGRATED = True
    _PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
    if not _LEGACY_PROJECTS_ROOT.is_dir():
        return
    for child in _LEGACY_PROJECTS_ROOT.iterdir():
        if not child.is_dir():
            continue
        dest = _PROJECTS_ROOT / child.name
        if dest.exists():
            continue
        shutil.move(str(child), str(dest))


def project_dir(project_id: str) -> Path:
    _migrate_layout_once()
    return _PROJECTS_ROOT / _safe_dir_name(project_id)


def proxy_dir(project_id: str) -> Path:
    return project_dir(project_id) / "proxy"


def incoming_dir(project_id: str) -> Path:
    return project_dir(project_id) / "incoming"


def incoming_card_dir(project_id: str) -> Path:
    return incoming_dir(project_id) / "card"


def incoming_ftp_dir(project_id: str) -> Path:
    return incoming_dir(project_id) / "ftp"


def ingest_proxy_dir(project_id: str) -> Path:
    return project_dir(project_id) / "ingest_proxy"


def ingest_proxy_thumbnails_dir(project_id: str) -> Path:
    return ingest_proxy_dir(project_id) / "thumbnails"


def media_pool_dir(project_id: str) -> Path:
    return project_dir(project_id) / "media_pool"


def filmstrip_dir(project_id: str) -> Path:
    """Dijeljeni projektni filmstrip (JPG + filmstrip.db) — više plugina čita."""
    return project_dir(project_id) / "filmstrip"


def media_pool_filmstrip_dir(project_id: str) -> Path:
    """Deprecated alias — koristi filmstrip_dir()."""
    return filmstrip_dir(project_id)


def transcripts_dir(project_id: str) -> Path:
    return project_dir(project_id) / "transcripts"


def ensure_project_dirs(project_id: str) -> None:
    """Kreiraj projektni root, proxy i incoming mape za ingest."""
    for d in (
        project_dir(project_id),
        proxy_dir(project_id),
        incoming_card_dir(project_id),
        incoming_ftp_dir(project_id),
    ):
        d.mkdir(parents=True, exist_ok=True)


def delete_project_workflow(project_id: str) -> None:
    from .project_db import delete_project

    pid_dir = _safe_dir_name(project_id)
    leftovers: list[Path] = []
    for root in (_PROJECTS_ROOT, _LEGACY_PROJECTS_ROOT):
        base = root.resolve()
        target = (base / pid_dir).resolve()
        try:
            target.relative_to(base)
        except ValueError:
            continue
        if target.is_dir():
            shutil.rmtree(target)
        if target.exists():
            leftovers.append(target)
    if leftovers:
        paths = ", ".join(str(p) for p in leftovers)
        raise RuntimeError(f"Projekt nije potpuno obrisan: {paths}")
    delete_project(project_id)


def save_ingest_state(
    project_id: str,
    *,
    clips: list[dict[str, Any]] | None = None,
    windows_path: str | None = None,
    source_id: str | None = None,
    selected_clip_ids: list[str] | None = None,
    discovered: bool | None = None,
) -> dict[str, Any]:
    """Stub — ingest tab još nije u v2."""
    out: dict[str, Any] = {"project_id": project_id}
    if windows_path:
        out["windows_path"] = windows_path
    if source_id:
        out["source_id"] = source_id
    if discovered is not None:
        out["discovered"] = discovered
    return out


def update_ingest_clip_fields(
    project_id: str,
    clip_id: str,
    fields: dict[str, Any],
) -> dict[str, Any] | None:
    """Legacy compatibility: module clip fields are not stored in project DB."""
    return None


def save_media_pool_state(project_id: str, clip_ids: list[str]) -> dict[str, Any]:
    """Stub — media_pool tab još nije u v2."""
    return {"project_id": project_id, "clip_ids": list(clip_ids)}


def save_storyboard_state(project_id: str, edl: list[dict[str, Any]]) -> dict[str, Any]:
    """Stub — storyboard tab još nije u v2."""
    return {"project_id": project_id, "edl": list(edl)}


def save_search_state(
    project_id: str,
    *,
    last_query: str | None = None,
    last_hits: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Stub — search tab još nije u v2."""
    out: dict[str, Any] = {"project_id": project_id}
    if last_query is not None:
        out["last_query"] = last_query
    if last_hits is not None:
        out["last_hits"] = last_hits
    return out


def _project_proxy_path(project_id: str, clip_id: str) -> Path:
    safe = re.sub(r"[^\w\-]+", "_", clip_id)
    return proxy_dir(project_id) / f"{safe}.mp4"


def reconcile_project_assets(project_id: str) -> None:
    """Legacy compatibility hook; module assets are reconciled by their plugins."""
    return
