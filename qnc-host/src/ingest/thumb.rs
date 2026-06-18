use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

/// Filmstrip / media-pool traka (112×64 u UI).
pub const FILMSTRIP_THUMB_WIDTH: u32 = 112;
pub const FILMSTRIP_THUMB_HEIGHT: u32 = 64;

const SELECT_EPS_SEC: f64 = 0.08;
const BATCH_PREFIX: &str = "_qnc_batch_";

#[cfg(windows)]
fn find_file_recursive(dir: &Path, file_name: &str, depth: u32) -> Option<PathBuf> {
    if depth == 0 || !dir.is_dir() {
        return None;
    }
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if path.file_name().and_then(|n| n.to_str()) == Some(file_name) {
                return Some(path);
            }
        } else if path.is_dir() {
            if let Some(found) = find_file_recursive(&path, file_name, depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn find_file_recursive(_dir: &Path, _file_name: &str, _depth: u32) -> Option<PathBuf> {
    None
}

#[cfg(windows)]
fn winget_tool(file_name: &str) -> Option<PathBuf> {
    let local = std::env::var("LOCALAPPDATA").ok()?;
    let base = PathBuf::from(local)
        .join("Microsoft")
        .join("WinGet")
        .join("Packages");
    find_file_recursive(&base, file_name, 10)
}

#[cfg(not(windows))]
fn winget_tool(_file_name: &str) -> Option<PathBuf> {
    None
}

fn sibling_ffprobe(ffmpeg: &Path) -> Option<PathBuf> {
    ffmpeg
        .parent()
        .map(|dir| dir.join(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" }))
}

fn ffmpeg_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(raw) = std::env::var("QNC_FFMPEG") {
        let p = PathBuf::from(raw.trim());
        if !p.as_os_str().is_empty() {
            out.push(p);
        }
    }
    if let Some(p) = winget_tool(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" }) {
        out.push(p);
    }
    if let Ok(root) = std::env::var("QNC_ROOT") {
        let root = PathBuf::from(root.trim());
        if root.as_os_str() != "" {
            out.push(root.join("bin").join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" }));
            out.push(root.join("tools").join("ffmpeg").join("bin").join(if cfg!(windows) {
                "ffmpeg.exe"
            } else {
                "ffmpeg"
            }));
        }
    }
    out.push(PathBuf::from(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" }));
    out
}

fn resolve_ffmpeg() -> Option<PathBuf> {
    static CACHE: OnceLock<Option<PathBuf>> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            for candidate in ffmpeg_candidates() {
                if candidate.is_file() {
                    return Some(candidate);
                }
                let output = Command::new(&candidate).arg("-version").output();
                if output.map(|o| o.status.success()).unwrap_or(false) {
                    return Some(candidate);
                }
            }
            None
        })
        .clone()
}

pub fn ffmpeg_available() -> bool {
    resolve_ffmpeg().is_some()
}

fn ffprobe_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(raw) = std::env::var("QNC_FFPROBE") {
        let p = PathBuf::from(raw.trim());
        if !p.as_os_str().is_empty() {
            out.push(p);
        }
    }
    if let Ok(raw) = std::env::var("QNC_FFMPEG") {
        let ffmpeg = PathBuf::from(raw.trim());
        if let Some(probe) = sibling_ffprobe(&ffmpeg) {
            out.push(probe);
        }
    }
    if let Some(p) = winget_tool(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" }) {
        out.push(p);
    }
    if let Ok(root) = std::env::var("QNC_ROOT") {
        let root = PathBuf::from(root.trim());
        if root.as_os_str() != "" {
            out.push(root.join("bin").join(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" }));
            out.push(
                root.join("tools").join("ffmpeg").join("bin").join(if cfg!(windows) {
                    "ffprobe.exe"
                } else {
                    "ffprobe"
                }),
            );
        }
    }
    out.push(PathBuf::from(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" }));
    out
}

fn resolve_ffprobe() -> Option<PathBuf> {
    static CACHE: OnceLock<Option<PathBuf>> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            for candidate in ffprobe_candidates() {
                if candidate.is_file() {
                    return Some(candidate);
                }
                let output = Command::new(&candidate).arg("-version").output();
                if output.map(|o| o.status.success()).unwrap_or(false) {
                    return Some(candidate);
                }
            }
            None
        })
        .clone()
}

fn ffmpeg_path_arg(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn filmstrip_scale_filter() -> String {
    format!(
        "scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=black",
        FILMSTRIP_THUMB_WIDTH,
        FILMSTRIP_THUMB_HEIGHT,
        FILMSTRIP_THUMB_WIDTH,
        FILMSTRIP_THUMB_HEIGHT
    )
}

fn select_filter_for_seeks(seeks: &[f64]) -> String {
    let parts: Vec<String> = seeks
        .iter()
        .map(|sec| {
            let s = (*sec).max(0.0);
            format!("between(t,{s:.3},{end:.3})", end = s + SELECT_EPS_SEC)
        })
        .collect();
    format!("select='{}'", parts.join("+"))
}

fn cleanup_batch_files(dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with(BATCH_PREFIX) && name.ends_with(".jpg") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

fn ffmpeg_err(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.trim().is_empty() {
        "ffmpeg neuspješan".into()
    } else {
        stderr.trim().to_string()
    }
}

/// Raspored seek pozicija za filmstrip (Jetson: `timeline_seek_seconds`).
pub fn timeline_seek_seconds(duration_sec: f64, frames: u32) -> Vec<f64> {
    let n = frames.clamp(2, 24) as usize;
    let dur = duration_sec.max(1.0);
    let margin = (dur * 0.05).min(2.0);
    let start = margin;
    let end = (dur - margin).max(start + 0.5);
    if n == 1 {
        return vec![(start * 100.0).round() / 100.0];
    }
    let step = (end - start) / (n - 1) as f64;
    (0..n)
        .map(|i| {
            let v = start + i as f64 * step;
            (v * 100.0).round() / 100.0
        })
        .collect()
}

/// Trajanje medija preko ffprobe (QNC_FFPROBE, QNC_ROOT/bin, PATH).
pub fn media_duration_sec(source: &Path) -> Option<f64> {
    if !source.is_file() {
        return None;
    }
    let ffprobe = resolve_ffprobe()?;
    let output = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
        ])
        .arg(source)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let text = stdout.trim();
    text.parse::<f64>().ok().filter(|d| *d > 0.0)
}

/// Ekstrakcija poster JPEG-a iz medija (QNC_FFMPEG, QNC_ROOT/bin, PATH).
pub fn extract_poster_jpeg(source: &Path, dest: &Path) -> Result<(), String> {
    extract_poster_jpeg_at_seek(source, dest, 0.5)
}

/// Ekstrakcija JPEG-a na zadanoj seek poziciji (fallback za jedan kadar).
pub fn extract_poster_jpeg_at_seek(source: &Path, dest: &Path, seek_sec: f64) -> Result<(), String> {
    if !source.is_file() {
        return Err(format!("izvor ne postoji: {}", source.display()));
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let ffmpeg = resolve_ffmpeg().ok_or(
        "ffmpeg nije instaliran (postavi QNC_FFMPEG ili dodaj u PATH)".to_string(),
    )?;
    let seek = format!("{:.2}", seek_sec.max(0.0));
    let vf = filmstrip_scale_filter();
    let output = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
        ])
        .arg(&seek)
        .arg("-i")
        .arg(source)
        .args(["-vf"])
        .arg(&vf)
        .args(["-frames:v", "1", "-q:v", "3"])
        .arg(dest)
        .output()
        .map_err(|e| format!("ffmpeg pokretanje: {e}"))?;
    if !output.status.success() {
        return Err(ffmpeg_err(&output));
    }
    if !dest.is_file() {
        return Err("ffmpeg nije kreirao poster".into());
    }
    Ok(())
}

/// Jedan ffmpeg decode pass — svi kadrovi filmstripa (brže od N procesa).
pub fn extract_filmstrip_batch_at_seeks(
    source: &Path,
    seeks: &[f64],
    outputs: &[PathBuf],
) -> Vec<Result<(), String>> {
    if seeks.is_empty() {
        return vec![];
    }
    if seeks.len() != outputs.len() {
        return vec![Err("seeks/outputs mismatch".into())];
    }
    if !source.is_file() {
        return vec![Err(format!("izvor ne postoji: {}", source.display()))];
    }

    if seeks.len() == 1 {
        return vec![extract_poster_jpeg_at_seek(source, &outputs[0], seeks[0])];
    }

    let out_dir = outputs[0]
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    if std::fs::create_dir_all(&out_dir).is_err() {
        return seeks
            .iter()
            .zip(outputs.iter())
            .map(|(sec, out)| extract_poster_jpeg_at_seek(source, out, *sec))
            .collect();
    }

    let ffmpeg = match resolve_ffmpeg() {
        Some(p) => p,
        None => {
            return seeks
                .iter()
                .zip(outputs.iter())
                .map(|(sec, out)| {
                    extract_poster_jpeg_at_seek(source, out, *sec)
                        .map_err(|_| "ffmpeg nije instaliran".into())
                })
                .collect();
        }
    };

    cleanup_batch_files(&out_dir);
    let batch_pattern = out_dir.join(format!("{BATCH_PREFIX}%03d.jpg"));
    let select = select_filter_for_seeks(seeks);
    let scale = filmstrip_scale_filter();
    let vf = format!("{select},{scale}");

    let output = Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y"])
        .arg("-i")
        .arg(source)
        .args(["-vf"])
        .arg(&vf)
        .args(["-vsync", "vfr"])
        .arg("-frames:v")
        .arg(seeks.len().to_string())
        .arg(ffmpeg_path_arg(&batch_pattern))
        .output()
        .map_err(|e| format!("ffmpeg pokretanje: {e}"));

    let mut results: Vec<Result<(), String>> = Vec::with_capacity(seeks.len());

    if let Err(e) = output {
        for (sec, out) in seeks.iter().zip(outputs.iter()) {
            results.push(
                extract_poster_jpeg_at_seek(source, out, *sec)
                    .map_err(|fallback| format!("batch: {e}; fallback: {fallback}")),
            );
        }
        cleanup_batch_files(&out_dir);
        return results;
    }

    let output = output.unwrap();
    if !output.status.success() {
        let err = ffmpeg_err(&output);
        for (sec, out) in seeks.iter().zip(outputs.iter()) {
            results.push(
                extract_poster_jpeg_at_seek(source, out, *sec)
                    .map_err(|fallback| format!("batch: {err}; fallback: {fallback}")),
            );
        }
        cleanup_batch_files(&out_dir);
        return results;
    }

    for (index, dest) in outputs.iter().enumerate() {
        let batch = out_dir.join(format!("{BATCH_PREFIX}{:03}.jpg", index + 1));
        let mut ok = false;
        if batch.is_file() && batch.metadata().map(|m| m.len()).unwrap_or(0) > 0 {
            if batch == *dest {
                ok = true;
            } else if std::fs::rename(&batch, dest).is_ok() || std::fs::copy(&batch, dest).is_ok() {
                let _ = std::fs::remove_file(&batch);
                ok = dest.is_file();
            }
        }
        if ok {
            results.push(Ok(()));
        } else {
            let sec = seeks[index];
            results.push(
                extract_poster_jpeg_at_seek(source, dest, sec)
                    .map_err(|e| format!("{sec}s: batch frame missing; {e}")),
            );
        }
    }

    cleanup_batch_files(&out_dir);
    results
}
