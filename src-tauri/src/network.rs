// Network drives and UNC paths (\\server\share) on Windows.
// The path helpers are plain string logic so they can be unit tested on any platform.

use std::io::ErrorKind;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// Turns what a user typed into the form Windows expects:
/// `//mypc/library` -> `\\mypc\library\`, `"C:/Users/me/"` -> `C:\Users\me`,
/// `\\?\UNC\nas\share\x` -> `\\nas\share\x`.
pub fn normalize_input(input: &str) -> String {
    let trimmed = input.trim().trim_matches(|c| c == '"' || c == '\'').trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let mut s = trimmed.replace('/', "\\");
    if let Some(rest) = s.strip_prefix("\\\\?\\UNC\\") {
        s = format!("\\\\{}", rest);
    } else if let Some(rest) = s.strip_prefix("\\\\?\\") {
        s = rest.to_string();
    }

    if s.starts_with("\\\\") && !s.starts_with("\\\\.\\") {
        return join_unc(&unc_parts(&s));
    }

    // Drive paths: "z:" -> "Z:\", collapse repeated separators, drop the trailing one.
    let bytes = s.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        let letter = (bytes[0] as char).to_ascii_uppercase();
        let rest: Vec<&str> = s[2..].split('\\').filter(|p| !p.is_empty()).collect();
        return if rest.is_empty() {
            format!("{}:\\", letter)
        } else {
            format!("{}:\\{}", letter, rest.join("\\"))
        };
    }
    s
}

fn unc_parts(path: &str) -> Vec<String> {
    path.split('\\').filter(|p| !p.is_empty()).map(str::to_string).collect()
}

fn join_unc(parts: &[String]) -> String {
    match parts.len() {
        0 => "\\\\".to_string(),
        1 => format!("\\\\{}", parts[0]),
        // A share root keeps its trailing separator, like a drive root ("J:\").
        2 => format!("\\\\{}\\{}\\", parts[0], parts[1]),
        _ => format!("\\\\{}", parts.join("\\")),
    }
}

pub fn is_unc(path: &str) -> bool {
    let n = normalize_input(path);
    n.starts_with("\\\\") && !n.starts_with("\\\\.\\")
}

/// `\\host\share\a\b` -> `\\host\share\`. None for non-UNC paths or a bare `\\host`.
pub fn unc_share_root(path: &str) -> Option<String> {
    let n = normalize_input(path);
    if !is_unc(&n) {
        return None;
    }
    let parts = unc_parts(&n);
    (parts.len() >= 2).then(|| join_unc(&parts[..2]))
}

/// Parent of a UNC path. A share root has no parent: Windows can't list a server's shares
/// through a path, so navigation stops at `\\host\share\`.
pub fn unc_parent(path: &str) -> Option<String> {
    let n = normalize_input(path);
    if !is_unc(&n) {
        return None;
    }
    let parts = unc_parts(&n);
    (parts.len() > 2).then(|| join_unc(&parts[..parts.len() - 1]))
}

/// Plain-language reason for a failed access to a network path.
pub fn describe_os_error(code: Option<i32>, kind: ErrorKind, path: &str) -> String {
    match code {
        // ERROR_BAD_NETPATH, ERROR_BAD_NET_NAME, ERROR_NETWORK_UNREACHABLE
        Some(53) | Some(67) | Some(1231) | Some(1203) => format!(
            "Can't find {}. Check the PC and share names, and that the PC is on and reachable.",
            path
        ),
        // ERROR_ACCESS_DENIED, ERROR_LOGON_FAILURE, ERROR_SESSION_CREDENTIAL_CONFLICT, ERROR_NOT_AUTHENTICATED
        Some(5) | Some(1326) | Some(1219) | Some(1244) => format!(
            "Windows refused access to {}. Open it once in File Explorer and save the credentials, then try again.",
            path
        ),
        // ERROR_SEM_TIMEOUT, ERROR_NETNAME_DELETED, ERROR_UNEXP_NET_ERR
        Some(121) | Some(64) | Some(59) => format!("{} stopped responding. Check the network connection.", path),
        _ if kind == ErrorKind::NotFound => format!("Folder not found: {}", path),
        _ if kind == ErrorKind::PermissionDenied => format!("No permission to open {}", path),
        _ => format!("Can't open {}: {}", path, std::io::Error::from(kind)),
    }
}

/// Checks that a path is reachable without ever blocking longer than `timeout`:
/// a dead share can otherwise hang a filesystem call for a minute or more.
/// Ok(true) = folder, Ok(false) = file.
pub fn probe(path: &str, timeout: Duration) -> Result<bool, String> {
    let (tx, rx) = mpsc::channel();
    let target = path.to_string();
    thread::spawn(move || {
        let _ = tx.send(std::fs::metadata(&target).map(|m| m.is_dir()));
    });
    match rx.recv_timeout(timeout) {
        Ok(Ok(is_dir)) => Ok(is_dir),
        Ok(Err(e)) => Err(describe_os_error(e.raw_os_error(), e.kind(), path)),
        Err(_) => Err(format!(
            "{} did not answer within {} seconds. Check the network connection.",
            path,
            timeout.as_secs()
        )),
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
pub struct MappedDrive {
    /// `Z:\`
    pub root: String,
    /// `\\server\share` the letter points at, when Windows reports it.
    pub remote: Option<String>,
    pub total_bytes: Option<u64>,
    pub free_bytes: Option<u64>,
    /// No space information came back: disconnected, asleep or too slow.
    pub offline: bool,
}

/// Drive letters mapped to network shares (what File Explorer shows under "Network locations").
/// The volume enumeration the disk listing uses skips these entirely.
/// Every drive is queried on its own thread and the whole call is capped at `timeout`,
/// so an unreachable share shows as offline instead of freezing the list.
#[cfg(windows)]
pub fn mapped_network_drives(timeout: Duration) -> Vec<MappedDrive> {
    use std::time::Instant;

    const DRIVE_REMOTE: u32 = 4;

    enum Msg {
        Remote(usize, Option<String>),
        Space(usize, Option<(u64, u64)>),
    }

    let mask = unsafe { ffi::GetLogicalDrives() };
    let mut drives: Vec<MappedDrive> = Vec::new();
    let (tx, rx) = mpsc::channel();

    for i in 0..26u8 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let letter = (b'A' + i) as char;
        let root = format!("{}:\\", letter);
        if unsafe { ffi::GetDriveTypeW(ffi::wide(&root).as_ptr()) } != DRIVE_REMOTE {
            continue;
        }
        let index = drives.len();
        drives.push(MappedDrive {
            root: root.clone(),
            remote: None,
            total_bytes: None,
            free_bytes: None,
            offline: true,
        });
        let tx = tx.clone();
        thread::spawn(move || {
            let _ = tx.send(Msg::Remote(index, ffi::remote_name(letter)));
            let _ = tx.send(Msg::Space(index, ffi::disk_space(&root)));
        });
    }
    drop(tx);

    let deadline = Instant::now() + timeout;
    let mut pending = drives.len();
    while pending > 0 {
        let left = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(left) {
            Ok(Msg::Remote(i, remote)) => drives[i].remote = remote,
            Ok(Msg::Space(i, space)) => {
                pending -= 1;
                if let Some((total, free)) = space {
                    drives[i].total_bytes = Some(total);
                    drives[i].free_bytes = Some(free);
                    drives[i].offline = false;
                }
            }
            Err(_) => break,
        }
    }
    drives
}

#[cfg(windows)]
mod ffi {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        pub fn GetLogicalDrives() -> u32;
        pub fn GetDriveTypeW(root_path_name: *const u16) -> u32;
        fn GetDiskFreeSpaceExW(
            directory_name: *const u16,
            free_bytes_available: *mut u64,
            total_number_of_bytes: *mut u64,
            total_number_of_free_bytes: *mut u64,
        ) -> i32;
    }

    #[link(name = "mpr")]
    unsafe extern "system" {
        fn WNetGetConnectionW(local_name: *const u16, remote_name: *mut u16, length: *mut u32) -> u32;
    }

    pub fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn remote_name(letter: char) -> Option<String> {
        let local = wide(&format!("{}:", letter));
        let mut buf = vec![0u16; 1024];
        let mut len = buf.len() as u32;
        let status = unsafe { WNetGetConnectionW(local.as_ptr(), buf.as_mut_ptr(), &mut len) };
        if status != 0 {
            return None;
        }
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        let name = String::from_utf16_lossy(&buf[..end]);
        (!name.is_empty()).then_some(name)
    }

    /// (total bytes, free bytes)
    pub fn disk_space(root: &str) -> Option<(u64, u64)> {
        let (mut available, mut total, mut free) = (0u64, 0u64, 0u64);
        let ok = unsafe { GetDiskFreeSpaceExW(wide(root).as_ptr(), &mut available, &mut total, &mut free) };
        (ok != 0).then_some((total, available))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_unc_input() {
        assert_eq!(normalize_input("//mypc/library"), "\\\\mypc\\library\\");
        assert_eq!(normalize_input("\\\\mypc\\library"), "\\\\mypc\\library\\");
        assert_eq!(normalize_input("\\\\mypc\\library\\"), "\\\\mypc\\library\\");
        assert_eq!(normalize_input("//mypc/library/Assets/"), "\\\\mypc\\library\\Assets");
        assert_eq!(normalize_input("  \"\\\\NAS\\Share\\My Files\\\"  "), "\\\\NAS\\Share\\My Files");
        assert_eq!(normalize_input("////mypc//library//a//b"), "\\\\mypc\\library\\a\\b");
        assert_eq!(normalize_input("\\\\?\\UNC\\nas\\share\\x"), "\\\\nas\\share\\x");
        assert_eq!(normalize_input("\\\\mypc"), "\\\\mypc");
        assert_eq!(normalize_input(""), "");
    }

    #[test]
    fn normalizes_drive_input() {
        assert_eq!(normalize_input("z:"), "Z:\\");
        assert_eq!(normalize_input("C:/Users/me/"), "C:\\Users\\me");
        assert_eq!(normalize_input("D:\\\\Projects\\\\x"), "D:\\Projects\\x");
        assert_eq!(normalize_input("\\\\?\\C:\\Temp"), "C:\\Temp");
        assert_eq!(normalize_input("J:\\"), "J:\\");
    }

    #[test]
    fn detects_unc() {
        assert!(is_unc("//mypc/library"));
        assert!(is_unc("\\\\mypc\\library\\a"));
        assert!(!is_unc("C:\\Users"));
        assert!(!is_unc("/home/me"));
        assert!(!is_unc("\\\\.\\COM1"));
    }

    #[test]
    fn finds_share_root_and_parent() {
        assert_eq!(unc_share_root("\\\\mypc\\library\\a\\b").as_deref(), Some("\\\\mypc\\library\\"));
        assert_eq!(unc_share_root("\\\\mypc"), None);
        assert_eq!(unc_share_root("C:\\x"), None);

        assert_eq!(unc_parent("\\\\mypc\\library\\a\\b").as_deref(), Some("\\\\mypc\\library\\a"));
        assert_eq!(unc_parent("\\\\mypc\\library\\a").as_deref(), Some("\\\\mypc\\library\\"));
        assert_eq!(unc_parent("\\\\mypc\\library\\"), None);
        assert_eq!(unc_parent("C:\\x"), None);
    }

    #[test]
    fn explains_common_errors() {
        let p = "\\\\mypc\\library";
        assert!(describe_os_error(Some(53), ErrorKind::NotFound, p).starts_with("Can't find"));
        assert!(describe_os_error(Some(1326), ErrorKind::Other, p).contains("credentials"));
        assert!(describe_os_error(Some(5), ErrorKind::PermissionDenied, p).contains("credentials"));
        assert!(describe_os_error(None, ErrorKind::NotFound, p).starts_with("Folder not found"));
    }

    #[test]
    fn probe_reports_folders_files_and_missing() {
        let dir = std::env::temp_dir();
        assert_eq!(probe(dir.to_str().unwrap(), Duration::from_secs(5)), Ok(true));
        let missing = dir.join("definitely-missing-folder-9f3a");
        assert!(probe(missing.to_str().unwrap(), Duration::from_secs(5)).is_err());
    }
}
