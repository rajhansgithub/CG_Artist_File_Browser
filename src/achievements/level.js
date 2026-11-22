/**
 * The level and rank, for the side rail pill (docs/ACHIEVEMENTS.md). Small on purpose: the rail loads with the app, while
 * the screen, the pop-ups and the shaders (ui.js) load a moment later, on their own.
 */
import { useEffect, useState } from 'react';
import * as Core from './core.js';
import { getState, subscribe } from './observer.js';
import './pill.css';

/** { level, title, xp, into, need, rank: { m, name }, metal } */
export function levelInfo(s) {
  const st = s || getState();
  const xp = Core.totalXp(st);
  const lv = Core.levelOf(xp);
  const rank = Core.rankOf(lv.level, !!st.g);
  return { level: lv.level, title: lv.title, xp, into: lv.into, need: lv.need, rank, metal: Core.METALS[rank.m - 1] || rank.name };
}

/** The level info, kept current. */
export function useAchievementLevel() {
  const [info, setInfo] = useState(() => levelInfo(getState()));
  useEffect(() => subscribe((s) => setInfo(levelInfo(s))), []);
  return info;
}
