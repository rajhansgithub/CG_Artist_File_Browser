/**
 * Achievements + XP (docs/ACHIEVEMENTS.md): the pure part. No DOM, no Tauri, so `node --test` runs it as is
 * (test/achievements.test.mjs).
 *
 * The system only watches. It never changes what the app does. It counts only real work that finished:
 * a 3D model or HDR/EXR that loaded with no error (each file once), a copy or move that ended, a rename, a label,
 * a batch convert, a duplicate scan that ran to the end. Clicks, opens of the same file again and re-runs never count.
 *
 *   CATALOG / CATS                  every achievement and category
 *   apply(state, ev, ctx)           -> { state, unlocked: [id], tiers, sets, gate, level: { from, to } }   ctx = { now }
 *   merge(a, b)                     two saved states (local + roaming copy) -> one; never loses anything
 *   levelOf(xp) / totalXp(state) / progress(state, def) / gateOf(state) / rankOf(level, gateOpen)
 *   tierOf(state, id) / setsOf(state) / notesOf(state, def) / normalize(v) / same(a, b)
 *
 * Shared scoring (Emulsion Labs, 2026-11-22): XP curve, flat XP, tier XP, record XP, title levels and ranks are the same in
 * every Emulsion Labs tool. Only the badges, ladder counts and words are this app's own.
 *
 * FREE MODE: the app has no paid plan. Emulsion (tier 7) is earned slowly: the Emulsion gate (gateOf) opens only when
 * level 30, 180 days of real use in 6+ months, 3 badges at Ruby and this app's own mastery numbers all hold.
 */

export const KEY = 'cgabAchV1';
const DAY = 86400000;
export const FLAT_CAP = 40; // flat XP a day at most: normal use is rewarded, grinding is not

// Features that are in this build. A badge with a `feature` key not listed here shows "Coming soon" and cannot be earned.
export const SHIPPED = new Set(['viewers', 'compare', 'labels', 'transfer', 'convert', 'duplicates', 'network', 'folderIcons', 'sendTo']);

export const CATS = [
  { id: 'start', title: 'Getting started' },
  { id: 'review', title: 'Reviewing' },
  { id: 'organise', title: 'Organising' },
  { id: 'pipeline', title: 'Pipeline' },
  { id: 'mastery', title: 'Mastery' },
  { id: 'loyal', title: 'Loyalty' },
  { id: 'jokes', title: 'Happy accidents' },
  { id: 'secret', title: 'Secrets' }
];

export const METALS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ruby', 'Emulsion'];
const TOP = METALS.length; // 7
export const EMU = 7; // Emulsion: opens through the gate only (badge tier, set record and rank)
export const LADDER_XP = [25, 50, 100, 250, 500, 1000, 2000];
export const RECORD_XP = [100, 200, 400, 800, 1500, 3000, 6000];

// Three sets of 4 tiered badges. All four at a tier = that set's certified showreel of that metal.
export const SETS = [
  { id: 'reviewer', title: 'The Reviewer', pieces: ['model_citizen', 'light_meter', 'dailies', 'lookdev_lead'] },
  { id: 'wrangler', title: 'The Wrangler', pieces: ['mover_and_shaker', 'tidy_desk', 'taxonomist', 'clean_sweep'] },
  { id: 'pipeline', title: 'The Pipeline', pieces: ['factory_line', 'hand_off', 'twin_finder', 'pipeline_td'] }
];

// The Emulsion gate (FREE MODE). Level, days and months are shared numbers; the last two are this app's mastery.
export const GATE = { level: 30, days: 180, months: 6, ruby: 3, changes: 50000, reviewed: 1000 };

const A = (id, cat, title, desc, xp, icon, more) =>
  Object.assign({ id, cat, title, desc, xp, icon, tier: xp >= 250 ? 'rare' : xp <= 10 ? 'joke' : '' }, more || {});
const L = (id, cat, title, desc, icon, c, at, more) =>
  Object.assign({ id, cat, title, desc, xp: LADDER_XP[0], icon, tier: '', ladder: { c, at, xp: LADDER_XP } }, more || {});

export const CATALOG = [
  A('first_light', 'start', 'First Light', 'Open a folder with files in it', 25, 'folder'),
  A('globetrotter', 'start', 'Globetrotter', 'Browse folders on 3 different drives', 50, 'drive'),
  A('deep_diver', 'start', 'Deep Diver', 'Open a folder 10 levels deep', 50, 'dive'),
  A('quick_draw', 'start', 'Quick Draw', 'Quick Look 10 different files', 50, 'eye', { goal: { c: 'ql', n: 10 } }),
  A('color_coded', 'start', 'Color Coded', 'Give a file a colour label or a tag', 25, 'tag', { feature: 'labels' }),
  A('plugged_in', 'start', 'Plugged In', 'Sign in to a network share', 50, 'network', { feature: 'network' }),

  L('model_citizen', 'review', 'Model Citizen', 'Different 3D models opened with no load error', 'cube', 'models', [5, 25, 100, 400, 1500, 5000, 15000], { feature: 'viewers' }),
  L('light_meter', 'review', 'Light Meter', 'Different HDR and EXR files opened with no error', 'sun', 'hdrs', [5, 25, 100, 400, 1500, 5000, 15000], { feature: 'viewers' }),
  L('dailies', 'review', 'Dailies', 'Videos and image sequences played to the end', 'film', 'watched', [1, 10, 50, 200, 800, 3000, 8000], { feature: 'viewers' }),
  L('lookdev_lead', 'review', 'Lookdev Lead', 'Different pairs compared side by side', 'compare', 'pairs', [1, 10, 50, 200, 1000, 4000, 10000], { feature: 'compare' }),
  A('format_hopper', 'review', 'Format Hopper', 'Open 3D models in 4 different formats', 100, 'cube', { goal: { c: 'fmn', n: 4 } }),
  A('reading_room', 'review', 'Reading Room', 'Open a PDF and a Markdown file', 25, 'book'),
  A('mip_master', 'review', 'Mip Master', 'Open a .tx or .tex texture', 50, 'layers'),

  L('mover_and_shaker', 'organise', 'Mover & Shaker', 'Files copied or moved, finished', 'move', 'moved', [10, 100, 500, 2000, 10000, 50000, 100000], { feature: 'transfer' }),
  L('tidy_desk', 'organise', 'Tidy Desk', 'Files and folders renamed', 'rename', 'renamed', [5, 50, 250, 1000, 5000, 20000, 50000]),
  L('taxonomist', 'organise', 'Taxonomist', 'Files given a colour label or tags', 'tag', 'tagged', [10, 100, 500, 2000, 10000, 50000, 100000], { feature: 'labels' }),
  L('clean_sweep', 'organise', 'Clean Sweep', 'Files sent to the Recycle Bin or deleted', 'broom', 'deleted', [10, 100, 500, 2000, 10000, 50000, 100000]),
  L('interior_designer', 'organise', 'Interior Designer', 'Custom folder icons set', 'folder', 'icons', [1, 5, 20, 50, 150, 400, 1000], { feature: 'folderIcons' }),

  L('factory_line', 'pipeline', 'Factory Line', 'Files batch converted', 'convert', 'conv', [10, 100, 500, 2000, 10000, 50000, 100000], { feature: 'convert' }),
  L('hand_off', 'pipeline', 'Hand Off', 'Files sent to another app or dragged out', 'send', 'handoff', [1, 25, 100, 500, 2000, 10000, 25000], { feature: 'sendTo' }),
  L('twin_finder', 'pipeline', 'Twin Finder', 'Duplicate scans run to the end', 'twins', 'scans', [1, 5, 20, 60, 150, 400, 1000], { feature: 'duplicates' }),
  A('conversion_therapy', 'pipeline', 'Conversion Therapy', 'A batch convert with zero failures', 50, 'convert', { feature: 'convert' }),
  A('full_set', 'pipeline', 'Full Set', 'Open a PBR texture set', 50, 'grid'),

  L('pipeline_td', 'mastery', 'Pipeline TD', 'Finished file changes in total', 'star', 'changes', [100, 1000, 5000, 20000, 100000, 500000, 1000000]),
  A('omnivore', 'mastery', 'Omnivore', 'Open every kind of viewer at least once', 250, 'star', { goal: { c: 'vwn', n: 10 } }),
  A('flawless_week', 'mastery', 'Flawless Week', '7 days in a row with work done and no failed job', 250, 'star', { goal: { c: 'streak', n: 7 } }),
  A('big_batch', 'mastery', 'Big Batch', 'Convert 500+ files in one batch, none failed', 250, 'convert', { feature: 'convert' }),
  A('completionist', 'mastery', 'Completionist', 'Earn every badge you can see', 500, 'trophy'),

  L('regular', 'loyal', 'Regular', 'Days of real work in the app', 'calendar', 'adays', [3, 10, 30, 100, 250, 500, 1000]),
  L('still_here', 'loyal', 'Still Here', 'Months with a day of real work', 'hourglass', 'amon', [2, 4, 6, 12, 24, 36, 48]),
  L('weekly_ritual', 'loyal', 'Weekly Ritual', 'Weeks with 3 or more days of real work', 'repeat', 'rit', [1, 4, 12, 26, 52, 104, 156]),

  A('works_on_my_machine', 'jokes', 'It Worked on My Machine', 'A 3D model would not load', 10, 'cube'),
  A('render_farm_down', 'jokes', 'Render Farm Is Down', 'USD or Alembic needed Blender, and it was not there', 10, 'server'),
  A('share_not_found', 'jokes', '404 Share Not Found', 'A network folder could not be reached', 10, 'network'),
  A('wrong_password', 'jokes', 'Wrong Password, Again', 'A network sign-in was refused', 10, 'lock'),
  A('not_a_file', 'jokes', "That's Not a File, That's a Feeling", 'Drop something the app cannot open', 10, 'drop'),
  A('pixel_soup', 'jokes', 'Pixel Soup', 'An image would not decode', 10, 'image'),
  A('conflict_resolution', 'jokes', 'Conflict Resolution', 'A paste hit a name that was taken', 10, 'copy'),
  A('cancel_culture', 'jokes', 'Cancel Culture', 'Cancel a running batch convert', 10, 'stop'),
  A('nothing_to_see', 'jokes', 'Nothing to See Here', 'Open an empty folder', 10, 'empty'),

  A('night_shift', 'secret', 'Night Shift', 'Real work between 2 and 4 AM', 25, 'moon', { hidden: true }),
  A('weekend_warrior', 'secret', 'Weekend Warrior', 'Real work on the Saturday and Sunday of one weekend', 50, 'calendar', { hidden: true }),
  A('long_take', 'secret', 'Long Take', 'Play a 1,000+ frame sequence to the end', 250, 'film', { hidden: true }),
  A('one_year', 'secret', 'One Year In', 'A year after your first badge', 100, 'cake', { hidden: true }),
  A('professional_clown', 'secret', 'Professional Clown', 'Get every Happy accident', 100, 'mask', { hidden: true })
];
export const BY_ID = new Map(CATALOG.map((d) => [d.id, d]));
const LADDERS = CATALOG.filter((d) => d.ladder);
const JOKES = CATALOG.filter((d) => d.cat === 'jokes').map((d) => d.id);
// Viewer kinds for Omnivore: one bit each
export const VIEWERS = ['3d', 'hdr', 'image', 'video', 'audio', 'pdf', 'md', 'txtex', 'sequence', 'compare'];

// Shared ranks and titles (same levels in every Emulsion Labs tool; the words are this app's)
const RANKS = [[1, 1], [5, 2], [10, 3], [15, 4], [20, 5], [30, 6], [40, 7]];
const TITLES = [[1, 'Intern'], [3, 'Junior Artist'], [6, 'Artist'], [8, 'Senior Artist'], [12, 'Lead'], [16, 'Supervisor'], [20, 'VFX Legend']];

/** Metal rank of a level: { m: 1-7, name }. Emulsion (Lv 40+) only once the Emulsion gate is open; until then it stays Ruby. */
export const rankOf = (level, gate) => {
  let m = 1;
  for (const [l, x] of RANKS) if (level >= l) m = x;
  if (m >= EMU && !gate) m = EMU - 1;
  return { m, name: METALS[m - 1] };
};
/** Tier a count reaches on a ladder (0 = none yet). */
export const tierFor = (def, n) => {
  let t = 0;
  def.ladder.at.forEach((a, i) => {
    if (n >= a) t = i + 1;
  });
  return t;
};
/** XP to go from `level` to the next one: slowly harder. */
export const need = (level) => Math.round(60 + 40 * Math.pow(level, 1.25));
export const titleOf = (level) => {
  let t = TITLES[0][1];
  for (const [l, n] of TITLES) if (level >= l) t = n;
  return t;
};
export const levelOf = (xp) => {
  let left = Math.max(0, Math.floor(Number(xp) || 0));
  let level = 1;
  while (left >= need(level) && level < 999) {
    left -= need(level);
    level++;
  }
  return { level, into: left, need: need(level), title: titleOf(level) };
};

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x) => (Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
const strList = (x, max) => (Array.isArray(x) ? [...new Set(x.filter((v) => typeof v === 'string' && v && v.length <= 24))].slice(-max) : []);
const dayNum = (ms) => Math.floor(ms / DAY);
/** Local calendar day as a number (20261120), so "a day" follows the user's clock. */
export const dayKey = (ms) => {
  const d = new Date(ms);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};
const prevDayKey = (key) => {
  const y = Math.floor(key / 10000), m = Math.floor(key / 100) % 100, d = key % 100;
  return dayKey(new Date(y, m - 1, d - 1, 12).getTime());
};
/** Monday-based week number of a local day (local noon, so DST never moves it). */
const weekOf = (key) => {
  const y = Math.floor(key / 10000), m = Math.floor(key / 100) % 100, d = key % 100;
  return Math.floor((dayNum(new Date(y, m - 1, d, 12).getTime()) + 3) / 7);
};

export const empty = () => ({ v: 1, u: {}, k: {}, kd: {}, ps: {}, lx: 0, c: {}, f: 0, d: { k: 0, flat: 0, clean: 0 }, days: {}, first: 0, fm: [], dr: [], g: 0 });

/** Any stored value -> a clean state. Unknown achievement ids and bad numbers are dropped. */
export const normalize = (v) => {
  const s = empty();
  if (!isObj(v)) return s;
  if (isObj(v.u)) for (const [id, at] of Object.entries(v.u)) if (BY_ID.has(id)) s.u[id] = num(at) || 1;
  if (isObj(v.c)) for (const [k, n] of Object.entries(v.c)) if (/^[a-zA-Z]{1,16}$/.test(k)) s.c[k] = num(n);
  s.f = num(v.f);
  s.lx = num(v.lx);
  if (isObj(v.d)) s.d = { k: num(v.d.k), flat: Math.min(FLAT_CAP, num(v.d.flat)), clean: num(v.d.clean) };
  if (isObj(v.days)) for (const [k, a] of Object.entries(v.days)) if (/^\d{8}$/.test(k) && Array.isArray(a)) s.days[k] = [num(a[0]), num(a[1]), num(a[2])];
  s.first = num(v.first);
  s.fm = strList(v.fm, 8);
  s.dr = strList(v.dr, 6);
  s.g = num(v.g);
  if (isObj(v.k)) for (const [id, t] of Object.entries(v.k)) {
    const d = BY_ID.get(id);
    if (d && d.ladder && s.u[id]) s.k[id] = Math.min(s.g ? TOP : EMU - 1, Math.max(1, num(t)));
  }
  for (const d of LADDERS) if (s.u[d.id]) s.k[d.id] = Math.max(1, s.k[d.id] || 0); else delete s.k[d.id];
  // Tier days (liner notes): one day number per tier reached; tier 1 falls back to the unlock day.
  if (isObj(v.kd)) for (const [id, a] of Object.entries(v.kd)) if (s.k[id] && Array.isArray(a)) s.kd[id] = a.slice(0, s.k[id]).map(num);
  for (const d of LADDERS) if (s.k[d.id]) {
    const a = s.kd[d.id] || [];
    s.kd[d.id] = Array.from({ length: s.k[d.id] }, (_, i) => num(a[i]) || (i ? 0 : s.u[d.id]));
  }
  // A record is never higher than its pieces hold
  if (isObj(v.ps)) for (const set of SETS) {
    const m = Math.min(Math.min(TOP, num(v.ps[set.id])), setTier(s, set));
    if (m) s.ps[set.id] = m;
  }
  return s;
};
/** The record a set makes now: the lowest tier among its 4 pieces (0 = none). */
const setTier = (s, set) => Math.min(...set.pieces.map((id) => (s.u[id] ? s.k[id] || 1 : 0)));
const clone = (x) => JSON.parse(JSON.stringify(x));

/** XP a badge gives so far (a tiered one: every tier reached). */
export const xpOf = (def, tier) => (def.ladder ? def.ladder.xp.slice(0, Math.max(1, tier || 1)).reduce((a, b) => a + b, 0) : def.xp);
export const totalXp = (state) => {
  const s = normalize(state);
  let xp = s.f;
  for (const id of Object.keys(s.u)) xp += xpOf(BY_ID.get(id), s.k[id]);
  for (const set of SETS) for (let i = 0; i < num(s.ps[set.id]); i++) xp += RECORD_XP[i];
  return xp + s.lx;
};
/** Tier of a badge in a state: 0 = not earned; a single badge = 1 when earned. */
export const tierOf = (state, id) => {
  const s = normalize(state);
  return s.u[id] ? s.k[id] || 1 : 0;
};
/** Every set: [{ id, title, made (0-7), pieces: [{ id, tier }], next: { m, have } or null, soon, gate }]. */
export const setsOf = (state) => {
  const s = normalize(state);
  return SETS.map((set) => {
    const pieces = set.pieces.map((id) => ({ id, tier: s.u[id] ? s.k[id] || 1 : 0 }));
    const made = num(s.ps[set.id]);
    const m = made + 1;
    return {
      id: set.id, title: set.title, made, pieces,
      next: m <= TOP ? { m, have: pieces.filter((p) => p.tier >= m).length, gate: m >= EMU && !s.g } : null,
      soon: set.pieces.some((id) => comingSoon(BY_ID.get(id)))
    };
  });
};
/** Liner notes of a badge: { days: [day number per tier reached] (single badge: [unlock day]), count } (count: tiered only). */
export const notesOf = (state, def) => {
  const s = normalize(state);
  if (!s.u[def.id]) return { days: [], count: def.ladder ? num(s.c[def.ladder.c]) : 0 };
  if (!def.ladder) return { days: [s.u[def.id]], count: 0 };
  const t = s.k[def.id] || 1;
  return { days: Array.from({ length: t }, (_, i) => num((s.kd[def.id] || [])[i])), count: num(s.c[def.ladder.c]) };
};

/** Can be earned in this build. */
export const earnable = (def) => !def.feature || SHIPPED.has(def.feature);
export const comingSoon = (def) => !!def.feature && !SHIPPED.has(def.feature);

const streakOf = (s, today) => {
  let n = 0;
  let k = today;
  for (let i = 0; i < 10; i++) {
    const a = s.days[k];
    if (!a || !a[0] || a[1]) {
      if (i === 0) { k = prevDayKey(k); continue; } // today may not have work yet
      break;
    }
    n++;
    k = prevDayKey(k);
  }
  return n;
};
const counterOf = (s, c, ctx) => (c === 'streak' ? streakOf(s, dayKey((ctx && ctx.now) || Date.now())) : num(s.c[c]));

/**
 * The Emulsion gate: { open, day, conds: [{ k, label, have, need, ok }] }. Opens only when every condition holds.
 * Time counts real work only (days and months with a finished job), never time the app stood open.
 */
export const gateOf = (state) => {
  const s = normalize(state);
  const lv = levelOf(totalXp(s)).level;
  const ruby = LADDERS.filter((d) => (s.u[d.id] ? s.k[d.id] || 1 : 0) >= EMU - 1).length;
  const reviewed = num(s.c.models) + num(s.c.hdrs);
  const conds = [
    { k: 'level', label: 'Level', have: lv, need: GATE.level },
    { k: 'days', label: 'Days of real work', have: num(s.c.adays), need: GATE.days },
    { k: 'months', label: 'Months with real work', have: num(s.c.amon), need: GATE.months },
    { k: 'ruby', label: 'Badges at Ruby', have: ruby, need: GATE.ruby },
    { k: 'changes', label: 'Files organised', have: num(s.c.changes), need: GATE.changes },
    { k: 'reviewed', label: 'Models and HDRs reviewed', have: reviewed, need: GATE.reviewed }
  ].map((c) => Object.assign(c, { ok: c.have >= c.need }));
  return { open: !!s.g, day: s.g, conds, ready: conds.every((c) => c.ok) };
};

/** { have, goal } for a progress bar, or null. A tiered badge: toward its next tier ({ ..., tier, next }; next 0 = top tier). */
export const progress = (state, def, ctx) => {
  const s = normalize(state);
  if (def.ladder) {
    const t = s.u[def.id] ? s.k[def.id] || 1 : 0;
    const n = counterOf(s, def.ladder.c, ctx);
    if (t >= TOP) { const top = def.ladder.at[TOP - 1]; return { have: top, goal: top, tier: TOP, next: 0 }; }
    const p = { have: Math.min(def.ladder.at[t], n), goal: def.ladder.at[t], tier: t, next: t + 1 };
    if (t + 1 >= EMU && !s.g) p.gate = true; // the next tier is Emulsion: the gate decides
    return p;
  }
  if (!def.goal) return null;
  return { have: Math.min(def.goal.n, counterOf(s, def.goal.c, ctx)), goal: def.goal.n };
};

/**
 * One event -> new state. Events (all from the observer, after the work really finished):
 *   { t:'open', kind, ext, fresh }        a viewer loaded a file with no error (fresh = this file was not counted lately)
 *   { t:'open_fail', kind, reason }       a viewer could not load a file
 *   { t:'watched', kind, frames, fresh }  a video or image sequence played to the end
 *   { t:'compare', fresh }                two files opened side by side
 *   { t:'transfer', mode, done, failed, cancelled }   a copy / move job ended
 *   { t:'conflict' }                      a paste hit a taken name
 *   { t:'rename' }  { t:'delete', n }  { t:'label', n }  { t:'folder_icon' }  { t:'handoff', n }
 *   { t:'convert', converted, failed, cancelled }      { t:'dupscan', cancelled }
 *   { t:'nav', drive, depth, files }      a folder was read      { t:'nav_fail', network }
 *   { t:'net_ok' }  { t:'net_fail' }  { t:'drop_bad' }  { t:'quicklook', fresh }  { t:'texset' }
 */
export const apply = (prev, ev, ctx) => {
  const now = (ctx && ctx.now) || Date.now();
  const s = clone(normalize(prev));
  const before = levelOf(totalXp(s)).level;
  const unlocked = [];
  const tiers = {};
  const quiet = new Set(); // climbs from the gate opening: no pop-up of their own
  const today = dayKey(now);
  if (!s.first) s.first = dayNum(now);
  if (s.d.k !== today) s.d = { k: today, flat: 0, clean: s.d.clean };
  const unlock = (id) => {
    const def = BY_ID.get(id);
    if (!def || s.u[id] || !earnable(def)) return;
    s.u[id] = dayNum(now);
    unlocked.push(id);
  };
  /** A tiered badge climbs to the tier its count reaches (it can skip tiers; one pop-up names the top one). */
  const climb = (id, n, silent) => {
    const def = BY_ID.get(id);
    if (!def || !earnable(def)) return;
    const t = Math.min(tierFor(def, n), s.g ? TOP : EMU - 1); // Emulsion waits for the gate (the count keeps going)
    const from = s.u[id] ? s.k[id] || 1 : 0;
    if (t <= from) return;
    if (!s.u[id]) s.u[id] = dayNum(now);
    s.k[id] = t;
    const kd = s.kd[id] || [];
    for (let i = from; i < t; i++) if (!kd[i]) kd[i] = dayNum(now);
    s.kd[id] = kd;
    if (!unlocked.includes(id)) unlocked.push(id);
    tiers[id] = { from: tiers[id] ? tiers[id].from : from, to: t };
    if (silent) quiet.add(id);
  };
  const addFlat = (n) => { const ok = Math.max(0, Math.min(n, FLAT_CAP - s.d.flat)); s.d.flat += ok; s.f += ok; };
  const cleanCheck = () => { if (s.d.clean !== today) { s.d.clean = today; addFlat(5); } };
  const bump = (c, n) => { s.c[c] = num(s.c[c]) + num(n); return s.c[c]; };
  const day = () => (s.days[today] = s.days[today] || [0, 0, 0]);
  /** A day of real work: Regular counts the day, Still Here the month, Weekly Ritual a week once it has 3 such days. */
  const used = (changes) => {
    const d = day();
    d[0]++;
    d[2] += num(changes);
    if (num(s.c.lastUse) !== today) {
      s.c.lastUse = today;
      bump('adays', 1);
      const mon = Math.floor(today / 100);
      if (num(s.c.lastMon) !== mon) { s.c.lastMon = mon; bump('amon', 1); }
      const wk = weekOf(today);
      if (num(s.c.wk) !== wk) { s.c.wk = wk; s.c.wkd = 0; }
      if (bump('wkd', 1) === 3) bump('rit', 1);
      const wd = new Date(now).getDay();
      if (wd === 6) s.c.sat = wk;
      if (wd === 0 && num(s.c.sat) === wk) unlock('weekend_warrior'); // Sunday of the week whose Saturday had work
    }
    const hour = new Date(now).getHours();
    if (hour === 2 || hour === 3) unlock('night_shift');
    climb('regular', num(s.c.adays));
    climb('still_here', num(s.c.amon));
    climb('weekly_ritual', num(s.c.rit));
    if (streakOf(s, today) >= 7) unlock('flawless_week');
  };
  const changed = (n) => climb('pipeline_td', bump('changes', n));
  const seeViewer = (kind) => {
    const i = VIEWERS.indexOf(kind);
    if (i < 0) return;
    s.c.vw = num(s.c.vw) | (1 << i);
    let n = 0;
    for (let b = 0; b < VIEWERS.length; b++) if (s.c.vw & (1 << b)) n++;
    s.c.vwn = n;
    if (n >= VIEWERS.length) unlock('omnivore');
  };
  const t = ev && ev.t;

  if (t === 'open') {
    seeViewer(ev.kind);
    if (ev.kind === 'txtex') unlock('mip_master');
    if (ev.kind === 'pdf') s.c.rd = num(s.c.rd) | 1;
    if (ev.kind === 'md') s.c.rd = num(s.c.rd) | 2;
    if (s.c.rd === 3) unlock('reading_room');
    if (ev.fresh) {
      if (ev.kind === '3d') {
        climb('model_citizen', bump('models', 1));
        const ext = String(ev.ext || '').toLowerCase().replace(/^\./, '').slice(0, 8);
        if (ext && !s.fm.includes(ext)) s.fm = s.fm.concat(ext).slice(-8);
        s.c.fmn = s.fm.length;
        if (s.fm.length >= 4) unlock('format_hopper');
      }
      if (ev.kind === 'hdr') climb('light_meter', bump('hdrs', 1));
      if (ev.kind === '3d' || ev.kind === 'hdr' || ev.kind === 'image' || ev.kind === 'txtex') { addFlat(1); used(0); }
    }
  } else if (t === 'open_fail') {
    if (ev.kind === '3d') {
      unlock('works_on_my_machine');
      if (/blender/i.test(String(ev.reason || ''))) unlock('render_farm_down');
    } else if (ev.kind === 'image' || ev.kind === 'hdr' || ev.kind === 'txtex') unlock('pixel_soup');
  } else if (t === 'watched') {
    seeViewer(ev.kind);
    if (ev.fresh && (ev.kind === 'video' || ev.kind === 'sequence')) {
      climb('dailies', bump('watched', 1));
      used(0);
      if (ev.kind === 'sequence' && num(ev.frames) >= 1000) unlock('long_take');
    }
  } else if (t === 'compare') {
    seeViewer('compare');
    if (ev.fresh) { climb('lookdev_lead', bump('pairs', 1)); addFlat(1); used(0); }
  } else if (t === 'transfer') {
    const done = num(ev.done);
    if (num(ev.failed)) day()[1]++;
    if (done) {
      addFlat(2);
      climb('mover_and_shaker', bump('moved', done));
      changed(done);
      used(done);
    }
  } else if (t === 'conflict') {
    unlock('conflict_resolution');
  } else if (t === 'rename') {
    addFlat(1);
    climb('tidy_desk', bump('renamed', 1));
    changed(1);
    used(1);
  } else if (t === 'delete') {
    const n = Math.max(1, num(ev.n));
    climb('clean_sweep', bump('deleted', n));
    changed(n);
    used(n);
  } else if (t === 'label') {
    const n = Math.max(1, num(ev.n));
    unlock('color_coded');
    addFlat(1);
    climb('taxonomist', bump('tagged', n));
    changed(n);
    used(n);
  } else if (t === 'folder_icon') {
    climb('interior_designer', bump('icons', 1));
    changed(1);
    used(1);
  } else if (t === 'handoff') {
    climb('hand_off', bump('handoff', 1));
    used(0);
  } else if (t === 'convert') {
    const conv = num(ev.converted), failed = num(ev.failed);
    if (ev.cancelled) unlock('cancel_culture');
    if (failed) day()[1]++;
    if (conv) {
      addFlat(2);
      climb('factory_line', bump('conv', conv));
      changed(conv);
      used(conv);
      if (!failed && !ev.cancelled) {
        unlock('conversion_therapy');
        cleanCheck();
        if (conv >= 500) unlock('big_batch');
      }
    }
  } else if (t === 'dupscan') {
    if (!ev.cancelled) {
      addFlat(2);
      cleanCheck();
      climb('twin_finder', bump('scans', 1));
      used(0);
    }
  } else if (t === 'nav') {
    if (num(ev.files) > 0) unlock('first_light');
    if (ev.empty) unlock('nothing_to_see');
    const dr = String(ev.drive || '').toUpperCase().slice(0, 24);
    if (dr && !s.dr.includes(dr)) s.dr = s.dr.concat(dr).slice(-6);
    if (s.dr.length >= 3) unlock('globetrotter');
    if (num(ev.depth) >= 10) unlock('deep_diver');
  } else if (t === 'nav_fail') {
    if (ev.network) unlock('share_not_found');
  } else if (t === 'net_ok') {
    unlock('plugged_in');
  } else if (t === 'net_fail') {
    unlock('wrong_password');
  } else if (t === 'drop_bad') {
    unlock('not_a_file');
  } else if (t === 'quicklook') {
    if (ev.fresh && bump('ql', 1) >= 10) unlock('quick_draw');
  } else if (t === 'texset') {
    unlock('full_set');
  }

  // Badges about badges
  const have = (id) => !!s.u[id];
  const firstBadge = Math.min(...Object.values(s.u), Infinity);
  if (Number.isFinite(firstBadge) && dayNum(now) - firstBadge >= 365) unlock('one_year');
  if (JOKES.every(have)) unlock('professional_clown');
  if (CATALOG.every((d) => d.id === 'completionist' || d.hidden || !earnable(d) || have(d.id))) unlock('completionist');

  // The Emulsion gate: checked after each real event, never by a timer. When it opens, every ladder already past its
  // Emulsion count climbs quietly; the gate moment itself is the one pop-up.
  let gate = false;
  if (!s.g && gateOf(s).ready) {
    s.g = dayNum(now);
    gate = true;
    for (const d of LADDERS) climb(d.id, num(s.c[d.ladder.c]), true);
  }

  const dayKeys = Object.keys(s.days).sort();
  while (dayKeys.length > 10) delete s.days[dayKeys.shift()];
  // Sets: all 4 pieces at a new tier make that set's showreel
  const sets = [];
  for (const set of SETS) {
    const pt = setTier(s, set);
    const was = num(s.ps[set.id]);
    if (pt > was) { sets.push({ id: set.id, from: was, to: pt }); s.ps[set.id] = pt; }
  }
  const after = levelOf(totalXp(s)).level;
  return { state: s, unlocked, tiers, quiet: [...quiet], sets, gate, level: { from: before, to: after } };
};

/** Two saved states -> one. Unlocks are joined (earliest day kept), counters, tiers and XP take the larger value. */
export const merge = (a, b) => {
  const x = normalize(a);
  const y = normalize(b);
  const s = empty();
  s.g = x.g && y.g ? Math.min(x.g, y.g) : x.g || y.g;
  for (const src of [x, y]) for (const [id, at] of Object.entries(src.u)) s.u[id] = s.u[id] ? Math.min(s.u[id], at) : at;
  for (const src of [x, y]) for (const [k, n] of Object.entries(src.c)) s.c[k] = k === 'vw' || k === 'rd' ? num(s.c[k]) | n : Math.max(num(s.c[k]), n);
  for (const src of [x, y]) for (const [id, t] of Object.entries(src.k)) s.k[id] = Math.max(s.k[id] || 0, t);
  for (const [id, t] of Object.entries(s.k)) {
    const p = x.kd[id] || [], q = y.kd[id] || [];
    s.kd[id] = Array.from({ length: t }, (_, i) => (p[i] && q[i] ? Math.min(p[i], q[i]) : p[i] || q[i] || 0));
  }
  for (const set of SETS) {
    const m = Math.min(Math.max(num(x.ps[set.id]), num(y.ps[set.id])), setTier(s, set));
    if (m) s.ps[set.id] = m;
  }
  s.lx = Math.max(x.lx, y.lx);
  s.f = Math.max(x.f, y.f);
  s.d = x.d.k > y.d.k ? x.d : y.d.k > x.d.k ? y.d : { k: x.d.k, flat: Math.max(x.d.flat, y.d.flat), clean: Math.max(x.d.clean, y.d.clean) };
  for (const src of [x, y]) for (const [k, a2] of Object.entries(src.days)) {
    const c = s.days[k] || [0, 0, 0];
    s.days[k] = [Math.max(c[0], a2[0]), Math.max(c[1], a2[1]), Math.max(c[2], a2[2])];
  }
  const keys = Object.keys(s.days).sort();
  while (keys.length > 10) delete s.days[keys.shift()];
  s.first = x.first && y.first ? Math.min(x.first, y.first) : x.first || y.first;
  s.fm = [...new Set(x.fm.concat(y.fm))].slice(-8);
  s.dr = [...new Set(x.dr.concat(y.dr))].slice(-6);
  if (s.fm.length) s.c.fmn = Math.max(num(s.c.fmn), s.fm.length);
  return normalize(s);
};

// Same content whatever the key order (two copies can add the same badges in a different order)
const canon = (x) => (Array.isArray(x) ? x.map(canon) : isObj(x) ? Object.keys(x).sort().reduce((o, k) => { o[k] = canon(x[k]); return o; }, {}) : x);
export const same = (a, b) => JSON.stringify(canon(normalize(a))) === JSON.stringify(canon(normalize(b)));
export const serialize = (s) => JSON.stringify(canon(normalize(s)));
