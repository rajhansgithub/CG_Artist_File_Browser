---
title: Architecture notes for contributors
layer: deep
nav: Architecture (contributors)
summary: How the app is put together: the React screens, the Tauri bridge, the Rust backend, the caches, the build, and how this guide is made.
order: 18
---

## The parts

- **React 19 screens** in `src/` (Vite builds them). `src/App.jsx` holds the folder state and the routing between the grid and the viewers. Components live in `src/components/`, helpers in `src/utils/`.
- **Bridge** in `src/tauriBridge.js`. It gives the screens a `window.electronAPI` object and turns each call into a Tauri `invoke`. Screens never call Tauri directly.
- **Rust backend** in `src-tauri/src/`. It reads folders, decodes thumbnails and EXR, manages network shares and file labels, and starts Blender. Each command is listed in the IPC table in [`docs/ARCHITECTURE.md`](https://github.com/rajhansgithub/CG_Artist_File_Browser/blob/main/docs/ARCHITECTURE.md).
- **Blender** runs headless from `scripts/blender_convert.py` for USD, Alembic and Blender files and for the optional studio thumbnails.

## Speed choices

- File listings are read on a worker thread and use directory metadata, so folders with thousands of files stay responsive.
- Thumbnails are decoded in Rust with a limit on how many run at once, and cached on disk by a hash of the path, size and modified time.
- Binary files travel as raw buffers rather than base64, so large textures are not copied through JSON.
- The grid is virtualised: only the visible cards are drawn.

## Keeping the guide and the app in step

The keyboard card in this guide is built from `src/utils/shortcutList.js`. When a key changes in a handler, change it in that list too. The list says which handler each group mirrors.

## Building the app

```text
npm install
npm run tauri:dev      # run the app
npm run tauri:build    # build the Windows installer and portable exe
npm run version:check  # the version must match in package.json, tauri.conf.json and Cargo.toml
```

Versions follow semantic versioning. [`docs/ARCHITECTURE.md`](https://github.com/rajhansgithub/CG_Artist_File_Browser/blob/main/docs/ARCHITECTURE.md) has the rules and the release steps.

## Building this guide

The guide's Markdown is in `docs/site-src/content/`. The build writes plain HTML, CSS and JavaScript into `docs/site/`:

```text
node docs/site-src/build.mjs
```

The build needs only Node. It stops with a list of problems when a page links to a missing page or anchor, or to a picture that is not in `docs/site/assets/media/`. The generated files are committed, so nobody needs Node to read the guide. See [`docs/site-src/README.md`](https://github.com/rajhansgithub/CG_Artist_File_Browser/blob/main/docs/site-src/README.md) for how to add a page or replace a picture.
