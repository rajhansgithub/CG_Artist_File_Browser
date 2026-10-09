// Recently opened folders for the sidebar. read_directory (lib.rs) records each folder in
// `recent_folders` in studio_config.json, in the app data folder. This module reads that list back
// for the sidebar and clears it.
use super::{load_config, lock_config, save_config};
use std::path::Path;

// The folders that still exist, most recent first. Missing ones are skipped here but kept in the config,
// so a folder on a share that is offline comes back when the share does. The list is capped when recorded.
fn existing_only(paths: &[String], exists: impl Fn(&str) -> bool) -> Vec<String> {
    paths.iter().filter(|p| exists(p.as_str())).cloned().collect()
}

// IPC: Recent folders shown in the sidebar
#[tauri::command]
pub async fn get_recent_folders(app: tauri::AppHandle) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_config();
        let cfg = load_config(&app);
        existing_only(&cfg.recent_folders, |p| Path::new(p).is_dir())
    })
    .await
    .unwrap_or_default()
}

// IPC: Empties the recent-folders list
#[tauri::command]
pub async fn clear_recent_folders(app: tauri::AppHandle) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_config();
        let mut cfg = load_config(&app);
        cfg.recent_folders.clear();
        save_config(&app, &cfg);
    })
    .await;
}

#[cfg(test)]
mod tests {
    use super::existing_only;

    #[test]
    fn missing_folders_are_skipped_and_order_is_kept() {
        let paths = vec!["J:\\Assets".to_string(), "J:\\Gone".to_string(), "J:\\Textures".to_string()];
        let kept = existing_only(&paths, |p| p != "J:\\Gone");
        assert_eq!(kept, vec!["J:\\Assets".to_string(), "J:\\Textures".to_string()]);
    }

    #[test]
    fn empty_list_stays_empty() {
        assert!(existing_only(&[], |_| true).is_empty());
    }
}
