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

fn ensure_workflow_row(conn: &Connection) -> Result<(), String> {
    let now = now_str();
    conn.execute(
        "INSERT OR IGNORE INTO media_pool_workflow (id, updated_at) VALUES (1, ?1)",
        params![now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn selected_clip_ids(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT clip_id FROM media_pool_workflow_selection ORDER BY clip_id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn get_workflow_conn(conn: &Connection) -> Result<Value, String> {
    ensure_workflow_row(conn)?;
    let (current_clip_id, mark_in, mark_out, active_shot): (
        String,
        Option<f64>,
        Option<f64>,
        String,
    ) = conn
        .query_row(
            "SELECT current_clip_id, mark_in_sec, mark_out_sec, active_virtual_shot_id
                 FROM media_pool_workflow WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|e| e.to_string())?;
    let selected = selected_clip_ids(conn)?;
    Ok(json!({
        "selected_clip_ids": selected,
        "current_clip_id": current_clip_id,
        "mark_in_sec": mark_in.map(|v| json!(v)).unwrap_or(Value::Null),
        "mark_out_sec": mark_out.map(|v| json!(v)).unwrap_or(Value::Null),
        "active_virtual_shot_id": active_shot,
    }))
}

pub fn patch_workflow(
    paths: &ProjectPaths,
    project_id: &str,
    patch: &Value,
) -> Result<Value, String> {
    let conn = open_db(paths, project_id)?;
    ensure_workflow_row(&conn)?;
    let mut current = get_workflow_conn(&conn)?;
    apply_workflow_patch(&mut current, patch);
    normalize_workflow_in_place(&mut current);
    persist_workflow(&conn, &current)?;
    get_workflow_conn(&conn)
}

fn persist_workflow(conn: &Connection, state: &Value) -> Result<(), String> {
    let obj = state
        .as_object()
        .ok_or_else(|| "workflow nije objekt".to_string())?;
    let current_clip_id = obj
        .get("current_clip_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let active_shot = obj
        .get("active_virtual_shot_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let mark_in = obj.get("mark_in_sec").and_then(|v| v.as_f64());
    let mark_out = obj.get("mark_out_sec").and_then(|v| v.as_f64());
    let now = now_str();
    conn.execute(
        "UPDATE media_pool_workflow SET
           current_clip_id = ?1,
           mark_in_sec = ?2,
           mark_out_sec = ?3,
           active_virtual_shot_id = ?4,
           updated_at = ?5
         WHERE id = 1",
        params![current_clip_id, mark_in, mark_out, active_shot, now],
    )
    .map_err(|e| e.to_string())?;
    if let Some(ids) = obj.get("selected_clip_ids").and_then(|v| v.as_array()) {
        conn.execute("DELETE FROM media_pool_workflow_selection", [])
            .map_err(|e| e.to_string())?;
        for id in ids.iter().filter_map(|v| v.as_str()) {
            let trimmed = id.trim();
            if trimmed.is_empty() {
                continue;
            }
            conn.execute(
                "INSERT INTO media_pool_workflow_selection (clip_id, added_at) VALUES (?1, ?2)",
                params![trimmed, now],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
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
    if obj
        .get("selected_clip_ids")
        .and_then(|v| v.as_array())
        .is_none()
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
