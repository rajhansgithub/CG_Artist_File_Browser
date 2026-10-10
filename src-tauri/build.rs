use std::env;
use std::fs;
use std::path::{Path, PathBuf};

// Lists every file of the user guide (docs/site) so src/user_guide.rs can embed it in the program with include_bytes!.
// The guide then ships inside the installed app and the portable exe alike, with no resource folder next to it.
fn collect(dir: &Path, base: &Path, out: &mut Vec<PathBuf>) {
  let Ok(entries) = fs::read_dir(dir) else { return };
  for entry in entries.flatten() {
    let path = entry.path();
    if path.is_dir() {
      println!("cargo:rerun-if-changed={}", path.display());
      collect(&path, base, out);
    } else if let Ok(rel) = path.strip_prefix(base) {
      println!("cargo:rerun-if-changed={}", path.display());
      out.push(rel.to_path_buf());
    }
  }
}

fn write_guide_list() {
  let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
  let site = manifest.join("..").join("docs").join("site");
  println!("cargo:rerun-if-changed={}", site.display());

  let mut files = Vec::new();
  collect(&site, &site, &mut files);
  files.sort();
  if files.is_empty() {
    println!("cargo:warning=docs/site is empty or missing: the built-in user guide will not be included");
  }

  let mut code = String::from("pub static GUIDE_FILES: &[(&str, &[u8])] = &[\n");
  for rel in &files {
    let name = rel.to_string_lossy().replace('\\', "/");
    code.push_str(&format!(
      "  ({name:?}, include_bytes!(concat!(env!(\"CARGO_MANIFEST_DIR\"), \"/../docs/site/\", {name:?}))),\n"
    ));
  }
  code.push_str("];\n");

  let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR")).join("user_guide_files.rs");
  fs::write(out, code).expect("write user_guide_files.rs");
}

fn main() {
  write_guide_list();
  tauri_build::build()
}
