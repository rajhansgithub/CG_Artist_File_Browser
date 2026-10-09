// Colour labels and tags for files.
// The labels live in one small JSON file in the app's data folder, keyed by file path, so they survive restarts.
// Nothing is written next to the files themselves, so the user's files and their folders are never touched.
// Everything here is plain logic (no Windows calls) so it can be unit tested on any platform.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

const STORE_FILE: &str = "file_labels.json";
pub const COLORS: [&str; 7] = ["red", "orange", "yellow", "green", "blue", "purple", "gray"];
const MAX_TAGS_PER_FILE: usize = 12;
const MAX_TAG_CHARS: usize = 24;

// Serialises read-modify-write cycles on the store
static STORE_LOCK: Mutex<()> = Mutex::new(());

fn lock_store() -> MutexGuard<'static, ()> {
    STORE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct FileLabel {
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

impl FileLabel {
    fn is_empty(&self) -> bool {
        self.color.is_none() && self.tags.is_empty()
    }
}

#[derive(Serialize, Deserialize, Default)]
struct Store {
    #[serde(default)]
    labels: BTreeMap<String, FileLabel>,
}

// Same key rule as the folder icons: separators unified, no trailing separator, lower case
pub fn normalize_key(path: &str) -> String {
    let mut s = path.trim().replace('/', "\\");
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s.to_lowercase()
}

// Tags are short lower-case words: runs of spaces collapse to one, and the length is capped
pub fn clean_tag(raw: &str) -> Option<String> {
    let joined = raw.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    if joined.is_empty() {
        return None;
    }
    Some(joined.chars().take(MAX_TAG_CHARS).collect())
}

fn store_path(dir: &Path) -> PathBuf {
    dir.join(STORE_FILE)
}

fn load(dir: &Path) -> Store {
    let path = store_path(dir);
    let Ok(content) = fs::read_to_string(&path) else {
        return Store::default();
    };
    match serde_json::from_str::<Store>(&content) {
        Ok(store) => store,
        Err(_) => {
            // Keep the unreadable file aside so a later save cannot silently throw the labels away
            let _ = fs::copy(&path, dir.join("file_labels.unreadable.json"));
            Store::default()
        }
    }
}

fn save(dir: &Path, store: &Store) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    let target = store_path(dir);
    let temp = dir.join("file_labels.tmp");
    fs::write(&temp, json).map_err(|e| e.to_string())?;
    fs::rename(&temp, &target).map_err(|e| e.to_string())
}

// Every label the user has set, keyed by normalised path
pub fn all(dir: &Path) -> BTreeMap<String, FileLabel> {
    let _guard = lock_store();
    load(dir).labels
}

// Writes the changed entries back and returns them (an empty label means the file has none any more)
fn apply(
    dir: &Path,
    paths: &[String],
    mut change: impl FnMut(&mut FileLabel),
) -> Result<HashMap<String, FileLabel>, String> {
    let _guard = lock_store();
    let mut store = load(dir);
    let mut result = HashMap::new();
    for path in paths {
        let key = normalize_key(path);
        if key.is_empty() {
            continue;
        }
        let entry = store.labels.entry(key.clone()).or_default();
        change(entry);
        let label = entry.clone();
        if label.is_empty() {
            store.labels.remove(&key);
        }
        result.insert(key, label);
    }
    save(dir, &store)?;
    Ok(result)
}

// Sets one colour on every path, or clears it when `color` is None
pub fn set_color(dir: &Path, paths: &[String], color: Option<&str>) -> Result<HashMap<String, FileLabel>, String> {
    if let Some(c) = color {
        if !COLORS.contains(&c) {
            return Err(format!("Unknown colour: {}", c));
        }
    }
    let wanted = color.map(str::to_string);
    apply(dir, paths, |label| label.color = wanted.clone())
}

// Adds and removes tags on every path
pub fn edit_tags(
    dir: &Path,
    paths: &[String],
    add: &[String],
    remove: &[String],
) -> Result<HashMap<String, FileLabel>, String> {
    let added: Vec<String> = add.iter().filter_map(|t| clean_tag(t)).collect();
    let removed: Vec<String> = remove.iter().filter_map(|t| clean_tag(t)).collect();
    apply(dir, paths, |label| {
        label.tags.retain(|t| !removed.contains(t));
        for tag in &added {
            if label.tags.len() >= MAX_TAGS_PER_FILE {
                break;
            }
            if !label.tags.contains(tag) {
                label.tags.push(tag.clone());
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("file_labels_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn keys_ignore_case_and_separator_style() {
        assert_eq!(normalize_key("D:/Assets/Hero.EXR"), "d:\\assets\\hero.exr");
        assert_eq!(normalize_key("D:\\Assets\\"), "d:\\assets");
        assert_eq!(normalize_key("D:\\"), "d:\\");
    }

    #[test]
    fn tags_are_cleaned() {
        assert_eq!(clean_tag("  Needs   Review "), Some("needs review".to_string()));
        assert_eq!(clean_tag("   "), None);
        assert_eq!(clean_tag(&"x".repeat(40)).map(|t| t.len()), Some(MAX_TAG_CHARS));
    }

    #[test]
    fn colour_and_tags_survive_a_reload() {
        let dir = temp_dir("reload");
        let paths = vec!["D:\\Shots\\a.exr".to_string()];
        set_color(&dir, &paths, Some("red")).unwrap();
        edit_tags(&dir, &paths, &["Approved".into(), "approved".into(), "wip".into()], &[]).unwrap();

        let labels = all(&dir);
        let label = labels.get("d:\\shots\\a.exr").expect("label stored");
        assert_eq!(label.color.as_deref(), Some("red"));
        assert_eq!(label.tags, vec!["approved".to_string(), "wip".to_string()]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn clearing_everything_removes_the_entry() {
        let dir = temp_dir("clear");
        let paths = vec!["D:\\a.obj".to_string()];
        set_color(&dir, &paths, Some("blue")).unwrap();
        let result = set_color(&dir, &paths, None).unwrap();
        assert!(result.get("d:\\a.obj").unwrap().is_empty());
        assert!(all(&dir).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_colour_is_refused() {
        let dir = temp_dir("unknown");
        assert!(set_color(&dir, &["D:\\a.obj".to_string()], Some("pink")).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn removing_a_tag_keeps_the_others() {
        let dir = temp_dir("remove");
        let paths = vec!["D:\\b.png".to_string()];
        edit_tags(&dir, &paths, &["one".into(), "two".into()], &[]).unwrap();
        edit_tags(&dir, &paths, &[], &["ONE".into()]).unwrap();
        assert_eq!(all(&dir)["d:\\b.png"].tags, vec!["two".to_string()]);
        let _ = fs::remove_dir_all(&dir);
    }
}
