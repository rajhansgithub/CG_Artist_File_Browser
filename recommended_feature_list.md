# CG Artist File Browser — Recommended Feature List

This document outlines proposed new features, user interface enhancements, and pipeline integrations designed specifically for CG, 3D, and VFX studio workflows.

---

## 📑 Table of Contents

1. [Asset Browser & Navigation Enhancements](#1-asset-browser--navigation-enhancements)
2. [3D Viewport Innovations](#2-3d-viewport-innovations)
3. [HDR & 32-bit OpenEXR Studio Inspector](#3-hdr--32-bit-openexr-studio-inspector)
4. [Video & Playblast Review Player](#4-video--playblast-review-player)
5. [Studio Audio & Foley/SFX Player](#5-studio-audio--foleysfx-player)
6. [Dual Viewport & Media Comparison Mode](#6-dual-viewport--media-comparison-mode)
7. [UI Ergonomics, Layout & Visual Polish](#7-ui-ergonomics-layout--visual-polish)
8. [Pipeline & DCC Studio Integrations](#8-pipeline--dcc-studio-integrations)
9. [Prioritized Implementation Roadmap](#9-prioritized-implementation-roadmap)

---

## 1. Asset Browser & Navigation Enhancements

### 1.1 Native Drag-and-Drop into External DCCs (Blender, Maya, Unreal, Photoshop)
- **Concept**: Enable direct OS-level drag-and-drop from the browser's asset grid into external digital content creation applications.
- **Workflow Benefit**: Drag `.fbx`, `.obj`, `.blend`, `.gltf`, `.exr`, video reference clips, or audio files directly onto a Blender 3D viewport, Maya workspace, Unreal Engine Content Browser, or Photoshop window.
- **Technical Target**: Electron native drag API (`event.sender.startDrag({ file: filePath, icon: iconPath })`) in `electron/main.js` triggered by `onDragStart` in `src/components/AssetGrid.jsx`.

### 1.2 List / Table Details View (Alongside Grid View)
- **Concept**: A toggleable detailed table view alongside the thumbnail grid.
- **Columns**:
  - Thumbnail preview icon
  - File Name
  - Format Badge (`FBX`, `OBJ`, `EXR`, `HDR`, `TIFF`, `MP4`, `WAV`, etc.)
  - File Size (formatted in KB / MB / GB)
  - Triangle / Vertex Count (for 3D models)
  - Dimensions / Resolution / Duration (for images, HDRs, videos, audio)
  - Date Modified
- **Interactions**: Sortable column headers (ascending / descending) and resizable column widths.

### 1.3 Collapsible Quick Inspector Drawer (Right Sidebar)
- **Concept**: An optional slide-out or collapsible right panel in Grid view showing deep metadata for the currently highlighted asset without leaving the current directory.
- **Contents**:
  - Live interactive mini-turntable (3D), exposure-controlled preview (HDR/EXR), video player, or audio waveform.
  - Geometry diagnostics: Triangle count, vertex count, bounding box world dimensions, material list.
  - Media diagnostics: Video codec, FPS, timecode duration, audio sample rate, bit depth.
  - Action buttons: *Open in Full Studio*, *Send to Blender*, *Copy File Path*, *Reveal in Explorer*.
  - User tags and status labels (*Approved*, *WIP*, *Needs Revision*).

### 1.4 Spacebar "Quick Look" Modal
- **Concept**: Tapping **Spacebar** on any selected file opens an instant, lightweight floating modal with an interactive preview (3D model, HDR, image, video playblast, or audio waveform). Tapping **Spacebar** again or **Esc** dismisses it immediately.
- **Workflow Benefit**: Rapidly review dozens of assets in seconds without losing folder scroll position (identical to macOS Quick Look and Adobe Bridge).

### 1.5 Custom Right-Click Context Menu
- **Concept**: Dark-themed context menu when right-clicking on cards or folder items:
  - *Open in Studio*
  - *Open with Default System App*
  - *Reveal in Windows Explorer*
  - *Copy Absolute Path* / *Copy File Name*
  - *Add to Compare (Slot A / Slot B)*
  - *Pin to Favorites*
  - *Move to Trash*

### 1.6 Browser Navigation History (Back / Forward)
- **Concept**: Add `<` (Back) and `>` (Forward) history buttons next to the breadcrumbs bar with keyboard shortcuts (`Alt + Left Arrow` / `Alt + Right Arrow`), maintaining a navigation stack across directories.

### 1.7 PBR Texture Set Auto-Grouping
- **Concept**: Automatically detect and group companion texture maps (e.g. `Character_BaseColor.png`, `Character_Roughness.png`, `Character_Normal.png`, `Character_Metallic.png`, `Character_Displacement.exr`) into a single expandable asset group card.

---

## 2. 3D Viewport Innovations

### 2.1 MatCap Shading Modes
- **Concept**: Complement the current Lit, Wireframe, Normals, and Clay modes with dedicated sculpting MatCaps:
  - **Red Wax**: Classic digital sculpting matcap for form reading and depth perception.
  - **Chrome / Mirror**: Identifies surface dents, pinching, and curvature irregularities.
  - **Zebra Stripes**: Automotive and product design diagnostic for curvature continuity across surface seams.
  - **Clay / Ceramic**: Smooth studio matte shading for silhouette evaluation.
- **Technical Target**: Three.js `MeshMatcapMaterial` with bundled high-efficiency matcap textures.

### 2.2 Interactive Environment Lighting Rotation (HDRI / Rig Spin)
- **Concept**: Rotate the environment lighting rig independently of the camera or model.
- **Interaction**: Hold `Shift + Right Click + Drag` or adjust a 0°–360° rotation slider in the HUD toolbar.
- **Workflow Benefit**: Allows artists to inspect highlights, specular reflections, and roughness response across every facet of the model without altering camera framing.

### 2.3 Viewport Orientation Gizmo & Orthographic Views
- **Concept**: An interactive 3D XYZ axis cube in the top-right corner.
- **Features**:
  - Click any face (Front, Right, Top, Back, Left, Bottom) to snap the camera to that angle.
  - Hotkey support: Numpad `1` (Front), `3` (Right), `7` (Top), `9` (Opposite).
  - One-click toggle between **Perspective** and **Orthographic** projection to audit model silhouettes and proportions without focal length distortion.

### 2.4 Bounding Box Cage & Dimension Rulers
- **Concept**: Toggle an optional wireframe bounding box cage around the model with dimension callouts (Width × Depth × Height) displayed in centimeters or meters.

### 2.5 Backface Culling & Double-Sided Mesh Toggle
- **Concept**: Toggle between `material.side = THREE.FrontSide` and `THREE.DoubleSide`.
- **Workflow Benefit**: Quickly detect inverted normals, non-manifold geometry, or unintended single-sided polygon holes before exporting to game engines.

### 2.6 Multi-Camera Focal Length / FOV Presets
- **Concept**: Presets for camera focal length:
  - **18mm** (Ultra Wide / Dramatic)
  - **35mm** (Wide Angle)
  - **50mm** (Natural / Standard)
  - **85mm** (Portrait / Character Presentation)
  - **200mm** (Telephoto / Minimal Perspective Skew)

---

## 3. HDR & 32-bit OpenEXR Studio Inspector `[COMPLETED]`

### 3.1 Multi-Layer / Multi-Pass EXR Channel Selector `[COMPLETED]`
- **Concept**: VFX render passes packaged within multi-layer OpenEXRs (e.g. `Beauty`, `Diffuse`, `Specular`, `Cryptomatte`, `Z-Depth`, `Normals`).
- **Feature**: A layer selection dropdown in the inspector header to switch and preview individual render AOVs in 32-bit floating point, complemented with fast 1-click channel isolation buttons (`RGB`, `R`, `G`, `B`, `A`, `LUM`).

### 3.2 Real-Time Dynamic Range Luminance Histogram `[COMPLETED]`
- **Concept**: A live RGB / Luminance histogram bar graph displayed inside the floating inspector panel.
- **Workflow Benefit**: Visually highlights pure black clipping (underexposure), 18% midtone distribution, 1.0 highlight clipping thresholds, and super-white dynamic range headroom above 1.0 (with real-time `+EV HDR` headroom readout).

### 3.3 360° Studio Lighting Reference Spheres `[COMPLETED]`
- **Concept**: When viewing HDRIs in 360° Panoramic Skybox mode, toggle ground-level 3D reference inspection balls on a studio turntable platform:
  - **Chrome Mirror Ball**: Pinpoints exact light source directions and specular sharpness (`metalness: 1.0, roughness: 0.0`).
  - **50% Gray Matte Ball**: Visualizes diffuse light wrap and shadow softness (`color: 0x808080, roughness: 0.95`).
  - **White Specular Ball**: Evaluates highlight roll-off and color balance (`color: 0xffffff, roughness: 0.16`).

### 3.4 Precision 32-bit Float Pixel Eyedropper `[COMPLETED]`
- **Concept**: Enhanced Pixel Probe displaying true linear floating-point values (e.g. `R: 14.28, G: 8.42, B: 0.95`), Hex code, and IRE exposure ratings under the cursor, with 1-click pin/lock and copy-to-clipboard functionality.

### 3.5 White Balance & Tint Sliders `[COMPLETED]`
- **Concept**: Color temperature (Kelvin: 2000K – 10,000K, Planckian locus normalized against 6500K D65) and Green/Magenta tint adjustment sliders applied in the fragment shader before tone mapping.

### 3.6 Split-Screen Wipe / Curtain Comparison `[COMPLETED]`
- **Concept**: Interactive in-viewport draggable curtain wipe dividing Tonemapped (ACES / AgX / selected operator) against Raw Linear or False Color Heatmap.

---

## 4. Video & Playblast Review Player

CG, 3D animators, and VFX artists constantly review turntable renders, playblasts, camera tracking plates, simulation caches, and live reference clips.

### 4.1 Supported Video Formats
- `.mp4`, `.webm`, `.mov`, `.mkv`, `.avi`

### 4.2 Frame-Accurate Scrubbing & Stepping
- **Frame-by-Frame Navigation**: Step exactly 1 frame forward or backward with arrow keys (`Left` / `Right`) or `,` / `.`.
- **SMPTE Timecode & Exact Frame Counter**: Toggle display between `HH:MM:SS:FF` timecode and exact frame indices (e.g., `Frame 108 / 240`).
- **Configurable Production Frame Rates**: Support standard production rates: `24 fps` (Film), `25 fps` (PAL), `29.97 / 30 fps` (NTSC / Game standard), and `60 fps`.

### 4.3 A-B Loop Points (Cycle Review)
- Set In-point (`I` or `[`) and Out-point (`O` or `]`) to seamlessly loop animation sequences (walk/run cycles, idle loops, physics simulation repeats).

### 4.4 Variable Playback Speeds
- Preset speed multiplier toggles: `0.25x`, `0.5x`, `1.0x`, `1.5x`, `2.0x` for slow-motion breakdown of animation arcs, weight, and secondary motion.

### 4.5 High-Resolution Frame Grab / Snapshot
- Instant 1-click button (and hotkey `S`) to export the current frame as an uncompressed `.png` image or copy to clipboard for paintovers, dailies markup, and client reviews.

### 4.6 Video Aspect Ratio & Safe Areas Overlay
- Toggle standard broadcast and cinematic aspect ratio guides and safe area overlays (Title Safe, Action Safe, 16:9, 2.39:1 Anamorphic, 1:1, 9:16).

---

## 5. Studio Audio & Foley/SFX Player

Sound designers and game developers need fast, zero-latency inspection of game audio, foley, voiceover dialog, and ambient loops.

### 5.1 Supported Audio Formats
- `.wav` (including 16-bit, 24-bit, and 32-bit float broadcast WAV), `.mp3`, `.ogg`, `.flac`, `.aac`, `.aiff`

### 5.2 Interactive Waveform Visualizer
- High-fidelity interactive audio waveform displaying amplitude peaks, silence regions, transients, and playback head scrubbing.
- Zoomable waveform timeline for inspecting transient attack and micro-cuts.

### 5.3 Audio Metadata & Format Inspector
- **Technical Specs**: Sample Rate (`44.1 kHz`, `48 kHz`, `96 kHz`), Bit Depth (`16-bit`, `24-bit`, `32-bit float`), Channels (`Mono`, `Stereo`, `5.1 Surround`), Bitrate, and total file length.
- **Audio Peak Level (VU Meter)**: Stereo dBFS peak meter indicating dynamic range and digital clipping warnings (signals exceeding 0 dBFS).

### 5.4 Seamless Game Audio Loop Mode
- One-click seamless loop playback button to verify audio loops (ambient environmental soundscapes, vehicle engine loops, footstep cycles) without popping or clicks at the boundary.

### 5.5 Pitch Shift & Playback Rate Tuning
- Non-destructive pitch adjustment (semitones: -12 to +12) and tempo adjustment for sound design experimentation.

---

## 6. Dual Viewport & Media Comparison Mode

### 6.1 Synchronized 3D Camera Lock
- When comparing two 3D models, locking OrbitControls between Viewport A and Viewport B mirrors orientation and zoom in real time (ideal for **LOD0 vs LOD1** or **Retopology vs High-Poly sculpt**).

### 6.2 Synchronized Dual Video Player (Take A vs Take B)
- Play two playblasts, turntable renders, or composite revisions side-by-side synchronized to the exact same frame index.
- Scrubbing on one timeline scrubs both video streams simultaneously.

### 6.3 Split-Screen Wipe / Curtain Slider Mode
- In addition to side-by-side split panels, allow an overlay mode with a draggable vertical or horizontal divider line over a single unified viewport (before/after curtain wipe for 3D renders, EXRs, textures, and video).

### 6.4 Difference Blend Mode (EXR / Textures / Renders)
- Pixel difference visualization (`Math.abs(A - B)`) to instantly highlight subtle compression artifacts, render noise differences, or texture revisions.

---

## 7. UI Ergonomics, Layout & Visual Polish

### 7.1 Proposed Studio Workspace Wireframe

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  [Logo] CG ARTIST FILE BROWSER  [<] [>]  [Open Folder]   [Search Assets...]   [3D][HDR][Vid][Aud] [Settings] │  <- Header
├─────────────┬──────────────────────────────────────────────────────────┬───────────────┤
│ DRIVES      │ J:\Projects\Characters\Hero_Rig                          │ ASSET INFO    │
│ [C:] [J:]   ├──────────────────────────────────────────────────────────┤ [Interactive  │
│             │  [Card]          [Card]          [Card]         [Card]   │  Mini-3D /    │
│ PINNED      │  Character.fbx   Studio.hdr      Turn.mp4       Step.wav │  Video / Wave]│
│ ★ Projects  │                                                          │               │
│ ★ HDRI Lib  │                                                          │ Triangles: 42k│
│             │                                                          │ Verts: 21.5k  │
│ SUBFOLDERS  │                                                          │ FPS / Rate:24 │
│ > Textures  │                                                          │ Size: 18.4 MB │
│ > Renders   │                                                          │ [Send to DCC] │
│ > Audio     │                                                          │ [Compare]     │
├─────────────┴──────────────────────────────────────────────────────────┴───────────────┤
│ 54 Assets (18 3D Models, 12 HDRIs, 14 Videos, 10 Audio) | 6.2 GB | Drive J: 680 GB Free│  <- Status Bar
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Bottom Studio Status Bar
- Persistent status bar at the bottom displaying:
  - Total items count (e.g. `54 Assets | 18 3D Models | 12 HDRIs | 14 Videos | 10 Audio`).
  - Total folder size on disk.
  - Selected item summary.
  - Current drive free space indicator.
  - Background thumbnail conversion queue status.

### 7.3 Keyboard Shortcuts Cheatsheet Overlay (`?` or `F1`)
- Floating modal overlay displaying all hotkeys:
  - `F`: Focus / Frame model in viewport
  - `Spacebar`: Quick Look preview modal
  - `V`: Flip vertical orientation (HDR/EXR)
  - `Shift + RMB`: Rotate lighting environment
  - `,` / `.`: Step 1 frame backward / forward in video
  - `[` / `]`: Set A-B video loop points
  - `Alt + Left/Right`: Navigate folder history
  - `Ctrl + Wheel`: Zoom thumbnail grid size

### 7.4 Studio Color Themes
- **Obsidian Dark** (default pure neutral `#0a0a0a`)
- **VFX Slate** (deep blue-gray `#0f172a`, familiar to Maya / Nuke users)
- **Blender Dark** (`#212121` with warm neutral accents)
- **High Contrast Studio** (maximum readability under bright studio lighting)

---

## 8. Pipeline & DCC Studio Integrations

### 8.1 "Send to DCC" One-Click Actions
- Configure launch shortcuts in Settings for:
  - **Blender** (`blender.exe` auto-import)
  - **Autodesk Maya**
  - **Unreal Engine**
  - **Adobe Photoshop** / **Affinity Photo** (for EXR/HDR painting)
  - **Marmoset Toolbag**
  - **Audacity** / **Reaper** (for audio assets)

### 8.2 Asset Color Labels & Tagging
- Assign color tags (Red, Orange, Yellow, Green, Blue, Purple) to assets for status tracking (*WIP*, *Review*, *Approved*, *Archived*).
- Filter the asset grid by active color label.

---

## 9. Prioritized Implementation Roadmap

### Phase 1: High-Impact Quick Wins (P1)
- [ ] **Native Drag-and-Drop into DCCs**: Implement Electron drag API for 3D, HDR, video, and audio assets.
- [ ] **Collapsible Quick Inspector Drawer**: Add right-hand metadata drawer in `AssetGrid`.
- [x] **Video Player & Playblast Scrubbing**: Integrated frame-accurate player for `.mp4`, `.mov`, `.webm`.
- [ ] **Interactive Lighting Rotation**: Add `Shift + RMB` environment rotation to `Viewport3D`.
- [ ] **Folder History Back / Forward**: Add `<` and `>` buttons to breadcrumb bar.

### Phase 2: Core Creative Enhancements (P2)
- [x] **Studio Audio & Foley Player**: Waveform rendering, timecode display, and seamless loop mode for `.wav`, `.mp3`.
- [ ] **MatCap Shading Presets**: Integrate Red Wax, Chrome, Zebra, and Clay into `Viewport3D`.
- [ ] **Synchronized Media Comparison**: Dual 3D camera sync and dual video playblast scrub sync.
- [ ] **Spacebar Quick Look**: Floating preview modal for instant 3D/HDR/Video/Audio inspection.
- [ ] **360° Studio Lighting Reference Spheres**: Add mirror ball and gray ball to panoramic inspector.
- [ ] **Bottom Studio Status Bar**: Display folder totals, asset categories, and disk headroom.

### Phase 3: Advanced Studio & Pipeline Tools (P3)
- [ ] **List / Table Details View**: Add toggleable table view with sortable columns.
- [ ] **Right-Click Custom Context Menu**: Context menu for quick file operations.
- [ ] **Split-Screen Wipe / Curtain Comparison**: Draggable divider comparison in `CompareView`.
- [ ] **Multi-Pass EXR Channel Selector**: AOV extraction and channel switching.
- [ ] **"Send to DCC" Direct Launchers**: Configure external program launchers in Settings.
