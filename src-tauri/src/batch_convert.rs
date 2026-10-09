//! Batch convert: writes converted copies of the selected images in the background.
//!
//! The webview starts a job with an id it made itself, then listens for `batch-convert-progress` and
//! `batch-convert-finished` events, so nothing waits on this work. Two files are converted at a time
//! (`WORKERS`), so a big batch never runs more than that many decodes at once. A name that is already taken
//! gets " (1)", " (2)", ... added, so nothing is ever overwritten. Each file is written under a temporary
//! name and renamed when done, so a cancelled or failed file leaves no half-written image behind.
//!
//! EXR and HDR sources are tone mapped to 8-bit with the same ACES curve the thumbnails use. Other images
//! keep their colours, and EXIF orientation is applied, as the thumbnails do.

use crate::exr_view;
use crate::thumbnails;
use image::{DynamicImage, ImageFormat, ImageReader, Rgba, RgbaImage};
use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufWriter, ErrorKind};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};
use tauri::Emitter;

const WORKERS: usize = 2;
const JPEG_QUALITY: u8 = 92;

// Cancel flags of the jobs still running, by the id the webview gave them
static JOBS: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn jobs() -> MutexGuard<'static, HashMap<String, Arc<AtomicBool>>> {
    JOBS.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    Png,
    Jpg,
    Tiff,
    Bmp,
    Tga,
    Webp,
}

impl Target {
    pub fn parse(name: &str) -> Option<Self> {
        match name.to_ascii_lowercase().as_str() {
            "png" => Some(Self::Png),
            "jpg" | "jpeg" => Some(Self::Jpg),
            "tif" | "tiff" => Some(Self::Tiff),
            "bmp" => Some(Self::Bmp),
            "tga" => Some(Self::Tga),
            "webp" => Some(Self::Webp),
            _ => None,
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpg => "jpg",
            Self::Tiff => "tif",
            Self::Bmp => "bmp",
            Self::Tga => "tga",
            Self::Webp => "webp",
        }
    }

    fn image_format(self) -> ImageFormat {
        match self {
            Self::Png => ImageFormat::Png,
            Self::Jpg => ImageFormat::Jpeg,
            Self::Tiff => ImageFormat::Tiff,
            Self::Bmp => ImageFormat::Bmp,
            Self::Tga => ImageFormat::Tga,
            Self::Webp => ImageFormat::WebP,
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    job_id: String,
    index: usize,
    path: String,
    // "converting", "done", "failed" or "cancelled"
    status: &'static str,
    out_path: Option<String>,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FinishedEvent {
    job_id: String,
    converted: usize,
    failed: usize,
    cancelled: bool,
}

/// Starts converting `file_paths` to `format` in the background. Without `out_dir`, each file goes to a
/// "converted" folder next to it. Returns an error only for a request that cannot start at all.
#[tauri::command]
pub fn start_batch_convert(
    app: tauri::AppHandle,
    job_id: String,
    file_paths: Vec<String>,
    format: String,
    out_dir: Option<String>,
) -> Result<(), String> {
    let target = Target::parse(&format).ok_or_else(|| format!("Unknown format: {format}"))?;
    if file_paths.is_empty() {
        return Err("No files selected.".into());
    }
    if let Some(missing) = file_paths.iter().find(|p| !Path::new(p.as_str()).is_file()) {
        return Err(format!("File not found: {missing}"));
    }
    let out_dir = out_dir.map(|d| d.trim().to_string()).filter(|d| !d.is_empty()).map(PathBuf::from);
    if let Some(dir) = &out_dir {
        fs::create_dir_all(dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    }

    let cancel = Arc::new(AtomicBool::new(false));
    jobs().insert(job_id.clone(), cancel.clone());
    let files: Vec<PathBuf> = file_paths.into_iter().map(PathBuf::from).collect();
    std::thread::spawn(move || run_job(app, job_id, files, target, out_dir, cancel));
    Ok(())
}

/// Stops a running job. Files already being written finish; the rest are reported as cancelled.
#[tauri::command]
pub fn cancel_batch_convert(job_id: String) -> bool {
    match jobs().get(&job_id) {
        Some(flag) => {
            flag.store(true, Ordering::Relaxed);
            true
        }
        None => false,
    }
}

fn run_job(
    app: tauri::AppHandle,
    job_id: String,
    files: Vec<PathBuf>,
    target: Target,
    out_dir: Option<PathBuf>,
    cancel: Arc<AtomicBool>,
) {
    let converted = AtomicUsize::new(0);
    let failed = AtomicUsize::new(0);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(WORKERS)
        .build()
        .expect("could not start the batch convert workers");

    pool.install(|| {
        files.par_iter().enumerate().for_each(|(index, src)| {
            if cancel.load(Ordering::Relaxed) {
                emit_progress(&app, &job_id, index, src, "cancelled", None, None);
                return;
            }
            emit_progress(&app, &job_id, index, src, "converting", None, None);

            // A decoder that panics on a broken file should fail that one file, not leave the job hanging
            let result = catch_unwind(AssertUnwindSafe(|| convert_to_folder(src, out_dir.as_deref(), target)))
                .unwrap_or_else(|_| Err("Unexpected error while converting".into()));
            match result {
                Ok(out) => {
                    converted.fetch_add(1, Ordering::Relaxed);
                    emit_progress(&app, &job_id, index, src, "done", Some(&out), None);
                }
                Err(error) => {
                    failed.fetch_add(1, Ordering::Relaxed);
                    emit_progress(&app, &job_id, index, src, "failed", None, Some(error));
                }
            }
        });
    });

    let _ = app.emit(
        "batch-convert-finished",
        FinishedEvent {
            job_id: job_id.clone(),
            converted: converted.load(Ordering::Relaxed),
            failed: failed.load(Ordering::Relaxed),
            cancelled: cancel.load(Ordering::Relaxed),
        },
    );
    jobs().remove(&job_id);
}

fn emit_progress(
    app: &tauri::AppHandle,
    job_id: &str,
    index: usize,
    src: &Path,
    status: &'static str,
    out_path: Option<&Path>,
    error: Option<String>,
) {
    let _ = app.emit(
        "batch-convert-progress",
        ProgressEvent {
            job_id: job_id.to_string(),
            index,
            path: src.display().to_string(),
            status,
            out_path: out_path.map(|p| p.display().to_string()),
            error,
        },
    );
}

/// Converts one file into `out_dir` (or its "converted" folder) and returns the path it wrote.
fn convert_to_folder(src: &Path, out_dir: Option<&Path>, target: Target) -> Result<PathBuf, String> {
    let dir = match out_dir {
        Some(dir) => dir.to_path_buf(),
        None => src.parent().ok_or("This file has no folder.")?.join("converted"),
    };
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    let stem = src.file_stem().and_then(|s| s.to_str()).ok_or("Unsupported file name.")?;

    let out = reserve_output(&dir, stem, target.extension())?;
    if let Err(error) = convert_file(src, &out, target) {
        let _ = fs::remove_file(&out);
        return Err(error);
    }
    Ok(out)
}

/// Picks the first free name ("shot.png", "shot (1).png", ...) and creates it empty, so two files in one
/// batch can never end up with the same name.
fn reserve_output(dir: &Path, stem: &str, ext: &str) -> Result<PathBuf, String> {
    let mut n = 0usize;
    loop {
        let name = if n == 0 { format!("{stem}.{ext}") } else { format!("{stem} ({n}).{ext}") };
        let path = dir.join(name);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(_) => return Ok(path),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => n += 1,
            Err(e) => return Err(format!("Could not write {}: {e}", path.display())),
        }
    }
}

fn convert_file(src: &Path, out: &Path, target: Target) -> Result<(), String> {
    let rgba = if is_float_source(src) { tone_mapped(src)? } else { open_oriented(src)?.into_rgba8() };
    thumbnails::write_atomic(out, |file| encode(file, rgba, target))
}

fn is_float_source(src: &Path) -> bool {
    src.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "exr" | "hdr"))
}

fn open_oriented(src: &Path) -> Result<DynamicImage, String> {
    use image::ImageDecoder;

    let mut decoder = ImageReader::open(src)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .into_decoder()
        .map_err(|e| e.to_string())?;
    // Written files carry no EXIF, so the rotation the viewer applies has to be baked into the pixels
    let orientation = decoder.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    img.apply_orientation(orientation);
    Ok(img)
}

/// Linear float sources (EXR, HDR) to 8-bit sRGB through the thumbnails' ACES curve.
fn tone_mapped(src: &Path) -> Result<RgbaImage, String> {
    let is_exr = src
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("exr"));
    if is_exr {
        // The decoder hands rows bottom first, so they are flipped while mapping
        let (width, height, bytes, _) = exr_view::decode_rgba(src, "R", "G", "B", None, false)?;
        let floats: Vec<f32> = bytes
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        Ok(tone_map(width as u32, height as u32, &floats, true))
    } else {
        let img = open_oriented(src)?.into_rgba32f();
        let (width, height) = img.dimensions();
        Ok(tone_map(width, height, img.as_raw(), false))
    }
}

/// `floats` is interleaved RGBA. With `flip`, the first row in memory is the bottom row of the image.
fn tone_map(width: u32, height: u32, floats: &[f32], flip: bool) -> RgbaImage {
    let row_len = width as usize * 4;
    RgbaImage::from_fn(width, height, |x, y| {
        let row = if flip { (height - 1 - y) as usize } else { y as usize };
        let at = row * row_len + x as usize * 4;
        let p = &floats[at..at + 4];
        let channel = |v: f32| thumbnails::aces_filmic(thumbnails::to_float(v));
        let alpha = (p[3].clamp(0.0, 1.0) * 255.0).round() as u8;
        Rgba([channel(p[0]), channel(p[1]), channel(p[2]), alpha])
    })
}

fn encode(mut file: BufWriter<fs::File>, rgba: RgbaImage, target: Target) -> image::ImageResult<()> {
    if target == Target::Jpg {
        // JPEG has no alpha channel
        let rgb = DynamicImage::ImageRgba8(rgba).into_rgb8();
        return image::ImageEncoder::write_image(
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut file, JPEG_QUALITY),
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        );
    }
    DynamicImage::ImageRgba8(rgba).write_to(&mut file, target.image_format())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("batch-convert-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn target_formats_are_parsed_without_case() {
        assert_eq!(Target::parse("JPG"), Some(Target::Jpg));
        assert_eq!(Target::parse("jpeg"), Some(Target::Jpg));
        assert_eq!(Target::parse("TIFF"), Some(Target::Tiff));
        assert_eq!(Target::parse("exr"), None);
    }

    #[test]
    fn taken_names_get_a_number_and_nothing_is_overwritten() {
        let dir = temp_dir("names");
        fs::write(dir.join("shot.png"), b"keep").unwrap();
        let first = reserve_output(&dir, "shot", "png").unwrap();
        let second = reserve_output(&dir, "shot", "png").unwrap();
        assert_eq!(first.file_name().unwrap(), "shot (1).png");
        assert_eq!(second.file_name().unwrap(), "shot (2).png");
        assert_eq!(fs::read(dir.join("shot.png")).unwrap(), b"keep");
    }

    #[test]
    fn a_png_converts_to_every_target_in_the_converted_folder() {
        let dir = temp_dir("convert");
        let src = dir.join("tile.png");
        RgbaImage::from_pixel(8, 4, Rgba([200, 40, 40, 255])).save(&src).unwrap();
        for target in [Target::Png, Target::Jpg, Target::Tiff, Target::Bmp, Target::Tga, Target::Webp] {
            let out = convert_to_folder(&src, None, target).unwrap();
            assert!(out.starts_with(dir.join("converted")));
            let decoded = image::open(&out).unwrap();
            assert_eq!((decoded.width(), decoded.height()), (8, 4));
        }
    }

    #[test]
    fn a_broken_file_fails_alone_and_leaves_no_output() {
        let dir = temp_dir("broken");
        let src = dir.join("broken.png");
        fs::write(&src, b"not an image").unwrap();
        assert!(convert_to_folder(&src, None, Target::Png).is_err());
        assert!(!dir.join("converted").join("broken.png").exists());
    }
}
