use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::project::db::{now_str, open_project, ProjectPaths};

use super::markers::{
    create_marker as create_marker_row, delete_marker as delete_marker_row,
    delete_markers_for_part, ensure_marker_schema, ensure_materialized_slots,
    finalize_story_mutation, marker_slots_snapshot, markers_snapshot,
    move_marker as move_marker_row, select_marker_slot as select_marker_slot_row,
};

#[derive(Default)]
pub(crate) struct StoryRow {
    selected_part_id: String,
    selected_shot_id: String,
    pub(crate) selected_slot_id: String,
    draft_updated_at: String,
    committed_at: String,
    _updated_at: String,
}

#[derive(Clone)]
pub(crate) struct StoryPartRow {
    pub(crate) part_id: String,
    kind: String,
    sort_index: i64,
    title: String,
    text: String,
    clip_id: String,
    virtual_shot_id: String,
    in_tc: String,
    out_tc: String,
    in_seconds: Option<f64>,
    out_seconds: Option<f64>,
    created_at: String,
    updated_at: String,
}

fn new_part_id() -> String {
    format!("part_{}", uuid::Uuid::new_v4().simple())
}

fn ensure_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS story_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            selected_part_id TEXT NOT NULL DEFAULT '',
            selected_shot_id TEXT NOT NULL DEFAULT '',
            draft_updated_at TEXT,
            committed_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS story_parts (
            part_id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            sort_index INTEGER NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            text TEXT NOT NULL DEFAULT '',
            clip_id TEXT NOT NULL DEFAULT '',
            virtual_shot_id TEXT NOT NULL DEFAULT '',
            in_tc TEXT NOT NULL DEFAULT '',
            out_tc TEXT NOT NULL DEFAULT '',
            in_seconds REAL,
            out_seconds REAL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_story_parts_sort ON story_parts(sort_index);",
    )?;
    ensure_marker_schema(conn)?;
    Ok(())
}

fn ensure_row(conn: &Connection) -> rusqlite::Result<()> {
    ensure_schema(conn)?;
    conn.execute(
        "INSERT INTO story_state (id) VALUES (1) ON CONFLICT(id) DO NOTHING",
        [],
    )?;
    Ok(())
}

pub(crate) fn read_row(conn: &Connection) -> rusqlite::Result<StoryRow> {
    ensure_row(conn)?;
    conn.query_row(
        "SELECT selected_part_id, selected_shot_id,
                COALESCE(selected_slot_id, ''), COALESCE(draft_updated_at, ''),
                COALESCE(committed_at, ''), COALESCE(updated_at, '')
         FROM story_state WHERE id = 1",
        [],
        |r| {
            Ok(StoryRow {
                selected_part_id: r.get(0)?,
                selected_shot_id: r.get(1)?,
                selected_slot_id: r.get(2)?,
                draft_updated_at: r.get(3)?,
                committed_at: r.get(4)?,
                _updated_at: r.get(5)?,
            })
        },
    )
}

pub(crate) fn touch_draft(conn: &Connection) -> rusqlite::Result<()> {
    let now = now_str();
    conn.execute(
        "UPDATE story_state SET draft_updated_at = ?1, updated_at = ?1 WHERE id = 1",
        params![now],
    )?;
    Ok(())
}

fn optional_text(value: &str) -> Value {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Value::Null
    } else {
        Value::String(trimmed.to_string())
    }
}

fn optional_f64(value: Option<f64>) -> Value {
    match value {
        Some(v) => json!(v),
        None => Value::Null,
    }
}

fn validate_kind(kind: &str) -> Result<&str, String> {
    match kind.trim().to_lowercase().as_str() {
        "tonovi" => Ok("tonovi"),
        "offovi" => Ok("offovi"),
        _ => Err(format!("invalid kind: {kind}")),
    }
}

pub(crate) fn list_parts(conn: &Connection) -> rusqlite::Result<Vec<StoryPartRow>> {
    ensure_schema(conn)?;
    let mut stmt = conn.prepare(
        "SELECT part_id, kind, sort_index, title, text, clip_id, virtual_shot_id,
                in_tc, out_tc, in_seconds, out_seconds, created_at, updated_at
         FROM story_parts
         ORDER BY sort_index ASC, part_id ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(StoryPartRow {
            part_id: r.get(0)?,
            kind: r.get(1)?,
            sort_index: r.get(2)?,
            title: r.get(3)?,
            text: r.get(4)?,
            clip_id: r.get(5)?,
            virtual_shot_id: r.get(6)?,
            in_tc: r.get(7)?,
            out_tc: r.get(8)?,
            in_seconds: r.get(9)?,
            out_seconds: r.get(10)?,
            created_at: r.get(11)?,
            updated_at: r.get(12)?,
        })
    })?;
    rows.collect()
}

fn part_json(row: &StoryPartRow) -> Value {
    json!({
        "part_id": row.part_id,
        "kind": row.kind,
        "sort_index": row.sort_index,
        "title": row.title,
        "text": row.text,
        "clip_id": row.clip_id,
        "virtual_shot_id": row.virtual_shot_id,
        "in_tc": row.in_tc,
        "out_tc": row.out_tc,
        "in_seconds": optional_f64(row.in_seconds),
        "out_seconds": optional_f64(row.out_seconds),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    })
}

fn snapshot_json(
    conn: &Connection,
    project_id: &str,
    row: &StoryRow,
    parts: &[StoryPartRow],
) -> rusqlite::Result<Value> {
    let part_values: Vec<Value> = parts.iter().map(part_json).collect();
    let part_count = parts.len();
    let markers = markers_snapshot(conn)?;
    let marker_slots = marker_slots_snapshot(conn)?;
    Ok(json!({
        "project_id": project_id,
        "selected_part_id": row.selected_part_id,
        "selected_shot_id": row.selected_shot_id,
        "selected_slot_id": row.selected_slot_id,
        "parts": part_values,
        "markers": markers,
        "marker_slots": marker_slots,
        "covers": [],
        "draft_updated_at": optional_text(&row.draft_updated_at),
        "committed_at": optional_text(&row.committed_at),
        "summary": {
            "part_count": part_count,
            "duration_sec": 0,
        },
    }))
}

fn load_snapshot(conn: &Connection, project_id: &str) -> rusqlite::Result<Value> {
    let row = read_row(conn)?;
    ensure_materialized_slots(conn)?;
    let parts = list_parts(conn)?;
    snapshot_json(conn, project_id, &row, &parts)
}

pub fn load_state(paths: &ProjectPaths, project_id: &str) -> Result<Value, String> {
    let pid = project_id.trim();
    let conn = open_project(paths, pid).map_err(|e| e.to_string())?;
    load_snapshot(&conn, pid).map_err(|e| e.to_string())
}

fn next_sort_index(conn: &Connection) -> rusqlite::Result<i64> {
    let max_idx: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_index), -1) FROM story_parts",
        [],
        |r| r.get(0),
    )?;
    Ok(max_idx + 1)
}

fn set_selected_part_id(conn: &Connection, part_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE story_state SET selected_part_id = ?1 WHERE id = 1",
        params![part_id],
    )?;
    Ok(())
}

fn part_exists(conn: &Connection, part_id: &str) -> rusqlite::Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM story_parts WHERE part_id = ?1",
        params![part_id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

fn resolve_selection_after_delete(
    conn: &Connection,
    deleted_id: &str,
    deleted_sort: i64,
) -> rusqlite::Result<String> {
    let row = read_row(conn)?;
    if row.selected_part_id != deleted_id {
        return Ok(row.selected_part_id);
    }
    let neighbor: Option<String> = conn
        .query_row(
            "SELECT part_id FROM story_parts
             WHERE part_id != ?1
             ORDER BY ABS(sort_index - ?2) ASC, sort_index ASC
             LIMIT 1",
            params![deleted_id, deleted_sort],
            |r| r.get(0),
        )
        .ok();
    Ok(neighbor.unwrap_or_default())
}

pub fn create_part(paths: &ProjectPaths, project_id: &str, kind: &str) -> Result<Value, String> {
    let pid = project_id.trim();
    let kind = validate_kind(kind)?;
    let conn = open_project(paths, pid).map_err(|e| e.to_string())?;
    let part_id = new_part_id();
    let now = now_str();
    let sort_index = next_sort_index(&conn).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO story_parts
            (part_id, kind, sort_index, title, text, clip_id, virtual_shot_id,
             in_tc, out_tc, in_seconds, out_seconds, created_at, updated_at)
         VALUES (?1, ?2, ?3, '', '', '', '', '', '', NULL, NULL, ?4, ?4)",
        params![part_id, kind, sort_index, now],
    )
    .map_err(|e| e.to_string())?;
    set_selected_part_id(&conn, &part_id).map_err(|e| e.to_string())?;
    finalize_story_mutation(&conn).map_err(|e| e.to_string())?;
    load_snapshot(&conn, pid).map_err(|e| e.to_string())
}

pub fn update_part(
    paths: &ProjectPaths,
    project_id: &str,
    part_id: &str,
    title: Option<&str>,
    text: Option<&str>,
    kind: Option<&str>,
) -> Result<Value, String> {
    let pid = project_id.trim();
    let part_id = part_id.trim();
    if part_id.is_empty() {
        return Err("part_id required".into());
    }
    let conn = open_project(paths, pid).map_err(|e| e.to_string())?;
    if !part_exists(&conn, part_id).map_err(|e| e.to_string())? {
        return Err(format!("part not found: {part_id}"));
    }
    let now = now_str();
    if let Some(k) = kind {
        let k = validate_kind(k)?;
        conn.execute(
            "UPDATE story_parts SET kind = ?1, updated_at = ?2 WHERE part_id = ?3",
            params![k, now, part_id],
        )
        .map_err(|e| e.to_string())?;
    }
    if title.is_some() || text.is_some() {
        let title = title.unwrap_or("");
        let text = text.unwrap_or("");
        conn.execute(
            "UPDATE story_parts SET title = ?1, text = ?2, updated_at = ?3 WHERE part_id = ?4",
            params![title, text, now, part_id],
        )
        .map_err(|e| e.to_string())?;
    }
    finalize_story_mutation(&conn).map_err(|e| e.to_string())?;
    load_snapshot(&conn, pid).map_err(|e| e.to_string())
}

pub fn delete_part(paths: &ProjectPaths, project_id: &str, part_id: &str) -> Result<Value, String> {
    let pid = project_id.trim();
    let part_id = part_id.trim();
    if part_id.is_empty() {
        return Err("part_id required".into());
    }
    let conn = open_project(paths, pid).map_err(|e| e.to_string())?;
    let deleted_sort: i64 = conn
        .query_row(
            "SELECT sort_index FROM story_parts WHERE part_id = ?1",
            params![part_id],
            |r| r.get(0),
        )
        .map_err(|_| format!("part not found: {part_id}"))?;
    conn.execute(
        "DELETE FROM story_parts WHERE part_id = ?1",
        params![part_id],
    )
    .map_err(|e| e.to_string())?;
    delete_markers_for_part(&conn, part_id).map_err(|e| e.to_string())?;
    let next_selected =
        resolve_selection_after_delete(&conn, part_id, deleted_sort).map_err(|e| e.to_string())?;
    set_selected_part_id(&conn, &next_selected).map_err(|e| e.to_string())?;
    let parts = list_parts(&conn).map_err(|e| e.to_string())?;
    for (idx, part) in parts.iter().enumerate() {
        conn.execute(
            "UPDATE story_parts SET sort_index = ?1 WHERE part_id = ?2",
            params![idx as i64, part.part_id],
        )
        .map_err(|e| e.to_string())?;
    }
    finalize_story_mutation(&conn).map_err(|e| e.to_string())?;
    load_snapshot(&conn, pid).map_err(|e| e.to_string())
}

pub fn reorder_part(
    paths: &ProjectPaths,
    project_id: &str,
    part_id: &str,
    direction: &str,
) -> Result<Value, String> {
    let pid = project_id.trim();
    let part_id = part_id.trim();
    if part_id.is_empty() {
        return Err("part_id required".into());
    }
    let dir = direction.trim().to_lowercase();
    if dir != "up" && dir != "down" {
        return Err(format!("invalid direction: {direction}"));
    }
    let conn = open_project(paths, pid).map_err(|e| e.to_string())?;
    let mut parts = list_parts(&conn).map_err(|e| e.to_string())?;
    let idx = parts
        .iter()
        .position(|p| p.part_id == part_id)
        .ok_or_else(|| format!("part not found: {part_id}"))?;
    let swap_with = if dir == "up" {
        if idx == 0 {
            return load_snapshot(&conn, pid).map_err(|e| e.to_string());
        }
        idx - 1
    } else if idx + 1 >= parts.len() {
        return load_snapshot(&conn, pid).map_err(|e| e.to_string());
    } else {
        idx + 1
    };
    parts.swap(idx, swap_with);
    for (i, part) in parts.iter().enumerate() {
        conn.execute(
            "UPDATE story_parts SET sort_index = ?1, updated_at = ?2 WHERE part_id = ?3",
            params![i as i64, now_str(), part.part_id],
        )
        .map_err(|e| e.to_string())?;
    }
    finalize_story_mutation(&conn).map_err(|e| e.to_string())?;
    load_snapshot(&conn, pid).map_err(|e| e.to_string())
}

pub fn select_part(paths: &ProjectPaths, project_id: &str, part_id: &str) -> Result<Value, String> {
    let pid = project_id.trim();
    let part_id = part_id.trim();
    if part_id.is_empty() {
        return Err("part_id required".into());
    }
    let conn = open_project(paths, pid).map_err(|e| e.to_string())?;
    if !part_exists(&conn, part_id).map_err(|e| e.to_string())? {
        return Err(format!("part not found: {part_id}"));
    }
    set_selected_part_id(&conn, part_id).map_err(|e| e.to_string())?;
    touch_draft(&conn).map_err(|e| e.to_string())?;
    load_snapshot(&conn, pid).map_err(|e| e.to_string())
}

pub fn create_marker(
    paths: &ProjectPaths,
    project_id: &str,
    after_part_id: &str,
    label: Option<&str>,
) -> Result<Value, String> {
    let pid = project_id.trim();
    let conn = open_project(paths, pid).map_err(|e| e.to_string())?;
    create_marker_row(&conn, after_part_id, label)?;
    load_snapshot(&conn, pid).map_err(|e| e.to_string())
}

pub fn delete_marker(
    paths: &ProjectPaths,
    project_id: &str,
    marker_id: &str,
) -> Result<Value, String> {
    let pid = project_id.trim();
    let conn = open_project(paths, pid).map_err(|e| e.to_string())?;
    delete_marker_row(&conn, marker_id)?;
    load_snapshot(&conn, pid).map_err(|e| e.to_string())
}

pub fn move_marker(
    paths: &ProjectPaths,
    project_id: &str,
    marker_id: &str,
    direction: &str,
) -> Result<Value, String> {
    let pid = project_id.trim();
    let conn = open_project(paths, pid).map_err(|e| e.to_string())?;
    move_marker_row(&conn, marker_id, direction)?;
    load_snapshot(&conn, pid).map_err(|e| e.to_string())
}

pub fn select_marker_slot(
    paths: &ProjectPaths,
    project_id: &str,
    slot_id: &str,
) -> Result<Value, String> {
    let pid = project_id.trim();
    let conn = open_project(paths, pid).map_err(|e| e.to_string())?;
    select_marker_slot_row(&conn, slot_id)?;
    load_snapshot(&conn, pid).map_err(|e| e.to_string())
}
