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
pub struct ExtraDrive {
    /// `Z:\`
    pub root: String,
    pub is_network: bool,
    /// `\\server\share` the letter points at, when Windows reports it.
    pub remote: Option<String>,
    pub total_bytes: Option<u64>,
    pub free_bytes: Option<u64>,
    /// Network drive with no space information: disconnected, asleep or too slow.
    pub offline: bool,
}

/// Every drive letter Windows knows about that `known` (the disk listing) does not already cover:
/// mapped network drives (Z: -> \\server\share), subst/virtual drives and drives from third-party
/// file systems. The volume enumeration the disk listing uses skips all of these.
/// Each drive is queried on its own thread and the whole call is capped at `timeout`,
/// so an unreachable share shows as offline instead of freezing the list.
/// Local-type drives that give no size (empty card readers) are left out.
#[cfg(windows)]
pub fn extra_drives(known: &[char], timeout: Duration) -> Vec<ExtraDrive> {
    use std::time::Instant;

    const DRIVE_NO_ROOT_DIR: u32 = 1;
    const DRIVE_REMOTE: u32 = 4;

    enum Msg {
        Remote(usize, Option<String>),
        Space(usize, Option<(u64, u64)>),
    }

    let mask = unsafe { ffi::GetLogicalDrives() };
    let mut drives: Vec<ExtraDrive> = Vec::new();
    let (tx, rx) = mpsc::channel();

    for i in 0..26u8 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let letter = (b'A' + i) as char;
        if known.iter().any(|k| k.eq_ignore_ascii_case(&letter)) {
            continue;
        }
        let root = format!("{}:\\", letter);
        let kind = unsafe { ffi::GetDriveTypeW(ffi::wide(&root).as_ptr()) };
        if kind <= DRIVE_NO_ROOT_DIR {
            continue;
        }
        let is_network = kind == DRIVE_REMOTE;
        let index = drives.len();
        drives.push(ExtraDrive {
            root: root.clone(),
            is_network,
            remote: None,
            total_bytes: None,
            free_bytes: None,
            offline: true,
        });
        let tx = tx.clone();
        thread::spawn(move || {
            if is_network {
                let _ = tx.send(Msg::Remote(index, ffi::remote_name(letter)));
            }
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
    drives.retain(|d| d.is_network || !d.offline);
    drives
}

/// Drive letters Windows remembers for the current user (`HKCU\\Network\\<letter>\\RemotePath`),
/// as (letter, `\\\\server\\share`). Works even when the live drive list is hidden from this process,
/// for example when the app was started elevated and the drive was mapped by the normal user.
#[cfg(windows)]
pub fn remembered_mappings() -> Vec<(char, String)> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("reg")
        .args(["query", "HKCU\\Network", "/s", "/v", "RemotePath"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|out| parse_reg_remote_paths(&String::from_utf8_lossy(&out.stdout)))
        .unwrap_or_default()
}

/// Reads the output of `reg query HKCU\Network /s /v RemotePath`.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn parse_reg_remote_paths(text: &str) -> Vec<(char, String)> {
    let mut found = Vec::new();
    let mut letter: Option<char> = None;
    for line in text.lines() {
        let line = line.trim();
        if let Some(key) = line.strip_prefix("HKEY_CURRENT_USER\\Network\\") {
            let mut chars = key.chars();
            letter = match (chars.next(), chars.next()) {
                (Some(c), None) if c.is_ascii_alphabetic() => Some(c.to_ascii_uppercase()),
                _ => None,
            };
        } else if line.starts_with("RemotePath") {
            let value = line.split_once("REG_SZ").map(|(_, v)| v.trim()).unwrap_or("");
            if let (Some(c), Some(root)) = (letter, unc_share_root(value)) {
                found.push((c, root));
            }
        }
    }
    found
}

/// Network locations added in File Explorer with "Add a network location" (no drive letter):
/// `%APPDATA%\Microsoft\Windows\Network Shortcuts\<name>\target.lnk`. Returns (name, `\\server\share`).
#[cfg(windows)]
pub fn network_shortcuts() -> Vec<(String, String)> {
    let Some(appdata) = std::env::var_os("APPDATA") else {
        return Vec::new();
    };
    let dir = std::path::Path::new(&appdata).join("Microsoft\\Windows\\Network Shortcuts");
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let (name, lnk) = if path.is_dir() {
            (entry.file_name().to_string_lossy().to_string(), path.join("target.lnk"))
        } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk")) {
            (path.file_stem().unwrap_or_default().to_string_lossy().to_string(), path)
        } else {
            continue;
        };
        if let Some(unc) = std::fs::read(&lnk).ok().and_then(|bytes| unc_from_shortcut(&bytes)) {
            found.push((name, unc));
        }
    }
    found.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    found
}

/// First `\\server\share` stored in a .lnk file (as ASCII or UTF-16). A shortcut to a network
/// folder keeps the share name as plain text, so no shell API is needed to read it.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn unc_from_shortcut(bytes: &[u8]) -> Option<String> {
    let accept = |text: String| unc_share_root(&text).map(|_| normalize_input(&text));

    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'\\' && bytes[i + 1] == b'\\' {
            let run: String = bytes[i..]
                .iter()
                .take_while(|b| (0x20..0x7f).contains(*b))
                .map(|&b| b as char)
                .collect();
            if let Some(found) = accept(run.clone()) {
                return Some(found);
            }
            i += run.len().max(2);
        } else {
            i += 1;
        }
    }

    // UTF-16 text can sit at an odd offset, so scan both alignments
    for offset in 0..2 {
        let units: Vec<u16> = bytes[offset.min(bytes.len())..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let mut i = 0;
        while i + 1 < units.len() {
            if units[i] == 0x5c && units[i + 1] == 0x5c {
                let run: String = units[i..]
                    .iter()
                    .take_while(|u| (0x20..0x7f).contains(*u))
                    .map(|&u| u as u8 as char)
                    .collect();
                if let Some(found) = accept(run.clone()) {
                    return Some(found);
                }
                i += run.len().max(2);
            } else {
                i += 1;
            }
        }
    }
    None
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
    fn reads_share_from_shortcut_bytes() {
        let mut ascii = b"L\0\0\0 header junk \0".to_vec();
        ascii.extend_from_slice(b"\\\\mypc\\library\0trailing");
        assert_eq!(unc_from_shortcut(&ascii).as_deref(), Some("\\\\mypc\\library\\"));

        let mut wide = vec![0x4c, 0, 0, 0, 1];
        wide.extend("\\\\nas\\Media\\Raw".encode_utf16().flat_map(|u| u.to_le_bytes()));
        wide.extend([0, 0]);
        assert_eq!(unc_from_shortcut(&wide).as_deref(), Some("\\\\nas\\Media\\Raw"));

        // A bare server name or no UNC text at all is not a share
        assert_eq!(unc_from_shortcut(b"xx\\\\onlyhost\0"), None);
        assert_eq!(unc_from_shortcut(b"C:\\Users\\me"), None);
    }

    #[test]
    fn reads_remembered_drive_mappings() {
        let out = "\r\nHKEY_CURRENT_USER\\Network\\Z\r\n    RemotePath    REG_SZ    \\\\RAJHANSPC\\Library\r\n\r\nHKEY_CURRENT_USER\\Network\\y\r\n    RemotePath    REG_SZ    \\\\nas\\Media\\Raw\r\n\r\nEnd of search: 2 match(es) found.\r\n";
        assert_eq!(
            parse_reg_remote_paths(out),
            vec![('Z', "\\\\RAJHANSPC\\Library\\".to_string()), ('Y', "\\\\nas\\Media\\".to_string())]
        );
        assert!(parse_reg_remote_paths("ERROR: The system was unable to find the specified registry key").is_empty());
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
