/**
 * Bounded work lane for thumbnail generation.
 *
 * A lane runs at most `concurrency` jobs at once and keeps the rest in a waiting list. Each job can carry an
 * AbortSignal: a job whose signal aborts while it still waits is dropped and resolves to null, so cards that
 * scrolled out of view or belonged to a folder the user left never start their decode. A job that already
 * started runs to the end (its result still lands in the cache for the next time the card is shown).
 *
 * Only cards in view ever join a lane (the grid observes them), so a waiting queue holds what is on screen.
 */
export class ThumbnailLane {
  constructor(concurrency) {
    this.concurrency = Math.max(1, concurrency);
    this.running = 0;
    this.waiting = [];
  }

  /**
   * Queues `task` (an async function). Resolves to its result, or to null when the task fails or was
   * cancelled before it started.
   */
  run(signal, task) {
    if (signal?.aborted) return Promise.resolve(null);

    return new Promise((resolve) => {
      const job = { task, resolve, signal, onAbort: null };
      if (signal) {
        job.onAbort = () => {
          const index = this.waiting.indexOf(job);
          if (index !== -1) {
            this.waiting.splice(index, 1);
            resolve(null);
          }
        };
        signal.addEventListener('abort', job.onAbort, { once: true });
      }
      this.waiting.push(job);
      this.pump();
    });
  }

  pump() {
    while (this.running < this.concurrency && this.waiting.length > 0) {
      const job = this.waiting.shift();
      if (job.signal && job.onAbort) job.signal.removeEventListener('abort', job.onAbort);
      this.running++;
      Promise.resolve()
        .then(job.task)
        .then(job.resolve, (err) => {
          console.warn('Thumbnail job failed:', err?.message || err);
          job.resolve(null);
        })
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }
}
