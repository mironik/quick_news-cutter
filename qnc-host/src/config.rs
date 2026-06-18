use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::Value;

#[derive(Clone, Debug, Deserialize)]
pub struct AppConfig {
    #[serde(default = "default_port")]
    pub api_port: u16,
    #[serde(default = "default_server_label")]
    pub server_label: String,
    #[serde(default)]
    pub projects_root: Option<String>,
    #[serde(default)]
    pub network_presets: Vec<NetworkPreset>,
}

#[derive(Clone, Debug, Deserialize, serde::Serialize)]
pub struct NetworkPreset {
    pub label: String,
    pub host: String,
}

fn default_port() -> u16 {
    8001
}

fn default_server_label() -> String {
    "QNC server".into()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            api_port: default_port(),
            server_label: default_server_label(),
            projects_root: None,
            network_presets: vec![],
        }
    }
}

impl AppConfig {
    pub fn load(root: &Path) -> Self {
        let path = root.join("data").join("shell_config.json");
        let mut cfg = match fs::read_to_string(&path) {
            Ok(raw) => serde_json::from_str::<AppConfig>(&raw).unwrap_or_default(),
            Err(_) => AppConfig::default(),
        };
        if let Ok(raw) = std::env::var("QNC_API_PORT") {
            if let Ok(p) = raw.parse::<u16>() {
                cfg.api_port = p;
            }
        }
        if let Ok(raw) = std::env::var("QNC_PROJECTS_ROOT").or_else(|_| std::env::var("QNC_PROJEKTI_ROOT")) {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                cfg.projects_root = Some(trimmed.to_string());
            }
        }
        cfg
    }
}

pub fn read_json(path: &Path) -> Option<Value> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn default_projects_root() -> PathBuf {
    #[cfg(windows)]
    {
        if let Ok(base) = std::env::var("LOCALAPPDATA") {
            return PathBuf::from(base).join("QNC").join("Projects");
        }
        if let Ok(base) = std::env::var("APPDATA") {
            return PathBuf::from(base).join("QNC").join("Projects");
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("QNC")
                .join("Projects");
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Ok(base) = std::env::var("XDG_DATA_HOME") {
            return PathBuf::from(base).join("qnc").join("projects");
        }
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(".local").join("share").join("qnc").join("projects");
        }
    }

    PathBuf::from("QNC").join("Projects")
}

pub fn configured_projects_root(config: &AppConfig) -> PathBuf {
    config
        .projects_root
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_projects_root)
}

pub fn save_projects_root(root: &Path, projects_root: &str) -> Result<Value, String> {
    let path = root.join("data").join("shell_config.json");
    let mut doc = fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if !doc.is_object() {
        doc = serde_json::json!({});
    }
    let Some(obj) = doc.as_object_mut() else {
        return Err("Neispravan shell_config.json".into());
    };
    obj.insert("projects_root".into(), Value::String(projects_root.trim().to_string()));
    fs::create_dir_all(root.join("data")).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(doc)
}
