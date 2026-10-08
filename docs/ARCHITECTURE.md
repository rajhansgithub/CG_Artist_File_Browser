# CG Artist File Browser — Architecture & Setup

> **Master Reference & Developer Blueprint**  
> This document preserves the complete architectural design, IPC bridging, native performance pipelines, and build/release workflows for **CG Artist File Browser**. Use this guide to understand the entire codebase, onboard new developers or AI agents (Claude Code, Antigravity), or spin up a new high-performance desktop application without starting from scratch.

---

## 📑 Table of Contents

1. [Executive Summary & Technology Stack](#1-executive-summary--technology-stack)
2. [High-Level Architecture & Communication Bridge](#2-high-level-architecture--communication-bridge)
3. [Rust Native Backend & IPC Command Map](#3-rust-native-backend--ipc-command-map)
4. [High-Performance Pipelines (The 4 Rust Pillars)](#4-high-performance-pipelines-the-4-rust-pillars)
5. [Frontend Workspaces & Creative DCC Features](#5-frontend-workspaces--creative-dcc-features)
6. [External Integrations (Blender Headless Engine)](#6-external-integrations-blender-headless-engine)
7. [Directory Structure Reference](#7-directory-structure-reference)
8. [Build & Release Engineering (.exe & Installers)](#8-build--release-engineering-exe--installers)
9. [Git Repository Configuration & Release Automation](#9-git-repository-configuration--release-automation)
10. [Starter Checklist for New Projects](#10-starter-checklist-for-new-projects)

---

## 1. Executive Summary & Technology Stack

**CG Artist File Browser** is a GPU-accelerated local desktop file browser, 3D model inspector, 32-bit floating-point HDR/EXR panoramic skybox viewer, and media comparison tool tailored specifically for CG, VFX, and Game artists.

### 🛠️ Core Technology Stack

| Layer | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Desktop Framework** | [Tauri](https://tauri.app/) | `v2.12` | Native OS windowing, IPC bridge, security sandboxing, WebView2 host |
| **Backend Language** | [Rust](https://www.rust-lang.org/) | `2024 edition` (v1.90+) | Multi-threaded file indexing, native thumbnail decoding, disk caching |
| **PDF Rendering** | [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | `4.10` | Lazy-loaded PDF viewer and first-page thumbnails |
| **Frontend Framework** | [React](https://react.dev/) | `19.3` | Reactive user interface and DCC component hierarchy |
| **Bundler & Dev Server** | [Vite](https://vite.dev/) | `8.3` | Instant HMR and ES-module compilation |
| **3D & WebGL Engine** | [Three.js](https://threejs.org/) | `r186` | Real-time PBR shading, OrbitControls, wireframe geometry, skybox spheres |
| **Iconography** | [Lucide React](https://lucide.dev/) | `1.48` | Minimal dark-themed UI icons |
| **External DCC Engine** | [Blender](https://www.blender.org/) | `4.x / 5.x` | Headless USD / Alembic to GLB conversion and EEVEE thumbnail rendering |

---

## 2. High-Level Architecture & Communication Bridge

The application follows a clean separation between the **React UI** and the **Rust Core**, communicating across Tauri's secure binary IPC channel.

```
┌────────────────────────────────────────────────────────────────────────┐
│                          React 19 Frontend                             │
│      (Vite + Three.js + Lucide Icons + Custom Shaders & Loaders)       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ window.electronAPI
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Bridge Layer (src/tauriBridge.js)                  │
│    Translates legacy API calls into Tauri v2 native invoke() calls     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Tauri Binary IPC / Asset Protocol
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Rust Backend (src-tauri/)                       │
│  - lib.rs: Core IPC commands, config storage, drive detection          │
│  - thumbnails.rs: Native Rayon multi-threaded decoding (image, exr)    │
│  - asset-protocol: Direct local file streaming via convertFileSrc()    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ std::process::Command (headless)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  Blender 3D Headless CLI Automation                    │
│    (scripts/blender_convert.py embedded at compile-time via Rust)      │
└────────────────────────────────────────────────────────────────────────┘
```

### The Bridge Pattern (`src/tauriBridge.js`)
To maintain complete component compatibility across frontend modules, [`src/tauriBridge.js`](../src/tauriBridge.js) exposes `window.electronAPI`:
- Calls `invoke('command_name', { args })` under the hood.
- Shims `@tauri-apps/plugin-dialog` (`openFolderDialog`, `saveImageFileDialog`).
- Bridges Tauri Webview native OS drag-and-drop events (`webview.onDragDropEvent`).
- Uses `convertFileSrc(filePath)` to stream local assets into `<img>`, `<video>`, `<audio>`, and WebGL textures securely.

---

## 3. Rust Native Backend & IPC Command Map

The Rust backend is defined in [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs) and registered via `tauri::generate_handler!`:

| IPC Command | Arguments | Returns | Description |
| :--- | :--- | :--- | :--- |
| `list_drives` | — | `Vec<DriveInfo>` | Enumerates Windows drives (`C:`, `D:`, etc.) with labels and free/total GB using `sysinfo`, plus every other drive letter Windows reports (mapped network drives such as `Z:` → `\\server\share`, subst and virtual drives), then falls back to the drive mappings Windows remembers for the user (`HKCU\Network`) for letters the live list hides, e.g. when the app runs elevated. Network drives are queried in parallel with a 2.5 s cap, so an unreachable share is listed as offline instead of blocking the list. |
| `resolve_path` | `input` | `ResolvedPath` | Validates a path typed into the address bar (`\\mypc\library`, `//mypc/library`, `D:/x`), returns it in Windows form and remembers reachable network shares. Gives up after 15 s with a readable reason (Windows' own error text when there is no friendlier wording). If Windows refuses `\\server\share` but a mapped drive letter points at the same share, that drive's path is used instead. |
| `get_network_locations` / `remove_network_location` | — / `path` | `Vec<NetworkLocation>` | Network shares for the sidebar: typed shares remembered in `network_locations` in `studio_config.json` (newest first, max 10, removable) plus the "network locations" Windows Explorer already has under `%APPDATA%\Microsoft\Windows\Network Shortcuts` (read-only). |
| `read_directory` | `dir_path`, `options` | `DirectoryResult` | Reads folders off the main thread; resolves cached thumbnails immediately. |
| `get_item_details` | `target_path` | `FileItem` | Resolves single item size, modified timestamp, category, and extension. |
| `read_file_buffer` | `file_path` | `Vec<u8>` | Streams raw binary files into JavaScript as `ArrayBuffer` without JSON/Base64 overhead. |
| `generate_thumbnail` | `file_path` | `Option<String>` | High-speed Rust-native thumbnail decoding and disk caching. |
| `save_thumbnail` | `file_path`, `data_url` | `String` | Saves a client-side rendered thumbnail to disk cache. |
| `save_image_file` | `file_path`, `data_url` | `bool` | Exports a viewport snapshot to PNG. |
| `show_in_folder` | `file_path` | `bool` | Spawns Windows Explorer with `/select,<path>`. |
| `open_external` | `file_path` | `bool` | Opens file with default Windows associated application. |
| `get_blender_status` | — | `BlenderStatus` | Scans program files and Steam libraries across drives for `blender.exe`. |
| `set_blender_path` | `new_path` | `BlenderStatus` | Persists user-defined Blender executable path in `studio_config.json`. |
| `convert_asset` | `file_path` | `ConvertResult` | Converts USD/Alembic assets to `.glb` in the background. |
| `render_thumbnail` | `file_path` | `ThumbResult` | Headless Blender EEVEE/Workbench studio thumbnail generation. |
| `get_favorites` / `toggle_favorite` | `item` | `Vec<Value>` | Manages starred folders and assets. |
| `get_cache_stats` / `clear_cache` | — | `CacheStats` | Reports and clears `%APPDATA%/AssetStudioCache`. |
| `get_folder_icons` / `set_folder_icon` | — / `folder_path`, `icon` | `FolderIconState` | The user's folder icon choices (`assignments`, keyed by lower-cased folder path, value `lib:<id>` or `custom:<id>`) and imported icons (`custom`). `set_folder_icon` with no `icon` resets the folder. |
| `import_folder_icons` / `remove_folder_icon` | `file_paths` / `icon_id` | `FolderIconState` | Copies the user's PNG / SVG / ICO / WebP / JPG files (max 2 MB each) into the icon store, or removes one (folders using it revert to their default icon). |
| `get_system_folder_icon` | `folder_path` | `Option<String>` | Windows only. The icon File Explorer shows for a folder customised through `desktop.ini` (`IconResource` / `IconFile`, including icons inside `imageres.dll` and similar), exported once as a 96 px PNG under `AssetStudioCache/folder_icons`. `None` for plain folders. |

---

## 4. High-Performance Pipelines (The 4 Rust Pillars)

### Pillar 1: Zero-Copy Raw IPC Binary Streaming
- **Problem**: Passing large files (100MB+ textures, videos, models) through Tauri IPC encoded as JSON numbers or Base64 strings creates severe memory bloat and garbage collection pauses.
- **Solution**: `read_file_buffer` returns `Vec<u8>`, which Tauri streams directly as binary memory. In `src/tauriBridge.js`, it is sliced directly into `ArrayBuffer` without deserialization overhead.

### Pillar 2: Multi-Threaded Parallel Directory Indexing
- **Implementation**: [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs)
- Uses `std::fs::read_dir` combined with metadata caching.
- Skips expensive per-file `stat` calls where directory entry metadata is already available.
- Ignores system hidden folders (`$RECYCLE.BIN`, `System Volume Information`, `node_modules`).

### Pillar 3 & 4: Native Rust Thumbnail Generation (`src-tauri/src/thumbnails.rs`)
- **Native Decoders**:
  - `image` crate: PNG, JPEG, WebP, BMP
  - `exr` crate: OpenEXR (extracts half/float RGB and Combined/Beauty channels)
  - `tiff` crate: TIFF textures (8-bit and 16-bit uncompressed and LZW)
  - `zune-jpeg`: Ultra-fast SIMD JPEG decoding
- **Thumbnail Caching**:
  - MD5 hash calculated from `file_path + modified_timestamp + size`.
  - Cached as high-quality JPEG in `%APPDATA%/AssetStudioCache/thumbs/<hash>.jpg`.
  - Instant subsequent folder opens: zero re-decoding required.

---

## 5. Frontend Workspaces & Creative DCC Features

### 🧊 3D Studio Viewport ([`src/components/Viewport3D.jsx`](../src/components/Viewport3D.jsx))
- **Supported 3D Formats**: `.obj`, `.fbx`, `.gltf`, `.glb`, `.stl`, `.ply`, `.usd`, `.usda`, `.usdc`, `.usdz`, `.abc`.
- **Shading Modes**:
  - Lit PBR (Studio 3-point, neutral diffuse, sunset rim, high-contrast key)
  - Clay (neutral sculpting matte)
  - Normal Map visualization
  - Full Wireframe & Optimized Wireframe Overlay (uses pre-allocated typed arrays for fast line segments without V8 heap spikes)
- **Features**: Turntable 360° spin, skeletal animation playback, real-time vertex/triangle/mesh statistics, bounding box framing.

### 🌅 32-Bit Float HDR & EXR Inspector ([`src/components/HdrExrInspector.jsx`](../src/components/HdrExrInspector.jsx))
- **Equirectangular Skybox & Flat Viewer**: Interactive spherical environment preview.
- **Exposure (EV) Controls**: Real-time slider from EV -60 to +60.
- **Hold-E Interactive EV Drag**: Hold **`E`** and drag mouse left/right to adjust exposure interactively (like professional DCCs). Keys `+`/`-` step by 0.5 EV, `0` resets.
- **Tone-Mapping Operators**: ACES Filmic, AgX, Reinhard, Cineon, Linear.
- **Precision Color Eyedropper**: Inspects raw 32-bit linear floating-point RGB, normalized hex, and luminance per pixel.
- **RGB Channel Soloing**: Isolate Red, Green, Blue, Alpha, or Luminance channels on the fly.

### ⚖️ NVIDIA iCAT-Style Image Comparison ([`src/components/CompareView.jsx`](../src/components/CompareView.jsx))
- Side-by-side dual viewport (Slot A vs Slot B).
- Split-screen interactive wipe curtain.
- Difference blend mode with gain multiplier.
- Instant A/B toggle flipping.
- Synchronized pan and zoom.

### 🗂️ Folder Views (Large icons / Details)
- **View switcher** (breadcrumb bar, right side) toggles between **Large icons** (the thumbnail grid, default) and **Details** (an Explorer-style list with Name, Date modified, Type and Size columns). The choice is remembered in `localStorage` (`cg_artist_folder_view`). Details rows load no thumbnails, so very large folders stay light, and clicking a column header sorts by it (folders always stay on top).
- **Ctrl + mouse wheel** resizes thumbnails (120–500 px) in **Large icons only**; in Details it is ignored (the webview's page zoom is still blocked). The wheel listener lives on the always-rendered `.asset-view` wrapper in [`AssetGrid.jsx`](../src/components/AssetGrid.jsx), not on the grid element, because the grid does not exist while a folder is empty or loading and a listener attached then was never re-attached.

### 🎨 Folder Icons (right-click → Change icon)
- **Windows folder icons**: folders customised in File Explorer show their own icon in the grid, Details view and sidebar. `read_directory` marks only folders that are read-only or system (the only ones Explorer applies a `desktop.ini` to) with `systemIcon: true`, which costs no extra disk access; the webview then asks `get_system_folder_icon` for those folders only, lazily and once per session. [`folder_icons.rs`](../src-tauri/src/folder_icons.rs) parses the `desktop.ini` and extracts the icon with `PrivateExtractIconsW` (raw FFI, no extra crate).
- **Icon library**: right-click a folder (card, Details row or sidebar entry) → **Change icon…** opens a picker with about 85 neutral icons grouped for CG work (3D, texturing, lighting, compositing & VFX, animation, media, documents, code & tools, general), a search box, and **Use default icon**. The icons are Lucide glyphs plus four drawn for this app (mesh, UV, sculpt, material) in [`src/utils/folderIconLibrary.js`](../src/utils/folderIconLibrary.js); no software logos are bundled (trademarks). Icon ids are saved in the user's settings and must never be renamed.
- **My icons**: **Import icons…** copies PNG / SVG / ICO / WebP / JPG files into the icon store so users can add software logos or studio marks themselves; they show in the picker and can be removed there.
- **Storage**: choices live in `folder_icons.json` (plus an `folder_icons/` image folder) and are never written to the folder's `desktop.ini`. The installed build keeps them in the app data folder; the portable exe (no `uninstall.exe` beside it) keeps them in `CG Artist File Browser Data` next to the exe, falling back to app data if that folder is not writable. They are not part of the thumbnail cache, so **Clear cache** does not touch them.
- **Performance**: nothing loads at startup except one small JSON read; image icons are plain lazy `<img>` tags.

### 🎬 Media Review Players
- **Video Player ([`src/components/VideoPlayer.jsx`](../src/components/VideoPlayer.jsx))**: Frame-accurate scrubber, SMPTE timecode (24, 25, 29.97, 30, 60 fps), playback speed, exposure adjustments.
- **Audio Player ([`src/components/AudioPlayer.jsx`](../src/components/AudioPlayer.jsx))**: Decoded waveform visualizer, loop controls, real-time stereo VU meter.
- **Image Viewer ([`src/components/ImageViewer.jsx`](../src/components/ImageViewer.jsx))**: Pan/zoom/rotate with native TIFF, TGA, WebP, PNG, JPG decoding.
- **Render Texture Viewer ([`src/components/TxTexViewer.jsx`](../src/components/TxTexViewer.jsx))**: opens Arnold `.tx` and RenderMan `.tex` files (category `texture`, but routed to this viewer instead of the Image Viewer by extension in `App.jsx`). Both are TIFF files (classic or BigTIFF) where every mip level is its own image stored as tiles, with a few extra tags: Pixar's texture format / wrap modes (33302-33304) and OpenImageIO's notes in the ImageDescription tag. Nothing new is bundled: [`src/utils/txTexDecoder.js`](../src/utils/txTexDecoder.js) reads the IFD chain itself and decodes tiles (none, LZW, PackBits, deflate via the `fflate` that ships with three; horizontal and floating point predictors; 8/16-bit integer, 16/32-bit float, planar or chunky, strips or tiles, either byte order). Because levels are tiled, any level or any rectangle of it can be decoded alone (`decodeRegion`, `decodeLevelReduced`), so an 8K texture is inspected pixel for pixel without holding it in memory; decoded tiles are cached (96 MB) so slider moves are instant. Grid thumbnails decode the smallest mip level of at least 256 px (see `thumbnailService.js`), not the full image.
  - **Texture tab**: one mip level at a time (levels over 4096 px are averaged down for display), RGB / R / G / B / A, zoom and pan. Floating point data is shown with an sRGB curve.
  - **In the render tab**: [`src/utils/txTexAnalysis.js`](../src/utils/txTexAnalysis.js) holds all the maths and no UI. The texture's width in render pixels is `frame width × coverage ÷ repeats`; texture pixels per render pixel is `texture width ÷ that`. Its log2 picks the mip level(s) like a trilinear filter (`pickMipLevels`), and `judge()` turns the ratio into the verdict (below 0.5 soft, 0.5-0.9 slightly soft, 0.9-2 sharp, 2-4 more than enough, above 4 overkill) and the recommended power-of-two size. [`src/utils/txTexPreview.js`](../src/utils/txTexPreview.js) paints the footprint onto a canvas that is exactly one canvas pixel per render pixel (decoding only the visible region of the chosen levels) and the viewer magnifies it without smoothing. Clicking a level in the list while on this tab tests "what if the texture were only this big".
  - **Unsupported on purpose** (clear message shown, the size-based verdict still works): PixarLog / Pixar "lossless" compression, JPEG compression, palette / CMYK / YCbCr data, OpenEXR-based `.tx`/`.tex` (and Pixar's own `-format pixar`), RenderMan ripmaps beyond the normal pyramid. A `.tex` that is not a TIFF (for example a LaTeX file) is reported as such.
- **PDF Viewer ([`src/components/PdfViewer.jsx`](../src/components/PdfViewer.jsx))**: Continuous-scroll PDF reader built on [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`). Bytes arrive through the same raw `read_file_buffer` IPC; pages are rasterised only while near the viewport, so large documents stay light. Page jump and counter, zoom (`Ctrl`+wheel, `+`/`-`), fit width, fit page, 100%, rotate, drag-to-pan, previous/next PDF in the folder. The engine and its worker are loaded lazily by [`src/utils/pdfLoader.js`](../src/utils/pdfLoader.js) the first time a PDF is opened or thumbnailed, so startup and the main bundle are unaffected. Grid thumbnails render page 1 and use the same disk cache as every other thumbnail. Not included (yet): text selection/search, annotations, form filling.

---

## 6. External Integrations (Blender Headless Engine)

The background conversion script ([`scripts/blender_convert.py`](../scripts/blender_convert.py)) is embedded directly into the Rust binary at compile-time:
```rust
const BLENDER_CONVERT_SCRIPT: &str = include_str!("../../scripts/blender_convert.py");
```
If the script is missing from disk, Rust automatically writes it to `%APPDATA%/AssetStudioCache/blender_convert.py`.

### Capabilities:
1. **USD & Alembic Conversion**: `blender -b --factory-startup -P blender_convert.py -- convert_glb <input> <output.glb>`
   - Converts `.usd`, `.usda`, `.usdc`, `.usdz`, `.abc` into optimized `.glb` models for WebGL display.
2. **Headless Thumbnail Rendering**: `blender -b --factory-startup -P blender_convert.py -- thumbnail <input> <output.png>`
   - Sets up a studio 3-point light rig, camera framing, neutral clay material, and renders via EEVEE / Workbench in headless mode.

---

## 7. Directory Structure Reference

```
Local_WebFileBrowser_Tauri/
├── .github/
│   └── workflows/
│       ├── ci.yml                 # Cargo check & lint verification
│       └── release.yml            # Automated GitHub release build on tag push (v*)
├── docs/
│   ├── ARCHITECTURE.md            # This document
│   └── ROADMAP.md                 # Feature ideas and prioritized roadmap
├── release/                       # Output folder for compiled .exe and installers
├── scripts/
│   ├── blender_convert.py         # Headless Blender 3D conversion & render script
│   └── release.js                 # Release orchestrator (bumps versions, builds, tags)
├── src/
│   ├── components/
│   │   ├── AssetGrid.jsx          # Folder view host: Large icons thumbnail cards, drag-and-drop, Ctrl+wheel resize
│   │   ├── DetailsView.jsx        # Explorer-style Details list (name, date modified, type, size)
│   │   ├── AudioPlayer.jsx        # Waveform visualizer & stereo VU meter
│   │   ├── CompareView.jsx        # Split-screen image comparison tool
│   │   ├── DragDropOverlay.jsx    # Full-window drag-and-drop overlay
│   │   ├── DropErrorModal.jsx     # Drop validation modals
│   │   ├── FolderContextMenu.jsx  # Right-click menu on folders (Change icon / Use default icon)
│   │   ├── FolderIcon.jsx         # One folder's icon: user pick, Windows custom icon or default
│   │   ├── FolderIconPicker.jsx   # "Change icon" dialog (library, my icons, search)
│   │   ├── HdrExrInspector.jsx    # 360° skybox, EV grade, eyedropper, false color
│   │   ├── Header.jsx             # Search bar, filter pills, theme toggle
│   │   ├── ImageViewer.jsx        # 2D pan/zoom image & texture viewer
│   │   ├── PdfViewer.jsx          # Continuous-scroll PDF viewer (pdf.js)
│   │   ├── SettingsModal.jsx      # Blender path settings & cache management
│   │   ├── TxTexViewer.jsx        # Arnold .tx / RenderMan .tex viewer: mip levels, "will it be sharp enough?" check
│   │   ├── PathInput.jsx          # Address-bar text box for typed folder / network paths
│   │   ├── Sidebar.jsx            # Drive list, network locations, pinned favorites
│   │   ├── VideoPlayer.jsx        # SMPTE frame-accurate video review player
│   │   └── Viewport3D.jsx         # Three.js 3D viewport (PBR, wireframe, clay, turntable)
│   ├── styles/
│   │   └── index.css              # Dark/light theme design system
│   ├── utils/
│   │   ├── assetLoader.js         # Three.js loaders (OBJ, FBX, GLTF, STL, PLY, USDZ, HDR)
│   │   ├── exrLoaderExtended.js   # Multilayer OpenEXR loader
│   │   ├── folderIconLibrary.js   # Built-in folder icon set (ids are saved in user settings)
│   │   ├── folderIconStore.js     # Folder icon state hook, context and Windows-icon lookup
│   │   ├── formatHelpers.js       # File category resolution & formatting utilities
│   │   ├── imageDecoder.js        # TIFF/TGA client-side buffer decoding
│   │   ├── pathHelpers.js         # Drive and UNC-aware breadcrumbs / parent folder
│   │   ├── pdfLoader.js           # Lazy pdf.js loader (engine + worker)
│   │   ├── thumbnailService.js    # Thumbnail generation queue & cache lookup
│   │   ├── txTexAnalysis.js       # Sharpness maths and plain-words verdicts for .tx / .tex
│   │   ├── txTexDecoder.js        # TIFF mip-pyramid reader for .tx / .tex (tiles, region decoding)
│   │   └── txTexPreview.js        # Canvas painting of a texture at final-render pixel size
│   ├── App.jsx                    # Root view routing & global state
│   ├── main.jsx                   # React 19 entrypoint
│   └── tauriBridge.js             # window.electronAPI <-> Tauri v2 IPC bridge
├── src-tauri/
│   ├── src/
│   │   ├── folder_icons.rs        # Folder icon store (portable-aware) and Windows desktop.ini icon export
│   │   ├── lib.rs                 # Rust IPC commands, drive scan, config storage
│   │   ├── main.rs                # Windows entrypoint (#![windows_subsystem = "windows"])
│   │   ├── network.rs             # UNC path parsing, timeout-guarded probe, extra/network drives, Explorer network shortcuts
│   │   └── thumbnails.rs          # Native Rust multi-threaded thumbnail decoders
│   ├── Cargo.toml                 # Rust dependencies (tauri, rayon, image, exr, sysinfo)
│   └── tauri.conf.json            # Window dimensions, bundle targets, asset protocol
├── package.json                   # Pure Tauri scripts and dependencies
├── vite.config.mjs                # Vite build configuration
└── README.md                      # Public documentation and versioned roadmap
```

---

## 8. Build & Release Engineering (.exe & Installers)

### Prerequisites (Windows)
1. **Node.js**: v20 or later (`node -v`)
2. **Rust Toolchain**: Stable MSVC (`rustup default stable-x86_64-pc-windows-msvc`)
3. **Microsoft C++ Build Tools**: Visual Studio 2022 Desktop C++ or Build Tools
4. **WebView2 Runtime**: Pre-installed on Windows 10/11

### Essential Development & Build Commands

```bash
# 1. Install dependencies
npm install

# 2. Run in development mode (hot-reloading Vite + Tauri window)
npm run dev
# or: npm run tauri:dev

# 3. Compile frontend only
npm run build

# 4. Compile native production executables (Portable .exe & NSIS Installer)
npm run tauri:build
```

### Build Artifact Outputs
When `npm run tauri:build` completes:
- **Standalone Portable `.exe`**:
  ```
  src-tauri/target/release/cg-artist-file-browser.exe  (~12 MB)
  ```
  *Requires no installation, runs immediately on any Windows 10/11 machine.*
- **Windows Setup Installer (NSIS)**:
  ```
  src-tauri/target/release/bundle/nsis/CG Artist File Browser_<version>_x64-setup.exe  (~3 MB)
  ```
  *Provides a setup wizard with Start Menu shortcuts and uninstaller.*

---

## 9. Git Repository Configuration & Release Automation

### Canonical Repository
- **Repository**: `rajhansgithub/CG_Artist_File_Browser` (primary branch `main`; previously named `CG_Artist_File_Browser_Tauri`)
- **Clone (HTTPS)**: `https://github.com/rajhansgithub/CG_Artist_File_Browser.git`
- **Releases**: https://github.com/rajhansgithub/CG_Artist_File_Browser/releases
- **Actions (CI/CD)**: https://github.com/rajhansgithub/CG_Artist_File_Browser/actions
- **Issues**: https://github.com/rajhansgithub/CG_Artist_File_Browser/issues

### Verifying Git Remote
Always ensure your local repository's `origin` points to the canonical repo:
```bash
git remote -v
# Output should be:
# origin  https://github.com/rajhansgithub/CG_Artist_File_Browser.git (fetch)
# origin  https://github.com/rajhansgithub/CG_Artist_File_Browser.git (push)

# If the remote needs to be updated:
git remote set-url origin https://github.com/rajhansgithub/CG_Artist_File_Browser.git
```

### 🏷️ Release Versioning Rules (SemVer Standard)

All agents (**Antigravity**, **Claude Code**) and human contributors must strictly adhere to **Semantic Versioning (`MAJOR.MINOR.PATCH`)** when determining the next release version:

| Release Type | Next Version Example (from v1.0.10) | Criteria & Rules |
| :--- | :--- | :--- |
| **Patch Release** *(Most common next step)* | `v1.0.11` | Bug fixes, small UI adjustments, dependency updates, and maintenance. |
| **Minor Release** *(Feature milestone)* | `v1.1.0` | Introducing new features or significant enhancements (e.g. implementing items from [`docs/ROADMAP.md`](ROADMAP.md) like USD hierarchy inspection, image sequence playback, or batch converter). |
| **Major Release** | `v2.0.0` | Complete overhaul or breaking changes in workflow/architecture. |

> [!IMPORTANT]
> **Why `v1.0.11` and NOT `v1.0.1` or `v1.1`?**
> Software version numbers are **dot-separated integers**, not decimal numbers:
> - The `10` is an integer representing the 10th patch.
> - Incrementing `10` produces `11`, which makes the next patch **`1.0.11`** (followed by `1.0.12`, `1.0.13`, etc.).
> - It does **not** roll over to `1.0.1` (which was an earlier release) or jump to `1.1.0` unless new features are added.

### 🤖 Guidelines for AI Assistants (Antigravity & Claude Code)
When performing development tasks, versioning, builds, or refactoring in this repository:
1. **Root Directory Hygiene**: Only `README.md` and `LICENSE` belong in the root directory. All architecture docs, specifications, and roadmaps must be placed under `docs/`.
2. **Version Bump Rule**: Check current version in `package.json`. If making fixes/chores, increment the patch (`1.0.10` → `1.0.11`). If implementing new feature sets from `docs/ROADMAP.md`, bump the minor (`1.0.10` → `1.1.0`).
3. **Build Verification**: Always verify both the frontend (`npm run build`) and the Rust backend (`cargo check --manifest-path src-tauri/Cargo.toml`) before tagging or releasing.
4. **Automated Release**: Always use `npm run release <version>` (e.g., `npm run release 1.0.11`) to ensure `package.json`, `tauri.conf.json`, `Cargo.toml`, and Git tags remain 100% synchronized.

### Releasing a New Version (`scripts/release.js`)
To bump version, build production binaries, organize the `release/` folder, create Git tags, and trigger GitHub Releases:
```bash
# For a patch release:
npm run release 1.0.11

# For a feature milestone:
npm run release 1.1.0
```

**What this automated script does**:
1. Updates `package.json` to the target version.
2. Updates `src-tauri/tauri.conf.json` to the target version.
3. Updates `src-tauri/Cargo.toml` to the target version.
4. Executes `npx tauri build` to compile the optimized binary and NSIS installer.
5. Populates `release/` with all release-ready filenames:
   - `CG-Artist-File-Browser-Setup-v<version>.exe`
   - `CG-Artist-File-Browser-v<version>-Portable.exe`
   - `CG-Artist-File-Browser-Portable.exe` (Latest permanent link)
6. Commits: `chore(release): bump version to <version>`.
7. Tags Git: `v<version>`.
8. Pushes `main` and `v<version>` to GitHub, triggering the GitHub Actions automated release pipeline.

---

## 10. Starter Checklist for New Projects

When using this architecture as a starter template for a new application:
1. **Change App Identifier & Names**:
   - In `src-tauri/tauri.conf.json`: Update `"productName"` and `"identifier"` (e.g. `com.company.appname`).
   - In `src-tauri/Cargo.toml`: Update `name` and `description`.
   - In `package.json`: Update `name` and `description`.
2. **Icons**:
   - Replace PNG icons inside `src-tauri/icons/` using `npx tauri icon <source-image.png>`.
3. **Rust IPC Customization**:
   - Add new Rust commands in `src-tauri/src/lib.rs` and register them in `tauri::generate_handler![...]`.
   - Add corresponding wrapper methods in `src/tauriBridge.js`.
4. **Frontend Workspaces**:
   - Add or replace React components in `src/components/`.
5. **Release Automation**:
   - Update repository URLs in `scripts/release.js` and `.github/workflows/release.yml`.

---
*Created and maintained for [CG_Artist_File_Browser](https://github.com/rajhansgithub/CG_Artist_File_Browser).*
