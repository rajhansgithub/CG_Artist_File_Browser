//! Header-only details of video and audio files for the Inspector drawer: codec, frame rate, sample rate, channels and
//! bit depth. Only the container header is read (the index of an MP4, the track list of a Matroska file, the format
//! chunk of a WAV), never the audio or video data, so the drawer stays quick on large files and over the network.
//! The parsers are small and have no dependencies, so the app does not grow. A value a file does not state is left out.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Default, Debug, PartialEq)]
pub struct MediaInfo {
    /// Frame size in pixels of the first video track
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Length in seconds, where the header states it
    pub duration: Option<f64>,
    pub video_codec: Option<String>,
    pub frame_rate: Option<f64>,
    pub audio_codec: Option<String>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
    pub bit_depth: Option<u32>,
}

impl MediaInfo {
    fn is_empty(&self) -> bool {
        *self == MediaInfo::default()
    }
}

// Most headers sit in the first few kilobytes. These caps stop a damaged file from making the reader chase huge boxes.
const MAX_MOOV_BYTES: u64 = 48 * 1024 * 1024;
const MAX_MKV_ELEMENT_BYTES: u64 = 4 * 1024 * 1024;
const AVI_HEADER_BYTES: usize = 256 * 1024;
const SCAN_BYTES: usize = 64 * 1024;

fn be16(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(b.get(at..at + 2)?.try_into().ok()?))
}
fn be32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}
fn be64(b: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_be_bytes(b.get(at..at + 8)?.try_into().ok()?))
}
fn le16(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?))
}
fn le32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

fn read_at<R: Read + Seek>(r: &mut R, pos: u64, len: usize) -> Option<Vec<u8>> {
    r.seek(SeekFrom::Start(pos)).ok()?;
    let mut buf = Vec::new();
    r.take(len as u64).read_to_end(&mut buf).ok()?;
    Some(buf)
}

fn len_of<R: Seek>(r: &mut R) -> Option<u64> {
    r.seek(SeekFrom::End(0)).ok()
}

// Whole-hertz sample rates are shown as they are; the codec's own name is kept short and familiar.
fn positive(v: u32) -> Option<u32> {
    (v > 0).then_some(v)
}

// ---------------------------------------------------------------------------------------------------------------------
// MP4, MOV, M4A (ISO base media): boxes of [size][type][body]
// ---------------------------------------------------------------------------------------------------------------------

struct BoxRef<'a> {
    kind: [u8; 4],
    body: &'a [u8],
}

// The boxes laid end to end in `data`. A damaged size ends the walk.
fn boxes(data: &[u8]) -> Vec<BoxRef<'_>> {
    let mut out = Vec::new();
    let mut at = 0usize;
    while at + 8 <= data.len() {
        let size = be32(data, at).unwrap_or(0) as u64;
        let kind: [u8; 4] = data[at + 4..at + 8].try_into().unwrap();
        let (header, total) = match size {
            0 => (8, (data.len() - at) as u64),
            1 => match be64(data, at + 8) {
                Some(big) => (16, big),
                None => break,
            },
            n => (8, n),
        };
        if total < header as u64 || at as u64 + total > data.len() as u64 {
            break;
        }
        out.push(BoxRef { kind, body: &data[at + header..at + total as usize] });
        at += total as usize;
    }
    out
}

fn find<'a>(list: &'a [BoxRef<'a>], kind: &[u8; 4]) -> Option<&'a BoxRef<'a>> {
    list.iter().find(|b| &b.kind == kind)
}

// Reads the top-level boxes by hopping over each body, and returns the body of the first box of `kind`.
fn read_top_level_box<R: Read + Seek>(r: &mut R, kind: &[u8; 4], max: u64) -> Option<Vec<u8>> {
    let total = len_of(r)?;
    let mut pos = 0u64;
    for _ in 0..256 {
        let head = read_at(r, pos, 16)?;
        if head.len() < 8 {
            return None;
        }
        let size = be32(&head, 0)? as u64;
        let (header, size) = match size {
            0 => (8, total - pos),
            1 => (16, be64(&head, 8)?),
            n => (8, n),
        };
        if size < header {
            return None;
        }
        if head[4..8] == kind[..] {
            if size - header > max || pos + size > total {
                return None;
            }
            return read_at(r, pos + header, (size - header) as usize);
        }
        pos += size;
        if pos + 8 > total {
            return None;
        }
    }
    None
}

fn mp4_video_name(format: &[u8], entry: &[u8]) -> String {
    match format {
        b"avc1" | b"avc3" => {
            // The avcC child (after the 78-byte visual header) names the profile
            let profile = boxes(entry.get(78..).unwrap_or(&[]))
                .iter()
                .find(|b| &b.kind == b"avcC")
                .and_then(|b| b.body.get(1).copied())
                .and_then(|p| match p {
                    66 => Some("Baseline"),
                    77 => Some("Main"),
                    88 => Some("Extended"),
                    100 => Some("High"),
                    110 => Some("High 10"),
                    122 => Some("High 4:2:2"),
                    244 => Some("High 4:4:4"),
                    _ => None,
                });
            match profile {
                Some(p) => format!("H.264 ({p})"),
                None => "H.264".into(),
            }
        }
        b"hvc1" | b"hev1" => "H.265 (HEVC)".into(),
        b"av01" => "AV1".into(),
        b"vp08" => "VP8".into(),
        b"vp09" => "VP9".into(),
        b"mp4v" => "MPEG-4 Visual".into(),
        b"apch" => "ProRes 422 HQ".into(),
        b"apcn" => "ProRes 422".into(),
        b"apcs" => "ProRes 422 LT".into(),
        b"apco" => "ProRes 422 Proxy".into(),
        b"ap4h" => "ProRes 4444".into(),
        b"ap4x" => "ProRes 4444 XQ".into(),
        b"jpeg" | b"mjpa" | b"mjpb" => "Motion JPEG".into(),
        b"dvc " | b"dvcp" | b"dvpp" => "DV".into(),
        b"cfhd" => "CineForm".into(),
        b"png " => "PNG".into(),
        other => String::from_utf8_lossy(other).trim().to_string(),
    }
}

fn aac_object_name(object: u8) -> &'static str {
    match object {
        1 => "AAC Main",
        2 => "AAC LC",
        3 => "AAC SSR",
        4 => "AAC LTP",
        5 => "HE-AAC",
        29 => "HE-AAC v2",
        _ => "AAC",
    }
}

const AAC_RATES: [u32; 13] = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

// Length of an MPEG-4 descriptor (1 to 4 bytes of 7 bits each); returns (length, bytes used)
fn descriptor_len(b: &[u8], at: usize) -> Option<(usize, usize)> {
    let mut len = 0usize;
    for i in 0..4 {
        let byte = *b.get(at + i)?;
        len = (len << 7) | (byte & 0x7f) as usize;
        if byte & 0x80 == 0 {
            return Some((len, i + 1));
        }
    }
    None
}

// AAC channel configuration: 1 to 6 are channel counts, 7 is 7.1 (eight channels), 0 is "see the stream"
fn channel_count(config: u8) -> Option<u32> {
    match config {
        0 => None,
        7 => Some(8),
        n => Some(n as u32),
    }
}

struct Esds {
    codec: Option<String>,
    sample_rate: Option<u32>,
    channels: Option<u32>,
}

// The esds box carries the real audio codec behind "mp4a", and for AAC the sample rate and channel layout.
fn parse_esds(body: &[u8]) -> Esds {
    let mut out = Esds { codec: None, sample_rate: None, channels: None };
    // Four bytes of version and flags, then tag 0x03 (ES descriptor), 0x04 (decoder config), 0x05 (specific info)
    let mut at = 4usize;
    if body.get(at) != Some(&0x03) {
        return out;
    }
    let Some((_, used)) = descriptor_len(body, at + 1) else { return out };
    at += 1 + used + 3; // ES_ID (2) and flags (1)
    if body.get(at) != Some(&0x04) {
        return out;
    }
    let Some((_, used)) = descriptor_len(body, at + 1) else { return out };
    at += 1 + used;
    let object = body.get(at).copied().unwrap_or(0);
    out.codec = match object {
        0x40 | 0x66 | 0x67 | 0x68 => Some("AAC".into()),
        0x69 | 0x6b => Some("MP3".into()),
        0x6c => Some("JPEG".into()),
        0xa5 => Some("AC-3".into()),
        0xa6 => Some("E-AC-3".into()),
        0xdd => Some("Vorbis".into()),
        _ => None,
    };
    at += 13; // object type, stream type, buffer size, max and average bitrate
    if object == 0x40
        && body.get(at) == Some(&0x05)
        && let Some((len, used)) = descriptor_len(body, at + 1)
    {
        let start = at + 1 + used;
        if let Some(asc) = body.get(start..start + len.max(2)) {
            let mut object_type = asc[0] >> 3;
            let index = (((asc[0] & 7) << 1) | (asc[1] >> 7)) as usize;
            let mut channel_bits = (asc[1] >> 3) & 0x0f;
            if object_type == 31 {
                object_type = 32 + (((asc[0] & 7) << 3) | (asc[1] >> 5));
            }
            if object_type <= 31 {
                out.codec = Some(aac_object_name(object_type).into());
            } else {
                channel_bits = 0;
            }
            out.sample_rate = AAC_RATES.get(index).copied();
            out.channels = channel_count(channel_bits);
        }
    }
    out
}

fn mp4_audio_name(format: &[u8]) -> Option<&'static str> {
    Some(match format {
        b"alac" => "ALAC",
        b"ac-3" => "AC-3",
        b"ec-3" => "E-AC-3",
        b"Opus" => "Opus",
        b"fLaC" => "FLAC",
        b"sowt" | b"twos" | b"in24" | b"in32" | b"fl32" | b"fl64" | b"lpcm" | b"raw " | b"sowt " => "PCM",
        b".mp3" => "MP3",
        b"samr" => "AMR",
        _ => return None,
    })
}

fn apply_mp4_audio(entry: &[u8], format: &[u8], info: &mut MediaInfo) {
    // 6 reserved, 2 data reference index, then the QuickTime sound description version (2 bytes)
    let version = be16(entry, 8).unwrap_or(0);
    let channels = be16(entry, 16).unwrap_or(0) as u32;
    let size = be16(entry, 18).unwrap_or(0) as u32;
    let rate = be32(entry, 24).unwrap_or(0) >> 16;
    let children_at = match version {
        0 => 28,
        1 => 44,
        _ => entry.len(), // version 2 uses a different layout; the codec name alone is shown
    };
    let children = boxes(entry.get(children_at..).unwrap_or(&[]));

    if version < 2 {
        info.channels = positive(channels);
        info.sample_rate = positive(rate);
    }
    info.audio_codec = mp4_audio_name(format).map(str::to_string);
    if format == b"mp4a" {
        // QuickTime files often wrap the esds box inside a "wave" box
        let wrapped = find(&children, b"wave").map(|w| boxes(w.body));
        let esds = find(&children, b"esds").or_else(|| wrapped.as_ref().and_then(|w| find(w, b"esds")));
        if let Some(esds) = esds.map(|b| parse_esds(b.body)) {
            info.audio_codec = esds.codec;
            info.sample_rate = esds.sample_rate.or(info.sample_rate);
            info.channels = esds.channels.or(info.channels);
        }
        if info.audio_codec.is_none() {
            info.audio_codec = Some("AAC".into());
        }
    } else if info.audio_codec.is_none() {
        info.audio_codec = Some(String::from_utf8_lossy(format).trim().to_string());
    }
    match info.audio_codec.as_deref() {
        Some("PCM") if version < 2 => info.bit_depth = positive(size),
        Some("ALAC") => {
            // The magic cookie: version/flags (4), frame length (4), compatible version (1), bit depth (1)
            if let Some(cookie) = find(&children, b"alac") {
                info.bit_depth = cookie.body.get(9).map(|&b| b as u32).and_then(positive);
            }
        }
        Some("FLAC") if version < 2 => info.bit_depth = positive(size),
        _ => {}
    }
}

// Frames per second from the track's time-to-sample table: sample count over total duration
fn mp4_frame_rate(stts: &[u8], timescale: u32) -> Option<f64> {
    let entries = be32(stts, 4)? as usize;
    let mut samples = 0u64;
    let mut ticks = 0u64;
    for i in 0..entries.min(1_000_000) {
        let count = be32(stts, 8 + i * 8)? as u64;
        let delta = be32(stts, 12 + i * 8)? as u64;
        samples += count;
        ticks += count * delta;
    }
    if samples < 2 || ticks == 0 || timescale == 0 {
        return None;
    }
    Some(samples as f64 * timescale as f64 / ticks as f64)
}

fn parse_moov(moov: &[u8]) -> MediaInfo {
    let mut info = MediaInfo::default();
    let top = boxes(moov);
    if let Some(mvhd) = find(&top, b"mvhd") {
        let b = mvhd.body;
        let (scale, duration) = if b.first() == Some(&1) {
            (be32(b, 20), be64(b, 24))
        } else {
            (be32(b, 12), be32(b, 16).map(u64::from))
        };
        if let (Some(scale), Some(duration)) = (scale, duration)
            && scale > 0
            && duration != u64::MAX
            && duration != u32::MAX as u64
        {
            info.duration = Some(duration as f64 / scale as f64);
        }
    }

    let (mut seen_video, mut seen_audio) = (false, false);
    for trak in top.iter().filter(|b| &b.kind == b"trak") {
        let trak_boxes = boxes(trak.body);
        let Some(mdia) = find(&trak_boxes, b"mdia") else { continue };
        let mdia_boxes = boxes(mdia.body);
        let handler = find(&mdia_boxes, b"hdlr").and_then(|h| h.body.get(8..12));
        let Some(minf) = find(&mdia_boxes, b"minf") else { continue };
        let minf_boxes = boxes(minf.body);
        let Some(stbl) = find(&minf_boxes, b"stbl") else { continue };
        let stbl_boxes = boxes(stbl.body);
        let Some(stsd) = find(&stbl_boxes, b"stsd") else { continue };
        // stsd: version/flags (4), entry count (4), then the first sample entry as an ordinary box
        let Some(entry_box) = boxes(stsd.body.get(8..).unwrap_or(&[])).into_iter().next() else { continue };
        let format = entry_box.kind;
        let entry = entry_box.body;

        match handler {
            Some(b"vide") if !seen_video => {
                seen_video = true;
                info.video_codec = Some(mp4_video_name(&format, entry));
                info.width = be16(entry, 24).map(u32::from).and_then(positive);
                info.height = be16(entry, 26).map(u32::from).and_then(positive);
                let timescale = find(&mdia_boxes, b"mdhd")
                    .and_then(|m| if m.body.first() == Some(&1) { be32(m.body, 20) } else { be32(m.body, 12) });
                if let (Some(stts), Some(scale)) = (find(&stbl_boxes, b"stts"), timescale) {
                    info.frame_rate = mp4_frame_rate(stts.body, scale);
                }
            }
            Some(b"soun") if !seen_audio => {
                seen_audio = true;
                apply_mp4_audio(entry, &format, &mut info);
            }
            _ => {}
        }
    }
    info
}

fn read_mp4<R: Read + Seek>(r: &mut R) -> Option<MediaInfo> {
    let moov = read_top_level_box(r, b"moov", MAX_MOOV_BYTES)?;
    Some(parse_moov(&moov))
}

// ---------------------------------------------------------------------------------------------------------------------
// Matroska and WebM (EBML): [id][size][body], read from the Segment's Info and Tracks elements
// ---------------------------------------------------------------------------------------------------------------------

// An element id keeps its length marker bits
fn ebml_id(b: &[u8], at: usize) -> Option<(u32, usize)> {
    let first = *b.get(at)?;
    let len = first.leading_zeros() as usize + 1;
    if len > 4 {
        return None;
    }
    let mut id = 0u32;
    for i in 0..len {
        id = (id << 8) | *b.get(at + i)? as u32;
    }
    Some((id, len))
}

// A size drops its marker bit; all value bits set means "unknown size"
fn ebml_size(b: &[u8], at: usize) -> Option<(Option<u64>, usize)> {
    let first = *b.get(at)?;
    let len = first.leading_zeros() as usize + 1;
    if len > 8 {
        return None;
    }
    let mut value = (first as u64) & ((1u64 << (8 - len)) - 1);
    let mut all_ones = value == (1u64 << (8 - len)) - 1;
    for i in 1..len {
        let byte = *b.get(at + i)?;
        all_ones &= byte == 0xff;
        value = (value << 8) | byte as u64;
    }
    Some((if all_ones { None } else { Some(value) }, len))
}

// The (id, body) children of an EBML element body. Unknown sizes run to the end of the body.
fn ebml_children(data: &[u8]) -> Vec<(u32, &[u8])> {
    let mut out = Vec::new();
    let mut at = 0usize;
    while at < data.len() {
        let Some((id, id_len)) = ebml_id(data, at) else { break };
        let Some((size, size_len)) = ebml_size(data, at + id_len) else { break };
        let start = at + id_len + size_len;
        let end = match size {
            Some(s) => start.saturating_add(s as usize),
            None => data.len(),
        };
        if end > data.len() {
            break;
        }
        out.push((id, &data[start..end]));
        at = end;
    }
    out
}

fn ebml_uint(b: &[u8]) -> u64 {
    b.iter().take(8).fold(0u64, |acc, &x| (acc << 8) | x as u64)
}

fn ebml_float(b: &[u8]) -> Option<f64> {
    match b.len() {
        4 => Some(f32::from_be_bytes(b.try_into().ok()?) as f64),
        8 => Some(f64::from_be_bytes(b.try_into().ok()?)),
        _ => None,
    }
}

fn mkv_codec_name(id: &str) -> String {
    match id {
        "V_MPEG4/ISO/AVC" => "H.264".into(),
        "V_MPEGH/ISO/HEVC" => "H.265 (HEVC)".into(),
        "V_VP8" => "VP8".into(),
        "V_VP9" => "VP9".into(),
        "V_AV1" => "AV1".into(),
        "V_MPEG2" => "MPEG-2".into(),
        "V_MPEG4/ISO/ASP" | "V_MPEG4/ISO/SP" | "V_MPEG4/ISO/AP" => "MPEG-4 Visual".into(),
        "V_PRORES" => "ProRes".into(),
        "V_MJPEG" => "Motion JPEG".into(),
        "A_AAC" => "AAC".into(),
        "A_OPUS" => "Opus".into(),
        "A_VORBIS" => "Vorbis".into(),
        "A_FLAC" => "FLAC".into(),
        "A_AC3" => "AC-3".into(),
        "A_EAC3" => "E-AC-3".into(),
        "A_MPEG/L3" => "MP3".into(),
        "A_MPEG/L2" => "MP2".into(),
        "A_ALAC" => "ALAC".into(),
        other if other.starts_with("A_AAC/") => "AAC".into(),
        other if other.starts_with("A_DTS") => "DTS".into(),
        other if other.starts_with("A_TRUEHD") => "TrueHD".into(),
        other if other.starts_with("A_PCM/") => "PCM".into(),
        other => other.trim_start_matches(['V', 'A', '_']).to_string(),
    }
}

fn parse_mkv_tracks(tracks: &[u8], info: &mut MediaInfo) {
    let (mut seen_video, mut seen_audio) = (false, false);
    for (id, entry) in ebml_children(tracks) {
        if id != 0xAE {
            continue;
        }
        let fields = ebml_children(entry);
        let get = |wanted: u32| fields.iter().find(|(i, _)| *i == wanted).map(|(_, b)| *b);
        let codec = get(0x86).map(|b| mkv_codec_name(String::from_utf8_lossy(b).trim_end_matches('\0')));
        match get(0x83).map(ebml_uint) {
            Some(1) if !seen_video => {
                seen_video = true;
                info.video_codec = codec;
                if let Some(default_duration) = get(0x23E383).map(ebml_uint).filter(|&d| d > 0) {
                    info.frame_rate = Some(1e9 / default_duration as f64);
                }
                if let Some(video) = get(0xE0) {
                    let v = ebml_children(video);
                    let dim = |wanted: u32| v.iter().find(|(i, _)| *i == wanted).map(|(_, b)| ebml_uint(b) as u32);
                    info.width = dim(0xB0).and_then(positive);
                    info.height = dim(0xBA).and_then(positive);
                }
            }
            Some(2) if !seen_audio => {
                seen_audio = true;
                info.audio_codec = codec;
                if let Some(audio) = get(0xE1) {
                    let a = ebml_children(audio);
                    let field = |wanted: u32| a.iter().find(|(i, _)| *i == wanted).map(|(_, b)| *b);
                    info.sample_rate = field(0xB5).and_then(ebml_float).map(|f| f.round() as u32).and_then(positive);
                    info.channels = field(0x9F).map(|b| ebml_uint(b) as u32).and_then(positive);
                    // Muxers also write a depth for lossy audio; it only means something for lossless codecs
                    if matches!(info.audio_codec.as_deref(), Some("PCM" | "FLAC" | "ALAC" | "TrueHD")) {
                        info.bit_depth = field(0x6264).map(|b| ebml_uint(b) as u32).and_then(positive);
                    }
                }
            }
            _ => {}
        }
    }
}

fn read_mkv<R: Read + Seek>(r: &mut R) -> Option<MediaInfo> {
    let total = len_of(r)?;
    let head = read_at(r, 0, 64)?;
    // The EBML header element, then the Segment
    let (id, id_len) = ebml_id(&head, 0)?;
    if id != 0x1A45DFA3 {
        return None;
    }
    let (size, size_len) = ebml_size(&head, id_len)?;
    let mut pos = (id_len + size_len) as u64 + size?;

    let mut info = MediaInfo::default();
    let (mut have_info, mut have_tracks) = (false, false);
    let mut scale = 1_000_000.0f64;
    let mut segment_end = total;
    let mut in_segment = false;
    for _ in 0..64 {
        let head = read_at(r, pos, 16)?;
        let (id, id_len) = ebml_id(&head, 0)?;
        let (size, size_len) = ebml_size(&head, id_len)?;
        let body_at = pos + (id_len + size_len) as u64;
        match id {
            0x18538067 => {
                // Segment: step into it
                in_segment = true;
                segment_end = size.map_or(total, |s| (body_at + s).min(total));
                pos = body_at;
                continue;
            }
            0x1F43B675 => break, // Cluster: the track list always comes before the media data
            0x1549A966 | 0x1654AE6B if in_segment => {
                let size = size?;
                if size > MAX_MKV_ELEMENT_BYTES {
                    return None;
                }
                let body = read_at(r, body_at, size as usize)?;
                if id == 0x1549A966 {
                    have_info = true;
                    let fields = ebml_children(&body);
                    if let Some(s) = fields.iter().find(|(i, _)| *i == 0x2AD7B1) {
                        scale = ebml_uint(s.1) as f64;
                    }
                    if let Some(d) = fields.iter().find(|(i, _)| *i == 0x4489).and_then(|(_, b)| ebml_float(b)) {
                        info.duration = Some(d * scale / 1e9).filter(|d| *d > 0.0);
                    }
                } else {
                    have_tracks = true;
                    parse_mkv_tracks(&body, &mut info);
                }
            }
            _ => {}
        }
        if have_info && have_tracks {
            break;
        }
        pos = body_at + size?;
        if pos + 2 > segment_end {
            break;
        }
    }
    Some(info)
}

// ---------------------------------------------------------------------------------------------------------------------
// RIFF: AVI video and WAV audio
// ---------------------------------------------------------------------------------------------------------------------

fn wave_format_name(tag: u16) -> String {
    match tag {
        0x0001 => "PCM".into(),
        0x0002 | 0x0011 => "ADPCM".into(),
        0x0003 => "PCM float".into(),
        0x0006 => "A-law".into(),
        0x0007 => "µ-law".into(),
        0x0050 => "MP2".into(),
        0x0055 => "MP3".into(),
        0x00ff | 0x1600 | 0x1601 | 0x1602 | 0x1610 => "AAC".into(),
        0x0160..=0x0163 => "WMA".into(),
        0x2000 => "AC-3".into(),
        0x2001 => "DTS".into(),
        0xf1ac => "FLAC".into(),
        other => format!("Format 0x{other:04X}"),
    }
}

fn avi_video_name(fourcc: &[u8]) -> String {
    let upper = String::from_utf8_lossy(fourcc).trim().to_ascii_uppercase();
    match upper.as_str() {
        "H264" | "X264" | "AVC1" | "DAVC" => "H.264".into(),
        "HEVC" | "H265" | "HVC1" | "X265" => "H.265 (HEVC)".into(),
        "XVID" | "DIVX" | "DX50" | "FMP4" | "MP4V" | "DIV3" | "MP43" => "MPEG-4 Visual".into(),
        "MJPG" | "JPEG" => "Motion JPEG".into(),
        "VP80" => "VP8".into(),
        "VP90" => "VP9".into(),
        "" => "Uncompressed".into(),
        _ => upper,
    }
}

// Walks RIFF chunks in `data` (a buffer of the file's start), calling `visit(fourcc, body, list_kind)` for each one.
fn riff_chunks<'a>(data: &'a [u8], mut visit: impl FnMut(&[u8], &'a [u8])) {
    fn walk<'a>(data: &'a [u8], visit: &mut impl FnMut(&[u8], &'a [u8])) {
        let mut at = 0usize;
        while at + 8 <= data.len() {
            let kind = &data[at..at + 4];
            let size = le32(data, at + 4).unwrap_or(0) as usize;
            let body_end = (at + 8 + size).min(data.len());
            let body = &data[at + 8..body_end];
            if kind == b"LIST" && body.len() >= 4 {
                visit(&body[..4], &[]);
                walk(&body[4..], visit);
            } else {
                visit(kind, body);
            }
            at = at + 8 + size + (size & 1);
        }
    }
    walk(data, &mut visit);
}

fn parse_avi(data: &[u8]) -> Option<MediaInfo> {
    let mut info = MediaInfo::default();
    let mut stream: Option<[u8; 4]> = None; // type of the strl currently being read: vids or auds
    let (mut seen_video, mut seen_audio) = (false, false);
    let mut fallback_fps = None;
    riff_chunks(data.get(12..)?, |kind, body| match kind {
        b"avih" => {
            let micros = le32(body, 0).unwrap_or(0);
            if micros > 0 {
                fallback_fps = Some(1e6 / micros as f64);
            }
        }
        b"strh" => {
            stream = body.get(0..4).and_then(|t| t.try_into().ok());
            let handler = body.get(4..8).unwrap_or(&[]);
            let scale = le32(body, 20).unwrap_or(0);
            let rate = le32(body, 24).unwrap_or(0);
            let length = le32(body, 32).unwrap_or(0);
            if stream == Some(*b"vids") && !seen_video && scale > 0 && rate > 0 {
                info.frame_rate = Some(rate as f64 / scale as f64);
                if length > 0 {
                    info.duration = Some(length as f64 * scale as f64 / rate as f64);
                }
                // The handler is a fallback; the format chunk below names the codec when it can
                info.video_codec = Some(avi_video_name(handler));
            }
        }
        b"strf" => match stream.as_ref() {
            Some(b"vids") if !seen_video => {
                seen_video = true;
                info.width = le32(body, 4).map(|w| w as i32).filter(|&w| w > 0).map(|w| w as u32);
                info.height = le32(body, 8).map(|h| (h as i32).unsigned_abs()).and_then(positive);
                if let Some(c) = body.get(16..20) {
                    info.video_codec = Some(avi_video_name(if c == [0; 4] { &[] } else { c }));
                }
            }
            Some(b"auds") if !seen_audio => {
                seen_audio = true;
                let tag = le16(body, 0).unwrap_or(0);
                info.audio_codec = Some(wave_format_name(tag));
                info.channels = le16(body, 2).map(u32::from).and_then(positive);
                info.sample_rate = le32(body, 4).and_then(positive);
                if matches!(tag, 0x0001 | 0x0003) {
                    info.bit_depth = le16(body, 14).map(u32::from).and_then(positive);
                }
            }
            _ => {}
        },
        _ => {}
    });
    if info.frame_rate.is_none() {
        info.frame_rate = fallback_fps;
    }
    Some(info)
}

fn read_avi<R: Read + Seek>(r: &mut R) -> Option<MediaInfo> {
    let head = read_at(r, 0, AVI_HEADER_BYTES)?;
    if head.get(0..4)? != b"RIFF" || head.get(8..12)? != b"AVI " {
        return None;
    }
    // Only the header list matters; the movie data follows it
    let end = head
        .windows(4)
        .position(|w| w == b"movi")
        .map(|p| p.saturating_sub(4))
        .unwrap_or(head.len());
    parse_avi(&head[..end.max(12)])
}

fn read_wav<R: Read + Seek>(r: &mut R) -> Option<MediaInfo> {
    let total = len_of(r)?;
    let head = read_at(r, 0, 12)?;
    if head.get(0..4)? != b"RIFF" || head.get(8..12)? != b"WAVE" {
        return None;
    }
    let mut info = MediaInfo::default();
    let mut byte_rate = 0u32;
    let mut pos = 12u64;
    for _ in 0..64 {
        let chunk = read_at(r, pos, 8)?;
        if chunk.len() < 8 {
            break;
        }
        let size = le32(&chunk, 4)? as u64;
        match &chunk[0..4] {
            b"fmt " => {
                let body = read_at(r, pos + 8, (size as usize).min(64))?;
                let mut tag = le16(&body, 0)?;
                info.channels = le16(&body, 2).map(u32::from).and_then(positive);
                info.sample_rate = le32(&body, 4).and_then(positive);
                byte_rate = le32(&body, 8).unwrap_or(0);
                let bits = le16(&body, 14).map(u32::from).and_then(positive);
                if tag == 0xFFFE {
                    // WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of the sub-format GUID
                    tag = le16(&body, 24).unwrap_or(tag);
                }
                info.audio_codec = Some(wave_format_name(tag));
                if matches!(tag, 0x0001 | 0x0003) {
                    info.bit_depth = bits;
                }
            }
            b"data" => {
                let bytes = if size == 0 || size == 0xFFFF_FFFF { total.saturating_sub(pos + 8) } else { size.min(total.saturating_sub(pos + 8)) };
                if byte_rate > 0 {
                    info.duration = Some(bytes as f64 / byte_rate as f64);
                }
                break;
            }
            _ => {}
        }
        pos += 8 + size + (size & 1);
        if pos + 8 > total {
            break;
        }
    }
    Some(info)
}

// ---------------------------------------------------------------------------------------------------------------------
// FLAC, AIFF, Ogg, MP3 and raw AAC audio
// ---------------------------------------------------------------------------------------------------------------------

// STREAMINFO body: 20 bits sample rate, 3 bits channels - 1, 5 bits bits per sample - 1, 36 bits total samples
fn apply_flac_streaminfo(body: &[u8], info: &mut MediaInfo) -> Option<()> {
    let bits = body.get(10..18)?;
    let packed = u64::from_be_bytes(bits.try_into().ok()?);
    let rate = (packed >> 44) as u32;
    info.sample_rate = positive(rate);
    info.channels = Some(((packed >> 41) & 7) as u32 + 1);
    info.bit_depth = Some(((packed >> 36) & 31) as u32 + 1);
    let samples = packed & 0xF_FFFF_FFFF;
    if rate > 0 && samples > 0 {
        info.duration = Some(samples as f64 / rate as f64);
    }
    info.audio_codec = Some("FLAC".into());
    Some(())
}

// Skips a leading ID3v2 tag, returning the offset of the audio
fn id3v2_len(head: &[u8]) -> u64 {
    if head.len() >= 10 && &head[0..3] == b"ID3" {
        let size = head[6..10].iter().fold(0u64, |acc, &b| (acc << 7) | (b & 0x7f) as u64);
        let footer = if head[5] & 0x10 != 0 { 10 } else { 0 };
        10 + size + footer
    } else {
        0
    }
}

fn read_flac<R: Read + Seek>(r: &mut R, start: u64) -> Option<MediaInfo> {
    let head = read_at(r, start, 4 + 4 + 34)?;
    if head.get(0..4)? != b"fLaC" || head.get(4)? & 0x7f != 0 {
        return None;
    }
    let mut info = MediaInfo::default();
    apply_flac_streaminfo(head.get(8..)?, &mut info)?;
    Some(info)
}

// AIFF stores the sample rate as an 80-bit extended float
fn extended_to_f64(b: &[u8]) -> Option<f64> {
    let exponent = (be16(b, 0)? & 0x7fff) as i32;
    let mantissa = be64(b, 2)?;
    if exponent == 0 && mantissa == 0 {
        return Some(0.0);
    }
    Some(mantissa as f64 * 2f64.powi(exponent - 16383 - 63))
}

fn read_aiff<R: Read + Seek>(r: &mut R) -> Option<MediaInfo> {
    let total = len_of(r)?;
    let head = read_at(r, 0, 12)?;
    if head.get(0..4)? != b"FORM" || !matches!(head.get(8..12)?, b"AIFF" | b"AIFC") {
        return None;
    }
    let mut pos = 12u64;
    for _ in 0..64 {
        let chunk = read_at(r, pos, 8)?;
        if chunk.len() < 8 {
            break;
        }
        let size = be32(&chunk, 4)? as u64;
        if &chunk[0..4] == b"COMM" {
            let body = read_at(r, pos + 8, (size as usize).min(32))?;
            let frames = be32(&body, 2)? as f64;
            let rate = extended_to_f64(body.get(8..18)?)?;
            let codec = match body.get(18..22) {
                Some(b"fl32" | b"fl64" | b"FL32" | b"FL64") => "PCM float",
                Some(b"alaw" | b"ALAW") => "A-law",
                Some(b"ulaw" | b"ULAW") => "µ-law",
                _ => "PCM",
            };
            return Some(MediaInfo {
                channels: be16(&body, 0).map(u32::from).and_then(positive),
                bit_depth: be16(&body, 6).map(u32::from).and_then(positive),
                sample_rate: positive(rate.round() as u32),
                duration: (rate > 0.0 && frames > 0.0).then(|| frames / rate),
                audio_codec: Some(codec.into()),
                ..MediaInfo::default()
            });
        }
        pos += 8 + size + (size & 1);
        if pos + 8 > total {
            break;
        }
    }
    None
}

fn read_ogg<R: Read + Seek>(r: &mut R) -> Option<MediaInfo> {
    let head = read_at(r, 0, 512)?;
    if head.get(0..4)? != b"OggS" {
        return None;
    }
    let segments = *head.get(26)? as usize;
    let table = head.get(27..27 + segments)?;
    let first_packet = table.iter().take_while(|&&s| s == 255).count() + 1;
    let packet_len: usize = table.iter().take(first_packet).map(|&s| s as usize).sum();
    let start = 27 + segments;
    let packet = head.get(start..(start + packet_len).min(head.len()))?;

    let mut info = MediaInfo::default();
    if packet.starts_with(b"\x01vorbis") {
        info.audio_codec = Some("Vorbis".into());
        info.channels = packet.get(11).map(|&c| c as u32).and_then(positive);
        info.sample_rate = le32(packet, 12).and_then(positive);
    } else if packet.starts_with(b"OpusHead") {
        info.audio_codec = Some("Opus".into());
        info.channels = packet.get(9).map(|&c| c as u32).and_then(positive);
        info.sample_rate = Some(48000); // Opus always decodes at 48 kHz; the stored rate is only the source's
    } else if packet.starts_with(b"\x7fFLAC") {
        // 0x7F "FLAC", version (2), header count (2), "fLaC", then the metadata block header and STREAMINFO
        apply_flac_streaminfo(packet.get(13..)?, &mut info)?;
    } else if packet.starts_with(b"Speex   ") {
        info.audio_codec = Some("Speex".into());
        info.sample_rate = le32(packet, 36).and_then(positive);
        info.channels = le32(packet, 48).and_then(positive);
    } else {
        return None;
    }
    Some(info)
}

// MPEG audio frame header at `at`: returns (layer, sample rate, channels, frame length in bytes)
fn mpeg_frame(b: &[u8], at: usize) -> Option<(u8, u32, u32, usize)> {
    let h = u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?);
    if h >> 21 != 0x7ff {
        return None;
    }
    let version = (h >> 19) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    let layer = 4 - ((h >> 17) & 3); // 1, 2 or 3
    if version == 1 || layer == 4 {
        return None;
    }
    let bitrate_index = ((h >> 12) & 15) as usize;
    let rate_index = ((h >> 10) & 3) as usize;
    if bitrate_index == 0 || bitrate_index == 15 || rate_index == 3 {
        return None;
    }
    const BITRATES_V1: [[u32; 15]; 3] = [
        [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
        [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
        [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    ];
    const BITRATES_V2: [[u32; 15]; 2] = [
        [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
        [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    ];
    let kbps = if version == 3 {
        BITRATES_V1[layer as usize - 1][bitrate_index]
    } else {
        BITRATES_V2[if layer == 1 { 0 } else { 1 }][bitrate_index]
    };
    let base_rate = [44100, 48000, 32000][rate_index];
    let rate = match version {
        3 => base_rate,
        2 => base_rate / 2,
        _ => base_rate / 4,
    };
    let padding = ((h >> 9) & 1) as usize;
    let length = if layer == 1 {
        (12 * kbps as usize * 1000 / rate as usize + padding) * 4
    } else {
        let per_frame = if layer == 3 && version != 3 { 72 } else { 144 };
        per_frame * kbps as usize * 1000 / rate as usize + padding
    };
    let channels = if (h >> 6) & 3 == 3 { 1 } else { 2 };
    Some((layer as u8, rate, channels, length))
}

fn read_mp3<R: Read + Seek>(r: &mut R) -> Option<MediaInfo> {
    let tag = read_at(r, 0, 10)?;
    let audio_start = id3v2_len(&tag);
    let data = read_at(r, audio_start, SCAN_BYTES)?;
    // A real frame is followed by another one, which rules out sync patterns inside tag or picture bytes
    for at in 0..data.len().saturating_sub(4) {
        if let Some((layer, rate, channels, length)) = mpeg_frame(&data, at)
            && (mpeg_frame(&data, at + length).is_some() || at + length + 4 > data.len())
        {
            let codec = match layer {
                1 => "MP1",
                2 => "MP2",
                _ => "MP3",
            };
            return Some(MediaInfo {
                audio_codec: Some(codec.into()),
                sample_rate: Some(rate),
                channels: Some(channels),
                ..MediaInfo::default()
            });
        }
    }
    None
}

fn read_adts<R: Read + Seek>(r: &mut R) -> Option<MediaInfo> {
    let tag = read_at(r, 0, 10)?;
    let data = read_at(r, id3v2_len(&tag), SCAN_BYTES)?;
    for at in 0..data.len().saturating_sub(7) {
        // 12 sync bits, layer 00; the profile, sample-rate index and channel configuration follow
        if data[at] == 0xff && data[at + 1] & 0xf6 == 0xf0 {
            let object = (data[at + 2] >> 6) + 1;
            let index = ((data[at + 2] >> 2) & 15) as usize;
            let channels = ((data[at + 2] & 1) << 2) | (data[at + 3] >> 6);
            if let Some(&rate) = AAC_RATES.get(index) {
                return Some(MediaInfo {
                    audio_codec: Some(aac_object_name(object).into()),
                    sample_rate: Some(rate),
                    channels: channel_count(channels),
                    ..MediaInfo::default()
                });
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------------------------------

fn read_media<R: Read + Seek>(r: &mut R) -> Option<MediaInfo> {
    let head = read_at(r, 0, 16)?;
    let tag4 = head.get(4..8).unwrap_or(&[]);
    let info = if matches!(tag4, b"ftyp" | b"moov" | b"mdat" | b"wide" | b"free" | b"skip" | b"pnot") {
        read_mp4(r)
    } else if head.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        read_mkv(r)
    } else if head.starts_with(b"RIFF") && head.get(8..12) == Some(b"AVI ") {
        read_avi(r)
    } else if head.starts_with(b"RIFF") && head.get(8..12) == Some(b"WAVE") {
        read_wav(r)
    } else if head.starts_with(b"fLaC") {
        read_flac(r, 0)
    } else if head.starts_with(b"OggS") {
        read_ogg(r)
    } else if head.starts_with(b"FORM") {
        read_aiff(r)
    } else if head.starts_with(b"ID3") && read_at(r, id3v2_len(&head), 4).as_deref() == Some(b"fLaC") {
        read_flac(r, id3v2_len(&head))
    } else {
        // MP3 and raw AAC (ADTS) have no signature of their own, so the first frame header is searched for
        read_mp3(r).or_else(|| read_adts(r))
    };
    info.filter(|i| !i.is_empty())
}

const MEDIA_EXTENSIONS: [&str; 12] = ["mp4", "webm", "mov", "mkv", "avi", "wav", "mp3", "ogg", "flac", "aac", "aiff", "m4a"];

/// True for the video and audio extensions the browser lists (the same set as the file categories in lib.rs)
pub fn is_media_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| MEDIA_EXTENSIONS.iter().any(|m| m.eq_ignore_ascii_case(e)))
}

/// Reads the header of a video or audio file. A file that is not recognised, or cannot be read, gives None.
pub fn read_media_info(path: &Path) -> Option<MediaInfo> {
    let mut file = File::open(path).ok()?;
    read_media(&mut file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn mp4_box(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut out = ((body.len() + 8) as u32).to_be_bytes().to_vec();
        out.extend_from_slice(kind);
        out.extend_from_slice(body);
        out
    }

    fn mp4_fixture(moov_first: bool) -> Vec<u8> {
        let mut mvhd = vec![0u8; 4];
        mvhd.extend_from_slice(&[0; 8]); // creation and modification time
        mvhd.extend_from_slice(&1000u32.to_be_bytes()); // timescale
        mvhd.extend_from_slice(&12_500u32.to_be_bytes()); // 12.5 s
        mvhd.extend_from_slice(&[0; 80]);

        // Video: H.264 1920x1080 at 24 fps (48 samples of 500 ticks at timescale 12000)
        let mut avc_c = vec![1u8, 100, 0, 40];
        avc_c.extend_from_slice(&[0; 4]);
        let mut visual = vec![0u8; 6];
        visual.extend_from_slice(&1u16.to_be_bytes());
        visual.extend_from_slice(&[0; 16]);
        visual.extend_from_slice(&1920u16.to_be_bytes());
        visual.extend_from_slice(&1080u16.to_be_bytes());
        visual.extend_from_slice(&[0; 50]); // up to the 78-byte visual header
        visual.extend_from_slice(&mp4_box(b"avcC", &avc_c));
        let mut stsd_v = vec![0u8; 4];
        stsd_v.extend_from_slice(&1u32.to_be_bytes());
        stsd_v.extend_from_slice(&mp4_box(b"avc1", &visual));
        let mut stts = vec![0u8; 4];
        stts.extend_from_slice(&1u32.to_be_bytes());
        stts.extend_from_slice(&48u32.to_be_bytes());
        stts.extend_from_slice(&500u32.to_be_bytes());
        let stbl_v = [mp4_box(b"stsd", &stsd_v), mp4_box(b"stts", &stts)].concat();
        let mut mdhd = vec![0u8; 4];
        mdhd.extend_from_slice(&[0; 8]);
        mdhd.extend_from_slice(&12_000u32.to_be_bytes());
        mdhd.extend_from_slice(&[0; 8]);
        let mut hdlr_v = vec![0u8; 8];
        hdlr_v.extend_from_slice(b"vide");
        hdlr_v.extend_from_slice(&[0; 13]);
        let mdia_v = [mp4_box(b"mdhd", &mdhd), mp4_box(b"hdlr", &hdlr_v), mp4_box(b"minf", &mp4_box(b"stbl", &stbl_v))].concat();

        // Audio: AAC LC, 48 kHz, stereo
        let esds = {
            let asc = [0x11u8, 0x90]; // object 2 (LC), rate index 3 (48000), channel config 2
            let mut dec = vec![0x40u8, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            dec.push(0x05);
            dec.push(asc.len() as u8);
            dec.extend_from_slice(&asc);
            let mut es = vec![0u8, 0, 0];
            es.push(0x04);
            es.push(dec.len() as u8);
            es.extend_from_slice(&dec);
            let mut body = vec![0u8; 4];
            body.push(0x03);
            body.push(es.len() as u8);
            body.extend_from_slice(&es);
            mp4_box(b"esds", &body)
        };
        let mut sound = vec![0u8; 6];
        sound.extend_from_slice(&1u16.to_be_bytes());
        sound.extend_from_slice(&[0; 8]);
        sound.extend_from_slice(&2u16.to_be_bytes());
        sound.extend_from_slice(&16u16.to_be_bytes());
        sound.extend_from_slice(&[0; 4]);
        sound.extend_from_slice(&(48000u32 << 16).to_be_bytes());
        sound.extend_from_slice(&esds);
        let mut stsd_a = vec![0u8; 4];
        stsd_a.extend_from_slice(&1u32.to_be_bytes());
        stsd_a.extend_from_slice(&mp4_box(b"mp4a", &sound));
        let mut hdlr_a = vec![0u8; 8];
        hdlr_a.extend_from_slice(b"soun");
        hdlr_a.extend_from_slice(&[0; 13]);
        let mdia_a = [mp4_box(b"hdlr", &hdlr_a), mp4_box(b"minf", &mp4_box(b"stbl", &mp4_box(b"stsd", &stsd_a)))].concat();

        let moov = mp4_box(
            b"moov",
            &[
                mp4_box(b"mvhd", &mvhd),
                mp4_box(b"trak", &mp4_box(b"mdia", &mdia_v)),
                mp4_box(b"trak", &mp4_box(b"mdia", &mdia_a)),
            ]
            .concat(),
        );
        let ftyp = mp4_box(b"ftyp", b"isom\0\0\0\0isom");
        let mdat = mp4_box(b"mdat", &[0u8; 1000]);
        if moov_first { [ftyp, moov, mdat].concat() } else { [ftyp, mdat, moov].concat() }
    }

    #[test]
    fn mp4_reports_video_and_audio_whether_the_index_is_first_or_last() {
        for moov_first in [true, false] {
            let info = read_media(&mut Cursor::new(mp4_fixture(moov_first))).expect("mp4 header");
            assert_eq!(info.video_codec.as_deref(), Some("H.264 (High)"));
            assert_eq!((info.width, info.height), (Some(1920), Some(1080)));
            assert!((info.frame_rate.unwrap() - 24.0).abs() < 1e-9);
            assert_eq!(info.duration, Some(12.5));
            assert_eq!(info.audio_codec.as_deref(), Some("AAC LC"));
            assert_eq!(info.sample_rate, Some(48000));
            assert_eq!(info.channels, Some(2));
        }
    }

    fn wav_fixture(bits: u16, tag: u16) -> Vec<u8> {
        let mut fmt = Vec::new();
        fmt.extend_from_slice(&tag.to_le_bytes());
        fmt.extend_from_slice(&2u16.to_le_bytes());
        fmt.extend_from_slice(&44100u32.to_le_bytes());
        fmt.extend_from_slice(&(44100 * 2 * bits as u32 / 8).to_le_bytes());
        fmt.extend_from_slice(&(2 * bits / 8).to_le_bytes());
        fmt.extend_from_slice(&bits.to_le_bytes());
        let data_len = 44100u32 * 2 * bits as u32 / 8 * 3; // three seconds
        let mut out = b"RIFF".to_vec();
        out.extend_from_slice(&(36 + data_len).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&(fmt.len() as u32).to_le_bytes());
        out.extend_from_slice(&fmt);
        out.extend_from_slice(b"data");
        out.extend_from_slice(&data_len.to_le_bytes());
        out.extend(std::iter::repeat_n(0u8, data_len as usize));
        out
    }

    #[test]
    fn wav_reports_format_bit_depth_and_length() {
        let info = read_media(&mut Cursor::new(wav_fixture(24, 1))).unwrap();
        assert_eq!(info.audio_codec.as_deref(), Some("PCM"));
        assert_eq!((info.sample_rate, info.channels, info.bit_depth), (Some(44100), Some(2), Some(24)));
        assert_eq!(info.duration, Some(3.0));
        let float = read_media(&mut Cursor::new(wav_fixture(32, 3))).unwrap();
        assert_eq!(float.audio_codec.as_deref(), Some("PCM float"));
    }

    #[test]
    fn flac_streaminfo_is_decoded() {
        let mut body = vec![0u8; 34];
        // 96 kHz, 2 channels, 24 bits, 96000 * 5 samples
        let packed: u64 = (96000u64 << 44) | (1u64 << 41) | (23u64 << 36) | 480_000;
        body[10..18].copy_from_slice(&packed.to_be_bytes());
        let mut file = b"fLaC".to_vec();
        file.push(0); // STREAMINFO, not last
        file.extend_from_slice(&[0, 0, 34]);
        file.extend_from_slice(&body);
        let info = read_media(&mut Cursor::new(file)).unwrap();
        assert_eq!(info.audio_codec.as_deref(), Some("FLAC"));
        assert_eq!((info.sample_rate, info.channels, info.bit_depth), (Some(96000), Some(2), Some(24)));
        assert_eq!(info.duration, Some(5.0));
    }

    #[test]
    fn aiff_extended_float_sample_rate_is_decoded() {
        let mut comm = Vec::new();
        comm.extend_from_slice(&2u16.to_be_bytes());
        comm.extend_from_slice(&88200u32.to_be_bytes()); // two seconds at 44.1 kHz
        comm.extend_from_slice(&16u16.to_be_bytes());
        comm.extend_from_slice(&[0x40, 0x0E, 0xAC, 0x44, 0, 0, 0, 0, 0, 0]); // 44100.0
        let mut file = b"FORM".to_vec();
        file.extend_from_slice(&((comm.len() + 12) as u32).to_be_bytes());
        file.extend_from_slice(b"AIFFCOMM");
        file.extend_from_slice(&(comm.len() as u32).to_be_bytes());
        file.extend_from_slice(&comm);
        let info = read_media(&mut Cursor::new(file)).unwrap();
        assert_eq!((info.sample_rate, info.channels, info.bit_depth), (Some(44100), Some(2), Some(16)));
        assert_eq!(info.duration, Some(2.0));
    }

    #[test]
    fn mp3_frame_header_is_found_after_an_id3_tag() {
        // MPEG1 Layer III, 128 kbps, 44.1 kHz, joint stereo: frame length 417 bytes
        let frame = || {
            let mut f = vec![0xff, 0xfb, 0x90, 0x44];
            f.resize(417, 0);
            f
        };
        let mut file = b"ID3\x03\0\0\0\0\0\x20".to_vec();
        file.extend_from_slice(&[0u8; 32]);
        file.extend_from_slice(&frame());
        file.extend_from_slice(&frame());
        let info = read_media(&mut Cursor::new(file)).unwrap();
        assert_eq!(info.audio_codec.as_deref(), Some("MP3"));
        assert_eq!((info.sample_rate, info.channels), (Some(44100), Some(2)));
    }

    #[test]
    fn ogg_vorbis_and_opus_identification_headers_are_read() {
        let page = |packet: &[u8]| {
            let mut p = b"OggS".to_vec();
            p.extend_from_slice(&[0; 22]);
            p.push(1); // one segment
            p.push(packet.len() as u8);
            p.extend_from_slice(packet);
            p
        };
        let mut vorbis = b"\x01vorbis".to_vec();
        vorbis.extend_from_slice(&0u32.to_le_bytes());
        vorbis.push(2);
        vorbis.extend_from_slice(&44100u32.to_le_bytes());
        let info = read_media(&mut Cursor::new(page(&vorbis))).unwrap();
        assert_eq!(info.audio_codec.as_deref(), Some("Vorbis"));
        assert_eq!((info.sample_rate, info.channels), (Some(44100), Some(2)));

        let mut opus = b"OpusHead".to_vec();
        opus.extend_from_slice(&[1, 2, 0, 0]);
        opus.extend_from_slice(&44100u32.to_le_bytes());
        let info = read_media(&mut Cursor::new(page(&opus))).unwrap();
        assert_eq!(info.audio_codec.as_deref(), Some("Opus"));
        assert_eq!((info.sample_rate, info.channels), (Some(48000), Some(2)));
    }

    fn ebml(id: &[u8], body: &[u8]) -> Vec<u8> {
        let mut out = id.to_vec();
        out.push(0x80 | body.len() as u8); // bodies in these fixtures are shorter than 127 bytes
        out.extend_from_slice(body);
        out
    }

    #[test]
    fn matroska_tracks_are_read() {
        let video = ebml(&[0xAE], &[
            ebml(&[0xD7], &[1]),
            ebml(&[0x83], &[1]),
            ebml(&[0x86], b"V_VP9"),
            ebml(&[0x23, 0xE3, 0x83], &41_666_667u32.to_be_bytes()),
            ebml(&[0xE0], &[ebml(&[0xB0], &1280u16.to_be_bytes()), ebml(&[0xBA], &720u16.to_be_bytes())].concat()),
        ].concat());
        let audio = ebml(&[0xAE], &[
            ebml(&[0xD7], &[2]),
            ebml(&[0x83], &[2]),
            ebml(&[0x86], b"A_OPUS"),
            ebml(&[0xE1], &[ebml(&[0xB5], &48000f64.to_be_bytes()), ebml(&[0x9F], &[2])].concat()),
        ].concat());
        let tracks = ebml(&[0x16, 0x54, 0xAE, 0x6B], &[video, audio].concat());
        let seg_info = ebml(&[0x15, 0x49, 0xA9, 0x66], &[
            ebml(&[0x2A, 0xD7, 0xB1], &1_000_000u32.to_be_bytes()),
            ebml(&[0x44, 0x89], &8000f64.to_be_bytes()),
        ].concat());
        let segment_body = [seg_info, tracks].concat();
        let mut file = ebml(&[0x1A, 0x45, 0xDF, 0xA3], &ebml(&[0x42, 0x82], b"webm"));
        file.extend_from_slice(&[0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]); // unknown size
        file.extend_from_slice(&segment_body);
        let info = read_media(&mut Cursor::new(file)).expect("mkv header");
        assert_eq!(info.video_codec.as_deref(), Some("VP9"));
        assert_eq!((info.width, info.height), (Some(1280), Some(720)));
        assert!((info.frame_rate.unwrap() - 24.0).abs() < 0.001);
        assert_eq!(info.audio_codec.as_deref(), Some("Opus"));
        assert_eq!((info.sample_rate, info.channels), (Some(48000), Some(2)));
        assert_eq!(info.duration, Some(8.0));
    }

    #[test]
    fn unknown_or_damaged_files_give_nothing() {
        assert!(read_media(&mut Cursor::new(vec![0u8; 100])).is_none());
        assert!(read_media(&mut Cursor::new(b"RIFF\0\0\0\0WAVE".to_vec())).is_none());
        let mut truncated = mp4_fixture(true);
        truncated.truncate(60);
        assert!(read_media(&mut Cursor::new(truncated)).is_none());
    }
}
