use std::fs;

use rusqlite::{params, Connection};
use serde_json::{json, Value};

use super::db::{
    deep_merge, ensure_project_dirs_at, export_dir_from_settings, export_projects_json,
    json_string, now_str, open_project, parse_json, project_dir_in_root,
    project_root_from_settings, slug_id, ProjectPaths,
};
use super::store::{record_project_opened, set_active_project_id, upsert_project_meta};

#[derive(serde::Deserialize)]
struct SeedFile {
    source_templates: Vec<Value>,
    project_templates: Vec<Value>,
}

fn load_seed(seed_path: &std::path::Path) -> SeedFile {
    let fallback = SeedFile {
        source_templates: vec![],
        project_templates: vec![],
    };
    let Ok(raw) = fs::read_to_string(seed_path) else {
        return fallback;
    };
    serde_json::from_str(&raw).unwrap_or(fallback)
}

pub fn ensure_templates_seeded(
    conn: &Connection,
    seed_path: &std::path::Path,
) -> rusqlite::Result<()> {
    let seed = load_seed(seed_path);
    let now = now_str();
    for src in seed.source_templates {
        let id = src
            .get("source_template_id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if id.is_empty() {
            continue;
        }
        let config = src.get("config").cloned().unwrap_or_else(|| json!({}));
        conn.execute(
            "INSERT INTO source_templates
                (source_template_id, name, description, source_kind, system, config_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?6)
             ON CONFLICT(source_template_id) DO NOTHING",
            params![
                id,
                src.get("name").and_then(|v| v.as_str()).unwrap_or(id),
                src.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                src.get("source_kind").and_then(|v| v.as_str()).unwrap_or("local"),
                json_string(&config),
                now,
            ],
        )?;
    }
    for tpl in seed.project_templates {
        let id = tpl
            .get("template_id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if id.is_empty() {
            continue;
        }
        let settings = tpl.get("settings").cloned().unwrap_or_else(|| json!({}));
        let source_ids = tpl
            .get("source_template_ids")
            .cloned()
            .unwrap_or_else(|| json!([]));
        conn.execute(
            "INSERT INTO project_templates
                (template_id, name, description, system, settings_json, source_template_ids_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?6)
             ON CONFLICT(template_id) DO NOTHING",
            params![
                id,
                tpl.get("name").and_then(|v| v.as_str()).unwrap_or(id),
                tpl.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                json_string(&settings),
                json_string(&source_ids),
                now,
            ],
        )?;
    }
    Ok(())
}

fn template_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let settings_raw: String = row.get("settings_json")?;
    let sources_raw: String = row.get("source_template_ids_json")?;
    Ok(json!({
        "template_id": row.get::<_, String>("template_id")?,
        "name": row.get::<_, String>("name")?,
        "description": row.get::<_, String>("description")?,
        "system": row.get::<_, i64>("system")? != 0,
        "settings": parse_json(&settings_raw, json!({})),
        "source_template_ids": parse_json(&sources_raw, json!([])),
        "created_by": row.get::<_, Option<String>>("created_by")?,
        "updated_by": row.get::<_, Option<String>>("updated_by")?,
        "created_at": row.get::<_, Option<String>>("created_at")?,
        "updated_at": row.get::<_, Option<String>>("updated_at")?,
    }))
}

fn source_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let config_raw: String = row.get("config_json")?;
    Ok(json!({
        "source_template_id": row.get::<_, String>("source_template_id")?,
        "name": row.get::<_, String>("name")?,
        "description": row.get::<_, String>("description")?,
        "source_kind": row.get::<_, String>("source_kind")?,
        "system": row.get::<_, i64>("system")? != 0,
        "config": parse_json(&config_raw, json!({})),
    }))
}

pub fn list_source_templates(conn: &Connection) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare("SELECT * FROM source_templates ORDER BY name")?;
    let rows = stmt.query_map([], source_row)?;
    rows.collect()
}

pub fn list_project_templates(conn: &Connection) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare("SELECT * FROM project_templates ORDER BY system DESC, name")?;
    let rows = stmt.query_map([], template_row)?;
    rows.collect()
}

pub fn get_project_template(
    conn: &Connection,
    template_id: &str,
) -> rusqlite::Result<Option<Value>> {
    let mut stmt = conn.prepare("SELECT * FROM project_templates WHERE template_id = ?1")?;
    let mut rows = stmt.query_map(params![template_id.trim()], template_row)?;
    rows.next().transpose()
}

pub fn get_project_settings(paths: &ProjectPaths, project_id: &str) -> rusqlite::Result<Value> {
    let pid = project_id.trim();
    let conn = open_project(paths, pid)?;
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT template_id, settings_json FROM project_settings WHERE project_id = ?1",
            params![pid],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let Some((template_id, settings_raw)) = row else {
        return Ok(json!({}));
    };
    Ok(json!({
        "project_id": pid,
        "template_id": template_id,
        "settings": parse_json(&settings_raw, json!({})),
    }))
}

pub fn get_project_workspace(paths: &ProjectPaths, project_id: &str) -> rusqlite::Result<Value> {
    let item = get_project_settings(paths, project_id)?;
    let settings = item.get("settings").cloned().unwrap_or_else(|| json!({}));
    let conn = open_project(paths, project_id)?;
    ensure_project_workflow(&conn, project_id, &settings)?;
    let steps = list_workflow_steps(&conn, project_id)?;
    let state = workflow_state(&conn, project_id)?;
    let tabs = steps
        .iter()
        .filter_map(|s| s.get("tab_id").and_then(|v| v.as_str()).map(str::to_string))
        .collect::<Vec<_>>();
    let mut labels = serde_json::Map::new();
    for step in &steps {
        if let (Some(tab_id), Some(label)) = (
            step.get("tab_id").and_then(|v| v.as_str()),
            step.get("label").and_then(|v| v.as_str()),
        ) {
            labels.insert(tab_id.to_string(), json!(label));
        }
    }
    Ok(json!({
        "project_id": project_id,
        "template_id": item.get("template_id").cloned().unwrap_or(Value::Null),
        "tabs": tabs,
        "tab_labels": Value::Object(labels),
        "steps": steps,
        "active_step_id": state.get("active_step_id").cloned().unwrap_or(Value::Null),
        "entry_step_id": state.get("entry_step_id").cloned().unwrap_or(Value::Null),
        "modules": [],
    }))
}

pub fn save_project_settings(
    paths: &ProjectPaths,
    project_id: &str,
    settings: &Value,
    template_id: &str,
    user_id: &str,
) -> rusqlite::Result<Value> {
    let pid = project_id.trim();
    let conn = open_project(paths, pid)?;
    let now = now_str();
    let existing: Option<(Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT created_at, created_by FROM project_settings WHERE project_id = ?1",
            params![pid],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let (created_at, created_by) = existing.unwrap_or((None, None));
    let created_by_val = created_by.unwrap_or_else(|| user_id.to_string());
    conn.execute(
        "INSERT INTO project_settings
            (project_id, template_id, settings_json, created_by, updated_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(project_id) DO UPDATE SET
            template_id = excluded.template_id,
            settings_json = excluded.settings_json,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at",
        params![
            pid,
            template_id,
            json_string(settings),
            if created_by_val.is_empty() {
                user_id
            } else {
                &created_by_val
            },
            user_id,
            created_at.unwrap_or_else(|| now.clone()),
            now,
        ],
    )?;
    get_project_settings(paths, pid)
}

pub fn create_user_template(
    conn: &Connection,
    name: &str,
    description: &str,
    settings: Option<&Value>,
    source_template_ids: Option<&Value>,
    user_id: &str,
    base_template_id: &str,
) -> rusqlite::Result<Value> {
    let base = if base_template_id.is_empty() {
        None
    } else {
        get_project_template(conn, base_template_id)?
    };
    let payload = match (settings, &base) {
        (Some(s), Some(b)) => deep_merge(b.get("settings").unwrap_or(&json!({})), s),
        (Some(s), None) => s.clone(),
        (None, Some(b)) => b.get("settings").cloned().unwrap_or_else(|| json!({})),
        (None, None) => json!({}),
    };
    let source_ids = source_template_ids
        .cloned()
        .or_else(|| {
            base.as_ref()
                .and_then(|b| b.get("source_template_ids").cloned())
        })
        .unwrap_or_else(|| json!([]));
    let template_id = format!("tpl_user_{}_{}", slug_id(name), now_str());
    let now = now_str();
    conn.execute(
        "INSERT INTO project_templates
            (template_id, name, description, system, settings_json, source_template_ids_json,
             created_by, updated_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6, ?6, ?7, ?7)",
        params![
            template_id,
            name.trim(),
            description.trim(),
            json_string(&payload),
            json_string(&source_ids),
            user_id,
            now,
        ],
    )?;
    get_project_template(conn, &template_id)?
        .ok_or_else(|| rusqlite::Error::InvalidParameterName("template insert failed".into()))
}

pub fn create_project_from_template(
    global: &Connection,
    paths: &ProjectPaths,
    name: &str,
    template_id: &str,
    settings_override: Option<&Value>,
    user_id: &str,
) -> rusqlite::Result<Value> {
    let template = get_project_template(global, template_id)?
        .ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)?;
    let label = name.trim();
    let label = if label.is_empty() {
        "QNC projekt"
    } else {
        label
    };
    let project_id = slug_id(label);
    let mut settings = template
        .get("settings")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if let Some(ov) = settings_override {
        settings = deep_merge(&settings, ov);
    }
    if let Value::Object(ref mut map) = settings {
        map.insert(
            "template".into(),
            json!({
                "template_id": template.get("template_id"),
                "name": template.get("name"),
                "system": template.get("system"),
            }),
        );
        map.insert(
            "source_template_ids".into(),
            template
                .get("source_template_ids")
                .cloned()
                .unwrap_or_else(|| json!([])),
        );
    }
    let projects_root =
        project_root_from_settings(&settings).unwrap_or_else(|| paths.projects_root.clone());
    let project_dir = project_dir_in_root(&projects_root, &project_id);
    ensure_project_dirs_at(&project_dir)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    if let Some(export_dir) = export_dir_from_settings(&settings) {
        fs::create_dir_all(export_dir)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    }
    upsert_project_meta(global, &project_id, label, None, Some(&project_dir))?;
    let tpl_id = template
        .get("template_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let saved = save_project_settings(paths, &project_id, &settings, tpl_id, user_id)?;
    let project_conn = open_project(paths, &project_id)?;
    save_template_snapshot(&project_conn, &project_id, &template)?;
    write_project_workflow(&project_conn, &project_id, &settings)?;
    set_active_project_id(global, &project_id)?;
    record_project_opened(global, &project_id)?;
    export_projects_json(paths, global);
    Ok(json!({
        "project": {
            "project_id": project_id,
            "name": label,
            "created_at": now_str(),
            "template_id": tpl_id,
        },
        "settings": saved,
    }))
}

fn workflow_tabs_from_settings(settings: &Value) -> (Vec<String>, Value) {
    let workspace = settings
        .get("workspace")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let mut tabs = workspace
        .get("tabs")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();
    tabs.dedup();
    if !tabs.iter().any(|t| t == "project") {
        tabs.insert(0, "project".to_string());
    }
    let labels = workspace
        .get("tab_labels")
        .cloned()
        .unwrap_or_else(|| json!({}));
    (tabs, labels)
}

fn label_for_tab(tab_id: &str, labels: &Value) -> String {
    labels
        .get(tab_id)
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| {
            if tab_id == "project" {
                "Project".to_string()
            } else {
                tab_id.replace('_', " ")
            }
        })
}

fn plugin_id_for_tab(tab_id: &str) -> String {
    match tab_id {
        "pool" => "media_pool".to_string(),
        other => other.to_string(),
    }
}

fn step_id_for_tab(tab_id: &str) -> String {
    format!("step_{tab_id}")
}

fn save_template_snapshot(
    conn: &Connection,
    project_id: &str,
    template: &Value,
) -> rusqlite::Result<()> {
    let now = now_str();
    let template_id = template
        .get("template_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let template_name = template.get("name").and_then(|v| v.as_str()).unwrap_or("");
    conn.execute(
        "INSERT INTO project_template_snapshot
            (project_id, template_id, template_name, template_version, snapshot_json, created_at)
         VALUES (?1, ?2, ?3, '', ?4, ?5)
         ON CONFLICT(project_id) DO UPDATE SET
            template_id = excluded.template_id,
            template_name = excluded.template_name,
            snapshot_json = excluded.snapshot_json",
        params![
            project_id,
            template_id,
            template_name,
            json_string(template),
            now
        ],
    )?;
    Ok(())
}

fn write_project_workflow(
    conn: &Connection,
    project_id: &str,
    settings: &Value,
) -> rusqlite::Result<()> {
    let (tabs, labels) = workflow_tabs_from_settings(settings);
    conn.execute(
        "DELETE FROM project_workflow_steps WHERE project_id = ?1",
        params![project_id],
    )?;
    let mut entry_step_id = String::new();
    let mut previous_step_id = String::new();
    for (idx, tab_id) in tabs.iter().enumerate() {
        let step_id = step_id_for_tab(tab_id);
        if tab_id != "project" && entry_step_id.is_empty() {
            entry_step_id = step_id.clone();
        }
        if !previous_step_id.is_empty() {
            conn.execute(
                "UPDATE project_workflow_steps SET next_step_id = ?2 WHERE project_id = ?1 AND step_id = ?3",
                params![project_id, step_id, previous_step_id],
            )?;
        }
        let status = if tab_id == "project" {
            "complete"
        } else if step_id == entry_step_id {
            "active"
        } else {
            "locked"
        };
        conn.execute(
            "INSERT INTO project_workflow_steps
                (step_id, project_id, plugin_id, tab_id, label, position, status, next_step_id, settings_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, '{}')",
            params![
                step_id,
                project_id,
                plugin_id_for_tab(tab_id),
                tab_id,
                label_for_tab(tab_id, &labels),
                idx as i64,
                status,
            ],
        )?;
        previous_step_id = step_id;
    }
    let active_step_id = if entry_step_id.is_empty() {
        step_id_for_tab("project")
    } else {
        entry_step_id.clone()
    };
    let now = now_str();
    conn.execute(
        "INSERT INTO project_workflow_state (project_id, active_step_id, entry_step_id, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(project_id) DO UPDATE SET
            active_step_id = excluded.active_step_id,
            entry_step_id = excluded.entry_step_id,
            updated_at = excluded.updated_at",
        params![project_id, active_step_id, entry_step_id, now],
    )?;
    Ok(())
}

fn ensure_project_workflow(
    conn: &Connection,
    project_id: &str,
    settings: &Value,
) -> rusqlite::Result<()> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM project_workflow_steps WHERE project_id = ?1",
        params![project_id],
        |r| r.get(0),
    )?;
    if count == 0 {
        write_project_workflow(conn, project_id, settings)?;
    }
    Ok(())
}

fn list_workflow_steps(conn: &Connection, project_id: &str) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT step_id, plugin_id, tab_id, label, position, status, next_step_id, settings_json
         FROM project_workflow_steps
         WHERE project_id = ?1
         ORDER BY position, step_id",
    )?;
    let rows = stmt.query_map(params![project_id], |r| {
        let settings_raw: String = r.get(7)?;
        Ok(json!({
            "step_id": r.get::<_, String>(0)?,
            "plugin_id": r.get::<_, String>(1)?,
            "tab_id": r.get::<_, String>(2)?,
            "label": r.get::<_, String>(3)?,
            "position": r.get::<_, i64>(4)?,
            "status": r.get::<_, String>(5)?,
            "next_step_id": r.get::<_, Option<String>>(6)?,
            "settings": parse_json(&settings_raw, json!({})),
        }))
    })?;
    rows.collect()
}

fn workflow_state(conn: &Connection, project_id: &str) -> rusqlite::Result<Value> {
    let row: Option<(Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT active_step_id, entry_step_id FROM project_workflow_state WHERE project_id = ?1",
            params![project_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let Some((active_step_id, entry_step_id)) = row else {
        return Ok(json!({}));
    };
    Ok(json!({
        "active_step_id": active_step_id,
        "entry_step_id": entry_step_id,
    }))
}
