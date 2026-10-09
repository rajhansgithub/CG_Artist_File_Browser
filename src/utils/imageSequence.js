/**
 * Image sequence detection.
 *
 * Render passes arrive as numbered files: shot.0001.exr, shot_0001.png, shot0001.png ...
 * `groupImageSequences` folds every such series in a folder listing into ONE item, so the grid
 * shows `shot.####.exr` once instead of a thousand cards. The item keeps the first frame's path,
 * thumbnail, extension and category (the thumbnail pipeline and the card styling keep working) and
 * carries a compact `sequence` description. Frame paths are rebuilt on demand with `framePath`.
 */

// Formats the frame decoder (src/workers/sequenceDecoder.worker.js) can read.
const SEQUENCE_EXTENSIONS = new Set([
  '.exr',
  '.hdr',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.tga'
]);

// Two numbered files are a pair of variants (Wall_01 / Wall_02), not a clip.
export const MIN_SEQUENCE_FRAMES = 3;

// A series that skips frames at a regular step (1, 6, 11 ...) needs more evidence than a plain run
const MIN_STEPPED_FRAMES = 5;

// Share of the frame slots between the first and last frame that must exist. Lower than this and
// the files are numbered variants, not a render that lost a few frames.
const MIN_DENSITY = 0.5;

// <prefix><digits><.ext>, the digits being the last number before the extension.
const FRAME_NAME = /^(.*?)(\d+)(\.[^./\\]+)$/;

export function isSequenceExtension(ext) {
  return SEQUENCE_EXTENSIONS.has((ext || '').toLowerCase());
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

function splitPath(path) {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut < 0 ? { dir: '', sep: '', name: path } : { dir: path.slice(0, cut), sep: path[cut], name: path.slice(cut + 1) };
}

// Frames with the same prefix and extension may still use different padding (0001 vs 10000, or 1, 2 ... 10).
// Returns lists of entries that share one padding: { pad, entries }.
function splitByPadding(entries) {
  const lengths = new Set(entries.map((e) => e.digits.length));
  if (lengths.size === 1) return [{ pad: entries[0].digits.length, entries }];

  // 1, 2 ... 9, 10, 11: unpadded numbers of mixed length are one series
  const anyLeadingZero = entries.some((e) => e.digits.length > 1 && e.digits[0] === '0');
  if (!anyLeadingZero) return [{ pad: 0, entries }];

  const byLength = new Map();
  for (const e of entries) {
    if (!byLength.has(e.digits.length)) byLength.set(e.digits.length, []);
    byLength.get(e.digits.length).push(e);
  }
  return [...byLength.entries()].map(([pad, list]) => ({ pad, entries: list }));
}

function describeSequence(dir, sep, prefix, suffix, pad, entries) {
  const sorted = [...entries].sort((a, b) => a.number - b.number);
  const numbers = sorted.map((e) => e.number);
  let step = 0;
  for (let i = 1; i < numbers.length; i++) step = gcd(step, numbers[i] - numbers[i - 1]);
  step = step || 1;
  const first = numbers[0];
  const last = numbers[numbers.length - 1];
  const slots = (last - first) / step + 1;
  if (numbers.length / slots < MIN_DENSITY) return null;
  // Every 5th frame is a legitimate proxy render; Chair_01 / Chair_05 / Chair_09 are three variants
  if (step > 1 && numbers.length < MIN_STEPPED_FRAMES) return null;
  return { dir, sep, prefix, suffix, pad, step, first, last, numbers, slots };
}

/**
 * Replaces every numbered series (at least MIN_SEQUENCE_FRAMES files) in `items` with one item.
 * Order is kept: a series takes the place of its first frame in the listing.
 */
export function groupImageSequences(items) {
  if (!items || items.length < MIN_SEQUENCE_FRAMES) return items;

  // 1. Bucket candidate files by directory + prefix + extension
  const buckets = new Map();
  const parsed = new Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.isDirectory || item.isSequence || !isSequenceExtension(item.extension)) continue;
    const { dir, sep, name } = splitPath(item.path);
    const m = FRAME_NAME.exec(name);
    if (!m) continue;
    const entry = { index: i, item, digits: m[2], number: parseInt(m[2], 10) };
    if (!Number.isSafeInteger(entry.number)) continue;
    parsed[i] = entry;
    const key = `${dir}\u0000${m[1]}\u0000${m[3]}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { dir, sep, prefix: m[1], suffix: m[3], entries: [] };
      buckets.set(key, bucket);
    }
    bucket.entries.push(entry);
  }

  // 2. Turn buckets into sequences
  const replaceAt = new Map(); // index of a series' first listed frame -> sequence item
  const dropped = new Set(); // indices of every other frame
  for (const bucket of buckets.values()) {
    if (bucket.entries.length < MIN_SEQUENCE_FRAMES) continue;
    for (const { pad, entries } of splitByPadding(bucket.entries)) {
      if (entries.length < MIN_SEQUENCE_FRAMES) continue;
      const seq = describeSequence(bucket.dir, bucket.sep, bucket.prefix, bucket.suffix, pad, entries);
      if (!seq) continue;
      const anchor = entries.reduce((lowest, e) => Math.min(lowest, e.index), Infinity);
      const firstFrame = entries.find((e) => e.number === seq.first).item;
      const total = entries.reduce((sum, e) => sum + (e.item.size || 0), 0);
      const newest = entries.reduce((latest, e) => Math.max(latest, e.item.modified || 0), 0);
      replaceAt.set(anchor, {
        ...firstFrame,
        name: sequenceDisplayName(seq),
        isSequence: true,
        sequence: seq,
        frameCount: seq.numbers.length,
        size: total,
        modified: newest
      });
      for (const e of entries) if (e.index !== anchor) dropped.add(e.index);
    }
  }
  if (replaceAt.size === 0) return items;

  // 3. Rebuild the listing
  const out = [];
  for (let i = 0; i < items.length; i++) {
    if (dropped.has(i)) continue;
    out.push(replaceAt.get(i) || items[i]);
  }
  return out;
}

// shot.####.exr  (padding shown as #, unpadded numbers as %d)
export function sequenceDisplayName(seq) {
  return `${seq.prefix}${seq.pad > 0 ? '#'.repeat(seq.pad) : '%d'}${seq.suffix}`;
}

export function formatFrameNumber(seq, number) {
  const text = String(number);
  return seq.pad > 0 ? text.padStart(seq.pad, '0') : text;
}

// Full path of one frame of a series (`number` is the frame number in the file name, not an index)
export function framePath(seq, number) {
  return `${seq.dir}${seq.sep}${seq.prefix}${formatFrameNumber(seq, number)}${seq.suffix}`;
}

// "1001-1100" or "1001-1100 step 2"
export function sequenceRangeLabel(seq) {
  const range = `${seq.first}-${seq.last}`;
  return seq.step > 1 ? `${range} step ${seq.step}` : range;
}

// Frames missing between the first and the last (0 for a complete series)
export function missingFrameCount(seq) {
  return seq.slots - seq.numbers.length;
}
