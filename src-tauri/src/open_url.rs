// Opens a web or mail link from a Markdown document in the default browser or mail program.
// Only http, https and mailto links go through; anything else (file:, javascript:, ms-settings: and so on) is refused.
use std::process::Command;

// Whether `url` is a plain http(s) or mailto link without spaces or control characters.
fn is_openable_url(url: &str) -> bool {
    if url.len() > 4096 || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    let lower = url.to_ascii_lowercase();
    let rest = if let Some(rest) = lower.strip_prefix("https://") {
        rest
    } else if let Some(rest) = lower.strip_prefix("http://") {
        rest
    } else if let Some(rest) = lower.strip_prefix("mailto:") {
        rest
    } else {
        return false;
    };
    !rest.is_empty()
}

// IPC: Opens a link in the default browser (or mail program for mailto:). Errors come back as a sentence to show.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !is_openable_url(&url) {
        return Err("Only web and e-mail links can be opened from here.".to_string());
    }

    #[cfg(target_os = "windows")]
    let started = Command::new("rundll32").args(["url.dll,FileProtocolHandler", &url]).spawn();
    #[cfg(target_os = "linux")]
    let started = Command::new("xdg-open").arg(&url).spawn();
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    let started: std::io::Result<std::process::Child> =
        Err(std::io::Error::other("opening links is not supported on this system"));

    started.map(|_| ()).map_err(|e| format!("The link could not be opened: {e}"))
}

#[cfg(test)]
mod tests {
    use super::is_openable_url;

    #[test]
    fn web_and_mail_links_are_allowed() {
        assert!(is_openable_url("https://example.com/a?b=1&c=2#top"));
        assert!(is_openable_url("HTTP://example.com"));
        assert!(is_openable_url("mailto:someone@example.com"));
    }

    #[test]
    fn other_links_are_refused() {
        assert!(!is_openable_url(""));
        assert!(!is_openable_url("https://"));
        assert!(!is_openable_url("file:///C:/Windows/System32/calc.exe"));
        assert!(!is_openable_url("javascript:alert(1)"));
        assert!(!is_openable_url("ms-settings:network"));
        assert!(!is_openable_url("C:\\tools\\app.exe"));
        assert!(!is_openable_url("https://example.com/a b"));
        assert!(!is_openable_url("https://example.com/\n"));
    }
}
