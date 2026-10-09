// Quick Look: Space on the selected file opens it in its existing viewer, Space or Esc goes back to the grid.
// Pure helpers only; the keyboard wiring lives in hooks/useQuickLook.js.

// Categories openAsset() opens in a viewer. 'other' has none, so Quick Look skips those files.
const QUICK_LOOK_CATEGORIES = new Set(['3d', 'hdr', 'image', 'texture', 'video', 'audio', 'pdf']);

// Viewers that use Space for their own job (play / pause, PDF page down): there Space is left alone and Esc closes.
export const QUICK_LOOK_SPACE_KEPT_VIEWERS = new Set(['video', 'audio', 'pdf']);

// Viewers where Left / Right are free, so they move to the neighbouring file. Image and texture viewers already
// step through files with these keys, and video, audio, PDF and image sequences use them for seeking, pages or frames.
export const QUICK_LOOK_ARROW_VIEWERS = new Set(['studio3d', 'hdrexr']);

export function isQuickLookItem(item) {
  if (!item || item.isDirectory) return false;
  return !!item.isSequence || QUICK_LOOK_CATEGORIES.has(item.category);
}

// The previewable file next to `current` in `items` (in the order on screen), or null at either end of the list
export function getAdjacentQuickLookItem(items, current, step) {
  if (!current) return null;
  const index = items.findIndex((item) => item.path === current.path);
  if (index < 0) return null;
  for (let i = index + step; i >= 0 && i < items.length; i += step) {
    if (isQuickLookItem(items[i])) return items[i];
  }
  return null;
}

// Keys typed into a field belong to that field
export function isTextEntryTarget(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;
}
