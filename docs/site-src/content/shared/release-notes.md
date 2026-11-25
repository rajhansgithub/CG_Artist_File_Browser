---
title: Release notes
layer: shared
nav: Release notes
summary: What has been added and fixed, grouped by area, in plain words. The current version is 1.25.0.
order: 2
---

The current version is **1.25.0**. This list groups the changes by what you see in the app. Version numbers for each release are in the project's history on GitHub.

## Folders, network and navigation

- The sidebar always fits its width. Drive and network drive cards shrink, long names are cut with an ellipsis (hover shows the full name), and there is no bottom scroll bar.
- Folder navigation with a history, back and forward, and the mouse side buttons.
- Mapped and typed network shares in the sidebar, with sign-in for shares that refuse guest access. Saved sign-ins reconnect when the app starts.
- Recent folders, pinned folders and starred files in the sidebar.
- A details view like File Explorer's, with sortable columns.
- In-place refresh with `F5`, `Ctrl` + `R` and the header button; the selection and view stay.

## Viewers

- 3D viewer with lighting presets, shading modes, matcaps, wireframe, cameras and turntable.
- 3D viewer wireframe now shows the original quads and n-gons instead of triangles. A Normals panel softens or hardens edges by angle, like Maya, and a UV view (button or `U`) shows the UV layout.
- Smooth preview in the 3D viewer (button or `3`, like Maya) shows the meshes smoothed, with the wireframe staying on the original lines. A Colors button (or `C`) gives each mesh its own colour so parts are easy to tell apart. Both start off.
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
- The 3D view no longer turns black after the window or a side panel changes size.
- Thumbnail cache with a clear button in Settings.

## Updates

- Check for updates from inside the app: Settings > Updates shows what is new and installs it with one click. The installed app updates itself and opens again; the portable exe replaces itself where it is.
- Every update is checked against our signature first, so a broken, changed or older file is never installed. If the new portable version does not start, the old one is put back.
- A quiet check once a day (can be turned off) puts a small blue dot on the Settings button when a new version is out. Nothing installs without a click.

## Achievements

- Achievements: badges for real work, like opening models and HDRs, organising files and finishing batch jobs. Each badge climbs from Bronze to Ruby as lens iris medals, with Diamond and Ruby as real cut stones. Sets of four make certified showreels.
- Levels and ranks, a pop-up when you earn something (it waits until no viewer, window or job is open), and a full view where you can tilt a medal and turn it over to its certificate.
- Emulsion, the rarest tier, opens only after a long stretch of real work. Nothing can be bought, nothing is sent anywhere, and idle time never counts.
- The trophy button in the side rail (or the Pro sidebar) opens it. Settings has an Achievements section for the pop-ups and the Emulsion bubble's look.

## Looks

- The frosted-glass blur behind toolbars, docks and windows works again in the built app.

- A new cleaner look with a Simple and Pro mode.
- Edge-to-edge tiles with the file name always shown, small pictures from inside each folder, and Compare A/B and stars that stay on the tile.
- Drives in the Simple side rail, the folder path and free space under the folder name, and the file filters in a dock at the bottom with a tile size slider.
- A richer Inspector: colour channel buttons, the texture set, colour labels and tags, and Send to apps.
- Tiles are sized to their pictures, like a photo gallery. Each row is as tall as its pictures and fills the width, so wide renders, videos and HDRs leave no empty space under them. The tile size slider and `Ctrl` + wheel set the row height.
- A new 3D viewer layout: the controls sit in a dock at the bottom, with Close in the top right. Pro mode adds a Model panel on the right with the counts, size, materials, snap views, light angle and display switches, and the outliner opens on the left.
- Four colour themes: Obsidian Dark, Dark Gray, True Black and Light.
- Inspector drawer that can be resized by dragging its edge.
