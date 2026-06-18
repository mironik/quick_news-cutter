use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::config::read_json;

const VALID_MODES: [&str; 3] = ["open", "password", "off"];
const DEFAULT_THEME_ID: &str = "default";

pub fn design_mode(root: &Path) -> String {
    if let Ok(env) = std::env::var("QNC_DESIGN_MODE") {
        let mode = env.trim().to_lowercase();
        if VALID_MODES.contains(&mode.as_str()) {
            return mode;
        }
    }
    let cfg = read_json(&root.join("data").join("shell_config.json")).unwrap_or(json!({}));
    if let Some(mode) = cfg
        .get("design_editor")
        .and_then(|v| v.get("mode"))
        .and_then(|v| v.as_str())
    {
        let mode = mode.trim().to_lowercase();
        if VALID_MODES.contains(&mode.as_str()) {
            return mode;
        }
    }
    "open".to_string()
}

pub fn design_default_enabled(root: &Path, mode: &str) -> bool {
    let cfg = read_json(&root.join("data").join("shell_config.json")).unwrap_or(json!({}));
    if let Some(block) = cfg.get("design_editor") {
        if let Some(v) = block.get("default_enabled") {
            return v.as_bool().unwrap_or(false);
        }
    }
    mode == "open"
}

pub fn design_editor_capability(root: &Path) -> Value {
    let mode = design_mode(root);
    let available = mode != "off";
    let authenticated = available && mode == "open";
    json!({
        "available": available,
        "mode": mode,
        "authenticated": authenticated,
        "default_enabled": design_default_enabled(root, &mode),
    })
}

pub fn design_status(root: &Path) -> Value {
    let cap = design_editor_capability(root);
    json!({
        "status": "ok",
        "available": cap.get("available").cloned().unwrap_or(json!(false)),
        "mode": cap.get("mode").cloned().unwrap_or(json!("off")),
        "authenticated": cap.get("authenticated").cloned().unwrap_or(json!(false)),
        "default_enabled": cap.get("default_enabled").cloned().unwrap_or(json!(false)),
        "paths": {
            "tokens": "/plugins/design-tools/design/tokens.json",
            "overrides": "/data/design_overrides/tokens.json",
            "themes": "/data/design_overrides/themes/",
            "active_theme": "/data/design_overrides/active_theme.json",
            "timeline_lab": "/data/design_overrides/timeline-lab.json",
            "project_list_lab": "/data/design_overrides/project-list-lab.json",
            "project_template_settings_lab": "/data/design_overrides/project-template-settings-lab.json",
            "ingest_clip_grid_lab": "/data/design_overrides/ingest-clip-grid-lab.json",
        }
    })
}

fn slug_theme_id(label: &str) -> String {
    let mut slug = String::new();
    let mut prev_dash = false;
    for ch in label.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            prev_dash = false;
        } else if !prev_dash && !slug.is_empty() {
            slug.push('-');
            prev_dash = true;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "tema".to_string()
    } else {
        slug
    }
}

fn overrides_dir(root: &Path) -> PathBuf {
    root.join("data").join("design_overrides")
}

fn themes_dir(root: &Path) -> PathBuf {
    overrides_dir(root).join("themes")
}

fn theme_path(root: &Path, theme_id: &str) -> PathBuf {
    themes_dir(root).join(format!("{theme_id}.json"))
}

fn active_theme_path(root: &Path) -> PathBuf {
    overrides_dir(root).join("active_theme.json")
}

fn legacy_overrides_path(root: &Path) -> PathBuf {
    overrides_dir(root).join("tokens.json")
}

fn base_tokens_path(root: &Path) -> PathBuf {
    root.join("plugins")
        .join("design-tools")
        .join("design")
        .join("tokens.json")
}

pub fn active_theme_id(root: &Path) -> String {
    let doc = read_json(&active_theme_path(root)).unwrap_or(json!({}));
    doc.get("theme_id")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_THEME_ID.to_string())
}

fn load_token_overrides(root: &Path) -> HashMap<String, String> {
    let doc = read_json(&legacy_overrides_path(root)).unwrap_or(json!({}));
    let mut out = HashMap::new();
    if let Some(obj) = doc.get("tokens").and_then(|v| v.as_object()) {
        for (k, v) in obj {
            if k.starts_with("--") {
                if let Some(s) = v.as_str() {
                    out.insert(k.clone(), s.to_string());
                }
            }
        }
    }
    out
}

fn load_theme_doc(root: &Path, theme_id: &str) -> Value {
    if theme_id == DEFAULT_THEME_ID {
        let base = read_json(&base_tokens_path(root)).unwrap_or(json!({}));
        let overrides = load_token_overrides(root);
        return json!({
            "id": DEFAULT_THEME_ID,
            "label": base.get("label").cloned().unwrap_or(json!("QNC Default")),
            "built_in": true,
            "tokens": overrides,
        });
    }
    read_json(&theme_path(root, theme_id)).unwrap_or(json!({}))
}

fn theme_override_tokens(root: &Path, theme_id: &str) -> HashMap<String, String> {
    if theme_id == DEFAULT_THEME_ID {
        return load_token_overrides(root);
    }
    let doc = load_theme_doc(root, theme_id);
    let mut out = HashMap::new();
    if let Some(obj) = doc.get("tokens").and_then(|v| v.as_object()) {
        for (k, v) in obj {
            if k.starts_with("--") {
                if let Some(s) = v.as_str() {
                    out.insert(k.clone(), s.to_string());
                }
            }
        }
    }
    out
}

pub fn merged_tokens(root: &Path) -> Value {
    let base = read_json(&base_tokens_path(root)).unwrap_or(json!({ "version": 1, "tokens": {} }));
    let theme_id = active_theme_id(root);
    let overrides_map = theme_override_tokens(root, &theme_id);
    let mut tokens = HashMap::new();
    if let Some(obj) = base.get("tokens").and_then(|v| v.as_object()) {
        for (k, v) in obj {
            if let Some(s) = v.as_str() {
                tokens.insert(k.clone(), s.to_string());
            }
        }
    }
    for (k, v) in &overrides_map {
        tokens.insert(k.clone(), v.clone());
    }
    let theme_doc = load_theme_doc(root, &theme_id);
    let label = theme_doc
        .get("label")
        .and_then(|v| v.as_str())
        .unwrap_or("QNC Default");
    let overrides: Value = serde_json::to_value(&overrides_map).unwrap_or(json!({}));
    json!({
        "status": "ok",
        "version": base.get("version").cloned().unwrap_or(json!(1)),
        "label": label,
        "theme_id": theme_id,
        "tokens": tokens,
        "overrides": overrides,
    })
}

pub fn list_themes(root: &Path) -> Value {
    let base = read_json(&base_tokens_path(root)).unwrap_or(json!({}));
    let mut themes = vec![json!({
        "id": DEFAULT_THEME_ID,
        "label": base.get("label").cloned().unwrap_or(json!("QNC Default")),
        "built_in": true,
    })];
    let dir = themes_dir(root);
    if dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            let mut paths: Vec<PathBuf> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("json"))
                .collect();
            paths.sort();
            for path in paths {
                let doc = read_json(&path).unwrap_or(json!({}));
                let theme_id = doc
                    .get("id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| {
                        path.file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("tema")
                            .to_string()
                    });
                if theme_id == DEFAULT_THEME_ID {
                    continue;
                }
                themes.push(json!({
                    "id": theme_id,
                    "label": doc.get("label").cloned().unwrap_or(json!(theme_id.clone())),
                    "built_in": false,
                }));
            }
        }
    }
    json!({
        "status": "ok",
        "active_id": active_theme_id(root),
        "themes": themes,
    })
}

pub fn activate_theme(root: &Path, theme_id: &str) -> Result<Value, String> {
    let target = if theme_id.trim().is_empty() {
        DEFAULT_THEME_ID.to_string()
    } else {
        theme_id.trim().to_string()
    };
    if target != DEFAULT_THEME_ID && !theme_path(root, &target).is_file() {
        return Err(format!("Tema '{target}' ne postoji."));
    }
    let path = active_theme_path(root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let doc = json!({ "theme_id": target });
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())? + "\n",
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "status": "ok", "active_id": target }))
}

pub fn create_theme(root: &Path, label: &str) -> Result<Value, String> {
    let clean = label.trim();
    if clean.is_empty() {
        return Err("Naziv teme je obavezan.".into());
    }
    let mut theme_id = slug_theme_id(clean);
    let mut suffix = 2;
    while theme_path(root, &theme_id).is_file() {
        theme_id = format!("{}-{}", slug_theme_id(clean), suffix);
        suffix += 1;
    }
    let merged = merged_tokens(root);
    let base = read_json(&base_tokens_path(root)).unwrap_or(json!({}));
    let base_tokens = base.get("tokens").and_then(|v| v.as_object());
    let mut overrides = HashMap::new();
    if let Some(obj) = merged.get("tokens").and_then(|v| v.as_object()) {
        for (k, v) in obj {
            if !k.starts_with("--") {
                continue;
            }
            let val = v.as_str().unwrap_or("");
            let base_val = base_tokens
                .and_then(|b| b.get(k))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if val != base_val {
                overrides.insert(k.clone(), val.to_string());
            }
        }
    }
    let dir = themes_dir(root);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let doc = json!({
        "version": 1,
        "id": theme_id,
        "label": clean,
        "tokens": overrides,
    });
    std::fs::write(
        theme_path(root, &theme_id),
        serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())? + "\n",
    )
    .map_err(|e| e.to_string())?;
    activate_theme(root, &theme_id)?;
    Ok(json!({
        "status": "ok",
        "id": theme_id,
        "label": clean,
        "active_id": theme_id,
    }))
}

pub fn save_token_overrides(
    root: &Path,
    tokens: &HashMap<String, String>,
) -> Result<Value, String> {
    let mode = design_mode(root);
    if mode == "off" {
        return Err("Design editor je isključen.".into());
    }
    if mode == "password" {
        return Err("Spremanje zahtijeva admin autentifikaciju (još nije implementirano).".into());
    }
    let target = active_theme_id(root);
    let clean: HashMap<String, String> = tokens
        .iter()
        .filter(|(k, _)| k.starts_with("--"))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    if target == DEFAULT_THEME_ID {
        let out_path = legacy_overrides_path(root);
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let doc = json!({ "version": 1, "tokens": clean });
        std::fs::write(
            &out_path,
            serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())? + "\n",
        )
        .map_err(|e| e.to_string())?;
        return Ok(json!({ "status": "ok", "theme_id": target, "tokens": clean }));
    }
    let theme_doc = load_theme_doc(root, &target);
    if theme_doc.get("id").is_none() {
        return Err(format!("Tema '{target}' ne postoji."));
    }
    let label = theme_doc
        .get("label")
        .and_then(|v| v.as_str())
        .unwrap_or(&target);
    let doc = json!({
        "version": 1,
        "id": target,
        "label": label,
        "tokens": clean,
    });
    std::fs::write(
        theme_path(root, &target),
        serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())? + "\n",
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "status": "ok", "theme_id": target, "tokens": clean }))
}

fn timeline_lab_path(root: &Path) -> PathBuf {
    overrides_dir(root).join("timeline-lab.json")
}

fn default_timeline_lab_prefs() -> Value {
    json!({
        "version": 1,
        "active_profile_id": "design-lab",
        "label_display": "full",
        "video_presentation": "filmstrip",
        "playhead_pct": 35,
        "track_states": {},
    })
}

pub fn load_timeline_lab_prefs(root: &Path) -> Value {
    let doc = read_json(&timeline_lab_path(root)).unwrap_or_else(default_timeline_lab_prefs);
    json!({
        "status": "ok",
        "prefs": doc,
    })
}

pub fn save_timeline_lab_prefs(root: &Path, prefs: Value) -> Result<Value, String> {
    let mode = design_mode(root);
    if mode == "off" {
        return Err("Design editor je isključen.".into());
    }
    if mode == "password" {
        return Err("Spremanje zahtijeva admin autentifikaciju (još nije implementirano).".into());
    }
    let path = timeline_lab_path(root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&prefs).map_err(|e| e.to_string())? + "\n",
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "status": "ok", "prefs": prefs }))
}

fn project_list_lab_path(root: &Path) -> PathBuf {
    overrides_dir(root).join("project-list-lab.json")
}

fn default_project_list_lab_prefs() -> Value {
    json!({
        "version": 1,
        "component": "project-list",
        "active_profile_id": "design-lab",
        "feature_states": {},
    })
}

pub fn load_project_list_lab_prefs(root: &Path) -> Value {
    let doc =
        read_json(&project_list_lab_path(root)).unwrap_or_else(default_project_list_lab_prefs);
    json!({
        "status": "ok",
        "prefs": doc,
    })
}

pub fn save_project_list_lab_prefs(root: &Path, prefs: Value) -> Result<Value, String> {
    let mode = design_mode(root);
    if mode == "off" {
        return Err("Design editor je isključen.".into());
    }
    if mode == "password" {
        return Err("Spremanje zahtijeva admin autentifikaciju (još nije implementirano).".into());
    }
    let path = project_list_lab_path(root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&prefs).map_err(|e| e.to_string())? + "\n",
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "status": "ok", "prefs": prefs }))
}

fn project_template_settings_lab_path(root: &Path) -> PathBuf {
    overrides_dir(root).join("project-template-settings-lab.json")
}

fn default_project_template_settings_lab_prefs() -> Value {
    json!({
        "version": 1,
        "component": "project-template-settings",
        "active_profile_id": "design-lab",
        "section_states": {},
    })
}

pub fn load_project_template_settings_lab_prefs(root: &Path) -> Value {
    let doc = read_json(&project_template_settings_lab_path(root))
        .unwrap_or_else(default_project_template_settings_lab_prefs);
    json!({
        "status": "ok",
        "prefs": doc,
    })
}

pub fn save_project_template_settings_lab_prefs(
    root: &Path,
    prefs: Value,
) -> Result<Value, String> {
    let mode = design_mode(root);
    if mode == "off" {
        return Err("Design editor je isključen.".into());
    }
    if mode == "password" {
        return Err("Spremanje zahtijeva admin autentifikaciju (još nije implementirano).".into());
    }
    let path = project_template_settings_lab_path(root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&prefs).map_err(|e| e.to_string())? + "\n",
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "status": "ok", "prefs": prefs }))
}

fn ingest_clip_grid_lab_path(root: &Path) -> PathBuf {
    overrides_dir(root).join("ingest-clip-grid-lab.json")
}

fn default_ingest_clip_grid_lab_prefs() -> Value {
    json!({
        "version": 1,
        "component": "ingest-clip-grid",
        "active_profile_id": "fcp11-browser",
        "feature_states": {},
    })
}

pub fn load_ingest_clip_grid_lab_prefs(root: &Path) -> Value {
    let primary = read_json(&ingest_clip_grid_lab_path(root));
    let legacy = read_json(&overrides_dir(root).join("ingest-proxy-clip-grid-lab.json"));
    let doc = primary
        .or(legacy)
        .unwrap_or_else(default_ingest_clip_grid_lab_prefs);
    json!({
        "status": "ok",
        "prefs": doc,
    })
}

pub fn save_ingest_clip_grid_lab_prefs(root: &Path, prefs: Value) -> Result<Value, String> {
    let mode = design_mode(root);
    if mode == "off" {
        return Err("Design editor je isključen.".into());
    }
    if mode == "password" {
        return Err("Spremanje zahtijeva admin autentifikaciju (još nije implementirano).".into());
    }
    let path = ingest_clip_grid_lab_path(root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&prefs).map_err(|e| e.to_string())? + "\n",
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "status": "ok", "prefs": prefs }))
}
