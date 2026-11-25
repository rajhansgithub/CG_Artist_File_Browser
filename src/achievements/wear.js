/**
 * Age on the shelf (docs/ACHIEVEMENTS.md, "Dust and cobwebs"): an earned medal slowly gathers dust, and after a few weeks a
 * cobweb, in real time. Polishing it in the full view takes the cobweb off at once and some of the dust each rub. Only the
 * look changes: no XP, nothing is ever taken away. The Emulsion bubble never ages.
 *
 * Kept per badge on this computer (localStorage), small: { d: dust left after the last polish (0..1 of the full amount),
 * t: last polished (ms), n: polishes }. The maths is the Achievements Lab's (page.js wearOf / polish / webSeed), with real
 * days in place of the lab's one hour = one day.
 */
const KEY = 'cgabAchWearV1';
const DAY_MS = 86400e3;
const root = typeof window !== 'undefined' ? window : globalThis;
const store = {
  get() {
    try {
      return root.localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(v) {
    try {
      root.localStorage.setItem(KEY, v);
    } catch {
      /* storage blocked: the look still works for this session */
    }
  },
};
let W = null;
const load = () => {
  if (W) return W;
  try {
    const o = JSON.parse(store.get() || '{}');
    W = o && typeof o === 'object' ? o : {};
  } catch {
    W = {};
  }
  return W;
};
const save = () => store.set(JSON.stringify(W));
const age = () => root.ACHAge || { dustAmt: 2, dustDays: 527, webStart: 20, webSpan: 330, rubDust: 0.3 };

/** This medal's own seed for its cobweb and dust (0..1): FNV-1a, then a murmur3 finish (same as the lab). */
export function seedOf(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** The record, made the first time a medal is seen: clean from the day it was earned (`since`: the save's day number). */
function rec(id, since) {
  const w = load();
  let r = w[id];
  if (!r) {
    const at = since > 0 ? (since < 1e7 ? since * DAY_MS : since) : Date.now();
    r = w[id] = { d: 0, t: Math.min(Date.now(), at), n: 0 };
    save();
  }
  return r;
}
/** How aged a medal is now: d dust 0..1, w cobweb 0..1, sd its seed, cond 0..100 %, clean. */
export function wearOf(id, since) {
  const r = rec(id, since);
  const A = age();
  const days = Math.max(0, (Date.now() - r.t) / DAY_MS);
  const d = Math.min(1, A.dustAmt * (1 - (1 - r.d) * Math.exp(-days / A.dustDays)));
  const w = days < A.webStart ? 0 : Math.min(1, Math.pow((days - A.webStart) / A.webSpan, 0.8));
  return { d, w, sd: seedOf(id), days, n: r.n || 0, cond: Math.round(100 * (1 - (0.7 * d + 0.3 * w))), clean: d < 0.02 && w < 0.01 };
}
/** One rub: the cobweb goes, and rubDust of the dust. Returns the new wear. */
export function polish(id) {
  const A = age();
  const w = wearOf(id);
  const r = load()[id];
  r.d = (w.d * (1 - A.rubDust)) / Math.max(A.dustAmt, 0.01);
  if (r.d * A.dustAmt < 0.015) r.d = 0;
  r.t = Date.now();
  r.n = (r.n || 0) + 1;
  save();
  return wearOf(id);
}
/** The shader's wear vector: [dust, seed, cobweb]. */
export const wearVec = (w) => [w.d, w.sd, w.w];
