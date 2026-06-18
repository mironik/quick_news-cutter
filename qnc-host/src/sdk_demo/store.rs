use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

use serde_json::{json, Value};

use crate::project::db::now_str;

#[derive(Clone, Debug, Default)]
struct DemoState {
    counter: u32,
    updated_at: String,
}

static DEMO_STORE: OnceLock<RwLock<HashMap<String, DemoState>>> = OnceLock::new();

fn store() -> &'static RwLock<HashMap<String, DemoState>> {
    DEMO_STORE.get_or_init(|| RwLock::new(HashMap::new()))
}

fn snapshot_json(project_id: &str, state: &DemoState) -> Value {
    json!({
        "project_id": project_id,
        "counter": state.counter,
        "persistence": "in_memory_demo",
        "updated_at": state.updated_at,
    })
}

pub fn load_state(project_id: &str) -> Value {
    let pid = project_id.trim();
    let guard = store().read().expect("sdk_demo store read");
    let state = guard.get(pid).cloned().unwrap_or_default();
    snapshot_json(pid, &state)
}

pub fn increment(project_id: &str, step: u32) -> Value {
    let pid = project_id.trim().to_string();
    let mut guard = store().write().expect("sdk_demo store write");
    let entry = guard.entry(pid.clone()).or_default();
    entry.counter = entry.counter.saturating_add(step);
    entry.updated_at = now_str();
    snapshot_json(&pid, entry)
}

pub fn reset(project_id: &str) -> Value {
    let pid = project_id.trim().to_string();
    let mut guard = store().write().expect("sdk_demo store write");
    let entry = guard.entry(pid.clone()).or_default();
    entry.counter = 0;
    entry.updated_at = now_str();
    snapshot_json(&pid, entry)
}

pub fn clamp_step(step: Option<u32>) -> u32 {
    match step.unwrap_or(1) {
        0 => 1,
        n if n > 10 => 10,
        n => n,
    }
}
