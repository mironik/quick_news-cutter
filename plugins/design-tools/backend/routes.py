"""Design add-on API — dev referenca (Jetson). Produkcija: qnc-host /api/design-tools."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, Field


class TokenOverridesBody(BaseModel):
    tokens: dict[str, str] = Field(default_factory=dict)


class CreateThemeBody(BaseModel):
    label: str = ""


def register(app) -> None:
    @app.get("/api/design-tools/status")
    def api_design_status() -> dict[str, Any]:
        from shell.design import design_status

        return design_status()

    @app.get("/api/design-tools/tokens")
    def api_design_tokens() -> dict[str, Any]:
        from shell.design import merged_tokens

        return merged_tokens()

    @app.get("/api/design-tools/themes")
    def api_design_themes() -> dict[str, Any]:
        from shell.design import list_themes

        return list_themes()

    @app.post("/api/design-tools/themes")
    def api_design_create_theme(body: CreateThemeBody) -> dict[str, Any]:
        from shell.design import create_theme, design_mode

        if design_mode() == "off":
            raise HTTPException(status_code=403, detail="Design editor je isključen.")
        try:
            return create_theme(body.label)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/design-tools/themes/{theme_id}/activate")
    def api_design_activate_theme(theme_id: str) -> dict[str, Any]:
        from shell.design import activate_theme, design_mode

        if design_mode() == "off":
            raise HTTPException(status_code=403, detail="Design editor je isključen.")
        try:
            return activate_theme(theme_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/design-tools/overrides/tokens")
    def api_design_save_tokens(body: TokenOverridesBody) -> dict[str, Any]:
        from shell.design import design_mode, save_token_overrides

        mode = design_mode()
        if mode == "off":
            raise HTTPException(status_code=403, detail="Design editor je isključen.")
        if mode == "password":
            raise HTTPException(
                status_code=403,
                detail="Spremanje zahtijeva admin autentifikaciju (još nije implementirano).",
            )
        try:
            saved = save_token_overrides(body.tokens)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"status": "ok", "tokens": saved}
