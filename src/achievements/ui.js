/**
 * Achievements on screen (docs/ACHIEVEMENTS.md): the Achievements screen (level, showreel wall, Emulsion gate, category cards),
 * the one pop-up per batch ("the moment"), the level-up burst, the full view of an earned badge (a medal you can tilt and turn
 * over to its certificate) and the Settings card. Ported from the Emulsion Labs reference (Playlist Pro manager/achievements.js);
 * the theme is this app's own: lens iris medals and framed showreels.
 *
 * Watching only: observer.js decides unlocks. This file only reads the state and shows it. Pop-ups wait until no job runs,
 * no window or viewer is open and the app is in front, so they never cover work.
 * Plain DOM on purpose (the same code as the reference, so the live shaders mount the same way); React hosts it in
 * components/AchievementsScreen.jsx and components/AchievementSettings.jsx.
 */
import * as Core from './core.js';
import * as Obs from './observer.js';
import Bubble from './bubble.js';
import Gem from './gem.js';
import { levelInfo } from './level.js';
import './achievements.css';

const APP = 'CG Artist File Browser';
const STUDIO = 'Emulsion Labs';
const CFG_KEY = 'cgabAchCfgV1';
const doc = typeof document !== 'undefined' ? document : null;
const root = typeof window !== 'undefined' ? window : globalThis;
const reduced = () => {
  try {
    return root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n || 0).toLocaleString();
// Every string in one table (the app ships English only today; a translator plugs in here)
const tr = (t) => t;

const T = {
  title: 'Achievements',
  sub: 'Badges for real work. Only files that loaded and jobs that finished count.',
  unlocked: 'Unlocked',
  upgraded: 'Badge upgraded',
  metal: { Bronze: 'Bronze', Silver: 'Silver', Gold: 'Gold', Platinum: 'Platinum', Diamond: 'Diamond', Ruby: 'Ruby', Emulsion: 'Emulsion' },
  setDone: 'Set complete',
  records: 'Certified showreels',
  certified: 'Certified',
  notYet: 'Not yet',
  recordHelp: 'Each set has 4 badges. All four at a tier make that showreel.',
  pieces: (a) => `${a}/4`,
  allRecords: 'Every showreel made',
  earned: 'Earned',
  yourCount: 'Your count',
  notesHint: 'Click to see it big',
  close: 'Close',
  prevBadge: 'Previous badge',
  nextBadge: 'Next badge',
  gateTitle: 'Emulsion',
  gateHelp: 'The rarest tier. It opens only after a long stretch of real work. Idle time never counts.',
  gateOpen: (d) => `Open since ${d}`,
  gateEye: 'Emulsion unlocked',
  gateMomentTitle: 'The Emulsion gate is open',
  gateMomentSub: (days, lv, ch, rv) => `${fmt(days)} days of real work, level ${lv}, ${fmt(ch)} files organised and ${fmt(rv)} models and HDRs reviewed. Your badges can now climb to Emulsion.`,
  go: "Let's go",
  goHint: 'Click anywhere or press Esc to continue',
  momentHint: 'Closes by itself. Click to close now',
  moreBadges: (n) => (n === 1 ? '+1 more badge' : `+${n} more badges`),
  levelReached: (n) => `Level ${n} reached`,
  nextTier: (m, n) => `Next: ${m} at ${fmt(n)}`,
  gateNext: 'Next: Emulsion (opens with the Emulsion gate)',
  topTier: 'Top tier reached',
  newRank: (rank) => `New rank: ${rank}`,
  levelUp: 'Level up',
  skip: 'Click anywhere to skip',
  nowLevel: (n) => `You are now level ${n}`,
  xpTotal: (xp) => `${fmt(xp)} XP`,
  toNext: (n, lv) => `${fmt(n)} XP to level ${lv}`,
  levelName: (lv, title) => `Level ${lv} · ${title}`,
  next: 'Next:',
  allDone: 'All done here',
  hidden: 'Hidden achievement',
  hiddenDesc: 'Keep going. It shows when you earn it.',
  soon: 'Coming soon',
  showAll: 'Show all',
  showLess: 'Show less',
  certificate: 'Certificate of achievement',
  tierWord: 'Tier',
  medalNo: 'Medal no.',
  backNote: `Earned by using ${APP}, never bought. Only files that loaded and jobs that finished are counted.`,
  byLine: `${APP} by ${STUDIO}`,
  turnOver: 'Click the medal to turn it over',
  of: (a, b) => `${a}/${b}`,
  setToasts: 'Show a pop-up when you earn a badge',
  setLevel: 'Show the level-up moment',
  setRefl: 'Emulsion bubble: reflection',
  setSee: 'Emulsion bubble: see-through',
  setSoft: 'Emulsion bubble: softness',
  reset: 'Reset look'
};

/* ---------------------------------------------------------------------------------------------- icons (24 box, 2px stroke) */
const P = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  drive: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5 13l2.5-7h9L19 13M7 16.5h.01"/>',
  dive: '<path d="M12 3v14M7 12l5 5 5-5M5 21h14"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  tag: '<path d="M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  network: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-2h12v2"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  compare: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M8 9l-2 3 2 3M16 9l2 3-2 3"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
  move: '<path d="M4 12h14M14 7l5 5-5 5"/>',
  rename: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  broom: '<path d="M14 4l6 6M12.5 8.5l3 3M4 20c1-4 3-7 8.5-11.5l3 3C11 17 8 19 4 20z"/>',
  convert: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  send: '<path d="M4 12 20 4l-4 16-4-7z"/><path d="M12 13l8-9"/>',
  twins: '<rect x="3" y="7" width="10" height="13" rx="2"/><rect x="11" y="3" width="10" height="13" rx="2"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.8z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4M9 14h.01M12 14h.01M15 14h.01M9 17h.01M12 17h.01"/>',
  hourglass: '<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"/>',
  repeat: '<path d="M17 2.5l3 3-3 3M4 11.5v-1a5 5 0 0 1 5-5h11M7 21.5l-3-3 3-3M20 12.5v1a5 5 0 0 1-5 5H4"/>',
  server: '<rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/><path d="M8 7h.01M8 17h.01M14 7h3M14 17h3"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
  stop: '<circle cx="12" cy="12" r="8.5"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  empty: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 13h6"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  cake: '<path d="M4 20h16M5 20v-7h14v7M5 16c2 1 3-1 4.7 0s3 1 4.6 0 3-1 4.7 0M12 13V9M12 6.5h.01"/>',
  mask: '<path d="M4 6c5 2 11 2 16 0v6a8 8 0 0 1-16 0z"/><path d="M8.5 11h.01M15.5 11h.01M9 15c1.7 1.3 4.3 1.3 6 0"/>',
  reel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="7" r="2"/><circle cx="12" cy="17" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="17" cy="12" r="2"/>',
  q: '<path d="M9.2 9a3 3 0 1 1 4.3 2.7c-.9.5-1.5 1.2-1.5 2.3M12 17.5h.01"/>'
};
const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.star}</svg>`;
Gem.icons((n) => P[n] || '');

/* ---------------------------------------------------------------------------------------------- settings */
// refl: bubble reflection 0-200 % of the tuned look; see: bubble see-through 0-100 %; soft: reflection blur in px
const BUBBLE = { refl: 100, see: 10, soft: 0.5 };
const numIn = (v, lo, hi, d) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, +v)) : d);
let cfg = readCfg();
function readCfg() {
  let v = {};
  try {
    v = JSON.parse(localStorage.getItem(CFG_KEY)) || {};
  } catch {
    v = {};
  }
  return { toasts: v.toasts !== false, levelUp: v.levelUp !== false, refl: numIn(v.refl, 0, 200, BUBBLE.refl), see: numIn(v.see, 0, 100, BUBBLE.see), soft: numIn(v.soft, 0, 12, BUBBLE.soft) };
}
const saveCfg = () => {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  } catch {
    /* not remembered this time */
  }
};
/** Settings sliders -> the bubble shader (front/back/distance/tint stay at the tuned look). */
const applyBubble = () => Bubble.setReflect({ amount: (4 * cfg.refl) / 100, see: cfg.see / 100, blur: cfg.soft });
applyBubble();

/* ---------------------------------------------------------------------------------------------- badges */
const state = () => Obs.getState();
const gateOpen = () => !!state().g;
const tierCls = (def, got) => {
  if (!got) return def.hidden ? 'ach-badge is-hidden' : 'ach-badge is-locked' + (def.tier ? ` is-${def.tier}` : '');
  return 'ach-badge' + (def.tier ? ` is-${def.tier}` : '');
};
const sizeCls = { xs: ' ach-xs', sm: ' ach-sm', md: ' ach-md' };
const metalOf = (m) => T.metal[Core.METALS[m - 1]] || Core.METALS[m - 1];
// Shine: a light sweeps across every earned badge; each badge starts at its own time
const dl = (id) => {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return (h % 36) / 10;
};
const shine = (id) => `<span class="ach-sh" style="--dl:${dl(id)}s"></span>`;
const PX = { xs: 20, sm: 40, md: 40, lg: 120 };
let gid = 0;
/** No-WebGL fallback for Diamond / Ruby: a cut stone drawn in SVG (round brilliant from the top). */
const gemSvg = (kind, icon) => {
  const id = 'achg' + gid++;
  const C = kind === 'ruby' ? { a: '#ff5a6e', b: '#b0102a', c: '#5a0610', d: '#ff9aa8', e: '#ff2a45', ink: '#5a0610' } : { a: '#eaf6ff', b: '#9fc7ef', c: '#4d6f96', d: '#ffffff', e: '#cbe7ff', ink: '#3b5b80' };
  const pts = (n, rad, off) => Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2 + (off || 0);
    return [(50 + rad * Math.cos(t)).toFixed(1), (50 + rad * Math.sin(t)).toFixed(1)];
  });
  const outer = pts(16, 48, Math.PI / 16), table = pts(8, 22, Math.PI / 8), mid = pts(8, 36, 0);
  let f = '';
  for (let i = 0; i < 8; i++) f += `<polygon class="ach-f" style="animation-delay:${(i * 0.4).toFixed(1)}s" points="${table[i]} ${mid[(i + 1) % 8]} ${table[(i + 1) % 8]}" fill="${i % 2 ? C.b : C.a}"/>`;
  for (let i = 0; i < 8; i++) {
    f += `<polygon class="ach-f" style="animation-delay:${(i * 0.4 + 1.6).toFixed(1)}s" points="${outer[(2 * i + 15) % 16]} ${outer[(2 * i) % 16]} ${outer[(2 * i + 1) % 16]} ${mid[i]}" fill="${i % 2 ? C.c : C.b}"/>`;
    f += `<polygon class="ach-f" style="animation-delay:${(i * 0.4 + 0.8).toFixed(1)}s" points="${table[(i + 7) % 8]} ${mid[i]} ${table[i]}" fill="${i % 2 ? C.a : C.e}" opacity=".85"/>`;
  }
  for (let i = 0; i < 16; i++) f += `<polygon class="ach-f" style="animation-delay:${(i * 0.2).toFixed(1)}s" points="${outer[i]} ${outer[(i + 1) % 16]} ${mid[Math.round(i / 2) % 8]}" fill="${i % 3 ? C.c : C.b}" opacity=".9"/>`;
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="${id}t" cx=".38" cy=".3"><stop offset="0" stop-color="${C.d}"/><stop offset="1" stop-color="${C.e}"/></radialGradient></defs>
    <polygon points="${outer.map((p) => p.join(',')).join(' ')}" fill="${C.c}"/>${f}<polygon points="${table.map((p) => p.join(',')).join(' ')}" fill="url(#${id}t)" opacity=".92"/>
    <g transform="translate(38 38)" color="${C.ink}" opacity=".85"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${P[icon] || P.star}</svg></g></svg>`;
};
const GL_KIND = ['', 'bronze', 'silver', 'gold', 'platinum', 'dia', 'ruby'];
/** An earned tier in its real material: a lens iris medal (1-4 metal, 5 Diamond, 6 Ruby), the live soap bubble (7 Emulsion).
 *  `info` = what is engraved round the rim of a big medal ({ title, sub, dpr }); small badges leave it out. */
const material = (tier, icon, size, key, px, info) => {
  const sz = sizeCls[size] || (size === 'lg' ? ' ach-lg' : size === 'xl' ? ' ach-xl' : '');
  const xl = px ? `--ach-xl:${px}px;` : '';
  if (tier >= 7) return `<span class="ach-badge is-real ach-emu is-m7${sz}" style="${xl}"><canvas class="ach-bubble" data-size="${px || PX[size] || 40}" aria-hidden="true"></canvas>${svg(icon)}</span>`;
  const txt = info ? ['title', 'sub'].map((k) => (info[k] ? ` data-${k}="${esc(info[k])}"` : '')).join('') + (info.dpr ? ` data-dpr="${info.dpr}"` : '') : '';
  const gl = size === 'xs' ? '' : `<canvas class="ach-gemgl" data-shape="iris" data-kind="${GL_KIND[tier]}" data-icon="${P[icon] ? icon : 'star'}" data-size="${px || PX[size] || 40}"${txt} aria-hidden="true"></canvas>`;
  if (tier >= 5) return `<span class="ach-badge is-real ach-gem is-iris is-m${tier}${sz}" style="${xl}">${gemSvg(tier === 6 ? 'ruby' : 'dia', icon)}${gl}</span>`;
  return `<span class="ach-badge is-real ach-medal is-iris is-m${tier}${sz}" style="${xl}--dl2:-${dl(key) * 3}s"><span class="ach-face">${svg(icon)}</span>${size !== 'xs' ? shine(key) : ''}${gl}</span>`;
};
/** Start the live materials (bubble, metals, stones) under `scope`. */
const live = (scope) => {
  Bubble.mount(scope);
  Gem.mount(scope);
};
const badge = (def, got, size, tierArg) => {
  const tier = def.ladder && got ? tierArg || Core.tierOf(state(), def.id) || 1 : 0;
  const b = tier
    ? material(tier, def.icon, size, def.id)
    : `<span class="${tierCls(def, got)}${sizeCls[size] || ''}">${svg(!got && def.hidden ? 'q' : def.icon)}${got && size !== 'xs' ? shine(def.id) : ''}</span>`;
  if (!def.ladder || size === 'xs') return b;
  return `<span class="ach-tiered${tier ? ` is-m${tier}` : ''}">${b}<span class="ach-pips">${Core.METALS.map((_, i) => `<i class="${i < tier ? 'on' : ''}"></i>`).join('')}</span></span>`;
};
const recordSize = { sm: ' ach-frame-sm', lg: ' ach-frame-lg' };
const setName = (id) => (Core.SETS.find((s) => s.id === id) || {}).title || id;
const MARK = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P.layers}</svg>`;
/** A set's certified showreel: a framed film reel in the metal of the set's record (m 1-7) with a plate. m 0 = not made yet (dim). */
const record = (setId, m, size) => {
  const reel = `<span class="ach-disc is-reel${m >= 7 ? ' is-vinyl' : m ? ` is-m${m}` : ''}"><span class="ach-holes"></span><span class="ach-lab">${MARK}</span></span>`;
  const plate = m
    ? `<span class="ach-plate"><b><span>${esc(T.certified)}</span> <span>${esc(metalOf(m))}</span></b><span><span>${esc(setName(setId))}</span> · ${esc(APP)}</span></span>`
    : `<span class="ach-plate"><b>${esc(setName(setId))}</b><span>${esc(T.notYet)}</span></span>`;
  return `<span class="ach-frame${m ? ` is-made is-m${m}` : ''}${recordSize[size] || ''}"><span class="ach-mat">${reel}</span>${plate}${m ? '<span class="ach-fsh"></span>' : ''}</span>`;
};
const dateOf = (day) => (day ? new Date(day * 86400000 + 43200000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const dayOf = (def, tier) => {
  const n = Core.notesOf(state(), def);
  return (def.ladder ? n.days[Math.max(1, tier) - 1] : n.days[0]) || Math.floor(Date.now() / 86400000); // just earned: today
};
/** What is engraved round a big medal's rim: the badge and its tier and date. */
const medalInfo = (def, tier, dpr) => ({ title: tr(def.title), sub: `${tr(metalOf(tier))} ${dateOf(dayOf(def, tier))}`, dpr });
const serial = (t) => {
  let h = 7;
  for (const ch of String(t)) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return String(h).padStart(4, '0');
};
/** The back of a medal: a certificate (the badge, what it was for, tier, date earned, medal number). */
const certificate = (def, tier) => `<div class="ach-cert"><div class="ach-cert-mark">${MARK}<span>${esc(APP)}</span></div>
    <div class="ach-cert-k">${esc(T.certificate)}</div><div class="ach-cert-t">${esc(def.title)}</div><div class="ach-cert-l">${esc(def.desc)}${def.ladder ? ` · ${fmt(def.ladder.at[tier - 1])}` : ''}</div>
    <div class="ach-cert-meta"><span><span>${esc(T.tierWord)}</span><b>${esc(metalOf(tier))}</b></span><span><span>${esc(T.earned)}</span><b>${esc(dateOf(dayOf(def, tier)))}</b></span><span><span>${esc(T.medalNo)}</span><b>${'CGB-' + serial(def.id + ':' + tier)}</b></span></div>
    <div class="ach-cert-note">${esc(T.backNote)}</div><div class="ach-cert-foot">${esc(T.byLine)}</div></div>`;
/** Liner notes: the day of each tier, your count, what is next. */
const notes = (d) => {
  const n = Core.notesOf(state(), d);
  if (!d.ladder) return `<div class="ach-notes"><div class="ach-k"><span>${esc(T.earned)}</span><span>${esc(dateOf(n.days[0]))}</span></div></div>`;
  const t = n.days.length;
  const rows = n.days.map((day, i) => `<div class="ach-k"><span class="ach-metal is-m${i + 1}">${esc(metalOf(i + 1))}</span><span>${esc(dateOf(day))}</span></div>`).join('');
  const nx = t < Core.METALS.length
    ? `<div class="ach-k"><span><span>${esc(T.next)}</span> <span class="ach-metal is-m${t + 1}">${esc(metalOf(t + 1))}</span>${t + 1 >= Core.EMU && !gateOpen() ? ' <span class="ach-soon">(Emulsion gate)</span>' : ''}</span><span>${fmt(d.ladder.at[t])}</span></div>`
    : `<div class="ach-k"><span>${esc(T.topTier)}</span><span></span></div>`;
  return `<div class="ach-notes">${rows}<div class="ach-k"><span>${esc(T.yourCount)}</span><span>${fmt(n.count)}</span></div>${nx}</div>`;
};
const metalTag = (def, got) => {
  const t = def.ladder && got ? Core.tierOf(state(), def.id) || 1 : 0;
  return t ? ` <span class="ach-metal is-m${t}">${esc(metalOf(t))}</span>` : '';
};
const openTiered = (d) => d.ladder && Core.tierOf(state(), d.id) > 0 && Core.tierOf(state(), d.id) < Core.METALS.length;
const shownTitle = (def, got) => (!got && def.hidden ? T.hidden : def.title);
const shownDesc = (def, got) => (!got && def.hidden ? T.hiddenDesc : def.desc);

/* ---------------------------------------------------------------------------------------------- the Achievements screen */
const openCats = new Set();
/** Draws the screen into `pane` (and keeps it current while it is in the page). Returns a function that stops it. */
export function renderScreen(pane) {
  if (!pane) return () => {};
  const draw = () => {
    if (!pane.isConnected) return;
    const st = state();
    const info = levelInfo(st);
    const pct = Math.round((info.into / info.need) * 100);
    const got = (id) => !!st.u[id];
    const all = Core.CATALOG;
    const totalHave = all.filter((d) => got(d.id)).length;
    const cards = Core.CATS.map((cat) => {
      const list = all.filter((d) => d.cat === cat.id);
      if (!list.length) return '';
      const have = list.filter((d) => got(d.id)).length;
      // Next to get: closest progress bar first, then the first earnable one
      const open = list.filter((d) => (!got(d.id) || openTiered(d)) && Core.earnable(d) && !d.hidden);
      const withP = open.map((d) => ({ d, p: Core.progress(st, d) })).filter((x) => !(x.p && x.p.gate)).sort((a, b) => (b.p ? b.p.have / b.p.goal : 0) - (a.p ? a.p.have / a.p.goal : 0));
      const nx = withP[0];
      const nextLine = nx
        ? `<div class="ach-next"><span class="ach-next-t"><span>${esc(T.next)}</span> <span>${esc(nx.d.title)}</span>${nx.p && nx.p.next ? ` <span class="ach-metal is-m${nx.p.next}">${esc(metalOf(nx.p.next))}</span>` : ''}${nx.p ? ` <b>${fmt(nx.p.have)} / ${fmt(nx.p.goal)}</b>` : ''}</span><div class="ach-bar${nx.p && nx.p.next ? ` is-metal is-m${nx.p.next}` : ''}"><i style="width:${nx.p ? Math.round((nx.p.have / nx.p.goal) * 100) : 0}%"></i></div></div>`
        : `<div class="ach-next"><span class="ach-next-t">${esc(have === list.length ? T.allDone : '')}</span></div>`;
      const isOpen = openCats.has(cat.id);
      const rows = isOpen
        ? `<div class="ach-rows">${list.map((d) => {
          const g = got(d.id);
          const p = (!g || openTiered(d)) && !d.hidden ? Core.progress(st, d) : null;
          const soon = !g && Core.comingSoon(d);
          const tier = d.ladder && g ? Core.tierOf(st, d.id) : 0;
          const step = d.ladder && p && !soon ? ` · ${p.gate ? T.gateNext : p.next ? T.nextTier(metalOf(p.next), p.goal) : T.topTier}` : d.ladder && tier >= Core.METALS.length ? ` · ${T.topTier}` : '';
          const xpTxt = !g && d.hidden ? '?' : `${fmt(d.ladder && g ? Core.xpOf(d, tier) : d.xp)} XP`;
          return `<div class="ach-row${g ? ' is-got' : ''}" data-ach="${d.id}"${g ? ` role="button" tabindex="0" aria-haspopup="dialog" title="${esc(T.notesHint)}"` : ''}>${badge(d, g, 'sm')}
            <div class="ach-row-text"><span class="ach-row-title">${esc(shownTitle(d, g))}${metalTag(d, g)}</span>
            <span class="ach-row-desc"><span>${esc(shownDesc(d, g))}</span>${step ? `<span>${esc(step)}</span>` : ''}${soon ? ` <span class="ach-soon">${esc(T.soon)}</span>` : ''}</span>
            ${p && !p.gate && !(d.ladder && !p.next) ? `<div class="ach-bar${p.next ? ` is-metal is-m${p.next}` : ''}"><i style="width:${Math.round((p.have / p.goal) * 100)}%"></i></div>` : ''}</div>
            <span class="ach-xp${d.tier === 'rare' ? ' is-rare' : ''}${tier ? ` is-metal is-m${tier}` : ''}">${esc(xpTxt)}</span></div>`;
        }).join('')}</div>`
        : '';
      return `<div class="ach-card${isOpen ? ' is-open' : ''}" data-cat="${cat.id}">
        <div class="ach-card-head"><strong>${esc(cat.title)}</strong><span class="ach-count">${T.of(have, list.length)}</span></div>
        <div class="ach-mini">${list.map((d) => `<span title="${esc(shownTitle(d, got(d.id)))}">${badge(d, got(d.id), 'xs')}</span>`).join('')}</div>
        ${nextLine}${rows}
        <button type="button" class="ach-btn ach-more" data-cat="${cat.id}" aria-expanded="${isOpen}">${esc(isOpen ? T.showLess : T.showAll)}</button>
      </div>`;
    }).join('');
    pane.innerHTML = `<div class="ach-wrap">
      <div class="ach-head card is-m${info.rank.m}">
        <div class="ach-lv" title="${esc(T.levelName(info.level, info.title))}"><span>${info.level}</span></div>
        <div class="ach-head-text">
          <div class="ach-head-row"><strong><span class="ach-metal">${esc(info.metal)}</span><span> · </span><span>${esc(info.title)}</span></strong><span>${esc(T.xpTotal(info.xp))} · ${esc(T.toNext(info.need - info.into, info.level + 1))}</span></div>
          <div class="ach-bar ach-bar-lg"><i style="width:${pct}%"></i></div>
        </div>
        <span class="ach-count ach-count-all">${T.of(totalHave, all.length)}</span>
      </div>
      <div class="ach-top">${recordWall()}${gateCard()}</div>
      <div class="ach-grid">${cards}</div>
    </div>`;
    live(pane);
  };
  if (!pane.__achBound) {
    pane.__achBound = true;
    pane.addEventListener('click', (e) => {
      const b = e.target.closest('.ach-more');
      if (b) {
        const id = b.dataset.cat;
        if (openCats.has(id)) openCats.delete(id);
        else openCats.add(id);
        draw();
        return;
      }
      const row = e.target.closest('.ach-row.is-got');
      if (row) openView(row.dataset.ach);
    });
    pane.addEventListener('keydown', (e) => {
      const row = e.target.closest && e.target.closest('.ach-row.is-got');
      if (row && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        openView(row.dataset.ach);
      }
    });
  }
  draw();
  const off = Obs.subscribe(() => {
    if (!doc.querySelector('.ach-view')) draw();
  });
  return off;
}
/** The wall of certified showreels: one frame per set, its 4 pieces under it, and the next one to make. */
const recordWall = () => {
  const sets = Core.setsOf(state());
  const made = sets.reduce((a, x) => a + x.made, 0);
  const slot = (x) => {
    const nx = x.next;
    const next = x.soon && !x.made
      ? `<span class="ach-soon">${esc(T.soon)}</span>`
      : nx
        ? `<span class="ach-next-t"><span>${esc(T.next)}</span> <span class="ach-metal is-m${nx.m}">${esc(metalOf(nx.m))}</span> <b>${esc(T.pieces(nx.have))}</b>${nx.gate ? ' <span class="ach-soon">(Emulsion gate)</span>' : ''}</span>`
        : `<span class="ach-next-t">${esc(T.topTier)}</span>`;
    const pieces = x.pieces.map((p) => {
      const d = Core.BY_ID.get(p.id);
      return `<span title="${esc(d.title)}">${badge(d, p.tier > 0, 'xs', p.tier)}</span>`;
    }).join('');
    return `<div class="ach-rec" data-set="${x.id}">${record(x.id, x.made)}<div class="ach-mini">${pieces}</div>${next}</div>`;
  };
  return `<div class="ach-records card">
    <div class="ach-card-head"><strong>${esc(T.records)}</strong><span class="ach-count">${T.of(made, sets.length * Core.METALS.length)}</span></div>
    <div class="ach-wall">${sets.map(slot).join('')}</div>
    <span class="ach-row-desc">${esc(made === sets.length * Core.METALS.length ? T.allRecords : T.recordHelp)}</span>
  </div>`;
};
/** The Emulsion gate, shown honestly: each condition with a tick or "have / need". No fake urgency. */
const gateCard = () => {
  const g = Core.gateOf(state());
  const rows = g.conds.map((c) => `<div class="ach-k${c.ok || g.open ? ' is-ok' : ''}"><span>${c.ok || g.open ? '✓ ' : ''}${esc(c.label)}</span><span>${c.ok || g.open ? fmt(c.need) : `${fmt(c.have)} / ${fmt(c.need)}`}</span></div>`).join('');
  return `<div class="ach-gate card${g.open ? ' is-open' : ''}">
    <div class="ach-card-head"><strong>${esc(T.gateTitle)}</strong><span class="ach-count">${g.open ? esc(T.gateOpen(dateOf(g.day))) : T.of(g.conds.filter((c) => c.ok).length, g.conds.length)}</span></div>
    <div class="ach-gate-body"><span class="ach-gate-orb${g.open ? '' : ' is-shut'}">${material(7, 'layers', 'lg', 'gate', 64)}</span><div class="ach-notes">${rows}</div></div>
    <span class="ach-row-desc">${esc(T.gateHelp)}</span>
  </div>`;
};

/* ---------------------------------------------------------------------------------------------- the one pop-up + level-up */
// Waits while a job runs, a window, menu or viewer is open, or the app is hidden (the app sets data-ach-busy for its own state)
const busy = () => !doc
  || doc.visibilityState === 'hidden'
  || doc.documentElement.dataset.achBusy === '1'
  || !!doc.querySelector('.modal-overlay, .context-menu-backdrop, .rail-flyout, .ach-levelup, .ach-view, .ach-moment');
let showing = false;
let calmSince = 0;
const setLine = (setId) => {
  const set = Core.SETS.find((x) => x.id === setId);
  return set ? set.pieces.map((id) => (Core.BY_ID.get(id) || {}).title).join(', ') : '';
};
const MOMENT_MS = 6000;
// Who wins: the Emulsion gate, then a new certified showreel, then the highest metal, then the most XP
const rankItem = (x) => {
  if (x.k === 'g') return 1e9;
  if (x.k === 'p') return 1e8 + (Number(x.to) || 0) * 1e6;
  const def = Core.BY_ID.get(x.id);
  const to = def && def.ladder ? Math.max(1, Number(x.tier) || 1) : 0;
  const from = def && def.ladder ? Math.max(0, Math.min(to - 1, Number(x.from) || 0)) : 0;
  const gain = !def ? 0 : def.ladder ? Core.xpOf(def, to) - (from ? Core.xpOf(def, from) : 0) : def.xp;
  return to * 1e6 + gain;
};
const moment = (top, more) => new Promise((resolve) => {
  const isGate = top.k === 'g';
  const px = Math.max(140, Math.min(Math.round(Math.min(root.innerWidth || 800, root.innerHeight || 600) * 0.38), 330));
  let art = '', eye = '', title = '', metal = '', desc = '', gain = 0, m = 0;
  if (isGate) {
    const st = state();
    m = 7;
    art = material(7, 'layers', 'xl', 'gate', px);
    eye = T.gateEye;
    title = T.gateMomentTitle;
    desc = T.gateMomentSub(st.c.adays, levelInfo(st).level, st.c.changes, (st.c.models || 0) + (st.c.hdrs || 0));
  } else if (top.k === 'p') {
    m = Math.max(1, Math.min(Core.METALS.length, Number(top.to) || 1));
    const from = Math.max(0, Math.min(m - 1, Number(top.from) || 0));
    gain = Core.RECORD_XP.slice(from, m).reduce((a, b) => a + b, 0);
    art = record(top.set, m, 'lg');
    eye = T.setDone;
    title = setName(top.set);
    metal = `${T.certified} ${metalOf(m)}`;
    desc = setLine(top.set);
  } else {
    const def = Core.BY_ID.get(top.id);
    m = def.ladder ? Math.max(1, Number(top.tier) || Core.tierOf(state(), def.id) || 1) : 0;
    const from = def.ladder ? Math.max(0, Math.min(m - 1, Number(top.from) || 0)) : 0;
    gain = def.ladder ? Core.xpOf(def, m) - (from ? Core.xpOf(def, from) : 0) : def.xp;
    art = m ? material(m, def.icon, 'xl', def.id, px, m < 7 ? medalInfo(def, m) : null) : `<span class="ach-badge ach-xl${def.tier ? ` is-${def.tier}` : ''}" style="--ach-xl:${Math.round(px * 0.8)}px">${svg(def.icon)}${shine(def.id)}</span>`;
    eye = from ? T.upgraded : T.unlocked;
    title = def.title;
    metal = def.ladder ? metalOf(m) : '';
    desc = def.desc;
  }
  const extra = [more.badges ? T.moreBadges(more.badges) : '', more.level ? T.levelReached(more.level) : ''].filter(Boolean).join(' · ');
  const ov = doc.createElement('div');
  ov.className = `ach-moment${m ? ` is-m${m}` : ''}${isGate ? ' is-gate' : ''}${reduced() ? ' is-calm' : ''}`;
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', `${eye}: ${title}`);
  ov.innerHTML = `<div class="ach-moment-orb">${art}</div>
    <span class="ach-moment-eye">${esc(eye)}</span>
    <strong class="ach-moment-title">${esc(title)}</strong>
    ${metal ? `<span class="ach-moment-metal ach-metal">${esc(metal)}</span>` : ''}
    <span class="ach-moment-sub">${esc(desc)}</span>
    ${gain ? `<span class="ach-moment-xp">+${fmt(gain)} XP</span>` : ''}
    ${extra ? `<span class="ach-moment-more">${esc(extra)}</span>` : ''}
    ${isGate ? `<button type="button" class="ach-moment-go">${esc(T.go)}</button>` : ''}
    <span class="ach-moment-hint">${esc(isGate ? T.goHint : T.momentHint)}</span>
    ${isGate || reduced() ? '' : `<i class="ach-moment-timer" style="animation-duration:${MOMENT_MS}ms"></i>`}`;
  let done = false;
  let timer = 0;
  const key = (e) => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  const close = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    doc.removeEventListener('keydown', key, true);
    ov.classList.add('is-out');
    setTimeout(() => {
      ov.remove();
      resolve();
    }, 320);
  };
  ov.addEventListener('click', close);
  doc.addEventListener('keydown', key, true);
  doc.body.appendChild(ov);
  if (!isGate) timer = setTimeout(close, MOMENT_MS);
  const go = ov.querySelector('.ach-moment-go');
  if (go) go.focus({ preventScroll: true });
  const c = ov.querySelector('canvas.ach-bubble');
  if (c) {
    c.setAttribute('data-reflect', '');
    Bubble.reflect(doc.body, ov);
  }
  live(ov);
});

const levelUp = (to, from) => new Promise((resolve) => {
  const info = levelInfo();
  const rank = Core.rankOf(to, gateOpen());
  const newRank = from && rank.m > Core.rankOf(from, gateOpen()).m;
  const ov = doc.createElement('div');
  ov.className = 'ach-levelup' + (reduced() ? ' is-calm' : '');
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', `${T.levelUp}: ${T.nowLevel(to)}`);
  const bits = reduced() ? '' : Array.from({ length: 18 }, (_, i) => `<i class="ach-bit" style="--a:${i * 20 + (i % 2) * 7}deg;--d:${70 + (i % 4) * 22}px"></i>`).join('');
  ov.innerHTML = `<div class="ach-lu-stack"><span class="ach-lu-eye">${esc(T.levelUp)}</span>
    <div class="ach-lu-burst"><span class="ach-lu-glow"></span>${bits}<span class="ach-lu-num">${to}</span></div>
    <strong class="ach-lu-title">${esc(to === info.level ? info.title : Core.titleOf(to))}</strong>
    <span class="ach-lu-sub">${esc(T.nowLevel(to))}</span>${newRank ? `<span class="ach-lu-rank is-m${rank.m}">${esc(T.newRank(metalOf(rank.m)))}</span>` : ''}</div>
    <span class="ach-lu-skip">${esc(T.skip)}</span>`;
  let done = false;
  const close = (e) => {
    if (done) return;
    if (e && e.type === 'keydown') {
      e.preventDefault();
      e.stopPropagation();
    }
    done = true;
    doc.removeEventListener('keydown', close, true);
    ov.classList.add('is-out');
    setTimeout(() => {
      ov.remove();
      resolve();
    }, 220);
  };
  ov.addEventListener('click', close);
  doc.addEventListener('keydown', close, true);
  doc.body.appendChild(ov);
  setTimeout(close, reduced() ? 1600 : 3200);
});

const pump = async () => {
  if (showing) return;
  if (busy()) {
    calmSince = 0;
    return;
  }
  if (!calmSince) {
    calmSince = Date.now();
    return;
  }
  if (Date.now() - calmSince < 1200) return; // a job or window has just closed: a short pause first
  const items = Obs.queue();
  if (!items.length) return;
  showing = true;
  try {
    const shown = items.filter((x) => (x.k === 'u' && Core.BY_ID.has(x.id)) || x.k === 'p' || x.k === 'g');
    const levels = items.filter((x) => x.k === 'l');
    const lvTo = levels.length ? Math.max(...levels.map((x) => Number(x.to) || 0)) : 0;
    const lvFrom = levels.length ? Math.min(...levels.map((x) => Number(x.from) || lvTo)) : 0;
    if (shown.length) {
      // One pop-up for the whole batch: the highest item; the rest (and a new level) in one line
      const top = shown.reduce((a, b) => (rankItem(b) > rankItem(a) ? b : a));
      const others = new Set(shown.filter((x) => x !== top).map((x) => (x.k === 'p' ? 'p:' + x.set : x.k === 'g' ? 'g' : 'u:' + x.id))).size;
      if (cfg.toasts || top.k === 'g') await moment(top, { badges: others, level: lvTo > 1 ? lvTo : 0 });
    } else if (lvTo > 1 && cfg.levelUp) await levelUp(lvTo, lvFrom);
    Obs.dropShown(items);
  } finally {
    showing = false;
    calmSince = 0;
  }
};
let pumpTimer = 0;
/** Starts the pop-up loop (once). */
export function startMoments() {
  if (pumpTimer || !doc) return;
  pumpTimer = setInterval(() => {
    pump().catch(() => {
      showing = false;
    });
  }, 400);
}

/* ---------------------------------------------------------------------------------------------- full view */
let viewKey = null;
const closeView = () => {
  stopMedal();
  const v = doc.querySelector('.ach-view');
  if (viewKey) {
    doc.removeEventListener('keydown', viewKey, true);
    viewKey = null;
  }
  if (v) {
    const back = v.dataset.from;
    v.remove();
    const row = back && doc.querySelector(`.ach-row[data-ach="${back}"]`);
    if (row) row.focus({ preventScroll: true });
  }
};
/** Full view of an earned badge: big and live at its real size over the blurred app, with its liner notes.
 *  ← → or the arrows go through every earned badge; Esc, ✕ or a click outside closes it. */
export function openView(id) {
  const st = state();
  const earned = Core.CATALOG.filter((d) => st.u[d.id]);
  let i = earned.findIndex((d) => d.id === id);
  if (i < 0) return;
  const show = () => {
    const d = earned[i];
    const tier = d.ladder ? Core.tierOf(state(), d.id) || 1 : 0;
    const w = root.innerWidth || 1000;
    const h = root.innerHeight || 700;
    const px = tier && tier < 7 ? Math.max(200, Math.round(Math.min(w * (w < 700 ? 0.9 : 0.44), h * 0.82, 620))) : Math.max(120, Math.round(Math.min(w * (w < 700 ? 0.6 : 0.34), h * 0.6, 360)));
    // tiers 1-6: a medal you can tilt and turn over (the certificate is on the back); Emulsion stays the bubble
    const art = tier && tier < 7
      ? `<div class="ach-plq is-round is-m${tier}${tier >= 5 ? ' is-stone' : ''}${tier >= 2 && tier <= 4 ? ' is-ink' : ''}" style="--ach-xl:${px}px" role="button" tabindex="0" aria-label="${esc(T.turnOver)}" title="${esc(T.turnOver)}">
          <div class="ach-plq-edge"></div>${material(tier, d.icon, 'xl', d.id, px, medalInfo(d, tier, 1.5))}<div class="ach-plq-glare"></div><div class="ach-plq-back">${certificate(d, tier)}</div></div><div class="ach-plq-floor"></div>`
      : tier ? material(tier, d.icon, 'xl', d.id, px) : `<span class="ach-badge ach-xl${d.tier ? ` is-${d.tier}` : ''}" style="--ach-xl:${Math.round(px * 0.7)}px">${svg(d.icon)}${shine(d.id)}</span>`;
    const metal = tier ? `<span class="ach-view-metal ach-metal is-m${tier}">${esc(metalOf(tier))}</span>` : '';
    const pips = d.ladder ? `<span class="ach-pips">${Core.METALS.map((_, k) => `<i class="${k < tier ? 'on' : ''}"></i>`).join('')}</span>` : '';
    let v = doc.querySelector('.ach-view');
    if (!v) {
      v = doc.createElement('div');
      v.className = 'ach-view' + (reduced() ? ' is-calm' : '');
      v.setAttribute('role', 'dialog');
      v.setAttribute('aria-modal', 'true');
      v.dataset.from = id;
      doc.body.appendChild(v);
      v.addEventListener('click', (e) => {
        if (e.target.closest('.ach-view-prev')) { i = (i - 1 + earned.length) % earned.length; show(); return; }
        if (e.target.closest('.ach-view-next')) { i = (i + 1) % earned.length; show(); return; }
        if (e.target.closest('.ach-view-x') || !e.target.closest('.ach-view-art, .ach-view-side')) closeView();
      });
      viewKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeView(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); i = (i + 1) % earned.length; show(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); i = (i - 1 + earned.length) % earned.length; show(); }
      };
      doc.addEventListener('keydown', viewKey, true);
    }
    v.setAttribute('aria-label', d.title);
    v.innerHTML = `<button type="button" class="ach-view-x" aria-label="${esc(T.close)}">✕</button>
      ${earned.length > 1 ? `<button type="button" class="ach-view-nav ach-view-prev" aria-label="${esc(T.prevBadge)}">‹</button><button type="button" class="ach-view-nav ach-view-next" aria-label="${esc(T.nextBadge)}">›</button>` : ''}
      <div class="ach-view-art">${art}</div>
      <div class="ach-view-side${tier ? ` is-m${tier}` : ''}">${metal}<strong class="ach-view-title">${esc(d.title)}</strong><span class="ach-view-desc">${esc(d.desc)}</span>${pips}${notes(d)}</div>`;
    const x = v.querySelector('.ach-view-x');
    if (x) x.focus({ preventScroll: true });
    const c = v.querySelector('canvas.ach-bubble');
    if (c) {
      c.setAttribute('data-reflect', '');
      Bubble.reflect(doc.body, v);
    }
    stopMedal();
    live(v);
    medal3d(v);
  };
  show();
}

/** The full view's medal as a real slab: its own outline (taken from its first frames) stacked behind the front makes the
 *  edge, a glare and the studio lights follow the pointer tilt, a shadow on the floor, a slow sway when the pointer is away;
 *  a click (or Enter / Space) turns it over to the certificate and back. While it is open only this medal draws (60 fps). */
let plq = null;
const fn = (name, v) => name + '(' + v + ')';
const stopMedal = () => {
  if (!plq) return;
  cancelAnimationFrame(plq.raf);
  clearTimeout(plq.snapT);
  plq = null;
  Gem.only(null);
  doc.documentElement.removeAttribute('data-ach-hold');
};
const medal3d = (v) => {
  const st = v.querySelector('.ach-plq');
  const c = st && st.querySelector('canvas.ach-gemgl[data-live="1"]');
  if (!st || !c) return;
  const floor = v.querySelector('.ach-plq-floor');
  const calm = reduced();
  const me = { raf: 0, snapT: 0 };
  plq = me;
  Gem.only(c);
  doc.documentElement.setAttribute('data-ach-hold', '');
  let tries = 0;
  const snap = () => {
    if (plq !== me) return;
    const w = c.width;
    const s1 = doc.createElement('canvas');
    s1.width = w;
    s1.height = w;
    const g1 = s1.getContext('2d');
    try {
      g1.drawImage(c, 0, 0);
      if (!g1.getImageData(w >> 1, w >> 1, 1, 1).data[3]) throw new Error('not drawn yet');
    } catch {
      if (++tries < 40) me.snapT = setTimeout(snap, 80);
      return;
    }
    const s2 = doc.createElement('canvas');
    s2.width = w;
    s2.height = w;
    const g2 = s2.getContext('2d');
    g2.translate(w, 0);
    g2.scale(-1, 1);
    g2.drawImage(s1, 0, 0);
    // edge layers: a half-size copy, darkened once here (no CSS filters: those cost every frame)
    const tone = (b) => {
      const e = doc.createElement('canvas');
      e.width = e.height = w >> 1;
      const g = e.getContext('2d');
      g.filter = fn('brightness', b);
      g.drawImage(s1, 0, 0, w >> 1, w >> 1);
      return fn('url', e.toDataURL());
    };
    const L = [tone(0.5), tone(0.36), tone(0.28)];
    const N = 12;
    st.querySelector('.ach-plq-edge').innerHTML = Array.from({ length: N }, (_, k) => {
      const f = k / (N - 1);
      const m = Math.sin(f * Math.PI);
      return `<i style="transform:translateZ(calc(var(--t) * ${(0.5 - f).toFixed(3)} - ${f < 0.5 ? 0.5 : -0.5}px));background-image:${L[m > 0.8 ? 2 : m > 0.4 ? 1 : 0]}"></i>`;
    }).join('');
    st.style.setProperty('--snap', fn('url', s1.toDataURL()));
    st.style.setProperty('--snapm', fn('url', s2.toDataURL()));
    st.classList.add('is-snap');
  };
  me.snapT = setTimeout(snap, 120);
  let ang = 0, target = 0, tx = 0, ty = 0, ptx = 0, pty = 0, hover = false, prev = performance.now();
  const frame = (now) => {
    if (plq !== me) return;
    const t = now || performance.now();
    const dt = Math.min(0.1, (t - prev) / 1000);
    prev = t;
    const k = calm ? 1 : 1 - Math.exp(-dt * 6.5), kp = 1 - Math.exp(-dt * 16);
    ang += (target - ang) * k;
    tx += (ptx - tx) * kp;
    ty += (pty - ty) * kp;
    if (Math.abs(target - ang) < 0.05) ang = target;
    const idle = calm || hover ? 0 : 1, ts = t / 1000;
    const rx = tx + idle * 3.5 * Math.sin(ts * 0.7), ry = ang + ty + idle * 9 * Math.sin(ts * 0.5);
    st.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    st.style.setProperty('--gx', `${(50 - ry * 1.6).toFixed(1)}%`);
    st.style.setProperty('--gy', `${(30 + rx * 2).toFixed(1)}%`);
    if (floor) floor.style.transform = `translateX(${(-ry * 0.6).toFixed(1)}px) scaleX(${(1 - Math.abs(Math.sin((ry * Math.PI) / 180)) * 0.25).toFixed(3)})`;
    Gem.set(c, { tilt: [Math.sin((ry * Math.PI) / 180) * 0.8, -rx / 40] });
    me.raf = requestAnimationFrame(frame);
  };
  frame();
  const turn = () => {
    target = target ? 0 : 180;
    st.classList.toggle('is-back', !!target);
  };
  st.addEventListener('pointermove', (e) => {
    const r = st.getBoundingClientRect();
    hover = true;
    pty = ((e.clientX - r.left) / r.width - 0.5) * 44;
    ptx = -((e.clientY - r.top) / r.height - 0.5) * 32;
  });
  st.addEventListener('pointerleave', () => {
    hover = false;
    ptx = 0;
    pty = 0;
  });
  st.addEventListener('click', (e) => {
    e.stopPropagation();
    turn();
  });
  st.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      turn();
    }
  });
};

/* ---------------------------------------------------------------------------------------------- Settings card */
/** Builds Settings > Achievements into `box`: pop-ups on/off, level-up on/off, the bubble's look with a live preview + Reset. */
export function mountSettings(box) {
  if (!box) return () => {};
  cfg = readCfg();
  const range = (k, label, max, unit, step) => `<label class="ach-set-row"><span>${esc(label)}</span><span class="ach-range"><input type="range" id="ach-set-${k}" min="0" max="${max}" step="${step}" value="${cfg[k]}"><output id="ach-set-${k}-v"></output></span></label>`;
  box.innerHTML = `<div class="ach-set">
    <label class="ach-set-row"><span>${esc(T.setToasts)}</span><input type="checkbox" id="ach-set-toasts"${cfg.toasts ? ' checked' : ''}></label>
    <label class="ach-set-row"><span>${esc(T.setLevel)}</span><input type="checkbox" id="ach-set-levelup"${cfg.levelUp ? ' checked' : ''}></label>
    <div class="ach-set-bubble"><div class="ach-set-preview" id="ach-set-preview"></div><div class="ach-set-sliders">
      ${range('refl', T.setRefl, 200, '%', 5)}${range('see', T.setSee, 100, '%', 5)}${range('soft', T.setSoft, 12, 'px', 0.5)}
      <button type="button" class="ach-btn" id="ach-set-reset">${esc(T.reset)}</button></div></div>
  </div>`;
  const $ = (id) => box.querySelector('#' + id);
  const out = (k) => {
    const o = $(`ach-set-${k}-v`);
    if (o) o.textContent = k === 'soft' ? `${cfg.soft} px` : `${cfg[k]} %`;
  };
  $('ach-set-toasts').addEventListener('change', (e) => { cfg.toasts = e.target.checked; saveCfg(); });
  $('ach-set-levelup').addEventListener('change', (e) => { cfg.levelUp = e.target.checked; saveCfg(); });
  let saveT = 0;
  for (const k of Object.keys(BUBBLE)) {
    const r = $(`ach-set-${k}`);
    out(k);
    r.addEventListener('input', () => {
      cfg[k] = +r.value;
      out(k);
      applyBubble();
      clearTimeout(saveT);
      saveT = setTimeout(saveCfg, 250);
    });
  }
  $('ach-set-reset').addEventListener('click', () => {
    Object.assign(cfg, BUBBLE);
    for (const k of Object.keys(BUBBLE)) {
      $(`ach-set-${k}`).value = cfg[k];
      out(k);
    }
    applyBubble();
    saveCfg();
  });
  const prev = $('ach-set-preview');
  prev.innerHTML = material(7, 'layers', 'xl', 'preview', 72);
  const c = prev.querySelector('canvas.ach-bubble');
  if (c) c.setAttribute('data-reflect', '');
  Bubble.reflect(box, prev);
  Bubble.mount(prev);
  return () => clearTimeout(saveT);
}

export { T as STRINGS, levelInfo };
