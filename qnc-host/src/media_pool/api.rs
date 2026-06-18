use axum::{
    extract::{Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};

use crate::app_state::AppState;
use crate::filmstrip::{frame_path_for_index, frame_path_for_seek, get_filmstrip};
use crate::ingest::thumb::extract_poster_jpeg_at_seek;
use crate::media_pool::db::{add_virtual_shot, list_virtual_shots};
use crate::media_pool::ingest_db::proxy_path_for_clip;
use crate::media_pool::store::{list_clips_enriched, mark_filmstrip_building};

#[derive(serde::Deserialize)]
struct ProjectQuery {
    #[serde(default)]
    project_id: String,
}

#[derive(serde::Deserialize)]
struct ClipMediaQuery {
    #[serde(default)]
    project_id: String,
    clip_id: String,
}

#[derive(serde::Deserialize)]
struct ThumbQuery {
    #[serde(default)]
    project_id: String,
    clip_id: String,
    #[serde(default)]
    seek: f64,
    #[serde(default)]
    frame_index: i64,
    #[serde(default)]
    w: u32,
}

#[derive(serde::Deserialize)]
struct TimelineBuildBody {
    #[serde(default)]
    project_id: String,
    clip_id: String,
    #[serde(default = "default_frames")]
    frames: u32,
    #[serde(default)]
    media_path: String,
}

fn default_frames() -> u32 {
    10
}

#[derive(serde::Deserialize)]
struct VirtualShotBody {
    #[serde(default)]
    project_id: String,
    clip_id: String,
    in_seconds: f64,
    out_seconds: f64,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/media-pool/clips", get(api_clips))
        .route("/api/media-pool/media", get(api_media))
        .route("/api/media-pool/thumbnail", get(api_thumbnail))
        .route("/api/media-pool/timeline/build", post(api_timeline_build))
        .route("/api/media-pool/virtual-shot", post(api_virtual_shot))
}

async fn api_clips(
    State(app): State<AppState>,
    Query(q): Query<ProjectQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pid = resolve_project_id(&app, &q.project_id)?;
    let data = list_clips_enriched(&app.project.paths, &pid).map_err(internal)?;
    let virtual_shots = list_virtual_shots(&app.project.paths, &pid).map_err(internal)?;
    Ok(Json(json!({
        "project_id": pid,
        "clips": data.get("clips").cloned().unwrap_or(json!([])),
        "summary": data.get("summary").cloned().unwrap_or(json!({})),
        "virtual_shots": virtual_shots,
    })))
}

async fn api_media(
    State(app): State<AppState>,
    Query(q): Query<ClipMediaQuery>,
) -> Result<Response, (StatusCode, String)> {
    let pid = resolve_project_id(&app, &q.project_id)?;
    let clip_id = q.clip_id.trim();
    if clip_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "clip_id je prazan".into()));
    }
    let path = proxy_path_for_clip(&app.project.paths, &pid, clip_id)
        .filter(|p| p.is_file())
        .ok_or((StatusCode::NOT_FOUND, format!("nema medija za '{clip_id}'")))?;
    serve_file(path).await
}

async fn api_thumbnail(
    State(app): State<AppState>,
    Query(q): Query<ThumbQuery>,
) -> Result<Response, (StatusCode, String)> {
    let pid = resolve_project_id(&app, &q.project_id)?;
    let clip_id = q.clip_id.trim();
    if clip_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "clip_id je prazan".into()));
    }
    let seek = if q.seek > 0.0 { q.seek } else { 0.5 };
    if q.frame_index >= 0 {
        if let Some(path) = frame_path_for_index(&app.project.paths, &pid, clip_id, q.frame_index) {
            return serve_file(path).await;
        }
    }
    if let Some(path) = frame_path_for_seek(&app.project.paths, &pid, clip_id, seek) {
        return serve_file(path).await;
    }
    let proxy = proxy_path_for_clip(&app.project.paths, &pid, clip_id)
        .filter(|p| p.is_file())
        .ok_or((StatusCode::NOT_FOUND, "filmstrip nije spreman".into()))?;
    let tmp = std::env::temp_dir().join(format!(
        "qnc_pool_thumb_{}_{}.jpg",
        clip_id.replace(|c: char| !c.is_ascii_alphanumeric(), "_"),
        (seek * 1000.0) as i64
    ));
    extract_poster_jpeg_at_seek(&proxy, &tmp, seek).map_err(internal)?;
    serve_file(tmp).await
}

async fn api_timeline_build(
    State(app): State<AppState>,
    Json(body): Json<TimelineBuildBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pid = resolve_project_id(&app, &body.project_id)?;
    let clip_id = body.clip_id.trim();
    if clip_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "clip_id je prazan".into()));
    }
    if let Some(existing) = get_filmstrip(&app.project.paths, &pid, clip_id) {
        let st = existing
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if st == "ready" {
            return Ok(Json(json!({
                "status": "ready",
                "clip_id": clip_id,
                "filmstrip": existing,
            })));
        }
        if st == "building" {
            let media = if body.media_path.trim().is_empty() {
                proxy_path_for_clip(&app.project.paths, &pid, clip_id)
            } else {
                Some(std::path::PathBuf::from(body.media_path.trim()))
            }
            .filter(|p| p.is_file());
            if let Some(path) = media {
                app.filmstrip.enqueue(&pid, clip_id, &path);
            }
            return Ok(Json(json!({
                "status": "building",
                "clip_id": clip_id,
            })));
        }
    }
    let media = if body.media_path.trim().is_empty() {
        proxy_path_for_clip(&app.project.paths, &pid, clip_id)
    } else {
        Some(std::path::PathBuf::from(body.media_path.trim()))
    }
    .filter(|p| p.is_file())
    .ok_or((StatusCode::NOT_FOUND, format!("nema medija za '{clip_id}'")))?;
    mark_filmstrip_building(&app.project.paths, &pid, clip_id).map_err(internal)?;
    app.filmstrip.enqueue(&pid, clip_id, &media);
    Ok(Json(json!({
        "status": "queued",
        "clip_id": clip_id,
    })))
}

async fn api_virtual_shot(
    State(app): State<AppState>,
    Json(body): Json<VirtualShotBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pid = resolve_project_id(&app, &body.project_id)?;
    let shot = add_virtual_shot(
        &app.project.paths,
        &pid,
        body.clip_id.trim(),
        body.in_seconds,
        body.out_seconds,
    )
    .map_err(|e| {
        if e.contains("nema proxy") {
            (StatusCode::NOT_FOUND, e)
        } else {
            (StatusCode::BAD_REQUEST, e)
        }
    })?;
    let virtual_shots = list_virtual_shots(&app.project.paths, &pid).map_err(internal)?;
    Ok(Json(json!({
        "status": "ok",
        "shot": shot,
        "virtual_shots": virtual_shots,
    })))
}

fn resolve_project_id(app: &AppState, project_id: &str) -> Result<String, (StatusCode, String)> {
    if !project_id.trim().is_empty() {
        return Ok(project_id.trim().to_string());
    }
    app.project.active_project_id()
}

fn internal(e: String) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e)
}

async fn serve_file(path: std::path::PathBuf) -> Result<Response, (StatusCode, String)> {
    let data = tokio::fs::read(&path)
        .await
        .map_err(|e| internal(e.to_string()))?;
    let media_type = if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.eq_ignore_ascii_case("mp4"))
        .unwrap_or(false)
    {
        "video/mp4"
    } else {
        "image/jpeg"
    };
    Ok(([(header::CONTENT_TYPE, media_type)], data).into_response())
}
