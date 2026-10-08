// Folder icons.
// 1. The icons the user picks for a folder (library icons or imported images). They live in this app's own
//    store, keyed by folder path, and never touch the folder's desktop.ini.
// 2. The icons Windows already shows for folders customised in File Explorer (desktop.ini IconResource /
//    IconFile), exported to small PNG files so the webview can show them.
// Everything that does not need Windows is plain logic so it can be unit tested on any platform.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::UNIX_EPOCH;

const STORE_FILE: &str = "folder_icons.json";
const IMPORT_DIR: &str = "folder_icons";
const PORTABLE_DIR: &str = "CG Artist File Browser Data";
const MAX_IMPORT_BYTES: u64 = 2 * 1024 * 1024;
const IMPORT_EXTENSIONS: [&str; 6] = ["png", "svg", "ico", "webp", "jpg", "jpeg"];
// Size of the PNG exported for a Windows folder icon (shown at 15-48 px, so this stays sharp on HiDPI screens)
#[cfg_attr(not(windows), allow(dead_code))]
const SYSTEM_ICON_PX: i32 = 96;

// Serialises read-modify-write cycles on the store
static STORE_LOCK: Mutex<()> = Mutex::new(());

fn lock_store() -> MutexGuard<'static, ()> {
    STORE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct Store {
    // normalised folder path -> "lib:<id>" or "custom:<id>"
    #[serde(default)]
    folders: HashMap<String, String>,
    #[serde(default)]
    custom: Vec<StoredIcon>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct StoredIcon {
    id: String,
    name: String,
    file: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct CustomIcon {
    pub id: String,
    pub name: String,
    /// Absolute path of the imported image
    pub path: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct FolderIconState {
    pub assignments: HashMap<String, String>,
    pub custom: Vec<CustomIcon>,
    /// Folder that holds the icon choices (next to the exe for the portable build)
    pub location: String,
    pub portable: bool,
}

/// Where the icon choices are kept: next to the exe for the portable build, in the app data folder for the
/// installed build (and for `tauri dev`). The installer puts `uninstall.exe` beside the exe, which is how
/// the two are told apart. A portable exe in a folder that cannot be written to falls back to app data.
pub fn data_dir(app_data: PathBuf) -> (PathBuf, bool) {
    if cfg!(debug_assertions) {
        return (app_data, false);
    }
    let Some(exe_dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) else {
        return (app_data, false);
    };
    if exe_dir.join("uninstall.exe").exists() {
        return (app_data, false);
    }
    let portable = exe_dir.join(PORTABLE_DIR);
    if fs::create_dir_all(&portable).is_ok() && is_writable(&portable) {
        return (portable, true);
    }
    (app_data, false)
}

fn is_writable(dir: &Path) -> bool {
    let probe = dir.join(".write_test");
    let ok = fs::write(&probe, b"x").is_ok();
    let _ = fs::remove_file(probe);
    ok
}

/// Key used to find a folder's choice: separators unified, no trailing separator, lower case
/// (Windows paths are case-insensitive).
pub fn normalize_key(path: &str) -> String {
    let mut s = path.trim().replace('/', "\\");
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s.to_lowercase()
}

fn load(dir: &Path) -> Store {
    fs::read_to_string(dir.join(STORE_FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save(dir: &Path, store: &Store) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Can't create {}: {}", dir.display(), e))?;
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{}.tmp", STORE_FILE));
    fs::write(&tmp, json).map_err(|e| format!("Can't save folder icons: {}", e))?;
    fs::rename(&tmp, dir.join(STORE_FILE)).map_err(|e| format!("Can't save folder icons: {}", e))
}

fn to_state(dir: &Path, portable: bool, store: Store) -> FolderIconState {
    let imports = dir.join(IMPORT_DIR);
    FolderIconState {
        assignments: store.folders,
        custom: store
            .custom
            .into_iter()
            .map(|c| CustomIcon {
                path: imports.join(&c.file).to_string_lossy().to_string(),
                id: c.id,
                name: c.name,
            })
            .collect(),
        location: dir.to_string_lossy().to_string(),
        portable,
    }
}

pub fn state(dir: &Path, portable: bool) -> FolderIconState {
    let _guard = lock_store();
    to_state(dir, portable, load(dir))
}

fn valid_icon_ref(icon: &str, store: &Store) -> bool {
    if let Some(id) = icon.strip_prefix("lib:") {
        return !id.is_empty() && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    }
    if let Some(id) = icon.strip_prefix("custom:") {
        return store.custom.iter().any(|c| c.id == id);
    }
    false
}

/// Sets (`Some`) or clears (`None`) the icon of one folder.
pub fn assign(dir: &Path, portable: bool, folder: &str, icon: Option<String>) -> Result<FolderIconState, String> {
    let _guard = lock_store();
    let mut store = load(dir);
    let key = normalize_key(folder);
    if key.is_empty() {
        return Err("No folder given".into());
    }
    match icon {
        Some(icon) => {
            if !valid_icon_ref(&icon, &store) {
                return Err(format!("Unknown icon: {}", icon));
            }
            store.folders.insert(key, icon);
        }
        None => {
            store.folders.remove(&key);
        }
    }
    save(dir, &store)?;
    Ok(to_state(dir, portable, store))
}

fn file_stem_name(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Icon".to_string())
}

/// Copies images into the icon store so they keep working when the originals move.
/// The id comes from the file's content, so importing the same image twice adds it once.
/// Fails only when none of the files could be imported.
pub fn import(dir: &Path, portable: bool, sources: &[String]) -> Result<FolderIconState, String> {
    let _guard = lock_store();
    let mut store = load(dir);
    let target_dir = dir.join(IMPORT_DIR);
    let mut added = 0usize;
    let mut last_error = String::from("No icon file given");

    for source in sources {
        let path = Path::new(source);
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_lowercase)
            .unwrap_or_default();
        if !IMPORT_EXTENSIONS.contains(&ext.as_str()) {
            last_error = format!("{} is not a PNG, SVG, ICO, WebP or JPG image", file_stem_name(path));
            continue;
        }
        let bytes = match fs::metadata(path) {
            Ok(meta) if meta.len() > MAX_IMPORT_BYTES => {
                last_error = format!("{} is larger than 2 MB", file_stem_name(path));
                continue;
            }
            Ok(_) => match fs::read(path) {
                Ok(bytes) => bytes,
                Err(e) => {
                    last_error = format!("Can't read {}: {}", file_stem_name(path), e);
                    continue;
                }
            },
            Err(e) => {
                last_error = format!("Can't read {}: {}", file_stem_name(path), e);
                continue;
            }
        };
        if ext == "svg" && !String::from_utf8_lossy(&bytes).contains("<svg") {
            last_error = format!("{} is not a valid SVG", file_stem_name(path));
            continue;
        }

        let id = format!("c{}", &format!("{:x}", md5::compute(&bytes))[..10]);
        if !store.custom.iter().any(|c| c.id == id) {
            let file = format!("{}.{}", id, ext);
            if let Err(e) = fs::create_dir_all(&target_dir).and_then(|_| fs::write(target_dir.join(&file), &bytes)) {
                last_error = format!("Can't store {}: {}", file_stem_name(path), e);
                continue;
            }
            store.custom.push(StoredIcon { id, name: file_stem_name(path), file });
        }
        added += 1;
    }

    if added == 0 {
        return Err(last_error);
    }
    save(dir, &store)?;
    Ok(to_state(dir, portable, store))
}

/// Deletes an imported icon; folders that used it go back to their default icon.
pub fn remove_custom(dir: &Path, portable: bool, id: &str) -> Result<FolderIconState, String> {
    let _guard = lock_store();
    let mut store = load(dir);
    if let Some(pos) = store.custom.iter().position(|c| c.id == id) {
        let removed = store.custom.remove(pos);
        let _ = fs::remove_file(dir.join(IMPORT_DIR).join(removed.file));
    }
    let reference = format!("custom:{}", id);
    store.folders.retain(|_, icon| *icon != reference);
    save(dir, &store)?;
    Ok(to_state(dir, portable, store))
}

// ---------------------------------------------------------------------------------------------
// Icons Windows already shows (desktop.ini)
// ---------------------------------------------------------------------------------------------

/// True for a folder that may carry a File Explorer icon. Explorer only honours a folder's desktop.ini
/// when the folder is marked read-only or system, so this needs no disk access beyond the directory
/// listing that is already in hand. Plain folders (almost all of them) are skipped.
#[cfg(windows)]
pub fn may_have_system_icon(entry: &fs::DirEntry) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_READONLY: u32 = 0x1;
    const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
    entry
        .metadata()
        .map(|m| m.file_attributes() & (FILE_ATTRIBUTE_READONLY | FILE_ATTRIBUTE_SYSTEM) != 0)
        .unwrap_or(false)
}

#[cfg(not(windows))]
pub fn may_have_system_icon(_entry: &fs::DirEntry) -> bool {
    false
}

#[derive(Debug, PartialEq)]
pub struct IconSpec {
    pub file: String,
    pub index: i32,
}

/// desktop.ini is UTF-16 (with BOM) when Explorer wrote it, but plain ANSI/UTF-8 files exist too.
pub fn decode_ini(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
        let big_endian = bytes[0] == 0xFE;
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|p| if big_endian { u16::from_be_bytes([p[0], p[1]]) } else { u16::from_le_bytes([p[0], p[1]]) })
            .collect();
        return String::from_utf16_lossy(&units);
    }
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    String::from_utf8_lossy(bytes).to_string()
}

/// The icon a desktop.ini asks for: `IconResource=path,index` wins over `IconFile=path` + `IconIndex=n`.
pub fn parse_icon_spec(text: &str) -> Option<IconSpec> {
    let mut in_section = false;
    let mut resource: Option<String> = None;
    let mut file: Option<String> = None;
    let mut index = 0i32;

    for line in text.lines() {
        let line = line.trim().trim_start_matches('\u{feff}');
        if line.starts_with('[') {
            in_section = line.trim_end_matches(']').eq_ignore_ascii_case("[.ShellClassInfo");
            continue;
        }
        if !in_section {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        let value = value.trim();
        match key.trim().to_ascii_lowercase().as_str() {
            "iconresource" if !value.is_empty() => resource = Some(value.to_string()),
            "iconfile" if !value.is_empty() => file = Some(value.to_string()),
            "iconindex" => index = value.parse().unwrap_or(0),
            _ => {}
        }
    }

    if let Some(value) = resource {
        let (path, idx) = match value.rsplit_once(',') {
            Some((p, i)) if i.trim().parse::<i32>().is_ok() => (p, i.trim().parse().unwrap_or(0)),
            _ => (value.as_str(), 0),
        };
        return Some(IconSpec { file: path.trim().trim_matches('"').trim().to_string(), index: idx });
    }
    file.map(|f| IconSpec { file: f.trim_matches('"').trim().to_string(), index })
}

/// `%SystemRoot%\system32\imageres.dll` -> the real path. Unknown variables are left as written.
pub fn expand_env(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 => match std::env::var(&after[..end]) {
                Ok(value) => {
                    out.push_str(&value);
                    rest = &after[end + 1..];
                }
                Err(_) => {
                    out.push('%');
                    rest = after;
                }
            },
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// A relative icon file in a desktop.ini is relative to the folder itself.
pub fn resolve_icon_file(spec_file: &str, folder: &Path) -> PathBuf {
    let expanded = expand_env(spec_file);
    let path = PathBuf::from(&expanded);
    if path.is_absolute() { path } else { folder.join(path) }
}

/// The icon Windows shows for `folder` (from its desktop.ini), exported as a PNG in `cache_dir`.
/// None when the folder has no custom icon, the icon can't be read, or on platforms without folder icons.
pub fn system_icon(cache_dir: &Path, folder: &Path) -> Option<PathBuf> {
    let ini_path = folder.join("desktop.ini");
    let meta = fs::metadata(&ini_path).ok()?;
    let ini_stamp = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Changes when the user picks another icon in Explorer, so a stale export is never reused
    let hash = format!(
        "{:x}",
        md5::compute(format!("v1|{}|{}|{}", normalize_key(&folder.to_string_lossy()), meta.len(), ini_stamp))
    );
    let png = cache_dir.join(format!("{}.png", hash));
    if png.exists() {
        return Some(png);
    }

    let spec = parse_icon_spec(&decode_ini(&fs::read(&ini_path).ok()?))?;
    let source = resolve_icon_file(&spec.file, folder);
    let (width, height, rgba) = extract_icon(&source, spec.index)?;

    fs::create_dir_all(cache_dir).ok()?;
    let tmp = cache_dir.join(format!("{}.tmp", hash));
    image::RgbaImage::from_raw(width, height, rgba)?
        .save_with_format(&tmp, image::ImageFormat::Png)
        .ok()?;
    fs::rename(&tmp, &png).ok()?;
    Some(png)
}

#[cfg(not(windows))]
fn extract_icon(_source: &Path, _index: i32) -> Option<(u32, u32, Vec<u8>)> {
    None
}

/// RGBA pixels of an icon in an .ico, .exe or .dll file. A negative index is a resource id (imageres.dll,-113).
#[cfg(windows)]
fn extract_icon(source: &Path, index: i32) -> Option<(u32, u32, Vec<u8>)> {
    win::extract_icon(&source.to_string_lossy(), index, SYSTEM_ICON_PX)
}

#[cfg(windows)]
mod win {
    use std::ffi::c_void;
    use std::ptr::null_mut;

    #[repr(C)]
    struct IconInfo {
        is_icon: i32,
        x_hotspot: u32,
        y_hotspot: u32,
        mask: *mut c_void,
        color: *mut c_void,
    }

    #[repr(C)]
    struct Bitmap {
        bm_type: i32,
        width: i32,
        height: i32,
        width_bytes: i32,
        planes: u16,
        bits_pixel: u16,
        bits: *mut c_void,
    }

    #[repr(C)]
    struct BitmapInfoHeader {
        size: u32,
        width: i32,
        height: i32,
        planes: u16,
        bit_count: u16,
        compression: u32,
        size_image: u32,
        x_pels_per_meter: i32,
        y_pels_per_meter: i32,
        clr_used: u32,
        clr_important: u32,
    }

    #[repr(C)]
    struct BitmapInfo {
        header: BitmapInfoHeader,
        colors: [u32; 3],
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn PrivateExtractIconsW(
            file_name: *const u16,
            icon_index: i32,
            cx: i32,
            cy: i32,
            icons: *mut *mut c_void,
            icon_ids: *mut u32,
            count: u32,
            flags: u32,
        ) -> u32;
        fn GetIconInfo(icon: *mut c_void, info: *mut IconInfo) -> i32;
        fn DestroyIcon(icon: *mut c_void) -> i32;
        fn GetDC(window: *mut c_void) -> *mut c_void;
        fn ReleaseDC(window: *mut c_void, dc: *mut c_void) -> i32;
    }

    #[link(name = "gdi32")]
    unsafe extern "system" {
        fn GetObjectW(handle: *mut c_void, size: i32, out: *mut c_void) -> i32;
        fn GetDIBits(
            dc: *mut c_void,
            bitmap: *mut c_void,
            start: u32,
            lines: u32,
            bits: *mut c_void,
            info: *mut BitmapInfo,
            usage: u32,
        ) -> i32;
        fn DeleteObject(object: *mut c_void) -> i32;
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// 32-bit BGRA pixels of a bitmap, top row first.
    fn read_bgra(dc: *mut c_void, bitmap: *mut c_void, width: i32, height: i32) -> Option<Vec<u8>> {
        let mut info = BitmapInfo {
            header: BitmapInfoHeader {
                size: std::mem::size_of::<BitmapInfoHeader>() as u32,
                width,
                height: -height, // negative = top-down
                planes: 1,
                bit_count: 32,
                compression: 0, // BI_RGB
                size_image: 0,
                x_pels_per_meter: 0,
                y_pels_per_meter: 0,
                clr_used: 0,
                clr_important: 0,
            },
            colors: [0; 3],
        };
        let mut buf = vec![0u8; (width as usize) * (height as usize) * 4];
        let lines = unsafe { GetDIBits(dc, bitmap, 0, height as u32, buf.as_mut_ptr() as *mut c_void, &mut info, 0) };
        (lines == height).then_some(buf)
    }

    pub fn extract_icon(file: &str, index: i32, size: i32) -> Option<(u32, u32, Vec<u8>)> {
        let mut icon: *mut c_void = null_mut();
        let found = unsafe { PrivateExtractIconsW(wide(file).as_ptr(), index, size, size, &mut icon, null_mut(), 1, 0) };
        if found == 0 || found == u32::MAX || icon.is_null() {
            return None;
        }
        let result = icon_pixels(icon);
        unsafe { DestroyIcon(icon) };
        result
    }

    fn icon_pixels(icon: *mut c_void) -> Option<(u32, u32, Vec<u8>)> {
        let mut info = IconInfo { is_icon: 0, x_hotspot: 0, y_hotspot: 0, mask: null_mut(), color: null_mut() };
        if unsafe { GetIconInfo(icon, &mut info) } == 0 {
            return None;
        }
        let result = (|| {
            // Black-and-white icons have no colour bitmap; they are not worth a special case
            if info.color.is_null() {
                return None;
            }
            let mut bitmap = Bitmap { bm_type: 0, width: 0, height: 0, width_bytes: 0, planes: 0, bits_pixel: 0, bits: null_mut() };
            let got = unsafe {
                GetObjectW(info.color, std::mem::size_of::<Bitmap>() as i32, &mut bitmap as *mut Bitmap as *mut c_void)
            };
            if got == 0 || bitmap.width <= 0 || bitmap.height <= 0 {
                return None;
            }
            let (w, h) = (bitmap.width, bitmap.height);

            let dc = unsafe { GetDC(null_mut()) };
            if dc.is_null() {
                return None;
            }
            let color = read_bgra(dc, info.color, w, h);
            let mask = if info.mask.is_null() { None } else { read_bgra(dc, info.mask, w, h) };
            unsafe { ReleaseDC(null_mut(), dc) };

            let mut pixels = color?;
            // Icons without an alpha channel carry their transparency in the mask bitmap (white = transparent)
            if pixels.chunks_exact(4).all(|p| p[3] == 0) {
                let mask = mask?;
                for (p, m) in pixels.chunks_exact_mut(4).zip(mask.chunks_exact(4)) {
                    p[3] = if m[0] == 0 { 255 } else { 0 };
                }
            }
            for p in pixels.chunks_exact_mut(4) {
                p.swap(0, 2); // BGRA -> RGBA
            }
            Some((w as u32, h as u32, pixels))
        })();
        unsafe {
            if !info.color.is_null() {
                DeleteObject(info.color);
            }
            if !info.mask.is_null() {
                DeleteObject(info.mask);
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cgafb_folder_icons_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn keys_ignore_case_separators_and_trailing_slash() {
        assert_eq!(normalize_key("D:/Assets/HDRs/"), "d:\\assets\\hdrs");
        assert_eq!(normalize_key("D:\\Assets\\HDRs"), "d:\\assets\\hdrs");
        assert_eq!(normalize_key("\\\\NAS\\Share\\Fonts\\"), "\\\\nas\\share\\fonts");
        assert_eq!(normalize_key("D:\\"), "d:\\");
    }

    #[test]
    fn reads_icon_resource_with_negative_index() {
        let ini = "[.ShellClassInfo]\r\nIconResource=C:\\Windows\\System32\\imageres.dll,-113\r\n[ViewState]\r\nMode=\r\n";
        assert_eq!(
            parse_icon_spec(ini),
            Some(IconSpec { file: "C:\\Windows\\System32\\imageres.dll".into(), index: -113 })
        );
    }

    #[test]
    fn reads_icon_file_and_index_and_prefers_resource() {
        let ini = "[.ShellClassInfo]\nIconFile=icons\\folder.ico\nIconIndex=2\n";
        assert_eq!(parse_icon_spec(ini), Some(IconSpec { file: "icons\\folder.ico".into(), index: 2 }));
        let both = "[.ShellClassInfo]\nIconFile=a.ico\nIconResource=b.dll,5\n";
        assert_eq!(parse_icon_spec(both), Some(IconSpec { file: "b.dll".into(), index: 5 }));
    }

    #[test]
    fn quoted_paths_and_missing_index_work() {
        let ini = "[.ShellClassInfo]\nIconResource=\"D:\\My Icons\\blue.ico\"\n";
        assert_eq!(parse_icon_spec(ini), Some(IconSpec { file: "D:\\My Icons\\blue.ico".into(), index: 0 }));
        let quoted_index = "[.ShellClassInfo]\nIconResource=\"D:\\x.dll\",-7\n";
        assert_eq!(parse_icon_spec(quoted_index), Some(IconSpec { file: "D:\\x.dll".into(), index: -7 }));
    }

    #[test]
    fn ignores_other_sections_and_folders_without_an_icon() {
        assert_eq!(parse_icon_spec("[ViewState]\nIconFile=x.ico\n"), None);
        assert_eq!(parse_icon_spec("[.ShellClassInfo]\nInfoTip=Hello\n"), None);
        assert_eq!(parse_icon_spec("[.ShellClassInfo]\niconresource=a.ico,0\n"), Some(IconSpec { file: "a.ico".into(), index: 0 }));
    }

    #[test]
    fn decodes_utf16_and_utf8_ini_files() {
        let text = "[.ShellClassInfo]\r\nIconResource=a.dll,1\r\n";
        let mut utf16 = vec![0xFF, 0xFE];
        for unit in text.encode_utf16() {
            utf16.extend_from_slice(&unit.to_le_bytes());
        }
        assert_eq!(decode_ini(&utf16), text);
        let mut utf8 = vec![0xEF, 0xBB, 0xBF];
        utf8.extend_from_slice(text.as_bytes());
        assert_eq!(decode_ini(&utf8), text);
        assert_eq!(decode_ini(text.as_bytes()), text);
    }

    #[test]
    fn expands_known_variables_only() {
        unsafe { std::env::set_var("CGAFB_TEST_ROOT", "/opt/icons") };
        assert_eq!(expand_env("%CGAFB_TEST_ROOT%/a.dll"), "/opt/icons/a.dll");
        assert_eq!(expand_env("%CGAFB_NOT_SET_ANYWHERE%/a.dll"), "%CGAFB_NOT_SET_ANYWHERE%/a.dll");
        assert_eq!(expand_env("100% sure"), "100% sure");
    }

    #[test]
    fn relative_icon_files_are_relative_to_the_folder() {
        let folder = Path::new("some_folder");
        assert_eq!(resolve_icon_file("icon.ico", folder), folder.join("icon.ico"));
    }

    #[test]
    fn choices_are_saved_replaced_and_reset() {
        let dir = scratch("assign");
        let state = assign(&dir, true, "D:\\Assets\\HDRs", Some("lib:hdri".into())).unwrap();
        assert_eq!(state.assignments.get("d:\\assets\\hdrs").map(String::as_str), Some("lib:hdri"));
        assert!(state.portable);

        // Same folder typed differently is the same choice, and a new pick replaces the old one
        let state = assign(&dir, true, "d:/assets/hdrs/", Some("lib:music".into())).unwrap();
        assert_eq!(state.assignments.len(), 1);
        assert_eq!(state.assignments["d:\\assets\\hdrs"], "lib:music");

        // A fresh load (a restart) sees the same thing
        assert_eq!(super::state(&dir, true).assignments["d:\\assets\\hdrs"], "lib:music");

        let state = assign(&dir, true, "D:\\Assets\\HDRs", None).unwrap();
        assert!(state.assignments.is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_unknown_icon_references() {
        let dir = scratch("reject");
        assert!(assign(&dir, false, "D:\\x", Some("custom:nope".into())).is_err());
        assert!(assign(&dir, false, "D:\\x", Some("lib:Not Valid!".into())).is_err());
        assert!(assign(&dir, false, "D:\\x", Some("whatever".into())).is_err());
        assert!(assign(&dir, false, "", Some("lib:music".into())).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn imports_images_once_and_removing_resets_folders() {
        let dir = scratch("import");
        let src = scratch("import_src");
        let svg = src.join("Blender.svg");
        fs::write(&svg, "<svg xmlns='http://www.w3.org/2000/svg'></svg>").unwrap();
        let bad = src.join("notes.txt");
        fs::write(&bad, "hello").unwrap();
        let fake = src.join("fake.svg");
        fs::write(&fake, "not an svg").unwrap();

        let paths = vec![svg.to_string_lossy().to_string(), bad.to_string_lossy().to_string(), fake.to_string_lossy().to_string()];
        let state = import(&dir, false, &paths).unwrap();
        assert_eq!(state.custom.len(), 1);
        assert_eq!(state.custom[0].name, "Blender");
        assert!(Path::new(&state.custom[0].path).exists());

        // Importing the same image again does not add a second copy
        let state = import(&dir, false, &paths[..1]).unwrap();
        assert_eq!(state.custom.len(), 1);

        let id = state.custom[0].id.clone();
        let state = assign(&dir, false, "D:\\Software", Some(format!("custom:{}", id))).unwrap();
        assert_eq!(state.assignments.len(), 1);

        let state = remove_custom(&dir, false, &id).unwrap();
        assert!(state.custom.is_empty());
        assert!(state.assignments.is_empty());

        assert!(import(&dir, false, &paths[1..2]).is_err());
        let _ = fs::remove_dir_all(dir);
        let _ = fs::remove_dir_all(src);
    }

    #[test]
    fn missing_store_loads_as_empty() {
        let dir = scratch("empty");
        let state = super::state(&dir, false);
        assert!(state.assignments.is_empty());
        assert!(state.custom.is_empty());
        let _ = fs::remove_dir_all(dir);
    }
}
