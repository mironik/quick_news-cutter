use std::fs;
use std::path::Path;

use serde_json::{Value, json};

pub fn list_tab_manifests(plugins_root: &Path) -> Vec<Value> {
    let mut manifests = Vec::new();
    let Ok(entries) = fs::read_dir(plugins_root) else {
        return manifests;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("plugin.json");
        if !manifest_path.is_file() {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&manifest_path) else {
            continue;
        };
        let Ok(mut data) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let default_id = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("plugin")
            .to_string();
        if let Some(obj) = data.as_object_mut() {
            if !obj.contains_key("plugin_id") {
                obj.insert("plugin_id".into(), json!(default_id));
            }
            if !obj.contains_key("tab_id") {
                let pid = obj
                    .get("plugin_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&default_id);
                obj.insert("tab_id".into(), json!(pid));
            }
            if !obj.contains_key("enabled") {
                obj.insert("enabled".into(), json!(true));
            }
        }
        manifests.push(data);
    }

    manifests.sort_by(|a, b| sort_key(a).cmp(&sort_key(b)));
    manifests
}

fn sort_key(item: &Value) -> (i32, i32, String) {
    let tab_id = item.get("tab_id").and_then(|v| v.as_str()).unwrap_or("");
    let position = item
        .get("position")
        .and_then(|v| v.as_str())
        .unwrap_or("normal");
    let bucket = if position == "first" || tab_id == "project" {
        -1
    } else if position == "last" || tab_id == "preview" || tab_id == "export" {
        1
    } else {
        0
    };
    let priority = item
        .get("priority")
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i32;
    let label = item
        .get("label")
        .and_then(|v| v.as_str())
        .unwrap_or(tab_id)
        .to_string();
    (bucket, priority, label)
}
