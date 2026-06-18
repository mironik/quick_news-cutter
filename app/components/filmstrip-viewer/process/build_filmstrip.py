"""Filmstrip component process.

This process belongs to the reusable media_pool.filmstrip-viewer component.
The host plugin may queue it, but thumbnail extraction is component-owned so
another plugin can reuse the same filmstrip contract.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


def run(
    project_id: str,
    clip_id: str,
    *,
    media_path: str | None = None,
    frames: int = 10,
) -> dict[str, Any]:
    from server_storage.filmstrip_store import (
        filmstrip_clip_dir,
        get_filmstrip,
        mark_filmstrip,
        save_filmstrip,
    )
    from server_storage.thumbnails import (
        THUMB_HEIGHT,
        THUMB_WIDTH,
        duration_for_clip,
        extract_thumbnail_jpeg,
        resolve_clip_media_path,
        timeline_seek_seconds,
    )

    existing = get_filmstrip(project_id, clip_id)
    if existing and existing.get("status") == "ready":
        paths = [Path(str(p)) for p in (existing.get("paths") or [])]
        if paths and all(p.is_file() for p in paths):
            return existing

    media = Path(media_path) if media_path else resolve_clip_media_path(clip_id, project_id)
    if not media or not media.is_file():
        mark_filmstrip(project_id, clip_id, "error", error=f"No media for clip '{clip_id}'")
        raise FileNotFoundError(f"No media for clip '{clip_id}'")

    mark_filmstrip(project_id, clip_id, "building")
    duration = duration_for_clip(clip_id, media, project_id)
    seeks = timeline_seek_seconds(duration, frames=frames)
    out_dir = filmstrip_clip_dir(project_id, clip_id)
    paths: list[str] = []
    errors: list[str] = []
    for index, sec in enumerate(seeks):
        out = out_dir / f"{index:03d}_{str(sec).replace('.', '_')}.jpg"
        if not out.is_file() or out.stat().st_size <= 0:
            try:
                data = extract_thumbnail_jpeg(
                    media,
                    seek_sec=sec,
                    width=THUMB_WIDTH,
                    height=THUMB_HEIGHT,
                )
                out.write_bytes(data)
            except Exception as exc:
                errors.append(f"{sec}s: {exc}")
                continue
        paths.append(str(out))

    return save_filmstrip(
        project_id,
        clip_id,
        duration_sec=duration,
        seeks=seeks,
        paths=paths,
        error="; ".join(errors),
    )
