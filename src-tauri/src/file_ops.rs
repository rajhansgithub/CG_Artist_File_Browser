//! File operations: copy, cut (move) and paste of files and folders, and New folder.
//!
//! A paste starts a job with an id the webview made itself, then listens for `file-transfer-progress` and
//! `file-transfer-finished` events, so nothing waits on this work (the same shape as the batch converter).
//! Items are handled one after the other on one background thread, since two copies on one disk only slow
//! each other down. Files are copied in 4 MiB pieces, so Cancel is felt within a piece, and a copy that is
//! cancelled or fails leaves no half-written file behind.
//!
//! A name that is already taken gets " (1)", " (2)", ... added, so nothing is overwritten, unless the user
//! chose Replace: a file is then written under a temporary name and renamed over the old one, and a folder
//! is merged into the old one. Cut is a rename; when that is not possible (another drive or share) the item
//! is copied and the original removed once the copy is complete.
//!
//! The copied (or cut) files are also put on the Windows clipboard the way File Explorer does it, so files
//! can be pasted here from Explorer and the other way round. Other systems keep the list in memory.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, ErrorKind, Read, Write};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::Emitter;

/// Size of the pieces a file is copied in
const CHUNK: usize = 4 * 1024 * 1024;
/// Byte counts are sent to the webview at most this often
const PROGRESS_EVERY: Duration = Duration::from_millis(120);

// Cancel flags of the jobs still running, by the id the webview gave them
static JOBS: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn jobs() -> MutexGuard<'static, HashMap<String, Arc<AtomicBool>>> {
    JOBS.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Copy,
    Move,
}

impl Mode {
    fn parse(name: &str) -> Result<Self, String> {
        match name {
            "copy" => Ok(Self::Copy),
            "move" => Ok(Self::Move),
            other => Err(format!("Unknown mode: {other}")),
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    job_id: String,
    index: usize,
    path: String,
    // "working", "done", "failed" or "cancelled"
    status: &'static str,
    out_path: Option<String>,
    error: Option<String>,
    bytes_done: u64,
    // 0 when the size of the whole job is not known (a cut)
    bytes_total: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FinishedEvent {
    job_id: String,
    done: usize,
    failed: usize,
    cancelled: bool,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransferCheck {
    /// Names that already exist in the destination folder
    pub conflicts: Vec<String>,
    /// How many of the items would actually change anything (a cut into the folder an item is already in does not)
    pub actionable: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ClipboardFiles {
    pub paths: Vec<String>,
    pub cut: bool,
}

// ---- errors ----------------------------------------------------------------------------------------------

enum Failure {
    Cancelled,
    Failed(String),
}

type Res<T> = Result<T, Failure>;

fn failed<T>(message: impl Into<String>) -> Res<T> {
    Err(Failure::Failed(message.into()))
}

fn name_of(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string())
}

/// A message a person can act on, for what went wrong with `path`.
fn explain(e: &io::Error, path: &Path) -> Failure {
    let name = name_of(path);
    let code = if cfg!(windows) { e.raw_os_error() } else { None };
    let message = match (e.kind(), code) {
        (ErrorKind::NotFound, _) | (_, Some(2 | 3)) => format!("{name} was not found. It may have been moved or deleted."),
        (_, Some(32 | 33 | 1224)) => format!("{name} is in use by another program."),
        (ErrorKind::PermissionDenied, _) => format!("Access to {name} is denied. It may be read-only or open in another program."),
        (ErrorKind::StorageFull, _) | (_, Some(39 | 112)) => "There is not enough free space on the destination drive.".to_string(),
        (_, Some(53 | 59 | 64 | 67 | 1231)) => "The network location could not be reached, or stopped answering.".to_string(),
        (_, Some(206)) => format!("The path to {name} is too long for Windows."),
        (ErrorKind::AlreadyExists, _) => format!("{name} already exists."),
        _ => format!("{name}: {e}"),
    };
    Failure::Failed(message)
}

fn io_fail<T>(r: io::Result<T>, path: &Path) -> Res<T> {
    r.map_err(|e| explain(&e, path))
}

// ---- paths -----------------------------------------------------------------------------------------------

/// A path in a form that compares equal for the same place: one kind of slash, no trailing slash, and no case on Windows.
fn key(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    let s = s.trim_end_matches('/');
    if cfg!(windows) { s.to_lowercase() } else { s.to_string() }
}

fn same_place(a: &Path, b: &Path) -> bool {
    key(a) == key(b)
}

/// `inner` is `outer` itself or something inside it.
fn is_inside(inner: &Path, outer: &Path) -> bool {
    let (inner, outer) = (key(inner), key(outer));
    inner == outer || inner.starts_with(&format!("{outer}/"))
}

fn exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

fn split_name(name: &str, is_dir: bool) -> (String, String) {
    if is_dir {
        return (name.to_string(), String::new());
    }
    match name.rfind('.') {
        Some(dot) if dot > 0 => (name[..dot].to_string(), name[dot..].to_string()),
        _ => (name.to_string(), String::new()),
    }
}

fn numbered(stem: &str, ext: &str, n: usize) -> String {
    if n == 0 { format!("{stem}{ext}") } else { format!("{stem} ({n}){ext}") }
}

/// The first free name in `dir` ("shot.png", "shot (1).png", ...), without creating anything.
fn free_name(dir: &Path, name: &str, is_dir: bool) -> PathBuf {
    let (stem, ext) = split_name(name, is_dir);
    (0..)
        .map(|n| dir.join(numbered(&stem, &ext, n)))
        .find(|p| !exists(p))
        .expect("an unbounded range always ends")
}

/// Picks the first free name and creates it empty (a folder, or a file that is returned open), so two
/// things can never end up with the same name.
fn reserve(dir: &Path, name: &str, is_dir: bool) -> Res<(PathBuf, Option<File>)> {
    let (stem, ext) = split_name(name, is_dir);
    for n in 0.. {
        let path = dir.join(numbered(&stem, &ext, n));
        let made = if is_dir {
            fs::create_dir(&path).map(|_| None)
        } else {
            OpenOptions::new().write(true).create_new(true).open(&path).map(Some)
        };
        match made {
            Ok(file) => return Ok((path, file)),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(explain(&e, &path)),
        }
    }
    unreachable!("an unbounded range always ends")
}

// ---- progress --------------------------------------------------------------------------------------------

struct Reporter {
    sink: Box<dyn FnMut(ProgressEvent) + Send>,
    job_id: String,
    cancel: Arc<AtomicBool>,
    total: u64,
    done: u64,
    index: usize,
    path: String,
    last_sent: Instant,
    buf: Vec<u8>,
}

impl Reporter {
    fn new(job_id: &str, cancel: Arc<AtomicBool>, sink: Box<dyn FnMut(ProgressEvent) + Send>) -> Self {
        Self {
            sink,
            job_id: job_id.to_string(),
            cancel,
            total: 0,
            done: 0,
            index: 0,
            path: String::new(),
            last_sent: Instant::now(),
            buf: Vec::new(),
        }
    }

    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    fn check(&self) -> Res<()> {
        if self.cancelled() { Err(Failure::Cancelled) } else { Ok(()) }
    }

    fn send(&mut self, status: &'static str, out_path: Option<&Path>, error: Option<String>) {
        self.last_sent = Instant::now();
        (self.sink)(ProgressEvent {
            job_id: self.job_id.clone(),
            index: self.index,
            path: self.path.clone(),
            status,
            out_path: out_path.map(|p| p.display().to_string()),
            error,
            bytes_done: self.done,
            bytes_total: self.total,
        });
    }

    fn item(&mut self, index: usize, src: &Path, status: &'static str, out: Option<&Path>, error: Option<String>) {
        self.index = index;
        self.path = src.display().to_string();
        self.send(status, out, error);
    }

    fn advance(&mut self, bytes: u64) {
        self.done += bytes;
        if self.last_sent.elapsed() >= PROGRESS_EVERY {
            self.send("working", None, None);
        }
    }
}

// ---- copying ---------------------------------------------------------------------------------------------

/// Copies the contents of `src` into the open `out` and gives it the source's modified time and attributes.
fn pump(src: &Path, mut out: File, dst: &Path, rep: &mut Reporter) -> Res<()> {
    let mut input = io_fail(File::open(src), src)?;
    let meta = io_fail(input.metadata(), src)?;
    if rep.buf.len() != CHUNK {
        rep.buf = vec![0u8; CHUNK];
    }
    loop {
        rep.check()?;
        let n = io_fail(input.read(&mut rep.buf), src)?;
        if n == 0 {
            break;
        }
        io_fail(out.write_all(&rep.buf[..n]), dst)?;
        rep.advance(n as u64);
    }
    if let Ok(modified) = meta.modified() {
        let _ = out.set_modified(modified);
    }
    drop(out);
    let _ = fs::set_permissions(dst, meta.permissions());
    Ok(())
}

/// Makes a file that has just been made read-only writable again, so it can be replaced or removed.
fn clear_read_only(path: &Path) {
    if let Ok(meta) = fs::metadata(path) {
        let mut permissions = meta.permissions();
        if permissions.readonly() {
            #[allow(clippy::permissions_set_readonly_false)]
            permissions.set_readonly(false);
            let _ = fs::set_permissions(path, permissions);
        }
    }
}

fn remove_file_anyway(path: &Path) -> io::Result<()> {
    fs::remove_file(path).or_else(|first| {
        clear_read_only(path);
        fs::remove_file(path).map_err(|_| first)
    })
}

/// Copies one file over `dst` (which may exist) through a temporary file, so the old file is only gone once the copy is whole.
fn copy_file_replace(src: &Path, dst: &Path, rep: &mut Reporter) -> Res<()> {
    let tmp = dst.with_file_name(format!(".{}.{}.copying", name_of(dst), std::process::id()));
    let out = io_fail(File::create(&tmp), &tmp)?;
    let result = pump(src, out, &tmp, rep).and_then(|()| {
        clear_read_only(dst);
        io_fail(fs::rename(&tmp, dst), dst)
    });
    if result.is_err() {
        let _ = remove_file_anyway(&tmp);
    }
    result
}

/// Copies what is inside the folder `src` into the existing folder `dst`, replacing files of the same name
/// and merging folders of the same name.
fn copy_folder_into(src: &Path, dst: &Path, rep: &mut Reporter) -> Res<()> {
    let entries = io_fail(fs::read_dir(src), src)?;
    for entry in entries {
        rep.check()?;
        let entry = io_fail(entry, src)?;
        copy_entry(&entry.path(), &dst.join(entry.file_name()), rep)?;
    }
    Ok(())
}

/// Copies a file or folder to `dst`, replacing or merging what is already there.
fn copy_entry(src: &Path, dst: &Path, rep: &mut Reporter) -> Res<()> {
    let meta = io_fail(fs::symlink_metadata(src), src)?;
    let is_dir = if meta.file_type().is_symlink() {
        // A link to a file is copied as that file; a link to a folder could loop back into itself
        if fs::metadata(src).map(|m| m.is_dir()).unwrap_or(false) {
            return failed(format!("{} is a link to a folder, which can't be copied.", name_of(src)));
        }
        false
    } else {
        meta.is_dir()
    };
    if is_dir {
        match fs::create_dir(dst) {
            Ok(()) => {}
            Err(e) if e.kind() == ErrorKind::AlreadyExists && dst.is_dir() => {}
            Err(e) if e.kind() == ErrorKind::AlreadyExists => {
                return failed(format!("{} is a file, so the folder {} can't be copied there.", name_of(dst), name_of(src)));
            }
            Err(e) => return Err(explain(&e, dst)),
        }
        copy_folder_into(src, dst, rep)
    } else if dst.is_dir() {
        failed(format!("{} is a folder, so the file {} can't be copied there.", name_of(dst), name_of(src)))
    } else {
        copy_file_replace(src, dst, rep)
    }
}

// ---- moving ----------------------------------------------------------------------------------------------

fn crosses_devices(e: &io::Error) -> bool {
    e.kind() == ErrorKind::CrossesDevices || (cfg!(windows) && e.raw_os_error() == Some(17))
}

fn remove_source(src: &Path) -> Res<()> {
    let meta = io_fail(fs::symlink_metadata(src), src)?;
    let result = if meta.is_dir() { fs::remove_dir_all(src) } else { remove_file_anyway(src) };
    result.map_err(|e| match explain(&e, src) {
        Failure::Failed(m) => Failure::Failed(format!("Copied, but the original could not be removed. {m}")),
        other => other,
    })
}

/// Moves `src` to `dst`, replacing or merging what is already there when `replace` is set.
fn move_entry(src: &Path, dst: &Path, rep: &mut Reporter) -> Res<()> {
    let src_is_dir = fs::symlink_metadata(src).map(|m| m.is_dir()).unwrap_or(false);
    let dst_exists = exists(dst);
    let dst_is_dir = dst.is_dir();
    if dst_exists && src_is_dir != dst_is_dir {
        return failed(format!("{} can't replace {}: one is a folder and the other a file.", name_of(src), name_of(dst)));
    }
    if src_is_dir && dst_exists {
        // Folders of the same name are merged; what moves in replaces files of the same name
        let entries = io_fail(fs::read_dir(src), src)?;
        for entry in entries {
            rep.check()?;
            let entry = io_fail(entry, src)?;
            move_entry(&entry.path(), &dst.join(entry.file_name()), rep)?;
        }
        return io_fail(fs::remove_dir(src), src);
    }
    if dst_exists {
        clear_read_only(dst);
    }
    match fs::rename(src, dst) {
        Ok(()) => Ok(()),
        Err(e) if crosses_devices(&e) => {
            copy_entry(src, dst, rep)?;
            rep.check()?;
            remove_source(src)
        }
        Err(e) => Err(explain(&e, src)),
    }
}

// ---- one item --------------------------------------------------------------------------------------------

/// Copies or moves one item into `dest_dir` and returns the path it now has there.
fn transfer_item(src: &Path, dest_dir: &Path, mode: Mode, replace: bool, rep: &mut Reporter) -> Res<PathBuf> {
    let meta = io_fail(fs::symlink_metadata(src), src)?;
    let is_dir = meta.is_dir();
    let name = name_of(src);
    if mode == Mode::Copy && meta.file_type().is_symlink() && fs::metadata(src).map(|m| m.is_dir()).unwrap_or(false) {
        return failed(format!("{name} is a link to a folder, which can't be copied."));
    }
    let parent = src.parent().ok_or_else(|| Failure::Failed("Drives and network shares can't be copied or moved here.".into()))?;
    let same_folder = same_place(parent, dest_dir);

    if is_dir && is_inside(dest_dir, src) {
        let verb = if mode == Mode::Copy { "copied" } else { "moved" };
        return failed(format!("The folder {name} can't be {verb} into itself or one of its own folders."));
    }
    if mode == Mode::Move && same_folder {
        return Ok(src.to_path_buf());
    }

    let target = dest_dir.join(&name);
    let clash = exists(&target);

    if clash && replace && !same_folder {
        // Replace: the old file is only replaced once the new one is whole; folders are merged
        if mode == Mode::Copy {
            copy_entry(src, &target, rep)?;
        } else {
            move_entry(src, &target, rep)?;
        }
        return Ok(target);
    }

    // Keep both: a free name is taken, so nothing is overwritten
    if mode == Mode::Move {
        let free = free_name(dest_dir, &name, is_dir);
        match fs::rename(src, &free) {
            Ok(()) => return Ok(free),
            Err(e) if crosses_devices(&e) => {}
            Err(e) => return Err(explain(&e, src)),
        }
    }
    let (path, file) = reserve(dest_dir, &name, is_dir)?;
    let result = match file {
        // A file: copy into the empty file that was just made
        Some(out) => pump(src, out, &path, rep),
        None => copy_folder_into(src, &path, rep),
    };
    let result = result.and_then(|()| if mode == Mode::Move { rep.check().and_then(|()| remove_source(src)) } else { Ok(()) });
    match result {
        Ok(()) => Ok(path),
        Err(failure) => {
            // Nothing half-made stays behind
            let _ = if is_dir { fs::remove_dir_all(&path) } else { remove_file_anyway(&path) };
            Err(failure)
        }
    }
}

struct Summary {
    done: usize,
    failed: usize,
}

fn run_items(items: &[PathBuf], dest_dir: &Path, mode: Mode, replace: bool, rep: &mut Reporter) -> Summary {
    let mut summary = Summary { done: 0, failed: 0 };
    for (index, src) in items.iter().enumerate() {
        if rep.cancelled() {
            rep.item(index, src, "cancelled", None, None);
            continue;
        }
        rep.item(index, src, "working", None, None);
        match transfer_item(src, dest_dir, mode, replace, rep) {
            Ok(out) => {
                summary.done += 1;
                rep.send("done", Some(&out), None);
            }
            Err(Failure::Cancelled) => rep.send("cancelled", None, None),
            Err(Failure::Failed(message)) => {
                summary.failed += 1;
                rep.send("failed", None, Some(message));
            }
        }
    }
    summary
}

/// Bytes in everything that will be copied, for the progress bar.
fn total_size(items: &[PathBuf]) -> u64 {
    items
        .iter()
        .flat_map(|item| walkdir::WalkDir::new(item).follow_links(false).into_iter().flatten())
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| entry.metadata().ok())
        .map(|meta| meta.len())
        .sum()
}

// ---- commands --------------------------------------------------------------------------------------------

fn check_blocking(paths: &[String], dest_dir: &str, mode: Mode) -> Result<TransferCheck, String> {
    let dest = Path::new(dest_dir);
    if !dest.is_dir() {
        return Err("The folder to paste into is not available.".into());
    }
    let mut conflicts = Vec::new();
    let mut actionable = 0;
    for path in paths {
        let src = Path::new(path);
        let Some(parent) = src.parent() else { continue };
        let same_folder = same_place(parent, dest);
        if mode == Mode::Move && same_folder {
            continue;
        }
        actionable += 1;
        // A copy into its own folder always gets a new name, so it is not a clash
        if !same_folder && exists(&dest.join(name_of(src))) {
            conflicts.push(name_of(src));
        }
    }
    Ok(TransferCheck { conflicts, actionable })
}

/// Which of the items already exist in `dest_dir`, so the webview can ask before replacing anything.
#[tauri::command]
pub async fn check_file_transfer(paths: Vec<String>, dest_dir: String, mode: String) -> Result<TransferCheck, String> {
    let mode = Mode::parse(&mode)?;
    tauri::async_runtime::spawn_blocking(move || check_blocking(&paths, &dest_dir, mode))
        .await
        .map_err(|e| e.to_string())?
}

/// Starts copying (`mode` "copy") or moving ("move") `paths` into `dest_dir` in the background.
/// With `replace`, an item whose name is taken replaces it; otherwise it gets a new name.
#[tauri::command]
pub async fn start_file_transfer(
    app: tauri::AppHandle,
    job_id: String,
    paths: Vec<String>,
    dest_dir: String,
    mode: String,
    replace: bool,
) -> Result<(), String> {
    let mode = Mode::parse(&mode)?;
    if paths.is_empty() {
        return Err("Nothing to paste.".into());
    }
    let dest = PathBuf::from(&dest_dir);
    let is_dir = {
        let dest = dest.clone();
        tauri::async_runtime::spawn_blocking(move || dest.is_dir()).await.map_err(|e| e.to_string())?
    };
    if !is_dir {
        return Err("The folder to paste into is not available.".into());
    }

    let cancel = Arc::new(AtomicBool::new(false));
    jobs().insert(job_id.clone(), cancel.clone());
    let items: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    std::thread::spawn(move || {
        let sink_app = app.clone();
        let sink = Box::new(move |event: ProgressEvent| {
            let _ = sink_app.emit("file-transfer-progress", event);
        });
        let mut rep = Reporter::new(&job_id, cancel.clone(), sink);
        // A panic in the copy code should end this job, not leave the panel waiting for ever
        let summary = catch_unwind(AssertUnwindSafe(|| {
            if mode == Mode::Copy {
                rep.total = total_size(&items);
            }
            run_items(&items, &dest, mode, replace, &mut rep)
        }))
        .unwrap_or(Summary { done: 0, failed: items.len() });
        let _ = app.emit(
            "file-transfer-finished",
            FinishedEvent { job_id: job_id.clone(), done: summary.done, failed: summary.failed, cancelled: cancel.load(Ordering::Relaxed) },
        );
        jobs().remove(&job_id);
    });
    Ok(())
}

/// Stops a running paste. The piece being copied is dropped and its half-made file removed; the rest are reported as cancelled.
#[tauri::command]
pub fn cancel_file_transfer(job_id: String) -> bool {
    match jobs().get(&job_id) {
        Some(flag) => {
            flag.store(true, Ordering::Relaxed);
            true
        }
        None => false,
    }
}

/// Makes a new folder in `parent` named "New folder" (or "New folder (1)", ...) and returns its path.
#[tauri::command]
pub async fn create_folder(parent: String, name: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let parent = Path::new(&parent);
        if !parent.is_dir() {
            return Err("The folder is not available.".to_string());
        }
        let name = name.as_deref().map(str::trim).filter(|n| !n.is_empty()).unwrap_or("New folder");
        crate::validate_item_name(name)?;
        match reserve(parent, name, true) {
            Ok((path, _)) => Ok(path.to_string_lossy().into_owned()),
            Err(Failure::Failed(message)) => Err(message),
            Err(Failure::Cancelled) => Err("Cancelled".to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Puts the files on the clipboard as copied (`cut` false) or cut.
#[tauri::command]
pub async fn set_clipboard_files(paths: Vec<String>, cut: bool) -> Result<(), String> {
    if paths.is_empty() {
        return Err("Nothing selected.".into());
    }
    tauri::async_runtime::spawn_blocking(move || clipboard::set(&ClipboardFiles { paths, cut }))
        .await
        .map_err(|e| e.to_string())?
}

/// The files on the clipboard (copied here or in File Explorer), or None when it holds no files.
#[tauri::command]
pub async fn get_clipboard_files() -> Result<Option<ClipboardFiles>, String> {
    tauri::async_runtime::spawn_blocking(clipboard::get).await.map_err(|e| e.to_string())?
}

/// Empties the clipboard of files once a cut has been pasted, as File Explorer does.
#[tauri::command]
pub async fn clear_clipboard_files() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(clipboard::clear).await.map_err(|e| e.to_string())?
}

// ---- the clipboard ---------------------------------------------------------------------------------------

#[cfg(windows)]
mod clipboard {
    use super::ClipboardFiles;
    use clipboard_win::{Clipboard, formats, raw};
    use std::path::PathBuf;

    // File Explorer marks a cut with this format: a number, 1 for copy and 2 for move
    const DROP_EFFECT: &str = "Preferred DropEffect";
    const EFFECT_COPY: u32 = 1;
    const EFFECT_MOVE: u32 = 2;

    fn open() -> Result<Clipboard, String> {
        Clipboard::new_attempts(10).map_err(|e| format!("The clipboard is in use by another program ({e})."))
    }

    pub fn set(files: &ClipboardFiles) -> Result<(), String> {
        let _clip = open()?;
        raw::empty().map_err(|e| e.to_string())?;
        raw::set_file_list(&files.paths).map_err(|e| e.to_string())?;
        if let Some(format) = raw::register_format(DROP_EFFECT) {
            let effect = if files.cut { EFFECT_MOVE } else { EFFECT_COPY };
            // The files are already on the clipboard; a program that does not know this format still pastes them
            let _ = raw::set_without_clear(format.get(), &effect.to_le_bytes());
        }
        Ok(())
    }

    pub fn get() -> Result<Option<ClipboardFiles>, String> {
        let _clip = open()?;
        if !raw::is_format_avail(formats::CF_HDROP) {
            return Ok(None);
        }
        let mut paths: Vec<PathBuf> = Vec::new();
        raw::get_file_list_path(&mut paths).map_err(|e| e.to_string())?;
        if paths.is_empty() {
            return Ok(None);
        }
        let mut effect = Vec::new();
        let cut = raw::register_format(DROP_EFFECT)
            .filter(|format| raw::is_format_avail(format.get()))
            .and_then(|format| raw::get_vec(format.get(), &mut effect).ok())
            .filter(|_| effect.len() >= 4)
            .map(|_| u32::from_le_bytes([effect[0], effect[1], effect[2], effect[3]]) & EFFECT_MOVE != 0)
            .unwrap_or(false);
        Ok(Some(ClipboardFiles { paths: paths.iter().map(|p| p.to_string_lossy().into_owned()).collect(), cut }))
    }

    pub fn clear() -> Result<(), String> {
        let _clip = open()?;
        raw::empty().map_err(|e| e.to_string())
    }
}

// Other systems have no shared file clipboard here: the list stays inside the app
#[cfg(not(windows))]
mod clipboard {
    use super::ClipboardFiles;
    use std::sync::Mutex;

    static HELD: Mutex<Option<ClipboardFiles>> = Mutex::new(None);

    fn held() -> std::sync::MutexGuard<'static, Option<ClipboardFiles>> {
        HELD.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn set(files: &ClipboardFiles) -> Result<(), String> {
        *held() = Some(files.clone());
        Ok(())
    }

    pub fn get() -> Result<Option<ClipboardFiles>, String> {
        Ok(held().clone())
    }

    pub fn clear() -> Result<(), String> {
        *held() = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    static NEXT: AtomicUsize = AtomicUsize::new(0);

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("file-ops-{}-{}-{name}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn reporter() -> Reporter {
        Reporter::new("test", Arc::new(AtomicBool::new(false)), Box::new(|_| {}))
    }

    fn run(items: &[&Path], dest: &Path, mode: Mode, replace: bool) -> Vec<Res<PathBuf>> {
        let mut rep = reporter();
        items.iter().map(|item| transfer_item(item, dest, mode, replace, &mut rep)).collect()
    }

    #[test]
    fn copies_keep_the_original_and_never_overwrite() {
        let dir = temp_dir("copy");
        let dest = dir.join("dest");
        fs::create_dir(&dest).unwrap();
        fs::write(dir.join("shot.exr"), b"new").unwrap();
        fs::write(dest.join("shot.exr"), b"old").unwrap();

        let out = run(&[&dir.join("shot.exr")], &dest, Mode::Copy, false).remove(0).ok().unwrap();
        assert_eq!(out, dest.join("shot (1).exr"));
        assert_eq!(fs::read(&out).unwrap(), b"new");
        assert_eq!(fs::read(dest.join("shot.exr")).unwrap(), b"old");
        assert_eq!(fs::read(dir.join("shot.exr")).unwrap(), b"new");
    }

    #[test]
    fn a_copy_into_its_own_folder_gets_a_number() {
        let dir = temp_dir("same");
        fs::write(dir.join("a.txt"), b"a").unwrap();
        let first = run(&[&dir.join("a.txt")], &dir, Mode::Copy, false).remove(0).ok().unwrap();
        let second = run(&[&dir.join("a.txt")], &dir, Mode::Copy, true).remove(0).ok().unwrap();
        assert_eq!(first, dir.join("a (1).txt"));
        // Replace never means replacing the file with itself
        assert_eq!(second, dir.join("a (2).txt"));
    }

    #[test]
    fn folders_are_copied_with_everything_inside() {
        let dir = temp_dir("tree");
        let src = dir.join("pack");
        fs::create_dir_all(src.join("sub/deeper")).unwrap();
        fs::write(src.join("a.txt"), b"a").unwrap();
        fs::write(src.join("sub/deeper/b.txt"), b"b").unwrap();
        let dest = dir.join("dest");
        fs::create_dir(&dest).unwrap();

        let out = run(&[&src], &dest, Mode::Copy, false).remove(0).ok().unwrap();
        assert_eq!(out, dest.join("pack"));
        assert_eq!(fs::read(out.join("sub/deeper/b.txt")).unwrap(), b"b");
        let again = run(&[&src], &dest, Mode::Copy, false).remove(0).ok().unwrap();
        assert_eq!(again, dest.join("pack (1)"));
        assert!(src.join("a.txt").exists());
    }

    #[test]
    fn replace_overwrites_files_and_merges_folders() {
        let dir = temp_dir("replace");
        let dest = dir.join("dest");
        fs::create_dir_all(dest.join("pack")).unwrap();
        fs::write(dest.join("pack/keep.txt"), b"keep").unwrap();
        fs::write(dest.join("pack/a.txt"), b"old").unwrap();
        fs::write(dest.join("one.txt"), b"old").unwrap();
        fs::create_dir_all(dir.join("pack")).unwrap();
        fs::write(dir.join("pack/a.txt"), b"new").unwrap();
        fs::write(dir.join("one.txt"), b"new").unwrap();

        let out = run(&[&dir.join("one.txt"), &dir.join("pack")], &dest, Mode::Copy, true);
        assert!(out.iter().all(|r| r.is_ok()));
        assert_eq!(fs::read(dest.join("one.txt")).unwrap(), b"new");
        assert_eq!(fs::read(dest.join("pack/a.txt")).unwrap(), b"new");
        assert_eq!(fs::read(dest.join("pack/keep.txt")).unwrap(), b"keep");
        let leftovers = fs::read_dir(&dest).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().ends_with(".copying")).count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn a_cut_moves_and_numbers_clashes() {
        let dir = temp_dir("move");
        let dest = dir.join("dest");
        fs::create_dir(&dest).unwrap();
        fs::write(dir.join("a.txt"), b"moved").unwrap();
        fs::write(dest.join("a.txt"), b"there").unwrap();
        fs::create_dir(dir.join("folder")).unwrap();
        fs::write(dir.join("folder/x.txt"), b"x").unwrap();

        let out = run(&[&dir.join("a.txt"), &dir.join("folder")], &dest, Mode::Move, false);
        assert_eq!(out[0].as_ref().ok().unwrap(), &dest.join("a (1).txt"));
        assert_eq!(out[1].as_ref().ok().unwrap(), &dest.join("folder"));
        assert!(!dir.join("a.txt").exists() && !dir.join("folder").exists());
        assert_eq!(fs::read(dest.join("a.txt")).unwrap(), b"there");
        assert_eq!(fs::read(dest.join("folder/x.txt")).unwrap(), b"x");
    }

    #[test]
    fn a_cut_with_replace_overwrites_and_merges() {
        let dir = temp_dir("move-replace");
        let dest = dir.join("dest");
        fs::create_dir_all(dest.join("pack")).unwrap();
        fs::write(dest.join("pack/a.txt"), b"old").unwrap();
        fs::write(dest.join("one.txt"), b"old").unwrap();
        fs::create_dir_all(dir.join("pack")).unwrap();
        fs::write(dir.join("pack/a.txt"), b"new").unwrap();
        fs::write(dir.join("pack/b.txt"), b"b").unwrap();
        fs::write(dir.join("one.txt"), b"new").unwrap();

        let out = run(&[&dir.join("one.txt"), &dir.join("pack")], &dest, Mode::Move, true);
        assert!(out.iter().all(|r| r.is_ok()));
        assert_eq!(fs::read(dest.join("one.txt")).unwrap(), b"new");
        assert_eq!(fs::read(dest.join("pack/a.txt")).unwrap(), b"new");
        assert_eq!(fs::read(dest.join("pack/b.txt")).unwrap(), b"b");
        assert!(!dir.join("pack").exists() && !dir.join("one.txt").exists());
    }

    #[test]
    fn a_cut_into_the_same_folder_changes_nothing() {
        let dir = temp_dir("noop");
        fs::write(dir.join("a.txt"), b"a").unwrap();
        let out = run(&[&dir.join("a.txt")], &dir, Mode::Move, false).remove(0).ok().unwrap();
        assert_eq!(out, dir.join("a.txt"));
        let check = check_blocking(&[dir.join("a.txt").display().to_string()], &dir.display().to_string(), Mode::Move).unwrap();
        assert_eq!(check, TransferCheck { conflicts: vec![], actionable: 0 });
    }

    #[test]
    fn a_folder_cannot_go_into_itself() {
        let dir = temp_dir("itself");
        let src = dir.join("pack");
        fs::create_dir_all(src.join("inner")).unwrap();
        for mode in [Mode::Copy, Mode::Move] {
            for dest in [src.clone(), src.join("inner")] {
                match run(&[&src], &dest, mode, false).remove(0) {
                    Err(Failure::Failed(message)) => assert!(message.contains("into itself")),
                    _ => panic!("expected a refusal"),
                }
            }
        }
        // And nothing was made inside it
        assert_eq!(fs::read_dir(&src).unwrap().count(), 1);
    }

    #[test]
    fn a_cancelled_copy_leaves_no_half_file() {
        let dir = temp_dir("cancel");
        let dest = dir.join("dest");
        fs::create_dir(&dest).unwrap();
        fs::write(dir.join("big.bin"), vec![7u8; 100_000]).unwrap();
        let cancel = Arc::new(AtomicBool::new(true));
        let mut rep = Reporter::new("test", cancel, Box::new(|_| {}));
        let result = transfer_item(&dir.join("big.bin"), &dest, Mode::Copy, false, &mut rep);
        assert!(matches!(result, Err(Failure::Cancelled)));
        assert_eq!(fs::read_dir(&dest).unwrap().count(), 0);
        assert!(dir.join("big.bin").exists());
    }

    #[test]
    fn a_missing_source_fails_with_a_plain_message() {
        let dir = temp_dir("missing");
        match run(&[&dir.join("gone.txt")], &dir.join("elsewhere"), Mode::Copy, false).remove(0) {
            Err(Failure::Failed(message)) => assert!(message.contains("gone.txt")),
            _ => panic!("expected a failure"),
        }
    }

    #[test]
    fn the_job_loop_reports_each_item_and_the_bytes() {
        let dir = temp_dir("events");
        let dest = dir.join("dest");
        fs::create_dir(&dest).unwrap();
        fs::write(dir.join("a.txt"), b"hello").unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let seen = events.clone();
        let mut rep = Reporter::new("job", Arc::new(AtomicBool::new(false)), Box::new(move |e| seen.lock().unwrap().push((e.status, e.bytes_done))));
        let items = vec![dir.join("a.txt"), dir.join("missing.txt")];
        rep.total = total_size(&items);
        let summary = run_items(&items, &dest, Mode::Copy, false, &mut rep);
        assert_eq!((summary.done, summary.failed), (1, 1));
        let statuses: Vec<_> = events.lock().unwrap().iter().map(|e| e.0).collect();
        assert_eq!(statuses, ["working", "done", "working", "failed"]);
        assert_eq!(rep.total, 5);
        assert_eq!(rep.done, 5);
    }

    #[test]
    fn names_get_numbers_before_the_extension() {
        let dir = temp_dir("names");
        fs::write(dir.join("a.tar.gz"), b"").unwrap();
        fs::write(dir.join(".gitignore"), b"").unwrap();
        fs::create_dir(dir.join("pics")).unwrap();
        assert_eq!(free_name(&dir, "a.tar.gz", false), dir.join("a.tar (1).gz"));
        assert_eq!(free_name(&dir, ".gitignore", false), dir.join(".gitignore (1)"));
        assert_eq!(free_name(&dir, "pics", true), dir.join("pics (1)"));
        assert_eq!(free_name(&dir, "new.txt", false), dir.join("new.txt"));
    }

    #[test]
    fn the_check_lists_clashes_but_not_copies_into_the_same_folder() {
        let dir = temp_dir("check");
        let dest = dir.join("dest");
        fs::create_dir(&dest).unwrap();
        fs::write(dir.join("a.txt"), b"").unwrap();
        fs::write(dir.join("b.txt"), b"").unwrap();
        fs::write(dest.join("a.txt"), b"").unwrap();
        let paths = vec![dir.join("a.txt").display().to_string(), dir.join("b.txt").display().to_string()];
        let check = check_blocking(&paths, &dest.display().to_string(), Mode::Copy).unwrap();
        assert_eq!(check, TransferCheck { conflicts: vec!["a.txt".into()], actionable: 2 });
        let own = check_blocking(&paths, &dir.display().to_string(), Mode::Copy).unwrap();
        assert!(own.conflicts.is_empty());
        assert!(check_blocking(&paths, &dir.join("nope").display().to_string(), Mode::Copy).is_err());
    }

    #[test]
    fn new_folders_get_numbers() {
        let dir = temp_dir("newfolder");
        let (first, _) = reserve(&dir, "New folder", true).ok().unwrap();
        let (second, _) = reserve(&dir, "New folder", true).ok().unwrap();
        assert_eq!(first, dir.join("New folder"));
        assert_eq!(second, dir.join("New folder (1)"));
    }

    #[cfg(not(windows))]
    #[test]
    fn the_clipboard_keeps_files_and_whether_they_were_cut() {
        let files = ClipboardFiles { paths: vec!["/a/b.txt".into()], cut: true };
        clipboard::set(&files).unwrap();
        assert_eq!(clipboard::get().unwrap(), Some(files));
        clipboard::clear().unwrap();
        assert_eq!(clipboard::get().unwrap(), None);
    }
}
