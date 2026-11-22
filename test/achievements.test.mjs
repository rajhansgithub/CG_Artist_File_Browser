// Unit tests for the achievements core (src/achievements/core.js). Run: npm run test:achievements
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/achievements/core.js';

const T0 = new Date(2026, 10, 23, 12, 0, 0).getTime(); // a Monday, local noon
const DAY = 86400000;
const run = (state, evs, now = T0) => {
  let s = state || C.empty();
  const out = { unlocked: [], sets: [], gate: false, quiet: [] };
  for (const ev of evs) {
    const r = C.apply(s, ev, { now });
    s = r.state;
    out.unlocked.push(...r.unlocked);
    out.sets.push(...r.sets);
    out.quiet.push(...r.quiet);
    out.gate = out.gate || r.gate;
  }
  return { s, ...out };
};
const many = (ev, n) => Array.from({ length: n }, () => ev);

test('shared XP curve, titles and ranks', () => {
  assert.equal(C.need(1), 100);
  assert.equal(C.need(10), Math.round(60 + 40 * Math.pow(10, 1.25)));
  assert.equal(C.levelOf(0).level, 1);
  assert.equal(C.levelOf(99).level, 1);
  assert.equal(C.levelOf(100).level, 2);
  assert.deepEqual([1, 3, 6, 8, 12, 16, 20].map(C.titleOf), ['Intern', 'Junior Artist', 'Artist', 'Senior Artist', 'Lead', 'Supervisor', 'VFX Legend']);
  assert.deepEqual([1, 4, 5, 9, 10, 14, 15, 19, 20, 29, 30, 39].map((l) => C.rankOf(l).name),
    ['Bronze', 'Bronze', 'Silver', 'Silver', 'Gold', 'Gold', 'Platinum', 'Platinum', 'Diamond', 'Diamond', 'Ruby', 'Ruby']);
  assert.equal(C.rankOf(45, false).name, 'Ruby', 'rank stays Ruby while the Emulsion gate is shut');
  assert.equal(C.rankOf(45, true).name, 'Emulsion');
  assert.deepEqual(C.LADDER_XP, [25, 50, 100, 250, 500, 1000, 2000]);
  assert.deepEqual(C.RECORD_XP, [100, 200, 400, 800, 1500, 3000, 6000]);
  assert.equal(C.FLAT_CAP, 40);
});

test('catalog is well formed', () => {
  const ids = new Set();
  for (const d of C.CATALOG) {
    assert.ok(!ids.has(d.id), `duplicate id ${d.id}`);
    ids.add(d.id);
    assert.ok(C.CATS.some((c) => c.id === d.cat), `${d.id} has a known category`);
    if (d.ladder) {
      assert.equal(d.ladder.at.length, 7, `${d.id} has 7 tiers`);
      for (let i = 1; i < 7; i++) assert.ok(d.ladder.at[i] > d.ladder.at[i - 1], `${d.id} thresholds rise`);
      assert.ok(!d.hidden && d.cat !== 'jokes', 'jokes and secrets never get tiers');
    }
    assert.ok(!d.pro, 'free mode: no paid badges');
  }
  assert.ok(C.CATALOG.length >= 40 && C.CATALOG.length <= 50);
  const inSets = C.SETS.flatMap((s) => s.pieces);
  assert.equal(new Set(inSets).size, 12, 'a badge sits in one set only');
  for (const id of inSets) assert.ok(C.BY_ID.get(id).ladder, `${id} is a ladder`);
});

test('only fresh, finished work counts', () => {
  const r = run(null, [{ t: 'open', kind: '3d', ext: 'fbx', fresh: false }, { t: 'open', kind: '3d', ext: 'fbx', fresh: false }]);
  assert.equal(r.s.c.models || 0, 0, 're-opens never count');
  const r2 = run(null, many({ t: 'open', kind: '3d', ext: 'fbx', fresh: true }, 5));
  assert.equal(r2.s.c.models, 5);
  assert.equal(C.tierOf(r2.s, 'model_citizen'), 1);
  const r3 = run(null, [{ t: 'transfer', mode: 'copy', done: 0, failed: 3 }]);
  assert.equal(r3.s.c.moved || 0, 0, 'a job that changed nothing gives nothing');
  assert.equal(r3.s.f, 0);
});

test('a big job skips tiers; XP is the sum of every tier passed', () => {
  const r = run(null, [{ t: 'transfer', mode: 'copy', done: 2500, failed: 0 }]);
  assert.equal(C.tierOf(r.s, 'mover_and_shaker'), 4);
  assert.equal(C.xpOf(C.BY_ID.get('mover_and_shaker'), 4), 25 + 50 + 100 + 250);
  assert.deepEqual(r.s.kd.mover_and_shaker.length, 4);
});

test('every ladder threshold reaches its tier, and stops at Ruby while the gate is shut', () => {
  for (const d of C.CATALOG.filter((x) => x.ladder)) {
    d.ladder.at.forEach((n, i) => {
      assert.equal(C.tierFor(d, n), i + 1);
      assert.equal(C.tierFor(d, n - 1), i);
    });
  }
  const r = run(null, [{ t: 'transfer', mode: 'move', done: 200000, failed: 0 }]);
  assert.equal(C.tierOf(r.s, 'mover_and_shaker'), 6, 'Emulsion waits for the gate');
  assert.equal(r.s.c.moved, 200000, 'the count keeps going');
  const p = C.progress(r.s, C.BY_ID.get('mover_and_shaker'));
  assert.equal(p.next, 7);
  assert.equal(p.gate, true);
});

test('flat XP is capped at 40 a day and the clean check gives 5 once a day', () => {
  const r = run(null, many({ t: 'rename' }, 100));
  assert.equal(r.s.f, 40);
  const r2 = run(null, [{ t: 'dupscan' }, { t: 'dupscan' }]);
  assert.equal(r2.s.f, 2 + 5 + 2, 'two scans: 2 + clean 5 + 2');
  const r3 = run(r.s, [{ t: 'rename' }], T0 + DAY);
  assert.equal(r3.s.f, 41, 'a new day has a new cap');
});

test('happy accidents, secrets, Professional Clown', () => {
  const r = run(null, [
    { t: 'open_fail', kind: '3d', reason: 'Blender was not found' },
    { t: 'nav_fail', network: true }, { t: 'net_fail' }, { t: 'drop_bad' },
    { t: 'open_fail', kind: 'image' }, { t: 'conflict' }, { t: 'convert', converted: 0, failed: 0, cancelled: true },
    { t: 'nav', drive: 'C:', depth: 1, files: 0, empty: true }
  ]);
  for (const id of ['works_on_my_machine', 'render_farm_down', 'share_not_found', 'wrong_password', 'not_a_file', 'pixel_soup', 'conflict_resolution', 'cancel_culture', 'nothing_to_see', 'professional_clown']) {
    assert.ok(r.s.u[id], id);
  }
  assert.equal(C.BY_ID.get('pixel_soup').xp, 10);
  const night = new Date(2026, 10, 24, 2, 30).getTime();
  assert.ok(run(null, [{ t: 'rename' }], night).s.u.night_shift);
  assert.ok(!run(null, [{ t: 'rename' }], new Date(2026, 10, 24, 5).getTime()).s.u.night_shift);
});

test('loyalty counts totals: days, months, weeks with 3+ days; a gap costs nothing', () => {
  let s = C.empty();
  for (const d of [0, 1, 2, 10, 11, 12, 40]) {
    s = C.apply(s, { t: 'rename' }, { now: T0 + d * DAY }).state;
    s = C.apply(s, { t: 'rename' }, { now: T0 + d * DAY + 3600000 }).state; // same day again: no new day
  }
  assert.equal(s.c.adays, 7);
  assert.equal(s.c.rit, 2, 'two Mon-Sun weeks had 3 days');
  assert.equal(s.c.amon, 3, 'Nov, Dec, Jan');
  assert.equal(C.tierOf(s, 'regular'), 1);
  assert.equal(C.tierOf(s, 'still_here'), 1);
  // install and ignore counts nothing
  const idle = run(null, [{ t: 'nav', drive: 'C:', depth: 1, files: 3 }]);
  assert.equal(idle.s.c.adays || 0, 0);
});

test('weekend warrior needs Saturday and Sunday of the same weekend', () => {
  const sat = new Date(2026, 10, 28, 12).getTime(); // Saturday
  let s = C.apply(C.empty(), { t: 'rename' }, { now: sat }).state;
  s = C.apply(s, { t: 'rename' }, { now: sat + DAY }).state;
  assert.ok(s.u.weekend_warrior);
  let s2 = C.apply(C.empty(), { t: 'rename' }, { now: sat + DAY }).state; // Sunday only
  s2 = C.apply(s2, { t: 'rename' }, { now: sat + 7 * DAY }).state; // next Saturday
  assert.ok(!s2.u.weekend_warrior);
});

test('flawless week: 7 days in a row with work and no failed job', () => {
  let s = C.empty();
  for (let d = 0; d < 7; d++) s = C.apply(s, { t: 'rename' }, { now: T0 + d * DAY }).state;
  assert.ok(s.u.flawless_week);
  let s2 = C.empty();
  for (let d = 0; d < 7; d++) {
    s2 = C.apply(s2, { t: 'rename' }, { now: T0 + d * DAY }).state;
    if (d === 3) s2 = C.apply(s2, { t: 'transfer', done: 1, failed: 1 }, { now: T0 + d * DAY }).state;
  }
  assert.ok(!s2.u.flawless_week);
});

test('viewers: Omnivore, Reading Room, Format Hopper, Mip Master', () => {
  const evs = C.VIEWERS.filter((k) => k !== 'compare').map((kind) => ({ t: 'open', kind, ext: 'x', fresh: true }));
  evs.push({ t: 'compare', fresh: true });
  const r = run(null, evs);
  assert.ok(r.s.u.omnivore && r.s.u.reading_room && r.s.u.mip_master);
  const r2 = run(null, ['obj', 'fbx', 'glb', 'fbx', 'usd'].map((ext) => ({ t: 'open', kind: '3d', ext, fresh: true })));
  assert.ok(r2.s.u.format_hopper);
  assert.equal(r2.s.c.fmn, 4);
});

test('sets make certified showreels; a record is never higher than its pieces', () => {
  const evs = [
    ...many({ t: 'open', kind: '3d', ext: 'obj', fresh: true }, 5),
    ...many({ t: 'open', kind: 'hdr', fresh: true }, 5),
    { t: 'watched', kind: 'video', fresh: true },
    { t: 'compare', fresh: true }
  ];
  const r = run(null, evs);
  assert.deepEqual(r.sets, [{ id: 'reviewer', from: 0, to: 1 }]);
  assert.equal(r.s.ps.reviewer, 1);
  const bad = C.normalize({ ...r.s, ps: { reviewer: 5, wrangler: 3 } });
  assert.equal(bad.ps.reviewer, 1);
  assert.equal(bad.ps.wrangler, undefined);
  assert.equal(C.totalXp(r.s) - C.totalXp({ ...r.s, ps: {} }), 100, 'record XP');
});

test('merge: union / max, earliest dates, order independent', () => {
  const a = run(null, [{ t: 'rename' }, { t: 'label', n: 12 }], T0).s;
  const b = run(null, [{ t: 'rename' }, { t: 'rename' }, { t: 'delete', n: 12 }], T0 + 3 * DAY).s;
  const m1 = C.merge(a, b), m2 = C.merge(b, a);
  assert.ok(C.same(m1, m2));
  assert.equal(m1.c.renamed, 2);
  assert.equal(m1.c.tagged, 12);
  assert.equal(m1.c.renamed, 2);
  const a2 = run(null, [{ t: 'label', n: 1 }], T0 + 5 * DAY).s;
  assert.equal(C.merge(a, a2).u.color_coded, Math.floor(T0 / DAY), 'earliest day kept');
  assert.ok(m1.u.color_coded && m1.u.clean_sweep);
  assert.ok(C.totalXp(m1) >= Math.max(C.totalXp(a), C.totalXp(b)), 'XP never drops');
  assert.ok(C.same(C.merge(m1, m1), m1));
  assert.ok(C.same(C.merge(a, undefined), a), 'a missing copy loses nothing');
});

test('normalize drops junk and caps tiers at Ruby while the gate is shut', () => {
  const s = C.normalize({ u: { nope: 5, tidy_desk: 20000 }, k: { tidy_desk: 9 }, c: { 'bad key': 4, renamed: -3 }, f: 'x' });
  assert.equal(s.u.nope, undefined);
  assert.equal(s.k.tidy_desk, 6);
  assert.equal(s.c.renamed, 0);
  assert.equal(s.f, 0);
  assert.ok(C.serialize(C.empty()).length < 400);
});

test('saved state stays under 4 KB even when busy', () => {
  let s = C.empty();
  for (let d = 0; d < 60; d++) {
    for (const ev of [{ t: 'open', kind: '3d', ext: 'e' + d, fresh: true }, { t: 'transfer', done: 999 }, { t: 'label', n: 50 }, { t: 'convert', converted: 600 }, { t: 'dupscan' }, { t: 'nav', drive: 'D' + d, depth: 12, files: 4 }]) {
      s = C.apply(s, ev, { now: T0 + d * DAY }).state;
    }
  }
  assert.ok(C.serialize(s).length < 4096, `size ${C.serialize(s).length}`);
});

// A state that meets every gate condition but one (the one named is left short)
const nearGate = (short) => {
  const s = C.empty();
  const g = C.GATE;
  s.c.adays = short === 'days' ? g.days - 2 : g.days - 1; // the next event is a new day of real work
  s.c.amon = short === 'months' ? g.months - 2 : g.months - 1; // and a new month
  s.c.changes = short === 'changes' ? g.changes - 2 : g.changes - 1; // the next event adds 1
  s.c.models = short === 'reviewed' ? 10 : g.reviewed;
  s.c.moved = 100000; s.c.renamed = 40000; s.c.tagged = 100000;
  for (const id of short === 'ruby' ? ['mover_and_shaker', 'tidy_desk'] : ['mover_and_shaker', 'tidy_desk', 'taxonomist']) {
    s.u[id] = 1; s.k[id] = 6; s.kd[id] = [1, 1, 1, 1, 1, 1];
  }
  s.lx = short === 'level' ? 1000 : 60000; // kept XP stands in for a long history
  return s;
};

test('FREE MODE gate: shut until every condition holds, one moment, ladders climb quietly', () => {
  for (const k of ['level', 'days', 'months', 'ruby', 'changes', 'reviewed']) {
    const r = run(nearGate(k), [{ t: 'rename' }], T0);
    assert.equal(r.gate, false, `gate stays shut with ${k} short`);
    assert.equal(r.s.g, 0);
    assert.ok(!C.gateOf(r.s).conds.find((c) => c.k === k).ok);
  }
  const r = run(nearGate(''), [{ t: 'rename' }], T0);
  assert.equal(r.gate, true);
  assert.ok(r.s.g > 0);
  assert.equal(C.tierOf(r.s, 'mover_and_shaker'), 7, 'past its Emulsion count: climbs at once');
  assert.equal(C.tierOf(r.s, 'tidy_desk'), 6, 'below its Emulsion count: waits');
  assert.ok(r.quiet.includes('mover_and_shaker'), 'quiet climb, no pop-up storm');
  assert.equal(C.rankOf(45, C.gateOf(r.s).open).name, 'Emulsion');
  const again = run(r.s, [{ t: 'rename' }], T0 + DAY);
  assert.equal(again.gate, false, 'opens once');
});

test('idle time never counts toward the gate', () => {
  let s = C.empty();
  for (let d = 0; d < 400; d++) s = C.apply(s, { t: 'nav', drive: 'C:', depth: 1, files: 3 }, { now: T0 + d * DAY }).state;
  assert.equal(s.c.adays || 0, 0);
  assert.equal(C.gateOf(s).conds.find((c) => c.k === 'days').have, 0);
});

test('free mode: no paid tags or welcome badge anywhere', () => {
  assert.ok(!C.CATALOG.some((d) => /welcome|_pro$|^pro_/i.test(d.id) || d.pro));
});
