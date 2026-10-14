---
title: Release notes
layer: shared
nav: Release notes
summary: What has been added and fixed, grouped by area, in plain words. The current version is 1.18.0.
order: 2
---

The current version is **1.18.0**. This list groups the changes by what you see in the app. Version numbers for each release are in the project's history on GitHub.

## Folders, network and navigation

- The sidebar always fits its width. Drive and network drive cards shrink, long names are cut with an ellipsis (hover shows the full name), and there is no bottom scroll bar.
- Folder navigation with a history, back and forward, and the mouse side buttons.
- Mapped and typed network shares in the sidebar, with sign-in for shares that refuse guest access. Saved sign-ins reconnect when the app starts.
- Recent folders, pinned folders and starred files in the sidebar.
- A details view like File Explorer's, with sortable columns.
- In-place refresh with `F5`, `Ctrl` + `R` and the header button; the selection and view stay.

## Viewers

- 3D viewer with lighting presets, shading modes, matcaps, wireframe, cameras and turntable.
- USD, Alembic and Blender files converted in the background with Blender, plus a 3D model outliner.
- HDR and EXR inspector with a 360° view, exposure, tone mapping, channel solo, eyedropper and probes.
- Render textures (`.tx`, `.tex`) with mip levels and a "sharp enough?" check.
- Image sequences that play as one sequence, PDF viewing, video and audio players.
- Markdown (`.md`) documents in a clean reading page, with pictures and animated GIFs from next to the file or from a network drive, tables, code blocks, task lists, links and a heading outline.
- Compare with wipe, side-by-side, A/B toggle and diff, for pictures, videos and 3D models. Align Features scales a smaller picture up to match the larger one.

## Browsing and working with files

- Multi-select with `Ctrl` and `Shift`, box selection, and a right-click menu.
- Quick Look with `Space`: a floating preview that follows the arrow keys and can scrub video.
- Colour labels and tags for files and folders, with a label filter.
- Custom folder icons from a CG library, plus your own PNG, SVG, ICO, WebP and JPG files.
- Send to apps from the right-click menu.
- Batch conversion of images to PNG, JPG, TIFF, BMP, TGA and WebP, without overwriting files.
- A duplicate finder: right-click a folder and choose **Find duplicates…** to list the folders and files under it that are copies of each other, with a 0 to 100% similarity score. It checks by name and size, or by file contents, and never moves or deletes anything.
- Delete to the Recycle Bin, with a confirmation; permanent delete only on `Shift` + `Delete`.
- Keyboard shortcut card on `?` and `F1`.
- A Help button in the top bar (and a Documentation entry in Settings) that opens this guide in your browser. The guide is built into the app and works offline.

## Speed and stability

- Faster and non-freezing thumbnails for large multi-layer EXR files.
- Grid virtualisation for large folders.
- Thumbnail cache with a clear button in Settings.

## Looks

- Four colour themes: Obsidian Dark, Dark Gray, True Black and Light.
- Inspector drawer that can be resized by dragging its edge.
