use std::path::{Path, PathBuf};

use crate::ingest::thumb::{
    extract_filmstrip_batch_at_seeks, extract_poster_jpeg_at_seek, media_duration_sec,
    timeline_seek_seconds,
};
use crate::project::db::ProjectPaths;

use super::store::{
    filmstrip_clip_dir, get_filmstrip, list_frames_for_clip, mark_filmstrip, save_filmstrip,
};

fn output_path(out_dir: &Path, index: usize, sec: f64) -> PathBuf {
    let sec_label = format!("{:.2}", sec).replace('.', "_");
    out_dir.join(format!("{:03}_{}.jpg", index, sec_label))
}

fn frame_ready(path: &Path) -> bool {
    path.is_file() && path.metadata().map(|m| m.len()).unwrap_or(0) > 0
}

/// Gradi filmstrip za klip (Jetson contract; jedan ffmpeg pass + scale 112×64).
pub fn build_for_clip(
    paths: &ProjectPaths,
    project_id: &str,
    clip_id: &str,
    media: &Path,
    frames: u32,
) -> Result<(), String> {
    if !media.is_file() {
        let msg = format!("nema medija za klip '{clip_id}'");
        mark_filmstrip(paths, project_id, clip_id, "error", &msg)?;
        return Err(msg);
    }

    if let Some(existing) = get_filmstrip(paths, project_id, clip_id) {
        let status = existing
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if status == "ready" {
            let frames = list_frames_for_clip(paths, project_id, clip_id).unwrap_or_default();
            let all_exist = frames.iter().all(|f| {
                f.get("path")
                    .and_then(|v| v.as_str())
                    .map(|s| Path::new(s).is_file())
                    .unwrap_or(false)
            });
            if all_exist && !frames.is_empty() {
                return Ok(());
            }
        }
    }

    mark_filmstrip(paths, project_id, clip_id, "building", "")?;
    let duration = media_duration_sec(media).unwrap_or(60.0);
    let seeks = timeline_seek_seconds(duration, frames);
    let out_dir = filmstrip_clip_dir(paths, project_id, clip_id);
    let output_paths: Vec<PathBuf> = seeks
        .iter()
        .enumerate()
        .map(|(index, sec)| output_path(&out_dir, index, *sec))
        .collect();

    let missing: Vec<usize> = output_paths
        .iter()
        .enumerate()
        .filter(|(_, path)| !frame_ready(path))
        .map(|(i, _)| i)
        .collect();

    let mut errors = Vec::new();

    if !missing.is_empty() {
        let batch_seeks: Vec<f64> = missing.iter().map(|i| seeks[*i]).collect();
        let batch_outs: Vec<PathBuf> = missing.iter().map(|i| output_paths[*i].clone()).collect();
        let batch_results = extract_filmstrip_batch_at_seeks(media, &batch_seeks, &batch_outs);
        for (idx, result) in missing.iter().zip(batch_results) {
            if let Err(exc) = result {
                errors.push(format!("{}s: {exc}", seeks[*idx]));
            }
        }
    }

    let mut frame_paths = Vec::new();
    for (index, sec) in seeks.iter().enumerate() {
        let out = &output_paths[index];
        if frame_ready(out) {
            frame_paths.push(out.clone());
        } else if let Err(exc) = extract_poster_jpeg_at_seek(media, out, *sec) {
            errors.push(format!("{sec}s: {exc}"));
        } else if frame_ready(out) {
            frame_paths.push(out.clone());
        } else {
            errors.push(format!("{sec}s: frame missing"));
        }
    }

    let err_msg = errors.join("; ");
    save_filmstrip(
        paths,
        project_id,
        clip_id,
        duration,
        &seeks,
        &frame_paths,
        &err_msg,
    )?;
    if !err_msg.is_empty() && frame_paths.is_empty() {
        return Err(err_msg);
    }
    Ok(())
}
