import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { buildItemMenu } from '../utils/itemMenu';

// Right-click menu for files and folders (grid card, details row or sidebar entry). The entries come from buildItemMenu.
export default function ItemContextMenu({ x, y, items, actions, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu inside the window
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4))
    });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const entries = buildItemMenu(items, actions);

  return (
    <div
      className="context-menu-backdrop"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={ref}
        className="context-menu"
        style={pos}
        role="menu"
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {entries.map((entry, index) => {
          if (entry.separator) {
            return <div key={`sep-${index}`} className="context-menu-sep" role="separator" />;
          }
          const Icon = entry.icon;
          return (
            <button
              key={entry.id}
              className={`context-menu-item ${entry.danger ? 'danger' : ''}`}
              role="menuitem"
              disabled={entry.disabled}
              onClick={() => {
                onClose();
                entry.onSelect();
              }}
            >
              {Icon ? <Icon size={13} /> : <span className="context-menu-icon-gap" />}
              <span>{entry.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
