use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{Html, IntoResponse, Redirect},
    routing::{get, post},
    Json, Router,
};
use tower_http::services::ServeDir;
use tracing::info;

mod app_html;
mod app_state;
mod components;
mod config;
mod db_first;
mod design;
mod design_db;
mod filmstrip;
mod ingest;
mod media;
mod media_pool;
mod modules;
mod platform;
mod project;
mod routes;
mod sdk_demo;
mod shell_dialog;
mod story;
mod tabs;

use app_state::AppState;

use config::AppConfig;
use modules::ModuleStore;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "qnc_host=info,tower_http=warn".into()),
        )
        .init();

    let root = detect_root();
    let config = AppConfig::load(&root);
    let modules = Arc::new(RwLock::new(ModuleStore::load(&root.join("data"))));
    let project_state = project::ProjectState::new(&root, &config);
    let ingest_thumbs = Arc::new(ingest::ThumbWorker::new(project_state.paths.clone()));
    let filmstrip = Arc::new(filmstrip::FilmstripWorker::new(project_state.paths.clone()));
    let ingest_import = Arc::new(ingest::ImportWorker::new(
        project_state.paths.clone(),
        ingest_thumbs.clone(),
    ));
    ingest_thumbs.clone().spawn();
    filmstrip.clone().spawn();
    ingest_import.clone().spawn();

    let state = AppState {
        root: root.clone(),
        config: config.clone(),
        modules,
        project: project_state,
        ingest_thumbs,
        ingest_import,
        filmstrip,
    };

    let app_shell_dir = ServeDir::new(root.join("app").join("shell"));
    let app_shared_dir = ServeDir::new(root.join("app").join("shared"));
    let app_components_dir = ServeDir::new(root.join("app").join("components"));
    let plugins_dir = ServeDir::new(root.join("plugins"));

    let app = Router::new()
        .route("/api/health", get(api_health))
        .route("/api/shell/runtime", get(api_shell_runtime))
        .route("/api/shell/diagnostics", get(api_shell_diagnostics))
        .route("/api/shell/db-first", get(api_shell_db_first))
        .route("/api/shell/tabs", get(api_shell_tabs))
        .route("/api/shell/components", get(api_shell_components))
        .route(
            "/api/shell/components/sync",
            post(api_shell_components_sync),
        )
        .route("/api/shell/pick-directory", post(api_shell_pick_directory))
        .route("/api/shell/pick-files", post(api_shell_pick_files))
        .route(
            "/api/shell/projects-root",
            get(api_shell_projects_root).post(api_shell_projects_root_save),
        )
        .route("/api/modules", get(api_modules_list))
        .route("/api/modules/{module_id}/enable", post(api_module_enable))
        .route("/app", get(app_page))
        .route("/gui", get(gui_redirect))
        .nest_service("/app/shell", app_shell_dir)
        .nest_service("/app/shared", app_shared_dir)
        .nest_service("/app/components", app_components_dir)
        .nest_service("/plugins", plugins_dir)
        .merge(project::router())
        .merge(routes::design_tools::router())
        .merge(ingest::router())
        .merge(media_pool::router())
        .merge(sdk_demo::router())
        .merge(story::router())
        .with_state(state);

    let port = config.api_port;
    let bind_ip: std::net::IpAddr = config
        .bind_host
        .parse()
        .unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST));
    let addr = SocketAddr::from((bind_ip, port));
    let app_host = config::app_url_host(&config.bind_host);
    info!("QNC host root: {}", root.display());
    info!("Binding to {bind_ip}:{port}");
    info!("App URL: http://{app_host}:{port}/app");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}

fn detect_root() -> PathBuf {
    if let Ok(raw) = std::env::var("QNC_ROOT") {
        let p = PathBuf::from(raw);
        if p.join("app").join("shell").is_dir() {
            return p.canonicalize().unwrap_or(p);
        }
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if cwd.join("app").join("shell").is_dir() {
        return cwd;
    }
    if cwd.join("..").join("app").join("shell").is_dir() {
        return cwd.join("..").canonicalize().unwrap_or(cwd.join(".."));
    }
    cwd
}

async fn api_health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "ffmpeg": ingest::thumb::ffmpeg_available(),
    }))
}

async fn api_shell_runtime(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(platform::runtime_info(&state.root, &state.config))
}

async fn api_shell_diagnostics(State(state): State<AppState>) -> Json<serde_json::Value> {
    let plugins_root = state.root.join("plugins");
    let scan = tabs::scan_plugin_manifests(&plugins_root);
    let plugins_loaded: Vec<String> = scan
        .manifests
        .iter()
        .filter_map(|m| {
            m.get("plugin_id")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .collect();
    let components_catalog = components::list_global(&state.root.join("app").join("components"));
    let components_count = components_catalog
        .get("components")
        .and_then(|v| v.as_object())
        .map(|o| o.len())
        .unwrap_or(0);

    Json(serde_json::json!({
        "status": "ok",
        "bind_host": state.config.bind_host,
        "api_port": state.config.api_port,
        "app_url": format!(
            "http://{}:{}/app",
            config::app_url_host(&state.config.bind_host),
            state.config.api_port
        ),
        "data_dir": state.root.join("data").to_string_lossy(),
        "projects_root": config::configured_projects_root(&state.config).to_string_lossy(),
        "plugins_loaded": plugins_loaded,
        "plugins_loaded_count": plugins_loaded.len(),
        "plugin_manifest_errors": scan.errors,
        "components_count": components_count,
    }))
}

async fn api_shell_db_first(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(db_first::diagnostics(&state.root, &state.project.paths))
}

async fn api_shell_projects_root(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "projects_root": state.project.paths.projects_root.to_string_lossy(),
        "configured_projects_root": state.config.projects_root,
    }))
}

#[derive(serde::Deserialize)]
struct ProjectsRootBody {
    projects_root: String,
}

async fn api_shell_projects_root_save(
    State(state): State<AppState>,
    Json(body): Json<ProjectsRootBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let path = body.projects_root.trim();
    if path.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "projects_root je prazan.".into()));
    }
    config::save_projects_root(&state.root, path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(serde_json::json!({
        "status": "ok",
        "projects_root": path,
        "requires_restart": true,
        "message": "Lokacija projekata spremljena. Ponovno pokreni QNC host da postane aktivna.",
    })))
}

async fn api_shell_tabs(State(state): State<AppState>) -> Json<serde_json::Value> {
    let manifests = tabs::list_tab_manifests(&state.root.join("plugins"));
    let store = state.modules.read().expect("module lock");
    let enabled = store.apply_enabled(&state.root, manifests);
    Json(serde_json::json!({ "status": "ok", "tabs": enabled }))
}

async fn api_shell_components(State(state): State<AppState>) -> Json<serde_json::Value> {
    let catalog = components::list_global(&state.root.join("app").join("components"));
    let mut out = catalog;
    if let Some(obj) = out.as_object_mut() {
        obj.insert("status".into(), serde_json::json!("ok"));
    }
    Json(out)
}

async fn api_shell_components_sync() -> Json<serde_json::Value> {
    // MVP: portable sync ostaje no-op; registry se čita s diska.
    Json(serde_json::json!({ "status": "ok", "installed": [] }))
}

#[derive(serde::Deserialize)]
struct PickDirectoryBody {
    initial_dir: Option<String>,
}

async fn api_shell_pick_directory(
    Json(body): Json<PickDirectoryBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let initial = body.initial_dir.unwrap_or_default().trim().to_string();
    let picked = tokio::task::spawn_blocking(move || {
        let start = std::path::PathBuf::from(&initial);
        shell_dialog::pick_directory(&start)
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    match picked {
        Some(path) => Ok(Json(serde_json::json!({
            "status": "ok",
            "path": path.to_string_lossy()
        }))),
        None => Err((StatusCode::CONFLICT, "cancelled".into())),
    }
}

#[derive(serde::Deserialize)]
struct PickFilesBody {
    initial_dir: Option<String>,
}

async fn api_shell_pick_files(
    Json(body): Json<PickFilesBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let initial = body.initial_dir.unwrap_or_default().trim().to_string();
    let picked = tokio::task::spawn_blocking(move || {
        let start = std::path::PathBuf::from(&initial);
        shell_dialog::pick_media_files(&start)
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    match picked {
        Some(paths) => {
            let out: Vec<String> = paths
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            Ok(Json(serde_json::json!({
                "status": "ok",
                "paths": out,
            })))
        }
        None => Err((StatusCode::CONFLICT, "cancelled".into())),
    }
}

async fn api_modules_list(State(state): State<AppState>) -> Json<serde_json::Value> {
    let manifests = tabs::list_tab_manifests(&state.root.join("plugins"));
    let store = state.modules.read().expect("module lock");
    let modules = store.as_module_list(manifests);
    Json(serde_json::json!({ "status": "ok", "modules": modules }))
}

#[derive(serde::Deserialize)]
struct EnableBody {
    enabled: bool,
}

async fn api_module_enable(
    State(state): State<AppState>,
    Path(module_id): Path<String>,
    Json(body): Json<EnableBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let manifests = tabs::list_tab_manifests(&state.root.join("plugins"));
    let mut store = state.modules.write().expect("module lock");
    match store.set_enabled(
        &state.root.join("data"),
        &manifests,
        &module_id,
        body.enabled,
    ) {
        Ok(module) => Ok(Json(
            serde_json::json!({ "status": "ok", "module": module }),
        )),
        Err(modules::ModuleError::NotFound) => Err((
            StatusCode::NOT_FOUND,
            format!("Modul '{module_id}' ne postoji."),
        )),
        Err(modules::ModuleError::NotRemovable) => Err((
            StatusCode::FORBIDDEN,
            format!("Modul '{module_id}' je sistemski i ne moze se iskljuciti."),
        )),
    }
}

async fn app_page() -> Html<&'static str> {
    Html(app_html::APP_HTML)
}

async fn gui_redirect() -> impl IntoResponse {
    Redirect::temporary("/app")
}
