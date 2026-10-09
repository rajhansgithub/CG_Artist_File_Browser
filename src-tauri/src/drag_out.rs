//! Native drag-out: drag files from the grid into other applications (Blender, Maya, Photoshop,
//! Unreal, File Explorer) as real files.
//!
//! The drag itself is an OLE drag (`DoDragDrop`) carrying the files as a shell data object, so every
//! application that accepts files dropped from File Explorer accepts them from here. Files are offered
//! as a copy only: the originals are never moved or deleted. Windows only; other platforms return an error.

use std::io::Cursor;
use std::path::{Path, PathBuf};

/// Most files one drag may carry (the grid drags one; this only stops a runaway request).
const MAX_FILES: usize = 500;
/// Longest side of the picture that follows the cursor, in pixels.
const ICON_SIZE: u32 = 96;

/// Turns the paths from the webview into files that exist. Folders are not dragged out.
pub fn checked_files(paths: Vec<String>) -> Result<Vec<PathBuf>, String> {
    if paths.is_empty() {
        return Err("Nothing to drag".to_string());
    }
    if paths.len() > MAX_FILES {
        return Err(format!("Too many files to drag at once (limit {})", MAX_FILES));
    }
    let mut files = Vec::with_capacity(paths.len());
    for p in paths {
        let path = PathBuf::from(&p);
        if !path.is_file() {
            return Err(format!("Cannot drag {}: the file is not available", p));
        }
        files.push(path);
    }
    Ok(files)
}

/// PNG for the picture that follows the cursor: the file's cached thumbnail when there is one, otherwise a
/// plain tile.
pub fn drag_icon(thumbnail: Option<&Path>) -> Vec<u8> {
    let from_thumbnail = thumbnail
        .and_then(|p| image::open(p).ok())
        .map(|img| img.thumbnail(ICON_SIZE, ICON_SIZE).to_rgba8());
    let icon = from_thumbnail.unwrap_or_else(plain_tile);

    let mut png = Cursor::new(Vec::new());
    match image::DynamicImage::ImageRgba8(icon).write_to(&mut png, image::ImageFormat::Png) {
        Ok(()) => png.into_inner(),
        // Without a picture the drag still works, it just shows the plain cursor
        Err(_) => Vec::new(),
    }
}

fn plain_tile() -> image::RgbaImage {
    let size = 64;
    image::RgbaImage::from_fn(size, size, |x, y| {
        let edge = x == 0 || y == 0 || x == size - 1 || y == size - 1;
        if edge {
            image::Rgba([200, 200, 200, 255])
        } else {
            image::Rgba([48, 48, 48, 255])
        }
    })
}

#[cfg(windows)]
mod imp {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};

    // Only one drag can run at a time (it is modal on the window's thread)
    static ACTIVE: AtomicBool = AtomicBool::new(false);

    struct ActiveGuard;
    impl Drop for ActiveGuard {
        fn drop(&mut self) {
            ACTIVE.store(false, Ordering::SeqCst);
        }
    }

    /// Starts the drag on the window's own thread and waits until the user drops or cancels it.
    pub async fn run(window: tauri::WebviewWindow, files: Vec<PathBuf>, icon: Vec<u8>) -> Result<(), String> {
        if ACTIVE.swap(true, Ordering::SeqCst) {
            return Err("A drag is already in progress".to_string());
        }
        let _guard = ActiveGuard;

        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let target = window.clone();
        window
            .run_on_main_thread(move || {
                // The drag crate unwraps a few shell calls; a panic here must not take the app down
                let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    drag::start_drag(
                        &target,
                        drag::DragItem::Files(files),
                        drag::Image::Raw(icon),
                        |_result, _cursor| {},
                        drag::Options::default(),
                    )
                }));
                let _ = tx.send(match outcome {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(e)) => Err(e.to_string()),
                    Err(_) => Err("The drag failed".to_string()),
                });
            })
            .map_err(|e| e.to_string())?;

        tauri::async_runtime::spawn_blocking(move || rx.recv())
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?
    }
}

#[cfg(not(windows))]
mod imp {
    use std::path::PathBuf;

    pub async fn run(_window: tauri::WebviewWindow, _files: Vec<PathBuf>, _icon: Vec<u8>) -> Result<(), String> {
        Err("Dragging files out of the app is only available on Windows".to_string())
    }
}

pub use imp::run;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_and_missing_paths() {
        assert!(checked_files(vec![]).is_err());
        assert!(checked_files(vec!["Z:\\definitely\\not\\here.exr".to_string()]).is_err());
    }

    #[test]
    fn folders_are_not_dragged() {
        let dir = std::env::temp_dir().to_string_lossy().to_string();
        assert!(checked_files(vec![dir]).is_err());
    }

    #[test]
    fn accepts_existing_files() {
        let file = std::env::temp_dir().join("cg_drag_out_test.txt");
        std::fs::write(&file, b"x").unwrap();
        let out = checked_files(vec![file.to_string_lossy().to_string()]);
        let _ = std::fs::remove_file(&file);
        assert_eq!(out.unwrap(), vec![file]);
    }

    #[test]
    fn icon_is_a_small_png_with_or_without_a_thumbnail() {
        let plain = drag_icon(None);
        assert!(plain.starts_with(&[0x89, b'P', b'N', b'G']));

        let thumb = std::env::temp_dir().join("cg_drag_out_thumb.png");
        image::RgbaImage::from_pixel(400, 200, image::Rgba([10, 120, 200, 255]))
            .save(&thumb)
            .unwrap();
        let from_thumb = drag_icon(Some(&thumb));
        let _ = std::fs::remove_file(&thumb);
        let decoded = image::load_from_memory(&from_thumb).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (ICON_SIZE, ICON_SIZE / 2));
    }

    #[test]
    fn unreadable_thumbnail_falls_back_to_the_plain_tile() {
        let icon = drag_icon(Some(Path::new("Z:\\no\\such\\thumb.jpg")));
        assert_eq!(icon, drag_icon(None));
    }
}
