import { useMemo } from 'react';
import { formatBytes } from './formatHelpers';
import { normalizeFolderKey } from './folderIconStore';

// [singular, plural] as shown in the counts, in the order they are listed
const CATEGORY_LABELS = [
  ['folder', 'folder', 'folders'],
  ['3d', '3D model', '3D models'],
  ['hdr', 'HDR/EXR', 'HDR/EXR'],
  ['image', 'image', 'images'],
  ['texture', 'texture', 'textures'],
  ['video', 'video', 'videos'],
  ['audio', 'audio file', 'audio files'],
  ['pdf', 'PDF', 'PDFs'],
  ['markdown', 'Markdown file', 'Markdown files'],
  ['other', 'other file', 'other files']
];

export function summarizeItems(items) {
  const counts = {};
  let bytes = 0;
  for (const item of items) {
    const cat = item.isDirectory ? 'folder' : CATEGORY_LABELS.some((c) => c[0] === item.category) ? item.category : 'other';
    counts[cat] = (counts[cat] || 0) + 1;
    if (!item.isDirectory) bytes += item.size || 0;
  }
  const parts = CATEGORY_LABELS.filter(([cat]) => counts[cat]).map(
    ([cat, one, many]) => `${counts[cat]} ${counts[cat] === 1 ? one : many}`
  );
  return { total: items.length, bytes, breakdown: parts.join(', ') };
}

function formatGB(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return '';
  if (n >= 1024) return `${(n / 1024).toFixed(1)} TB`;
  return `${n.toFixed(n < 100 ? 1 : 0)} GB`;
}

// The drive (or mapped network share) that holds `path`, when its free space is known. The longest matching root wins.
export function findDriveForPath(drives, path) {
  const target = normalizeFolderKey(path);
  if (!target) return null;
  let best = null;
  let bestLength = -1;
  for (const drive of drives || []) {
    if (drive.freeGB == null || drive.totalGB == null) continue;
    // A mapped network drive's label is its share, so paths typed as UNC match it too
    const roots = [drive.mount, drive.name, /^[\\/]{2}/.test(drive.label || '') ? drive.label : ''];
    for (const root of roots) {
      const key = normalizeFolderKey(root).replace(/\\+$/, '');
      if (!root || (target !== key && !target.startsWith(`${key}\\`))) continue;
      if (key.length > bestLength) {
        best = drive;
        bestLength = key.length;
      }
    }
  }
  return best;
}

// What the toolbar's subtitle says about the folder: what is listed, what is selected, and the room left on the drive.
// (This used to be a status bar under the grid.)
export function useFolderStatus({ items, filtered, selectedItem, selectedPaths, drives, currentPath }) {
  const summary = useMemo(() => summarizeItems(items), [items]);
  const drive = useMemo(() => findDriveForPath(drives, currentPath), [drives, currentPath]);

  const countText = `${summary.total} ${summary.total === 1 ? 'item' : 'items'}${filtered ? ' (filtered)' : ''}`;
  const detailText = [summary.breakdown, summary.bytes ? formatBytes(summary.bytes) : ''].filter(Boolean).join(' · ');

  let selectionText = '';
  const picked = selectedPaths && selectedPaths.size > 1 ? items.filter((item) => selectedPaths.has(item.path)) : [];
  if (picked.length > 1) {
    const bytes = picked.reduce((sum, item) => sum + (item.isDirectory ? 0 : item.size || 0), 0);
    selectionText = `${picked.length} selected${bytes ? ` (${formatBytes(bytes)})` : ''}`;
  }

  const freeText = drive ? `${formatGB(drive.freeGB)} free` : '';
  const diskText = drive ? `${drive.mount.replace(/\\$/, '')} ${formatGB(drive.freeGB)} free of ${formatGB(drive.totalGB)}` : '';
  const sizeText = summary.bytes ? formatBytes(summary.bytes) : '';

  return { countText, detailText, selectionText, freeText, diskText, sizeText };
}
