// "Send to" in the right-click menu: opens the selected files in an external app such as Blender or Maya.
// The apps live in studio_config.json (external_apps). The first time the list is read, and on "Scan this PC"
// in Settings, common Windows installs are looked for and added, so the menu only lists apps in that list.
use super::{load_config, lock_config, save_config, StudioConfig};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ExternalAppEntry {
    pub name: String,
    pub path: String,
}

#[derive(Serialize)]
pub struct ScanResult {
    pub apps: Vec<ExternalAppEntry>,
    pub added: usize,
}

// Windows treats paths without case and with either slash, so the comparison does too
fn normalize(path: &str) -> String {
    path.trim().replace('/', "\\").to_lowercase()
}

fn same_path(a: &str, b: &str) -> bool {
    normalize(a) == normalize(b)
}

// The name used when none is given: the file name without its extension ("maya" for ...\bin\maya.exe)
fn name_from_path(path: &str) -> String {
    let file = path.rsplit(['\\', '/']).next().unwrap_or(path);
    match file.rsplit_once('.') {
        Some((stem, _)) if !stem.is_empty() => stem.to_string(),
        _ => file.to_string(),
    }
}

// Adds the app unless an entry with the same path is already listed. Returns whether it was added.
fn add_missing(list: &mut Vec<ExternalAppEntry>, entry: ExternalAppEntry) -> bool {
    if list.iter().any(|a| same_path(&a.path, &entry.path)) {
        return false;
    }
    list.push(entry);
    true
}

// The numbers in an install folder's name, so "Blender 5.10" sorts after "Blender 5.2"
fn version_key(name: &str) -> Vec<u64> {
    name.split(|c: char| !c.is_ascii_digit())
        .filter_map(|part| part.parse().ok())
        .collect()
}

// The newest install in `parent` whose folder name starts with `prefix` and that contains the executable
// at `exe` (path parts relative to the install folder)
fn newest_install(parent: &Path, prefix: &str, exe: &[&str]) -> Option<PathBuf> {
    let entries = fs::read_dir(parent).ok()?;
    let mut found: Vec<(Vec<u64>, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with(prefix) {
                return None;
            }
            let exe_path = exe.iter().fold(entry.path(), |dir, part| dir.join(part));
            exe_path.is_file().then(|| (version_key(&name), exe_path))
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().next().map(|(_, path)| path)
}

// Apps looked for in the usual install folders under Program Files
struct KnownApp {
    name: &'static str,
    // Vendor folder under Program Files, e.g. "Autodesk"
    vendor: &'static str,
    // Install folders start with this, e.g. "Maya" matches "Maya2025"
    install_prefix: &'static str,
    // Executable inside the install folder
    exe: &'static [&'static str],
}

const KNOWN_APPS: &[KnownApp] = &[
    KnownApp { name: "Blender", vendor: "Blender Foundation", install_prefix: "Blender", exe: &["blender.exe"] },
    KnownApp { name: "Maya", vendor: "Autodesk", install_prefix: "Maya", exe: &["bin", "maya.exe"] },
    KnownApp { name: "3ds Max", vendor: "Autodesk", install_prefix: "3ds Max", exe: &["3dsmax.exe"] },
    KnownApp { name: "Houdini", vendor: "Side Effects Software", install_prefix: "Houdini", exe: &["bin", "houdini.exe"] },
    KnownApp {
        name: "Substance 3D Painter",
        vendor: "Adobe",
        install_prefix: "Adobe Substance 3D Painter",
        exe: &["Adobe Substance 3D Painter.exe"],
    },
];

// The newest install of each known app that is on this PC. Nothing is found outside Windows.
fn detect_installed() -> Vec<ExternalAppEntry> {
    if !cfg!(windows) {
        return Vec::new();
    }
    let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string());
    KNOWN_APPS
        .iter()
        .filter_map(|known| {
            let vendor_dir = Path::new(&program_files).join(known.vendor);
            newest_install(&vendor_dir, known.install_prefix, known.exe).map(|exe| ExternalAppEntry {
                name: known.name.to_string(),
                path: exe.to_string_lossy().to_string(),
            })
        })
        .collect()
}

// Adds the installs found on this PC that are not listed yet. Returns how many were added.
fn scan_into(cfg: &mut StudioConfig) -> usize {
    detect_installed()
        .into_iter()
        .filter(|entry| add_missing(&mut cfg.external_apps, entry.clone()))
        .count()
}

// IPC: Apps listed for "Send to". The first call also looks for installed apps, once, so a removed app stays removed.
#[tauri::command]
pub async fn get_external_apps(app: tauri::AppHandle) -> Vec<ExternalAppEntry> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_config();
        let mut cfg = load_config(&app);
        if !cfg.external_apps_scanned {
            scan_into(&mut cfg);
            cfg.external_apps_scanned = true;
            save_config(&app, &cfg);
        }
        cfg.external_apps
    })
    .await
    .unwrap_or_default()
}

// IPC: Adds an app by the path of its executable. The name defaults to the file name.
#[tauri::command]
pub async fn add_external_app(
    app: tauri::AppHandle,
    path: String,
    name: Option<String>,
) -> Result<Vec<ExternalAppEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = path.trim().to_string();
        if !Path::new(&path).is_file() {
            return Err("That app was not found. Check the path to its .exe file.".to_string());
        }
        let name = name
            .map(|n| n.trim().to_string())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| name_from_path(&path));
        let _guard = lock_config();
        let mut cfg = load_config(&app);
        if !add_missing(&mut cfg.external_apps, ExternalAppEntry { name, path }) {
            return Err("That app is already in the list.".to_string());
        }
        save_config(&app, &cfg);
        Ok(cfg.external_apps)
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()))
}

// IPC: Removes an app from the list. The app itself is not touched.
#[tauri::command]
pub async fn remove_external_app(app: tauri::AppHandle, path: String) -> Vec<ExternalAppEntry> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_config();
        let mut cfg = load_config(&app);
        cfg.external_apps.retain(|a| !same_path(&a.path, &path));
        save_config(&app, &cfg);
        cfg.external_apps
    })
    .await
    .unwrap_or_default()
}

// IPC: Looks for installed apps again and adds the ones not listed yet
#[tauri::command]
pub async fn scan_external_apps(app: tauri::AppHandle) -> Result<ScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_config();
        let mut cfg = load_config(&app);
        let added = scan_into(&mut cfg);
        cfg.external_apps_scanned = true;
        save_config(&app, &cfg);
        ScanResult { apps: cfg.external_apps, added }
    })
    .await
    .map_err(|e| e.to_string())
}

// IPC: Opens the files in one of the listed apps. Each file is its own argument; no shell is involved.
#[tauri::command]
pub async fn send_to_external_app(
    app: tauri::AppHandle,
    app_path: String,
    file_paths: Vec<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if file_paths.is_empty() {
            return Err("No files selected.".to_string());
        }
        let cfg = {
            let _guard = lock_config();
            load_config(&app)
        };
        let listed = cfg
            .external_apps
            .iter()
            .find(|a| same_path(&a.path, &app_path))
            .ok_or("That app is not in the External apps list.")?;
        if let Some(missing) = file_paths.iter().find(|f| !Path::new(f.as_str()).is_file()) {
            return Err(format!("File not found: {}", missing));
        }
        if !Path::new(&listed.path).is_file() {
            return Err(format!("{} was not found at {}. Check its path in Settings.", listed.name, listed.path));
        }
        Command::new(&listed.path)
            .args(&file_paths)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not start {}: {}", listed.name, e))
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_app_path_ignores_case_and_slash_style() {
        assert!(same_path(r"C:\Apps\Blender\blender.exe", "c:/apps/blender/Blender.exe"));
        assert!(!same_path(r"C:\Apps\blender.exe", r"C:\Apps\maya.exe"));
    }

    #[test]
    fn name_defaults_to_the_file_name_without_extension() {
        assert_eq!(name_from_path(r"C:\Program Files\Autodesk\Maya2025\bin\maya.exe"), "maya");
        assert_eq!(name_from_path("/usr/bin/blender"), "blender");
    }

    #[test]
    fn an_app_is_listed_once() {
        let mut list = vec![ExternalAppEntry { name: "Blender".into(), path: r"C:\b\blender.exe".into() }];
        assert!(!add_missing(&mut list, ExternalAppEntry { name: "Blender 2".into(), path: r"c:\B\Blender.exe".into() }));
        assert!(add_missing(&mut list, ExternalAppEntry { name: "Maya".into(), path: r"C:\m\maya.exe".into() }));
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn newer_versions_sort_by_number_not_text() {
        assert!(version_key("Blender 5.10") > version_key("Blender 5.2"));
        assert_eq!(version_key("Maya2025"), vec![2025]);
    }
}
