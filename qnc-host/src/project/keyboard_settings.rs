use rusqlite::Connection;
use serde_json::{json, Value};

use super::db::{get_setting, json_string, parse_json, set_setting};

const KEY: &str = "keyboard_shortcuts_user";

pub fn load_keyboard_user(conn: &Connection) -> rusqlite::Result<Value> {
    let raw = get_setting(conn, KEY, "")?;
    if raw.trim().is_empty() {
        return Ok(json!({}));
    }
    Ok(parse_json(&raw, json!({})))
}

pub fn save_keyboard_user(conn: &Connection, user: &Value) -> rusqlite::Result<Value> {
    let payload = if user.is_object() {
        user.clone()
    } else {
        json!({})
    };
    set_setting(conn, KEY, &json_string(&payload))?;
    Ok(payload)
}
