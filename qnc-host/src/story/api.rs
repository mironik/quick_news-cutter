use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde_json::Value;

use crate::app_state::AppState;

use super::db::{
    create_marker, create_part, delete_marker, delete_part, load_state, move_marker, reorder_part,
    select_marker_slot, select_part, update_part,
};

#[derive(serde::Deserialize)]
struct ProjectQuery {
    #[serde(default)]
    project_id: String,
}

#[derive(serde::Deserialize)]
struct CreatePartBody {
    #[serde(default)]
    project_id: String,
    #[serde(default)]
    kind: String,
}

#[derive(serde::Deserialize)]
struct PartIdBody {
    #[serde(default)]
    project_id: String,
    #[serde(default)]
    part_id: String,
}

#[derive(serde::Deserialize)]
struct UpdatePartBody {
    #[serde(default)]
    project_id: String,
    #[serde(default)]
    part_id: String,
    title: Option<String>,
    text: Option<String>,
    kind: Option<String>,
}

#[derive(serde::Deserialize)]
struct ReorderPartBody {
    #[serde(default)]
    project_id: String,
    #[serde(default)]
    part_id: String,
    #[serde(default)]
    direction: String,
}

#[derive(serde::Deserialize)]
struct CreateMarkerBody {
    #[serde(default)]
    project_id: String,
    #[serde(default)]
    after_part_id: String,
    label: Option<String>,
}

#[derive(serde::Deserialize)]
struct MarkerIdBody {
    #[serde(default)]
    project_id: String,
    #[serde(default)]
    marker_id: String,
}

#[derive(serde::Deserialize)]
struct MoveMarkerBody {
    #[serde(default)]
    project_id: String,
    #[serde(default)]
    marker_id: String,
    #[serde(default)]
    direction: String,
}

#[derive(serde::Deserialize)]
struct SlotIdBody {
    #[serde(default)]
    project_id: String,
    #[serde(default)]
    slot_id: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/story/state", get(api_state))
        .route("/api/story/part/create", post(api_part_create))
        .route("/api/story/part/update", post(api_part_update))
        .route("/api/story/part/delete", post(api_part_delete))
        .route("/api/story/part/reorder", post(api_part_reorder))
        .route("/api/story/part/select", post(api_part_select))
        .route("/api/story/marker/create", post(api_marker_create))
        .route("/api/story/marker/delete", post(api_marker_delete))
        .route("/api/story/marker/move", post(api_marker_move))
        .route(
            "/api/story/marker_slot/select",
            post(api_marker_slot_select),
        )
}

async fn api_state(
    State(app): State<AppState>,
    Query(q): Query<ProjectQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pid = resolve_project_id(&app, &q.project_id)?;
    let state = load_state(&app.project.paths, &pid).map_err(map_store_err)?;
    Ok(Json(state))
}

async fn api_part_create(
    State(app): State<AppState>,
    Json(body): Json<CreatePartBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pid = resolve_project_id(&app, &body.project_id)?;
    let state = create_part(&app.project.paths, &pid, &body.kind).map_err(map_bad_request)?;
    Ok(Json(state))
}

async fn api_part_update(
    State(app): State<AppState>,
    Json(body): Json<UpdatePartBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pid = resolve_project_id(&app, &body.project_id)?;
    let title = body.title.as_deref();
    let text = body.text.as_deref();
    let kind = body.kind.as_deref();
    let state = update_part(&app.project.paths, &pid, &body.part_id, title, text, kind)
        .map_err(map_bad_request)?;
    Ok(Json(state))
}

async fn api_part_delete(
    State(app): State<AppState>,
    Json(body): Json<PartIdBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pid = resolve_project_id(&app, &body.project_id)?;
    let state = delete_part(&app.project.paths, &pid, &body.part_id).map_err(map_bad_request)?;
    Ok(Json(state))
}

async fn api_part_reorder(
    State(app): State<AppState>,
    Json(body): Json<ReorderPartBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pid = resolve_project_id(&app, &body.project_id)?;
    let state = reorder_part(&app.project.paths, &pid, &body.part_id, &body.direction)
        .map_err(map_bad_request)?;
    Ok(Json(state))
}

async fn api_part_select(
    State(app): State<AppState>,
    Json(body): Json<PartIdBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pid = resolve_project_id(&app, &body.project_id)?;
    let state = select_part(&app.project.paths, &pid, &body.part_id).map_err(map_bad_request)?;
    Ok(Json(state))
}

async fn api_marker_create(
    State(app): State<AppState>,
    Json(body): Json<CreateMarkerBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pid = resolve_project_id(&app, &body.project_id)?;
    let label = body.label.as_deref();
    let state = create_marker(&app.project.paths, &pid, &body.after_part_id, label)
        .map_err(map_bad_request)?;
    Ok(Json(state))
}

async fn api_marker_delete(
    State(app): State<AppState>,
    Json(body): Json<MarkerIdBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pid = resolve_project_id(&app, &body.project_id)?;
    let state =
        delete_marker(&app.project.paths, &pid, &body.marker_id).map_err(map_bad_request)?;
    Ok(Json(state))
}

async fn api_marker_move(
    State(app): State<AppState>,
    Json(body): Json<MoveMarkerBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pid = resolve_project_id(&app, &body.project_id)?;
    let state = move_marker(&app.project.paths, &pid, &body.marker_id, &body.direction)
        .map_err(map_bad_request)?;
    Ok(Json(state))
}

async fn api_marker_slot_select(
    State(app): State<AppState>,
    Json(body): Json<SlotIdBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pid = resolve_project_id(&app, &body.project_id)?;
    let state =
        select_marker_slot(&app.project.paths, &pid, &body.slot_id).map_err(map_bad_request)?;
    Ok(Json(state))
}

fn resolve_project_id(app: &AppState, project_id: &str) -> Result<String, (StatusCode, String)> {
    if !project_id.trim().is_empty() {
        return Ok(project_id.trim().to_string());
    }
    app.project.active_project_id()
}

fn map_store_err(e: String) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e)
}

fn map_bad_request(e: String) -> (StatusCode, String) {
    if e.contains("not found")
        || e.contains("invalid")
        || e.contains("required")
        || e.contains("already exists")
    {
        (StatusCode::BAD_REQUEST, e)
    } else {
        (StatusCode::INTERNAL_SERVER_ERROR, e)
    }
}
