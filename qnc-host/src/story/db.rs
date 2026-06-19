use rusqlite::Connection;
use serde_json::{json, Value};

use crate::project::db::{open_project, ProjectPaths};

#[derive(Default)]
struct StoryRow {
    selected_part_id: String,
    selected_shot_id: String,
    draft_updated_at: String,
    committed_at: String,
    _updated_at: String,
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
        );",
    )?;
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

fn read_row(conn: &Connection) -> rusqlite::Result<StoryRow> {
    ensure_row(conn)?;
    conn.query_row(
        "SELECT selected_part_id, selected_shot_id,
                COALESCE(draft_updated_at, ''), COALESCE(committed_at, ''), COALESCE(updated_at, '')
         FROM story_state WHERE id = 1",
        [],
        |r| {
            Ok(StoryRow {
                selected_part_id: r.get(0)?,
                selected_shot_id: r.get(1)?,
                draft_updated_at: r.get(2)?,
                committed_at: r.get(3)?,
                _updated_at: r.get(4)?,
            })
        },
    )
}

fn optional_text(value: &str) -> Value {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Value::Null
    } else {
        Value::String(trimmed.to_string())
    }
}

fn snapshot_json(project_id: &str, row: &StoryRow) -> Value {
    json!({
        "project_id": project_id,
        "selected_part_id": row.selected_part_id,
        "selected_shot_id": row.selected_shot_id,
        "parts": [],
        "markers": [],
        "marker_slots": [],
        "covers": [],
        "draft_updated_at": optional_text(&row.draft_updated_at),
        "committed_at": optional_text(&row.committed_at),
        "summary": {
            "part_count": 0,
            "duration_sec": 0,
        },
    })
}

pub fn load_state(paths: &ProjectPaths, project_id: &str) -> Result<Value, String> {
    let pid = project_id.trim();
    let conn = open_project(paths, pid).map_err(|e| e.to_string())?;
    let row = read_row(&conn).map_err(|e| e.to_string())?;
    Ok(snapshot_json(pid, &row))
}
