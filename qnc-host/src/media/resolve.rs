use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

const MEDIA_EXTENSIONS: &[&str] = &[
    "mxf", "mov", "mp4", "mts", "m2ts", "avi", "mkv", "m4v", "r3d", "wmv", "mpg", "mpeg", "lrv",
];

const CARD_THUMB_EXTENSIONS: &[&str] = &["thm", "jpg", "jpeg"];

const CARD_THM_EXTENSIONS: &[&str] = &["thm"];
const CARD_JPG_EXTENSIONS: &[&str] = &["jpg", "jpeg"];

/// Uobičajeni folderi za THM/JPG na kamerijskoj kartici (FX9: Thmbnl; Sony m4root: thumb).
const CARD_THUMB_DIR_NAMES: &[&str] = &[
    "Thmbnl",
    "THMBNL",
    "thumb",
    "THUMB",
    "Thumb",
    "Thumbnail",
    "Thumbnails",
    "THM",
];

pub fn is_card_thumb_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| CARD_THUMB_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

pub fn is_media_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| MEDIA_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Sony: C0001S03 (proxy), Mironik 1096T01 (JPG poster) → zajednički base.
pub fn clip_base_stem(stem: &str) -> String {
    let s = stem.trim();
    if s.is_empty() {
        return "clip".into();
    }
    let upper = s.to_ascii_uppercase();
    let bytes = upper.as_bytes();
    for i in (1..bytes.len()).rev() {
        if bytes[i].is_ascii_alphabetic() && bytes[i + 1..].iter().all(|b| b.is_ascii_digit()) {
            return s[..i].trim().to_string();
        }
    }
    s.to_string()
}

pub fn clip_id_from_stem(stem: &str) -> String {
    let base = clip_base_stem(stem);
    base.to_ascii_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

pub fn is_proxy_media_path(path: &Path) -> bool {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_uppercase();
    if stem.contains("PROXY") {
        return true;
    }
    let bytes = stem.as_bytes();
    for i in (1..bytes.len()).rev() {
        if bytes[i] == b'S' && bytes[i + 1..].iter().all(|b| b.is_ascii_digit()) {
            return true;
        }
    }
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("lrv"))
        .unwrap_or(false)
}

fn path_from_meta(meta: &Value, key: &str) -> Option<PathBuf> {
    meta.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

/// Vraća stvarnu putanju na disku (Windows: case-insensitive).
pub fn resolve_existing_file(path: &Path) -> Option<PathBuf> {
    if path.is_file() {
        return Some(path.to_path_buf());
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    if stem.is_empty() {
        return None;
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let exts: &[&str] = if ext == "thm" {
        CARD_THM_EXTENSIONS
    } else if ext == "jpg" || ext == "jpeg" {
        CARD_JPG_EXTENSIONS
    } else {
        CARD_THUMB_EXTENSIONS
    };
    find_card_file_in_dir(parent, stem, exts)
}

pub fn card_thumb_path(meta: &Value) -> Option<PathBuf> {
    let p = path_from_meta(meta, "card_thumb_path")?;
    resolve_existing_file(&p)
}

fn find_card_file_for_media_path(media_path: &Path, extensions: &[&str]) -> Option<PathBuf> {
    let parent = media_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = media_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let base = clip_base_stem(stem);

    if let Some(p) = find_card_file_in_dir(parent, &base, extensions) {
        return Some(p);
    }

    let mut dir = parent.to_path_buf();
    for _ in 0..8 {
        for name in CARD_THUMB_DIR_NAMES {
            let thumb_dir = dir.join(name);
            if thumb_dir.is_dir() {
                if let Some(p) = find_card_file_in_dir(&thumb_dir, &base, extensions) {
                    return Some(p);
                }
            }
        }
        if let Some(p) = find_card_file_in_dir(&dir, &base, extensions) {
            return Some(p);
        }
        let parent_dir = dir.parent()?;
        if parent_dir == dir {
            break;
        }
        dir = parent_dir.to_path_buf();
    }

    None
}

fn find_card_thumb_for_media_path(media_path: &Path) -> Option<PathBuf> {
    find_card_file_for_media_path(media_path, CARD_THUMB_EXTENSIONS)
}

fn find_card_file_near_media(meta: &Value, extensions: &[&str]) -> Option<PathBuf> {
    for key in [
        "original_path",
        "proxy_path",
        "source_path",
        "project_proxy_path",
    ] {
        if let Some(p) = path_from_meta(meta, key) {
            if let Some(th) = find_card_file_for_media_path(&p, extensions) {
                return Some(th);
            }
        }
    }
    None
}

pub enum CardPosterKind {
    Thm,
    Jpg,
}

fn is_thm_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("thm"))
        .unwrap_or(false)
}

/// Proces 1: prvo THM, zatim JPG/ JPEG na kartici.
pub fn find_card_poster_copy(
    meta: &Value,
    card_root: Option<&Path>,
) -> Option<(PathBuf, CardPosterKind)> {
    if let Some(p) = card_thumb_path(meta) {
        let kind = if is_thm_path(&p) {
            CardPosterKind::Thm
        } else {
            CardPosterKind::Jpg
        };
        return Some((p, kind));
    }
    if let Some(p) = find_card_thm_on_card(meta, card_root) {
        return Some((p, CardPosterKind::Thm));
    }
    if let Some(p) = find_card_jpg_on_card(meta, card_root) {
        return Some((p, CardPosterKind::Jpg));
    }
    None
}

pub fn find_card_thm_on_card(meta: &Value, card_root: Option<&Path>) -> Option<PathBuf> {
    if let Some(p) = find_card_file_near_media(meta, CARD_THM_EXTENSIONS) {
        return Some(p);
    }
    card_root
        .filter(|r| r.is_dir())
        .and_then(|root| find_card_file_under_card_root(meta, root, CARD_THM_EXTENSIONS))
}

pub fn find_card_jpg_on_card(meta: &Value, card_root: Option<&Path>) -> Option<PathBuf> {
    if let Some(p) = find_card_file_near_media(meta, CARD_JPG_EXTENSIONS) {
        return Some(p);
    }
    card_root
        .filter(|r| r.is_dir())
        .and_then(|root| find_card_file_under_card_root(meta, root, CARD_JPG_EXTENSIONS))
}

fn find_card_file_under_card_root(
    meta: &Value,
    root: &Path,
    extensions: &[&str],
) -> Option<PathBuf> {
    for key in ["original_path", "proxy_path", "source_path"] {
        if let Some(p) = path_from_meta(meta, key) {
            if let Some(th) = find_card_file_for_media_path(&p, extensions) {
                return Some(th);
            }
            let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            let base = clip_base_stem(stem);
            if let Some(th) = find_card_file_in_tree(root, 8, &base, extensions) {
                return Some(th);
            }
        }
    }
    None
}

fn find_card_file_in_tree(
    root: &Path,
    max_depth: u32,
    base_stem: &str,
    extensions: &[&str],
) -> Option<PathBuf> {
    let mut stack = vec![(root.to_path_buf(), 0u32)];
    while let Some((dir, depth)) = stack.pop() {
        if let Some(p) = find_card_file_in_dir(&dir, base_stem, extensions) {
            return Some(p);
        }
        if depth >= max_depth {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push((path, depth + 1));
            }
        }
    }
    None
}

pub fn is_media_on_card_path(path: &Path, project_dir: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    let project_dir = project_dir
        .canonicalize()
        .unwrap_or_else(|_| project_dir.to_path_buf());
    let media = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    !media.starts_with(&project_dir)
}

/// Ako je browse npr. `G:\Clip`, a `Thmbnl` je na `G:\` — koristi roditelja za THM sken.
pub fn resolve_card_media_root(scan_root: &Path) -> PathBuf {
    let scan_root = scan_root
        .canonicalize()
        .unwrap_or_else(|_| scan_root.to_path_buf());

    let mut dir = scan_root.clone();
    for _ in 0..6 {
        if let Some(parent) = dir.parent() {
            for name in CARD_THUMB_DIR_NAMES {
                if parent.join(name).is_dir() {
                    return parent.to_path_buf();
                }
            }
            if parent == dir {
                break;
            }
            dir = parent.to_path_buf();
        } else {
            break;
        }
    }
    scan_root
}

/// Ako nema THM/JPG: jedan frame iz videa (proxy na kartici → project proxy → MXF).
pub fn poster_video_source_path(meta: &Value) -> Option<PathBuf> {
    proxy_poster_source_path(meta).or_else(|| {
        for key in ["original_path", "source_path"] {
            if let Some(p) = path_from_meta(meta, key) {
                if p.is_file() {
                    return Some(p);
                }
            }
        }
        None
    })
}

/// Proces 2: samo proxy na kartici / u projektu — nikad MXF.
pub fn proxy_poster_source_path(meta: &Value) -> Option<PathBuf> {
    for key in ["proxy_path", "project_proxy_path"] {
        if let Some(p) = path_from_meta(meta, key) {
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// Ključ izvora postera u bazi — samo THM/JPG putanja (ne video).
pub fn poster_source_key(meta: &Value) -> String {
    find_card_poster_copy(meta, None)
        .map(|(p, _)| p.to_string_lossy().to_string())
        .or_else(|| card_thumb_path(meta).map(|p| p.to_string_lossy().to_string()))
        .unwrap_or_default()
}

pub fn is_breaking_news(project: &Value) -> bool {
    if project
        .get("template_id")
        .and_then(|v| v.as_str())
        .map(|id| id == "tpl_breaking_news")
        .unwrap_or(false)
    {
        return true;
    }
    project
        .get("settings")
        .and_then(|s| s.get("workflow"))
        .and_then(|v| v.as_str())
        == Some("news_fast")
}

pub fn proxy_policy_copy(project: &Value) -> bool {
    project
        .get("settings")
        .and_then(|s| s.get("storage"))
        .and_then(|st| st.get("proxy_policy"))
        .and_then(|v| v.as_str())
        .map(|p| p == "copy_to_project")
        .unwrap_or(true)
}

/// Decode / filmstrip: proxy na kartici → project proxy → MXF (THM se ne koristi).
pub fn decode_media_path(meta: &Value, project: &Value) -> Option<PathBuf> {
    let _ = is_breaking_news(project);
    poster_video_source_path(meta)
}

/// Import kopiranje: proxy prije originala; breaking news nikad original.
pub fn import_source_path(meta: &Value, project: &Value) -> Option<PathBuf> {
    if is_breaking_news(project) {
        if let Some(p) = path_from_meta(meta, "proxy_path") {
            if p.is_file() {
                return Some(p);
            }
        }
        return None;
    }
    for key in [
        "project_proxy_path",
        "proxy_path",
        "original_path",
        "source_path",
    ] {
        if let Some(p) = path_from_meta(meta, key) {
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// Tekst za UI: što se kopira u projekt kad korisnik klikne Uvezi.
pub fn import_display_label(meta: &Value, project: &Value) -> String {
    let Some(path) = import_source_path(meta, project) else {
        return "Uvoz: nema medija".into();
    };
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let kind = match ext.as_str() {
        "mxf" => "MXF".to_string(),
        "mov" => "MOV".to_string(),
        "mp4" | "m4v" => "MP4".to_string(),
        "mts" | "m2ts" => "AVCHD".to_string(),
        other => other.to_ascii_uppercase(),
    };
    let is_proxy = path_from_meta(meta, "proxy_path").is_some_and(|p| paths_same_file(&p, &path))
        || path_from_meta(meta, "project_proxy_path").is_some_and(|p| paths_same_file(&p, &path))
        || is_proxy_media_path(&path);
    if is_proxy {
        format!("Uvoz: proxy {}", kind)
    } else {
        format!("Uvoz: {}", kind)
    }
}

fn paths_same_file(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    a.canonicalize()
        .ok()
        .zip(b.canonicalize().ok())
        .map(|(x, y)| x == y)
        .unwrap_or(false)
}

pub fn media_path_for_clip(meta: &Value) -> Option<PathBuf> {
    decode_media_path(meta, &json!({}))
}

fn find_card_file_in_dir(dir: &Path, base_stem: &str, extensions: &[&str]) -> Option<PathBuf> {
    for ext in extensions {
        for variant in [ext.to_ascii_uppercase(), ext.to_string()] {
            let p = dir.join(format!("{}.{}", base_stem, variant));
            if p.is_file() {
                return Some(p);
            }
        }
    }
    let target_base = base_stem.to_ascii_lowercase();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return None;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !extensions.iter().any(|e| *e == ext) {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if stem == target_base || clip_base_stem(&stem).to_ascii_lowercase() == target_base {
            return Some(path);
        }
    }
    None
}

pub struct MediaGroup {
    pub clip_id: String,
    pub display_name: String,
    pub original: Option<PathBuf>,
    pub proxy: Option<PathBuf>,
    pub card_thumb: Option<PathBuf>,
    pub card_dir: PathBuf,
}

impl MediaGroup {
    pub fn is_on_card(&self, project_dir: &Path) -> bool {
        self.original
            .as_ref()
            .map(|p| is_media_on_card_path(p, project_dir))
            .unwrap_or(false)
            || self
                .proxy
                .as_ref()
                .map(|p| is_media_on_card_path(p, project_dir))
                .unwrap_or(false)
    }

    pub fn build_metadata(&self, breaking: bool, card_locked: bool, on_card: bool) -> Value {
        let primary = self
            .original
            .as_ref()
            .or(self.proxy.as_ref())
            .cloned()
            .unwrap_or_else(|| self.card_dir.clone());
        let ext = primary
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let mut obj = serde_json::Map::new();
        obj.insert("source_path".into(), json!(primary.to_string_lossy()));
        if let Some(p) = &self.original {
            obj.insert("original_path".into(), json!(p.to_string_lossy()));
        }
        if let Some(p) = &self.proxy {
            obj.insert("proxy_path".into(), json!(p.to_string_lossy()));
        }
        if let Some(p) = &self.card_thumb {
            obj.insert("card_thumb_path".into(), json!(p.to_string_lossy()));
        }
        obj.insert("extension".into(), json!(ext));
        if breaking || card_locked || on_card {
            obj.insert("read_from_card".into(), json!(true));
        }
        if card_locked {
            obj.insert("card_locked".into(), json!(true));
        }
        Value::Object(obj)
    }
}

pub fn group_media_files(files: &[PathBuf], thumb_files: &[PathBuf]) -> Vec<MediaGroup> {
    let mut map: HashMap<String, MediaGroup> = HashMap::new();

    for path in files {
        if !path.is_file() || !is_media_file(path) {
            continue;
        }
        let parent = path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("clip");
        let base = clip_base_stem(stem);
        let clip_id = clip_id_from_stem(&base);

        let entry = map.entry(clip_id.clone()).or_insert_with(|| {
            let thumb = find_card_thumb_for_media_path(path);
            MediaGroup {
                clip_id,
                display_name: format!(
                    "{}.{}",
                    base,
                    path.extension().and_then(|e| e.to_str()).unwrap_or("")
                ),
                original: None,
                proxy: None,
                card_thumb: thumb,
                card_dir: parent.clone(),
            }
        });

        if is_proxy_media_path(path) {
            entry.proxy = Some(path.clone());
        } else {
            entry.original = Some(path.clone());
            entry.display_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&entry.display_name)
                .to_string();
            entry.card_dir = parent.clone();
        }
        if let Some(th) = find_card_thumb_for_media_path(path) {
            entry.card_thumb = Some(th);
        }
    }

    for path in thumb_files {
        if !path.is_file() || !is_card_thumb_file(path) {
            continue;
        }
        attach_card_thumb_to_groups(&mut map, path);
    }

    let mut out: Vec<MediaGroup> = map
        .into_values()
        .filter(|g| g.original.is_some() || g.proxy.is_some())
        .collect();
    out.sort_by(|a, b| a.clip_id.cmp(&b.clip_id));
    out
}

fn attach_card_thumb_to_groups(map: &mut HashMap<String, MediaGroup>, thumb_path: &Path) {
    let stem = thumb_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("thumb");
    let thumb_id = clip_id_from_stem(stem);
    if let Some(entry) = map.get_mut(&thumb_id) {
        entry.card_thumb = Some(thumb_path.to_path_buf());
        return;
    }
    let thumb_base = clip_base_stem(stem).to_ascii_lowercase();
    for entry in map.values_mut() {
        let matches = entry
            .original
            .as_ref()
            .or(entry.proxy.as_ref())
            .and_then(|p| p.file_stem().and_then(|s| s.to_str()))
            .map(|s| clip_base_stem(s).to_ascii_lowercase() == thumb_base)
            .unwrap_or(false);
        if matches {
            entry.card_thumb = Some(thumb_path.to_path_buf());
            return;
        }
    }
}

pub fn enrich_metadata_from_disk(video_path: &Path) -> Value {
    let parent = video_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let stem = video_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("clip");
    let base = clip_base_stem(stem);
    let mut group = MediaGroup {
        clip_id: clip_id_from_stem(&base),
        display_name: video_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("clip")
            .to_string(),
        original: None,
        proxy: None,
        card_thumb: find_card_thumb_for_media_path(video_path),
        card_dir: parent,
    };
    if is_media_file(video_path) {
        if is_proxy_media_path(video_path) {
            group.proxy = Some(video_path.to_path_buf());
        } else {
            group.original = Some(video_path.to_path_buf());
        }
    }
    if let Ok(entries) = std::fs::read_dir(&group.card_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() || !is_media_file(&p) {
                continue;
            }
            let s = p.file_stem().and_then(|x| x.to_str()).unwrap_or("");
            if clip_base_stem(s) != base {
                continue;
            }
            if is_proxy_media_path(&p) {
                group.proxy = Some(p);
            } else if group.original.is_none() {
                group.original = Some(p);
            }
        }
    }
    group.build_metadata(false, false, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn touch(dir: &Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, b"test").expect("touch");
        p
    }

    #[test]
    fn groups_mxf_and_s03_proxy_by_case_insensitive_id() {
        let dir = std::env::temp_dir().join("qnc_group_test_case");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");
        let files = vec![
            touch(&dir, "Mironik 1096.MXF"),
            touch(&dir, "MIRONIK 1096S03.MP4"),
        ];
        let groups = group_media_files(&files, &[]);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].clip_id, "mironik_1096");
        assert!(groups[0].original.is_some());
        assert!(groups[0].proxy.is_some());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_card_media_root_finds_thmbnl_on_parent() {
        let dir = std::env::temp_dir().join("qnc_card_root_test");
        let clip = dir.join("Clip");
        let thmbnl = dir.join("Thmbnl");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&clip).expect("mkdir clip");
        fs::create_dir_all(&thmbnl).expect("mkdir thmbnl");
        let root = resolve_card_media_root(&clip);
        assert_eq!(root.file_name(), dir.file_name());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn card_poster_image_finds_thm_in_thmbnl_folder() {
        let dir = std::env::temp_dir().join("qnc_thumb_thmbnl_test");
        let clip = dir.join("Clip");
        let thmbnl = dir.join("Thmbnl");
        let sub = dir.join("Sub");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&clip).expect("mkdir clip");
        fs::create_dir_all(&thmbnl).expect("mkdir thmbnl");
        fs::create_dir_all(&sub).expect("mkdir sub");
        let mxf = touch(&clip, "Mironik 1096.MXF");
        let thm = touch(&thmbnl, "Mironik 1096.THM");
        let proxy = touch(&sub, "Mironik 1096S03.MP4");

        let meta = json!({
            "original_path": mxf.to_string_lossy(),
            "proxy_path": proxy.to_string_lossy(),
        });
        assert_eq!(
            find_card_poster_copy(&meta, None)
                .map(|(p, _)| p)
                .unwrap()
                .file_name(),
            thm.file_name()
        );

        let groups = group_media_files(&[mxf, proxy], &[]);
        assert_eq!(groups.len(), 1);
        assert_eq!(
            groups[0].card_thumb.as_ref().and_then(|p| p.file_name()),
            thm.file_name()
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn group_links_thm_files_from_scan() {
        let dir = std::env::temp_dir().join("qnc_thumb_scan_test");
        let clip = dir.join("Clip");
        let thmbnl = dir.join("Thmbnl");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&clip).expect("mkdir clip");
        fs::create_dir_all(&thmbnl).expect("mkdir thmbnl");
        let mxf = touch(&clip, "Mironik 1096.MXF");
        let thm = touch(&thmbnl, "Mironik 1096.THM");

        let groups = group_media_files(&[mxf], &[thm]);
        assert_eq!(groups.len(), 1);
        assert_eq!(
            groups[0].card_thumb.as_ref().and_then(|p| p.file_name()),
            Some(std::ffi::OsStr::new("Mironik 1096.THM"))
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn card_poster_image_is_only_thm_not_video() {
        let dir = std::env::temp_dir().join("qnc_thumb_src_test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");
        let mxf = touch(&dir, "Clip0001.MXF");
        let proxy = touch(&dir, "Clip0001S03.MP4");

        let meta_only_mxf = json!({ "original_path": mxf.to_string_lossy() });
        assert!(find_card_poster_copy(&meta_only_mxf, None).is_none());
        assert_eq!(poster_video_source_path(&meta_only_mxf).unwrap(), mxf);

        let meta_proxy = json!({
            "original_path": mxf.to_string_lossy(),
            "proxy_path": proxy.to_string_lossy(),
        });
        assert!(find_card_poster_copy(&meta_proxy, None).is_none());
        assert_eq!(poster_video_source_path(&meta_proxy).unwrap(), proxy);

        let thm = touch(&dir, "Clip0001.thm");
        assert!(find_card_poster_copy(&meta_proxy, None)
            .map(|(p, _)| p)
            .and_then(|p| p
                .file_name()
                .map(|n| n.to_string_lossy().eq_ignore_ascii_case("Clip0001.thm")))
            .unwrap_or(false));
        assert_eq!(poster_video_source_path(&meta_proxy).unwrap(), proxy);

        let meta_with_thm = json!({
            "original_path": mxf.to_string_lossy(),
            "card_thumb_path": thm.to_string_lossy(),
        });
        assert!(find_card_poster_copy(&meta_with_thm, None)
            .map(|(p, _)| p)
            .and_then(|p| p
                .file_name()
                .map(|n| n.to_string_lossy().eq_ignore_ascii_case("Clip0001.thm")))
            .unwrap_or(false));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn groups_mxf_with_t01_jpg_not_separate_clip() {
        let dir = std::env::temp_dir().join("qnc_group_t01_test");
        let thmbnl = dir.join("Thmbnl");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");
        fs::create_dir_all(&thmbnl).expect("mkdir thmbnl");
        let mxf = touch(&dir, "Mironik 1096.MXF");
        let jpg = touch(&thmbnl, "Mironik 1096T01.JPG");

        let groups = group_media_files(&[mxf], &[jpg]);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].clip_id, "mironik_1096");
        assert!(groups[0].original.is_some());
        assert_eq!(
            groups[0].card_thumb.as_ref().and_then(|p| p.file_name()),
            Some(std::ffi::OsStr::new("Mironik 1096T01.JPG"))
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn clip_base_stem_strips_t_suffix() {
        assert_eq!(clip_base_stem("Mironik 1096T01"), "Mironik 1096");
        assert_eq!(clip_base_stem("MIRONIK 1096S03"), "MIRONIK 1096");
    }

    #[test]
    fn groups_proxy_across_subfolders() {
        let dir = std::env::temp_dir().join("qnc_group_test_sub");
        let sub = dir.join("Sub");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&sub).expect("mkdir");
        let files = vec![
            touch(&dir, "Mironik 1097.MXF"),
            touch(&sub, "Mironik 1097S03.MP4"),
        ];
        let groups = group_media_files(&files, &[]);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].clip_id, "mironik_1097");
        let _ = fs::remove_dir_all(&dir);
    }
}
