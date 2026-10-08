// Signing in to network shares (\\server\share) with a username and password, and remembering the
// password in Windows Credential Manager so the share reconnects on its own after a restart.
// The pure helpers are plain logic so they can be unit tested on any platform.

use std::time::Duration;

/// Prefix on an error message that means "this share needs a username and password".
/// The UI strips it and offers a Connect button instead.
pub const SIGN_IN_MARK: &str = "[sign-in] ";

/// Credential Manager entry name for a share: `CGArtistFileBrowser:\\server\share\`.
/// Share names are not case sensitive, so the name is lower-cased and one share has one entry.
pub fn credential_target(share_root: &str) -> String {
    format!("CGArtistFileBrowser:{}", share_root.to_lowercase())
}

/// Credential Manager entry Windows itself uses to sign in to a PC: the bare server name (`RAJHANSPC`),
/// the same entry File Explorer's "Remember my credentials" writes. With it saved, Windows signs in to every
/// share on that PC on its own, for every program.
pub fn server_credential_target(share_root: &str) -> Option<String> {
    crate::network::unc_host(share_root)
}

/// The password the way Windows stores it: UTF-16 little endian bytes, no terminator.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn password_to_blob(password: &str) -> Vec<u8> {
    password.encode_utf16().flat_map(|u| u.to_le_bytes()).collect()
}

#[cfg_attr(not(windows), allow(dead_code))]
pub fn password_from_blob(blob: &[u8]) -> String {
    let units: Vec<u16> = blob.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    String::from_utf16_lossy(&units)
}

/// Plain-language reason for a failed sign-in (Windows error code from the connect call).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn describe_connect_error(code: u32, share_root: &str) -> String {
    let share = share_root.trim_end_matches('\\');
    match code {
        // ERROR_LOGON_FAILURE, ERROR_INVALID_PASSWORD, ERROR_BAD_USERNAME, ERROR_NO_SUCH_USER,
        // ERROR_LOGON_TYPE_NOT_GRANTED
        1326 | 86 | 2202 | 1317 | 1385 => format!(
            "{}Windows did not accept that username or password for {}. Check them and try again.",
            SIGN_IN_MARK, share
        ),
        // ERROR_SESSION_CREDENTIAL_CONFLICT
        1219 => format!(
            "{}Windows already has a connection to this PC under a different user name. Disconnect it first (in File Explorer, right-click the network drive and choose Disconnect) or use that same user name here.",
            SIGN_IN_MARK
        ),
        // ERROR_BAD_NETPATH, ERROR_BAD_NET_NAME, ERROR_NETWORK_UNREACHABLE, ERROR_REM_NOT_LIST, ERROR_BAD_DEV_TYPE
        53 | 67 | 1231 | 51 | 66 => format!(
            "Can't find {}. Check the PC and share names, and that the PC is on and reachable.",
            share
        ),
        // ERROR_CANCELLED
        1223 => "The sign-in was cancelled.".to_string(),
        _ => format!("Can't connect to {}: {}", share, std::io::Error::from_raw_os_error(code as i32)),
    }
}

#[cfg(windows)]
pub fn connect(share_root: &str, username: &str, password: &str, timeout: Duration) -> Result<(), String> {
    use std::sync::mpsc;
    use std::thread;

    let (tx, rx) = mpsc::channel();
    let (root, user, pass) = (share_root.to_string(), username.to_string(), password.to_string());
    thread::spawn(move || {
        let mut code = ffi::add_connection(&root, &user, &pass);
        if code == 1219 {
            // A saved or earlier connection to this share with other credentials: drop it and sign in again
            ffi::cancel_connection(&root);
            code = ffi::add_connection(&root, &user, &pass);
        }
        let _ = tx.send(code);
    });
    match rx.recv_timeout(timeout) {
        // 0 = signed in; 1219 can also mean "already connected" with these same credentials
        Ok(0) => Ok(()),
        Ok(code) => Err(describe_connect_error(code, share_root)),
        Err(_) => Err(format!(
            "{} did not answer within {} seconds. Check that the PC is on and reachable.",
            share_root.trim_end_matches('\\'),
            timeout.as_secs()
        )),
    }
}

#[cfg(not(windows))]
pub fn connect(_share_root: &str, _username: &str, _password: &str, _timeout: Duration) -> Result<(), String> {
    Err("Signing in to network shares is only available on Windows.".to_string())
}

/// Saves the password in Windows Credential Manager: once under the app's own name (so the app can sign in
/// again itself) and once under the server's name (so Windows signs in on its own, even for other shares
/// on the same PC).
#[cfg(windows)]
pub fn save_password(share_root: &str, username: &str, password: &str) -> Result<(), String> {
    let blob = password_to_blob(password);
    ffi::write_credential(&credential_target(share_root), ffi::CRED_TYPE_GENERIC, username, &blob)?;
    if let Some(server) = server_credential_target(share_root) {
        ffi::write_credential(&server, ffi::CRED_TYPE_DOMAIN_PASSWORD, username, &blob)?;
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn save_password(_share_root: &str, _username: &str, _password: &str) -> Result<(), String> {
    Err("Saving passwords is only available on Windows.".to_string())
}

/// (username, password) saved for a share, if any.
#[cfg(windows)]
pub fn load_password(share_root: &str) -> Option<(String, String)> {
    let (user, blob) = ffi::read_credential(&credential_target(share_root), ffi::CRED_TYPE_GENERIC)?;
    Some((user, password_from_blob(&blob)))
}

#[cfg(not(windows))]
pub fn load_password(_share_root: &str) -> Option<(String, String)> {
    None
}

/// Removes the saved password and drops the live connection to the share. The server-wide entry stays
/// when another saved share on the same PC still needs it (`keep_server_entry`).
#[cfg(windows)]
pub fn forget(share_root: &str, keep_server_entry: bool) {
    ffi::delete_credential(&credential_target(share_root), ffi::CRED_TYPE_GENERIC);
    if !keep_server_entry {
        if let Some(server) = server_credential_target(share_root) {
            ffi::delete_credential(&server, ffi::CRED_TYPE_DOMAIN_PASSWORD);
        }
    }
    ffi::cancel_connection(share_root);
}

#[cfg(not(windows))]
pub fn forget(_share_root: &str, _keep_server_entry: bool) {}

/// Shown when the saved password can no longer be found in Credential Manager.
pub fn missing_password_message(share_root: &str) -> String {
    format!(
        "{}Windows no longer has a saved password for {}. Sign in again.",
        SIGN_IN_MARK,
        share_root.trim_end_matches('\\')
    )
}

/// Signs in again with the saved username and password. Err when nothing is saved or Windows refuses.
pub fn reconnect(share_root: &str, timeout: Duration) -> Result<(), String> {
    let (user, password) = load_password(share_root).ok_or_else(|| missing_password_message(share_root))?;
    connect(share_root, &user, &password, timeout)
}

#[cfg(windows)]
mod ffi {
    use std::ffi::c_void;
    use std::ptr;

    const RESOURCETYPE_DISK: u32 = 1;
    pub const CRED_TYPE_GENERIC: u32 = 1;
    pub const CRED_TYPE_DOMAIN_PASSWORD: u32 = 2;
    const CRED_PERSIST_LOCAL_MACHINE: u32 = 2;
    // Windows refuses credential blobs bigger than 5 * 512 bytes
    const CRED_MAX_CREDENTIAL_BLOB_SIZE: usize = 2560;

    #[repr(C)]
    struct NetResourceW {
        scope: u32,
        kind: u32,
        display_type: u32,
        usage: u32,
        local_name: *mut u16,
        remote_name: *mut u16,
        comment: *mut u16,
        provider: *mut u16,
    }

    #[repr(C)]
    struct CredentialW {
        flags: u32,
        kind: u32,
        target_name: *mut u16,
        comment: *mut u16,
        last_written_low: u32,
        last_written_high: u32,
        credential_blob_size: u32,
        credential_blob: *mut u8,
        persist: u32,
        attribute_count: u32,
        attributes: *mut c_void,
        target_alias: *mut u16,
        user_name: *mut u16,
    }

    #[link(name = "mpr")]
    unsafe extern "system" {
        fn WNetAddConnection2W(resource: *const NetResourceW, password: *const u16, username: *const u16, flags: u32) -> u32;
        fn WNetCancelConnection2W(name: *const u16, flags: u32, force: i32) -> u32;
    }

    #[link(name = "advapi32")]
    unsafe extern "system" {
        fn CredWriteW(credential: *const CredentialW, flags: u32) -> i32;
        fn CredReadW(target_name: *const u16, kind: u32, flags: u32, credential: *mut *mut CredentialW) -> i32;
        fn CredDeleteW(target_name: *const u16, kind: u32, flags: u32) -> i32;
        fn CredFree(buffer: *mut c_void);
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Signs in to `\\server\share` with the given account without giving it a drive letter.
    /// Returns the Windows error code (0 = connected).
    pub fn add_connection(share_root: &str, username: &str, password: &str) -> u32 {
        // The share name goes in without its trailing backslash
        let mut remote = wide(share_root.trim_end_matches('\\'));
        let user = wide(username);
        let pass = wide(password);
        let resource = NetResourceW {
            scope: 0,
            kind: RESOURCETYPE_DISK,
            display_type: 0,
            usage: 0,
            local_name: ptr::null_mut(),
            remote_name: remote.as_mut_ptr(),
            comment: ptr::null_mut(),
            provider: ptr::null_mut(),
        };
        unsafe { WNetAddConnection2W(&resource, pass.as_ptr(), user.as_ptr(), 0) }
    }

    pub fn cancel_connection(share_root: &str) {
        let name = wide(share_root.trim_end_matches('\\'));
        unsafe {
            WNetCancelConnection2W(name.as_ptr(), 0, 1);
        }
    }

    pub fn write_credential(target: &str, kind: u32, username: &str, blob: &[u8]) -> Result<(), String> {
        if blob.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE {
            return Err("That password is too long to save.".to_string());
        }
        let mut target_w = wide(target);
        let mut user_w = wide(username);
        let mut blob = blob.to_vec();
        let credential = CredentialW {
            flags: 0,
            kind,
            target_name: target_w.as_mut_ptr(),
            comment: ptr::null_mut(),
            last_written_low: 0,
            last_written_high: 0,
            credential_blob_size: blob.len() as u32,
            credential_blob: blob.as_mut_ptr(),
            persist: CRED_PERSIST_LOCAL_MACHINE,
            attribute_count: 0,
            attributes: ptr::null_mut(),
            target_alias: ptr::null_mut(),
            user_name: user_w.as_mut_ptr(),
        };
        let ok = unsafe { CredWriteW(&credential, 0) };
        // Don't leave the password lying around in memory longer than needed
        blob.iter_mut().for_each(|b| *b = 0);
        if ok == 0 {
            return Err(format!("Windows could not save the password: {}", std::io::Error::last_os_error()));
        }
        Ok(())
    }

    /// (username, password bytes) of a saved entry.
    pub fn read_credential(target: &str, kind: u32) -> Option<(String, Vec<u8>)> {
        let target_w = wide(target);
        let mut found: *mut CredentialW = ptr::null_mut();
        let ok = unsafe { CredReadW(target_w.as_ptr(), kind, 0, &mut found) };
        if ok == 0 || found.is_null() {
            return None;
        }
        let result = unsafe {
            let cred = &*found;
            let user = if cred.user_name.is_null() {
                String::new()
            } else {
                let mut len = 0;
                while *cred.user_name.add(len) != 0 {
                    len += 1;
                }
                String::from_utf16_lossy(std::slice::from_raw_parts(cred.user_name, len))
            };
            let blob = if cred.credential_blob.is_null() || cred.credential_blob_size == 0 {
                Vec::new()
            } else {
                std::slice::from_raw_parts(cred.credential_blob, cred.credential_blob_size as usize).to_vec()
            };
            CredFree(found as *mut c_void);
            (user, blob)
        };
        Some(result)
    }

    pub fn delete_credential(target: &str, kind: u32) {
        let target_w = wide(target);
        // Nothing saved under that name is fine, so the result is not checked
        unsafe {
            CredDeleteW(target_w.as_ptr(), kind, 0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_credential_name_per_share() {
        assert_eq!(credential_target("\\\\RAJHANSPC\\Library\\"), "CGArtistFileBrowser:\\\\rajhanspc\\library\\");
        assert_eq!(credential_target("\\\\rajhanspc\\library\\"), credential_target("\\\\RAJHANSPC\\LIBRARY\\"));
    }

    #[test]
    fn windows_signs_in_by_server_name() {
        assert_eq!(server_credential_target("\\\\RAJHANSPC\\Library\\").as_deref(), Some("RAJHANSPC"));
        assert_eq!(server_credential_target("C:\\x"), None);
    }

    #[test]
    fn password_survives_the_blob_round_trip() {
        for pw in ["hunter2", "pässwörd ✓", "", "a b\"c'd\\e"] {
            assert_eq!(password_from_blob(&password_to_blob(pw)), pw);
        }
        assert_eq!(password_to_blob("ab"), vec![b'a', 0, b'b', 0]);
    }

    #[test]
    fn explains_sign_in_failures() {
        let share = "\\\\mypc\\library\\";
        assert!(describe_connect_error(1326, share).starts_with(SIGN_IN_MARK));
        assert!(describe_connect_error(1326, share).contains("username or password"));
        assert!(describe_connect_error(1219, share).contains("different user name"));
        assert!(describe_connect_error(53, share).starts_with("Can't find \\\\mypc\\library."));
        assert!(!describe_connect_error(53, share).starts_with(SIGN_IN_MARK));
        assert!(describe_connect_error(4711, share).starts_with("Can't connect to"));
    }

    #[cfg(not(windows))]
    #[test]
    fn sign_in_needs_windows() {
        assert!(connect("\\\\mypc\\library\\", "me", "pw", Duration::from_secs(1)).is_err());
        assert!(load_password("\\\\mypc\\library\\").is_none());
    }
}
