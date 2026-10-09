import { useEffect, useRef, useState } from 'react';
import {
  QUICK_LOOK_ARROW_VIEWERS,
  QUICK_LOOK_SPACE_KEPT_VIEWERS,
  getAdjacentQuickLookItem,
  isQuickLookItem,
  isTextEntryTarget
} from '../utils/quickLook';

// A focused button would also be pressed when Space is released, so focus is dropped first
function dropButtonFocus(target) {
  if (target?.tagName === 'BUTTON' || target?.tagName === 'A') target.blur();
}

// Quick Look opens the selected file in the viewer it would normally get (openAsset), so nothing new is drawn.
// `blocked` is true while a dialog or the address box is open, and Quick Look then ignores the keys.
export function useQuickLook({ viewMode, setViewMode, openAsset, selectedAsset, gridSelection, items, blocked }) {
  const [active, setActive] = useState(false);
  const latest = useRef({});
  latest.current = { viewMode, setViewMode, openAsset, selectedAsset, gridSelection, items, blocked, active };

  // Leaving the viewer by any route (its own Esc or close button, Alt + arrows) ends Quick Look.
  // Also clears it again if the file could not be opened, so the grid is never left in a half state.
  useEffect(() => {
    if (viewMode === 'grid') setActive(false);
  }, [viewMode, active]);

  useEffect(() => {
    const onKeyDown = (e) => {
      const s = latest.current;
      if (s.blocked || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (isTextEntryTarget(e.target)) return;

      const isSpace = e.code === 'Space';

      if (s.viewMode === 'grid') {
        if (isSpace && !e.repeat && isQuickLookItem(s.gridSelection)) {
          e.preventDefault();
          dropButtonFocus(e.target);
          s.openAsset(s.gridSelection);
          setActive(true);
        }
        return;
      }

      if (!s.active) return;

      if (e.key === 'Escape') {
        // A viewer in full screen uses Esc to leave full screen first
        if (document.fullscreenElement) return;
        e.preventDefault();
        s.setViewMode('grid');
      } else if (isSpace) {
        if (e.repeat || QUICK_LOOK_SPACE_KEPT_VIEWERS.has(s.viewMode)) return;
        e.preventDefault();
        dropButtonFocus(e.target);
        s.setViewMode('grid');
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (!QUICK_LOOK_ARROW_VIEWERS.has(s.viewMode)) return;
        const next = getAdjacentQuickLookItem(s.items, s.selectedAsset, e.key === 'ArrowRight' ? 1 : -1);
        if (!next) return;
        e.preventDefault();
        s.openAsset(next);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
