//! Achievements save file (docs/ACHIEVEMENTS.md). One small JSON object, kept twice: in the local app data folder
//! (%LOCALAPPDATA%) and in the roaming one (%APPDATA%, which follows a roaming Windows profile to another PC). The
//! webview reads both and merges them (badges joined, counters take the larger value), so losing one copy loses nothing.
//! Watching only: nothing here touches the user's files, and no new permission or network access is needed.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const FILE: &str = "achievements.json";
/// The saved state is about 1-4 KB; anything much bigger is not ours
const MAX_BYTES: usize = 16 * 1024;

/// The text must be one JSON object of a sane size
pub fn check(data: &str) -> Result<(), String> {
    if data.len() > MAX_BYTES {
        return Err("achievements data is too big".into());
    }
    match serde_json::from_str::<serde_json::Value>(data) {
        Ok(serde_json::Value::Object(_)) => Ok(()),
        _ => Err("achievements data is not a JSON object".into()),
    }
}

/// One copy's text, or "" when it is missing, unreadable or not ours
pub fn read_copy(dir: &Path) -> String {
    let path = dir.join(FILE);
    match fs::metadata(&path) {
        Ok(m) if m.len() as usize <= MAX_BYTES => fs::read_to_string(&path).unwrap_or_default(),
        _ => String::new(),
    }
}

/// Writes under a temporary name, then renames over the old copy, so a crash never leaves half a file
pub fn write_copy(dir: &Path, data: &str) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{FILE}.tmp"));
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join(FILE)).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

fn dirs(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for dir in [app.path().app_local_data_dir(), app.path().app_data_dir()].into_iter().flatten() {
        if !out.contains(&dir) {
            out.push(dir);
        }
    }
    out
}

/// Both copies (local first, then roaming); "" for a copy that is not there
#[tauri::command]
pub fn load_achievements(app: tauri::AppHandle) -> Vec<String> {
    dirs(&app).iter().map(|d| read_copy(d)).collect()
}

/// Saves the merged state to both copies. Succeeds when at least one copy was written.
#[tauri::command]
pub fn save_achievements(app: tauri::AppHandle, data: String) -> Result<(), String> {
    check(&data)?;
    let mut last_err = None;
    let mut wrote = false;
    for dir in dirs(&app) {
        match write_copy(&dir, &data) {
            Ok(()) => wrote = true,
            Err(e) => last_err = Some(e),
        }
    }
    if wrote { Ok(()) } else { Err(last_err.unwrap_or_else(|| "no folder to save achievements in".into())) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cgab-ach-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn only_small_json_objects_pass() {
        assert!(check(r#"{"v":1,"u":{}}"#).is_ok());
        assert!(check("[1,2]").is_err());
        assert!(check("not json").is_err());
        let big = format!(r#"{{"x":"{}"}}"#, "a".repeat(MAX_BYTES));
        assert!(check(&big).is_err());
    }

    #[test]
    fn write_then_read_round_trips_and_replaces() {
        let dir = temp_dir("rw");
        assert_eq!(read_copy(&dir), "");
        write_copy(&dir, r#"{"v":1}"#).unwrap();
        assert_eq!(read_copy(&dir), r#"{"v":1}"#);
        write_copy(&dir, r#"{"v":2}"#).unwrap();
        assert_eq!(read_copy(&dir), r#"{"v":2}"#);
        assert!(!dir.join(format!("{FILE}.tmp")).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_oversized_file_is_ignored() {
        let dir = temp_dir("big");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(FILE), "x".repeat(MAX_BYTES + 10)).unwrap();
        assert_eq!(read_copy(&dir), "");
        let _ = fs::remove_dir_all(&dir);
    }
}
