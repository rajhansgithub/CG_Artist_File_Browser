---
title: FAQ
layer: shared
nav: FAQ
summary: Short answers to the questions people ask first.
order: 1
---

## Does the app upload my files anywhere?

No. Everything is read and shown on your PC. The only network traffic is what Windows itself does when you open a network share, and the Blender conversion runs locally.

## Does it change my files?

It only changes what you ask it to. Renaming, deleting (to the Recycle Bin), converting images and sending files to apps all happen when you do them. Labels, tags, favourites and folder icons are stored by the app in its own settings and label files, not inside your folders.

## Which Windows versions and processors?

Windows 10 or 11, 64-bit. WebView2 is needed; it is already installed on most Windows 10 and 11 PCs. Linux and macOS are not supported at the moment.

## Why do the thumbnails take a moment the first time?

The first time a folder is opened, each image and EXR is decoded. The result is saved in the thumbnail cache, so the next visit is instant. Very large multi-layer EXR files take the longest. See [Troubleshooting](@deep/troubleshooting#thumbnails-are-slow).

## Where are the settings and the cache?

Settings (the Blender path, send-to apps, favourites, recent folders and network sign-ins) are kept in the app's settings file, `studio_config.json`. Labels are kept in `file_labels.json`. Thumbnails and converted models are kept in the `AssetStudioCache` folder under `%APPDATA%`. Settings has a button to clear the cache.

## Can I change the shortcuts?

The keys are fixed in this version. The [shortcut card](@quick/shortcuts) lists them all.

## Is it free?

The app is released under the MIT licence. The source and the releases are on the project's GitHub page.

## Why are some screenshots not from my PC?

The pictures in this guide were captured from a browser build with sample files so that the guide could be made before the Windows build was run. They show the same controls. Real screenshots can replace them by copying files over the old ones.
