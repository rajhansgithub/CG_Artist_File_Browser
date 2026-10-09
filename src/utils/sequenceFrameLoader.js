/**
 * Frame cache and decoder pool for image sequence playback.
 *
 * Frames are addressed by slot (0 .. slots-1): slot i is frame number first + i * step. Decoding happens in a
 * small pool of Web Workers (src/workers/sequenceDecoder.worker.js); decoded frames are kept as ImageBitmaps in
 * a memory-bounded cache. The player tells the loader which slots it will need next (`setWanted`, nearest
 * first) and the loader decodes them in that order, dropping whatever was queued before. Slots far from the
 * playhead are evicted first when the cache is full.
 */
import { framePath } from './imageSequence';
import { getFileBuffer } from './thumbnailService';
import { toStreamUrl } from './formatHelpers';

const FALLBACK_FRAME_BYTES = 1920 * 1080 * 4;

function cacheBudgetBytes() {
  // navigator.deviceMemory tops out at 8 (GB); keep the cache well inside a normal desktop's free memory
  const gb = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 8;
  return Math.min(2048, Math.max(512, gb * 96)) * 1024 * 1024;
}

function workerCount() {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(4, cores - 1));
}

export class SequenceFrameLoader {
  /**
   * @param {object} seq   `sequence` of a grouped sequence item (see imageSequence.js)
   * @param {object} hooks { onFrame(slot), onError(slot, message) }
   */
  constructor(seq, hooks = {}) {
    this.seq = seq;
    this.slots = seq.slots;
    this.hooks = hooks;
    this.budget = cacheBudgetBytes();
    this.cache = new Map(); // slot -> { bitmap, width, height, bytes }
    this.bytes = 0;
    this.frameBytes = FALLBACK_FRAME_BYTES;
    this.inflight = new Set();
    this.failed = new Map(); // slot -> message
    this.queue = [];
    this.protect = new Set();
    this.center = 0;
    this.workers = [];
    this.nextId = 1;
    this.disposed = false;
    this.exposure = undefined;
    this.needsExposure = /^\.(exr|hdr)$/i.test(seq.suffix);
  }

  has(slot) {
    return this.cache.has(slot);
  }

  get(slot) {
    return this.cache.get(slot) || null;
  }

  error(slot) {
    return this.failed.get(slot) || null;
  }

  // How many frames of the size seen so far fit in the cache
  capacity() {
    return Math.max(4, Math.floor(this.budget / this.frameBytes));
  }

  // Replaces the decode queue. `slots` is ordered by priority (the playhead first).
  setWanted(slots, center) {
    if (this.disposed) return;
    this.center = center;
    this.protect = new Set(slots);
    this.queue = slots.filter((s) => !this.cache.has(s) && !this.inflight.has(s) && !this.failed.has(s));
    this.pump();
  }

  // Forget a failed frame so the next setWanted tries it again (e.g. a file that was still being written)
  retry(slot) {
    this.failed.delete(slot);
  }

  pump() {
    if (this.disposed) return;
    while (this.queue.length) {
      // An EXR / HDR sequence is tone mapped with the exposure measured on its first decoded frame, so that
      // frame goes alone; the rest fan out across the pool once the exposure is known.
      if (this.needsExposure && this.exposure === undefined && this.inflight.size >= 1) return;
      const worker = this.idleWorker();
      if (!worker) return;
      const slot = this.queue.shift();
      if (this.cache.has(slot) || this.inflight.has(slot) || this.failed.has(slot)) continue;
      this.dispatch(worker, slot, false, null);
    }
  }

  idleWorker() {
    const idle = this.workers.find((w) => !w.busy);
    if (idle) return idle;
    if (this.workers.length >= workerCount()) return null;
    const worker = new Worker(new URL('../workers/sequenceDecoder.worker.js', import.meta.url), { type: 'module' });
    const entry = { worker, busy: false, job: null };
    worker.onmessage = (event) => this.onResult(entry, event.data);
    worker.onerror = (event) => {
      event.preventDefault?.();
      const job = entry.job;
      entry.busy = false;
      entry.job = null;
      if (job) this.fail(job.slot, event.message || 'The frame decoder stopped');
      this.pump();
    };
    this.workers.push(entry);
    return entry;
  }

  dispatch(entry, slot, retried, buffer) {
    const id = this.nextId++;
    const path = framePath(this.seq, this.seq.first + slot * this.seq.step);
    entry.busy = true;
    entry.job = { id, slot, path, retried };
    this.inflight.add(slot);
    const msg = { id, url: toStreamUrl(path), ext: this.seq.suffix, exposure: this.exposure };
    if (buffer) {
      msg.buffer = buffer;
      entry.worker.postMessage(msg, [buffer]);
    } else {
      entry.worker.postMessage(msg);
    }
  }

  onResult(entry, data) {
    const job = entry.job;
    if (!job || job.id !== data.id) return;

    if (this.disposed) {
      data.bitmap?.close?.();
      return;
    }

    if (data.ok) {
      entry.busy = false;
      entry.job = null;
      this.inflight.delete(job.slot);
      if (this.exposure === undefined && typeof data.exposure === 'number') this.exposure = data.exposure;
      const bytes = data.width * data.height * 4;
      this.frameBytes = bytes;
      this.cache.set(job.slot, { bitmap: data.bitmap, width: data.width, height: data.height, bytes });
      this.bytes += bytes;
      this.evict();
      this.hooks.onFrame?.(job.slot);
      this.pump();
      return;
    }

    // The asset URL could not be fetched: read the file through the app's own file command and try once more
    if (data.fetchFailed && !job.retried && window.electronAPI?.readFileBuffer) {
      getFileBuffer(job.path).then(
        (buffer) => {
          if (this.disposed) return;
          this.dispatch(entry, job.slot, true, buffer);
        },
        (err) => {
          entry.busy = false;
          entry.job = null;
          this.fail(job.slot, String(err?.message || err));
          this.pump();
        }
      );
      return;
    }

    entry.busy = false;
    entry.job = null;
    this.fail(job.slot, data.error);
    this.pump();
  }

  fail(slot, message) {
    this.inflight.delete(slot);
    this.failed.set(slot, message || 'Could not decode this frame');
    this.hooks.onError?.(slot, this.failed.get(slot));
  }

  // Frees the slots farthest ahead of the playhead (the ones just behind it, in a looping clip) until the cache fits
  evict() {
    while (this.bytes > this.budget) {
      let victim = -1;
      let farthest = -1;
      for (const slot of this.cache.keys()) {
        if (this.protect.has(slot)) continue;
        const distance = (slot - this.center + this.slots) % this.slots;
        if (distance > farthest) {
          farthest = distance;
          victim = slot;
        }
      }
      if (victim < 0) return;
      this.drop(victim);
    }
  }

  drop(slot) {
    const entry = this.cache.get(slot);
    if (!entry) return;
    entry.bitmap.close?.();
    this.bytes -= entry.bytes;
    this.cache.delete(slot);
  }

  dispose() {
    this.disposed = true;
    this.queue = [];
    for (const slot of [...this.cache.keys()]) this.drop(slot);
    for (const { worker } of this.workers) worker.terminate();
    this.workers = [];
  }
}
