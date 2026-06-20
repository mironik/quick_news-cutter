use rusqlite::{params, Connection};
use serde_json::{json, Value};

use super::db::{list_parts, read_row, touch_draft, StoryPartRow};

#[derive(Clone)]
pub struct StoryMarkerRow {
    pub marker_id: String,
    pub sort_index: i64,
    pub after_part_id: String,
    pub label: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone)]
pub struct StoryMarkerSlotRow {
    pub slot_id: String,
    pub slot_index: i64,
    pub start_marker_id: String,
    pub end_marker_id: String,
    pub part_ids_json: String,
    pub duration_sec: f64,
    pub updated_at: String,
}

pub fn ensure_marker_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS story_markers (
            marker_id TEXT PRIMARY KEY,
            sort_index INTEGER NOT NULL,
            after_part_id TEXT NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_story_markers_sort ON story_markers(sort_index);
        CREATE TABLE IF NOT EXISTS story_marker_slots (
            slot_id TEXT PRIMARY KEY,
            slot_index INTEGER NOT NULL,
            start_marker_id TEXT NOT NULL DEFAULT '',
            end_marker_id TEXT NOT NULL DEFAULT '',
            part_ids_json TEXT NOT NULL DEFAULT '[]',
            duration_sec REAL NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_story_marker_slots_sort ON story_marker_slots(slot_index);",
    )?;
    let _ = conn.execute(
        "ALTER TABLE story_state ADD COLUMN selected_slot_id TEXT NOT NULL DEFAULT ''",
        [],
    );
    Ok(())
}

fn new_marker_id() -> String {
    format!("marker_{}", uuid::Uuid::new_v4().simple())
}

fn list_markers(conn: &Connection) -> rusqlite::Result<Vec<StoryMarkerRow>> {
    ensure_marker_schema(conn)?;
    let mut stmt = conn.prepare(
        "SELECT marker_id, sort_index, after_part_id, label, created_at, updated_at
         FROM story_markers
         ORDER BY sort_index ASC, marker_id ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(StoryMarkerRow {
            marker_id: r.get(0)?,
            sort_index: r.get(1)?,
            after_part_id: r.get(2)?,
            label: r.get(3)?,
            created_at: r.get(4)?,
            updated_at: r.get(5)?,
        })
    })?;
    rows.collect()
}

fn list_marker_slots(conn: &Connection) -> rusqlite::Result<Vec<StoryMarkerSlotRow>> {
    ensure_marker_schema(conn)?;
    let mut stmt = conn.prepare(
        "SELECT slot_id, slot_index, start_marker_id, end_marker_id, part_ids_json, duration_sec, updated_at
         FROM story_marker_slots
         ORDER BY slot_index ASC, slot_id ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(StoryMarkerSlotRow {
            slot_id: r.get(0)?,
            slot_index: r.get(1)?,
            start_marker_id: r.get(2)?,
            end_marker_id: r.get(3)?,
            part_ids_json: r.get(4)?,
            duration_sec: r.get(5)?,
            updated_at: r.get(6)?,
        })
    })?;
    rows.collect()
}

pub fn marker_json(row: &StoryMarkerRow) -> Value {
    json!({
        "marker_id": row.marker_id,
        "sort_index": row.sort_index,
        "after_part_id": row.after_part_id,
        "label": row.label,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    })
}

pub fn marker_slot_json(row: &StoryMarkerSlotRow) -> Value {
    let part_ids: Value = serde_json::from_str(&row.part_ids_json).unwrap_or_else(|_| json!([]));
    json!({
        "slot_id": row.slot_id,
        "slot_index": row.slot_index,
        "start_marker_id": row.start_marker_id,
        "end_marker_id": row.end_marker_id,
        "part_ids": part_ids,
        "duration_sec": row.duration_sec,
        "updated_at": row.updated_at,
    })
}

pub fn markers_snapshot(conn: &Connection) -> rusqlite::Result<Vec<Value>> {
    Ok(list_markers(conn)?.iter().map(marker_json).collect())
}

pub fn marker_slots_snapshot(conn: &Connection) -> rusqlite::Result<Vec<Value>> {
    Ok(list_marker_slots(conn)?
        .iter()
        .map(marker_slot_json)
        .collect())
}

fn normalize_selected_slot_id(conn: &Connection, selected: &str) -> rusqlite::Result<String> {
    let selected = selected.trim();
    if selected.is_empty() {
        return Ok(String::new());
    }
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM story_marker_slots WHERE slot_id = ?1",
        params![selected],
        |r| r.get(0),
    )?;
    if exists > 0 {
        Ok(selected.to_string())
    } else {
        Ok(String::new())
    }
}

fn set_selected_slot_id(conn: &Connection, slot_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE story_state SET selected_slot_id = ?1 WHERE id = 1",
        params![slot_id],
    )?;
    Ok(())
}

fn part_index(parts: &[StoryPartRow], part_id: &str) -> Option<usize> {
    parts.iter().position(|p| p.part_id == part_id)
}

fn sort_markers_for_parts(parts: &[StoryPartRow], markers: &mut [StoryMarkerRow]) {
    markers.sort_by(|a, b| {
        let ai = part_index(parts, &a.after_part_id).unwrap_or(usize::MAX);
        let bi = part_index(parts, &b.after_part_id).unwrap_or(usize::MAX);
        ai.cmp(&bi).then(a.marker_id.cmp(&b.marker_id))
    });
}

pub fn recompute_marker_slots(conn: &Connection, parts: &[StoryPartRow]) -> rusqlite::Result<()> {
    ensure_marker_schema(conn)?;
    let now = crate::project::db::now_str();
    let mut markers = list_markers(conn)?;
    markers.retain(|m| part_index(parts, &m.after_part_id).is_some());
    for (i, marker) in markers.iter().enumerate() {
        conn.execute(
            "UPDATE story_markers SET sort_index = ?1 WHERE marker_id = ?2",
            params![i as i64, marker.marker_id],
        )?;
    }
    sort_markers_for_parts(parts, &mut markers);

    conn.execute("DELETE FROM story_marker_slots", [])?;

    let mut slots: Vec<(String, String, String, Vec<String>)> = Vec::new();
    if markers.is_empty() {
        if !parts.is_empty() {
            let part_ids: Vec<String> = parts.iter().map(|p| p.part_id.clone()).collect();
            slots.push((String::new(), String::new(), "slot_0".to_string(), part_ids));
        }
    } else {
        let mut start_idx = 0usize;
        for (slot_i, marker) in markers.iter().enumerate() {
            let after_idx = part_index(parts, &marker.after_part_id).unwrap_or(0);
            if start_idx <= after_idx && after_idx < parts.len() {
                let part_ids: Vec<String> = parts[start_idx..=after_idx]
                    .iter()
                    .map(|p| p.part_id.clone())
                    .collect();
                let start_marker = if slot_i == 0 {
                    String::new()
                } else {
                    markers[slot_i - 1].marker_id.clone()
                };
                slots.push((
                    start_marker,
                    marker.marker_id.clone(),
                    format!("slot_{slot_i}"),
                    part_ids,
                ));
                start_idx = after_idx + 1;
            }
        }
        if start_idx < parts.len() {
            let part_ids: Vec<String> = parts[start_idx..]
                .iter()
                .map(|p| p.part_id.clone())
                .collect();
            let start_marker = markers
                .last()
                .map(|m| m.marker_id.clone())
                .unwrap_or_default();
            slots.push((
                start_marker,
                String::new(),
                format!("slot_{}", slots.len()),
                part_ids,
            ));
        }
    }

    for (slot_index, (start_marker_id, end_marker_id, slot_id, part_ids)) in
        slots.into_iter().enumerate()
    {
        let part_ids_json = serde_json::to_string(&part_ids).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT INTO story_marker_slots
                (slot_id, slot_index, start_marker_id, end_marker_id, part_ids_json, duration_sec, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
            params![
                slot_id,
                slot_index as i64,
                start_marker_id,
                end_marker_id,
                part_ids_json,
                now,
            ],
        )?;
    }

    let row = read_row(conn)?;
    let normalized = normalize_selected_slot_id(conn, &row.selected_slot_id)?;
    if normalized != row.selected_slot_id {
        set_selected_slot_id(conn, &normalized)?;
    }
    Ok(())
}

pub fn finalize_story_mutation(conn: &Connection) -> rusqlite::Result<()> {
    let parts = list_parts(conn)?;
    recompute_marker_slots(conn, &parts)?;
    touch_draft(conn)
}

fn next_marker_sort_index(conn: &Connection) -> rusqlite::Result<i64> {
    let max_idx: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_index), -1) FROM story_markers",
        [],
        |r| r.get(0),
    )?;
    Ok(max_idx + 1)
}

pub fn create_marker(
    conn: &Connection,
    after_part_id: &str,
    label: Option<&str>,
) -> Result<(), String> {
    let after_part_id = after_part_id.trim();
    if after_part_id.is_empty() {
        return Err("after_part_id required".into());
    }
    let parts = list_parts(conn).map_err(|e| e.to_string())?;
    if !parts.iter().any(|p| p.part_id == after_part_id) {
        return Err(format!("part not found: {after_part_id}"));
    }
    let existing: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM story_markers WHERE after_part_id = ?1",
            params![after_part_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if existing > 0 {
        return Err(format!("marker already exists after part: {after_part_id}"));
    }
    let marker_id = new_marker_id();
    let now = crate::project::db::now_str();
    let sort_index = next_marker_sort_index(conn).map_err(|e| e.to_string())?;
    let label = label.unwrap_or("").trim();
    conn.execute(
        "INSERT INTO story_markers (marker_id, sort_index, after_part_id, label, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![marker_id, sort_index, after_part_id, label, now],
    )
    .map_err(|e| e.to_string())?;
    finalize_story_mutation(conn).map_err(|e| e.to_string())
}

pub fn delete_marker(conn: &Connection, marker_id: &str) -> Result<(), String> {
    let marker_id = marker_id.trim();
    if marker_id.is_empty() {
        return Err("marker_id required".into());
    }
    let n = conn
        .execute(
            "DELETE FROM story_markers WHERE marker_id = ?1",
            params![marker_id],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err(format!("marker not found: {marker_id}"));
    }
    finalize_story_mutation(conn).map_err(|e| e.to_string())
}

pub fn move_marker(conn: &Connection, marker_id: &str, direction: &str) -> Result<(), String> {
    let marker_id = marker_id.trim();
    if marker_id.is_empty() {
        return Err("marker_id required".into());
    }
    let dir = direction.trim().to_lowercase();
    if dir != "up" && dir != "down" {
        return Err(format!("invalid direction: {direction}"));
    }
    let parts = list_parts(conn).map_err(|e| e.to_string())?;
    let mut markers = list_markers(conn).map_err(|e| e.to_string())?;
    sort_markers_for_parts(&parts, &mut markers);
    let idx = markers
        .iter()
        .position(|m| m.marker_id == marker_id)
        .ok_or_else(|| format!("marker not found: {marker_id}"))?;
    let swap_with = if dir == "up" {
        if idx == 0 {
            return Ok(());
        }
        idx - 1
    } else if idx + 1 >= markers.len() {
        return Ok(());
    } else {
        idx + 1
    };
    let a_after = markers[idx].after_part_id.clone();
    let b_after = markers[swap_with].after_part_id.clone();
    let now = crate::project::db::now_str();
    conn.execute(
        "UPDATE story_markers SET after_part_id = ?1, updated_at = ?2 WHERE marker_id = ?3",
        params![b_after, now, marker_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE story_markers SET after_part_id = ?1, updated_at = ?2 WHERE marker_id = ?3",
        params![a_after, now, markers[swap_with].marker_id],
    )
    .map_err(|e| e.to_string())?;
    finalize_story_mutation(conn).map_err(|e| e.to_string())
}

pub fn select_marker_slot(conn: &Connection, slot_id: &str) -> Result<(), String> {
    let slot_id = slot_id.trim();
    if slot_id.is_empty() {
        return Err("slot_id required".into());
    }
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM story_marker_slots WHERE slot_id = ?1",
            params![slot_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists == 0 {
        return Err(format!("slot not found: {slot_id}"));
    }
    set_selected_slot_id(conn, slot_id).map_err(|e| e.to_string())?;
    touch_draft(conn).map_err(|e| e.to_string())
}

pub fn delete_markers_for_part(conn: &Connection, part_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM story_markers WHERE after_part_id = ?1",
        params![part_id],
    )?;
    Ok(())
}

pub fn ensure_materialized_slots(conn: &Connection) -> rusqlite::Result<()> {
    let parts = list_parts(conn)?;
    if parts.is_empty() {
        return Ok(());
    }
    let slot_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM story_marker_slots", [], |r| r.get(0))?;
    if slot_count == 0 {
        recompute_marker_slots(conn, &parts)?;
    }
    Ok(())
}
