import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const EMPTY_STATE = { assignments: {}, custom: [], location: '', portable: false };

// Same rule as the backend (folder_icons.rs normalize_key): separators unified, no trailing separator, lower case
export function normalizeFolderKey(path) {
  let s = String(path || '').trim().replace(/\//g, '\\');
  while (s.length > 3 && s.endsWith('\\')) s = s.slice(0, -1);
  return s.toLowerCase();
}

export const FolderIconsContext = createContext({
  assignments: {},
  customUrls: {},
  openMenu: () => {}
});

export function useFolderIcons() {
  return useContext(FolderIconsContext);
}

// Icons Windows already shows for customised folders, asked for once per folder (and only for folders flagged
// by the directory listing), so plain folders never cost an extra call.
const systemIconCache = new Map();

function loadSystemFolderIcon(path) {
  if (!systemIconCache.has(path)) {
    const api = window.electronAPI;
    const request = api?.getSystemFolderIcon ? api.getSystemFolderIcon(path) : Promise.resolve(null);
    systemIconCache.set(
      path,
      request.catch(() => null)
    );
  }
  return systemIconCache.get(path);
}

export function useSystemFolderIcon(path, enabled) {
  const [loaded, setLoaded] = useState({ path: null, url: null });

  useEffect(() => {
    if (!enabled || !path) return undefined;
    let alive = true;
    loadSystemFolderIcon(path).then((url) => {
      if (alive) setLoaded({ path, url });
    });
    return () => {
      alive = false;
    };
  }, [path, enabled]);

  return enabled && loaded.path === path ? loaded.url : null;
}

// The user's icon choices, loaded once at startup (one small file) and kept in sync with the backend.
export function useFolderIconStore() {
  const [state, setState] = useState(EMPTY_STATE);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const api = window.electronAPI;
    if (!api?.getFolderIcons) return undefined;
    api
      .getFolderIcons()
      .then((s) => {
        if (alive && s) setState(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const run = useCallback(async (call) => {
    setError('');
    try {
      const next = await call(window.electronAPI);
      if (next) setState(next);
      return true;
    } catch (err) {
      setError(typeof err === 'string' ? err : err?.message || 'Something went wrong');
      return false;
    }
  }, []);

  const setIcon = useCallback((path, icon) => run((api) => api.setFolderIcon(path, icon)), [run]);
  const resetIcon = useCallback((path) => run((api) => api.setFolderIcon(path, null)), [run]);

  const importIcons = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.openFilesDialog) return false;
    const files = await api.openFilesDialog({
      filters: [{ name: 'Icons (PNG, SVG, ICO, WebP, JPG)', extensions: ['png', 'svg', 'ico', 'webp', 'jpg', 'jpeg'] }]
    });
    if (!files || files.length === 0) return false;
    return run((a) => a.importFolderIcons(files));
  }, [run]);

  const removeCustomIcon = useCallback((id) => run((api) => api.removeFolderIcon(id)), [run]);

  const customUrls = useMemo(() => Object.fromEntries(state.custom.map((c) => [c.id, c.url])), [state.custom]);

  return {
    assignments: state.assignments,
    custom: state.custom,
    customUrls,
    location: state.location,
    portable: state.portable,
    error,
    clearError: () => setError(''),
    setIcon,
    resetIcon,
    importIcons,
    removeCustomIcon
  };
}
