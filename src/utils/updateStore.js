import { useSyncExternalStore } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// In-app updates (app_update.rs, docs/UPDATES.md). One copy of the state in memory, so Settings, the dot on
// the Settings button and the small notice in the corner always agree.
//
// status: idle | checking | latest | available | downloading | installing | error
// The once-a-day check is silent: when it fails (offline, proxy) nothing is shown and it simply tries again later.

const AUTO_KEY = 'cg_artist_update_auto';
const LAST_KEY = 'cg_artist_update_last_check';
const SKIP_KEY = 'cg_artist_update_skip';
const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 20 * 1000;
const RECHECK_EVERY_MS = 3 * 60 * 60 * 1000;

function readPref(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch {
    // Not saved: the choice still holds until the app closes
  }
}

let state = {
  info: null,
  status: 'idle',
  found: null,
  progress: null,
  error: '',
  lastCheck: Number(readPref(LAST_KEY, '0')) || 0,
  auto: readPref(AUTO_KEY, '1') !== '0',
  skipped: readPref(SKIP_KEY, ''),
  report: null,
  // The notice in the corner for a version found by the daily check; closed with "Later"
  noticeOpen: false,
};
const listeners = new Set();

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUpdates() {
  return useSyncExternalStore(subscribe, () => state);
}

export function updatesAvailable() {
  return isTauri();
}

// A newer version the user has not chosen to skip: shows the dot on the Settings button
export function hasNewVersion(s = state) {
  return !!s.found && (s.status === 'available' || s.status === 'error') && s.found.version !== s.skipped;
}

async function loadInfo() {
  if (state.info || !updatesAvailable()) return state.info;
  try {
    set({ info: await invoke('update_info') });
  } catch {
    // Older back end or not in the app: the Updates section stays hidden
  }
  return state.info;
}

function errorText(err) {
  return (typeof err === 'string' ? err : err?.message) || 'The update did not work. Nothing was changed.';
}

let checking = null;

// silent: the daily check. It never shows an error and only opens the corner notice for a new version.
export function checkForUpdates({ silent = false } = {}) {
  if (checking) return checking;
  if (['downloading', 'installing'].includes(state.status)) return Promise.resolve();
  checking = (async () => {
    const info = await loadInfo();
    if (!info?.configured) {
      if (!silent) set({ status: 'error', error: 'Updates are not set up in this build of the app.' });
      return;
    }
    const before = { status: state.status, found: state.found, error: state.error };
    if (!silent) set({ status: 'checking', error: '' });
    try {
      const found = await invoke('update_check');
      const lastCheck = Date.now();
      writePref(LAST_KEY, lastCheck);
      if (found) {
        const isNew = !state.found || state.found.version !== found.version;
        set({
          status: 'available',
          found,
          error: '',
          lastCheck,
          noticeOpen: silent ? (isNew ? found.version !== state.skipped : state.noticeOpen) : false,
        });
      } else {
        set({ status: 'latest', found: null, error: '', lastCheck, noticeOpen: false });
      }
    } catch (err) {
      if (silent) set(before);
      else set({ status: 'error', error: errorText(err) });
    }
  })().finally(() => {
    checking = null;
  });
  return checking;
}

// Downloads, checks and installs. On success the app closes and opens again on the new version.
export async function installUpdate() {
  if (!state.found || ['downloading', 'installing'].includes(state.status)) return;
  set({ status: 'downloading', progress: { downloaded: 0, total: null }, error: '', noticeOpen: false });
  try {
    await invoke('update_install');
    // Only reached when the app did not close (should not happen): show it as being installed
    set({ status: 'installing' });
  } catch (err) {
    set({ status: 'error', error: errorText(err), progress: null });
  }
}

export function skipVersion(version) {
  writePref(SKIP_KEY, version);
  set({ skipped: version, noticeOpen: false });
}

export function setAutoCheck(on) {
  writePref(AUTO_KEY, on ? '1' : '0');
  set({ auto: on });
  if (on) maybeAutoCheck();
}

export function closeNotice() {
  set({ noticeOpen: false });
}

export function dismissReport() {
  set({ report: null });
}

export async function openReleasesPage() {
  const page = state.info?.releasesPage;
  if (!page) return;
  try {
    await invoke('open_url', { url: page });
  } catch {
    // The link could not be opened; nothing else to do
  }
}

function maybeAutoCheck() {
  if (!state.auto) return;
  if (Date.now() - state.lastCheck < DAY_MS) return;
  checkForUpdates({ silent: true });
}

let started = false;

// Called once when the app window has loaded.
export async function startUpdates() {
  if (started || !updatesAvailable()) return;
  started = true;
  try {
    await listen('update-progress', (e) => {
      const p = e.payload || {};
      if (p.stage === 'install') set({ status: 'installing', progress: { downloaded: p.downloaded, total: p.total } });
      else set({ progress: { downloaded: p.downloaded, total: p.total ?? null } });
    });
  } catch {
    // No progress bar, the update itself still works
  }
  try {
    // Tells a waiting old portable exe that this one started, and says how the last update went
    const report = await invoke('update_startup');
    if (report) set({ report });
  } catch {
    // Older back end
  }
  await loadInfo();
  setTimeout(maybeAutoCheck, FIRST_CHECK_DELAY_MS);
  setInterval(maybeAutoCheck, RECHECK_EVERY_MS);
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export function formatAgo(ms) {
  if (!ms) return '';
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
