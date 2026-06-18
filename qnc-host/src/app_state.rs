use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use crate::config::AppConfig;
use crate::filmstrip::FilmstripWorker;
use crate::ingest::{ImportWorker, ThumbWorker};
use crate::modules::ModuleStore;
use crate::project::ProjectState;

#[derive(Clone)]
pub struct AppState {
    pub root: PathBuf,
    pub config: AppConfig,
    pub modules: Arc<RwLock<ModuleStore>>,
    pub project: ProjectState,
    pub ingest_thumbs: Arc<ThumbWorker>,
    pub ingest_import: Arc<ImportWorker>,
    pub filmstrip: Arc<FilmstripWorker>,
}