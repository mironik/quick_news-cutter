use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Default, Serialize, Deserialize)]
struct ModuleStateFile {
    #[serde(default)]
    enabled: HashMap<String, bool>,
}

#[derive(Clone)]
pub struct ModuleStore {
    enabled: HashMap<String, bool>,
}

pub enum ModuleError {
    NotFound,
    NotRemovable,
}

impl ModuleStore {
    pub fn load(data_dir: &Path) -> Self {
        let path = data_dir.join("shell_module_state.json");
        let enabled = match fs::read_to_string(&path) {
            Ok(raw) => serde_json::from_str::<ModuleStateFile>(&raw)
                .map(|s| s.enabled)
                .unwrap_or_default(),
            Err(_) => HashMap::new(),
        };
        Self { enabled }
    }

    fn save(&self, data_dir: &Path) -> std::io::Result<()> {
        fs::create_dir_all(data_dir)?;
        let path = data_dir.join("shell_module_state.json");
        let payload = ModuleStateFile {
            enabled: self.enabled.clone(),
        };
        fs::write(path, serde_json::to_string_pretty(&payload)?)
    }

    pub fn apply_enabled(&self, root: &Path, manifests: Vec<Value>) -> Vec<Value> {
        let design_cap = crate::design::design_editor_capability(root);
        let design_available = design_cap
            .get("available")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let design_default = design_cap
            .get("default_enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        manifests
            .into_iter()
            .filter_map(|mut m| {
                let tab_id = m
                    .get("tab_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if tab_id.is_empty() {
                    return None;
                }
                let requires = m
                    .get("requires_capability")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if requires == "design_editor" && !design_available {
                    return None;
                }
                let default_enabled = m.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
                let mut enabled = self
                    .enabled
                    .get(&tab_id)
                    .copied()
                    .unwrap_or(default_enabled);
                if tab_id == "design-tools"
                    && design_available
                    && design_default
                    && !self.enabled.contains_key(&tab_id)
                {
                    enabled = true;
                }
                if !enabled {
                    return None;
                }
                if let Some(obj) = m.as_object_mut() {
                    obj.insert("enabled".into(), json!(enabled));
                    obj.insert("module_id".into(), json!(tab_id));
                }
                Some(m)
            })
            .collect()
    }

    pub fn as_module_list(&self, manifests: Vec<Value>) -> Vec<Value> {
        manifests
            .into_iter()
            .filter_map(|mut m| {
                let tab_id = m
                    .get("tab_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if tab_id.is_empty() {
                    return None;
                }
                let default_enabled = m.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
                let enabled = self
                    .enabled
                    .get(&tab_id)
                    .copied()
                    .unwrap_or(default_enabled);
                if let Some(obj) = m.as_object_mut() {
                    obj.insert("module_id".into(), json!(tab_id));
                    obj.insert("enabled".into(), json!(enabled));
                }
                Some(m)
            })
            .collect()
    }

    pub fn set_enabled(
        &mut self,
        data_dir: &Path,
        manifests: &[Value],
        module_id: &str,
        enabled: bool,
    ) -> Result<Value, ModuleError> {
        let manifest = manifests
            .iter()
            .find(|m| m.get("tab_id").and_then(|v| v.as_str()) == Some(module_id))
            .ok_or(ModuleError::NotFound)?;

        if !enabled && manifest.get("removable").and_then(|v| v.as_bool()) == Some(false) {
            return Err(ModuleError::NotRemovable);
        }

        self.enabled.insert(module_id.to_string(), enabled);
        self.save(data_dir).ok();

        let mut out = manifest.clone();
        if let Some(obj) = out.as_object_mut() {
            obj.insert("module_id".into(), json!(module_id));
            obj.insert("enabled".into(), json!(enabled));
        }
        Ok(out)
    }
}
