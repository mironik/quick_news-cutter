use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};

use serde_json::{json, Value};

use crate::app_state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/asr/health", get(api_asr_health))
        .route("/api/ai-search/transcribe-stream", post(api_transcribe_stream))
}

fn ai_asr_enabled() -> bool {
    std::env::var("QNC_AI_ENABLED")
        .map(|v| {
            let v = v.trim().to_ascii_lowercase();
            v == "1" || v == "true" || v == "yes"
        })
        .unwrap_or(false)
}

async fn api_asr_health() -> Json<Value> {
    if ai_asr_enabled() {
        Json(json!({
            "status": "offline",
            "message": "ASR backend nije još implementiran u qnc-host (QNC_AI_ENABLED=1).",
            "backend": "none",
        }))
    } else {
        Json(json!({
            "status": "offline",
            "message": "ASR nije uključen. Postavi QNC_AI_ENABLED=1 kad bude dostupan.",
            "backend": "none",
        }))
    }
}

async fn api_transcribe_stream() -> Response {
    let body = json!({
        "detail": {
            "status": "error",
            "message": if ai_asr_enabled() {
                "ASR streaming još nije implementiran u qnc-host."
            } else {
                "ASR nije uključen (QNC_AI_ENABLED)."
            }
        }
    });
    (StatusCode::SERVICE_UNAVAILABLE, Json(body)).into_response()
}
