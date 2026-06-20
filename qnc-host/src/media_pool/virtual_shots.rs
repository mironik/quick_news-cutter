use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::ingest::thumb::extract_poster_jpeg_at_seek;
use crate::project::db::{now_str, ProjectPaths};

use super::db::media_pool_dir;
use super::ingest_db::proxy_path_for_clip;

pub fn virtual_shots_root(paths: &ProjectPaths, project_id: &str) -> PathBuf {
    media_pool_dir(paths, project_id).join("virtual_shots")
}

fn shot_dir(paths: &ProjectPaths, project_id: &str, shot_id: &str) -> PathBuf {
    virtual_shots_root(paths, project_id).join(shot_id)
}

fn cover_file(shot_dir: &Path, kind: &str) -> PathBuf {
    if kind == "out" || kind == "out_cover" || kind == "end" {
        shot_dir.join("out_cover.jpg")
    } else {
        shot_dir.join("cover.jpg")
    }
}

pub fn write_shot_covers(
    paths: &ProjectPaths,
    project_id: &str,
    shot_id: &str,
    clip_id: &str,
    in_sec: f64,
    out_sec: f64,
) -> Result<(PathBuf, PathBuf), String> {
    let proxy = proxy_path_for_clip(paths, project_id, clip_id)
        .filter(|p| p.is_file())
        .ok_or_else(|| format!("nema proxy za '{clip_id}'"))?;
    let dir = shot_dir(paths, project_id, shot_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let cover = cover_file(&dir, "in");
    let out_cover = cover_file(&dir, "out");
    if !cover.is_file() {
        extract_poster_jpeg_at_seek(&proxy, &cover, in_sec)?;
    }
    if !out_cover.is_file() {
        extract_poster_jpeg_at_seek(&proxy, &out_cover, out_sec)?;
    }
    Ok((cover, out_cover))
}

pub fn cover_path_for_shot(
    paths: &ProjectPaths,
    project_id: &str,
    shot_id: &str,
    kind: &str,
) -> Result<Option<PathBuf>, String> {
    let conn = super::db::open_db(paths, project_id)?;
    let raw: Option<String> = conn
        .query_row(
            "SELECT data_json FROM virtual_shots WHERE shot_id = ?1",
            rusqlite::params![shot_id],
            |r| r.get(0),
        )
        .ok();
    let data = raw
        .as_deref()
        .map(|s| serde_json::from_str::<Value>(s).unwrap_or(json!({})))
        .unwrap_or(json!({}));
    let field = if kind == "out" || kind == "out_cover" || kind == "end" {
        "out_cover_path"
    } else {
        "cover_path"
    };
    if let Some(p) = data.get(field).and_then(|v| v.as_str()) {
        let path = PathBuf::from(p);
        if path.is_file() {
            return Ok(Some(path));
        }
    }
    let fallback = cover_file(&shot_dir(paths, project_id, shot_id), kind);
    if fallback.is_file() {
        return Ok(Some(fallback));
    }

    let row: Option<(String, f64, f64)> = conn
        .query_row(
            "SELECT clip_id, in_seconds, out_seconds FROM virtual_shots WHERE shot_id = ?1",
            rusqlite::params![shot_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();
    let Some((clip_id, in_sec, out_sec)) = row else {
        return Ok(None);
    };
    if out_sec <= in_sec {
        return Ok(None);
    }
    let (cover, out_cover) =
        write_shot_covers(paths, project_id, shot_id, &clip_id, in_sec, out_sec)?;
    let cover_path = if field == "out_cover_path" {
        out_cover.clone()
    } else {
        cover.clone()
    };
    let mut patch = data;
    if let Some(obj) = patch.as_object_mut() {
        obj.insert("cover_path".into(), json!(cover.to_string_lossy()));
        obj.insert("out_cover_path".into(), json!(out_cover.to_string_lossy()));
        obj.insert("updated_at".into(), json!(now_str()));
    }
    conn.execute(
        "UPDATE virtual_shots SET data_json = ?1, updated_at = ?2 WHERE shot_id = ?3",
        rusqlite::params![patch.to_string(), now_str(), shot_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(Some(cover_path))
}

pub fn delete_virtual_shot(
    paths: &ProjectPaths,
    project_id: &str,
    shot_id: &str,
) -> Result<bool, String> {
    let conn = super::db::open_db(paths, project_id)?;
    let deleted = conn
        .execute(
            "DELETE FROM virtual_shots WHERE shot_id = ?1",
            rusqlite::params![shot_id],
        )
        .map_err(|e| e.to_string())?;
    if deleted == 0 {
        return Ok(false);
    }
    let dir = shot_dir(paths, project_id, shot_id);
    if dir.is_dir() {
        let _ = fs::remove_dir_all(&dir);
    }
    Ok(true)
}

pub fn seconds_to_timecode(seconds: f64, fps: u32) -> String {
    let f = fps.max(1);
    let total = (seconds.max(0.0) * f as f64).round() as i64;
    let frames = total % f as i64;
    let total_sec = total / f as i64;
    let ss = total_sec % 60;
    let mm = (total_sec / 60) % 60;
    let hh = total_sec / 3600;
    format!("{hh:02}:{mm:02}:{ss:02}:{frames:02}")
}
