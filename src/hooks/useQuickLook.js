import { useEffect, useRef } from 'react';
import { isQuickLookItem, isTextEntryTarget } from '../utils/quickLook';

// A focused button would also be pressed when Space is released, so focus is dropped first
function dropButtonFocus(target) {
  if (target?.tagName === 'BUTTON' || target?.tagName === 'A') target.blur();
}

// Space opens the floating Quick Look window for the selected file, and Space or Esc closes it.
// Enter drops the window and lets the grid open the file as usual. Arrow keys are left to the grid, which moves the
// selection and the window follows it (see QuickLookWindow). Keys go through the capture phase, so they are handled
// before the viewers' and the grid's own listeners on window. `blocked` is true while a dialog or the address box is
// open, and then the keys are left alone.
export function useQuickLook({ viewMode, previewOpen, setPreviewOpen, selectedAsset, blocked }) {
  const latest = useRef({});
  latest.current = { viewMode, previewOpen, setPreviewOpen, selectedAsset, blocked };

  useEffect(() => {
    const onKeyDown = (e) => {
      const s = latest.current;
      if (s.blocked || s.viewMode !== 'grid' || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (isTextEntryTarget(e.target)) return;

      const isSpace = e.code === 'Space';

      if (s.previewOpen) {
        if (e.key === 'Enter') {
          s.setPreviewOpen(false);
        } else if (isSpace || (e.key === 'Escape' && !document.fullscreenElement)) {
          // A viewer in full screen uses Esc to leave full screen first
          e.preventDefault();
          e.stopImmediatePropagation();
          dropButtonFocus(e.target);
          if (!e.repeat) s.setPreviewOpen(false);
        }
      } else if (isSpace && !e.repeat && isQuickLookItem(s.selectedAsset)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        dropButtonFocus(e.target);
        s.setPreviewOpen(true);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
