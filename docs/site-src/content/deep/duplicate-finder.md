---
title: Duplicate finder
layer: deep
nav: Duplicate finder
summary: Find folders and files that are copies of each other under one folder, with a 0 to 100% similarity score. Report only; nothing is moved or deleted.
order: 15.5
counterpart: quick/how-do-i
---

## Starting a scan

Right-click a folder and choose **Find duplicates…**. To scan the folder you have open, right-click the empty space of the folder view instead. The scan covers every subfolder. It runs in the background with a progress bar, and **Cancel** stops it.

The finder only makes a report. It never moves, renames or deletes anything.

## Fast or exact

- **Fast: same name and size.** Two files count as the same when their names (ignoring upper and lower case) and sizes match. No file is read, so it is quick, also on a network drive.
- **Exact: same contents.** Two files count as the same when their contents match, whatever their names. Only files that share their size with another file are read: first a small piece of each end, then the whole file for those that still match. This finds renamed copies and never mixes up two different files that happen to share a name and size. It is slower on a network drive.

## How folders are matched

A folder is compared by all the files inside it, subfolders included. Its own name and the folder layout inside it do not matter, so `Project` and `Backup\Project_copy` are found as copies.

The similarity score is the size of the files two folders share, divided by the size of all their files together. 100% means the same files. A big file counts for more than a small one, so a folder that only lacks a few small files still scores high.

**Group folders that are alike by** sets the lowest score that counts. Pick **100%** for exact copies only, or a lower value to also see near copies, such as a folder with a few files added or removed. The default is 80%.

A few rules keep the report short:

- When two folders match, their matching subfolders are not listed again.
- A folder is never compared with a folder inside it. A folder that only holds one other folder is listed as that inner folder.
- `Thumbs.db`, `desktop.ini` and `.DS_Store` are ignored, and so are the Recycle Bin and System Volume Information folders. Links and junctions are not followed.

## The report

The top line shows how many files and folders were scanned and how much space the extra copies take (in fast mode this is an estimate, since name and size can match for different files).

**Folders** lists each group of matching folders, biggest first. The first folder of a group is the one the others are scored against. A folder that is not a 100% match shows its score; click it to see which files are missing from it and which files only it has. Each folder has buttons to open it in the browser or reveal it in Explorer.

**Files** lists files that have copies elsewhere, biggest waste first. Copies that are only inside matching folders are left out, since the folder group already shows them. Click a file to see where each copy is.

**Copy report** puts the whole report on the clipboard as plain text. **Scan again** goes back to the options.

Very large reports show the biggest 2,000 folder groups and 3,000 file groups.
