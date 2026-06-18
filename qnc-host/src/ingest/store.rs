use std::collections::HashSet;
use std::path::PathBuf;

use rusqlite::params;
use serde_json::{json, Value};

use crate::media::{
    group_media_files, import_display_label, is_breaking_news, is_media_file, is_proxy_media_path,
};
use crate::project::db::{project_display_name, project_settings_snapshot, ProjectPaths};

use super::db::{
    ensure_ingest_dirs, get_meta, json_string, open_ingest, parse_json, poster_exists, set_meta,
    set_thumb_status, thumbnail_path, thumbnail_url,
};
use super::scanner;
use super::thumb_process::{apply_card_poster_copy, copy_thumbs_from_card, CardThumbCopyResult};

fn row_to_clip(
    project_id: &str,
    paths: &ProjectPaths,
    row: &rusqlite::Row<'_>,
    project: &Value,
) -> rusqlite::Result<Value> {
    let clip_id: String = row.get("clip_id")?;
    let meta_raw: String = row.get("metadata_json")?;
    let meta = parse_json(&meta_raw, json!({}));
    let ext = meta.get("extension").and_then(|v| v.as_str()).unwrap_or("");
    let thumb_status: String = row
        .get::<_, Option<String>>("thumb_status")?
        .unwrap_or_else(|| "pending".into());
    let thumb_error: String = row
        .get::<_, Option<String>>("thumb_error")?
        .unwrap_or_default();
    let mut clip = json!({
        "clip_id": clip_id,
        "name": row.get::<_, String>("name")?,
        "media_id": row.get::<_, String>("media_id")?,
        "duration_sec": row.get::<_, f64>("duration_sec")?,
        "resolution": row.get::<_, String>("resolution")?,
        "codec": row.get::<_, String>("codec")?,
        "fps": row.get::<_, f64>("fps")?,
        "proxy_status": row.get::<_, String>("status")?,
        "import_status": row.get::<_, String>("import_status")?,
        "selected": row.get::<_, i64>("selected")? != 0,
        "thumb_color_a": row.get::<_, String>("thumb_color_a")?,
        "thumb_color_b": row.get::<_, String>("thumb_color_b")?,
        "thumb_status": thumb_status,
        "thumb_error": thumb_error,
        "extension": ext,
    });
    let stored_thumb_path: String = row.get("thumb_path").unwrap_or_default();
    let poster = if stored_thumb_path.trim().is_empty() {
        thumbnail_path(paths, project_id, &clip_id)
    } else {
        PathBuf::from(stored_thumb_path.trim())
    };
    if thumb_status == "ready" && poster_exists(&poster) {
        if let Some(obj) = clip.as_object_mut() {
            obj.insert(
                "thumb_url".into(),
                json!(thumbnail_url(project_id, &clip_id)),
            );
        }
    }
    if let Some(obj) = clip.as_object_mut() {
        let source_path: String = row.get("source_path").unwrap_or_default();
        let original_path: String = row.get("original_path").unwrap_or_default();
        let proxy_path: String = row.get("proxy_path").unwrap_or_default();
        let project_proxy_path: String = row.get("project_proxy_path").unwrap_or_default();
        let thumb_path: String = row.get("thumb_path").unwrap_or_default();
        let card_thumb_path: String = row.get("card_thumb_path").unwrap_or_default();
        if !source_path.trim().is_empty() {
            obj.insert("source_path".into(), json!(source_path));
        } else if let Some(p) = meta.get("source_path").and_then(|v| v.as_str()) {
            obj.insert("source_path".into(), json!(p));
        }
        if !original_path.trim().is_empty() {
            obj.insert("original_path".into(), json!(original_path));
        } else if let Some(p) = meta.get("original_path").and_then(|v| v.as_str()) {
            obj.insert("original_path".into(), json!(p));
        }
        if !proxy_path.trim().is_empty() {
            obj.insert("proxy_path".into(), json!(proxy_path));
        } else if let Some(p) = meta.get("proxy_path").and_then(|v| v.as_str()) {
            obj.insert("proxy_path".into(), json!(p));
        }
        if !project_proxy_path.trim().is_empty() {
            obj.insert("project_proxy_path".into(), json!(project_proxy_path));
        } else if let Some(p) = meta.get("project_proxy_path").and_then(|v| v.as_str()) {
            obj.insert("project_proxy_path".into(), json!(p));
        }
        if !thumb_path.trim().is_empty() {
            obj.insert("thumb_path".into(), json!(thumb_path));
        }
        if !card_thumb_path.trim().is_empty() {
            obj.insert("card_thumb_path".into(), json!(card_thumb_path));
        } else if let Some(p) = meta.get("card_thumb_path").and_then(|v| v.as_str()) {
            obj.insert("card_thumb_path".into(), json!(p));
        }
        if let Some(p) = meta.get("poster_source").and_then(|v| v.as_str()) {
            obj.insert("poster_source".into(), json!(p));
        }
        if meta
            .get("read_from_card")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            obj.insert("read_from_card".into(), json!(true));
        }
        if meta
            .get("card_locked")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            obj.insert("card_locked".into(), json!(true));
        }
        let import_label = import_display_label(&meta, project);
        obj.insert("import_label".into(), json!(import_label));
        if let Some(p) = crate::media::import_source_path(&meta, project) {
            obj.insert("import_path".into(), json!(p.to_string_lossy()));
        }
    }
    Ok(clip)
}

pub fn row_import_error(
    conn: &rusqlite::Connection,
    source_id: &str,
    clip_id: &str,
    error: &str,
) -> rusqlite::Result<()> {
    let msg = if error.len() > 240 {
        format!("{}…", error.chars().take(240).collect::<String>())
    } else {
        error.to_string()
    };
    conn.execute(
        "UPDATE ingest_assets SET import_status = 'error', status = 'error', thumb_error = ?3
         WHERE source_id = ?1 AND clip_id = ?2",
        params![source_id, clip_id, msg],
    )?;
    Ok(())
}

fn scan_root_for_active_source(
    paths: &ProjectPaths,
    project_id: &str,
    conn: &rusqlite::Connection,
) -> PathBuf {
    let browse = get_meta(conn, "browse_path", "").unwrap_or_default();
    if !browse.trim().is_empty() {
        PathBuf::from(browse.trim())
    } else {
        paths.project_dir(project_id).join("incoming")
    }
}

pub fn discover(
    paths: &ProjectPaths,
    project_id: &str,
    source_id: &str,
) -> rusqlite::Result<Value> {
    let conn = open_ingest(paths, project_id)?;
    let sid = if source_id.trim().is_empty() {
        get_meta(&conn, "active_source_id", "local")?
    } else {
        source_id.trim().to_string()
    };
    let browse_root = scan_root_for_active_source(paths, project_id, &conn);
    let inventory = scanner::scan_inventory(&browse_root);
    set_meta(
        &conn,
        "source_scan_root",
        inventory.browse_root.to_string_lossy().as_ref(),
    )?;
    let project = project_settings_snapshot(paths, project_id).unwrap_or_else(|_| json!({}));
    let breaking = is_breaking_news(&project);
    set_meta(
        &conn,
        "card_root",
        inventory.card_root.to_string_lossy().as_ref(),
    )?;
    if breaking {
        set_meta(&conn, "card_locked", "1")?;
    } else {
        set_meta(&conn, "card_locked", "0")?;
    }
    let count = register_media_paths(
        paths,
        project_id,
        &sid,
        &inventory.media_files,
        &inventory.thumb_files,
    )?;
    purge_non_video_clips(&conn, &sid)?;
    if count > 0 {
        conn.execute(
            "UPDATE ingest_assets SET selected = 1 WHERE source_id = ?1",
            params![sid],
        )?;
    }

    let thumb_copy = copy_thumbs_from_card(paths, project_id).unwrap_or_else(|e| {
        tracing::warn!("ingest thumb copy after discover: {}", e);
        CardThumbCopyResult {
            copied: 0,
            no_thumb_clip_ids: Vec::new(),
        }
    });

    Ok(json!({
        "status": "ok",
        "discovered": count,
        "scan_root": inventory.browse_root.to_string_lossy(),
        "card_root": inventory.card_root.to_string_lossy(),
        "thumbs_copied": thumb_copy.copied,
        "no_thumb_clip_ids": thumb_copy.no_thumb_clip_ids,
    }))
}

fn metadata_has_video(meta: &Value) -> bool {
    for key in ["original_path", "proxy_path"] {
        if let Some(s) = meta.get(key).and_then(|v| v.as_str()) {
            let p = PathBuf::from(s.trim());
            if p.is_file() && (is_media_file(&p) || is_proxy_media_path(&p)) {
                return true;
            }
        }
    }
    false
}

fn purge_non_video_clips(conn: &rusqlite::Connection, source_id: &str) -> rusqlite::Result<()> {
    let mut stmt =
        conn.prepare("SELECT clip_id, metadata_json FROM ingest_assets WHERE source_id = ?1")?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![source_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for (clip_id, meta_raw) in rows {
        let meta = parse_json(&meta_raw, json!({}));
        if !metadata_has_video(&meta) {
            conn.execute(
                "DELETE FROM ingest_assets WHERE source_id = ?1 AND clip_id = ?2",
                params![source_id, clip_id],
            )?;
        }
    }
    Ok(())
}

fn reconcile_source_assets(
    conn: &rusqlite::Connection,
    source_id: &str,
    valid_clip_ids: &[String],
) -> rusqlite::Result<()> {
    if valid_clip_ids.is_empty() {
        return Ok(());
    }
    let valid: HashSet<String> = valid_clip_ids.iter().cloned().collect();
    let mut stmt =
        conn.prepare("SELECT clip_id, metadata_json FROM ingest_assets WHERE source_id = ?1")?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![source_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;

    for (clip_id, _meta_raw) in rows {
        if valid.contains(&clip_id) {
            continue;
        }
        conn.execute(
            "DELETE FROM ingest_assets WHERE source_id = ?1 AND clip_id = ?2",
            params![source_id, clip_id],
        )?;
    }
    Ok(())
}

fn codec_label(ext: &str) -> String {
    match ext.to_ascii_lowercase().as_str() {
        "mxf" => "MXF".into(),
        "mov" => "QuickTime".into(),
        "mp4" | "m4v" => "MP4".into(),
        "mts" | "m2ts" => "AVCHD".into(),
        _ => ext.to_ascii_uppercase(),
    }
}

fn thumb_colors(name: &str) -> (String, String) {
    let h = name
        .bytes()
        .fold(0u32, |acc, b| acc.wrapping_add(u32::from(b)));
    let a = format!(
        "#{:02x}{:02x}{:02x}",
        40 + (h % 40) as u8,
        40 + ((h >> 3) % 40) as u8,
        42 + ((h >> 6) % 40) as u8
    );
    let b = format!(
        "#{:02x}{:02x}{:02x}",
        24 + (h % 24) as u8,
        24 + ((h >> 4) % 24) as u8,
        26 + ((h >> 8) % 24) as u8
    );
    (a, b)
}

pub fn list_sources(paths: &ProjectPaths, project_id: &str) -> rusqlite::Result<Vec<Value>> {
    let settings = project_settings_snapshot(paths, project_id).unwrap_or_else(|_| json!({}));
    let inner = settings
        .get("settings")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let source_ids = inner
        .get("source_template_ids")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut out = Vec::new();
    for id_val in source_ids {
        let Some(id) = id_val.as_str() else { continue };
        out.push(json!({
            "source_id": id,
            "name": id,
            "path": "incoming",
        }));
    }
    if out.is_empty() {
        out.push(json!({
            "source_id": "local",
            "name": "Lokalni incoming",
            "path": "incoming",
        }));
    }
    Ok(out)
}

pub fn load_state(paths: &ProjectPaths, project_id: &str) -> rusqlite::Result<Value> {
    let pid = if project_id.trim().is_empty() {
        "default".to_string()
    } else {
        project_id.trim().to_string()
    };
    ensure_ingest_dirs(paths, &pid).ok();
    let conn = open_ingest(paths, &pid)?;
    reconcile_thumbnail_rows(paths, &pid, &conn)?;
    let active_source = get_meta(&conn, "active_source_id", "local")?;
    purge_non_video_clips(&conn, &active_source)?;
    let browse_path = get_meta(&conn, "browse_path", "")?;
    let card_locked = get_meta(&conn, "card_locked", "")? == "1";
    let card_root = get_meta(&conn, "card_root", "")?;
    let project = project_settings_snapshot(paths, &pid).unwrap_or_else(|_| json!({}));
    let mut stmt =
        conn.prepare("SELECT * FROM ingest_assets WHERE source_id = ?1 ORDER BY clip_id")?;
    let clips: Vec<Value> = stmt
        .query_map(params![active_source], |row| {
            row_to_clip(&pid, paths, row, &project)
        })?
        .collect::<Result<_, _>>()?;
    let selected: Vec<String> = clips
        .iter()
        .filter(|c| c.get("selected").and_then(|v| v.as_bool()).unwrap_or(false))
        .filter_map(|c| {
            c.get("clip_id")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .collect();
    Ok(json!({
        "status": "ok",
        "project_id": pid,
        "project_name": project_display_name(paths, &pid),
        "active_source_id": active_source,
        "browse_path": browse_path,
        "card_locked": card_locked,
        "card_root": card_root,
        "sources": list_sources(paths, &pid)?,
        "clips": clips,
        "selected_clip_ids": selected,
    }))
}

pub fn set_browse_path(
    paths: &ProjectPaths,
    project_id: &str,
    path: &str,
) -> rusqlite::Result<Value> {
    let conn = open_ingest(paths, project_id)?;
    set_meta(&conn, "browse_path", path.trim())?;
    load_state(paths, project_id)
}

pub fn set_active_source(
    paths: &ProjectPaths,
    project_id: &str,
    source_id: &str,
) -> rusqlite::Result<Value> {
    let conn = open_ingest(paths, project_id)?;
    set_meta(&conn, "active_source_id", source_id.trim())?;
    let browse = get_meta(&conn, "browse_path", "")?;
    if !browse.trim().is_empty() {
        discover(paths, project_id, source_id)?;
    }
    load_state(paths, project_id)
}

pub fn save_selection(
    paths: &ProjectPaths,
    project_id: &str,
    selected_clip_ids: &[String],
) -> rusqlite::Result<Value> {
    let conn = open_ingest(paths, project_id)?;
    let active_source = get_meta(&conn, "active_source_id", "local")?;
    conn.execute(
        "UPDATE ingest_assets SET selected = 0 WHERE source_id = ?1",
        params![active_source],
    )?;
    for clip_id in selected_clip_ids {
        conn.execute(
            "UPDATE ingest_assets SET selected = 1 WHERE source_id = ?1 AND clip_id = ?2",
            params![active_source, clip_id.trim()],
        )?;
    }
    load_state(paths, project_id)
}

pub fn toggle_clip_selection(
    paths: &ProjectPaths,
    project_id: &str,
    clip_id: &str,
) -> rusqlite::Result<Value> {
    let cid = clip_id.trim();
    if cid.is_empty() {
        return load_state(paths, project_id);
    }
    let conn = open_ingest(paths, project_id)?;
    let active_source = get_meta(&conn, "active_source_id", "local")?;
    let current: i64 = conn
        .query_row(
            "SELECT selected FROM ingest_assets WHERE source_id = ?1 AND clip_id = ?2",
            params![active_source, cid],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let new_sel = if current != 0 { 0i64 } else { 1i64 };
    conn.execute(
        "UPDATE ingest_assets SET selected = ?3 WHERE source_id = ?1 AND clip_id = ?2",
        params![active_source, cid, new_sel],
    )?;
    load_state(paths, project_id)
}

pub fn select_all_clips(paths: &ProjectPaths, project_id: &str) -> rusqlite::Result<Value> {
    let conn = open_ingest(paths, project_id)?;
    let active_source = get_meta(&conn, "active_source_id", "local")?;
    let total: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ingest_assets WHERE source_id = ?1",
            params![active_source],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let selected: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ingest_assets WHERE source_id = ?1 AND selected != 0",
            params![active_source],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let select_all = total > 0 && selected < total;
    if select_all {
        conn.execute(
            "UPDATE ingest_assets SET selected = 1 WHERE source_id = ?1",
            params![active_source],
        )?;
    } else {
        conn.execute(
            "UPDATE ingest_assets SET selected = 0 WHERE source_id = ?1",
            params![active_source],
        )?;
    }
    load_state(paths, project_id)
}

pub fn reconcile_thumbnail_rows(
    paths: &ProjectPaths,
    project_id: &str,
    conn: &rusqlite::Connection,
) -> rusqlite::Result<()> {
    let mut stmt = conn
        .prepare("SELECT source_id, clip_id, thumb_status FROM ingest_assets ORDER BY clip_id")?;
    let rows: Vec<(String, String, String)> = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<_, _>>()?;

    for (source_id, clip_id, thumb_status) in rows {
        let poster = thumbnail_path(paths, project_id, &clip_id);
        let exists = poster_exists(&poster);
        let status = thumb_status.trim();

        if status == "processing" {
            set_thumb_status(conn, &source_id, &clip_id, "pending", "")?;
            continue;
        }

        if exists && status != "ready" {
            set_thumb_status(conn, &source_id, &clip_id, "ready", "")?;
        } else if !exists && status == "ready" {
            set_thumb_status(conn, &source_id, &clip_id, "pending", "")?;
        }
    }
    Ok(())
}

fn upsert_media_group(
    paths: &ProjectPaths,
    project_id: &str,
    source_id: &str,
    group: &crate::media::MediaGroup,
    breaking: bool,
) -> rusqlite::Result<usize> {
    if group.original.is_none() && group.proxy.is_none() {
        return Ok(0);
    }
    let conn = open_ingest(paths, project_id)?;
    let sid = if source_id.trim().is_empty() {
        get_meta(&conn, "active_source_id", "local")?
    } else {
        source_id.trim().to_string()
    };
    let clip_id = group.clip_id.clone();
    let ext = group
        .original
        .as_ref()
        .or(group.proxy.as_ref())
        .and_then(|p| p.extension().and_then(|e| e.to_str()))
        .unwrap_or("")
        .to_ascii_lowercase();
    let name = group.display_name.clone();
    let (color_a, color_b) = thumb_colors(&name);
    let poster = thumbnail_path(paths, project_id, &clip_id);
    let project_dir = paths.project_dir(project_id);
    let on_card = group.is_on_card(&project_dir);
    let card_root_raw = get_meta(&conn, "card_root", "").unwrap_or_default();
    let card_root = if card_root_raw.trim().is_empty() {
        None
    } else {
        Some(PathBuf::from(card_root_raw.trim()))
    };
    let mut meta = group.build_metadata(breaking, breaking, on_card);
    let copied_now =
        apply_card_poster_copy(paths, project_id, &clip_id, &mut meta, card_root.as_deref());
    let thumb_status = if copied_now || poster_exists(&poster) {
        "ready"
    } else {
        "pending"
    };
    let thumb_path = if thumb_status == "ready" {
        poster.to_string_lossy().to_string()
    } else {
        String::new()
    };
    let source_path = path_text_from_meta(&meta, "source_path");
    let original_path = path_text_from_meta(&meta, "original_path");
    let proxy_path = path_text_from_meta(&meta, "proxy_path");
    let card_thumb_path = path_text_from_meta(&meta, "card_thumb_path");
    conn.execute(
        "INSERT INTO ingest_assets
            (source_id, clip_id, name, media_id, duration_sec, resolution, codec, fps,
             status, import_status, selected, thumb_color_a, thumb_color_b,
             thumb_status, thumb_error, source_path, original_path, proxy_path,
             project_proxy_path, thumb_path, card_thumb_path, metadata_json)
         VALUES (?1, ?2, ?3, ?4, 0, '', ?5, 0, 'on_source', 'detected', 1, ?6, ?7, ?8, '',
             ?9, ?10, ?11, '', ?12, ?13, ?14)
         ON CONFLICT(source_id, clip_id) DO UPDATE SET
            name = excluded.name,
            codec = excluded.codec,
            status = CASE
                WHEN ingest_assets.import_status IN ('imported', 'done') THEN ingest_assets.status
                ELSE excluded.status
            END,
            thumb_color_a = excluded.thumb_color_a,
            thumb_color_b = excluded.thumb_color_b,
            thumb_status = excluded.thumb_status,
            thumb_error = CASE WHEN excluded.thumb_status = 'pending' THEN '' ELSE ingest_assets.thumb_error END,
            source_path = excluded.source_path,
            original_path = excluded.original_path,
            proxy_path = excluded.proxy_path,
            thumb_path = CASE WHEN excluded.thumb_path = '' THEN ingest_assets.thumb_path ELSE excluded.thumb_path END,
            card_thumb_path = CASE WHEN excluded.card_thumb_path = '' THEN ingest_assets.card_thumb_path ELSE excluded.card_thumb_path END,
            metadata_json = excluded.metadata_json,
            selected = ingest_assets.selected,
            import_status = ingest_assets.import_status",
        params![
            sid,
            clip_id,
            name,
            clip_id,
            codec_label(&ext),
            color_a,
            color_b,
            thumb_status,
            source_path,
            original_path,
            proxy_path,
            thumb_path,
            card_thumb_path,
            json_string(&meta),
        ],
    )?;
    Ok(1)
}

fn path_text_from_meta(meta: &Value, key: &str) -> String {
    meta.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("")
        .to_string()
}

pub fn register_media_paths(
    paths: &ProjectPaths,
    project_id: &str,
    source_id: &str,
    file_paths: &[PathBuf],
    thumb_paths: &[PathBuf],
) -> rusqlite::Result<usize> {
    let project = project_settings_snapshot(paths, project_id).unwrap_or_else(|_| json!({}));
    let breaking = is_breaking_news(&project);
    let groups = group_media_files(file_paths, thumb_paths);
    let mut count = 0usize;
    let mut clip_ids = Vec::new();
    for group in groups {
        count += upsert_media_group(paths, project_id, source_id, &group, breaking)?;
        clip_ids.push(group.clip_id.clone());
    }
    let conn = open_ingest(paths, project_id)?;
    let sid = if source_id.trim().is_empty() {
        get_meta(&conn, "active_source_id", "local")?
    } else {
        source_id.trim().to_string()
    };
    reconcile_source_assets(&conn, &sid, &clip_ids)?;
    purge_non_video_clips(&conn, &sid)?;
    Ok(count)
}

pub fn queue_import(
    paths: &ProjectPaths,
    project_id: &str,
    clip_ids: &[String],
) -> rusqlite::Result<Value> {
    let conn = open_ingest(paths, project_id)?;
    let active_source = get_meta(&conn, "active_source_id", "local")?;
    let ids: HashSet<String> = clip_ids
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if ids.is_empty() {
        return Ok(json!({ "status": "ok", "queued": 0 }));
    }
    for clip_id in &ids {
        conn.execute(
            "UPDATE ingest_assets SET import_status = 'queued' WHERE source_id = ?1 AND clip_id = ?2",
            params![active_source, clip_id],
        )?;
    }
    Ok(json!({ "status": "ok", "queued": ids.len() }))
}
