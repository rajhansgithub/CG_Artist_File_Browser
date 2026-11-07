import React, { useState, useRef, useEffect } from 'react';
import { LabelFilterMenu } from './LabelPanels';
import {
  Layers,
  Search,
  Box,
  SunMedium,
  Image as ImageIcon,
  Grid,
  Star,
  Film,
  Volume2,
  FileText,
  BookOpen,
  RefreshCw,
  MoreHorizontal,
  X
} from 'lucide-react';

// Every kind of file the folder can be filtered to. `short` is the label in the Simple toolbar.
const KINDS = [
  { key: 'all', icon: Layers, label: 'All', short: 'All', title: 'All Files' },
  { key: '3d', icon: Box, label: '3D Models', short: '3D', title: '3D Models (.obj, .fbx, .gltf, .glb, .stl, .ply, .usd, .abc)' },
  { key: 'hdr', icon: SunMedium, label: 'HDR & EXR', short: 'HDR', title: 'HDR & EXR Environment Maps (.hdr, .exr)' },
  { key: 'image', icon: ImageIcon, label: 'Images', short: 'Images', title: 'Images (.png, .jpg, .webp, .bmp)' },
  { key: 'texture', icon: Grid, label: 'Textures', short: 'Textures', title: 'Textures (.tif, .tiff, .tga, .dds, .psd, .tx, .tex)' },
  { key: 'video', icon: Film, label: 'Videos', short: 'Video', title: 'Videos & Playblasts (.mp4, .mov, .webm, .mkv)' },
  { key: 'audio', icon: Volume2, label: 'Audio', short: 'Audio', title: 'Audio & Foley (.wav, .mp3, .ogg, .flac)' },
  { key: 'pdf', icon: FileText, label: 'PDF', short: 'PDF', title: 'PDF Documents (.pdf)' },
  { key: 'markdown', icon: BookOpen, label: 'Markdown', short: 'Markdown', title: 'Markdown documents (.md, .markdown)' }
];
const FAVORITES = { key: 'favorites', icon: Star, label: 'Favorites', short: 'Favorites', title: 'Starred Favorites' };

// Kinds shown as buttons in the Simple toolbar. The rest sit behind the "more" button (Pro mode shows them all).
const SIMPLE_KEYS = ['all', '3d', 'hdr', 'image', 'texture', 'video', 'audio'];

export const UI_MODES = [
  { id: 'simple', label: 'Simple', title: 'Simple: a clean toolbar and a slim side rail' },
  { id: 'pro', label: 'Pro', title: 'Pro: every filter with counts, the full sidebar and the status line' }
];

export default function Header({
  searchTerm,
  setSearchTerm,
  filterType,
  setFilterType,
  showFavoritesOnly,
  setShowFavoritesOnly,
  labelFilter,
  setLabelFilter,
  labelTags,
  onRefreshFolder,
  isRefreshing,
  searchInputRef,
  uiMode,
  onChangeUiMode,
  kindCounts,
  navNode,
  toolsNode
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const pro = uiMode === 'pro';

  useEffect(() => {
    if (!moreOpen) return undefined;
    const close = (e) => {
      if (e.type === 'keydown') {
        if (e.key === 'Escape') setMoreOpen(false);
      } else if (moreRef.current && !moreRef.current.contains(e.target)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [moreOpen]);

  const selectKind = (key) => {
    setFilterType(key);
    setShowFavoritesOnly(false);
  };
  const isActive = (key) => (key === 'favorites' ? showFavoritesOnly : filterType === key && !showFavoritesOnly);
  const pick = (entry) => (entry.key === 'favorites' ? setShowFavoritesOnly(!showFavoritesOnly) : selectKind(entry.key));

  const moreEntries = [...KINDS.filter((k) => !SIMPLE_KEYS.includes(k.key)), FAVORITES];
  const activeMore = moreEntries.find((k) => isActive(k.key));

  return (
    <div className="topbar-area">
      <header className="topbar" data-ui={uiMode}>
        <div className="tb-nav">{navNode}</div>

        {!pro && (
          <div className="tb-kinds" role="group" aria-label="Show only">
            {KINDS.filter((k) => SIMPLE_KEYS.includes(k.key)).map((k) => (
              <button
                key={k.key}
                className={`seg-btn ${isActive(k.key) ? 'active' : ''}`}
                onClick={() => pick(k)}
                title={k.title}
                aria-pressed={isActive(k.key)}
              >
                {k.short}
              </button>
            ))}
            <div className="tb-more" ref={moreRef}>
              <button
                className={`seg-btn ${activeMore ? 'active' : ''}`}
                onClick={() => setMoreOpen((open) => !open)}
                title="More filters: PDF, Markdown, Favorites"
                aria-label="More filters"
                aria-expanded={moreOpen}
              >
                {activeMore ? activeMore.short : <MoreHorizontal size={14} />}
              </button>
              {moreOpen && (
                <div className="tb-popover" role="menu">
                  {moreEntries.map((k) => {
                    const Icon = k.icon;
                    return (
                      <button
                        key={k.key}
                        role="menuitemradio"
                        aria-checked={isActive(k.key)}
                        className={`tb-popover-item ${isActive(k.key) ? 'active' : ''}`}
                        onClick={() => {
                          pick(k);
                          setMoreOpen(false);
                        }}
                        title={k.title}
                      >
                        <Icon size={14} fill={k.key === 'favorites' && showFavoritesOnly ? 'currentColor' : 'none'} />
                        <span>{k.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="tb-tools">
          {toolsNode}
          <LabelFilterMenu filter={labelFilter} setFilter={setLabelFilter} tags={labelTags} />
          {pro && (
            <button
              className="icon-btn"
              onClick={onRefreshFolder}
              style={isRefreshing ? { animation: 'spin 0.8s linear infinite' } : undefined}
              title="Refresh this folder (F5 or Ctrl+R)"
              aria-label="Refresh this folder"
            >
              <RefreshCw size={14} />
            </button>
          )}
        </div>

        <div className="tb-search">
          <Search size={14} className="tb-search-icon" />
          <input
            type="text"
            ref={searchInputRef}
            className="tb-search-input"
            placeholder="Search"
            title="Search this folder (Ctrl+F)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button className="tb-search-clear" onClick={() => setSearchTerm('')} aria-label="Clear search">
              <X size={12} />
            </button>
          )}
        </div>

        <div className="mode-switch" role="group" aria-label="Interface mode">
          {UI_MODES.map((m) => (
            <button
              key={m.id}
              className={`mode-btn ${uiMode === m.id ? 'active' : ''}`}
              onClick={() => onChangeUiMode(m.id)}
              title={m.title}
              aria-pressed={uiMode === m.id}
            >
              {m.label}
            </button>
          ))}
        </div>
      </header>

      {pro && (
        <div className="filter-strip" role="group" aria-label="Show only">
          {[...KINDS, FAVORITES].map((k) => {
            const Icon = k.icon;
            const count = k.key === 'favorites' ? null : kindCounts?.[k.key];
            return (
              <button
                key={k.key}
                className={`strip-btn ${isActive(k.key) ? 'active' : ''}`}
                onClick={() => pick(k)}
                title={k.title}
                aria-pressed={isActive(k.key)}
              >
                <Icon size={13} fill={k.key === 'favorites' && showFavoritesOnly ? 'currentColor' : 'none'} />
                <span>{k.label}</span>
                {count != null && <em>{count}</em>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
