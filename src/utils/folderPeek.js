import { useEffect, useState } from 'react';
import { getOrGenerateThumbnail } from './thumbnailService';

// Folder tiles show up to four pictures from inside the folder. The backend reads names only (peek_folder) and
// stops after a few hundred entries. Results are kept per folder, and only two folders are read at a time, so a
// screen full of folders never floods the disk. Network folders are skipped: a slow share must not hold up the grid.
const PEEK_LIMIT = 4;
const CACHE_LIMIT = 400;
const MAX_RUNNING = 2;

const cache = new Map(); // folder path -> picture items ([] when the folder has none)
const waiting = [];
let running = 0;

function pump() {
  while (running < MAX_RUNNING && waiting.length) {
    const job = waiting.shift();
    if (job.signal.aborted) {
      job.resolve(null);
      continue;
    }
    running += 1;
    window.electronAPI
      .peekFolder(job.path, PEEK_LIMIT)
      .catch(() => [])
      .then((items) => {
        const list = items || [];
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
        cache.set(job.path, list);
        job.resolve(list);
      })
      .finally(() => {
        running -= 1;
        pump();
      });
  }
}

function peek(path, signal) {
  if (cache.has(path)) return Promise.resolve(cache.get(path));
  return new Promise((resolve) => {
    waiting.push({ path, signal, resolve });
    pump();
  });
}

// Drops what is known about a folder, so the next tile shows its current pictures (after a refresh or file change)
export function forgetFolderPeek(path) {
  if (path) cache.delete(path);
  else cache.clear();
}

// The thumbnails (URLs) for a folder tile. Empty until loaded, and empty for folders with no pictures.
export function useFolderPeek(path, enabled) {
  const [urls, setUrls] = useState([]);

  useEffect(() => {
    setUrls([]);
    if (!enabled || !path || !window.electronAPI?.peekFolder) return undefined;
    const controller = new AbortController();
    peek(path, controller.signal).then(async (items) => {
      if (!items || !items.length || controller.signal.aborted) return;
      const found = await Promise.all(
        items.map((item) => getOrGenerateThumbnail(item, { signal: controller.signal }).catch(() => null))
      );
      if (!controller.signal.aborted) setUrls(found.filter(Boolean));
    });
    return () => controller.abort();
  }, [path, enabled]);

  return urls;
}
