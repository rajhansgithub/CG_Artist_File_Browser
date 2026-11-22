/**
 * Achievements observer (docs/ACHIEVEMENTS.md): watches the app's own real events and saves what they earn.
 *
 * Watching only. It wraps a few calls of the bridge (window.electronAPI) and listens to the jobs' "finished" events, and the
 * viewers call track() once a file has really loaded. Every hook is wrapped so it can never throw, wait or change what the
 * app does: the wrapped call returns exactly what it returned before, at the same time.
 *
 * Saved: the state (core.js) in two files through the Rust side (src-tauri/src/achievements.rs: local + roaming app data),
 * merged on load. Kept in this browser only (per-PC conveniences): the pop-up queue, the recently counted files (so opening
 * the same file again never counts) and the settings.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import * as Core from './core.js';

const NEW_KEY = 'cgabAchNewV1'; // pop-ups not shown yet
const SEEN_KEY = 'cgabAchSeenV1'; // files and jobs counted lately (hashes)
const SEEN_MAX = 1000;
const inTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

const lsGet = (k, d) => {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    return v == null ? d : v;
  } catch {
    return d;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage full or blocked: the next save tries again */
  }
};

let state = Core.empty();
let ready = false;
let chain = Promise.resolve();
const subs = new Set();
const jobs = new Map(); // job id -> 'copy' | 'move'

/** Short hash of a path or job id, so the list of counted files never holds the paths themselves. */
const hash = (s) => {
  let h1 = 0x811c9dc5, h2 = 0x1234567;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
};
/** True the first time a key is seen lately (then it is remembered). */
const fresh = (key) => {
  if (!key) return false;
  const h = hash(String(key).toLowerCase());
  const seen = lsGet(SEEN_KEY, []);
  const list = Array.isArray(seen) ? seen : [];
  if (list.includes(h)) return false;
  list.push(h);
  lsSet(SEEN_KEY, list.slice(-SEEN_MAX));
  return true;
};

async function loadState() {
  let copies = [];
  if (inTauri()) {
    try {
      copies = (await invoke('load_achievements')) || [];
    } catch {
      copies = [];
    }
  }
  try {
    copies.push(localStorage.getItem(Core.KEY) || '');
  } catch {
    /* no browser storage */
  }
  let s = Core.empty();
  for (const txt of copies) {
    try {
      if (txt) s = Core.merge(s, JSON.parse(txt));
    } catch {
      /* a broken copy is skipped; the other one still counts */
    }
  }
  return s;
}

async function saveState(s) {
  const txt = Core.serialize(s);
  try {
    localStorage.setItem(Core.KEY, txt);
  } catch {
    /* fine: the files are the real store */
  }
  if (inTauri()) {
    try {
      await invoke('save_achievements', { data: txt });
    } catch {
      /* watching only: a failed save never bothers the user; the next one tries again */
    }
  }
}

/** Pop-ups waiting to be shown: { k:'u', id, tier, from } badge, { k:'p', set, from, to } showreel, { k:'l', from, to } level, { k:'g' } gate */
export const queue = () => {
  const q = lsGet(NEW_KEY, []);
  return Array.isArray(q) ? q : [];
};
export const dropShown = (shown) => {
  const key = (x) => `${x.k}:${x.id || x.set || ''}:${x.to || x.tier || ''}:${x.at}`;
  const keys = new Set(shown.map(key));
  lsSet(NEW_KEY, queue().filter((x) => !keys.has(key(x))));
};

const notify = () => subs.forEach((fn) => {
  try {
    fn(state);
  } catch {
    /* a broken listener never stops the others */
  }
});

/** The current state (read only). */
export const getState = () => state;
/** Calls fn(state) on every change; returns a function that stops it. */
export const subscribe = (fn) => {
  subs.add(fn);
  return () => subs.delete(fn);
};

/**
 * Report a real event. Never throws, never waits. data.key (a file path, a pair of paths) makes the event count only the
 * first time that key is seen lately.
 */
export function track(t, data) {
  try {
    const ev = Object.assign({}, data || {}, { t });
    if ('key' in ev) {
      ev.fresh = fresh(ev.key);
      delete ev.key;
    }
    chain = chain.then(() => step(ev)).catch(() => {});
  } catch {
    /* watching only */
  }
}

async function step(ev) {
  if (!ready) await start();
  const now = Date.now();
  const r = Core.apply(state, ev, { now });
  if (Core.same(r.state, state)) return;
  state = r.state;
  const items = [];
  const quiet = new Set(r.quiet);
  for (const id of r.unlocked) {
    if (quiet.has(id)) continue;
    const tr = r.tiers[id];
    items.push({ k: 'u', id, tier: tr ? tr.to : 0, from: tr ? tr.from : 0, at: now });
  }
  for (const p of r.sets) items.push({ k: 'p', set: p.id, from: p.from, to: p.to, at: now });
  if (r.gate) items.push({ k: 'g', at: now });
  if (r.level.to > r.level.from) items.push({ k: 'l', from: r.level.from, to: r.level.to, at: now });
  if (items.length) lsSet(NEW_KEY, queue().concat(items).slice(-60));
  await saveState(state);
  notify();
}

let starting = null;
/** The preview page only (docs/achievements-preview.html): show a sample state. The app never calls it. */
export function showSample(sample) {
  state = Core.normalize(sample);
  ready = true;
  starting = starting || Promise.resolve();
  notify();
}
/** Load and merge both saved copies (once). */
export function start() {
  if (!starting) {
    starting = loadState().then((s) => {
      state = Core.merge(s, state);
      ready = true;
      notify();
      saveState(state); // writes the merged copy back, so both files agree
    });
  }
  return starting;
}

/* ---------------------------------------------------------------- bridge hooks */
const safe = (fn) => (...a) => {
  try {
    fn(...a);
  } catch {
    /* watching only */
  }
};
/** Replaces api[name] with a version that calls `after(result, args)` / `failed(err, args)`; the result is untouched. */
function wrap(api, name, after, failed) {
  const orig = api && api[name];
  if (typeof orig !== 'function' || orig.__ach) return;
  const w = async (...args) => {
    let res;
    try {
      res = await orig.apply(api, args);
    } catch (err) {
      if (failed) safe(failed)(err, args);
      throw err;
    }
    safe(after)(res, args);
    return res;
  };
  w.__ach = true;
  api[name] = w;
}

const driveOf = (p) => {
  const s = String(p || '');
  if (/^[a-z]:/i.test(s)) return s.slice(0, 2).toUpperCase();
  const m = s.match(/^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)/);
  return m ? `\\\\${m[1]}\\${m[2]}`.slice(0, 24) : '';
};
const depthOf = (p) => String(p || '').split(/[\\/]+/).filter(Boolean).length - (/^[\\/]{2}/.test(String(p)) ? 2 : 1);
const isNetwork = (p) => /^[\\/]{2}/.test(String(p || ''));

/** Hooks the bridge calls and the jobs' finished events. Call once, after the bridge is set up. */
export function watchBridge(api) {
  if (!api || api.__achWatched) return;
  api.__achWatched = true;
  wrap(api, 'renameItem', (r) => r && r.ok && track('rename'));
  wrap(api, 'deleteItem', (r) => r && r.ok && track('delete', { n: 1 }));
  wrap(api, 'deleteItemPermanently', (r) => r && r.ok && track('delete', { n: 1 }));
  wrap(api, 'setFileColor', (r, [paths, color]) => color && track('label', { n: (paths || []).length }));
  wrap(api, 'editFileTags', (r, [paths, add]) => add && add.length && track('label', { n: (paths || []).length }));
  wrap(api, 'setFolderIcon', (r, [, icon]) => icon && track('folder_icon'));
  wrap(api, 'sendToExternalApp', (r) => r && r.ok && track('handoff'));
  wrap(api, 'startDragOut', () => track('handoff'));
  wrap(api, 'connectNetwork', () => track('net_ok'), () => track('net_fail'));
  wrap(api, 'checkFileTransfer', (r) => r && r.ok && r.conflicts && r.conflicts.length && track('conflict'));
  wrap(api, 'startFileTransfer', (r, [jobId, , , mode]) => r && r.ok && jobs.set(jobId, mode));
  wrap(api, 'readDirectory', (r, [dirPath, opts]) => {
    if (opts && opts.search) return;
    if (!r || r.error) {
      if (isNetwork(dirPath)) track('nav_fail', { network: true });
      return;
    }
    const where = r.currentPath || dirPath;
    const files = (r.items || []).filter((i) => !i.isDirectory).length;
    track('nav', { drive: driveOf(where), depth: depthOf(where), files, empty: !(r.items || []).length && (!opts || !opts.filter || opts.filter === 'all') });
  }, (err, [dirPath]) => isNetwork(dirPath) && track('nav_fail', { network: true }));

  if (!inTauri()) return;
  const job = (p) => String((p && (p.jobId || p.job_id)) || '');
  listen('file-transfer-finished', (e) => {
    const p = e.payload || {};
    const id = job(p);
    if (id && !fresh('job:' + id)) return;
    track('transfer', { mode: jobs.get(id) || 'copy', done: p.done, failed: p.failed, cancelled: p.cancelled });
    jobs.delete(id);
  }).catch(() => {});
  listen('batch-convert-finished', (e) => {
    const p = e.payload || {};
    if (job(p) && !fresh('job:' + job(p))) return;
    track('convert', { converted: p.converted, failed: p.failed, cancelled: p.cancelled });
  }).catch(() => {});
  listen('duplicate-scan-finished', (e) => {
    const p = e.payload || {};
    if (job(p) && !fresh('job:' + job(p))) return;
    if (p.error) return;
    track('dupscan', { cancelled: !!p.cancelled });
  }).catch(() => {});
}

/* ---------------------------------------------------------------- viewer helpers (one line in each viewer) */
const extOf = (p) => (String(p || '').match(/\.([a-z0-9]{1,8})$/i) || [])[1] || '';
/** A viewer has really loaded this file (kind: 3d, hdr, image, video, audio, pdf, md, txtex, sequence). */
export const opened = (kind, path) => path && track('open', { kind, ext: extOf(path), key: `${kind}:${path}` });
/** A viewer could not load a file (reason: the error text, kept short; never saved). */
export const openFailed = (kind, reason) => track('open_fail', { kind, reason: String(reason || '').slice(0, 60) });
/** A video or image sequence played to its last frame. */
export const watched = (kind, path, frames) => path && track('watched', { kind, frames: frames || 0, key: `w:${kind}:${path}` });
