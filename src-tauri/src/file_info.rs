//! Header-only details for the Inspector drawer: pixel size, colour layout, EXR channels, video and audio streams and
//! the file's dates.
//! Only the header is read, never the pixels, so the drawer stays quick on large files and over the network.

use crate::media_info;
use exr::meta::MetaData;
use image::ImageDecoder;
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// The decoder's name for the format, e.g. "Png" or "Tga"; the EXR reader fills in "OpenExr"
    pub format: Option<String>,
    /// Colour and bit layout, e.g. "Rgba8" or "Rgb16"
    pub color_type: Option<String>,
    /// EXR: channel names of the first part, e.g. "R", "G", "B", "A"
    pub channels: Vec<String>,
    /// EXR: sample types used by the channels, e.g. "F16" or "F16, F32"
    pub sample_type: Option<String>,
    /// EXR: compression method, e.g. "ZIP16" or "PIZ"
    pub compression: Option<String>,
    /// EXR: number of parts (more than one for multi-part files)
    pub parts: Option<usize>,
    /// Video and audio: length in seconds, where the container header states it
    pub duration: Option<f64>,
    /// Video: codec name such as "H.264 (High)" and frames per second
    pub video_codec: Option<String>,
    pub frame_rate: Option<f64>,
    /// Audio (a video's first audio track too): codec name, sample rate in Hz, channel count and bits per sample
    pub audio_codec: Option<String>,
    pub sample_rate: Option<u32>,
    pub audio_channels: Option<u32>,
    pub bit_depth: Option<u32>,
    /// Milliseconds since the Unix epoch, like FileItem.modified
    pub created: Option<f64>,
    pub modified: Option<f64>,
}

fn to_millis(time: std::io::Result<SystemTime>) -> Option<f64> {
    time.ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs_f64() * 1000.0)
}

// Reads the header of a raster image. A format the image crate cannot decode still reports its name.
fn read_image_header(path: &Path, info: &mut FileInfo) {
    let Ok(reader) = image::ImageReader::open(path).and_then(|r| r.with_guessed_format()) else {
        return;
    };
    info.format = reader.format().map(|f| format!("{f:?}"));
    let Ok(decoder) = reader.into_decoder() else {
        return;
    };
    let (width, height) = decoder.dimensions();
    info.width = Some(width);
    info.height = Some(height);
    info.color_type = Some(format!("{:?}", decoder.color_type()));
}

// Reads the headers of an OpenEXR file. Pixel data and the offset tables stay on disk.
fn read_exr_header(path: &Path, info: &mut FileInfo) -> Option<()> {
    let meta = MetaData::read_from_file(path, false).ok()?;
    let header = meta.headers.first()?;
    info.format = Some("OpenExr".into());
    info.parts = Some(meta.headers.len());
    info.width = Some(header.layer_size.x() as u32);
    info.height = Some(header.layer_size.y() as u32);
    info.compression = Some(format!("{:?}", header.compression));

    let mut types: Vec<String> = Vec::new();
    for channel in header.channels.list.iter() {
        info.channels.push(channel.name.to_string());
        let sample = format!("{:?}", channel.sample_type);
        if !types.contains(&sample) {
            types.push(sample);
        }
    }
    if !types.is_empty() {
        info.sample_type = Some(types.join(", "));
    }
    Some(())
}

// Details of one file or folder. A header that cannot be read leaves its fields empty rather than failing the call.
pub fn read_file_info(path: &Path) -> Result<FileInfo, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    let mut info = FileInfo {
        created: to_millis(meta.created()),
        modified: to_millis(meta.modified()),
        ..FileInfo::default()
    };
    if meta.is_dir() {
        return Ok(info);
    }

    if media_info::is_media_extension(path) {
        if let Some(media) = media_info::read_media_info(path) {
            info.width = media.width;
            info.height = media.height;
            info.duration = media.duration;
            info.video_codec = media.video_codec;
            info.frame_rate = media.frame_rate;
            info.audio_codec = media.audio_codec;
            info.sample_rate = media.sample_rate;
            info.audio_channels = media.channels;
            info.bit_depth = media.bit_depth;
        }
        return Ok(info);
    }

    let is_exr = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("exr"));
    if is_exr {
        let _ = read_exr_header(path, &mut info);
    } else {
        read_image_header(path, &mut info);
    }
    Ok(info)
}
