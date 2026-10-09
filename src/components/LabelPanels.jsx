import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tag, X } from 'lucide-react';
import { LABEL_COLORS, isLabelFilterActive, EMPTY_LABEL_FILTER } from '../utils/fileLabelStore';

const PANEL_WIDTH = 232;
const PANEL_GAP = 6;
const PANEL_EDGE = 8;
const TAG_MAX_CHARS = 24;

// An anchor is a button, or a point { x, y } (the spot a right-click menu was opened on)
function anchorRect(anchor) {
  if (anchor.getBoundingClientRect) return anchor.getBoundingClientRect();
  return { left: anchor.x, right: anchor.x + PANEL_WIDTH, top: anchor.y, bottom: anchor.y };
}

// Keeps a floating panel under its anchor button (above it when there is no room), inside the window
function usePanelPosition(anchor, panelRef) {
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    const place = () => {
      if (!anchor || !panelRef.current) return;
      const r = anchorRect(anchor);
      const height = panelRef.current.offsetHeight;
      const left = Math.min(Math.max(PANEL_EDGE, r.right - PANEL_WIDTH), window.innerWidth - PANEL_WIDTH - PANEL_EDGE);
      let top = r.bottom + PANEL_GAP;
      if (top + height > window.innerHeight - PANEL_EDGE) top = Math.max(PANEL_EDGE, r.top - height - PANEL_GAP);
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, panelRef]);

  return pos;
}

// Closes an open panel on a click outside it and its anchor, on Escape, and when the grid scrolls under it
function useDismiss(enabled, anchor, panelRef, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!enabled) return undefined;
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || anchor?.contains?.(e.target)) return;
      closeRef.current();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') closeRef.current();
    };
    const onScroll = () => closeRef.current();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [enabled, anchor, panelRef]);
}

function ColorRow({ activeColors, onPick, onClear }) {
  return (
    <div className="label-swatches">
      <button
        className={`label-swatch label-swatch-none ${activeColors.length === 0 ? 'active' : ''}`}
        onClick={onClear}
        title="No colour"
        aria-label="No colour"
      >
        <X size={10} />
      </button>
      {LABEL_COLORS.map((c) => (
        <button
          key={c.id}
          className={`label-swatch ${activeColors.includes(c.id) ? 'active' : ''}`}
          style={{ background: c.hex }}
          onClick={() => onPick(c.id)}
          title={c.name}
          aria-label={c.name}
          aria-pressed={activeColors.includes(c.id)}
        />
      ))}
    </div>
  );
}

// Colour and tags of one file, opened from its card
export function FileLabelPopover({ anchor, label, onSetColor, onAddTag, onRemoveTag, onClose }) {
  const panelRef = useRef(null);
  const [draft, setDraft] = useState('');
  const pos = usePanelPosition(anchor, panelRef);
  useDismiss(true, anchor, panelRef, onClose);

  useEffect(() => {
    panelRef.current?.querySelector('input')?.focus();
  }, []);

  const submitTag = () => {
    const tag = draft.trim();
    setDraft('');
    if (tag) onAddTag(tag);
  };

  const panel = (
    <div
      ref={panelRef}
      className="label-panel"
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      // Clicks here belong to the panel, not to the card it was opened from
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="label-panel-title">Colour</div>
      <ColorRow
        activeColors={label.color ? [label.color] : []}
        onPick={(id) => onSetColor(label.color === id ? null : id)}
        onClear={() => onSetColor(null)}
      />

      <div className="label-panel-title">Tags</div>
      {label.tags.length > 0 && (
        <div className="label-tag-list">
          {label.tags.map((tag) => (
            <span key={tag} className="label-tag">
              {tag}
              <button onClick={() => onRemoveTag(tag)} title={`Remove tag ${tag}`} aria-label={`Remove tag ${tag}`}>
                <X size={9} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className="label-tag-input"
        placeholder="Add a tag and press Enter"
        value={draft}
        maxLength={TAG_MAX_CHARS}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitTag();
          }
        }}
        onBlur={submitTag}
      />
    </div>
  );

  return createPortal(panel, document.body);
}

// Button in the header that filters the grid by colour and tags
export function LabelFilterMenu({ filter, setFilter, tags }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const panelRef = useRef(null);
  const active = isLabelFilterActive(filter);
  const pos = usePanelPosition(open ? anchor : null, panelRef);
  useDismiss(open, anchor, panelRef, () => setOpen(false));

  const toggle = (list, value) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const panel = open
    ? createPortal(
        <div
          ref={panelRef}
          className="label-panel"
          style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}
        >
          <div className="label-panel-title">Show files with colour</div>
          <ColorRow
            activeColors={filter.colors}
            onPick={(id) => setFilter({ ...filter, colors: toggle(filter.colors, id) })}
            onClear={() => setFilter({ ...filter, colors: [] })}
          />

          <div className="label-panel-title">Show files with tags</div>
          {tags.length === 0 ? (
            <div className="label-panel-empty">No tags yet. Add one from a file's label button.</div>
          ) : (
            <div className="label-tag-list">
              {tags.map((tag) => {
                const on = filter.tags.includes(tag);
                return (
                  <button
                    key={tag}
                    className={`label-tag label-tag-toggle ${on ? 'active' : ''}`}
                    aria-pressed={on}
                    onClick={() => setFilter({ ...filter, tags: toggle(filter.tags, tag) })}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          )}

          {active && (
            <button className="label-panel-clear" onClick={() => setFilter(EMPTY_LABEL_FILTER)}>
              Clear label filter
            </button>
          )}
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <button
        ref={setAnchor}
        className={`icon-btn label-filter-btn ${active ? 'active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Filter by colour and tags"
        aria-label="Filter by colour and tags"
        aria-expanded={open}
      >
        <Tag size={14} />
        {active && <span className="label-filter-dot" />}
      </button>
      {panel}
    </>
  );
}
