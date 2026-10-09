import { useCallback, useEffect, useState } from 'react';

// Colour labels and tags for files. The backend keeps them in the app's own store (keyed by path),
// so the user's files are never changed.
export const LABEL_COLORS = [
  { id: 'red', name: 'Red', hex: '#e5484d' },
  { id: 'orange', name: 'Orange', hex: '#f76b15' },
  { id: 'yellow', name: 'Yellow', hex: '#f5c400' },
  { id: 'green', name: 'Green', hex: '#30a46c' },
  { id: 'blue', name: 'Blue', hex: '#3e72e5' },
  { id: 'purple', name: 'Purple', hex: '#8e4ec6' },
  { id: 'gray', name: 'Gray', hex: '#8b8d98' }
];

export const EMPTY_LABEL = Object.freeze({ color: null, tags: Object.freeze([]) });
export const EMPTY_LABEL_FILTER = Object.freeze({ colors: Object.freeze([]), tags: Object.freeze([]) });

export function getLabelColor(id) {
  return LABEL_COLORS.find((c) => c.id === id) || null;
}

// Same rule as the backend (file_labels.rs normalize_key): separators unified, no trailing separator, lower case
export function normalizeLabelKey(path) {
  let s = String(path || '').trim().replace(/\//g, '\\');
  while (s.length > 3 && s.endsWith('\\')) s = s.slice(0, -1);
  return s.toLowerCase();
}

export function labelFor(labels, path) {
  return labels[normalizeLabelKey(path)] || EMPTY_LABEL;
}

// The label shown for a selection: a colour only when every item has that colour, and the tags they all share
export function labelForItems(labels, items) {
  if (!items.length) return EMPTY_LABEL;
  const all = items.map((item) => labelFor(labels, item.path));
  const first = all[0];
  return {
    color: all.every((label) => label.color === first.color) ? first.color : null,
    tags: first.tags.filter((tag) => all.every((label) => label.tags.includes(tag)))
  };
}

export function isLabelFilterActive(filter) {
  return filter.colors.length > 0 || filter.tags.length > 0;
}

// A file passes when it has one of the chosen colours (if any are chosen) and every chosen tag
export function matchesLabelFilter(label, filter) {
  if (filter.colors.length && !filter.colors.includes(label.color)) return false;
  return filter.tags.every((tag) => label.tags.includes(tag));
}

// Every tag in use, for the filter list
export function collectTags(labels) {
  const all = new Set();
  Object.values(labels).forEach((label) => label.tags.forEach((tag) => all.add(tag)));
  return [...all].sort();
}

// Loads the labels once and keeps them in step with the backend's answers to each change
export function useFileLabelStore() {
  const [labels, setLabels] = useState({});

  useEffect(() => {
    let alive = true;
    const api = window.electronAPI;
    if (!api?.getFileLabels) return undefined;
    api
      .getFileLabels()
      .then((map) => {
        if (alive && map) setLabels(map);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Entries come back for every path that changed; an empty one means that file has no label any more
  const applyResult = useCallback((result) => {
    if (!result) return;
    setLabels((prev) => {
      const next = { ...prev };
      Object.entries(result).forEach(([key, label]) => {
        if (label.color || label.tags.length) next[key] = label;
        else delete next[key];
      });
      return next;
    });
  }, []);

  const setColor = useCallback(
    async (paths, color) => {
      const api = window.electronAPI;
      if (!api?.setFileColor) return;
      try {
        applyResult(await api.setFileColor(paths, color || null));
      } catch (err) {
        console.error('Failed to save colour label:', err);
      }
    },
    [applyResult]
  );

  const editTags = useCallback(
    async (paths, add = [], remove = []) => {
      const api = window.electronAPI;
      if (!api?.editFileTags) return;
      try {
        applyResult(await api.editFileTags(paths, add, remove));
      } catch (err) {
        console.error('Failed to save tags:', err);
      }
    },
    [applyResult]
  );

  return { labels, setColor, editTags };
}
