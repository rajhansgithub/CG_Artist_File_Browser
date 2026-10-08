use serde::{Deserialize, Serialize};
mod folder_icons;
mod network;
mod network_login;
mod thumbnails;

use rayon::prelude::*;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, UNIX_EPOCH};
use sysinfo::Disks;
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct DriveInfo {
    pub name: String,
    pub mount: String,
    pub label: String,
    #[serde(rename = "totalGB")]
    pub total_gb: Option<String>,
    #[serde(rename = "freeGB")]
    pub free_gb: Option<String>,
    #[serde(rename = "isNetwork", default)]
    pub is_network: bool,
    // Network drive that gave no answer in time (disconnected, asleep or very slow)
    #[serde(default)]
    pub offline: bool,
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
    // Folder that may show a custom Windows icon (desktop.ini); the webview asks for the icon only for these
    #[serde(rename = "systemIcon", default)]
    pub system_icon: bool,
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
    // Share roots (\\server\share\) the user has opened by typing a network path
    #[serde(default)]
    pub network_locations: Vec<String>,
    // Shares the user signed in to with a username and password. The password itself lives only in
    // Windows Credential Manager, never in this file.
    #[serde(default)]
    pub network_logins: Vec<NetworkLogin>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NetworkLogin {
    // Share root, `\\server\share\`
    pub share: String,
    pub username: String,
}

impl Default for StudioConfig {
    fn default() -> Self {
        Self {
            blender_path: None,
            favorites: Vec::new(),
            recent_folders: Vec::new(),
            network_locations: Vec::new(),
            network_logins: Vec::new(),
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

    #[cfg(target_os = "windows")]
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

    #[cfg(target_os = "linux")]
    let candidates = [
        "/usr/bin/blender",
        "/usr/local/bin/blender",
        "/snap/bin/blender",
        "/var/lib/flatpak/exports/bin/org.blender.Blender",
    ];

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    let candidates: [&str; 0] = [];

    for c in &candidates {
        if Path::new(c).exists() {
            return Some(c.to_string());
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = Command::new("which").arg("blender").output() {
            if output.status.success() {
                let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !p.is_empty() && Path::new(&p).exists() {
                    return Some(p);
                }
            }
        }
    }

    None
}

fn get_category(ext: &str) -> &'static str {
    match ext {
        ".obj" | ".fbx" | ".gltf" | ".glb" | ".stl" | ".ply" | ".usd" | ".usda" | ".usdc" | ".usdz" | ".abc" | ".dae" | ".blend" => "3d",
        ".hdr" | ".exr" => "hdr",
        ".png" | ".jpg" | ".jpeg" | ".webp" | ".bmp" => "image",
        ".tif" | ".tiff" | ".tga" | ".dds" | ".psd" | ".tx" | ".tex" => "texture",
        ".mp4" | ".webm" | ".mov" | ".mkv" | ".avi" => "video",
        ".wav" | ".mp3" | ".ogg" | ".flac" | ".aac" | ".aiff" | ".m4a" => "audio",
        ".pdf" => "pdf",
        _ => "other",
    }
}

// IPC: List Drives
// Async because querying a network drive can take seconds when the share is slow or gone.
#[tauri::command]
async fn list_drives() -> Vec<DriveInfo> {
    tauri::async_runtime::spawn_blocking(list_drives_blocking)
        .await
        .unwrap_or_default()
}

fn list_drives_blocking() -> Vec<DriveInfo> {
    let disks = Disks::new_with_refreshed_list();
    let mut drives = Vec::new();

    #[cfg(target_os = "linux")]
    {
        if let Ok(home) = std::env::var("HOME") {
            if Path::new(&home).exists() {
                drives.push(DriveInfo {
                    name: home.clone(),
                    mount: home,
                    label: "Home".to_string(),
                    ..Default::default()
                });
            }
        }
    }

    for disk in &disks {
        let mount = disk.mount_point().to_string_lossy().to_string();

        #[cfg(target_os = "linux")]
        {
            if mount.starts_with("/boot")
                || mount.starts_with("/snap")
                || mount.starts_with("/dev")
                || mount.starts_with("/proc")
                || mount.starts_with("/sys")
                || mount.starts_with("/run")
                || mount.starts_with("/var/lib/docker")
                || mount.starts_with("/var/lib/snapd")
            {
                continue;
            }
            if let Ok(home) = std::env::var("HOME") {
                if mount == home {
                    continue;
                }
            }
        }

        let label = disk.name().to_string_lossy().to_string();
        let label_str = if label.is_empty() {
            #[cfg(target_os = "linux")]
            {
                if mount == "/" { "Root (/)".to_string() } else { mount.clone() }
            }
            #[cfg(not(target_os = "linux"))]
            {
                "Local Disk".to_string()
            }
        } else {
            label
        };
        let total_gb = format!("{:.1}", disk.total_space() as f64 / 1_073_741_824.0);
        let free_gb = format!("{:.1}", disk.available_space() as f64 / 1_073_741_824.0);

        drives.push(DriveInfo {
            name: mount.clone(),
            mount,
            label: label_str,
            total_gb: Some(total_gb),
            free_gb: Some(free_gb),
            ..Default::default()
        });
    }

    // Mapped network drives (Z: -> \\server\share), subst and virtual drives are not part of the disk listing above
    #[cfg(target_os = "windows")]
    {
        let known: Vec<char> = drives.iter().filter_map(|d| d.mount.chars().next()).collect();
        let mut listed = known.clone();
        for n in network::extra_drives(&known, Duration::from_millis(2500)) {
            listed.extend(n.root.chars().next());
            let gb = |bytes: u64| format!("{:.1}", bytes as f64 / 1_073_741_824.0);
            let letter = n.root.chars().next().unwrap_or('?');
            let fallback = if n.is_network { "Network Drive".to_string() } else { format!("Drive ({}:)", letter) };
            drives.push(DriveInfo {
                name: n.root.clone(),
                mount: n.root,
                label: n.remote.unwrap_or(fallback),
                total_gb: n.total_bytes.map(gb),
                free_gb: n.free_bytes.map(gb),
                is_network: n.is_network,
                offline: n.offline,
            });
        }
        // Mappings Windows remembers for this user but did not list (for example when the app runs elevated)
        for (letter, share) in network::remembered_mappings() {
            if listed.iter().any(|k| k.eq_ignore_ascii_case(&letter)) {
                continue;
            }
            drives.push(DriveInfo {
                name: share.clone(),
                mount: format!("{}:\\", letter),
                label: share,
                is_network: true,
                ..Default::default()
            });
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
                system_icon: folder_icons::may_have_system_icon(entry),
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

    // Thumbnail resolution (aspect-ratio-aware cache key: md5 of "v3_path_modified_size")
    let hash = format!("{:x}", md5::compute(format!("v3_{}_{}_{}", full_path_str, modified, size)));
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
        system_icon: false,
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
    // A dead share can hang the existence check for a minute; fail with a readable reason instead
    let dir_path = if cfg!(target_os = "windows") && network::is_unc(&dir_path) {
        let dir_path = share_for_bare_server(app, &dir_path).unwrap_or(dir_path);
        reach_path(app, &dir_path)?.0
    } else {
        dir_path
    };
    let path = Path::new(&dir_path);
    let unc = cfg!(target_os = "windows") && network::is_unc(&dir_path);
    if !unc && !path.exists() {
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
    // A share root is the top of a network location (\\server\share has no browsable parent)
    let parent_path = if unc {
        network::unc_parent(&dir_path)
    } else {
        path.parent().map(|p| p.to_string_lossy().to_string())
    };

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

#[derive(Serialize)]
pub struct ResolvedPath {
    pub path: String,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
}

// IPC: Check a path typed into the address bar (`\\server\share`, `//server/share`, `D:/x`) and
// return it in Windows form. Reachable network shares are remembered for the sidebar.
#[tauri::command]
async fn resolve_path(app: tauri::AppHandle, input: String) -> Result<ResolvedPath, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = if cfg!(target_os = "windows") {
            network::normalize_input(&input)
        } else {
            input.trim().to_string()
        };
        if path.is_empty() {
            return Err("Type a folder path".to_string());
        }
        let path = share_for_bare_server(&app, &path).unwrap_or(path);
        let unc = cfg!(target_os = "windows") && network::is_unc(&path);
        if unc && network::unc_share_root(&path).is_none() {
            return Err(format!(
                "{} needs a share name, like {}\\library",
                path,
                path.trim_end_matches('\\')
            ));
        }

        let (reached, is_directory) = if unc {
            reach_path(&app, &path)?
        } else {
            (path.clone(), network::probe(&path, Duration::from_secs(15))?)
        };
        if let Some(root) = network::unc_share_root(&path).filter(|_| unc) {
            record_network_location(&app, &root);
        }
        Ok(ResolvedPath { path: reached, is_directory })
    })
    .await
    .map_err(|e| e.to_string())?
}

// Checks a network path and returns the path to use (plus whether it is a folder). When Windows asks for a
// sign-in and one is saved for the share, it signs in again and retries. When Windows refuses
// `\\server\share` but a drive letter is mapped to the same share, that drive's path is used instead.
fn reach_path(app: &tauri::AppHandle, path: &str) -> Result<(String, bool), String> {
    match network::probe(path, Duration::from_secs(15)) {
        Ok(is_dir) => Ok((path.to_string(), is_dir)),
        Err(first_error) => {
            // Windows asked for a sign-in: use the username and password saved for this share, or for any
            // other share on the same PC, if there is one
            if first_error.starts_with(network_login::SIGN_IN_MARK) {
                if let Some(root) = network::unc_share_root(path) {
                    if let Some(saved) = saved_login_for_server(app, &root) {
                        match network_login::load_password(&saved.share) {
                            Some((user, password)) => {
                                if network_login::connect(&root, &user, &password, Duration::from_secs(15)).is_ok() {
                                    if let Ok(is_dir) = network::probe(path, Duration::from_secs(15)) {
                                        return Ok((path.to_string(), is_dir));
                                    }
                                }
                            }
                            // The saved entry is gone from Credential Manager: say so instead of "blocked"
                            None => return Err(network_login::missing_password_message(&saved.share)),
                        }
                    }
                }
            }
            #[cfg(target_os = "windows")]
            if let Some(alternate) = network::drive_letter_path(path) {
                if let Ok(is_dir) = network::probe(&alternate, Duration::from_secs(5)) {
                    return Ok((alternate, is_dir));
                }
            }
            Err(first_error)
        }
    }
}

fn record_network_location(app: &tauri::AppHandle, share_root: &str) {
    let _guard = lock_config();
    let mut cfg = load_config(app);
    if cfg.network_locations.first().is_some_and(|p| p.eq_ignore_ascii_case(share_root)) {
        return;
    }
    cfg.network_locations.retain(|p| !p.eq_ignore_ascii_case(share_root));
    cfg.network_locations.insert(0, share_root.to_string());
    cfg.network_locations.truncate(10);
    save_config(app, &cfg);
}

// The saved sign-in (username only) to use for a share: one saved for that very share first, otherwise one
// saved for another share on the same PC (a PC's shares normally accept the same account).
fn saved_login_for_server(app: &tauri::AppHandle, share_root: &str) -> Option<NetworkLogin> {
    let logins = load_config(app).network_logins;
    let host = network::unc_host(share_root)?;
    logins
        .iter()
        .find(|l| l.share.eq_ignore_ascii_case(share_root))
        .or_else(|| {
            logins
                .iter()
                .find(|l| network::unc_host(&l.share).is_some_and(|h| h.eq_ignore_ascii_case(&host)))
        })
        .cloned()
}

// `\\server` typed or opened with no share name: Windows can't list a PC's shares through a path, so open the
// share already known for that PC (saved sign-in first, then shares opened before) instead of failing.
fn share_for_bare_server(app: &tauri::AppHandle, path: &str) -> Option<String> {
    if !network::is_server_only(path) {
        return None;
    }
    let host = network::unc_host(path)?;
    let cfg = load_config(app);
    let same_host = |share: &&String| network::unc_host(share).is_some_and(|h| h.eq_ignore_ascii_case(&host));
    let saved: Vec<String> = cfg.network_logins.iter().map(|l| l.share.clone()).collect();
    saved
        .iter()
        .find(same_host)
        .or_else(|| cfg.network_locations.iter().find(same_host))
        .cloned()
}

fn record_network_login(app: &tauri::AppHandle, share_root: &str, username: &str) {
    let _guard = lock_config();
    let mut cfg = load_config(app);
    cfg.network_logins.retain(|l| !l.share.eq_ignore_ascii_case(share_root));
    cfg.network_logins.push(NetworkLogin { share: share_root.to_string(), username: username.to_string() });
    save_config(app, &cfg);
}

// Signs in again to every share with a saved username and password. Runs once in the background at
// start-up, so shares are already connected by the time the user opens one.
fn reconnect_saved_logins(app: &tauri::AppHandle) {
    for login in load_config(app).network_logins {
        let _ = network_login::reconnect(&login.share, Duration::from_secs(15));
    }
}

// IPC: Sign in to a network share with a username and password, optionally remembering them
// (the password goes to Windows Credential Manager) so the share reconnects after a restart.
#[tauri::command]
async fn connect_network(
    app: tauri::AppHandle,
    path: String,
    username: String,
    password: String,
    remember: bool,
) -> Result<ResolvedPath, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = network::normalize_input(&path);
        if !network::is_unc(&path) {
            return Err("Type the network address, like \\\\mypc\\library".to_string());
        }
        let Some(root) = network::unc_share_root(&path) else {
            return Err(format!(
                "{} needs a share name, like {}\\library",
                path,
                path.trim_end_matches('\\')
            ));
        };
        let username = username.trim().to_string();
        if username.is_empty() {
            return Err("Type the username for that PC".to_string());
        }

        network_login::connect(&root, &username, &password, Duration::from_secs(20))?;
        let is_directory = network::probe(&path, Duration::from_secs(15))?;

        if remember {
            network_login::save_password(&root, &username, &password)?;
            record_network_login(&app, &root, &username);
        }
        record_network_location(&app, &root);
        Ok(ResolvedPath { path, is_directory })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct NetworkLocation {
    pub path: String,
    // Explorer's name for a "network location" shortcut; typed shares have none
    pub name: Option<String>,
    pub removable: bool,
    // Username of the saved sign-in for this share, if there is one
    pub username: Option<String>,
}

// Shares typed into the address bar (removable) followed by the network locations
// Windows Explorer already has (read-only, they live in Explorer)
fn network_location_list(cfg: &StudioConfig) -> Vec<NetworkLocation> {
    #[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
    let mut list: Vec<NetworkLocation> = cfg
        .network_locations
        .iter()
        .map(|p| NetworkLocation {
            path: p.clone(),
            name: None,
            removable: true,
            username: cfg
                .network_logins
                .iter()
                .find(|l| l.share.eq_ignore_ascii_case(p))
                .map(|l| l.username.clone()),
        })
        .collect();

    #[cfg(target_os = "windows")]
    for (name, unc) in network::network_shortcuts() {
        let root = network::unc_share_root(&unc).unwrap_or_else(|| unc.clone());
        if !list.iter().any(|l| l.path.eq_ignore_ascii_case(&root) || l.path.eq_ignore_ascii_case(&unc)) {
            list.push(NetworkLocation { path: unc, name: Some(name), removable: false, username: None });
        }
    }
    list
}

// IPC: Network locations shown in the sidebar
#[tauri::command]
async fn get_network_locations(app: tauri::AppHandle) -> Vec<NetworkLocation> {
    tauri::async_runtime::spawn_blocking(move || network_location_list(&load_config(&app)))
        .await
        .unwrap_or_default()
}

#[tauri::command]
fn remove_network_location(app: tauri::AppHandle, path: String) -> Vec<NetworkLocation> {
    let _guard = lock_config();
    let mut cfg = load_config(&app);
    cfg.network_locations.retain(|p| !p.eq_ignore_ascii_case(&path));
    // Removing a share also forgets its saved sign-in and drops the live connection
    if cfg.network_logins.iter().any(|l| l.share.eq_ignore_ascii_case(&path)) {
        cfg.network_logins.retain(|l| !l.share.eq_ignore_ascii_case(&path));
        let host = network::unc_host(&path).unwrap_or_default().to_lowercase();
        let server_still_used = cfg
            .network_logins
            .iter()
            .any(|l| network::unc_host(&l.share).is_some_and(|h| h.to_lowercase() == host));
        network_login::forget(&path, server_still_used);
    }
    save_config(&app, &cfg);
    network_location_list(&cfg)
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
        system_icon: false,
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
    #[cfg(target_os = "linux")]
    {
        if p.is_dir() {
            Command::new("xdg-open")
                .arg(&file_path)
                .spawn()
                .is_ok()
        } else {
            let parent = p.parent().unwrap_or(p);
            Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .is_ok()
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
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
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&file_path)
            .spawn()
            .is_ok()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
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

    let hash = format!("{:x}", md5::compute(format!("v3_{}_{}_{}", file_path, modified, size)));
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

// Cache key shared with read_directory / save_thumbnail: md5 of "v3_path_modified_size".
fn thumbnail_cache_hash(file_path: &str, meta: &fs::Metadata) -> String {
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    format!("{:x}", md5::compute(format!("v3_{}_{}_{}", file_path, modified, meta.len())))
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

// Where folder icon choices are stored: next to the exe for the portable build, app data otherwise.
fn folder_icon_dir(app: &tauri::AppHandle) -> (PathBuf, bool) {
    folder_icons::data_dir(get_app_dir(app))
}

// IPC: Folder icon choices and imported icons
#[tauri::command]
fn get_folder_icons(app: tauri::AppHandle) -> folder_icons::FolderIconState {
    let (dir, portable) = folder_icon_dir(&app);
    folder_icons::state(&dir, portable)
}

// IPC: Pick an icon for a folder (`lib:<id>` or `custom:<id>`), or reset it with no icon
#[tauri::command]
fn set_folder_icon(
    app: tauri::AppHandle,
    folder_path: String,
    icon: Option<String>,
) -> Result<folder_icons::FolderIconState, String> {
    let (dir, portable) = folder_icon_dir(&app);
    folder_icons::assign(&dir, portable, &folder_path, icon)
}

// IPC: Add the user's own PNG/SVG/ICO/WebP/JPG images to the icon library
#[tauri::command]
async fn import_folder_icons(
    app: tauri::AppHandle,
    file_paths: Vec<String>,
) -> Result<folder_icons::FolderIconState, String> {
    let (dir, portable) = folder_icon_dir(&app);
    tauri::async_runtime::spawn_blocking(move || folder_icons::import(&dir, portable, &file_paths))
        .await
        .map_err(|e| e.to_string())?
}

// IPC: Remove an imported icon from the library (folders using it go back to their default icon)
#[tauri::command]
fn remove_folder_icon(app: tauri::AppHandle, icon_id: String) -> Result<folder_icons::FolderIconState, String> {
    let (dir, portable) = folder_icon_dir(&app);
    folder_icons::remove_custom(&dir, portable, &icon_id)
}

// IPC: The icon Windows shows for a folder customised in File Explorer, as a PNG path (None = default folder)
#[tauri::command]
async fn get_system_folder_icon(app: tauri::AppHandle, folder_path: String) -> Option<String> {
    let cache_dir = get_cache_dir(&app).join("folder_icons");
    tauri::async_runtime::spawn_blocking(move || {
        folder_icons::system_icon(&cache_dir, Path::new(&folder_path)).map(|p| p.to_string_lossy().to_string())
    })
    .await
    .ok()
    .flatten()
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
            // Sign back in to shares saved with a password, without holding up the window
            let handle = app.handle().clone();
            std::thread::spawn(move || reconnect_saved_logins(&handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_drives,
            read_directory,
            resolve_path,
            connect_network,
            get_network_locations,
            remove_network_location,
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
            save_image_file,
            get_folder_icons,
            set_folder_icon,
            import_folder_icons,
            remove_folder_icon,
            get_system_folder_icon
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_saved_before_network_locations_still_loads() {
        let old = r#"{"blender_path":null,"favorites":[],"recent_folders":["J:\\Assets"]}"#;
        let cfg: StudioConfig = serde_json::from_str(old).expect("old config must parse");
        assert_eq!(cfg.recent_folders, vec!["J:\\Assets".to_string()]);
        assert!(cfg.network_locations.is_empty());
        assert!(cfg.network_logins.is_empty());
    }
}
