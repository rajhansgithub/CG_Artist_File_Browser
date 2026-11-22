/**
 * Source of the live preview page (docs/achievements-preview.html, the "CG Artist File Browser Achievements" artifact).
 * It runs the app's real achievements code (core, observer, ui, shaders) on sample states, outside the app.
 * Rebuild the page: node docs/build-achievements-preview.mjs
 */
import * as Core from '../src/achievements/core.js';
import * as Obs from '../src/achievements/observer.js';
import { renderScreen, mountSettings, startMoments, openView } from '../src/achievements/ui.js';
import '../src/achievements/pill.css';

const DAY = 86400000;
const today = Math.floor(Date.now() / DAY);
/** A sample: ladders at given tiers, some single badges, sets, counters. Dates spread back from today. */
const sample = ({ tiers, singles, sets, lx, gate, counters }) => {
  const s = Core.empty();
  for (const [id, t] of Object.entries(tiers)) {
    const d = Core.BY_ID.get(id);
    s.k[id] = t;
    s.u[id] = (today - 30 * t - 20) * DAY;
    s.kd[id] = Array.from({ length: t }, (_, i) => today - 30 * (t - i) - 20 + i * 9);
    s.c[d.ladder.c] = d.ladder.at[t - 1] + Math.round(d.ladder.at[t - 1] * 0.3);
  }
  for (const id of singles) s.u[id] = (today - 12) * DAY;
  s.ps = sets || {};
  s.lx = lx || 0;
  s.first = today - 400;
  Object.assign(s.c, counters || {});
  if (gate) s.g = today - 3;
  return s;
};
const SAMPLES = {
  week: {
    label: 'First week',
    make: () => sample({ tiers: { model_citizen: 2, light_meter: 1, dailies: 1, mover_and_shaker: 1, regular: 1 }, singles: ['first_light', 'quick_draw', 'reading_room', 'pixel_soup'], lx: 0, counters: { adays: 5, amon: 1, changes: 140 } })
  },
  year: {
    label: 'A year in · Diamond rank',
    make: () => sample({
      tiers: { model_citizen: 6, light_meter: 5, dailies: 3, lookdev_lead: 4, mover_and_shaker: 4, tidy_desk: 3, taxonomist: 2, clean_sweep: 1, factory_line: 4, hand_off: 4, twin_finder: 4, pipeline_td: 4, regular: 3, still_here: 2 },
      singles: ['first_light', 'globetrotter', 'deep_diver', 'quick_draw', 'color_coded', 'format_hopper', 'reading_room', 'mip_master', 'full_set', 'works_on_my_machine', 'pixel_soup', 'night_shift', 'conversion_therapy'],
      sets: { reviewer: 1, wrangler: 1, pipeline: 4 }, lx: 9000, counters: { adays: 142, amon: 5, changes: 8000 }
    })
  },
  gate: {
    label: 'Emulsion gate open',
    make: () => sample({
      tiers: { model_citizen: 7, light_meter: 6, dailies: 5, lookdev_lead: 4, mover_and_shaker: 7, tidy_desk: 6, taxonomist: 6, clean_sweep: 5, factory_line: 4, hand_off: 6, twin_finder: 4, pipeline_td: 5, regular: 6, still_here: 5, weekly_ritual: 5, interior_designer: 3 },
      singles: ['first_light', 'globetrotter', 'deep_diver', 'quick_draw', 'color_coded', 'plugged_in', 'format_hopper', 'reading_room', 'mip_master', 'full_set', 'omnivore', 'works_on_my_machine', 'pixel_soup', 'night_shift', 'conversion_therapy', 'weekend_warrior'],
      sets: { reviewer: 4, wrangler: 5, pipeline: 4 }, lx: 60000, gate: true, counters: { adays: 300, amon: 10, changes: 60000, models: 15500, hdrs: 5100 }
    })
  }
};

const $ = (id) => document.getElementById(id);
const NEW_KEY = 'cgabAchNewV1';
const push = (items) => {
  try {
    const q = JSON.parse(localStorage.getItem(NEW_KEY) || '[]');
    localStorage.setItem(NEW_KEY, JSON.stringify(q.concat(items)));
    return true;
  } catch {
    return false;
  }
};

function setSample(key) {
  Obs.showSample(SAMPLES[key].make());
  document.querySelectorAll('[data-sample]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sample === key)));
}

function boot() {
  // follow the viewer's theme; the toggle overrides it
  const root = document.documentElement;
  if (!root.dataset.theme) root.dataset.theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  const syncTheme = () => document.querySelectorAll('[data-theme-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themePick === root.dataset.theme)));
  document.querySelectorAll('[data-theme-pick]').forEach((b) => b.addEventListener('click', () => { root.dataset.theme = b.dataset.themePick; syncTheme(); }));
  syncTheme();

  document.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', () => setSample(b.dataset.sample)));
  setSample('year');
  renderScreen($('ach-live'));
  mountSettings($('ach-settings'));
  startMoments();

  const note = $('ach-moment-note');
  const moment = (items) => {
    if (!push(items)) note.textContent = 'This browser blocks page storage, so the pop-up cannot be queued here.';
    else note.textContent = 'Queued. It shows in about a second, once nothing else is open.';
  };
  const now = () => Date.now();
  $('m-badge').addEventListener('click', () => moment([{ k: 'u', id: 'tidy_desk', tier: 3, from: 2, at: now() }, { k: 'l', from: 11, to: 12, at: now() }]));
  $('m-ruby').addEventListener('click', () => moment([{ k: 'u', id: 'model_citizen', tier: 6, from: 5, at: now() }, { k: 'u', id: 'quick_draw', tier: 0, from: 0, at: now() }]));
  $('m-set').addEventListener('click', () => moment([{ k: 'p', set: 'pipeline', from: 3, to: 4, at: now() }]));
  $('m-gate').addEventListener('click', () => { setSample('gate'); moment([{ k: 'g', at: now() }]); });
  $('m-level').addEventListener('click', () => moment([{ k: 'l', from: 20, to: 21, at: now() }]));
  $('m-view').addEventListener('click', () => {
    const st = Obs.getState();
    const id = st.u.model_citizen ? 'model_citizen' : Object.keys(st.u)[0];
    if (id) openView(id);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
