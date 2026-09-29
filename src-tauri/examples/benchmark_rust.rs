use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Instant, UNIX_EPOCH};
use sysinfo::Disks;

#[derive(Serialize, Clone, Debug)]
pub struct DriveInfo {
    pub name: String,
    pub mount: String,
    pub label: String,
    pub total_gb: Option<String>,
    pub free_gb: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct FileItem {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub category: String,
    pub extension: String,
    pub size: u64,
    pub modified: f64,
    pub thumbnail: Option<String>,
}

fn get_category(ext: &str) -> &'static str {
    match ext {
        ".obj" | ".fbx" | ".gltf" | ".glb" | ".stl" | ".ply" | ".usd" | ".usda" | ".usdc" | ".usdz" | ".abc" | ".dae" | ".blend" => "3d",
        ".hdr" | ".exr" => "hdr",
        ".png" | ".jpg" | ".jpeg" | ".webp" | ".bmp" => "image",
        ".tif" | ".tiff" | ".tga" | ".dds" | ".psd" => "texture",
        ".mp4" | ".webm" | ".mov" | ".mkv" | ".avi" => "video",
        ".wav" | ".mp3" | ".ogg" | ".flac" | ".aac" | ".aiff" | ".m4a" => "audio",
        _ => "other",
    }
}

pub fn list_drives_rust() -> (Vec<DriveInfo>, f64) {
    let t0 = Instant::now();
    let disks = Disks::new_with_refreshed_list();
    let mut drives = Vec::new();
    for disk in &disks {
        let mount = disk.mount_point().to_string_lossy().to_string();
        let label = disk.name().to_string_lossy().to_string();
        let label_str = if label.is_empty() { "Local Disk".to_string() } else { label };
        let total_gb = format!("{:.1}", disk.total_space() as f64 / 1_073_741_824.0);
        let free_gb = format!("{:.1}", disk.available_space() as f64 / 1_073_741_824.0);

        drives.push(DriveInfo {
            name: mount.clone(),
            mount,
            label: label_str,
            total_gb: Some(total_gb),
            free_gb: Some(free_gb),
        });
    }

    if drives.is_empty() {
        for c in b'C'..=b'Z' {
            let root = format!("{}:\\", c as char);
            if Path::new(&root).exists() {
                drives.push(DriveInfo {
                    name: root.clone(),
                    mount: format!("{}:", c as char),
                    label: format!("Drive ({}:)", c as char),
                    total_gb: None,
                    free_gb: None,
                });
            }
        }
    }
    let elapsed = t0.elapsed().as_secs_f64() * 1000.0;
    (drives, elapsed)
}

pub fn read_directory_rust(
    dir_path: &str,
    filter: &str,
    search: &str,
    recursive: bool,
    max_depth: usize,
    thumbs_dir: &Path,
) -> (usize, f64) {
    let t0 = Instant::now();
    let path = Path::new(dir_path);
    if !path.exists() {
        return (0, 0.0);
    }

    let mut items = Vec::new();

    fn scan_dir(
        curr: &Path,
        depth: usize,
        max_d: usize,
        rec: bool,
        filter: &str,
        search: &str,
        thumbs_dir: &Path,
        out: &mut Vec<FileItem>,
    ) {
        let entries = match fs::read_dir(curr) {
            Ok(e) => e,
            Err(_) => return,
        };

        for entry in entries.flatten() {
            let name_os = entry.file_name();
            let name = name_os.to_string_lossy().to_string();

            if name.starts_with('.') || name.starts_with('$') || name == "node_modules" || name == "System Volume Information" {
                continue;
            }

            let file_type = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };

            let full_path = entry.path();
            let full_path_str = full_path.to_string_lossy().to_string();

            if file_type.is_dir() {
                if !rec {
                    out.push(FileItem {
                        name: name.clone(),
                        path: full_path_str,
                        is_directory: true,
                        category: "folder".into(),
                        extension: "".into(),
                        size: 0,
                        modified: 0.0,
                        thumbnail: None,
                    });
                } else if depth < max_d {
                    scan_dir(&full_path, depth + 1, max_d, rec, filter, search, thumbs_dir, out);
                }
            } else {
                let ext = full_path.extension()
                    .and_then(|e| e.to_str())
                    .map(|e| format!(".{}", e.to_lowercase()))
                    .unwrap_or_default();

                let category = get_category(&ext);

                let pass_filter = match filter {
                    "3d" => category == "3d",
                    "hdr" => category == "hdr",
                    "image" => category == "image",
                    "texture" => category == "texture",
                    "video" => category == "video",
                    "audio" => category == "audio",
                    "assets" => ["3d", "hdr", "image", "texture", "video", "audio"].contains(&category),
                    _ => true,
                };
                if !pass_filter {
                    continue;
                }

                if !search.is_empty() && !name.to_lowercase().contains(search) {
                    continue;
                }

                let meta = entry.metadata().ok();
                let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                let modified = meta.and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs_f64() * 1000.0)
                    .unwrap_or(0.0);

                let hash = format!("{:x}", md5::compute(format!("v2_{}_{}_{}", full_path_str, modified, size)));
                let cached_jpg = thumbs_dir.join(format!("{}.jpg", hash));
                let cached_png = thumbs_dir.join(format!("{}.png", hash));

                let thumbnail = if cached_jpg.exists() {
                    Some(cached_jpg.to_string_lossy().to_string())
                } else if cached_png.exists() {
                    Some(cached_png.to_string_lossy().to_string())
                } else {
                    None
                };

                out.push(FileItem {
                    name,
                    path: full_path_str,
                    is_directory: false,
                    category: category.to_string(),
                    extension: ext,
                    size,
                    modified,
                    thumbnail,
                });
            }
        }
    }

    let search_lower = search.trim().to_lowercase();
    scan_dir(path, 0, max_depth, recursive, filter, &search_lower, thumbs_dir, &mut items);

    let elapsed = t0.elapsed().as_secs_f64() * 1000.0;
    (items.len(), elapsed)
}

pub fn read_file_buffer_rust(file_path: &str) -> (f64, f64, f64) {
    let t0 = Instant::now();
    let data = fs::read(file_path).unwrap_or_default();
    let elapsed = t0.elapsed().as_secs_f64() * 1000.0;
    let size_mb = data.len() as f64 / (1024.0 * 1024.0);
    let throughput = if elapsed > 0.0 { (size_mb / (elapsed / 1000.0)) } else { 0.0 };
    (size_mb, elapsed, throughput)
}

#[derive(Serialize)]
struct BenchmarkReport {
    drives_time_ms: f64,
    drives_count: usize,
    cg_res_scan_ms: f64,
    cg_res_count: usize,
    file_reads: Vec<FileReadResult>,
    stress_scans: Vec<StressScanResult>,
}

#[derive(Serialize)]
struct FileReadResult {
    file_name: String,
    size_mb: f64,
    read_ms: f64,
    throughput_mb_s: f64,
}

#[derive(Serialize)]
struct StressScanResult {
    name: String,
    files_count: usize,
    scan_ms: f64,
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let test_dir = if args.len() > 1 {
        args[1].clone()
    } else {
        r"D:\CG_ARTIST_TOOL_RESOURCES".to_string()
    };

    let thumbs_dir = PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_else(|_| r"C:\Users\Temp".into()))
        .join("AssetStudioCache")
        .join("thumbs");

    // 1. List drives benchmark (10 iterations)
    let mut drive_times = Vec::new();
    let mut drive_count = 0;
    for _ in 0..10 {
        let (drives, ms) = list_drives_rust();
        drive_count = drives.len();
        drive_times.push(ms);
    }
    let avg_drive_ms: f64 = drive_times.iter().sum::<f64>() / drive_times.len() as f64;

    // 2. Directory scan on D:\CG_ARTIST_TOOL_RESOURCES (20 iterations)
    let mut scan_times = Vec::new();
    let mut item_count = 0;
    for _ in 0..20 {
        let (cnt, ms) = read_directory_rust(&test_dir, "all", "", false, 2, &thumbs_dir);
        item_count = cnt;
        scan_times.push(ms);
    }
    let avg_scan_ms: f64 = scan_times.iter().sum::<f64>() / scan_times.len() as f64;

    // 3. File buffer reads on CG Assets
    let files_to_test = [
        "amber_phantom_bottle_v001.usd",
        "amber_phantom_promo_render_v001.exr",
        "Bus Garage.exr",
        "final.fbx",
        "Meshy_AI_Silver_Garden_Goblet_0925221452_generate.fbx",
        "Mumbai_Dry_Gin_Art_Deco_Front_Back_Labels_1935.png",
        "Rajasthan_Reserve_Snell_Roundhand_Whisky_Front_Back_Labels_v2.png",
        "RajhansDewangan_Film_Showreel_2024_v002.mp4",
        "Tomoco Studio.exr",
    ];

    let mut file_reads = Vec::new();
    for fname in &files_to_test {
        let fpath = Path::new(&test_dir).join(fname);
        if fpath.exists() {
            // Run 5 iterations for each file
            let mut reads = Vec::new();
            let mut sz = 0.0;
            for _ in 0..5 {
                let (size_mb, ms, tp) = read_file_buffer_rust(&fpath.to_string_lossy());
                sz = size_mb;
                reads.push((ms, tp));
            }
            let avg_ms: f64 = reads.iter().map(|r| r.0).sum::<f64>() / reads.len() as f64;
            let avg_tp: f64 = reads.iter().map(|r| r.1).sum::<f64>() / reads.len() as f64;

            file_reads.push(FileReadResult {
                file_name: fname.to_string(),
                size_mb: sz,
                read_ms: avg_ms,
                throughput_mb_s: avg_tp,
            });
        }
    }

    // 4. Stress test directories if provided in args[2]
    let mut stress_scans = Vec::new();
    if args.len() > 2 {
        let stress_parent = Path::new(&args[2]);
        if stress_parent.exists() {
            if let Ok(entries) = fs::read_dir(stress_parent) {
                for entry in entries.flatten() {
                    if entry.path().is_dir() {
                        let dir_name = entry.file_name().to_string_lossy().to_string();
                        let mut times = Vec::new();
                        let mut cnt = 0;
                        for _ in 0..10 {
                            let (c, ms) = read_directory_rust(&entry.path().to_string_lossy(), "all", "", true, 5, &thumbs_dir);
                            cnt = c;
                            times.push(ms);
                        }
                        let avg_ms: f64 = times.iter().sum::<f64>() / times.len() as f64;
                        stress_scans.push(StressScanResult {
                            name: dir_name,
                            files_count: cnt,
                            scan_ms: avg_ms,
                        });
                    }
                }
            }
        }
    }

    let report = BenchmarkReport {
        drives_time_ms: avg_drive_ms,
        drives_count: drive_count,
        cg_res_scan_ms: avg_scan_ms,
        cg_res_count: item_count,
        file_reads,
        stress_scans,
    };

    println!("BENCHMARK_JSON_START");
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
    println!("BENCHMARK_JSON_END");
}
