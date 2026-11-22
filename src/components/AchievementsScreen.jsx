import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { renderScreen, mountSettings, STRINGS } from '../achievements/ui.js';

// Achievements (docs/ACHIEVEMENTS.md). React only hosts the screen; src/achievements/ui.js draws it (plain DOM, so the live
// shaders mount the same way as everywhere else).

/** The full-window Achievements screen. Esc or ✕ closes it (a badge's full view closes first). */
export default function AchievementsScreen({ onClose }) {
  const paneRef = useRef(null);
  const closeRef = useRef(null);
  useEffect(() => renderScreen(paneRef.current), []);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.ach-view, .ach-moment, .ach-levelup')) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="ach-screen" role="dialog" aria-modal="true" aria-label={STRINGS.title}>
      <div className="ach-screen-bar">
        <h2>{STRINGS.title}</h2>
        <p>{STRINGS.sub}</p>
        <button ref={closeRef} type="button" className="ach-screen-x" onClick={onClose} aria-label={STRINGS.close} title={STRINGS.close}>
          <X size={16} />
        </button>
      </div>
      <div className="ach-screen-body" ref={paneRef} />
    </div>
  );
}

/** Settings > Achievements: pop-ups on/off, level-up on/off, the bubble's look with a live preview. */
export function AchievementSettings() {
  const boxRef = useRef(null);
  useEffect(() => mountSettings(boxRef.current), []);
  return <div ref={boxRef} />;
}
