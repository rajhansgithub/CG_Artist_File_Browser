// Back / forward folder history and the in-memory folder listing cache that makes going back instant.
import { normalizeFolderKey } from './folderIconStore';

const HISTORY_LIMIT = 100;

export function createHistory() {
  return { entries: [], index: -1 };
}

// Visiting a folder drops everything ahead of the current position, like a browser. Re-visiting the folder we are on adds nothing.
export function pushEntry(history, path) {
  if (!path) return history;
  const current = history.entries[history.index];
  if (current && normalizeFolderKey(current) === normalizeFolderKey(path)) return history;
  const entries = [...history.entries.slice(0, history.index + 1), path].slice(-HISTORY_LIMIT);
  return { entries, index: entries.length - 1 };
}

export function canStep(history, delta) {
  const next = history.index + delta;
  return next >= 0 && next < history.entries.length;
}

// { history, path } for the entry one step back (-1) or forward (+1), or null at either end
export function stepHistory(history, delta) {
  if (!canStep(history, delta)) return null;
  const index = history.index + delta;
  return { history: { entries: history.entries, index }, path: history.entries[index] };
}

// Listings kept in memory by folder + filter + search. The oldest are dropped past the limit.
export class ListingCache {
  constructor(limit = 40) {
    this.limit = limit;
    this.map = new Map();
  }

  static key(path, filter, search) {
    return `${normalizeFolderKey(path)}\u0000${filter || 'all'}\u0000${(search || '').trim().toLowerCase()}`;
  }

  get(path, filter, search) {
    return this.map.get(ListingCache.key(path, filter, search)) || null;
  }

  set(path, filter, search, listing) {
    const key = ListingCache.key(path, filter, search);
    this.map.delete(key); // re-insert so the newest listing sits at the end
    this.map.set(key, listing);
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value);
  }
}

// Cheap fingerprint of a listing, so a background refresh only re-renders the folder when something changed
export function listingSignature(items) {
  let sig = `${items.length}`;
  for (const item of items) sig += `|${item.path}:${item.modified || 0}:${item.size || 0}:${item.thumbnail ? 1 : 0}`;
  return sig;
}

// When going up (or back) to a folder that contains the one we just left, the item to highlight: Explorer does the same
export function findLeftBehindItem(items, fromPath, toPath) {
  const from = normalizeFolderKey(fromPath);
  const to = normalizeFolderKey(toPath);
  if (!from || !to || from === to) return null;
  const toPrefix = to.endsWith('\\') ? to : `${to}\\`;
  if (!from.startsWith(toPrefix)) return null;
  return (
    items.find((item) => {
      if (!item.isDirectory) return false;
      const key = normalizeFolderKey(item.path);
      return from === key || from.startsWith(`${key}\\`);
    }) || null
  );
}
