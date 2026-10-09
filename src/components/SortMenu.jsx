import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpDown, ChevronUp, ChevronDown, Check } from 'lucide-react';
import { SORT_KEYS } from '../utils/sortItems';

// Sort control for the breadcrumb bar: a small button that opens the same kind of menu as the folder right-click menu.
export default function SortMenu({ sort, onChange }) {
  const [anchor, setAnchor] = useState(null); // { right, top } of the open menu
  const buttonRef = useRef(null);
  const close = () => setAnchor(null);

  useEffect(() => {
    if (!anchor) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchor]);

  const toggle = () => {
    if (anchor) return close();
    const rect = buttonRef.current.getBoundingClientRect();
    setAnchor({ right: Math.max(4, window.innerWidth - rect.right), top: rect.bottom + 4 });
  };

  const choose = (change) => {
    onChange({ ...sort, ...change });
    close();
  };

  const current = SORT_KEYS.find((k) => k.key === sort.key) || SORT_KEYS[0];
  const Row = ({ checked, onClick, children }) => (
    <button className="context-menu-item" role="menuitemradio" aria-checked={checked} onClick={onClick}>
      <span className="context-menu-check">{checked && <Check size={12} />}</span>
      <span>{children}</span>
    </button>
  );

  return (
    <>
      <button
        ref={buttonRef}
        className={`sort-btn ${anchor ? 'open' : ''}`}
        onClick={toggle}
        title={`Sorted by ${current.label.toLowerCase()}, ${sort.dir === 1 ? 'ascending' : 'descending'}`}
        aria-label="Sort"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
      >
        <ArrowUpDown size={12} />
        <span>{current.label}</span>
        {sort.dir === 1 ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>

      {anchor && (
        <div
          className="context-menu-backdrop"
          onMouseDown={close}
          onContextMenu={(e) => {
            e.preventDefault();
            close();
          }}
        >
          <div
            className="context-menu"
            style={{ left: 'auto', right: anchor.right, top: anchor.top }}
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {SORT_KEYS.map((k) => (
              <Row key={k.key} checked={sort.key === k.key} onClick={() => choose({ key: k.key })}>
                {k.label}
              </Row>
            ))}
            <div className="context-menu-sep" role="separator" />
            <Row checked={sort.dir === 1} onClick={() => choose({ dir: 1 })}>
              Ascending
            </Row>
            <Row checked={sort.dir === -1} onClick={() => choose({ dir: -1 })}>
              Descending
            </Row>
            <div className="context-menu-sep" role="separator" />
            <Row checked={sort.foldersFirst} onClick={() => choose({ foldersFirst: !sort.foldersFirst })}>
              Folders first
            </Row>
          </div>
        </div>
      )}
    </>
  );
}
