use rusqlite::{params, Connection};
use serde_json::{json, Value};

use super::db::open_db;
use crate::project::db::{now_str, ProjectPaths};

pub fn default_workflow() -> Value {
    json!({
        "selected_clip_ids": [],
        "current_clip_id": "",
        "mark_in_sec": Value::Null,
        "mark_out_sec": Value::Null,
        "active_virtual_shot_id": "",
    })
}

pub fn get_workflow(paths: &ProjectPaths, project_id: &str) -> Result<Value, String> {
    let conn = open_db(paths, project_id)?;
    get_workflow_conn(&conn)
}

fn get_workflow_conn(conn: &Connection) -> Result<Value, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT state_json FROM media_pool_workflow WHERE id = 1",
            [],
            |r| r.get(0),
        )
        .ok();
    let Some(raw) = raw else {
        return Ok(default_workflow());
    };
    let mut state = serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| default_workflow());
    if !state.is_object() {
        state = default_workflow();
    }
    normalize_workflow(state)
}

pub fn patch_workflow(
    paths: &ProjectPaths,
    project_id: &str,
    patch: &Value,
) -> Result<Value, String> {
    let conn = open_db(paths, project_id)?;
    let mut current = get_workflow_conn(&conn)?;
    apply_workflow_patch(&mut current, patch);
    normalize_workflow_in_place(&mut current);
    let now = now_str();
    conn.execute(
        "INSERT INTO media_pool_workflow (id, state_json, updated_at) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
        params![current.to_string(), now],
    )
    .map_err(|e| e.to_string())?;
    Ok(current)
}

fn apply_workflow_patch(state: &mut Value, patch: &Value) {
    let Some(patch_obj) = patch.as_object() else {
        return;
    };
    let Some(state_obj) = state.as_object_mut() else {
        return;
    };

    if let Some(ids) = patch_obj
        .get("selected_clip_ids")
        .and_then(|v| v.as_array())
    {
        let cleaned: Vec<Value> = ids
            .iter()
            .filter_map(|v| v.as_str().map(|s| json!(s.trim())))
            .filter(|v| v.as_str().map(|s| !s.is_empty()).unwrap_or(false))
            .collect();
        state_obj.insert("selected_clip_ids".into(), json!(cleaned));
    }

    if let Some(clip_id) = patch_obj.get("toggle_clip_id").and_then(|v| v.as_str()) {
        let clip_id = clip_id.trim();
        if !clip_id.is_empty() {
            let selected = patch_obj
                .get("clip_selected")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let mut ids: Vec<String> = state_obj
                .get("selected_clip_ids")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            if selected {
                if !ids.iter().any(|id| id == clip_id) {
                    ids.push(clip_id.to_string());
                }
            } else {
                ids.retain(|id| id != clip_id);
            }
            state_obj.insert("selected_clip_ids".into(), json!(ids));
        }
    }

    if let Some(current) = patch_obj.get("current_clip_id") {
        if current.is_null() {
            state_obj.insert("current_clip_id".into(), json!(""));
        } else if let Some(id) = current.as_str() {
            state_obj.insert("current_clip_id".into(), json!(id.trim()));
        }
    }

    for key in ["mark_in_sec", "mark_out_sec"] {
        if let Some(v) = patch_obj.get(key) {
            if v.is_null() {
                state_obj.insert(key.into(), Value::Null);
            } else if let Some(n) = v.as_f64() {
                state_obj.insert(key.into(), json!(n));
            }
        }
    }

    if let Some(id) = patch_obj.get("active_virtual_shot_id") {
        if id.is_null() {
            state_obj.insert("active_virtual_shot_id".into(), json!(""));
        } else if let Some(s) = id.as_str() {
            state_obj.insert("active_virtual_shot_id".into(), json!(s.trim()));
        }
    }

    if patch_obj
        .get("clear_marks")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        state_obj.insert("mark_in_sec".into(), Value::Null);
        state_obj.insert("mark_out_sec".into(), Value::Null);
        state_obj.insert("active_virtual_shot_id".into(), json!(""));
    }
}

fn normalize_workflow(mut state: Value) -> Result<Value, String> {
    normalize_workflow_in_place(&mut state);
    Ok(state)
}

fn normalize_workflow_in_place(state: &mut Value) {
    let defaults = default_workflow();
    let Some(obj) = state.as_object_mut() else {
        *state = defaults;
        return;
    };
    let Some(def) = defaults.as_object() else {
        return;
    };
    for (key, default_val) in def {
        if !obj.contains_key(key) {
            obj.insert(key.clone(), default_val.clone());
        }
    }
    if !obj
        .get("selected_clip_ids")
        .and_then(|v| v.as_array())
        .is_some()
    {
        obj.insert("selected_clip_ids".into(), json!([]));
    }
    if obj
        .get("current_clip_id")
        .and_then(|v| v.as_str())
        .is_none()
    {
        obj.insert("current_clip_id".into(), json!(""));
    }
    if obj
        .get("active_virtual_shot_id")
        .and_then(|v| v.as_str())
        .is_none()
    {
        obj.insert("active_virtual_shot_id".into(), json!(""));
    }
}
