import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ImagePlus, RotateCcw } from 'lucide-react';

// Right-click menu for a folder (grid card, details row or sidebar entry).
export default function FolderContextMenu({ x, y, hasChoice, onChangeIcon, onResetIcon, onClose }) {
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
        <button className="context-menu-item" role="menuitem" onClick={onChangeIcon}>
          <ImagePlus size={13} />
          <span>Change icon…</span>
        </button>
        {hasChoice && (
          <button className="context-menu-item" role="menuitem" onClick={onResetIcon}>
            <RotateCcw size={13} />
            <span>Use default icon</span>
          </button>
        )}
      </div>
    </div>
  );
}
