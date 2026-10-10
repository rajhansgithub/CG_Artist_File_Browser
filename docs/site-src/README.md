# User guide: sources and build

The user guide is in `docs/site/`. It is plain HTML, CSS and JavaScript, so it opens from disk with no server and needs no build step to read. The pages are written as Markdown in `content/`, and `build.mjs` turns them into the HTML.

## Rebuild after an edit

```text
node docs/site-src/build.mjs
```

Node is the only requirement. The build stops with a list of problems if a page links to a page or anchor that does not exist, or to a picture that is not in `docs/site/assets/media/`. It also regenerates the keyboard card from `src/utils/shortcutList.js` and the search index in `docs/site/assets/search-index.js`. Commit the regenerated files with the source.

## Add or change a page

Each page is a file in `content/`, in one of three folders:

- `content/quick/` for the Quick start layer (surface level)
- `content/deep/` for the Deep dive layer (one page per feature)
- `content/shared/` for pages useful to both (FAQ, release notes)

The file starts with front matter:

```text
---
title: Compare
layer: deep
nav: Compare
summary: One line that appears under the title and in search results.
order: 11
counterpart: quick/tour
---
```

- `layer` is `quick`, `deep` or `shared`.
- `nav` is the short name in the sidebar (optional, defaults to `title`).
- `order` sorts the sidebar within its group.
- `counterpart` links the page to its partner in the other layer. The link appears at the top of the page and drives the Quick start / Deep dive switch.

Links between guide pages use `@` and the page path, with an optional anchor: `[Compare](@deep/compare#the-four-modes)`. Anchors are the heading text in lower case with spaces as hyphens.

Supported Markdown: headings (`##` to `####`), paragraphs, bold, italic, `code`, bullet and numbered lists, pipe tables, fenced code blocks, `> **Tip:**` / `> **Note:**` / `> **Warning:**` callouts, and pictures.

## Pictures

Pictures live in `docs/site/assets/media/` and are used with `media:` in the Markdown:

```text
![Alt text](media:grid-models.webp "Caption under the picture")
```

Screenshots are WebP and animations are GIF. Keep each picture small: the whole media folder should stay under about 15 MB so the repository stays light.

### Replace a picture with a real screenshot

The file names are the contract. To use a real screenshot from the Windows app, save it with the same name and extension into `docs/site/assets/media/`, overwriting the old file, then run the build. The pages refer to pictures by name, so no page needs to change. If the new file has a different extension, rename it to match the name in the Markdown.

## Where the current pictures came from

The screenshots and GIFs in the guide were captured from a browser build of the app, with the Tauri bridge replaced by a small stand-in that serves sample files (a generated sample library with textures, renders, a PDF, a short clip, a sequence and the sample models from `samples/`). They show the real interface, but the data is sample data and the window is a browser window, not the Windows app. They are the first things to replace with real captures.
