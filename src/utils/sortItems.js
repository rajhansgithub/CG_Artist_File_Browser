// Sorting for the folder views (Large icons and Details), and the per-folder memory of the choice.
import { getTypeLabel } from './formatHelpers';
import { normalizeFolderKey } from './folderIconStore';

export const SORT_KEYS = [
  { key: 'name', label: 'Name' },
  { key: 'modified', label: 'Date modified' },
  { key: 'size', label: 'Size' },
  { key: 'type', label: 'Type' }
];

// dir: 1 ascending, -1 descending
export const DEFAULT_SORT = { key: 'name', dir: 1, foldersFirst: true };

// The direction a column starts in when it is picked: A-Z for text, newest and largest first for date and size
const STARTING_DIR = { name: 1, type: 1, modified: -1, size: -1 };

// Built once: creating a collator per comparison is what makes naive localeCompare sorts slow on big folders
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function comparePrimary(a, b, key) {
  switch (key) {
    case 'modified':
      return (a.modified || 0) - (b.modified || 0);
    case 'size':
      return (a.size || 0) - (b.size || 0);
    case 'type':
      return collator.compare(getTypeLabel(a), getTypeLabel(b));
    default:
      return collator.compare(a.name || '', b.name || '');
  }
}

export function sortItems(items, sort = DEFAULT_SORT) {
  const { key, dir, foldersFirst } = sort;
  return [...items].sort((a, b) => {
    if (foldersFirst && a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    const primary = comparePrimary(a, b, key) * dir;
    if (primary) return primary;
    // Ties fall back to name A-Z whichever way the column runs, so equal sizes do not shuffle when flipped
    return collator.compare(a.name || '', b.name || '');
  });
}

// Clicking a column: the same one flips direction, a new one starts in its natural direction
export function sortByColumn(sort, key) {
  if (sort.key === key) return { ...sort, dir: -sort.dir };
  return { ...sort, key, dir: STARTING_DIR[key] ?? 1 };
}

function sanitize(raw) {
  const key = SORT_KEYS.some((k) => k.key === raw?.key) ? raw.key : DEFAULT_SORT.key;
  return {
    key,
    dir: raw?.dir === -1 ? -1 : 1,
    foldersFirst: raw?.foldersFirst === false ? false : true
  };
}

function isDefault(sort) {
  return sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir && sort.foldersFirst === DEFAULT_SORT.foldersFirst;
}

// Remembered per folder in localStorage; a folder with no entry uses the default (name, A-Z, folders first)
const STORAGE_KEY = 'cg_artist_folder_sorts';
const MAX_REMEMBERED_FOLDERS = 300;

function readAll() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function loadFolderSort(path) {
  const saved = readAll()[normalizeFolderKey(path)];
  return saved ? sanitize(saved) : { ...DEFAULT_SORT };
}

export function saveFolderSort(path, sort) {
  const folderKey = normalizeFolderKey(path);
  if (!folderKey) return;
  const all = readAll();
  delete all[folderKey]; // re-added below, which moves it to the newest end
  if (!isDefault(sort)) all[folderKey] = { key: sort.key, dir: sort.dir, foldersFirst: sort.foldersFirst };
  const keys = Object.keys(all);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED_FOLDERS))) delete all[old];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: the choice just won't be remembered */
  }
}
