# CG Artist File Browser (Tauri Edition)

<div align="center">

[![Release](https://img.shields.io/github/v/release/rajhansgithub/CG_Artist_File_Browser?include_prereleases&color=00e5ff&style=flat-square)](https://github.com/rajhansgithub/CG_Artist_File_Browser/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-blue?style=flat-square)](https://github.com/rajhansgithub/CG_Artist_File_Browser)
[![Tauri](https://img.shields.io/badge/Tauri-v2-FFC131?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-r186-black?style=flat-square&logo=three.js)](https://threejs.org/)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

**A blazing-fast, GPU-accelerated local 3D model, HDR/EXR panoramic skybox, texture, video, and audio file browser and inspector tailored for CG, VFX, and Game artists.**

[Features](#-key-features) • [Supported Formats](#-supported-formats) • [Installation & Releases](#-installation--releases) • [Building from Source](#-building-from-source) • [Roadmap](#-incremental-versioning-roadmap)

</div>

---

## ⚡ Overview

**CG Artist File Browser** bridges the gap between traditional file managers and specialized 3D DCC tools. Built with **Tauri v2**, **Rust**, **React 19**, and **Three.js**, it delivers instantaneous local directory indexing, GPU-accelerated previews, 32-bit floating point HDR/EXR analysis, side-by-side image comparison (NVIDIA iCAT-style), and seamless background Blender conversions without heavy desktop overhead.

---

## 🚀 Key Features

### 🖥️ Smart Auto-Switching Viewport
- **Universal Drag & Drop**: Drag any file or folder from Windows Explorer directly into the application.
- **Context-Aware Routing**: Dropping a 3D model switches to the 3D Studio; dropping an HDR/EXR opens the 360° inspector; dropping an image or video switches to their respective viewers; dropping a folder instantly navigates into it.
- **Multi-File Compare Drop**: Drop two images or HDR maps simultaneously to automatically launch the side-by-side comparison workspace.
- **In-App Dragging**: Drag asset cards within the browser directly onto the floating Compare Dock slots.

### 🧊 3D Studio Viewport (WebGL / Three.js)
- **Interactive Orbit Controls**: Smooth orbit, pan, and zoom with auto-centering and framing bounding boxes.
- **Studio Lighting Presets**: Switch between Studio Three-Point, Neutral Diffuse, Sunset Rim, High-Contrast Key, and Rim-Only lighting presets.
- **Shading & Inspection Modes**: Full Lit PBR, Wireframe, Wireframe Overlay, Normal Map Visualization, and Clay mode.
- **Turntable & Animation**: 360° turntable rotation with adjustable speed and full playback controls for rigged skeletal animations.
- **Mesh Statistics**: Real-time vertex count, triangle count, geometry bounding size, and draw-call telemetry.

### 🌅 32-Bit Float HDR & EXR Inspector
- **360° Equirectangular Panoramic Skybox**: Interactive spherical environment preview with smooth horizon locks.
- **Dynamic Exposure EV Controls**: Real-time exposure adjustment spanning EV -10.0 to +10.0.
- **Tone-Mapping Operators**: ACES Filmic, Reinhard, AgX, Linear, and Neutral tone-mapping pipelines.
- **Precision Color Eyedropper**: Inspect raw 32-bit floating-point linear RGB values, normalized hex codes, and luminance per pixel.
- **RGB Channel Soloing**: Isolate Red, Green, Blue, Alpha, or Luminance channels on the fly.

### ⚖️ NVIDIA iCAT-Style Split Comparison Tool
- **Interactive Vertical Wipe Curtain**: Drag the split-screen handle to inspect fine pixel differences between two revisions (Slot A vs Slot B).
- **Synchronized Pan & Zoom**: Pan and zoom both assets in tandem with sub-pixel alignment.
- **Comparison Modes**:
  - `Key 1`: Split-Screen Wipe Slider
  - `Key 2`: Side-by-Side Dual Viewport
  - `Key 3`: Difference Blend Mode
  - `Key 4`: Overlay Blend Mode with opacity slider
  - `Key 5`: Instant A/B Toggle Flips

### ⚙️ Blender 3D Conversion Engine
- **Automatic Background Asset Converter**: Seamlessly opens non-native formats like Universal Scene Description (`.usd`, `.usda`, `.usdc`, `.usdz`), Alembic (`.abc`), and Blender native files (`.blend`) by converting them on the fly to optimized WebGL `.glb`.
- Auto-detects installed Blender instances across standard program directories.

### ⚡ Blazing Local Performance
- **Rust Backend**: Fast multi-threaded disk indexing via `sysinfo`, `walkdir`, and `rayon`.
- **Persistent Disk Caching**: MD5 hash-keyed thumbnail cache on disk ensures instant loads when reopening large folders.
- **Ctrl + Wheel Grid Resizing**: Dynamically adjust thumbnail sizes from 120px to 500px in real-time.

---

## 📁 Supported Formats

| Category | Extensions | Features |
| :--- | :--- | :--- |
| **3D Meshes** | `.obj`, `.fbx`, `.gltf`, `.glb`, `.stl`, `.ply`, `.usd`, `.usda`, `.usdc`, `.usdz`, `.abc` | PBR Shading, Normal Maps, Wireframe, Turntable, Animations |
| **Radiance & HDR** | `.hdr`, `.exr` | 360° Spherical Skybox, 32-bit Float Probe, EV Slider, Tone Mapping |
| **2D Images & Textures**| `.png`, `.jpg`, `.jpeg`, `.webp`, `.tif`, `.tiff`, `.tga`, `.dds`, `.psd`, `.bmp` | Pan/Zoom, Channel Solo, Metadata, iCAT Comparison |
| **Video** | `.mp4`, `.mov`, `.webm`, `.mkv`, `.avi` | Frame scrubber, loop playback, speed control |
| **Audio** | `.wav`, `.mp3`, `.ogg`, `.flac`, `.aac`, `.aiff`, `.m4a` | Waveform visualizer, loop playback, audio properties |

---

## 📦 Installation & Releases

Pre-compiled standalone Windows executables and installers are published with every update on GitHub Releases.

1. Navigate to the [Releases](https://github.com/rajhansgithub/CG_Artist_File_Browser/releases) page.
2. Download the latest release:
   - **`CG-Artist-File-Browser-Setup-*.exe`**: Full Windows installer with desktop shortcut and uninstaller.
   - **`CG-Artist-File-Browser-*-Portable.exe`**: Standalone portable executable (runs without installation).

---

## 🛠️ Building from Source

### Prerequisites
- [Node.js](https://nodejs.org/) (v20+ recommended)
- [Rust](https://rustup.rs/) (v1.80+) with `x86_64-pc-windows-msvc` toolchain
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) or Visual Studio with Desktop C++
- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 10/11)

### Setup & Development

```bash
# Clone the repository
git clone https://github.com/rajhansgithub/CG_Artist_File_Browser.git
cd CG_Artist_File_Browser

# Install frontend dependencies
npm install

# Run in development mode (Vite + Tauri)
npm run tauri:dev
```

### Production Build

```bash
# Build production bundle (.exe & installer)
npm run tauri:build
```
Compiled output will be placed in `src-tauri/target/release/bundle/nsis/`.

---

## 🗺️ Incremental Versioning Roadmap

We follow an iterative release cadence with standalone testable builds for each milestone:

- [x] **v1.0.0-beta**: Initial Tauri v2 desktop release. Full native drag & drop integration, 3D Studio, 32-bit float HDR/EXR inspector, and iCAT comparison dock.
- [ ] **v1.0.1**: Enhanced EXR multilayer pass selector and custom LUT support.
- [ ] **v1.0.2**: Deep search with regex, tag-based asset filtering, and bookmarking.
- [ ] **v1.0.3**: PBR texture set auto-detection (`_BaseColor`, `_Normal`, `_Roughness`, `_Metallic`) and multi-channel preview.
- [ ] **v1.0.4 - v1.0.9**: Incremental performance tuning, batch conversions, and metadata EXIF/IPTC inspector.
- [ ] **v1.1.0**: Stable milestone release.

---

## ⌨️ Controls & Shortcuts

| Action | Control |
| :--- | :--- |
| **Open Asset** | `Double Click` or `Space` on selected asset card |
| **Grid Resize** | `Ctrl + Mouse Wheel` |
| **Orbit 3D Scene** | `Left Click + Drag` |
| **Pan 3D / Image** | `Right Click + Drag` |
| **Zoom** | `Mouse Wheel` |
| **iCAT Wipe Mode** | `1` |
| **Side-by-Side Mode** | `2` |
| **Difference Mode** | `3` |
| **Overlay Mode** | `4` |
| **A/B Instant Flip** | `5` |
| **Reveal in Explorer** | `External Link Icon` on card / Header |

---

## 📄 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

---

<div align="center">
  <sub>Maintained by <a href="https://github.com/rajhansgithub">rajhansgithub</a>. Built with ❤️ for the CG & VFX Community.</sub>
</div>
