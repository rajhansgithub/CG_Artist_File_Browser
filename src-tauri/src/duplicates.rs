//! Duplicate finder: lists the folders and files under one folder that are copies of each other. Report only:
//! nothing is moved, renamed or deleted.
//!
//! The webview starts a job with an id it made itself, then listens for `duplicate-scan-progress` and
//! `duplicate-scan-finished` events, like the batch converter.
//!
//! Two ways to tell that two files are the same:
//! - fast: same file name (ignoring case) and same size. Nothing is read, so it is quick on network drives.
//! - exact: same contents. Only files that share their size with another file are read: first 64 KB of each
//!   (32 KB at the start and 32 KB at the end), then the whole file for those that still match. A renamed copy
//!   is found, and two different files that happen to share a name and size are not.
//!
//! A folder is compared by everything inside it, subfolders included; its own name and the layout inside it do
//! not matter. The similarity of two folders is the size of the files they share divided by the size of all their
//! files together (weighted Jaccard), so a big file counts more than a small one. 100% means the same files.
//! Folders are grouped around the biggest folder of each group: every other member is at least `min_score` like it.
//! When two folders match, their matching subfolders are not listed again, and a folder is never compared with a
//! folder inside it.

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::Emitter;
use walkdir::WalkDir;

// Cancel flags of the scans still running, by the id the webview gave them
static JOBS: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn jobs() -> MutexGuard<'static, HashMap<String, Arc<AtomicBool>>> {
    JOBS.lock().unwrap_or_else(|e| e.into_inner())
}

/// Files Windows and macOS make on their own; they say nothing about a folder's contents
const IGNORED_FILES: &[&str] = &["thumbs.db", "desktop.ini", ".ds_store", "ehthumbs.db"];
/// System folders at the root of a drive
const IGNORED_FOLDERS: &[&str] = &["$recycle.bin", "system volume information"];

/// Bytes read from each end of a file for the first exact pass
const SAMPLE: u64 = 32 * 1024;
/// Files read at the same time in exact mode: enough to keep a network drive busy, few enough not to thrash a hard disk
const READERS: usize = 4;
/// A file shared by more folders than this is not used to look for similar folders (it is still counted in the score)
const MAX_POSTINGS: usize = 4000;
/// Most folders a folder is compared with for near copies
const MAX_CANDIDATES: usize = 2000;
/// Most groups sent to the window; the totals still count every group
const MAX_FOLDER_GROUPS: usize = 2000;
const MAX_FILE_GROUPS: usize = 3000;
/// Most differing file names listed per folder
const MAX_DIFF_NAMES: usize = 20;

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct ScanOptions {
    /// Compare file contents instead of name and size
    pub exact: bool,
    /// Lowest similarity (50 to 100) a folder needs to be grouped with another
    pub min_score: u8,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self { exact: false, min_score: 80 }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FolderMember {
    pub path: String,
    pub files: u32,
    pub bytes: u64,
    /// How alike this folder is to the first folder of its group, 0 to 100
    pub score: u8,
    /// Files of the first folder of the group that this folder lacks, and files only this folder has
    /// (paths inside each folder, at most `MAX_DIFF_NAMES`, with the full counts)
    pub missing: Vec<String>,
    pub missing_count: usize,
    pub extra: Vec<String>,
    pub extra_count: usize,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FolderGroup {
    /// The lowest score in the group
    pub score: u8,
    /// The first member is the biggest folder; the others are scored against it
    pub members: Vec<FolderMember>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileGroup {
    pub name: String,
    pub size: u64,
    pub paths: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub root: String,
    pub exact: bool,
    pub min_score: u8,
    pub files: usize,
    pub folders: usize,
    pub bytes: u64,
    /// Files and folders that could not be read
    pub skipped: usize,
    /// Space taken by second and later copies of the same file anywhere under the folder
    pub extra_bytes: u64,
    pub folder_groups: Vec<FolderGroup>,
    pub folder_groups_total: usize,
    /// Copies that are not already explained by a folder group (files inside two matching folders are left out)
    pub file_groups: Vec<FileGroup>,
    pub file_groups_total: usize,
    pub elapsed_ms: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    job_id: String,
    /// "listing", "reading" or "comparing"
    phase: &'static str,
    /// Files found while listing, bytes read while reading, folders done while comparing
    done: u64,
    total: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FinishedEvent {
    job_id: String,
    report: Option<Report>,
    error: Option<String>,
    cancelled: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ScanError {
    Cancelled,
    Failed(String),
}

/// Sends progress at most every 150 ms, from any thread
struct Progress<'a> {
    cancel: &'a AtomicBool,
    last: Mutex<Option<Instant>>,
    sink: &'a (dyn Fn(&'static str, u64, u64) + Sync),
}

impl Progress<'_> {
    fn check(&self) -> Result<(), ScanError> {
        if self.cancel.load(Ordering::Relaxed) { Err(ScanError::Cancelled) } else { Ok(()) }
    }

    fn report(&self, phase: &'static str, done: u64, total: u64, force: bool) {
        let mut last = self.last.lock().unwrap_or_else(|e| e.into_inner());
        if force || last.is_none_or(|t| t.elapsed() >= Duration::from_millis(150)) {
            *last = Some(Instant::now());
            (self.sink)(phase, done, total);
        }
    }
}

struct FileEntry {
    path: PathBuf,
    dir: u32,
    size: u64,
}

struct DirEntry {
    path: PathBuf,
    parent: Option<u32>,
    // The files and folders inside this folder, at any depth, are files[first_file..end_file] and dirs[index + 1..end_dir]
    first_file: u32,
    end_file: u32,
    end_dir: u32,
}

/// A folder's contents: (file key, how many) sorted by key, with the total size and file count
struct Fingerprint {
    items: Vec<(u32, u32)>,
    total: u64,
    files: u32,
}

/// The files and folders under `root`, in depth-first order so everything inside a folder is one run of each list
fn list_tree(root: &Path, progress: &Progress) -> Result<(Vec<DirEntry>, Vec<FileEntry>, usize), ScanError> {
    let mut dirs: Vec<DirEntry> = Vec::new();
    let mut files: Vec<FileEntry> = Vec::new();
    let mut skipped = 0usize;
    // Folders still open, with their depth
    let mut open: Vec<(u32, usize)> = Vec::new();

    let close = |dirs: &mut Vec<DirEntry>, index: u32, files_len: usize| {
        let end_dir = dirs.len() as u32;
        let dir = &mut dirs[index as usize];
        dir.end_file = files_len as u32;
        dir.end_dir = end_dir;
    };

    let walker = WalkDir::new(root).follow_links(false).sort_by_file_name().into_iter().filter_entry(|e| {
        e.depth() == 0 || !(e.file_type().is_dir() && IGNORED_FOLDERS.contains(&e.file_name().to_string_lossy().to_lowercase().as_str()))
    });
    for entry in walker {
        progress.check()?;
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                if err.depth() == 0 {
                    return Err(ScanError::Failed(format!("Can't read {}: {err}", root.display())));
                }
                skipped += 1;
                continue;
            }
        };
        let depth = entry.depth();
        while open.last().is_some_and(|&(_, d)| d >= depth) {
            let (index, _) = open.pop().unwrap();
            close(&mut dirs, index, files.len());
        }
        let file_type = entry.file_type();
        if file_type.is_dir() {
            let index = dirs.len() as u32;
            dirs.push(DirEntry {
                path: entry.into_path(),
                parent: open.last().map(|&(i, _)| i),
                first_file: files.len() as u32,
                end_file: 0,
                end_dir: 0,
            });
            open.push((index, depth));
        } else if file_type.is_file() {
            let Some(&(dir, _)) = open.last() else { continue };
            if IGNORED_FILES.contains(&entry.file_name().to_string_lossy().to_lowercase().as_str()) {
                continue;
            }
            match entry.metadata() {
                Ok(meta) => {
                    files.push(FileEntry { path: entry.into_path(), dir, size: meta.len() });
                    progress.report("listing", files.len() as u64, 0, false);
                }
                Err(_) => skipped += 1,
            }
        }
        // Links and junctions are not followed, so nothing is counted twice
    }
    while let Some((index, _)) = open.pop() {
        close(&mut dirs, index, files.len());
    }
    if dirs.is_empty() {
        return Err(ScanError::Failed(format!("{} is not a folder", root.display())));
    }
    progress.report("listing", files.len() as u64, 0, true);
    Ok((dirs, files, skipped))
}

/// Interns values into small ids
struct Interner<T: std::hash::Hash + Eq> {
    ids: HashMap<T, u32>,
}

impl<T: std::hash::Hash + Eq> Interner<T> {
    fn new() -> Self {
        Self { ids: HashMap::new() }
    }
    fn id(&mut self, value: T, next: &mut u32) -> u32 {
        *self.ids.entry(value).or_insert_with(|| {
            *next += 1;
            *next - 1
        })
    }
}

/// One key per file: equal keys mean the same file. Returns the keys and each key's size.
fn file_keys(files: &[FileEntry], exact: bool, progress: &Progress, skipped: &mut usize) -> Result<(Vec<u32>, Vec<u64>), ScanError> {
    let mut next = 0u32;
    let mut keys = vec![0u32; files.len()];
    let mut key_size: Vec<u64> = Vec::new();

    if !exact {
        let mut interner = Interner::new();
        for (i, file) in files.iter().enumerate() {
            let name = file.path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            let before = next;
            keys[i] = interner.id((name, file.size), &mut next);
            if next != before {
                key_size.push(file.size);
            }
        }
        return Ok((keys, key_size));
    }

    // Files with a size no other file has are unique without being read
    let mut by_size: HashMap<u64, Vec<usize>> = HashMap::new();
    for (i, file) in files.iter().enumerate() {
        by_size.entry(file.size).or_default().push(i);
    }
    fn unique(next: &mut u32, key_size: &mut Vec<u64>, size: u64) -> u32 {
        key_size.push(size);
        *next += 1;
        *next - 1
    }

    let pool = rayon::ThreadPoolBuilder::new().num_threads(READERS).build().map_err(|e| ScanError::Failed(e.to_string()))?;
    let read = AtomicU64::new(0);

    // First pass: a sample of each end of the files that share a size (empty files are all the same)
    let to_sample: Vec<usize> = by_size.iter().filter(|(size, list)| list.len() > 1 && **size > 0).flat_map(|(_, list)| list.iter().copied()).collect();
    let sample_total: u64 = to_sample.iter().map(|&i| files[i].size.min(2 * SAMPLE)).sum();
    let samples: Vec<(usize, Option<[u8; 16]>)> = pool.install(|| {
        to_sample
            .par_iter()
            .map(|&i| {
                if progress.check().is_err() {
                    return (i, None);
                }
                let digest = sample_digest(&files[i].path, files[i].size);
                read.fetch_add(files[i].size.min(2 * SAMPLE), Ordering::Relaxed);
                progress.report("reading", read.load(Ordering::Relaxed), sample_total, false);
                (i, digest)
            })
            .collect()
    });
    progress.check()?;
    let sample_of: HashMap<usize, Option<[u8; 16]>> = samples.into_iter().collect();

    // Second pass: the whole of each file whose sample matched another file's (a small file's sample is the whole file)
    let mut by_sample: HashMap<(u64, [u8; 16]), Vec<usize>> = HashMap::new();
    for (&i, digest) in &sample_of {
        if let Some(d) = digest {
            by_sample.entry((files[i].size, *d)).or_default().push(i);
        }
    }
    let to_hash: Vec<usize> = by_sample
        .iter()
        .filter(|((size, _), list)| list.len() > 1 && *size > 2 * SAMPLE)
        .flat_map(|(_, list)| list.iter().copied())
        .collect();
    let hash_total: u64 = to_hash.iter().map(|&i| files[i].size).sum();
    read.store(0, Ordering::Relaxed);
    let hashes: Vec<(usize, Option<[u8; 16]>)> = pool.install(|| {
        to_hash
            .par_iter()
            .map(|&i| {
                if progress.check().is_err() {
                    return (i, None);
                }
                (i, full_digest(&files[i].path, &read, progress, hash_total))
            })
            .collect()
    });
    progress.check()?;
    progress.report("reading", hash_total, hash_total, true);
    let hash_of: HashMap<usize, Option<[u8; 16]>> = hashes.into_iter().collect();

    // 0 = sample, 1 = whole file
    let mut interner: Interner<(u64, u8, [u8; 16])> = Interner::new();
    for (i, file) in files.iter().enumerate() {
        let shared_size = by_size.get(&file.size).is_some_and(|list| list.len() > 1);
        let digest = if !shared_size {
            None
        } else if file.size == 0 {
            Some((0u8, [0u8; 16]))
        } else if file.size <= 2 * SAMPLE {
            match sample_of.get(&i) {
                Some(Some(d)) => Some((0, *d)),
                _ => {
                    *skipped += 1;
                    None
                }
            }
        } else {
            match (sample_of.get(&i), hash_of.get(&i)) {
                (_, Some(Some(d))) => Some((1, *d)),
                (_, Some(None)) | (Some(None), _) | (None, _) => {
                    *skipped += 1;
                    None
                }
                // The sample matched no other file, so this file is unique
                (Some(Some(d)), None) => Some((0, *d)),
            }
        };
        keys[i] = match digest {
            Some((kind, d)) => {
                let before = next;
                let id = interner.id((file.size, kind, d), &mut next);
                if next != before {
                    key_size.push(file.size);
                }
                id
            }
            None => unique(&mut next, &mut key_size, file.size),
        };
    }
    Ok((keys, key_size))
}

fn sample_digest(path: &Path, size: u64) -> Option<[u8; 16]> {
    let mut file = File::open(path).ok()?;
    let mut ctx = md5::Context::new();
    if size <= 2 * SAMPLE {
        let mut buf = Vec::with_capacity(size as usize);
        file.read_to_end(&mut buf).ok()?;
        if buf.len() as u64 != size {
            return None;
        }
        ctx.consume(&buf);
    } else {
        let mut buf = vec![0u8; SAMPLE as usize];
        file.read_exact(&mut buf).ok()?;
        ctx.consume(&buf);
        file.seek(SeekFrom::Start(size - SAMPLE)).ok()?;
        file.read_exact(&mut buf).ok()?;
        ctx.consume(&buf);
    }
    Some(ctx.compute().0)
}

fn full_digest(path: &Path, read: &AtomicU64, progress: &Progress, total: u64) -> Option<[u8; 16]> {
    let mut file = File::open(path).ok()?;
    let mut ctx = md5::Context::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        if progress.check().is_err() {
            return None;
        }
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        ctx.consume(&buf[..n]);
        let done = read.fetch_add(n as u64, Ordering::Relaxed) + n as u64;
        progress.report("reading", done, total, false);
    }
    Some(ctx.compute().0)
}

fn fingerprint(range: &[u32], key_size: &[u64]) -> Fingerprint {
    let mut keys = range.to_vec();
    keys.sort_unstable();
    let mut items: Vec<(u32, u32)> = Vec::new();
    let mut total = 0u64;
    for key in keys {
        total += key_size[key as usize];
        match items.last_mut() {
            Some((k, count)) if *k == key => *count += 1,
            _ => items.push((key, 1)),
        }
    }
    Fingerprint { files: range.len() as u32, items, total }
}

/// (bytes shared, bytes of both together)
fn overlap(a: &Fingerprint, b: &Fingerprint, key_size: &[u64]) -> (u64, u64) {
    let (mut i, mut j, mut shared) = (0, 0, 0u64);
    while i < a.items.len() && j < b.items.len() {
        let (ka, ca) = a.items[i];
        let (kb, cb) = b.items[j];
        if ka == kb {
            shared += ca.min(cb) as u64 * key_size[ka as usize];
            i += 1;
            j += 1;
        } else if ka < kb {
            i += 1;
        } else {
            j += 1;
        }
    }
    (shared, a.total + b.total - shared)
}

/// 0 to 100, rounded down; 100 only for the same files
fn score_of(shared: u64, union: u64, same: bool) -> u8 {
    if same {
        return 100;
    }
    if union == 0 {
        return 0;
    }
    ((shared as u128 * 100 / union as u128) as u8).min(99)
}

fn is_inside(dirs: &[DirEntry], outer: u32, inner: u32) -> bool {
    outer < inner && inner < dirs[outer as usize].end_dir
}

fn related(dirs: &[DirEntry], a: u32, b: u32) -> bool {
    is_inside(dirs, a, b) || is_inside(dirs, b, a)
}

/// Runs the whole scan. `sink` gets (phase, done, total) now and then.
pub fn scan(root: &Path, options: ScanOptions, cancel: &AtomicBool, sink: &(dyn Fn(&'static str, u64, u64) + Sync)) -> Result<Report, ScanError> {
    let started = Instant::now();
    let min_score = options.min_score.clamp(50, 100);
    let progress = Progress { cancel, last: Mutex::new(None), sink };

    let (dirs, files, mut skipped) = list_tree(root, &progress)?;
    let (keys, key_size) = file_keys(&files, options.exact, &progress, &mut skipped)?;
    progress.check()?;
    progress.report("comparing", 0, dirs.len() as u64, true);

    let fps: Vec<Fingerprint> = dirs
        .par_iter()
        .map(|d| fingerprint(&keys[d.first_file as usize..d.end_file as usize], &key_size))
        .collect();
    progress.check()?;

    // Folders with the same files form one unit. A folder that only wraps another (same files) is the same
    // contents, not a copy, so only the inner one is kept.
    let mut by_print: HashMap<&[(u32, u32)], Vec<u32>> = HashMap::new();
    for (i, fp) in fps.iter().enumerate() {
        if fp.total > 0 {
            by_print.entry(fp.items.as_slice()).or_default().push(i as u32);
        }
    }
    let mut units: Vec<Vec<u32>> = by_print
        .into_values()
        .map(|mut list| {
            // In folder order, anything inside a folder comes right after it
            list.sort_unstable();
            (0..list.len()).filter(|&i| list.get(i + 1).is_none_or(|&next| !is_inside(&dirs, list[i], next))).map(|i| list[i]).collect()
        })
        .collect();
    // Biggest first; equal sizes in folder order so the result does not depend on hashing
    units.sort_by(|a, b| fps[b[0] as usize].total.cmp(&fps[a[0] as usize].total).then(a[0].cmp(&b[0])));
    let mut unit_of_dir = vec![u32::MAX; dirs.len()];
    for (u, members) in units.iter().enumerate() {
        for &d in members {
            unit_of_dir[d as usize] = u as u32;
        }
    }

    // Which folders hold each file directly, to find folders that share a file
    let mut postings: Vec<Vec<u32>> = vec![Vec::new(); key_size.len()];
    if min_score < 100 {
        for (i, file) in files.iter().enumerate() {
            let list = &mut postings[keys[i] as usize];
            if list.last() != Some(&file.dir) {
                list.push(file.dir);
            }
        }
    }

    // Groups: (folder, score against the first folder)
    let t = min_score as f64 / 100.0;
    let mut assigned = vec![false; units.len()];
    let mut groups: Vec<Vec<(u32, u8)>> = Vec::new();
    for u in 0..units.len() {
        if u % 256 == 0 {
            progress.check()?;
            progress.report("comparing", u as u64, units.len() as u64, false);
        }
        if assigned[u] {
            continue;
        }
        assigned[u] = true;
        let reference = units[u][0];
        let ref_fp = &fps[reference as usize];
        let mut group: Vec<(u32, u8)> = units[u].iter().map(|&d| (d, 100)).collect();

        if min_score < 100 {
            // A folder at least t like this one must hold at least one of the files that make up the first (1 - t)
            // of its size, biggest first. Only folders holding one of those are compared.
            let mut by_weight: Vec<(u32, u32)> = ref_fp.items.clone();
            by_weight.sort_unstable_by(|a, b| {
                (key_size[b.0 as usize] * b.1 as u64).cmp(&(key_size[a.0 as usize] * a.1 as u64)).then(a.0.cmp(&b.0))
            });
            let limit = (1.0 - t) * ref_fp.total as f64;
            let low = t * ref_fp.total as f64;
            let high = ref_fp.total as f64 / t;
            let mut seen = 0.0;
            let mut candidates: HashSet<u32> = HashSet::new();
            'keys: for (key, count) in by_weight {
                let list = &postings[key as usize];
                if list.len() <= MAX_POSTINGS {
                    for &start in list {
                        // Folders only get bigger going up, so stop once one is too big to match
                        let mut d = Some(start);
                        while let Some(dir) = d {
                            let total = fps[dir as usize].total as f64;
                            if total > high {
                                break;
                            }
                            let cu = unit_of_dir[dir as usize];
                            if total >= low && cu != u32::MAX && !assigned[cu as usize] {
                                candidates.insert(cu);
                                if candidates.len() >= MAX_CANDIDATES {
                                    break 'keys;
                                }
                            }
                            d = dirs[dir as usize].parent;
                        }
                    }
                }
                seen += (key_size[key as usize] * count as u64) as f64;
                if seen > limit {
                    break;
                }
            }
            let mut candidates: Vec<u32> = candidates.into_iter().collect();
            candidates.sort_by(|&a, &b| fps[units[b as usize][0] as usize].total.cmp(&fps[units[a as usize][0] as usize].total).then(a.cmp(&b)));
            for cu in candidates {
                let members = &units[cu as usize];
                if members.iter().any(|&m| group.iter().any(|&(g, _)| related(&dirs, g, m))) {
                    continue;
                }
                let (shared, union) = overlap(ref_fp, &fps[members[0] as usize], &key_size);
                if (shared as u128) * 100 >= (min_score as u128) * (union as u128) {
                    let score = score_of(shared, union, false);
                    assigned[cu as usize] = true;
                    group.extend(members.iter().map(|&m| (m, score)));
                }
            }
        }
        if group.len() > 1 {
            groups.push(group);
        }
    }
    progress.check()?;

    // Matching subfolders of matching folders say nothing new: a group whose folders all sit directly in
    // different folders of one other group is left out
    let mut group_of_dir: HashMap<u32, usize> = HashMap::new();
    for (g, group) in groups.iter().enumerate() {
        for &(d, _) in group {
            group_of_dir.insert(d, g);
        }
    }
    let kept: Vec<usize> = (0..groups.len())
        .filter(|&g| {
            let parents: Vec<Option<u32>> = groups[g].iter().map(|&(d, _)| dirs[d as usize].parent).collect();
            let parent_groups: HashSet<Option<usize>> = parents.iter().map(|p| p.and_then(|p| group_of_dir.get(&p).copied())).collect();
            let distinct: HashSet<Option<u32>> = parents.iter().copied().collect();
            let implied = parent_groups.len() == 1
                && parent_groups.iter().next().is_some_and(|pg| pg.is_some_and(|pg| pg != g))
                && distinct.len() == parents.len();
            !implied
        })
        .collect();

    // Each folder's group and member, from the nearest kept group folder at or above it
    let mut member_of_dir: Vec<Option<(usize, usize)>> = vec![None; dirs.len()];
    for (n, &g) in kept.iter().enumerate() {
        for (m, &(d, _)) in groups[g].iter().enumerate() {
            member_of_dir[d as usize] = Some((n, m));
        }
    }
    for d in 0..dirs.len() {
        if member_of_dir[d].is_none()
            && let Some(p) = dirs[d].parent
        {
            member_of_dir[d] = member_of_dir[p as usize];
        }
    }

    // Folder groups for the report, biggest first
    let mut folder_groups: Vec<FolderGroup> = kept
        .iter()
        .map(|&g| {
            let group = &groups[g];
            let reference = group[0].0;
            let members = group
                .iter()
                .map(|&(d, score)| {
                    let (missing, missing_count, extra, extra_count) = if score == 100 {
                        (Vec::new(), 0, Vec::new(), 0)
                    } else {
                        differences(&dirs, &files, &keys, &fps, reference, d)
                    };
                    FolderMember {
                        path: dirs[d as usize].path.to_string_lossy().to_string(),
                        files: fps[d as usize].files,
                        bytes: fps[d as usize].total,
                        score,
                        missing,
                        missing_count,
                        extra,
                        extra_count,
                    }
                })
                .collect::<Vec<_>>();
            FolderGroup { score: members.iter().map(|m| m.score).min().unwrap_or(100), members }
        })
        .collect();
    folder_groups.sort_by(|a, b| b.members[0].bytes.cmp(&a.members[0].bytes).then(a.members[0].path.cmp(&b.members[0].path)));
    let folder_groups_total = folder_groups.len();
    folder_groups.truncate(MAX_FOLDER_GROUPS);

    // File copies: every key held by two or more files. Copies that only sit in different members of one folder
    // group are already in that group.
    let mut by_key: HashMap<u32, Vec<usize>> = HashMap::new();
    for (i, &key) in keys.iter().enumerate() {
        if files[i].size > 0 {
            by_key.entry(key).or_default().push(i);
        }
    }
    let mut extra_bytes = 0u64;
    let mut file_groups: Vec<FileGroup> = Vec::new();
    for list in by_key.values().filter(|list| list.len() > 1) {
        let size = files[list[0]].size;
        extra_bytes += size * (list.len() as u64 - 1);
        let places: Vec<Option<(usize, usize)>> = list.iter().map(|&i| member_of_dir[files[i].dir as usize]).collect();
        let same_group = places.iter().all(|p| p.is_some() && p.map(|x| x.0) == places[0].map(|x| x.0));
        let one_per_member = places.iter().collect::<HashSet<_>>().len() == places.len();
        if same_group && one_per_member {
            continue;
        }
        let mut paths: Vec<String> = list.iter().map(|&i| files[i].path.to_string_lossy().to_string()).collect();
        paths.sort();
        let name = files[list[0]].path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        file_groups.push(FileGroup { name, size, paths });
    }
    file_groups.sort_by(|a, b| {
        (b.size * (b.paths.len() as u64 - 1)).cmp(&(a.size * (a.paths.len() as u64 - 1))).then(a.paths[0].cmp(&b.paths[0]))
    });
    let file_groups_total = file_groups.len();
    file_groups.truncate(MAX_FILE_GROUPS);
    progress.report("comparing", units.len() as u64, units.len() as u64, true);

    Ok(Report {
        root: root.to_string_lossy().to_string(),
        exact: options.exact,
        min_score,
        files: files.len(),
        folders: dirs.len().saturating_sub(1),
        bytes: files.iter().map(|f| f.size).sum(),
        skipped,
        extra_bytes,
        folder_groups,
        folder_groups_total,
        file_groups,
        file_groups_total,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

/// Files of `reference` that `other` lacks, and files only `other` has, as paths inside each folder
fn differences(dirs: &[DirEntry], files: &[FileEntry], keys: &[u32], fps: &[Fingerprint], reference: u32, other: u32) -> (Vec<String>, usize, Vec<String>, usize) {
    let counts = |fp: &Fingerprint| fp.items.iter().copied().collect::<HashMap<u32, u32>>();
    let a = counts(&fps[reference as usize]);
    let b = counts(&fps[other as usize]);
    let only = |dir: u32, mine: &HashMap<u32, u32>, theirs: &HashMap<u32, u32>| {
        let mut left: HashMap<u32, u32> = mine
            .iter()
            .filter_map(|(k, &c)| {
                let extra = c.saturating_sub(theirs.get(k).copied().unwrap_or(0));
                (extra > 0).then_some((*k, extra))
            })
            .collect();
        let count = left.values().map(|&c| c as usize).sum();
        let d = &dirs[dir as usize];
        let mut names = Vec::new();
        for i in d.first_file as usize..d.end_file as usize {
            if names.len() >= MAX_DIFF_NAMES {
                break;
            }
            if let Some(c) = left.get_mut(&keys[i]).filter(|c| **c > 0) {
                *c -= 1;
                let rel = files[i].path.strip_prefix(&d.path).unwrap_or(&files[i].path);
                names.push(rel.to_string_lossy().to_string());
            }
        }
        (names, count)
    };
    let (missing, missing_count) = only(reference, &a, &b);
    let (extra, extra_count) = only(other, &b, &a);
    (missing, missing_count, extra, extra_count)
}

/// Starts looking for duplicates under `root` in the background. Returns an error only when the scan cannot start.
#[tauri::command]
pub async fn start_duplicate_scan(app: tauri::AppHandle, job_id: String, root: String, options: Option<ScanOptions>) -> Result<(), String> {
    let root = root.trim().to_string();
    if root.is_empty() {
        return Err("No folder picked.".into());
    }
    // A dead share can hang the first look for a minute; fail with a readable reason instead
    let probe_root = root.clone();
    let is_dir = tauri::async_runtime::spawn_blocking(move || crate::network::probe(&probe_root, Duration::from_secs(15)))
        .await
        .map_err(|e| e.to_string())??;
    if !is_dir {
        return Err(format!("{root} is not a folder"));
    }

    let cancel = Arc::new(AtomicBool::new(false));
    jobs().insert(job_id.clone(), cancel.clone());
    let options = options.unwrap_or_default();
    std::thread::spawn(move || {
        let sink_app = app.clone();
        let sink_id = job_id.clone();
        let sink = move |phase: &'static str, done: u64, total: u64| {
            let _ = sink_app.emit("duplicate-scan-progress", ProgressEvent { job_id: sink_id.clone(), phase, done, total });
        };
        let result = catch_unwind(AssertUnwindSafe(|| scan(Path::new(&root), options, &cancel, &sink)))
            .unwrap_or_else(|_| Err(ScanError::Failed("The scan stopped on an unexpected error.".into())));
        jobs().remove(&job_id);
        let event = match result {
            Ok(report) => FinishedEvent { job_id, report: Some(report), error: None, cancelled: false },
            Err(ScanError::Cancelled) => FinishedEvent { job_id, report: None, error: None, cancelled: true },
            Err(ScanError::Failed(error)) => FinishedEvent { job_id, report: None, error: Some(error), cancelled: false },
        };
        let _ = app.emit("duplicate-scan-finished", event);
    });
    Ok(())
}

/// Stops a running scan; it finishes with `cancelled` and no report
#[tauri::command]
pub fn cancel_duplicate_scan(job_id: String) -> bool {
    match jobs().get(&job_id) {
        Some(flag) => {
            flag.store(true, Ordering::Relaxed);
            true
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::AtomicUsize;

    static NEXT: AtomicUsize = AtomicUsize::new(0);

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dupes-{}-{}-{name}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn put(root: &Path, rel: &str, bytes: &[u8]) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn run(root: &Path, exact: bool, min_score: u8) -> Report {
        scan(root, ScanOptions { exact, min_score }, &AtomicBool::new(false), &|_, _, _| {}).unwrap()
    }

    fn names(report: &Report, root: &Path) -> Vec<Vec<String>> {
        report
            .folder_groups
            .iter()
            .map(|g| {
                let mut list: Vec<String> = g
                    .members
                    .iter()
                    .map(|m| Path::new(&m.path).strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/"))
                    .collect();
                list.sort();
                list
            })
            .collect()
    }

    #[test]
    fn different_folders_are_not_grouped() {
        let root = temp_dir("different");
        put(&root, "test_01/file01.rar", &[1; 500]);
        put(&root, "test_02/filename.zip", &[2; 700]);
        for exact in [false, true] {
            let report = run(&root, exact, 50);
            assert!(report.folder_groups.is_empty());
            assert!(report.file_groups.is_empty());
        }
    }

    #[test]
    fn a_renamed_copy_of_a_folder_is_found() {
        let root = temp_dir("copy");
        for dir in ["Project", "backup/Project_copy"] {
            put(&root, &format!("{dir}/scene.blend"), &[3; 4000]);
            put(&root, &format!("{dir}/tex/wood.png"), &[4; 2000]);
        }
        for exact in [false, true] {
            let report = run(&root, exact, 80);
            assert_eq!(names(&report, &root), vec![vec!["Project".to_string(), "backup/Project_copy".to_string()]]);
            assert_eq!(report.folder_groups[0].score, 100);
            // The files inside are part of the folder group, and the matching tex subfolders are not listed again
            assert!(report.file_groups.is_empty());
            assert_eq!(report.extra_bytes, 6000);
        }
    }

    #[test]
    fn exact_mode_reads_contents() {
        let root = temp_dir("contents");
        // Same name and size, different contents
        put(&root, "a/shot.exr", &[5; 1000]);
        put(&root, "b/shot.exr", &[6; 1000]);
        // Same contents, different names
        put(&root, "c/one.tif", &[7; 900]);
        put(&root, "d/two.tif", &[7; 900]);
        let fast = run(&root, false, 100);
        assert_eq!(names(&fast, &root), vec![vec!["a".to_string(), "b".to_string()]]);
        let exact = run(&root, true, 100);
        assert_eq!(names(&exact, &root), vec![vec!["c".to_string(), "d".to_string()]]);
    }

    #[test]
    fn exact_mode_reads_whole_big_files() {
        let root = temp_dir("big");
        // Same size and same start and end, different middle
        let mut a = vec![1u8; 200_000];
        let b = a.clone();
        a[100_000] = 9;
        put(&root, "x/big.bin", &a);
        put(&root, "y/big.bin", &b);
        put(&root, "z/big.bin", &b);
        let exact = run(&root, true, 100);
        assert_eq!(names(&exact, &root), vec![vec!["y".to_string(), "z".to_string()]]);
    }

    #[test]
    fn near_copies_follow_the_threshold() {
        let root = temp_dir("near");
        for i in 0..9 {
            put(&root, &format!("full/f{i}.png"), &[i as u8; 1000]);
            put(&root, &format!("part/f{i}.png"), &[i as u8; 1000]);
        }
        put(&root, "full/f9.png", &[9; 1000]);
        let report = run(&root, true, 80);
        assert_eq!(names(&report, &root), vec![vec!["full".to_string(), "part".to_string()]]);
        let group = &report.folder_groups[0];
        assert_eq!(group.score, 90);
        assert!(group.members[0].path.ends_with("full"));
        assert_eq!(group.members[1].missing, vec!["f9.png".to_string()]);
        assert_eq!(group.members[1].extra_count, 0);
        assert!(run(&root, true, 95).folder_groups.is_empty());
    }

    #[test]
    fn a_folder_that_only_wraps_another_is_not_its_copy() {
        let root = temp_dir("wrap");
        put(&root, "outer/inner/a.obj", &[1; 3000]);
        put(&root, "other/a.obj", &[1; 3000]);
        let report = run(&root, false, 80);
        assert_eq!(names(&report, &root), vec![vec!["other".to_string(), "outer/inner".to_string()]]);
    }

    #[test]
    fn loose_copies_are_listed_as_files() {
        let root = temp_dir("loose");
        put(&root, "a/keep.png", &[1; 100]);
        put(&root, "a/other.png", &[2; 5000]);
        put(&root, "b/keep.png", &[1; 100]);
        put(&root, "b/different.png", &[3; 7000]);
        put(&root, "a/empty.txt", b"");
        put(&root, "b/empty.txt", b"");
        let report = run(&root, true, 80);
        assert!(report.folder_groups.is_empty());
        assert_eq!(report.file_groups.len(), 1);
        assert_eq!(report.file_groups[0].name, "keep.png");
        assert_eq!(report.file_groups[0].paths.len(), 2);
    }

    #[test]
    fn cancel_stops_the_scan() {
        let root = temp_dir("cancel");
        put(&root, "a/x.png", &[1; 10]);
        let result = scan(&root, ScanOptions::default(), &AtomicBool::new(true), &|_, _, _| {});
        assert_eq!(result.unwrap_err(), ScanError::Cancelled);
    }
}
