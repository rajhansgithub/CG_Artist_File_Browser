import { useCallback, useEffect, useRef, useState } from 'react';

// How long a finished paste (or a notice) stays in the panel when everything went well
const AUTO_DISMISS_MS = 4000;

const lastPart = (path) => String(path || '').split(/[\\/]/).filter(Boolean).pop() || String(path || '');

// Pastes in progress, for the panel in the corner. The copying itself runs in Rust (src-tauri/src/file_ops.rs) and reports
// through events, so a paste never holds up the window. `onFinished(job)` runs once a paste has ended, with every row's
// last status, so the app can show the new files.
//
// A job is { id, kind: 'transfer', mode: 'copy' | 'move', destDir, rows, bytesDone, bytesTotal, summary }; `summary` is
// null until it ends. A notice is { id, kind: 'notice', text }.
export function useFileTransfers({ onFinished }) {
  const [jobs, setJobs] = useState([]);
  const jobsRef = useRef([]);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const update = useCallback((next) => {
    jobsRef.current = typeof next === 'function' ? next(jobsRef.current) : next;
    setJobs(jobsRef.current);
  }, []);

  const dismiss = useCallback((id) => update((prev) => prev.filter((job) => job.id !== id)), [update]);

  const dismissLater = useCallback(
    (id) => {
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss]
  );

  // One listener for the life of the app: every job's events come through it
  useEffect(() => {
    let stop = null;
    let gone = false;
    window.electronAPI?.onFileTransferEvent?.((type, payload) => {
      if (type === 'progress') {
        update((prev) =>
          prev.map((job) =>
            job.id !== payload.jobId
              ? job
              : {
                  ...job,
                  bytesDone: payload.bytesDone,
                  bytesTotal: payload.bytesTotal,
                  rows: job.rows.map((row) =>
                    row.index === payload.index && payload.status !== 'working'
                      ? { ...row, status: payload.status, outPath: payload.outPath, error: payload.error }
                      : row.index === payload.index
                        ? { ...row, status: 'working' }
                        : row
                  )
                }
          )
        );
        return;
      }
      const job = jobsRef.current.find((j) => j.id === payload.jobId);
      if (!job) return;
      const summary = { done: payload.done, failed: payload.failed, cancelled: payload.cancelled };
      const ended = { ...job, summary };
      update((prev) => prev.map((j) => (j.id === job.id ? ended : j)));
      if (!summary.failed && !summary.cancelled) dismissLater(job.id);
      onFinishedRef.current?.(ended);
    }).then((unlisten) => {
      if (gone) unlisten();
      else stop = unlisten;
    });
    return () => {
      gone = true;
      stop?.();
    };
  }, [update, dismissLater]);

  // Starts a paste. `items` are the { path, name, isDirectory } being copied or moved. Resolves an error message, or null.
  const start = useCallback(
    async (items, destDir, mode, replace) => {
      const id = `paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const rows = items.map((item, index) => ({
        index,
        name: item.name || lastPart(item.path),
        path: item.path,
        isDirectory: !!item.isDirectory,
        status: 'waiting'
      }));
      // The job is shown before it starts, so the first events cannot arrive for a job the panel does not know
      update((prev) => [...prev, { id, kind: 'transfer', mode, destDir, rows, bytesDone: 0, bytesTotal: 0, summary: null }]);
      const res = await window.electronAPI.startFileTransfer(id, items.map((item) => item.path), destDir, mode, replace);
      if (!res.ok) {
        dismiss(id);
        return res.error;
      }
      return null;
    },
    [update, dismiss]
  );

  const cancel = useCallback((id) => window.electronAPI?.cancelFileTransfer?.(id), []);

  // A short message in the panel that goes away by itself
  const notify = useCallback(
    (text) => {
      const id = `notice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      update((prev) => [...prev, { id, kind: 'notice', text }]);
      dismissLater(id);
    },
    [update, dismissLater]
  );

  return { jobs, start, cancel, dismiss, notify };
}
