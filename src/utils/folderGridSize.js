// Thumbnail size (Ctrl + mouse wheel in the Large icons view) remembered per folder.
//
// A folder with its own entry gets that size back when it is opened. A folder without one uses the global size,
// which is the last size the user picked anywhere (kept under GLOBAL_KEY, the same key the app has always used).
import { normalizeFolderKey } from './folderIconStore';

export const DEFAULT_GRID_SIZE = 240;
export const MIN_GRID_SIZE = 120;
export const MAX_GRID_SIZE = 500;

const GLOBAL_KEY = 'cg_artist_grid_size';
const LEGACY_GLOBAL_KEY = 'vfx_grid_size';
const STORAGE_KEY = 'cg_artist_folder_grid_sizes';
const MAX_REMEMBERED_FOLDERS = 300;

export function clampGridSize(value) {
  return Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, Math.round(Number(value))));
}

function readAll() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function loadGlobalGridSize() {
  try {
    const saved = localStorage.getItem(GLOBAL_KEY) || localStorage.getItem(LEGACY_GLOBAL_KEY);
    return saved ? clampGridSize(saved) : DEFAULT_GRID_SIZE;
  } catch {
    return DEFAULT_GRID_SIZE;
  }
}

// The size a folder opens at: its own remembered size, or the global size when it has none
export function loadFolderGridSize(path) {
  const saved = readAll()[normalizeFolderKey(path)];
  return Number.isFinite(saved) ? clampGridSize(saved) : loadGlobalGridSize();
}

// Called when the user changes the size in a folder: remembers it for that folder and as the new global size
export function saveFolderGridSize(path, size) {
  const value = clampGridSize(size);
  try {
    localStorage.setItem(GLOBAL_KEY, value);
  } catch {
    /* storage unavailable: the choice just won't be remembered */
  }

  const folderKey = normalizeFolderKey(path);
  if (!folderKey) return;
  const all = readAll();
  delete all[folderKey]; // re-added below, which moves it to the newest end
  all[folderKey] = value;
  const keys = Object.keys(all);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED_FOLDERS))) delete all[old];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: the choice just won't be remembered */
  }
}
