//! Native thumbnail generation for HDR / EXR / TGA / TIFF files.
//!
//! This replaces the JavaScript decode path in `src/utils/thumbnailService.js` for these formats so the
//! full image never has to cross the IPC boundary or be decoded on the UI thread. The output is meant to
//! look the same as before: a 256x128 JPEG built by nearest-neighbour sampling, with the same
//! auto-exposure + ACES filmic tone mapping for float images.

use std::fs;
use std::io::BufWriter;
use std::path::Path;

pub const THUMB_W: usize = 256;
pub const THUMB_H: usize = 128;
const JPEG_QUALITY: u8 = 85;
const NO_LATTICE: u32 = u32::MAX;

/// Decodes `src` and returns the 256x128 thumbnail as raw 8-bit RGB. Errors mean "this file is not
/// supported or could not be read natively"; callers fall back to the JavaScript decoders.
pub fn thumbnail_rgb(src: &Path) -> Result<Vec<u8>, String> {
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "exr" => exr_thumbnail(src),
        "hdr" => hdr_thumbnail(src),
        "tga" | "tif" | "tiff" => ldr_thumbnail(src),
        other => Err(format!("No native thumbnail support for .{}", other)),
    }
}

/// Thumbnails are written to a temporary name first, then renamed, so a half-written file is never
/// picked up by the cache lookup in `read_directory`.
pub fn generate_thumbnail(src: &Path, out: &Path) -> Result<(), String> {
    write_jpeg(&thumbnail_rgb(src)?, out)
}

fn write_jpeg(rgb: &[u8], out: &Path) -> Result<(), String> {
    let tmp = out.with_extension("jpg.tmp");
    {
        let file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let writer = BufWriter::new(file);
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(writer, JPEG_QUALITY);
        image::ImageEncoder::write_image(
            encoder,
            rgb,
            THUMB_W as u32,
            THUMB_H as u32,
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, out).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

// ---------------------------------------------------------------------------------------------------
// Float images (EXR / HDR)
// ---------------------------------------------------------------------------------------------------

/// Collects only the source pixels the 256x128 thumbnail needs (plus the ~500 luminance samples used for
/// auto-exposure) so a huge panorama never has to be held in memory as a full float image.
///
/// Sampling positions are identical to the previous JavaScript implementation. That code worked on the
/// loader's output, whose row order differs per format (`flip`): EXR rows were stored bottom-up.
pub struct FloatSampler {
    width: usize,
    height: usize,
    step: u64,
    col_targets: Vec<Vec<u16>>,
    row_targets: Vec<Vec<u16>>,
    lattice_x0: Vec<u32>,
    grid: Vec<[f32; 3]>,
    lum_sum: f64,
    lum_count: u64,
}

impl FloatSampler {
    /// `flip`: the JS loader stored row 0 at the bottom of the image (true for EXR, false for HDR).
    pub fn new(width: usize, height: usize, flip: bool) -> Self {
        let step = std::cmp::max(1, (width as u64 * height as u64) / 500);

        let mut col_targets: Vec<Vec<u16>> = vec![Vec::new(); width];
        for dx in 0..THUMB_W {
            let sx = ((dx as f64 / THUMB_W as f64) * width as f64).floor() as usize;
            col_targets[sx.min(width - 1)].push(dx as u16);
        }

        // Row indices below are in "loader space" (what the JS code indexed), then mapped back to the
        // top-down row order the decoders here deliver.
        let to_decoder_row = |loader_row: usize| if flip { height - 1 - loader_row } else { loader_row };

        let mut row_targets: Vec<Vec<u16>> = vec![Vec::new(); height];
        for dy in 0..THUMB_H {
            let norm_y = dy as f64 / THUMB_H as f64;
            let loader_row = if flip {
                ((1.0 - norm_y) * height as f64).floor()
            } else {
                (norm_y * height as f64).floor()
            };
            let loader_row = loader_row.max(0.0).min((height - 1) as f64) as usize;
            row_targets[to_decoder_row(loader_row)].push(dy as u16);
        }

        // Auto-exposure sampled every `step`-th pixel of the loader's row-major array.
        let mut lattice_x0 = vec![NO_LATTICE; height];
        for loader_row in 0..height {
            let base = loader_row as u64 * width as u64;
            let x0 = (step - base % step) % step;
            if x0 < width as u64 {
                lattice_x0[to_decoder_row(loader_row)] = x0 as u32;
            }
        }

        Self {
            width,
            height,
            step,
            col_targets,
            row_targets,
            lattice_x0,
            grid: vec![[0.0; 3]; THUMB_W * THUMB_H],
            lum_sum: 0.0,
            lum_count: 0,
        }
    }

    pub fn wants_row(&self, y: usize) -> bool {
        y < self.height && (!self.row_targets[y].is_empty() || self.lattice_x0[y] != NO_LATTICE)
    }

    pub fn pixel(&mut self, x: usize, y: usize, rgb: [f32; 3]) {
        if x >= self.width || y >= self.height {
            return;
        }

        let x0 = self.lattice_x0[y];
        if x0 != NO_LATTICE && x as u64 >= x0 as u64 && (x as u64 - x0 as u64) % self.step == 0 {
            let r = to_float(rgb[0]);
            let g = to_float(rgb[1]);
            let b = to_float(rgb[2]);
            let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            if lum > 0.0001 && lum.is_finite() {
                self.lum_sum += lum;
                self.lum_count += 1;
            }
        }

        let rows = &self.row_targets[y];
        if rows.is_empty() {
            return;
        }
        let cols = &self.col_targets[x];
        for &dy in rows {
            for &dx in cols {
                self.grid[dy as usize * THUMB_W + dx as usize] = rgb;
            }
        }
    }

    /// Auto-exposure towards middle grey, then ACES filmic + gamma 2.2, as 8-bit RGB.
    pub fn finish(self) -> Vec<u8> {
        let mut exposure = 1.0f64;
        if self.lum_count > 0 {
            let avg = self.lum_sum / self.lum_count as f64;
            if avg > 0.00001 {
                exposure = (0.18 / avg).max(0.05).min(32.0);
            }
        }

        let mut out = Vec::with_capacity(THUMB_W * THUMB_H * 3);
        for px in &self.grid {
            for c in px {
                out.push(aces_filmic(to_float(*c) * exposure));
            }
        }
        out
    }
}

fn to_float(v: f32) -> f64 {
    if v.is_finite() { (v as f64).max(0.0) } else { 0.0 }
}

// ACES filmic curve + gamma 2.2, same constants as the JS thumbnail code.
fn aces_filmic(x: f64) -> u8 {
    if !x.is_finite() || x <= 0.0 {
        return 0;
    }
    let (a, b, c, d, e) = (2.51, 0.03, 2.43, 0.59, 0.14);
    let mapped = (x * (a * x + b)) / (x * (c * x + d) + e);
    let clamped = mapped.max(0.0).min(1.0);
    (clamped.powf(1.0 / 2.2) * 255.0).round().max(0.0).min(255.0) as u8
}

fn exr_thumbnail(src: &Path) -> Result<Vec<u8>, String> {
    use exr::prelude::*;

    // Pixels are streamed into the sampler as blocks are decompressed; the full image is never stored.
    let image = read()
        .no_deep_data()
        .largest_resolution_level()
        .rgba_channels(
            |resolution: Vec2<usize>, _| FloatSampler::new(resolution.width(), resolution.height(), true),
            |sampler: &mut FloatSampler, position: Vec2<usize>, (r, g, b, _a): (f32, f32, f32, f32)| {
                sampler.pixel(position.x(), position.y(), [r, g, b]);
            },
        )
        .first_valid_layer()
        .all_attributes()
        .from_file(src)
        .map_err(|e| e.to_string())?;

    Ok(image.layer_data.channel_data.pixels.finish())
}

fn hdr_thumbnail(src: &Path) -> Result<Vec<u8>, String> {
    let img = image::ImageReader::open(src)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?
        .into_rgb32f();

    let (w, h) = (img.width() as usize, img.height() as usize);
    if w == 0 || h == 0 {
        return Err("Empty image".into());
    }

    let mut sampler = FloatSampler::new(w, h, false);
    for y in 0..h {
        if !sampler.wants_row(y) {
            continue;
        }
        for x in 0..w {
            let p = img.get_pixel(x as u32, y as u32);
            sampler.pixel(x, y, [p[0], p[1], p[2]]);
        }
    }
    Ok(sampler.finish())
}

// ---------------------------------------------------------------------------------------------------
// 8-bit images (TGA / TIFF)
// ---------------------------------------------------------------------------------------------------

fn ldr_thumbnail(src: &Path) -> Result<Vec<u8>, String> {
    let img = image::ImageReader::open(src)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?
        .into_rgb8();

    let (w, h) = (img.width() as usize, img.height() as usize);
    if w == 0 || h == 0 {
        return Err("Empty image".into());
    }

    let mut out = Vec::with_capacity(THUMB_W * THUMB_H * 3);
    for dy in 0..THUMB_H {
        let sy = (((dy as f64 / THUMB_H as f64) * h as f64).floor() as usize).min(h - 1);
        for dx in 0..THUMB_W {
            let sx = (((dx as f64 / THUMB_W as f64) * w as f64).floor() as usize).min(w - 1);
            let p = img.get_pixel(sx as u32, sy as u32);
            out.extend_from_slice(&p.0);
        }
    }
    Ok(out)
}
