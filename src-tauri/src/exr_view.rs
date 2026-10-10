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

// ---------------------------------------------------------------------------------------------------
// Layers of a multi-layer / multi-pass file
// ---------------------------------------------------------------------------------------------------

/// What the layer is made of, which also decides how its channels turn into a picture.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LayerKind {
    Rgba,
    Rgb,
    Xyz,
    /// One channel (depth, a mask, ...), copied into red, green and blue
    Single,
}

/// The channels that turn one layer into RGBA, by their full names in the file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LayerPlan {
    pub name: String,
    pub kind: LayerKind,
    pub r: String,
    pub g: String,
    pub b: String,
    pub a: Option<String>,
}

/// The name the viewer gives to the channels that have no layer prefix
pub const MAIN_LAYER: &str = "(Main / Beauty)";

/// Splits the channel names into layers the way the viewer's JavaScript loader does: "diffuse.R" belongs to
/// the layer "diffuse", a plain R, G, B or A to the main layer, any other plain name to a layer of its own.
/// A layer is `None` when its channels are not a picture this app can show (luminance/chroma data).
fn layer_plans(header: &exr::meta::header::Header) -> Vec<(String, Option<LayerPlan>)> {
    let mut groups: Vec<(String, Vec<(String, String)>)> = Vec::new();
    for channel in header.channels.list.iter() {
        let full = channel.name.to_string();
        let (layer, short) = match full.rfind('.') {
            Some(dot) => (full[..dot].to_string(), full[dot + 1..].to_string()),
            None if ["R", "G", "B", "A", "r", "g", "b", "a"].contains(&full.as_str()) => (MAIN_LAYER.to_string(), full.clone()),
            None => (full.clone(), full.clone()),
        };
        match groups.iter_mut().find(|(name, _)| *name == layer) {
            Some((_, channels)) => channels.push((short, full)),
            None => groups.push((layer, vec![(short, full)])),
        }
    }
    groups
        .into_iter()
        .map(|(name, channels)| {
            let plan = plan_layer(&name, &channels);
            (name, plan)
        })
        .collect()
}

fn plan_layer(name: &str, channels: &[(String, String)]) -> Option<LayerPlan> {
    let find = |names: &[&str]| channels.iter().find(|(short, _)| names.contains(&short.as_str())).map(|(_, full)| full.clone());
    let plan = |kind, r: String, g: String, b: String, a: Option<String>| LayerPlan { name: name.to_string(), kind, r, g, b, a };

    if let (Some(r), Some(g), Some(b)) = (find(&["R", "r"]), find(&["G", "g"]), find(&["B", "b"])) {
        let a = find(&["A", "a"]);
        let kind = if a.is_some() { LayerKind::Rgba } else { LayerKind::Rgb };
        return Some(plan(kind, r, g, b, a));
    }
    if let (Some(x), Some(y), Some(z)) = (find(&["X", "x"]), find(&["Y", "y"]), find(&["Z", "z"])) {
        return Some(plan(LayerKind::Xyz, x, y, z, None));
    }
    if find(&["Y"]).is_some() && find(&["RY"]).is_some() && find(&["BY"]).is_some() && channels.len() == 3 {
        return None;
    }
    if let Some(single) = find(&["Z", "z", "Y", "y", "V", "v"]).or_else(|| (channels.len() == 1).then(|| channels[0].1.clone())) {
        return Some(plan(LayerKind::Single, single.clone(), single.clone(), single, None));
    }
    // Anything else: the first channels stand in for the picture
    match channels {
        [(_, r), (_, g), (_, b), rest @ ..] => {
            let a = rest.first().map(|(_, full)| full.clone());
            let kind = if a.is_some() { LayerKind::Rgba } else { LayerKind::Rgb };
            Some(plan(kind, r.clone(), g.clone(), b.clone(), a))
        }
        [(_, first), ..] => Some(plan(LayerKind::Single, first.clone(), first.clone(), first.clone(), None)),
        [] => None,
    }
}

/// Which layer a request means: the one with that name (or that name as the tail of a layer path), else the
/// beauty layer: "Combined", "Beauty", the main R/G/B channels, the first RGB layer, the first layer.
fn choose_layer<'a>(layers: &'a [(String, Option<LayerPlan>)], requested: Option<&str>) -> Option<&'a (String, Option<LayerPlan>)> {
    if let Some(wanted) = requested.map(str::trim).filter(|w| !w.is_empty()) {
        if let Some(exact) = layers.iter().find(|(name, _)| name == wanted) {
            return Some(exact);
        }
        let wanted = wanted.to_lowercase();
        return layers.iter().find(|(name, _)| {
            let name = name.to_lowercase();
            name == wanted || name.ends_with(&format!(".{wanted}")) || wanted.ends_with(&format!(".{name}"))
        });
    }
    let is_rgb = |layer: &&(String, Option<LayerPlan>)| matches!(&layer.1, Some(p) if matches!(p.kind, LayerKind::Rgb | LayerKind::Rgba));
    let has = |text: &str| layers.iter().find(|(name, _)| name.to_lowercase().contains(text));
    has("combined")
        .or_else(|| has("beauty"))
        .or_else(|| layers.iter().find(|(name, _)| name == MAIN_LAYER).filter(|l| is_rgb(l)))
        .or_else(|| layers.iter().find(is_rgb))
        .or_else(|| layers.first())
}

fn read_layers(path: &Path) -> std::result::Result<Vec<(String, Option<LayerPlan>)>, String> {
    let meta = MetaData::read_from_file(path, false).map_err(|e| e.to_string())?;
    if meta.headers.len() != 1 {
        return Err("This EXR has several parts, which the converter cannot read yet.".into());
    }
    if meta.headers[0].deep {
        return Err("Deep EXR files cannot be converted.".into());
    }
    Ok(layer_plans(&meta.headers[0]))
}

/// A layer as the converter dialog lists it.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct LayerEntry {
    pub name: String,
    pub kind: LayerKind,
}

/// The layers of a single-part EXR, the one converted by default first and the rest in file order, without
/// reading any pixels. Layers that are not a picture (luminance/chroma data) are left out.
pub fn list_layers(path: &Path) -> std::result::Result<Vec<LayerEntry>, String> {
    let layers = read_layers(path)?;
    let default = choose_layer(&layers, None).map(|(name, _)| name.clone());
    let mut entries: Vec<LayerEntry> = layers
        .into_iter()
        .filter_map(|(_, plan)| plan)
        .map(|p| LayerEntry { name: p.name, kind: p.kind })
        .collect();
    if let Some(at) = entries.iter().position(|e| Some(&e.name) == default.as_ref()) {
        entries[..=at].rotate_right(1);
    }
    Ok(entries)
}

/// What `decode_layer` returns: the size, the interleaved RGBA bytes (bottom row first, little endian), whether
/// they are half float, and whether the alpha is the layer's own (otherwise it is 1.0).
pub struct DecodedLayer {
    pub width: usize,
    pub height: usize,
    pub bytes: Vec<u8>,
    pub half: bool,
    pub has_alpha: bool,
}

/// Decodes one layer of a single-part EXR. `requested` is a layer name from `list_layers`; without one the
/// beauty layer is used. With `prefer_half`, a layer stored as half float stays half float. Alpha is only
/// read when `want_alpha` is set and the layer has one.
pub fn decode_layer(path: &Path, requested: Option<&str>, prefer_half: bool, want_alpha: bool) -> std::result::Result<DecodedLayer, String> {
    let layers = read_layers(path)?;
    let (name, plan) = match choose_layer(&layers, requested) {
        Some(layer) => layer,
        None => return Err(match requested.map(str::trim).filter(|w| !w.is_empty()) {
            Some(wanted) => format!("This file has no layer named {wanted}."),
            None => "This file has no image layer.".into(),
        }),
    };
    let plan = plan.as_ref().ok_or_else(|| format!("The layer {name} is not a picture the converter can read."))?;
    let alpha = if want_alpha { plan.a.as_deref() } else { None };
    let (width, height, bytes, half) = decode_rgba(path, &plan.r, &plan.g, &plan.b, alpha, prefer_half)?;
    Ok(DecodedLayer { width, height, bytes, half, has_alpha: alpha.is_some() })
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

    /// A single-part file with these channels, each filled with a constant (all float32 unless named in `half`)
    fn write_channels(path: &std::path::Path, size: (usize, usize), channels: &[(&str, f32)]) {
        let list: SmallVec<[AnyChannel<FlatSamples>; 4]> = channels
            .iter()
            .map(|(name, value)| AnyChannel::new(*name, FlatSamples::F32(vec![*value; size.0 * size.1])))
            .collect();
        Image::from_channels(size, AnyChannels::sort(list)).write().to_file(path).unwrap();
    }

    fn layer_names(path: &std::path::Path) -> Vec<String> {
        list_layers(path).unwrap().into_iter().map(|l| l.name).collect()
    }

    #[test]
    fn a_multi_layer_file_lists_each_layer_with_its_kind() {
        let path = temp_exr("layers");
        write_channels(
            &path,
            (4, 2),
            &[("A", 1.0), ("B", 0.3), ("G", 0.2), ("R", 0.1), ("diffuse.R", 0.5), ("diffuse.G", 0.6), ("diffuse.B", 0.7), ("depth.Z", 9.0), ("N.X", 0.0), ("N.Y", 1.0), ("N.Z", 0.0)],
        );
        let layers = list_layers(&path).unwrap();
        std::fs::remove_file(&path).ok();

        let kinds: Vec<(&str, LayerKind)> = layers.iter().map(|l| (l.name.as_str(), l.kind)).collect();
        assert!(kinds.contains(&(MAIN_LAYER, LayerKind::Rgba)));
        assert!(kinds.contains(&("diffuse", LayerKind::Rgb)));
        assert!(kinds.contains(&("depth", LayerKind::Single)));
        assert!(kinds.contains(&("N", LayerKind::Xyz)));
        assert_eq!(layers.len(), 4);
    }

    #[test]
    fn a_requested_layer_is_decoded_and_the_others_are_left_alone() {
        let path = temp_exr("pick");
        write_channels(
            &path,
            (4, 2),
            &[("R", 0.1), ("G", 0.2), ("B", 0.3), ("A", 0.4), ("diffuse.R", 0.5), ("diffuse.G", 0.6), ("diffuse.B", 0.7), ("depth.Z", 9.0)],
        );
        let pixel = |requested: Option<&str>, want_alpha: bool| {
            let layer = decode_layer(&path, requested, false, want_alpha).unwrap();
            assert_eq!((layer.width, layer.height), (4, 2));
            ([f32_at(&layer.bytes, 0), f32_at(&layer.bytes, 1), f32_at(&layer.bytes, 2), f32_at(&layer.bytes, 3)], layer.has_alpha)
        };

        assert_eq!(pixel(None, true), ([0.1, 0.2, 0.3, 0.4], true));
        // Without asking for alpha the picture is opaque
        assert_eq!(pixel(None, false), ([0.1, 0.2, 0.3, 1.0], false));
        assert_eq!(pixel(Some("diffuse"), true), ([0.5, 0.6, 0.7, 1.0], false));
        // A single channel fills red, green and blue
        assert_eq!(pixel(Some("depth"), true), ([9.0, 9.0, 9.0, 1.0], false));
        // Names are matched like the viewer does: ignoring case, and by the tail of a layer path
        assert_eq!(pixel(Some("DIFFUSE"), false).0, [0.5, 0.6, 0.7, 1.0]);
        let missing = decode_layer(&path, Some("specular"), false, false).err().unwrap();
        std::fs::remove_file(&path).ok();
        assert!(missing.contains("specular"), "{missing}");
    }

    #[test]
    fn the_beauty_layer_is_the_default_when_there_is_no_main_picture() {
        let path = temp_exr("beauty");
        write_channels(
            &path,
            (2, 2),
            &[("ViewLayer.AO.R", 0.9), ("ViewLayer.AO.G", 0.9), ("ViewLayer.AO.B", 0.9), ("ViewLayer.Combined.R", 0.1), ("ViewLayer.Combined.G", 0.2), ("ViewLayer.Combined.B", 0.3), ("ViewLayer.Combined.A", 1.0)],
        );
        // The default layer is listed first
        assert_eq!(layer_names(&path), vec!["ViewLayer.Combined", "ViewLayer.AO"]);
        let layer = decode_layer(&path, None, false, true).unwrap();
        let by_tail = decode_layer(&path, Some("Combined"), false, false).unwrap();
        std::fs::remove_file(&path).ok();
        assert_eq!(f32_at(&layer.bytes, 0), 0.1);
        assert!(layer.has_alpha);
        assert_eq!(f32_at(&by_tail.bytes, 2), 0.3);
    }
}
