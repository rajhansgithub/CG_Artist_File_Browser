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
//!
//! EXR is also an output format. It is written as linear float (half by default) in one RGB or RGBA layer, so
//! nothing is tone mapped: an EXR or HDR source keeps its values, and an 8-bit source is linearised from sRGB.
//! A multi-layer EXR source converts the layer the user picked (the beauty layer when none is picked).

use crate::exr_view;
use crate::thumbnails;
use image::{DynamicImage, ImageFormat, ImageReader, Rgba, RgbaImage};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
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
    Exr,
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
            "exr" => Some(Self::Exr),
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
            Self::Exr => "exr",
        }
    }

    // None for EXR, which is written by `exr_out` and not by the image crate
    fn image_format(self) -> Option<ImageFormat> {
        match self {
            Self::Png => Some(ImageFormat::Png),
            Self::Jpg => Some(ImageFormat::Jpeg),
            Self::Tiff => Some(ImageFormat::Tiff),
            Self::Bmp => Some(ImageFormat::Bmp),
            Self::Tga => Some(ImageFormat::Tga),
            Self::Webp => Some(ImageFormat::WebP),
            Self::Exr => None,
        }
    }
}

#[derive(Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExrPrecision {
    /// 16-bit half float: half the size, and enough for almost every image
    #[default]
    Half,
    Float,
}

#[derive(Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExrCompression {
    /// Lossless, the usual choice
    #[default]
    Zip,
    /// Lossless, smaller for grainy renders
    Piz,
    /// Lossless and fast, for flat images
    Rle,
    None,
}

/// What the dialog chose beyond the format. Everything has a default, so a request without options works.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct ConvertOptions {
    /// The layer to read from a multi-layer EXR source; the beauty layer when empty
    pub exr_layer: Option<String>,
    pub exr_precision: ExrPrecision,
    pub exr_compression: ExrCompression,
    /// Keep the alpha channel of an EXR output when the source has one
    pub exr_alpha: bool,
}

impl Default for ConvertOptions {
    fn default() -> Self {
        Self {
            exr_layer: None,
            exr_precision: ExrPrecision::default(),
            exr_compression: ExrCompression::default(),
            exr_alpha: true,
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
    options: Option<ConvertOptions>,
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
    let options = options.unwrap_or_default();
    std::thread::spawn(move || run_job(app, job_id, files, target, out_dir, options, cancel));
    Ok(())
}

/// How many EXR files the dialog reads the layer lists of; the rest are assumed to match
const LAYER_LIST_FILES: usize = 40;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListedLayer {
    name: String,
    kind: exr_view::LayerKind,
    /// How many of the files read have this layer
    files: usize,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LayerListing {
    layers: Vec<ListedLayer>,
    /// EXR files among the paths, how many of them were read, and how many could not be (several parts, ...)
    exr_files: usize,
    read: usize,
    unreadable: usize,
}

/// The layers found in the EXR files among `file_paths`, for the dialog's layer picker. Only headers are read.
#[tauri::command]
pub async fn list_exr_layers(file_paths: Vec<String>) -> Result<LayerListing, String> {
    tauri::async_runtime::spawn_blocking(move || list_layers_of(&file_paths))
        .await
        .map_err(|e| e.to_string())
}

fn list_layers_of(file_paths: &[String]) -> LayerListing {
    let exrs: Vec<&String> = file_paths.iter().filter(|p| is_exr(Path::new(p.as_str()))).collect();
    let mut listing = LayerListing { layers: Vec::new(), exr_files: exrs.len(), read: 0, unreadable: 0 };
    for path in exrs.into_iter().take(LAYER_LIST_FILES) {
        match exr_view::list_layers(Path::new(path)) {
            Ok(layers) => {
                listing.read += 1;
                for layer in layers {
                    match listing.layers.iter_mut().find(|l| l.name == layer.name) {
                        Some(known) => known.files += 1,
                        None => listing.layers.push(ListedLayer { name: layer.name, kind: layer.kind, files: 1 }),
                    }
                }
            }
            Err(_) => listing.unreadable += 1,
        }
    }
    listing
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
    options: ConvertOptions,
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
            let result = catch_unwind(AssertUnwindSafe(|| convert_to_folder(src, out_dir.as_deref(), target, &options)))
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
fn convert_to_folder(src: &Path, out_dir: Option<&Path>, target: Target, options: &ConvertOptions) -> Result<PathBuf, String> {
    let dir = match out_dir {
        Some(dir) => dir.to_path_buf(),
        None => src.parent().ok_or("This file has no folder.")?.join("converted"),
    };
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    let stem = src.file_stem().and_then(|s| s.to_str()).ok_or("Unsupported file name.")?;

    let out = reserve_output(&dir, stem, target.extension())?;
    if let Err(error) = convert_file(src, &out, target, options) {
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

fn convert_file(src: &Path, out: &Path, target: Target, options: &ConvertOptions) -> Result<(), String> {
    if target == Target::Exr {
        let pixels = float_pixels(src, options)?;
        return thumbnails::write_atomic_with(out, |file| exr_out::write(file, &pixels, options));
    }
    let rgba = if is_float_source(src) { tone_mapped(src, options)? } else { open_oriented(src)?.into_rgba8() };
    thumbnails::write_atomic(out, |file| encode(file, rgba, target))
}

/// A picture as linear float samples, read back one pixel at a time by the EXR writer.
struct FloatPixels {
    width: usize,
    height: usize,
    /// The first row in `bytes` is the bottom row of the image (how the EXR decoder hands rows over)
    bottom_first: bool,
    /// `bytes` hold half float samples, not float32
    half: bool,
    /// Interleaved RGBA, little endian
    bytes: Vec<u8>,
    /// The alpha is the source's own; otherwise it is 1.0
    alpha: bool,
}

impl FloatPixels {
    /// RGBA of the pixel at column `x` and row `y`, counted from the top
    fn at(&self, x: usize, y: usize) -> [f32; 4] {
        let row = if self.bottom_first { self.height - 1 - y } else { y };
        let size = if self.half { 2 } else { 4 };
        let base = (row * self.width + x) * 4 * size;
        std::array::from_fn(|i| {
            let at = base + i * size;
            if self.half {
                exr::prelude::f16::from_le_bytes([self.bytes[at], self.bytes[at + 1]]).to_f32()
            } else {
                f32::from_le_bytes([self.bytes[at], self.bytes[at + 1], self.bytes[at + 2], self.bytes[at + 3]])
            }
        })
    }
}

fn srgb_to_linear(v: f32) -> f32 {
    if v <= 0.04045 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) }
}

/// Reads any supported source as linear float for an EXR output.
fn float_pixels(src: &Path, options: &ConvertOptions) -> Result<FloatPixels, String> {
    if is_exr(src) {
        let half = options.exr_precision == ExrPrecision::Half;
        let layer = exr_view::decode_layer(src, options.exr_layer.as_deref(), half, options.exr_alpha)?;
        return Ok(FloatPixels {
            width: layer.width,
            height: layer.height,
            bottom_first: true,
            half: layer.half,
            bytes: layer.bytes,
            alpha: layer.has_alpha,
        });
    }
    let img = open_oriented(src)?;
    // Radiance HDR and float TIFF are already linear; 8 and 16-bit pictures are sRGB
    let linear = matches!(img, DynamicImage::ImageRgb32F(_) | DynamicImage::ImageRgba32F(_));
    let alpha = img.color().has_alpha();
    let rgba = img.into_rgba32f();
    let (width, height) = rgba.dimensions();
    let mut bytes = Vec::with_capacity(width as usize * height as usize * 16);
    for p in rgba.pixels() {
        for (i, v) in p.0.into_iter().enumerate() {
            let v = if linear || i == 3 { v } else { srgb_to_linear(v) };
            bytes.extend_from_slice(&v.to_le_bytes());
        }
    }
    Ok(FloatPixels { width: width as usize, height: height as usize, bottom_first: false, half: false, bytes, alpha })
}

/// Writes the EXR output: one layer of R, G, B (and A), half or float32, scan line blocks.
mod exr_out {
    use super::{ConvertOptions, ExrCompression, ExrPrecision, FloatPixels};
    use exr::prelude::*;
    use std::fs::File;
    use std::io::BufWriter;

    pub fn write(file: BufWriter<File>, px: &FloatPixels, options: &ConvertOptions) -> std::result::Result<(), String> {
        let encoding = Encoding {
            compression: match options.exr_compression {
                ExrCompression::Zip => Compression::ZIP16,
                ExrCompression::Piz => Compression::PIZ,
                ExrCompression::Rle => Compression::RLE,
                ExrCompression::None => Compression::Uncompressed,
            },
            blocks: Blocks::ScanLines,
            line_order: LineOrder::Increasing,
        };
        let size = (px.width, px.height);
        let sample = |p: Vec2<usize>| px.at(p.x(), p.y());
        let half = |v: f32| f16::from_f32(v);
        let keep_alpha = options.exr_alpha && px.alpha;

        // The sample types of the channels follow the closure's, so each case is written out
        let written = match (options.exr_precision, keep_alpha) {
            (ExrPrecision::Half, true) => Image::from_encoded_channels(
                size,
                encoding,
                SpecificChannels::rgba(|p: Vec2<usize>| {
                    let [r, g, b, a] = sample(p);
                    (half(r), half(g), half(b), half(a))
                }),
            )
            .write()
            .to_buffered(file),
            (ExrPrecision::Half, false) => Image::from_encoded_channels(
                size,
                encoding,
                SpecificChannels::rgb(|p: Vec2<usize>| {
                    let [r, g, b, _] = sample(p);
                    (half(r), half(g), half(b))
                }),
            )
            .write()
            .to_buffered(file),
            (ExrPrecision::Float, true) => Image::from_encoded_channels(
                size,
                encoding,
                SpecificChannels::rgba(|p: Vec2<usize>| {
                    let [r, g, b, a] = sample(p);
                    (r, g, b, a)
                }),
            )
            .write()
            .to_buffered(file),
            (ExrPrecision::Float, false) => Image::from_encoded_channels(
                size,
                encoding,
                SpecificChannels::rgb(|p: Vec2<usize>| {
                    let [r, g, b, _] = sample(p);
                    (r, g, b)
                }),
            )
            .write()
            .to_buffered(file),
        };
        written.map_err(|e| e.to_string())
    }
}

fn is_exr(src: &Path) -> bool {
    src.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("exr"))
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
fn tone_mapped(src: &Path, options: &ConvertOptions) -> Result<RgbaImage, String> {
    if is_exr(src) {
        // The decoder hands rows bottom first, so they are flipped while mapping. The picture is opaque, as
        // the thumbnails and earlier versions of the converter are.
        let layer = exr_view::decode_layer(src, options.exr_layer.as_deref(), false, false)?;
        let floats: Vec<f32> = layer
            .bytes
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        Ok(tone_map(layer.width as u32, layer.height as u32, &floats, true))
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
    let format = target.image_format().ok_or_else(|| {
        image::ImageError::Unsupported(image::error::UnsupportedError::from_format_and_kind(
            image::error::ImageFormatHint::Unknown,
            image::error::UnsupportedErrorKind::Format(image::error::ImageFormatHint::Name("EXR".into())),
        ))
    })?;
    DynamicImage::ImageRgba8(rgba).write_to(&mut file, format)
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
        assert_eq!(Target::parse("exr"), Some(Target::Exr));
        assert_eq!(Target::parse("xyz"), None);
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
            let out = convert_to_folder(&src, None, target, &ConvertOptions::default()).unwrap();
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
        assert!(convert_to_folder(&src, None, Target::Png, &ConvertOptions::default()).is_err());
        assert!(!dir.join("converted").join("broken.png").exists());
    }

    /// A float32 EXR with these channels, each filled with a constant
    fn write_exr_channels(path: &Path, size: (usize, usize), channels: &[(&str, f32)]) {
        use exr::prelude::*;
        let list: SmallVec<[AnyChannel<FlatSamples>; 4]> = channels
            .iter()
            .map(|(name, value)| AnyChannel::new(*name, FlatSamples::F32(vec![*value; size.0 * size.1])))
            .collect();
        Image::from_channels(size, AnyChannels::sort(list)).write().to_file(path).unwrap();
    }

    fn exr_header(path: &Path) -> exr::meta::header::Header {
        exr::meta::MetaData::read_from_file(path, false).unwrap().headers.remove(0)
    }

    fn exr_channel_names(path: &Path) -> Vec<String> {
        exr_header(path).channels.list.iter().map(|c| c.name.to_string()).collect()
    }

    /// First pixel of the file's beauty picture as float32 RGBA
    fn first_pixel(path: &Path) -> [f32; 4] {
        let layer = exr_view::decode_layer(path, None, false, true).unwrap();
        let top_left = ((layer.height - 1) * layer.width) * 16;
        std::array::from_fn(|i| f32::from_le_bytes(layer.bytes[top_left + i * 4..top_left + i * 4 + 4].try_into().unwrap()))
    }

    #[test]
    fn exr_is_written_as_half_float_zip_with_alpha_by_default() {
        let dir = temp_dir("exr-default");
        let src = dir.join("tile.png");
        RgbaImage::from_pixel(8, 4, Rgba([255, 128, 0, 128])).save(&src).unwrap();

        let out = convert_to_folder(&src, None, Target::Exr, &ConvertOptions::default()).unwrap();
        assert_eq!(out.file_name().unwrap(), "tile.exr");
        let header = exr_header(&out);
        assert_eq!(header.compression, exr::prelude::Compression::ZIP16);
        assert_eq!(exr_channel_names(&out), vec!["A", "B", "G", "R"]);
        assert!(header.channels.list.iter().all(|c| c.sample_type == exr::prelude::SampleType::F16));
        assert_eq!((header.layer_size.width(), header.layer_size.height()), (8, 4));

        // 8-bit sRGB comes out linear: 128/255 in sRGB is about 0.216 in linear light, alpha stays as it was
        let [r, g, b, a] = first_pixel(&out);
        assert!((r - 1.0).abs() < 1e-3 && b.abs() < 1e-3);
        assert!((g - 0.2158).abs() < 2e-3, "g = {g}");
        assert!((a - 128.0 / 255.0).abs() < 2e-3, "a = {a}");
    }

    #[test]
    fn exr_options_choose_float32_compression_and_alpha() {
        let dir = temp_dir("exr-options");
        let src = dir.join("tile.png");
        RgbaImage::from_pixel(6, 6, Rgba([10, 20, 30, 200])).save(&src).unwrap();

        let options = ConvertOptions {
            exr_precision: ExrPrecision::Float,
            exr_compression: ExrCompression::Piz,
            exr_alpha: false,
            ..ConvertOptions::default()
        };
        let out = convert_to_folder(&src, None, Target::Exr, &options).unwrap();
        let header = exr_header(&out);
        assert_eq!(header.compression, exr::prelude::Compression::PIZ);
        assert_eq!(exr_channel_names(&out), vec!["B", "G", "R"]);
        assert!(header.channels.list.iter().all(|c| c.sample_type == exr::prelude::SampleType::F32));

        for (compression, expected) in [
            (ExrCompression::Rle, exr::prelude::Compression::RLE),
            (ExrCompression::None, exr::prelude::Compression::Uncompressed),
        ] {
            let out = convert_to_folder(&src, None, Target::Exr, &ConvertOptions { exr_compression: compression, ..ConvertOptions::default() }).unwrap();
            assert_eq!(exr_header(&out).compression, expected);
        }
    }

    #[test]
    fn a_source_without_alpha_writes_no_alpha_channel() {
        let dir = temp_dir("exr-noalpha");
        let src = dir.join("flat.png");
        image::RgbImage::from_pixel(4, 4, image::Rgb([1, 2, 3])).save(&src).unwrap();
        let out = convert_to_folder(&src, None, Target::Exr, &ConvertOptions::default()).unwrap();
        assert_eq!(exr_channel_names(&out), vec!["B", "G", "R"]);
    }

    #[test]
    fn exr_to_exr_converts_the_chosen_layer_and_keeps_its_values() {
        let dir = temp_dir("exr-layers");
        let src = dir.join("render.exr");
        write_exr_channels(
            &src,
            (4, 2),
            &[("R", 0.1), ("G", 0.2), ("B", 0.3), ("A", 0.4), ("diffuse.R", 2.5), ("diffuse.G", 5.0), ("diffuse.B", 10.0)],
        );

        // The beauty layer by default, with its alpha
        let options = ConvertOptions { exr_precision: ExrPrecision::Float, exr_compression: ExrCompression::Piz, ..ConvertOptions::default() };
        let beauty = convert_to_folder(&src, Some(&dir.join("out")), Target::Exr, &options).unwrap();
        assert_eq!(first_pixel(&beauty), [0.1, 0.2, 0.3, 0.4]);

        // A picked layer becomes plain R, G, B; values above 1 are not clipped
        let options = ConvertOptions { exr_layer: Some("diffuse".into()), exr_precision: ExrPrecision::Float, ..ConvertOptions::default() };
        let diffuse = convert_to_folder(&src, Some(&dir.join("out")), Target::Exr, &options).unwrap();
        assert_eq!(diffuse.file_name().unwrap(), "render (1).exr");
        assert_eq!(exr_channel_names(&diffuse), vec!["B", "G", "R"]);
        assert_eq!(first_pixel(&diffuse), [2.5, 5.0, 10.0, 1.0]);

        // Half float holds these values exactly
        let half = convert_to_folder(&src, Some(&dir.join("out")), Target::Exr, &ConvertOptions { exr_layer: Some("diffuse".into()), ..ConvertOptions::default() }).unwrap();
        assert_eq!(first_pixel(&half), [2.5, 5.0, 10.0, 1.0]);
        assert_eq!(exr_header(&half).channels.list[0].sample_type, exr::prelude::SampleType::F16);
    }

    #[test]
    fn a_picked_exr_layer_is_the_one_tone_mapped_for_8_bit_outputs() {
        let dir = temp_dir("exr-layer-png");
        let src = dir.join("multi.exr");
        // No plain R, G, B at all: only named layers, one of them dark and one bright
        write_exr_channels(
            &src,
            (4, 2),
            &[("ViewLayer.Combined.R", 0.0), ("ViewLayer.Combined.G", 0.0), ("ViewLayer.Combined.B", 0.0), ("ViewLayer.Emit.R", 16.0), ("ViewLayer.Emit.G", 16.0), ("ViewLayer.Emit.B", 16.0)],
        );

        let beauty = convert_to_folder(&src, None, Target::Png, &ConvertOptions::default()).unwrap();
        assert_eq!(image::open(&beauty).unwrap().to_rgba8().get_pixel(0, 0).0, [0, 0, 0, 255]);

        let options = ConvertOptions { exr_layer: Some("ViewLayer.Emit".into()), ..ConvertOptions::default() };
        let emit = convert_to_folder(&src, None, Target::Png, &options).unwrap();
        assert_eq!(image::open(&emit).unwrap().to_rgba8().get_pixel(0, 0).0, [255, 255, 255, 255]);

        let options = ConvertOptions { exr_layer: Some("nope".into()), ..ConvertOptions::default() };
        let error = convert_to_folder(&src, None, Target::Png, &options).unwrap_err();
        assert!(error.contains("nope"), "{error}");
        // The failed file left nothing behind
        assert!(!dir.join("converted").join("multi (2).png").exists());
    }

    #[test]
    fn the_layer_list_merges_files_and_ignores_other_formats() {
        let dir = temp_dir("exr-list");
        let (a, b) = (dir.join("a.exr"), dir.join("b.exr"));
        write_exr_channels(&a, (2, 2), &[("R", 0.0), ("G", 0.0), ("B", 0.0), ("AO.R", 0.0), ("AO.G", 0.0), ("AO.B", 0.0)]);
        write_exr_channels(&b, (2, 2), &[("R", 0.0), ("G", 0.0), ("B", 0.0)]);
        let png = dir.join("c.png");
        RgbaImage::from_pixel(2, 2, Rgba([0, 0, 0, 255])).save(&png).unwrap();
        let broken = dir.join("d.exr");
        fs::write(&broken, b"nope").unwrap();

        let paths: Vec<String> = [&a, &b, &png, &broken].iter().map(|p| p.display().to_string()).collect();
        let listing = list_layers_of(&paths);
        assert_eq!((listing.exr_files, listing.read, listing.unreadable), (3, 2, 1));
        let counts: Vec<(&str, usize)> = listing.layers.iter().map(|l| (l.name.as_str(), l.files)).collect();
        assert_eq!(counts, vec![(exr_view::MAIN_LAYER, 2), ("AO", 1)]);
    }

    #[test]
    fn options_arrive_from_the_dialog_with_defaults_for_what_is_left_out() {
        let none: ConvertOptions = serde_json::from_str("{}").unwrap();
        assert_eq!((none.exr_precision, none.exr_compression, none.exr_alpha, none.exr_layer), (ExrPrecision::Half, ExrCompression::Zip, true, None));
        let chosen: ConvertOptions =
            serde_json::from_str(r#"{"exrLayer":"diffuse","exrPrecision":"float","exrCompression":"piz","exrAlpha":false}"#).unwrap();
        assert_eq!(
            (chosen.exr_precision, chosen.exr_compression, chosen.exr_alpha, chosen.exr_layer.as_deref()),
            (ExrPrecision::Float, ExrCompression::Piz, false, Some("diffuse"))
        );
    }
}
