// The built-in user guide (docs/site). build.rs lists its files and include_bytes! puts them in the program, so the
// guide is there in the installed app and in the portable exe alike. The first time Help is clicked the files are
// written to `docs/<app version>/` in the app data folder and index.html is opened in the default browser. A new
// app version writes a fresh copy and removes the old ones.
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

include!(concat!(env!("OUT_DIR"), "/user_guide_files.rs"));

const GUIDE_VERSION: &str = env!("CARGO_PKG_VERSION");

// Writes the guide to `<base>/docs/<version>/` unless that copy is already there, and returns its index.html.
// The copy is written next to its final place and renamed into it, so an interrupted run leaves no half guide behind.
fn ensure_extracted(base: &Path, files: &[(&str, &[u8])], version: &str) -> Result<PathBuf, String> {
    if !files.iter().any(|(name, _)| *name == "index.html") {
        return Err("The user guide is not part of this build.".to_string());
    }

    let docs_dir = base.join("docs");
    let target = docs_dir.join(version);
    let index = target.join("index.html");
    if index.is_file() {
        return Ok(index);
    }

    let partial = docs_dir.join(format!(".{version}-partial"));
    let _ = fs::remove_dir_all(&partial);
    for (name, bytes) in files {
        let dest = partial.join(name);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
        }
        fs::write(&dest, bytes).map_err(|e| format!("Could not write {}: {e}", dest.display()))?;
    }
    let _ = fs::remove_dir_all(&target);
    fs::rename(&partial, &target).map_err(|e| format!("Could not set up {}: {e}", target.display()))?;

    // Copies from older app versions are no longer needed
    if let Ok(entries) = fs::read_dir(&docs_dir) {
        for entry in entries.flatten() {
            if entry.path() != target {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }
    Ok(index)
}

// Starts the system's default program for the file (the browser, for an .html page). Does not wait for it.
fn open_with_default_app(path: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        let win_path = path.to_string_lossy().replace('/', "\\");
        Command::new("cmd").args(["/c", "start", "", &win_path]).spawn().map(|_| ())
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open").arg(path).spawn().map(|_| ())
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = path;
        Err(std::io::Error::other("opening files is not supported on this system"))
    }
}

// IPC: Opens the user guide in the default browser. Errors come back as a sentence the app shows to the user.
#[tauri::command]
pub async fn open_user_guide(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let index = ensure_extracted(&super::get_app_dir(&app), GUIDE_FILES, GUIDE_VERSION)?;
        open_with_default_app(&index).map_err(|e| {
            format!(
                "The browser could not be started ({e}). The guide is saved here, open it yourself: {}",
                index.display()
            )
        })
    })
    .await
    .map_err(|e| format!("The user guide could not be opened: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_base(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cgfb-guide-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    const SAMPLE: &[(&str, &[u8])] = &[
        ("index.html", b"<html></html>"),
        ("deep/pdf.html", b"pdf"),
        ("assets/media/shot.webp", &[0, 1, 2, 3]),
    ];

    #[test]
    fn guide_is_embedded_with_an_index_page() {
        assert!(GUIDE_FILES.iter().any(|(name, bytes)| *name == "index.html" && !bytes.is_empty()));
        assert!(GUIDE_FILES.iter().any(|(name, _)| name.starts_with("assets/media/")));
    }

    #[test]
    fn first_open_writes_every_file_and_later_opens_reuse_them() {
        let base = temp_base("extract");
        let index = ensure_extracted(&base, SAMPLE, "1.2.3").unwrap();
        assert_eq!(index, base.join("docs").join("1.2.3").join("index.html"));
        assert_eq!(fs::read(base.join("docs/1.2.3/assets/media/shot.webp")).unwrap(), vec![0, 1, 2, 3]);
        assert!(!base.join("docs/.1.2.3-partial").exists());

        // An existing copy is left alone
        fs::write(&index, b"edited").unwrap();
        ensure_extracted(&base, SAMPLE, "1.2.3").unwrap();
        assert_eq!(fs::read(&index).unwrap(), b"edited");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn new_version_gets_a_fresh_copy_and_old_ones_are_removed() {
        let base = temp_base("upgrade");
        ensure_extracted(&base, SAMPLE, "1.2.3").unwrap();
        ensure_extracted(&base, SAMPLE, "1.3.0").unwrap();
        assert!(base.join("docs/1.3.0/index.html").is_file());
        assert!(!base.join("docs/1.2.3").exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_build_without_the_guide_reports_it() {
        let base = temp_base("missing");
        assert!(ensure_extracted(&base, &[], "1.2.3").is_err());
        let _ = fs::remove_dir_all(&base);
    }
}
