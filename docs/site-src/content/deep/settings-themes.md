---
title: Settings and themes
layer: deep
nav: Settings and themes
summary: The settings window: updates, the four colour themes, the user guide link, the Blender path, the send-to apps and the asset cache.
order: 16
counterpart: quick/how-do-i
---

## Opening Settings

Click the gear at the top right, or **Studio Preferences & Configuration**. The window has six parts.

![The settings window with the appearance and Blender options](media:settings-themes.webp "Appearance at the top, then Blender, External apps and the asset cache")

## Appearance

Four themes are available. The choice is remembered and applies at once.

| Theme | Look |
| :--- | :--- |
| Obsidian Dark | The default: neutral dark grey with white accents |
| Dark Gray | A softer, lighter grey |
| True Black | Pure black, best on OLED screens |
| Light | A bright studio look |

## Updates

**Check for updates** asks for the newest version. When there is one, you see its number, the date and what is new, with **Download and install** and **Skip this version**.

- The installed app closes, installs the update with a small progress bar and opens again. Settings and files stay as they are.
- The portable exe replaces itself in the same folder. The old exe is kept until the new one opens, and put back if it does not. A portable exe in a folder you cannot write to (such as Program Files) cannot update itself: move it, or use **Open the download page**.
- Every download is checked against the app's signature before anything changes. A file that fails the check is not installed.
- **Check once a day** looks quietly in the background. When a new version is out, a blue dot appears on the Settings button and a small notice in the corner. Without internet nothing is shown; it tries again later. Only the version information is fetched; nothing about you or your files is sent.

## Documentation

**Open the user guide** opens this guide in your default browser. It is the same as the question-mark **Help** button in the top bar. The guide is built into the app and works without the internet; the first time you open it, the app saves a copy in its data folder and opens that copy.

## Blender

The **Blender Executable Path** box shows the Blender the app will use for USD, Alembic and Blender files. The status line under it says whether Blender was found. Use **Browse** to choose the `blender.exe` yourself and **Save** to keep it. See [USD, Alembic and Blender](@deep/usd-outliner).

## External apps

The list of apps for the Send to menu, with **Browse**, **Add** and **Scan**. See [Send to apps](@deep/send-to-apps).

## Asset cache

The cache keeps thumbnails and converted models so folders open fast. The section shows how much space it uses and has a **Clear Cache** button. Clearing it is safe: the thumbnails and conversions are made again when needed.
