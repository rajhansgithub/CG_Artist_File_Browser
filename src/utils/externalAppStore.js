import { useSyncExternalStore } from 'react';

// Apps the right-click "Send to" menu can open files in (Blender, Maya, ...). They are set up in Settings >
// External apps and kept in the app's config (external_apps.rs). This store holds one copy in memory, so the
// menu and Settings always show the same list.
let apps = [];
const listeners = new Set();

function publish(next) {
  apps = next || [];
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useExternalApps() {
  return useSyncExternalStore(subscribe, () => apps);
}

export async function refreshExternalApps() {
  if (!window.electronAPI?.getExternalApps) return;
  publish(await window.electronAPI.getExternalApps());
}

// Adds an app by the path of its .exe. Throws with the reason when it cannot be added
export async function addExternalApp(path, name) {
  publish(await window.electronAPI.addExternalApp(path, name));
}

export async function removeExternalApp(path) {
  publish(await window.electronAPI.removeExternalApp(path));
}

// Looks for installed apps again. Resolves how many were added
export async function scanExternalApps() {
  const result = await window.electronAPI.scanExternalApps();
  publish(result.apps);
  return result.added;
}

// Opens the files in the app. Resolves { ok } or { ok: false, error }
export function sendToExternalApp(app, paths) {
  return window.electronAPI.sendToExternalApp(app.path, paths);
}
