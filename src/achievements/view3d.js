/**
 * The full view's medal in real 3D (the Achievements Lab v21 "Iris" housing): ray traced relief at every angle, Diamond and
 * Ruby ray traced in their seat, Emulsion as the live bubble held inside the pearl ring. Drag turns it any way, like holding
 * it (a trackball about the screen axes); let go while moving and it keeps turning, then slows. A click, Enter or Space
 * turns it over to the certificate engraved on the back. Pointer away: a slow sway.
 *
 * Smoothness: one WebGL context for the whole app (medal3d.js), its programs compiled in the background (warm) before the
 * view opens, the flat badge shown until the first 3D frame is ready (never a blank or a frozen frame), and the resolution
 * steps down a little on its own if a frame runs long, then back up. Nothing else on the screen draws while it is open.
 * No WebGL: start() returns null and the caller keeps the flat medal.
 */
import Gem from './gem.js';
import Bubble from './bubble.js';
import M3D from './medal3d.js';
import { wearOf, wearVec, polish } from './wear.js';

const root = typeof window !== 'undefined' ? window : globalThis;
const D2R = Math.PI / 180;
// 3x3 rotations, row-major, object -> world (same as medal3d)
const M3 = {
  rx: (d) => {
    const c = Math.cos(d * D2R), s = Math.sin(d * D2R);
    return [1, 0, 0, 0, c, -s, 0, s, c];
  },
  ry: (d) => {
    const c = Math.cos(d * D2R), s = Math.sin(d * D2R);
    return [c, 0, s, 0, 1, 0, -s, 0, c];
  },
  mul: (A, B) => {
    const C = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    return C;
  },
  /** turn Q about the screen: dx degrees about the vertical axis, dy about the horizontal one */
  turn: (Q, dx, dy) => M3.ortho(M3.mul(M3.rx(dy), M3.mul(M3.ry(dx), Q))),
  ortho: (Q) => {
    const n = (v) => {
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      return v.map((x) => x / l);
    };
    const x = n(Q.slice(0, 3)), b = Q.slice(3, 6), d = x[0] * b[0] + x[1] * b[1] + x[2] * b[2];
    const y = n([b[0] - d * x[0], b[1] - d * x[1], b[2] - d * x[2]]);
    return x.concat(y, [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]);
  },
};
// metal reflectance per tier (= gem.js METAL); Diamond and Ruby: the housing's own gunmetal; Emulsion: pearl
const MET = { 1: [0.86, 0.52, 0.3], 2: [0.93, 0.94, 0.97], 3: [1.0, 0.77, 0.33], 4: [0.72, 0.93, 0.91], 7: [0.93, 0.93, 0.95] };
export const SHAPE = 'iris';   // the housing the owner picked (Achievements Lab tuning/design, 2026-11-24)

const age = () => root.ACHAge || { sway: 0.33, hover: 0.33, flick: 1, friction: 2.2 };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** Compile the housing's programs in the background (call when the Achievements screen opens). */
export function warm() {
  try {
    M3D.warmHouse(SHAPE);
  } catch {
    /* no 3D: the flat medals stay */
  }
}

let cur = null;
/** Stop the 3D medal that is showing (if any). */
export function stop() {
  if (!cur) return;
  const me = cur;
  cur = null;
  cancelAnimationFrame(me.raf);
  try {
    M3D.stop();
  } catch {
    /* ignore */
  }
  me.off();
  document.documentElement.removeAttribute('data-ach-hold');
  Gem.only(null);
  try {
    Bubble.only && Bubble.only(null);
  } catch {
    /* ignore */
  }
}

/**
 * Put a 3D medal into `host` (the full view's art box). o: { id, tier, icon, title, sub, since, px, standIn (flat html),
 * reduced, label, view (element that gets pointer moves for the hover tilt) }. Returns { polish() } or null without WebGL.
 */
export function start(host, o) {
  stop();
  if (!M3D || !host) return null;
  const S = o.px;
  const stage = document.createElement('div');
  stage.className = 'ach-3d-stage';
  stage.style.setProperty('--S', `${S}px`);
  stage.tabIndex = 0;
  stage.setAttribute('role', 'button');
  stage.setAttribute('aria-label', o.label);
  stage.innerHTML = `<div class="ach-3d-ph">${o.standIn || ''}</div><div class="ach-3d-floor"></div>`;
  const c = document.createElement('canvas');
  const dpr = Math.min(root.devicePixelRatio || 1, 1.5);
  c.width = c.height = Math.round(Math.min(S * dpr, 900));
  c.className = 'ach-3d';
  c.setAttribute('aria-hidden', 'true');
  stage.appendChild(c);
  host.innerHTML = '';
  host.appendChild(stage);
  // the flat badge shows (and draws alone) until the 3D one has its first frame: never a blank stage while a program compiles
  const ph = stage.querySelector('.ach-3d-ph');
  const emu = o.tier >= 7;
  let w = emu ? { d: 0, sd: 0, w: 0 } : wearOf(o.id, o.since);
  try {
    Bubble.mount(ph);
    Gem.mount(ph);
    document.documentElement.setAttribute('data-ach-hold', '');   // the screen's medals hold still while this one is open
    const pb = ph.querySelector('canvas.ach-bubble');
    if (pb && Bubble.only) Bubble.only(pb);
    const pc = ph.querySelector('canvas.ach-gemgl');
    if (pc) {
      if (!emu) Gem.set(pc, { wear: wearVec(w) });
      Gem.only(pc);
    }
  } catch {
    /* ignore */
  }
  // our rAF goes first, before the renderer's: a drag or tilt shows in the same frame, never one behind
  const me = { raf: 0, off: () => {} };
  cur = me;
  me.raf = requestAnimationFrame((ts) => tick(ts));
  const ok = M3D.start(c, 'house', !!o.reduced, { metal: MET[o.tier], icon: o.icon, title: o.title, sub: o.sub, wear: wearVec(w), shape: SHAPE, tier: o.tier });
  if (!ok) {
    cancelAnimationFrame(me.raf);
    cur = null;
    host.innerHTML = '';
    document.documentElement.removeAttribute('data-ach-hold');
    Gem.only(null);
    try {
      Bubble.only && Bubble.only(null);
    } catch {
      /* ignore */
    }
    return null;
  }
  c.addEventListener('ach3d-ready', () => {
    ph.remove();
    Gem.only(null);
    try {
      Bubble.only && Bubble.only(null);
    } catch {
      /* ignore */
    }
    stage.classList.add('is-ready');
  }, { once: true });

  const A = age();
  let Q = M3.rx(o.tier < 5 || emu ? -12 : -24);
  let box = { left: 0, top: 0, width: S, height: S };
  let rx = 0, ry = 0, vy = 0, vp = 0, turn = 0, turnT = 0, last = 0, px = null, py = 0, moved = 0, drag = null, wasDrag = false;
  const apply = () => {
    try {
      M3D.rotM(M3.mul(M3.ry(ry * 0.6), M3.mul(M3.rx(-rx * 0.6), Q)));
    } catch {
      /* ignore */
    }
  };
  const tick = (ts) => {
    if (cur !== me) return;
    me.raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (ts - (last || ts)) / 1000);
    last = ts;
    let tx = 0, ty = 0;
    if (o.reduced) {
      /* no sway, no hover drift */
    } else if (px !== null && ts - moved < 4000) {
      const r = box;
      ty = clamp((px - (r.left + r.width / 2)) / ((root.innerWidth || 1000) / 2), -1, 1) * 22 * A.hover;
      tx = -clamp((py - (r.top + r.height / 2)) / ((root.innerHeight || 700) / 2), -1, 1) * 16 * A.hover;
    } else {
      const t = ts / 1000;
      tx = 3.5 * A.sway * Math.sin(0.7 * t);
      ty = 9 * A.sway * Math.sin(0.5 * t);
    }
    const k = 1 - Math.exp(-dt * 16);
    rx += (tx - rx) * k;
    ry += (ty - ry) * k;
    if (!drag) {
      if (vy || vp) Q = M3.turn(Q, vy * dt, vp * dt);   // a flick keeps turning, then slows
      const fr = Math.exp(-dt * A.friction);
      vy *= fr;
      vp *= fr;
      if (Math.abs(vy) + Math.abs(vp) < 0.5) vy = vp = 0;
    } else {
      rx *= 0.9;
      ry *= 0.9;
    }
    const tw = o.reduced ? turnT - turn : (turnT - turn) * (1 - Math.exp(-dt * 5));   // turning over: about the screen's horizontal
    turn += tw;
    if (tw) Q = M3.turn(Q, 0, tw);
    apply();
  };
  apply();

  const flip = () => {
    turnT += 180;
  };
  // the flick's speed from the events' own time stamps over the last 100 ms (a slow frame must not bunch moves together)
  const flickV = (h, now) => {
    const win = h.filter((m) => now - m.ts < 100);
    if (win.length < 2) return [0, 0];
    const span = Math.max(30, win[win.length - 1].ts - win[0].ts) / 1000;
    let x = 0, y = 0;
    for (let i = 1; i < win.length; i++) {
      x += win[i].dx;
      y += win[i].dy;
    }
    x /= span;
    y /= span;
    const sp = Math.hypot(x, y), cap = 540;
    return sp > cap ? [(x * cap) / sp, (y * cap) / sp] : [x, y];
  };
  const down = (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    box = stage.getBoundingClientRect();
    drag = { x: ev.clientX, y: ev.clientY, ts: ev.timeStamp, sx: ev.clientX, sy: ev.clientY, h: [] };
    wasDrag = false;
    vy = vp = 0;
    try {
      stage.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
  };
  const move = (ev) => {
    const g = drag;
    if (!g) return;
    const dx = ev.clientX - g.x, dy = ev.clientY - g.y, k = 300 / Math.max(300, box.width);
    Q = M3.turn(Q, dx * k, dy * k);
    g.h.push({ ts: ev.timeStamp, dx: dx * k, dy: dy * k });
    if (g.h.length > 12) g.h.shift();
    g.x = ev.clientX;
    g.y = ev.clientY;
    g.ts = ev.timeStamp;
    if (Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) > 5) wasDrag = true;
  };
  const up = (ev) => {
    const g = drag;
    if (!g) return;
    vy = vp = 0;
    const ts = (ev && ev.timeStamp) || performance.now();
    if (ev && ev.type === 'pointerup' && ts - g.ts < 60) {
      const [x, y] = flickV(g.h, ts);
      vy = x * A.flick;
      vp = y * A.flick;
    }
    drag = null;
  };
  const click = (ev) => {
    ev.stopPropagation();
    if (wasDrag) {
      wasDrag = false;
      return;
    }
    flip();
  };
  const key = (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      ev.stopPropagation();
      flip();
    }
  };
  const hover = (ev) => {
    if (px === null || performance.now() - moved > 250) box = stage.getBoundingClientRect();
    px = ev.clientX;
    py = ev.clientY;
    moved = performance.now();
  };
  const leave = () => {
    px = null;
  };
  const view = o.view || stage;
  stage.addEventListener('pointerdown', down);
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('click', click);
  stage.addEventListener('keydown', key);
  view.addEventListener('pointermove', hover);
  view.addEventListener('pointerleave', leave);
  me.off = () => {
    view.removeEventListener('pointermove', hover);
    view.removeEventListener('pointerleave', leave);
  };
  return {
    stage,
    /** One rub with the cloth: returns the new wear. */
    polish() {
      if (emu) return w;
      w = polish(o.id);
      try {
        M3D.wear(wearVec(w));
      } catch {
        /* ignore */
      }
      return w;
    },
    wear: () => w,
  };
}
