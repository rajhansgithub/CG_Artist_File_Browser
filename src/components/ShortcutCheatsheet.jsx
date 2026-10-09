import React, { Fragment, useEffect, useRef, useState } from 'react';
import { SHORTCUT_GROUPS } from '../utils/shortcutList';
import { isTextEntryTarget } from '../utils/quickLook';
import '../styles/shortcut-cheatsheet.css';

// ? or F1 opens the list of shortcuts. While it is open it takes the keyboard: Esc, ? or F1 close it, and every
// other key stops here so the viewers and the grid underneath do not react to it.
const OPEN_KEYS = ['?', 'F1'];

export default function ShortcutCheatsheet() {
  const [isOpen, setIsOpen] = useState(false);
  const isOpenRef = useRef(false);
  isOpenRef.current = isOpen;

  useEffect(() => {
    // Capture phase on window, so this runs before the listeners of the viewers and the grid
    const onKeyDown = (e) => {
      if (isOpenRef.current) {
        // Ctrl / Alt / Meta combinations and Tab keep their usual meaning; plain keys must not press buttons behind
        if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key !== 'Tab') e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === 'Escape' || OPEN_KEYS.includes(e.key)) setIsOpen(false);
        return;
      }

      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      if (!OPEN_KEYS.includes(e.key) || isTextEntryTarget(e.target)) return;
      e.preventDefault();
      setIsOpen(true);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={() => setIsOpen(false)}>
      <div
        className="modal-card shortcut-cheatsheet-card"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span>Keyboard shortcuts</span>
          <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setIsOpen(false)} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body shortcut-cheatsheet-body">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="shortcut-group">
              <h3 className="shortcut-group-title">{group.title}</h3>
              {group.items.map((item, index) => (
                <div key={index} className="shortcut-row">
                  <span className="shortcut-action">{item.action}</span>
                  <span className="shortcut-keys">
                    {item.keys.map((combo, i) => (
                      <Fragment key={i}>
                        {i > 0 && <span className="shortcut-or">/</span>}
                        <span className="shortcut-combo">
                          {combo.map((key, j) => (
                            <Fragment key={j}>
                              {j > 0 && <span className="shortcut-plus">+</span>}
                              <kbd>{key}</kbd>
                            </Fragment>
                          ))}
                        </span>
                      </Fragment>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
