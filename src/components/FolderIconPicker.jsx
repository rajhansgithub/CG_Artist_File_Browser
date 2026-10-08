import React, { useEffect, useMemo, useState } from 'react';
import { X, Search, Plus, RotateCcw } from 'lucide-react';
import { FOLDER_ICON_GROUPS } from '../utils/folderIconLibrary';
import { normalizeFolderKey } from '../utils/folderIconStore';

function Tile({ label, selected, onClick, onRemove, children }) {
  return (
    <div className={`icon-tile-wrap ${selected ? 'selected' : ''}`}>
      <button className={`icon-tile ${selected ? 'selected' : ''}`} onClick={onClick} title={label}>
        {children}
        <span className="icon-tile-label">{label}</span>
      </button>
      {onRemove && (
        <button className="icon-tile-remove" onClick={onRemove} title="Remove from my icons" aria-label={`Remove ${label}`}>
          <X size={10} />
        </button>
      )}
    </div>
  );
}

// "Change icon" dialog: library icons by category, the user's imported icons, search, reset.
export default function FolderIconPicker({ item, store, onClose }) {
  const [query, setQuery] = useState('');
  const current = store.assignments[normalizeFolderKey(item.path)] || null;

  useEffect(() => {
    store.clearError();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!q) return FOLDER_ICON_GROUPS;
    return FOLDER_ICON_GROUPS.map((g) => ({
      ...g,
      icons: g.icons.filter((i) => `${i.label} ${i.words} ${g.title}`.toLowerCase().includes(q))
    })).filter((g) => g.icons.length > 0);
  }, [q]);
  const custom = q ? store.custom.filter((c) => c.name.toLowerCase().includes(q)) : store.custom;

  const choose = async (icon) => {
    if (await store.setIcon(item.path, icon)) onClose();
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-card icon-picker" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Change icon">
        <div className="modal-header">
          <div style={{ minWidth: 0 }}>
            <div>Change icon</div>
            <div className="icon-picker-sub" title={item.path}>
              {item.name}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close" style={{ width: 26, height: 26 }}>
            <X size={14} />
          </button>
        </div>

        <div className="icon-picker-search">
          <Search size={13} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search icons (hdri, music, scripts...)"
            spellCheck={false}
          />
        </div>

        <div className="modal-body icon-picker-body">
          {store.error && <div className="icon-picker-error">{store.error}</div>}

          <section>
            <div className="icon-section-title">
              <span>MY ICONS</span>
              <button className="icon-import-btn" onClick={store.importIcons} title="Add your own PNG, SVG, ICO, WebP or JPG icons (software logos, studio marks...)">
                <Plus size={11} /> Import icons…
              </button>
            </div>
            {custom.length > 0 ? (
              <div className="icon-tile-grid">
                {custom.map((c) => (
                  <Tile
                    key={c.id}
                    label={c.name}
                    selected={current === `custom:${c.id}`}
                    onClick={() => choose(`custom:${c.id}`)}
                    onRemove={() => store.removeCustomIcon(c.id)}
                  >
                    <img src={c.url} alt="" draggable={false} className="icon-tile-image" />
                  </Tile>
                ))}
              </div>
            ) : (
              !q && (
                <div className="icon-picker-empty">
                  Import your own PNG, SVG or ICO images (for example a software logo) and they appear here.
                </div>
              )
            )}
          </section>

          {groups.map((g) => (
            <section key={g.title}>
              <div className="icon-section-title">
                <span>{g.title.toUpperCase()}</span>
              </div>
              <div className="icon-tile-grid">
                {g.icons.map((i) => {
                  const Icon = i.Icon;
                  return (
                    <Tile key={i.id} label={i.label} selected={current === `lib:${i.id}`} onClick={() => choose(`lib:${i.id}`)}>
                      <Icon size={22} strokeWidth={1.5} />
                    </Tile>
                  );
                })}
              </div>
            </section>
          ))}

          {q && groups.length === 0 && custom.length === 0 && (
            <div className="icon-picker-empty">No icons match “{query}”.</div>
          )}
        </div>

        <div className="modal-footer icon-picker-footer">
          <span className="icon-picker-location" title={store.location}>
            {store.location ? `Saved in ${store.location}` : ''}
          </span>
          <button className="btn-secondary" onClick={() => choose(null)} disabled={!current} style={!current ? { opacity: 0.4, cursor: 'default' } : undefined}>
            <RotateCcw size={11} style={{ marginRight: 5, verticalAlign: -1 }} />
            Use default icon
          </button>
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
