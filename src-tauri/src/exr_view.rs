//! Native EXR decode for the image viewer.
//!
//! The JavaScript decoder in `src/utils/exrLoaderExtended.js` inflates and copies every block on the UI
//! thread. This decodes the chosen R, G, B (and optional A) channels with the `exr` crate, which
//! decompresses blocks on all cores, and hands the viewer ready-made interleaved RGBA float32 bytes laid
//! out exactly as the JavaScript loader leaves them (row 0 is the bottom of the image).
//!
//! Errors mean "decode this one in JavaScript instead" (DWA compression, subsampled or deep data, ...).

use exr::prelude::*;
use std::path::Path;

/// Channel names that no file contains, so an optional channel falls back to its default.
const NO_ALPHA: &str = "\u{1}no-alpha";
const NO_GREEN: &str = "\u{1}no-green";
const NO_BLUE: &str = "\u{1}no-blue";

/// Checks the header and returns whether the request is the single-channel case (`r`, `g` and `b` the same
/// name), and whether every channel it reads is stored as half float.
fn check_request(path: &Path, r: &str, g: &str, b: &str, a: Option<&str>) -> std::result::Result<(bool, bool), String> {
    // Read the header first so the cases the JavaScript decoder should take fail fast and cleanly.
    let meta = MetaData::read_from_file(path, false).map_err(|e| e.to_string())?;
    if meta.headers.len() != 1 {
        return Err("multi-part file".into());
    }
    let header = &meta.headers[0];
    if header.deep {
        return Err("deep data".into());
    }
    let expand = r == g && g == b;
    let wanted = [Some(r), if expand { None } else { Some(g) }, if expand { None } else { Some(b) }, a];
    let mut all_half = true;
    for name in wanted.into_iter().flatten() {
        match header.channels.list.iter().find(|c| c.name.to_string() == name) {
            Some(channel) => all_half &= matches!(channel.sample_type, SampleType::F16),
            None => return Err(format!("no channel named {name}")),
        }
    }
    Ok((expand, all_half))
}

/// Builds the RGBA decoder for one sample type. `$bytes` is the size of one sample.
macro_rules! rgba_decoder {
    ($name:ident, $ty:ty, $bytes:expr, $zero:expr, $one:expr) => {
        fn $name(
            path: &Path,
            r: &str,
            g: &str,
            b: &str,
            a: Option<&str>,
            expand: bool,
        ) -> std::result::Result<(usize, usize, Vec<u8>), String> {
            let image = read()
                .no_deep_data()
                .largest_resolution_level()
                .specific_channels()
                .required(r)
                .optional(if expand { NO_GREEN } else { g }, $zero)
                .optional(if expand { NO_BLUE } else { b }, $zero)
                .optional(a.unwrap_or(NO_ALPHA), $one)
                .collect_pixels(
                    |resolution: Vec2<usize>, _| {
                        let (w, h) = (resolution.width(), resolution.height());
                        (w, h, vec![0_u8; w * h * 4 * $bytes])
                    },
                    move |storage: &mut (usize, usize, Vec<u8>), position: Vec2<usize>, (r, g, b, a): ($ty, $ty, $ty, $ty)| {
                        let (g, b) = if expand { (r, r) } else { (g, b) };
                        let (w, h) = (storage.0, storage.1);
                        let row = h - 1 - position.y();
                        let at = (row * w + position.x()) * 4 * $bytes;
                        let out = &mut storage.2[at..at + 4 * $bytes];
                        out[0..$bytes].copy_from_slice(&r.to_le_bytes());
                        out[$bytes..2 * $bytes].copy_from_slice(&g.to_le_bytes());
                        out[2 * $bytes..3 * $bytes].copy_from_slice(&b.to_le_bytes());
                        out[3 * $bytes..4 * $bytes].copy_from_slice(&a.to_le_bytes());
                    },
                )
                .first_valid_layer()
                .all_attributes()
                .from_file(path)
                .map_err(|e| e.to_string())?;

            let (w, h, bytes) = image.layer_data.channel_data.pixels;
            Ok((w, h, bytes))
        }
    };
}

rgba_decoder!(decode_f32, f32, 4, 0.0_f32, 1.0_f32);
rgba_decoder!(decode_f16, f16, 2, f16::ZERO, f16::ONE);

/// Decodes the named channels of a single-part file into interleaved RGBA, bottom row first, little endian.
/// With `prefer_half` and a file whose chosen channels are all half float, the samples stay half float
/// (8 bytes per pixel, exact); otherwise they are float32 (16 bytes per pixel). Returns the size, the bytes,
/// and whether they are half float.
///
/// When `r`, `g` and `b` are the same name (a single channel such as depth), that channel is copied
/// into all three, like the JavaScript loader does for single-channel images. Alpha is 1.0 when `a` is `None`.
pub fn decode_rgba(
    path: &Path,
    r: &str,
    g: &str,
    b: &str,
    a: Option<&str>,
    prefer_half: bool,
) -> std::result::Result<(usize, usize, Vec<u8>, bool), String> {
    let (expand, all_half) = check_request(path, r, g, b, a)?;
    if prefer_half && all_half {
        decode_f16(path, r, g, b, a, expand).map(|(w, h, bytes)| (w, h, bytes, true))
    } else {
        decode_f32(path, r, g, b, a, expand).map(|(w, h, bytes)| (w, h, bytes, false))
    }
}

/// Float32 convenience wrapper (used by the tests).
#[cfg(test)]
pub fn decode_rgba_f32(
    path: &Path,
    r: &str,
    g: &str,
    b: &str,
    a: Option<&str>,
) -> std::result::Result<(usize, usize, Vec<u8>), String> {
    decode_rgba(path, r, g, b, a, false).map(|(w, h, bytes, _)| (w, h, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_exr(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("cg_exr_view_{}_{}.exr", std::process::id(), name))
    }

    fn f32_at(bytes: &[u8], index: usize) -> f32 {
        f32::from_le_bytes(bytes[index * 4..index * 4 + 4].try_into().unwrap())
    }

    #[test]
    fn decodes_rgba_bottom_row_first() {
        let path = temp_exr("rgba");
        let (w, h) = (5, 3);
        write_rgba_file(&path, w, h, |x, y| (x as f32, y as f32, 0.5_f32, 0.25_f32)).unwrap();

        let (dw, dh, bytes) = decode_rgba_f32(&path, "R", "G", "B", Some("A")).unwrap();
        std::fs::remove_file(&path).ok();

        assert_eq!((dw, dh), (w, h));
        assert_eq!(bytes.len(), w * h * 16);
        // Output row 0 is the bottom of the image (y = h - 1)
        for out_row in 0..h {
            for x in 0..w {
                let p = (out_row * w + x) * 4;
                assert_eq!(f32_at(&bytes, p), x as f32);
                assert_eq!(f32_at(&bytes, p + 1), (h - 1 - out_row) as f32);
                assert_eq!(f32_at(&bytes, p + 2), 0.5);
                assert_eq!(f32_at(&bytes, p + 3), 0.25);
            }
        }
    }

    #[test]
    fn missing_alpha_is_opaque_and_missing_channel_is_an_error() {
        let path = temp_exr("alpha");
        write_rgb_file(&path, 4, 2, |x, y| (x as f32, y as f32, 1.0_f32)).unwrap();

        let (_, _, bytes) = decode_rgba_f32(&path, "R", "G", "B", None).unwrap();
        assert_eq!(f32_at(&bytes, 3), 1.0);
        assert!(decode_rgba_f32(&path, "R", "G", "Nope", None).is_err());
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn single_channel_is_copied_into_rgb() {
        let path = temp_exr("single");
        write_rgb_file(&path, 4, 2, |x, y| (x as f32 + 1.0, y as f32, 1.0_f32)).unwrap();

        let (_, _, bytes) = decode_rgba_f32(&path, "R", "R", "R", None).unwrap();
        std::fs::remove_file(&path).ok();
        // Output row 0 is the bottom row (y = 1); pixel x = 2 holds R = 3
        let p = 2 * 4;
        assert_eq!((f32_at(&bytes, p), f32_at(&bytes, p + 1), f32_at(&bytes, p + 2), f32_at(&bytes, p + 3)), (3.0, 3.0, 3.0, 1.0));
    }

    #[test]
    fn half_files_stay_half_when_asked() {
        let path = temp_exr("half");
        // write_rgba_file stores f32; build a half-float file through the full writer API instead
        let size = (6, 2);
        let channels = SpecificChannels::rgba(|pos: Vec2<usize>| (f16::from_f32(pos.x() as f32), f16::from_f32(pos.y() as f32), f16::from_f32(0.5), f16::from_f32(0.25)));
        Image::from_channels(size, channels).write().to_file(&path).unwrap();

        let (w, h, bytes, half) = decode_rgba(&path, "R", "G", "B", Some("A"), true).unwrap();
        assert!(half);
        assert_eq!(bytes.len(), w * h * 8);
        // bottom row first: output row 0 is y = 1; pixel x = 3
        let at = 3 * 8;
        let h16 = |i: usize| f16::from_le_bytes([bytes[at + i * 2], bytes[at + i * 2 + 1]]).to_f32();
        assert_eq!((h16(0), h16(1), h16(2), h16(3)), (3.0, 1.0, 0.5, 0.25));

        // the same file asked for float32 decodes to the same values
        let (_, _, bytes32, half32) = decode_rgba(&path, "R", "G", "B", Some("A"), false).unwrap();
        std::fs::remove_file(&path).ok();
        assert!(!half32);
        assert_eq!(f32_at(&bytes32, 4 * 0 + 0), 0.0);
        assert_eq!(f32_at(&bytes32, 3 * 4), 3.0);
    }
}
