// In-app updates: Settings > Updates and the once-a-day check (docs/UPDATES.md).
//
// The release manifest (latest.json) comes from the endpoints in tauri.conf.json > plugins.updater. The
// downloaded file must carry a valid signature from the release key (its public half is in tauri.conf.json),
// and that signature also names the version it was made for (requireSignedVersion), so a tampered file, a
// file from someone else or an older release passed off as a newer one is refused before anything changes.
// Only a newer, final (not beta) version is offered, so the app never goes backwards on its own.
//
// Installed build: the signed NSIS installer runs in passive mode (progress bar only) and opens the app again.
// Portable build: the exe is replaced in place. The old exe is kept as "<name>.old" until the new one has
// opened its window; if the new one does not start, the old one is put back and keeps running.
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Error as UpdaterError, Update, UpdaterExt};

/// Manifest key of the installer build. The standard Tauri key, so a stock latest.json works too.
const TARGET_INSTALLED: &str = "windows-x86_64";
/// Manifest key of the portable exe.
const TARGET_PORTABLE: &str = "windows-x86_64-portable";
/// Passed to a freshly swapped-in portable exe: the file it creates once its window is up.
const READY_ARG: &str = "--update-ready=";
/// Kept in the app data folder between the old and the new version, so the new one can say what happened.
const STATE_FILE: &str = "update-state.json";
/// How long the old portable exe waits for the new one to open its window before it closes anyway.
const READY_WAIT: Duration = Duration::from_secs(45);
/// A state file older than this is left over from something else and is ignored.
const STATE_MAX_AGE_SECS: u64 = 3 * 24 * 3600;

static READY_MARKER: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Reads the startup arguments once, before the window opens.
pub fn init_from_args() {
    let marker = std::env::args()
        .find_map(|a| a.strip_prefix(READY_ARG).map(PathBuf::from))
        .filter(|p| !p.as_os_str().is_empty());
    let _ = READY_MARKER.set(marker);
}

#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<Update>>,
    busy: AtomicBool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    /// `tauri dev`: checking works, installing does not
    Dev,
    /// Installed with the setup exe (uninstall.exe sits next to the app)
    Installed,
    /// The portable exe, run from any folder
    Portable,
}

impl Kind {
    fn current() -> Kind {
        if cfg!(debug_assertions) {
            return Kind::Dev;
        }
        let installed = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("uninstall.exe").exists()))
            .unwrap_or(false);
        if installed {
            Kind::Installed
        } else {
            Kind::Portable
        }
    }

    fn name(self) -> &'static str {
        match self {
            Kind::Dev => "dev",
            Kind::Installed => "installed",
            Kind::Portable => "portable",
        }
    }

    fn target(self) -> &'static str {
        match self {
            Kind::Portable => TARGET_PORTABLE,
            _ => TARGET_INSTALLED,
        }
    }
}

// ---------- settings read from tauri.conf.json ----------

struct Setup {
    pubkey: String,
    endpoints: Vec<String>,
}

fn setup(app: &AppHandle) -> Setup {
    let cfg = app.config().plugins.0.get("updater");
    let pubkey = cfg
        .and_then(|c| c.get("pubkey"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let endpoints = cfg
        .and_then(|c| c.get("endpoints"))
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    Setup { pubkey, endpoints }
}

impl Setup {
    fn configured(&self) -> bool {
        !self.pubkey.is_empty() && !self.endpoints.is_empty()
    }

    /// The page people can download from by hand: the releases page of the first GitHub endpoint.
    fn releases_page(&self) -> Option<String> {
        self.endpoints.iter().find_map(|e| releases_page(e))
    }
}

/// `https://github.com/o/r/releases/latest/download/latest.json` -> `https://github.com/o/r/releases/latest`
fn releases_page(endpoint: &str) -> Option<String> {
    let idx = endpoint.find("/releases/")?;
    if !endpoint.starts_with("https://") {
        return None;
    }
    Some(format!("{}/releases/latest", &endpoint[..idx]))
}

// ---------- plain-words errors ----------

const NOT_CONFIGURED: &str = "Updates are not set up in this build of the app.";

fn explain(err: UpdaterError) -> String {
    match err {
        UpdaterError::ReleaseNotFound => {
            "No update information was found online. The download page may be private or the release is still being published. Try again later.".into()
        }
        UpdaterError::Reqwest(e) => {
            if e.is_timeout() {
                "The update server took too long to answer. Check your internet connection and try again.".into()
            } else {
                "Can't reach the update server. Check your internet connection (or proxy) and try again.".into()
            }
        }
        UpdaterError::Network(msg) => format!("The download failed ({msg}). Nothing was changed. Try again later."),
        UpdaterError::Minisign(_) | UpdaterError::Base64(_) | UpdaterError::SignatureUtf8(_) => {
            "The download did not pass the safety check (its signature is not from us), so it was not installed. Your current version is unchanged.".into()
        }
        UpdaterError::SignedVersionMismatch { .. } | UpdaterError::MissingSignedVersion => {
            "The download is signed for a different version than announced, so it was not installed. Your current version is unchanged.".into()
        }
        UpdaterError::TargetNotFound(_) | UpdaterError::TargetsNotFound(_) => {
            "A new version is out, but not yet for this kind of build. Try again later or get it from the download page.".into()
        }
        UpdaterError::InvalidUpdaterFormat => {
            "The downloaded file is not a Windows program, so it was not installed. Your current version is unchanged.".into()
        }
        UpdaterError::Serialization(_) | UpdaterError::Semver(_) => {
            "The update information online could not be read. Try again later.".into()
        }
        UpdaterError::Io(e) => format!("The update could not be saved on this PC ({e}). Nothing was changed."),
        other => format!("The update did not work ({other}). Nothing was changed."),
    }
}

// ---------- what the old version leaves for the new one ----------

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HandOver {
    from: String,
    to: String,
    kind: String,
    notes: Option<String>,
    /// The old portable exe, deleted once the new one runs
    backup: Option<PathBuf>,
    at: u64,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn state_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    let _ = fs::create_dir_all(&dir);
    Some(dir.join(STATE_FILE))
}

fn write_handover(app: &AppHandle, h: &HandOver) {
    if let (Some(path), Ok(json)) = (state_path(app), serde_json::to_vec_pretty(h)) {
        let _ = fs::write(path, json);
    }
}

fn take_handover(app: &AppHandle) -> Option<HandOver> {
    let path = state_path(app)?;
    let bytes = fs::read(&path).ok()?;
    let _ = fs::remove_file(&path);
    let h: HandOver = serde_json::from_slice(&bytes).ok()?;
    (now_secs().saturating_sub(h.at) <= STATE_MAX_AGE_SECS).then_some(h)
}

// ---------- commands ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    kind: &'static str,
    configured: bool,
    releases_page: Option<String>,
}

/// IPC: version, build kind and whether updates are set up.
#[tauri::command]
pub fn update_info(app: AppHandle) -> UpdateInfo {
    let s = setup(&app);
    UpdateInfo {
        current_version: app.package_info().version.to_string(),
        kind: Kind::current().name(),
        configured: s.configured(),
        releases_page: s.releases_page(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFound {
    version: String,
    current_version: String,
    date: Option<String>,
    notes: Option<String>,
}

/// IPC: asks the endpoints for a newer version. `None` means this is the latest.
#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<Option<UpdateFound>, String> {
    if !setup(&app).configured() {
        return Err(NOT_CONFIGURED.into());
    }
    let updater = app
        .updater_builder()
        .target(Kind::current().target())
        .timeout(Duration::from_secs(20))
        // Newer and final only: never a downgrade, never a beta
        .version_comparator(|current, remote| {
            remote.version > current && remote.version.pre.is_empty()
        })
        // The download has no overall time limit (big file, slow line) but gives up when it stalls
        .configure_client(|c| {
            c.connect_timeout(Duration::from_secs(15))
                .read_timeout(Duration::from_secs(60))
        })
        .build()
        .map_err(explain)?;
    let found = updater.check().await.map_err(explain)?;
    let answer = found.as_ref().map(|u| UpdateFound {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        date: u.date.map(|d| d.date().to_string()),
        notes: u.body.clone().filter(|n| !n.trim().is_empty()),
    });
    *state.pending.lock().unwrap_or_else(|e| e.into_inner()) = found;
    Ok(answer)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    stage: &'static str,
    downloaded: u64,
    total: Option<u64>,
}

/// IPC: downloads the version found by `update_check`, checks it and installs it. On success the app closes
/// (and opens again on the new version), so this only returns with an error.
#[tauri::command]
pub async fn update_install(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err("An update is already being installed.".into());
    }
    let pending = state
        .pending
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let result = install(&app, pending).await;
    state.busy.store(false, Ordering::SeqCst);
    result
}

async fn install(app: &AppHandle, pending: Option<Update>) -> Result<(), String> {
    let update = pending.ok_or("Check for updates first.")?;
    let kind = Kind::current();
    if kind == Kind::Dev {
        return Err("Updates are not installed from a development build.".into());
    }

    let exe = std::env::current_exe()
        .map_err(|e| format!("The app could not find its own file ({e})."))?;
    if kind == Kind::Portable {
        // Find out before a long download whether the exe can be replaced at all
        let dir = exe
            .parent()
            .ok_or("The app could not find its own folder.")?;
        if !portable::dir_writable(dir) {
            return Err(format!(
                "The folder {} can't be written to, so the portable app can't replace itself. Move it to a folder you own (for example Documents) or get the new version from the download page.",
                dir.display()
            ));
        }
    }

    let emitter = app.clone();
    let mut downloaded: u64 = 0;
    let mut last = Instant::now() - Duration::from_secs(1);
    let bytes = update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                if last.elapsed() >= Duration::from_millis(120) || total == Some(downloaded) {
                    last = Instant::now();
                    let _ = emitter.emit(
                        "update-progress",
                        Progress {
                            stage: "download",
                            downloaded,
                            total,
                        },
                    );
                }
            },
            || {},
        )
        .await
        .map_err(explain)?;
    let _ = app.emit(
        "update-progress",
        Progress {
            stage: "install",
            downloaded: bytes.len() as u64,
            total: Some(bytes.len() as u64),
        },
    );

    let mut handover = HandOver {
        from: update.current_version.clone(),
        to: update.version.clone(),
        kind: kind.name().into(),
        notes: update.body.clone(),
        backup: None,
        at: now_secs(),
    };

    match kind {
        Kind::Installed => {
            write_handover(app, &handover);
            // Runs the installer and closes the app; it only comes back when the installer could not start
            update.install(&bytes).map_err(|e| {
                if let Some(p) = state_path(app) {
                    let _ = fs::remove_file(p);
                }
                explain(e)
            })
        }
        _ => {
            let swap = portable::swap(&exe, &bytes, &update.current_version, &update.version)?;
            handover.backup = Some(swap.backup.clone());
            write_handover(app, &handover);
            let app2 = app.clone();
            let outcome =
                tauri::async_runtime::spawn_blocking(move || portable::restart(&app2, &swap))
                    .await
                    .map_err(|e| format!("The update stopped unexpectedly ({e})."))?;
            if outcome.is_err()
                && let Some(p) = state_path(app)
            {
                let _ = fs::remove_file(p);
            }
            outcome
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupReport {
    /// "updated" or "failed"
    status: &'static str,
    from: String,
    to: String,
    notes: Option<String>,
}

/// IPC: called once when the window has loaded. Tells a waiting old portable exe that this one started,
/// removes the old exe and reports whether the last update went through.
#[tauri::command]
pub fn update_startup(app: AppHandle) -> Option<StartupReport> {
    if let Some(Some(marker)) = READY_MARKER.get() {
        let _ = fs::write(marker, b"ready");
    }
    let h = take_handover(&app)?;
    let me = app.package_info().version.to_string();
    if me == h.to
        && let Some(backup) = h.backup.clone()
    {
        portable::remove_later(backup);
    }
    if me == h.to {
        Some(StartupReport {
            status: "updated",
            from: h.from,
            to: h.to,
            notes: h.notes,
        })
    } else if me == h.from {
        Some(StartupReport {
            status: "failed",
            from: h.from,
            to: h.to,
            notes: None,
        })
    } else {
        None
    }
}

// ---------- portable exe swap ----------

mod portable {
    use super::*;

    pub struct Swap {
        /// Where the old exe was
        pub old_path: PathBuf,
        /// Where the new exe is now (the same path, or the name with the new version in it)
        pub new_path: PathBuf,
        /// The old exe, renamed
        pub backup: PathBuf,
    }

    pub fn dir_writable(dir: &Path) -> bool {
        let probe = dir.join(format!(".update-write-test-{}", std::process::id()));
        let ok = fs::write(&probe, b"x").is_ok();
        let _ = fs::remove_file(&probe);
        ok
    }

    /// A versioned portable name keeps saying the right version: "...-v1.25.0-Portable.exe" becomes
    /// "...-v1.26.0-Portable.exe". Any other name (for example "...-Portable.exe") stays, so shortcuts keep working.
    pub fn new_file_name(old_name: &str, from: &str, to: &str) -> String {
        let tag = format!("v{from}");
        if !from.is_empty() && old_name.contains(&tag) {
            old_name.replacen(&tag, &format!("v{to}"), 1)
        } else {
            old_name.to_string()
        }
    }

    /// Writes the new exe next to the old one, then swaps them. Windows lets a running exe be renamed (not
    /// deleted), so the running one becomes the backup. Any failure puts everything back as it was.
    pub fn swap(exe: &Path, bytes: &[u8], from: &str, to: &str) -> Result<Swap, String> {
        if !bytes.starts_with(b"MZ") {
            return Err(
                "The downloaded file is not a Windows program, so it was not installed.".into(),
            );
        }
        let dir = exe
            .parent()
            .ok_or("The app could not find its own folder.")?;
        let old_name = exe
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("The app's file name could not be read.")?;
        let new_path = dir.join(new_file_name(old_name, from, to));
        let temp = dir.join(format!(".{old_name}.update-{to}.tmp"));

        write_synced(&temp, bytes).map_err(|e| {
            let _ = fs::remove_file(&temp);
            format!(
                "The new version could not be saved next to the app ({e}). Nothing was changed."
            )
        })?;

        // Free name for the backup: "<name>.old", or "<name>.old-<time>" when an older one is still locked
        let mut backup = dir.join(format!("{old_name}.old"));
        if backup.exists() && fs::remove_file(&backup).is_err() {
            backup = dir.join(format!("{old_name}.old-{}", now_secs()));
        }

        if let Err(e) = fs::rename(exe, &backup) {
            let _ = fs::remove_file(&temp);
            return Err(format!(
                "The app file could not be replaced ({e}). Nothing was changed."
            ));
        }
        // A different target name must not overwrite an unrelated file
        if new_path != exe && new_path.exists() && fs::remove_file(&new_path).is_err() {
            let _ = fs::rename(&backup, exe);
            let _ = fs::remove_file(&temp);
            return Err(format!(
                "{} is in use, so the update was not installed. Nothing was changed.",
                new_path.display()
            ));
        }
        if let Err(e) = fs::rename(&temp, &new_path) {
            let _ = fs::rename(&backup, exe);
            let _ = fs::remove_file(&temp);
            return Err(format!(
                "The new version could not be put in place ({e}). Nothing was changed."
            ));
        }
        Ok(Swap {
            old_path: exe.to_path_buf(),
            new_path,
            backup,
        })
    }

    fn write_synced(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        use std::io::Write;
        let mut f = fs::File::create(path)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        let written = fs::metadata(path)?.len();
        if written != bytes.len() as u64 {
            return Err(std::io::Error::other("the file on disk is incomplete"));
        }
        Ok(())
    }

    /// Puts the old exe back after a failed start.
    pub fn undo(swap: &Swap) -> bool {
        let _ = fs::remove_file(&swap.new_path);
        fs::rename(&swap.backup, &swap.old_path).is_ok()
    }

    /// Starts the new exe and waits until it has opened its window. If it closes before that, the old exe is
    /// put back and this one keeps running. On success this app closes.
    pub fn restart(app: &AppHandle, swap: &Swap) -> Result<(), String> {
        let marker = std::env::temp_dir().join(format!(
            "cg-artist-file-browser-update-{}.ready",
            std::process::id()
        ));
        let _ = fs::remove_file(&marker);

        let mut cmd = Command::new(&swap.new_path);
        cmd.arg(format!("{READY_ARG}{}", marker.display()));
        if let Some(dir) = swap.new_path.parent() {
            cmd.current_dir(dir);
        }
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let restored = undo(swap);
                return Err(failed_start(
                    &format!("could not be started ({e})"),
                    restored,
                ));
            }
        };

        let window = app.get_webview_window("main");
        if let Some(w) = &window {
            let _ = w.hide();
        }
        let started = Instant::now();
        loop {
            if marker.exists() {
                break;
            }
            match child.try_wait() {
                Ok(Some(_)) => {
                    let restored = undo(swap);
                    if let Some(w) = &window {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                    let _ = fs::remove_file(&marker);
                    return Err(failed_start("closed right after it started", restored));
                }
                Ok(None) => {}
                Err(_) => break,
            }
            // Slow PC or antivirus scan: the new one is still running, so let it carry on
            if started.elapsed() >= READY_WAIT {
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        let _ = fs::remove_file(&marker);
        app.exit(0);
        Ok(())
    }

    fn failed_start(what: &str, restored: bool) -> String {
        if restored {
            format!(
                "The new version {what}, so the update was undone. You are still on this version."
            )
        } else {
            format!(
                "The new version {what}, and the old app file could not be put back. Get the app again from the download page."
            )
        }
    }

    /// Deletes the old exe once the process that ran it has fully closed (it can take a moment).
    pub fn remove_later(backup: PathBuf) {
        std::thread::spawn(move || {
            for _ in 0..40 {
                if !backup.exists() || fs::remove_file(&backup).is_ok() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versioned_portable_names_follow_the_version() {
        assert_eq!(
            portable::new_file_name(
                "CG-Artist-File-Browser-v1.25.0-Portable.exe",
                "1.25.0",
                "1.26.0"
            ),
            "CG-Artist-File-Browser-v1.26.0-Portable.exe"
        );
        assert_eq!(
            portable::new_file_name("CG-Artist-File-Browser-Portable.exe", "1.25.0", "1.26.0"),
            "CG-Artist-File-Browser-Portable.exe"
        );
        assert_eq!(
            portable::new_file_name("my copy.exe", "1.25.0", "1.26.0"),
            "my copy.exe"
        );
    }

    #[test]
    fn releases_page_comes_from_a_github_endpoint() {
        assert_eq!(
            releases_page("https://github.com/o/r/releases/latest/download/latest.json").as_deref(),
            Some("https://github.com/o/r/releases/latest")
        );
        assert_eq!(releases_page("https://example.com/latest.json"), None);
        assert_eq!(
            releases_page("http://github.com/o/r/releases/latest/download/latest.json"),
            None
        );
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("cgafb-update-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn swap_replaces_the_exe_and_keeps_a_backup() {
        let dir = temp_dir("swap");
        let exe = dir.join("App-v1.0.0-Portable.exe");
        fs::write(&exe, b"MZ old").unwrap();
        let swap = portable::swap(&exe, b"MZ new", "1.0.0", "1.1.0").unwrap();
        assert_eq!(swap.new_path, dir.join("App-v1.1.0-Portable.exe"));
        assert_eq!(fs::read(&swap.new_path).unwrap(), b"MZ new");
        assert_eq!(fs::read(&swap.backup).unwrap(), b"MZ old");
        assert!(!exe.exists());
        // and undo puts the old one back
        assert!(portable::undo(&swap));
        assert_eq!(fs::read(&exe).unwrap(), b"MZ old");
        assert!(!swap.new_path.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn swap_refuses_a_file_that_is_not_a_program() {
        let dir = temp_dir("notexe");
        let exe = dir.join("App.exe");
        fs::write(&exe, b"MZ old").unwrap();
        assert!(portable::swap(&exe, b"<html>", "1.0.0", "1.1.0").is_err());
        assert_eq!(fs::read(&exe).unwrap(), b"MZ old");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        let _ = fs::remove_dir_all(&dir);
    }
}
