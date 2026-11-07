import React, { useEffect, useRef, useState } from 'react';
import {
  Layers,
  Box,
  SunMedium,
  Image as ImageIcon,
  Grid,
  Star,
  Film,
  Volume2,
  FileText,
  BookOpen,
  MoreHorizontal,
  Grid2x2,
  Grid3x3
} from 'lucide-react';
import { MIN_GRID_SIZE, MAX_GRID_SIZE } from '../utils/folderGridSize';

// Every kind of file the folder can be filtered to. `short` is the label in Simple mode.
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

// Kinds shown as buttons in Simple mode. The rest sit behind the "more" button (Pro shows them all).
const SIMPLE_KEYS = ['all', '3d', 'hdr', 'image', 'texture', 'video', 'audio'];

// The dock at the bottom of the folder: what kind of file to show, and how big the tiles are.
// In Pro every kind has its count, and a kind the folder has none of shrinks to its icon.
export default function FilterDock({
  uiMode,
  filterType,
  setFilterType,
  showFavoritesOnly,
  setShowFavoritesOnly,
  kindCounts,
  gridSize,
  onGridSizeChange,
  showZoom
}) {
  const pro = uiMode === 'pro';
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);

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

  useEffect(() => {
    if (pro) setMoreOpen(false);
  }, [pro]);

  const isActive = (key) => (key === 'favorites' ? showFavoritesOnly : filterType === key && !showFavoritesOnly);
  const pick = (entry) => {
    if (entry.key === 'favorites') {
      setShowFavoritesOnly(!showFavoritesOnly);
      return;
    }
    setFilterType(entry.key);
    setShowFavoritesOnly(false);
  };

  const button = (k) => {
    const Icon = k.icon;
    const active = isActive(k.key);
    const count = pro && k.key !== 'favorites' ? kindCounts?.[k.key] : null;
    // A count of 0 is known only for an unfiltered listing; unknown counts never shrink a button
    const empty = pro && count === 0 && !active;
    return (
      <button
        key={k.key}
        className={`dock-btn ${active ? 'active' : ''} ${empty ? 'empty' : ''}`}
        onClick={() => pick(k)}
        title={empty ? `${k.title}: none in this folder` : k.title}
        aria-label={k.label}
        aria-pressed={active}
      >
        <Icon size={15} fill={k.key === 'favorites' && showFavoritesOnly ? 'currentColor' : 'none'} />
        {!empty && <span>{pro ? k.label : k.short}</span>}
        {!empty && count != null && <em>{count}</em>}
      </button>
    );
  };

  const moreEntries = [...KINDS.filter((k) => !SIMPLE_KEYS.includes(k.key)), FAVORITES];
  const activeMore = moreEntries.find((k) => isActive(k.key));

  return (
    <div className="filter-dock" data-ui={uiMode} role="group" aria-label="Show only">
      {pro ? (
        [...KINDS, FAVORITES].map(button)
      ) : (
        <>
          {KINDS.filter((k) => SIMPLE_KEYS.includes(k.key)).map(button)}
          <div className="dock-more" ref={moreRef}>
            {activeMore ? (
              button(activeMore)
            ) : (
              <button
                className="dock-btn"
                onClick={() => setMoreOpen((open) => !open)}
                title="More filters: PDF, Markdown, Favorites"
                aria-label="More filters"
                aria-expanded={moreOpen}
              >
                <MoreHorizontal size={15} />
              </button>
            )}
            {moreOpen && (
              <div className="dock-popover" role="menu">
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
                      <Icon size={14} />
                      <span>{k.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {showZoom && (
        <>
          <span className="dock-sep" />
          <label className="dock-zoom" title="Tile size (Ctrl + mouse wheel)">
            <Grid3x3 size={13} />
            <input
              type="range"
              min={MIN_GRID_SIZE}
              max={MAX_GRID_SIZE}
              step={10}
              value={gridSize}
              onChange={(e) => onGridSizeChange(Number(e.target.value))}
              aria-label="Tile size"
            />
            <Grid2x2 size={13} />
          </label>
        </>
      )}
    </div>
  );
}
