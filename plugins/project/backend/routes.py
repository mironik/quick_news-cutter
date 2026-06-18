"""Project tab API — registrira se iz shell-a pri startu."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


class ProjectCreateRequest(BaseModel):
    name: str | None = None


class ProjectDeleteRequest(BaseModel):
    project_ids: list[str]


class ProjectOpenRequest(BaseModel):
    project_id: str


class ProjectTemplateCreateRequest(BaseModel):
    name: str
    description: str = ""
    settings: dict[str, Any] = Field(default_factory=dict)
    source_template_ids: list[str] = Field(default_factory=list)
    user_id: str = ""
    base_template_id: str = ""


class ProjectTemplateDeleteRequest(BaseModel):
    admin_password: str = ""


class ProjectFromTemplateRequest(BaseModel):
    name: str
    template_id: str
    settings_override: dict[str, Any] = Field(default_factory=dict)
    user_id: str = ""
    session_id: str = ""


class ProjectSettingsSaveRequest(BaseModel):
    project_id: str = ""
    settings: dict[str, Any] = Field(default_factory=dict)
    template_id: str = ""
    user_id: str = ""


def register(app: FastAPI) -> None:
    @app.get("/api/projects")
    def api_projects_list() -> dict[str, Any]:
        from storage.project_store import get_active_project_id, list_projects

        return {
            "status": "ok",
            "active_project_id": get_active_project_id(),
            "projects": list_projects(),
        }

    @app.post("/api/projects")
    def api_projects_create(body: ProjectCreateRequest) -> dict[str, Any]:
        from storage.project_store import create_project, get_active_project_id

        entry = create_project(body.name)
        return {
            "status": "ok",
            "project": entry,
            "active_project_id": get_active_project_id(),
        }

    @app.get("/api/project-templates")
    def api_project_templates_list() -> dict[str, Any]:
        from storage.project_templates import list_project_templates, list_source_templates

        return {
            "status": "ok",
            "templates": list_project_templates(),
            "source_templates": list_source_templates(),
        }

    @app.get("/api/project-templates/{template_id}")
    def api_project_template_get(template_id: str) -> dict[str, Any]:
        from storage.project_templates import get_project_template

        template = get_project_template(template_id)
        if not template:
            raise HTTPException(status_code=404, detail=f"Template '{template_id}' ne postoji.")
        return {"status": "ok", "template": template}

    @app.post("/api/project-templates")
    def api_project_template_create(body: ProjectTemplateCreateRequest) -> dict[str, Any]:
        from storage.project_templates import create_user_template

        template = create_user_template(
            name=body.name,
            description=body.description,
            settings=body.settings,
            source_template_ids=body.source_template_ids,
            user_id=body.user_id,
            base_template_id=body.base_template_id,
        )
        return {"status": "ok", "template": template}

    @app.post("/api/projects/from-template")
    def api_projects_create_from_template(body: ProjectFromTemplateRequest) -> dict[str, Any]:
        from storage.project_store import get_active_project_id
        from storage.project_templates import create_project_from_template

        try:
            result = create_project_from_template(
                name=body.name,
                template_id=body.template_id,
                settings_override=body.settings_override,
                user_id=body.user_id,
                session_id=body.session_id,
            )
        except KeyError:
            raise HTTPException(status_code=404, detail=f"Template '{body.template_id}' ne postoji.")
        return {
            "status": "ok",
            "project": result["project"],
            "settings": result["settings"],
            "active_project_id": get_active_project_id(),
        }

    @app.get("/api/projects/{project_id}/settings")
    def api_project_settings_get(project_id: str) -> dict[str, Any]:
        from storage.project_templates import get_project_settings

        return {"status": "ok", "project_id": project_id, "settings": get_project_settings(project_id)}

    @app.get("/api/projects/{project_id}/workspace")
    def api_project_workspace_get(project_id: str) -> dict[str, Any]:
        from storage.project_templates import get_project_workspace

        return {"status": "ok", "workspace": get_project_workspace(project_id)}

    @app.post("/api/projects/{project_id}/settings")
    def api_project_settings_save(project_id: str, body: ProjectSettingsSaveRequest) -> dict[str, Any]:
        from storage.project_templates import save_project_settings

        pid = (body.project_id or project_id).strip() or project_id
        try:
            settings = save_project_settings(
                pid,
                body.settings,
                template_id=body.template_id,
                user_id=body.user_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return {"status": "ok", "project_id": pid, "settings": settings}

    @app.post("/api/projects/open")
    def api_projects_open(body: ProjectOpenRequest) -> dict[str, Any]:
        from storage.project_store import get_active_project_id, open_project

        proj = open_project(body.project_id)
        if not proj:
            raise HTTPException(status_code=404, detail=f"Projekt '{body.project_id}' ne postoji.")
        workflow = proj.pop("workflow", None)
        return {
            "status": "ok",
            "project": proj,
            "workflow": workflow,
            "active_project_id": get_active_project_id(),
        }

    @app.post("/api/projects/delete")
    def api_projects_delete(body: ProjectDeleteRequest) -> dict[str, Any]:
        from storage.project_store import delete_projects, get_active_project_id, list_projects

        if not body.project_ids:
            raise HTTPException(status_code=422, detail="project_ids je prazan.")
        removed = delete_projects(body.project_ids)
        return {
            "status": "ok",
            "removed": removed,
            "active_project_id": get_active_project_id(),
            "projects": list_projects(),
        }
