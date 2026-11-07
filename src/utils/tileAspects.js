// The shape (width / height) of each tile's picture, so the grid can size every tile to its thumbnail.
//
// A shape is learned when a thumbnail loads. It is kept for the session and saved to localStorage (most recent
// first, capped), so a folder opened again lays out at once in its real shapes instead of reflowing.

const STORAGE_KEY = 'cg_artist_tile_aspects';
const MAX_SAVED = 6000;
const SAVE_DELAY = 1500;

// Tiles never get thinner or wider than this; a picture outside the range is shown whole inside its tile
export const MIN_ASPECT = 0.4;
export const MAX_ASPECT = 5;

// Shape guessed by kind until the thumbnail is in
const KIND_GUESS = {
  folder: 1,
  hdr: 2,
  video: 16 / 9,
  audio: 1.5,
  pdf: 0.75,
  markdown: 0.75
};

const aspects = new Map();
const listeners = new Set();
let loaded = false;
let saveTimer = 0;
let notifyFrame = 0;

const keyOf = (path) => (path || '').toLowerCase();

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(saved)) {
      for (const entry of saved) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[1] > 0) aspects.set(entry[0], entry[1]);
      }
    }
  } catch {
    // Storage blocked or broken: shapes are learned again as thumbnails load
  }
}

function save() {
  saveTimer = 0;
  try {
    const entries = [...aspects].slice(-MAX_SAVED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Not saved: the shapes still work for this session
  }
}

// Listeners hear about new shapes once per frame, however many thumbnails loaded in it
function notify() {
  if (notifyFrame) return;
  notifyFrame = requestAnimationFrame(() => {
    notifyFrame = 0;
    listeners.forEach((fn) => fn());
  });
}

// The real shape of a path's thumbnail, or null when it has not loaded yet
export function knownAspect(path) {
  load();
  return aspects.get(keyOf(path)) ?? null;
}

// The shape the grid lays out with: the real one if known, else a guess by kind
export function tileAspect(item) {
  if (item.isDirectory) return KIND_GUESS.folder;
  const known = knownAspect(item.path);
  const ratio = known ?? KIND_GUESS[item.category] ?? 1;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, ratio));
}

export function rememberAspect(path, ratio) {
  if (!(ratio > 0) || !Number.isFinite(ratio)) return;
  load();
  const key = keyOf(path);
  const rounded = Math.round(ratio * 1000) / 1000;
  const old = aspects.get(key);
  if (old !== undefined && Math.abs(old - rounded) < 0.002) return;
  // Re-inserted so the most recent shapes are the ones kept when the saved list is trimmed
  aspects.delete(key);
  aspects.set(key, rounded);
  notify();
  if (!saveTimer) saveTimer = setTimeout(save, SAVE_DELAY);
}

export function subscribeAspects(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
