// Quick Look: Space on the selected file opens a small floating window over the grid that shows it in the
// viewer it would normally get. Space or Esc closes it, and the arrow keys move the grid selection so the window follows.
// Pure helpers only; the keyboard wiring lives in hooks/useQuickLook.js and the window in components/QuickLookWindow.jsx.

import { isTxTexFormat } from './formatHelpers';

// Categories that have a viewer. 'other' has none, so Quick Look skips those files.
const QUICK_LOOK_CATEGORIES = new Set(['3d', 'hdr', 'image', 'texture', 'video', 'audio', 'pdf', 'markdown']);

export function isQuickLookItem(item) {
  if (!item || item.isDirectory) return false;
  return !!item.isSequence || QUICK_LOOK_CATEGORIES.has(item.category);
}

// Which viewer shows the item. The same choice openAsset() makes, so the floating window and the full viewer agree.
export function getQuickLookViewer(item) {
  if (!isQuickLookItem(item)) return null;
  if (item.isSequence) return 'sequence';
  if (item.category === '3d') return 'studio3d';
  if (item.category === 'hdr') return 'hdrexr';
  if (item.category === 'texture' && isTxTexFormat(item.extension)) return 'txtex';
  if (item.category === 'image' || item.category === 'texture') return 'image';
  return item.category; // 'video', 'audio', 'pdf' or 'markdown'
}

// While the floating window is open the arrow and page keys belong to the grid (they move the selection, and the
// window follows). The viewers inside the window skip these keys so they do not also move on their own.
export function isQuickLookNavKey(e) {
  return e.key.startsWith('Arrow') || e.key === 'PageUp' || e.key === 'PageDown';
}

// Keys typed into a field belong to that field
export function isTextEntryTarget(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;
}
