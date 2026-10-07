use serde::{Deserialize, Serialize};
mod thumbnails;

use rayon::prelude::*;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, MutexGuard};
use std::time::UNIX_EPOCH;
use sysinfo::Disks;
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DriveInfo {
    pub name: String,
    pub mount: String,
    pub label: String,
    #[serde(rename = "totalGB")]
    pub total_gb: Option<String>,
    #[serde(rename = "freeGB")]
    pub free_gb: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileItem {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
    pub category: String,
    pub extension: String,
    pub size: u64,
    pub modified: f64,
    pub thumbnail: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DirectoryResult {
    #[serde(rename = "currentPath")]
    pub current_path: String,
    #[serde(rename = "parentPath")]
    pub parent_path: Option<String>,
    pub items: Vec<FileItem>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ReadDirOptions {
    pub filter: Option<String>,
    pub search: Option<String>,
    pub recursive: Option<bool>,
    #[serde(rename = "maxDepth")]
    pub max_depth: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BlenderStatus {
    pub available: bool,
    pub path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StudioConfig {
    pub blender_path: Option<String>,
    pub favorites: Vec<serde_json::Value>,
    pub recent_folders: Vec<String>,
}

impl Default for StudioConfig {
    fn default() -> Self {
        Self {
            blender_path: None,
            favorites: Vec::new(),
            recent_folders: Vec::new(),
        }
    }
}

fn get_app_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(path) = app.path().app_data_dir() {
        path
    } else {
        std::env::temp_dir().join("AssetStudio")
    }
}

fn get_cache_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = get_app_dir(app).join("AssetStudioCache");
    let _ = fs::create_dir_all(dir.join("glb"));
    let _ = fs::create_dir_all(dir.join("thumbs"));
    let _ = fs::create_dir_all(dir.join("exr_preview"));
    dir
}

fn get_config_path(app: &tauri::AppHandle) -> PathBuf {
    get_app_dir(app).join("studio_config.json")
}

fn load_config(app: &tauri::AppHandle) -> StudioConfig {
    let p = get_config_path(app);
    if p.exists() {
        if let Ok(content) = fs::read_to_string(&p) {
            if let Ok(cfg) = serde_json::from_str(&content) {
                return cfg;
            }
        }
    }
    StudioConfig::default()
}

fn save_config(app: &tauri::AppHandle, cfg: &StudioConfig) {
    let p = get_config_path(app);
    if let Some(parent) = p.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(cfg) {
        let _ = fs::write(p, json);
    }
}

fn detect_blender(app: &tauri::AppHandle) -> Option<String> {
    let cfg = load_config(app);
    if let Some(p) = cfg.blender_path {
        if Path::new(&p).exists() {
            return Some(p);
        }
    }

    let candidates = [
        r"C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 4.3\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender\blender.exe",
        r"D:\SteamLibrary\steamapps\common\Blender\blender.exe",
        r"E:\SteamLibrary\steamapps\common\Blender\blender.exe",
        r"F:\SteamLibrary\steamapps\common\Blender\blender.exe",
        r"G:\SteamLibrary\steamapps\common\Blender\blender.exe",
        r"J:\SteamLibrary\steamapps\common\Blender\blender.exe",
    ];

    for c in &candidates {
        if Path::new(c).exists() {
            return Some(c.to_string());
        }
    }
    None
}

fn get_category(ext: &str) -> &'static str {
    match ext {
        ".obj" | ".fbx" | ".gltf" | ".glb" | ".stl" | ".ply" | ".usd" | ".usda" | ".usdc" | ".usdz" | ".abc" | ".dae" | ".blend" => "3d",
        ".hdr" | ".exr" => "hdr",
        ".png" | ".jpg" | ".jpeg" | ".webp" | ".bmp" => "image",
        ".tif" | ".tiff" | ".tga" | ".dds" | ".psd" => "texture",
        ".mp4" | ".webm" | ".mov" | ".mkv" | ".avi" => "video",
        ".wav" | ".mp3" | ".ogg" | ".flac" | ".aac" | ".aiff" | ".m4a" => "audio",
        ".pdf" => "pdf",
        _ => "other",
    }
}

// IPC: List Drives
#[tauri::command]
fn list_drives() -> Vec<DriveInfo> {
    let disks = Disks::new_with_refreshed_list();
    let mut drives = Vec::new();
    for disk in &disks {
        let mount = disk.mount_point().to_string_lossy().to_string();
        let label = disk.name().to_string_lossy().to_string();
        let label_str = if label.is_empty() { "Local Disk".to_string() } else { label };
        let total_gb = format!("{:.1}", disk.total_space() as f64 / 1_073_741_824.0);
        let free_gb = format!("{:.1}", disk.available_space() as f64 / 1_073_741_824.0);

        drives.push(DriveInfo {
            name: mount.clone(),
            mount,
            label: label_str,
            total_gb: Some(total_gb),
            free_gb: Some(free_gb),
        });
    }

    if drives.is_empty() {
        for c in b'C'..=b'Z' {
            let root = format!("{}:\\", c as char);
            if Path::new(&root).exists() {
                drives.push(DriveInfo {
                    name: root.clone(),
                    mount: format!("{}:", c as char),
                    label: format!("Drive ({}:)", c as char),
                    total_gb: None,
                    free_gb: None,
                });
            }
        }
    }
    drives
}

// Serialises read-modify-write cycles on studio_config.json (recent folders, favorites, Blender path)
// now that folder reads record their recent-folder entry in the background.
static CONFIG_LOCK: Mutex<()> = Mutex::new(());

fn lock_config() -> MutexGuard<'static, ()> {
    CONFIG_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn record_recent_folder(app: &tauri::AppHandle, dir_path: &str) {
    let _guard = lock_config();
    let mut cfg = load_config(app);
    if cfg.recent_folders.first().map(String::as_str) == Some(dir_path) {
        return;
    }
    cfg.recent_folders.retain(|p| p != dir_path);
    cfg.recent_folders.insert(0, dir_path.to_string());
    cfg.recent_folders.truncate(15);
    save_config(app, &cfg);
}

// Names of every cached thumbnail, read once per folder listing instead of two exists() calls per file.
fn cached_thumbnail_names(thumbs_dir: &Path) -> HashSet<String> {
    match fs::read_dir(thumbs_dir) {
        Ok(rd) => rd
            .flatten()
            .filter_map(|e| e.file_name().into_string().ok())
            .collect(),
        Err(_) => HashSet::new(),
    }
}

struct ScanContext<'a> {
    filter: &'a str,
    search: &'a str,
    recursive: bool,
    max_depth: usize,
    thumbs_dir: &'a Path,
    cached_thumbs: &'a HashSet<String>,
}

fn pass_category_filter(filter: &str, category: &str) -> bool {
    match filter {
        "3d" => category == "3d",
        "hdr" => category == "hdr",
        "image" => category == "image",
        "texture" => category == "texture",
        "video" => category == "video",
        "audio" => category == "audio",
        "pdf" => category == "pdf",
        "assets" => ["3d", "hdr", "image", "texture", "video", "audio", "pdf"].contains(&category),
        _ => true,
    }
}

// Items produced by one directory entry: nothing, the entry itself, or (when recursing) a whole subtree.
fn scan_entry(ctx: &ScanContext, entry: &fs::DirEntry, depth: usize) -> Vec<FileItem> {
    let name = entry.file_name().to_string_lossy().to_string();

    if name.starts_with('.') || name.starts_with('$') || name == "node_modules" || name == "System Volume Information" {
        return Vec::new();
    }

    let file_type = match entry.file_type() {
        Ok(ft) => ft,
        Err(_) => return Vec::new(),
    };

    let full_path = entry.path();

    if file_type.is_dir() {
        if !ctx.recursive {
            return vec![FileItem {
                name,
                path: full_path.to_string_lossy().to_string(),
                is_directory: true,
                category: "folder".into(),
                extension: "".into(),
                size: 0,
                modified: 0.0,
                thumbnail: None,
            }];
        }
        if depth < ctx.max_depth {
            return scan_dir(ctx, &full_path, depth + 1);
        }
        return Vec::new();
    }

    let ext = full_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_lowercase()))
        .unwrap_or_default();

    let category = get_category(&ext);

    if !pass_category_filter(ctx.filter, category) {
        return Vec::new();
    }

    if !ctx.search.is_empty() && !name.to_lowercase().contains(ctx.search) {
        return Vec::new();
    }

    let full_path_str = full_path.to_string_lossy().to_string();
    let meta = entry.metadata().ok();
    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let modified = meta
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);

    // Thumbnail resolution (same cache key as before: md5 of "v2_path_modified_size")
    let hash = format!("{:x}", md5::compute(format!("v2_{}_{}_{}", full_path_str, modified, size)));
    let jpg_name = format!("{}.jpg", hash);
    let png_name = format!("{}.png", hash);
    let thumbnail = if ctx.cached_thumbs.contains(&jpg_name) {
        Some(ctx.thumbs_dir.join(jpg_name).to_string_lossy().to_string())
    } else if ctx.cached_thumbs.contains(&png_name) {
        Some(ctx.thumbs_dir.join(png_name).to_string_lossy().to_string())
    } else {
        None
    };

    vec![FileItem {
        name,
        path: full_path_str,
        is_directory: false,
        category: category.to_string(),
        extension: ext,
        size,
        modified,
        thumbnail,
    }]
}

// Entries are processed in parallel but collected in directory order, so the result order is unchanged.
fn scan_dir(ctx: &ScanContext, curr: &Path, depth: usize) -> Vec<FileItem> {
    let entries: Vec<fs::DirEntry> = match fs::read_dir(curr) {
        Ok(rd) => rd.flatten().collect(),
        Err(_) => return Vec::new(),
    };

    entries
        .par_iter()
        .with_min_len(64)
        .flat_map_iter(|entry| scan_entry(ctx, entry, depth))
        .collect()
}

fn read_directory_blocking(
    app: &tauri::AppHandle,
    dir_path: String,
    options: Option<ReadDirOptions>,
) -> Result<DirectoryResult, String> {
    let path = Path::new(&dir_path);
    if !path.exists() {
        return Err(format!("Path does not exist: {}", dir_path));
    }

    let opts = options.unwrap_or(ReadDirOptions {
        filter: Some("all".into()),
        search: None,
        recursive: Some(false),
        max_depth: Some(2),
    });

    let filter = opts.filter.unwrap_or_else(|| "all".into());
    let search_lower = opts.search.map(|s| s.trim().to_lowercase()).unwrap_or_default();
    let recursive = opts.recursive.unwrap_or(false);
    let max_depth = opts.max_depth.unwrap_or(2);

    let thumbs_dir = get_cache_dir(app).join("thumbs");
    let cached_thumbs = cached_thumbnail_names(&thumbs_dir);

    let ctx = ScanContext {
        filter: &filter,
        search: &search_lower,
        recursive,
        max_depth,
        thumbs_dir: &thumbs_dir,
        cached_thumbs: &cached_thumbs,
    };

    let items = scan_dir(&ctx, path, 0);
    let parent_path = path.parent().map(|p| p.to_string_lossy().to_string());

    Ok(DirectoryResult {
        current_path: dir_path,
        parent_path,
        items,
    })
}

// IPC: Read Directory
// Async so the scan runs on a worker thread instead of blocking the window's main thread.
// The recent-folders config write happens after the listing has been returned.
#[tauri::command]
async fn read_directory(
    app: tauri::AppHandle,
    dir_path: String,
    options: Option<ReadDirOptions>,
) -> Result<DirectoryResult, String> {
    let scan_app = app.clone();
    let scan_path = dir_path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || read_directory_blocking(&scan_app, scan_path, options))
        .await
        .map_err(|e| e.to_string())??;

    drop(tauri::async_runtime::spawn_blocking(move || record_recent_folder(&app, &dir_path)));

    Ok(result)
}

// IPC: Single item details
#[tauri::command]
fn get_item_details(target_path: String) -> Result<FileItem, String> {
    let p = Path::new(&target_path);
    if !p.exists() {
        return Err("Path does not exist".into());
    }

    let meta = p.metadata().map_err(|e| e.to_string())?;
    let is_dir = meta.is_dir();
    let ext = p.extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_lowercase()))
        .unwrap_or_default();

    let category = if is_dir { "folder" } else { get_category(&ext) };
    let size = if is_dir { 0 } else { meta.len() };
    let modified = meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);

    Ok(FileItem {
        name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        path: target_path,
        is_directory: is_dir,
        category: category.to_string(),
        extension: ext,
        size,
        modified,
        thumbnail: None,
    })
}

// IPC: Read binary buffer (fast byte transfer)
// Returned as a raw ipc::Response so the webview receives an ArrayBuffer directly.
// A plain Vec<u8> would be serialised as a JSON array of numbers (several times larger and slow to parse).
// Async + spawn_blocking keeps the disk read off the main thread.
#[tauri::command]
async fn read_file_buffer(file_path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || fs::read(&file_path))
        .await
        .map_err(|e| e.to_string())?
        .map(tauri::ipc::Response::new)
        .map_err(|e| e.to_string())
}

// IPC: Show in folder / explorer
#[tauri::command]
fn show_in_folder(file_path: String) -> bool {
    let p = Path::new(&file_path);
    if !p.exists() {
        return false;
    }

    #[cfg(target_os = "windows")]
    {
        let win_path = file_path.replace('/', "\\");
        if p.is_dir() {
            Command::new("explorer")
                .arg(&win_path)
                .spawn()
                .is_ok()
        } else {
            Command::new("explorer")
                .arg(format!("/select,{}", win_path))
                .spawn()
                .is_ok()
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

// IPC: Open with default external app
#[tauri::command]
fn open_external(file_path: String) -> bool {
    let p = Path::new(&file_path);
    if !p.exists() {
        return false;
    }

    #[cfg(target_os = "windows")]
    {
        let win_path = file_path.replace('/', "\\");
        Command::new("cmd")
            .args(["/c", "start", "", &win_path])
            .spawn()
            .is_ok()
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

// IPC: Blender status
#[tauri::command]
fn get_blender_status(app: tauri::AppHandle) -> BlenderStatus {
    let path = detect_blender(&app);
    BlenderStatus {
        available: path.is_some(),
        path,
    }
}

// IPC: Set Blender path
#[tauri::command]
fn set_blender_path(app: tauri::AppHandle, new_path: String) -> Result<BlenderStatus, String> {
    if Path::new(&new_path).exists() {
        let _guard = lock_config();
        let mut cfg = load_config(&app);
        cfg.blender_path = Some(new_path.clone());
        save_config(&app, &cfg);
        Ok(BlenderStatus {
            available: true,
            path: Some(new_path),
        })
    } else {
        Err("Path does not exist".into())
    }
}

const BLENDER_CONVERT_SCRIPT: &str = include_str!("../../scripts/blender_convert.py");

// Helper: find or deploy blender_convert.py script
fn find_convert_script(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let relative = Path::new("scripts").join("blender_convert.py");
    if relative.exists() {
        return Ok(relative.canonicalize().unwrap_or(relative));
    }
    let parent_rel = Path::new("..").join("scripts").join("blender_convert.py");
    if parent_rel.exists() {
        return Ok(parent_rel.canonicalize().unwrap_or(parent_rel));
    }

    // Deploy embedded script into cache_dir so it is ALWAYS available in installed / standalone builds
    let cache_dir = get_cache_dir(app);
    let script_path = cache_dir.join("blender_convert.py");
    let needs_write = match fs::read_to_string(&script_path) {
        Ok(content) => content != BLENDER_CONVERT_SCRIPT,
        Err(_) => true,
    };
    if needs_write {
        if let Err(e) = fs::write(&script_path, BLENDER_CONVERT_SCRIPT) {
            return Err(format!("Failed to write embedded blender_convert.py: {}", e));
        }
    }
    Ok(script_path)
}

// IPC: Convert asset to GLB using Blender
#[derive(Serialize)]
pub struct ConvertResult {
    pub success: bool,
    #[serde(rename = "glbPath")]
    pub glb_path: Option<String>,
    pub cached: bool,
    pub error: Option<String>,
    pub meta: Option<serde_json::Value>,
}

#[tauri::command]
async fn convert_asset(app: tauri::AppHandle, file_path: String) -> ConvertResult {
    let blender = match detect_blender(&app) {
        Some(b) => b,
        None => return ConvertResult {
            success: false,
            glb_path: None,
            cached: false,
            error: Some("Blender executable not found. Please set Blender path in Settings.".into()),
            meta: None,
        },
    };

    let p = Path::new(&file_path);
    if !p.exists() {
        return ConvertResult {
            success: false,
            glb_path: None,
            cached: false,
            error: Some("Source file does not exist.".into()),
            meta: None,
        };
    }

    let meta = p.metadata().ok();
    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let modified = meta.and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);

    let hash = format!("{:x}", md5::compute(format!("{}_{}_{}", file_path, modified, size)));
    let cache_dir = get_cache_dir(&app);
    let out_glb = cache_dir.join("glb").join(format!("{}.glb", hash));

    if out_glb.exists() {
        return ConvertResult {
            success: true,
            glb_path: Some(out_glb.to_string_lossy().to_string()),
            cached: true,
            error: None,
            meta: None,
        };
    }

    let script = match find_convert_script(&app) {
        Ok(s) => s,
        Err(e) => return ConvertResult {
            success: false,
            glb_path: None,
            cached: false,
            error: Some(e),
            meta: None,
        },
    };

    let out_str = out_glb.to_string_lossy().to_string();
    let output = Command::new(blender)
        .args([
            "-b",
            "--factory-startup",
            "-P",
            &script.to_string_lossy(),
            "--",
            "convert_glb",
            &file_path,
            &out_str,
        ])
        .output();

    match output {
        Ok(out) => {
            if out.status.success() && out_glb.exists() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let mut json_meta = None;
                for line in stdout.lines() {
                    if let Some(rest) = line.strip_prefix("RESULT_JSON:") {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(rest) {
                            json_meta = Some(v);
                        }
                    }
                }
                ConvertResult {
                    success: true,
                    glb_path: Some(out_str),
                    cached: false,
                    error: None,
                    meta: json_meta,
                }
            } else {
                let stderr = String::from_utf8_lossy(&out.stderr);
                ConvertResult {
                    success: false,
                    glb_path: None,
                    cached: false,
                    error: Some(if stderr.is_empty() { "Blender conversion failed".into() } else { stderr.to_string() }),
                    meta: None,
                }
            }
        }
        Err(e) => ConvertResult {
            success: false,
            glb_path: None,
            cached: false,
            error: Some(e.to_string()),
            meta: None,
        },
    }
}

// IPC: Render Thumbnail with Blender
#[derive(Serialize)]
pub struct ThumbResult {
    pub success: bool,
    #[serde(rename = "thumbnailPath")]
    pub thumbnail_path: Option<String>,
    pub cached: bool,
    pub error: Option<String>,
}

#[tauri::command]
async fn render_thumbnail(app: tauri::AppHandle, file_path: String) -> ThumbResult {
    let blender = match detect_blender(&app) {
        Some(b) => b,
        None => return ThumbResult {
            success: false,
            thumbnail_path: None,
            cached: false,
            error: Some("Blender executable not found.".into()),
        },
    };

    let p = Path::new(&file_path);
    let meta = p.metadata().ok();
    let modified = meta.and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);

    let hash = format!("{:x}", md5::compute(format!("{}_{}", file_path, modified)));
    let cache_dir = get_cache_dir(&app);
    let out_thumb = cache_dir.join("thumbs").join(format!("{}.png", hash));

    if out_thumb.exists() {
        return ThumbResult {
            success: true,
            thumbnail_path: Some(out_thumb.to_string_lossy().to_string()),
            cached: true,
            error: None,
        };
    }

    let script = match find_convert_script(&app) {
        Ok(s) => s,
        Err(e) => return ThumbResult {
            success: false,
            thumbnail_path: None,
            cached: false,
            error: Some(e),
        },
    };

    let out_str = out_thumb.to_string_lossy().to_string();
    let output = Command::new(blender)
        .args([
            "-b",
            "--factory-startup",
            "-P",
            &script.to_string_lossy(),
            "--",
            "thumbnail",
            &file_path,
            &out_str,
        ])
        .output();

    match output {
        Ok(out) => {
            if out.status.success() && out_thumb.exists() {
                ThumbResult {
                    success: true,
                    thumbnail_path: Some(out_str),
                    cached: false,
                    error: None,
                }
            } else {
                ThumbResult {
                    success: false,
                    thumbnail_path: None,
                    cached: false,
                    error: Some("Failed to render thumbnail with Blender.".into()),
                }
            }
        }
        Err(e) => ThumbResult {
            success: false,
            thumbnail_path: None,
            cached: false,
            error: Some(e.to_string()),
        },
    }
}

// IPC: Favorites
#[tauri::command]
fn get_favorites(app: tauri::AppHandle) -> Vec<serde_json::Value> {
    load_config(&app).favorites
}

#[tauri::command]
fn toggle_favorite(app: tauri::AppHandle, item: serde_json::Value) -> Vec<serde_json::Value> {
    let _guard = lock_config();
    let mut cfg = load_config(&app);
    let item_path = item.get("path").and_then(|p| p.as_str()).unwrap_or_default();
    if let Some(pos) = cfg.favorites.iter().position(|f| {
        f.get("path").and_then(|p| p.as_str()).unwrap_or_default() == item_path
    }) {
        cfg.favorites.remove(pos);
    } else {
        cfg.favorites.push(item);
    }
    save_config(&app, &cfg);
    cfg.favorites
}

// IPC: Cache Management
#[derive(Serialize)]
pub struct CacheStats {
    #[serde(rename = "sizeMB")]
    pub size_mb: String,
    #[serde(rename = "fileCount")]
    pub file_count: usize,
    pub path: String,
}

#[tauri::command]
fn get_cache_stats(app: tauri::AppHandle) -> CacheStats {
    let cache_dir = get_cache_dir(&app);
    let mut total_bytes = 0u64;
    let mut file_count = 0usize;

    for entry in walkdir::WalkDir::new(&cache_dir).into_iter().flatten() {
        if entry.file_type().is_file() {
            file_count += 1;
            total_bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }

    CacheStats {
        size_mb: format!("{:.2}", total_bytes as f64 / 1_048_576.0),
        file_count,
        path: cache_dir.to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn clear_cache(app: tauri::AppHandle) -> Result<bool, String> {
    let cache_dir = get_cache_dir(&app);
    let _ = fs::remove_dir_all(&cache_dir);
    let _ = get_cache_dir(&app);
    Ok(true)
}

// IPC: Save thumbnail
#[tauri::command]
fn save_thumbnail(
    app: tauri::AppHandle,
    file_path: String,
    data_url: String,
) -> Result<String, String> {
    let p = Path::new(&file_path);
    let meta = p.metadata().map_err(|e| e.to_string())?;
    let size = meta.len();
    let modified = meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);

    let hash = format!("{:x}", md5::compute(format!("v2_{}_{}_{}", file_path, modified, size)));
    let cache_dir = get_cache_dir(&app);
    let thumb_path = cache_dir.join("thumbs").join(format!("{}.jpg", hash));

    let base64_str = if let Some(idx) = data_url.find(',') {
        &data_url[idx + 1..]
    } else {
        &data_url
    };

    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_str)
        .map_err(|e| e.to_string())?;

    fs::write(&thumb_path, bytes).map_err(|e| e.to_string())?;
    Ok(thumb_path.to_string_lossy().to_string())
}

// Cache key shared with read_directory / save_thumbnail: md5 of "v2_path_modified_size".
fn thumbnail_cache_hash(file_path: &str, meta: &fs::Metadata) -> String {
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    format!("{:x}", md5::compute(format!("v2_{}_{}_{}", file_path, modified, meta.len())))
}

// IPC: Generate a thumbnail natively (HDR / EXR / TGA / TIFF / PNG / JPEG / WebP / BMP) and write it to the
// thumbnail cache. Returns the cached thumbnail path. An error means "not handled natively" and the UI falls
// back to its previous behaviour (JavaScript decoders, or the original file for standard images), so
// unsupported files still show something.
#[tauri::command]
async fn generate_thumbnail(app: tauri::AppHandle, file_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let src = Path::new(&file_path);
        let meta = src.metadata().map_err(|e| e.to_string())?;
        let hash = thumbnail_cache_hash(&file_path, &meta);
        let out_stem = get_cache_dir(&app).join("thumbs").join(hash);
        let out = match thumbnails::cached_thumbnail(&out_stem) {
            Some(existing) => existing,
            None => thumbnails::generate_thumbnail(src, &out_stem)?,
        };
        Ok(out.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// IPC: Save image file from base64 data URL
#[tauri::command]
fn save_image_file(file_path: String, data_url: String) -> Result<bool, String> {
    let p = Path::new(&file_path);
    if let Some(parent) = p.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let base64_str = if let Some(idx) = data_url.find(',') {
        &data_url[idx + 1..]
    } else {
        &data_url
    };

    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_str)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    fs::write(p, bytes).map_err(|e| format!("File write error: {}", e))?;
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_drives,
            read_directory,
            get_item_details,
            read_file_buffer,
            show_in_folder,
            open_external,
            get_blender_status,
            set_blender_path,
            convert_asset,
            render_thumbnail,
            get_favorites,
            toggle_favorite,
            get_cache_stats,
            clear_cache,
            save_thumbnail,
            generate_thumbnail,
            save_image_file
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
