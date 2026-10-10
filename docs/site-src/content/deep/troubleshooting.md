---
title: Troubleshooting
layer: deep
nav: Troubleshooting
summary: What to do when a file will not open, a share will not connect, or something is slow.
order: 17
counterpart: quick/how-do-i
---

## A USD, Alembic or Blender file does not open

Check the sidebar footer. If it says Blender was not found, open [Settings](@deep/settings-themes) and set the Blender path. If Blender is found but the conversion fails, the message names the file. Open the same file in Blender to see whether the file itself is the problem.

## A network share will not open

If you see an error that starts with a sign-in message, or Windows error 1272, the share needs a sign-in that File Explorer does not share with this app. Click **+** next to Network locations, enter the user name and password, and tick **Remember**. See [Network shares](@deep/folders-and-network#network-shares).

If the share is offline, it stays in the sidebar and comes back when the share does.

## Thumbnails are slow

The first visit to a folder decodes every image and EXR. Large multi-layer EXR files take the longest. The result is saved in the cache, so later visits are fast.

## A render texture shows a message

`.tx` and `.tex` files that are based on OpenEXR, or that use Pixar compression, cannot be read here. The message says so. See [Render textures](@deep/render-textures).

## Quick Look does not open

Quick Look needs the folder view, a file selected and a focus outside text boxes. Press `Esc` to leave the address box first. Files with no viewer, such as text, are skipped.

## Keys do nothing

The address box and any open dialog take the keys first. Press `Esc` to close the box or the dialog, then try again.

## I deleted something by accident

`Delete` moves files to the Recycle Bin, so restore them from there. Only `Shift` + `Delete` removes files for good, and it asks you to type DELETE to confirm.

## Something else

Open an issue on the project's GitHub page with the file type, what you clicked and the message on screen.
