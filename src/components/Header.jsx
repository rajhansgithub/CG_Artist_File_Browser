import React, { useState, useRef, useLayoutEffect } from 'react';
import { APP_VERSION } from '../version.js';
import {
  Layers,
  Search,
  Box,
  SunMedium,
  Image as ImageIcon,
  Grid,
  Star,
  Settings,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Film,
  Volume2,
  FileText,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react';

// Spare room (px) required beyond the bare minimum before the filter text is shown, so the
// labelled bar never crowds the search box.
const LABELS_FIT_MARGIN = 48;

export default function Header({
  searchTerm,
  setSearchTerm,
  filterType,
  setFilterType,
  viewMode,
  setViewMode,
  showFavoritesOnly,
  setShowFavoritesOnly,
  onOpenSettings,
  onOpenFolderPicker,
  sidebarCollapsed,
  onToggleSidebar
}) {
  // Filter labels: 'auto' shows the text next to each icon whenever the header has room
  // for it and icons only otherwise. The chevron button overrides that ('labels' or 'icons')
  // and the choice is persisted in localStorage.
  const [labelsMode, setLabelsMode] = useState(() => {
    try {
      const saved = localStorage.getItem('cg_filter_labels_mode');
      return saved === 'labels' || saved === 'icons' ? saved : 'auto';
    } catch {
      return 'auto';
    }
  });
  const [labelsFit, setLabelsFit] = useState(true);

  const headerRef = useRef(null);
  const logoRef = useRef(null);
  const searchRef = useRef(null);
  const actionsRef = useRef(null);
  const measureRef = useRef(null);

  // Works out whether the labelled filter bar fits next to the other header items. The width
  // of the labelled bar is read from a hidden copy, so it is known even while icons are shown.
  useLayoutEffect(() => {
    const header = headerRef.current;
    const measure = measureRef.current;
    if (!header || !measure) return undefined;

    const update = () => {
      const style = window.getComputedStyle(header);
      const gap = parseFloat(style.columnGap) || 0;
      const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const searchMin = parseFloat(window.getComputedStyle(searchRef.current).minWidth) || 0;
      const needed =
        logoRef.current.offsetWidth +
        searchMin +
        actionsRef.current.offsetWidth +
        measure.offsetWidth +
        gap * 3 +
        padding +
        LABELS_FIT_MARGIN;
      setLabelsFit(needed <= header.clientWidth);
    };

    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(header);
    observer.observe(measure);
    observer.observe(logoRef.current);
    return () => observer.disconnect();
  }, []);

  const showLabels = labelsMode === 'auto' ? labelsFit : labelsMode === 'labels';

  const handleToggleLabels = () => {
    // Flip what is on screen; picking what 'auto' would show goes back to 'auto'.
    const next = !showLabels;
    const mode = next === labelsFit ? 'auto' : next ? 'labels' : 'icons';
    setLabelsMode(mode);
    try {
      localStorage.setItem('cg_filter_labels_mode', mode);
    } catch (err) {
      console.error('Failed to save filter labels state:', err);
    }
  };

  const selectFilter = (type) => {
    setFilterType(type);
    setShowFavoritesOnly(false);
  };

  const filters = [
    { key: 'all', icon: <Layers size={13} />, label: 'All', name: 'All Files', title: 'All Files',
      active: filterType === 'all' && !showFavoritesOnly, onClick: () => selectFilter('all') },
    { key: '3d', icon: <Box size={13} />, label: '3D Models', name: '3D Models',
      title: '3D Models (.obj, .fbx, .gltf, .glb, .stl, .ply, .usd, .abc)',
      active: filterType === '3d', onClick: () => selectFilter('3d') },
    { key: 'hdr', icon: <SunMedium size={13} />, label: 'HDR & EXR', name: 'HDR & EXR',
      title: 'HDR & EXR Environment Maps (.hdr, .exr)',
      active: filterType === 'hdr', onClick: () => selectFilter('hdr') },
    { key: 'image', icon: <ImageIcon size={13} />, label: 'Images', name: 'Images',
      title: 'Images (.png, .jpg, .webp, .bmp)',
      active: filterType === 'image', onClick: () => selectFilter('image') },
    { key: 'texture', icon: <Grid size={13} />, label: 'Textures (TIFF)', name: 'Textures',
      title: 'Textures (.tif, .tiff, .tga, .dds, .psd, .tx, .tex)',
      active: filterType === 'texture', onClick: () => selectFilter('texture') },
    { key: 'video', icon: <Film size={13} />, label: 'Videos', name: 'Videos',
      title: 'Videos & Playblasts (.mp4, .mov, .webm, .mkv)',
      active: filterType === 'video', onClick: () => selectFilter('video') },
    { key: 'audio', icon: <Volume2 size={13} />, label: 'Audio', name: 'Audio',
      title: 'Audio & Foley (.wav, .mp3, .ogg, .flac)',
      active: filterType === 'audio', onClick: () => selectFilter('audio') },
    { key: 'pdf', icon: <FileText size={13} />, label: 'PDF', name: 'PDF',
      title: 'PDF Documents (.pdf)',
      active: filterType === 'pdf', onClick: () => selectFilter('pdf') },
    { key: 'favorites', label: 'Favorites', name: 'Favorites', title: 'Starred Favorites',
      icon: (
        <Star size={13} fill={showFavoritesOnly ? 'currentColor' : 'none'} color="currentColor" />
      ),
      active: showFavoritesOnly, onClick: () => setShowFavoritesOnly(!showFavoritesOnly) }
  ];

  const renderFilterButtons = (withLabels, interactive) =>
    filters.map((f) => (
      <button
        key={f.key}
        className={`filter-btn ${!withLabels ? 'icon-only' : ''} ${interactive && f.active ? 'active' : ''}`}
        onClick={interactive ? f.onClick : undefined}
        title={interactive ? f.title : undefined}
        aria-label={interactive ? f.name : undefined}
        tabIndex={interactive ? undefined : -1}
      >
        {f.icon}
        {withLabels && <span>{f.label}</span>}
      </button>
    ));

  return (
    <header className="app-header" ref={headerRef}>
      {/* Brand logo, Sidebar Toggle & Open button */}
      <div className="logo-section" ref={logoRef}>
        <button
          className="icon-btn"
          style={{ width: 28, height: 28 }}
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>

        <div className="logo-badge">
          <Layers size={15} />
        </div>
        <span>CG ARTIST FILE BROWSER</span>
        <span className="version-badge">{APP_VERSION}</span>

        <button
          className="filter-btn"
          style={{ marginLeft: 6 }}
          onClick={onOpenFolderPicker}
          title="Open Folder..."
        >
          <FolderOpen size={13} />
          <span>Open Folder</span>
        </button>
      </div>

      {/* Global search */}
      <div className="search-wrapper" ref={searchRef}>
        <Search size={14} className="search-icon" />
        <input
          type="text"
          className="search-input"
          placeholder="Filter 3D, HDR, Video (.mp4), Audio (.wav), PDF..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && (
          <button
            onClick={() => setSearchTerm('')}
            style={{
              position: 'absolute',
              right: 10,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 13
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Filter Type Pills (icon + text when there is room, icons only when there is not) */}
      <div className="filters-bar">
        {renderFilterButtons(showLabels, true)}

        {/* Manual override: show or hide the text labels */}
        <button
          className={`filter-expand-btn ${showLabels ? 'expanded' : ''}`}
          onClick={handleToggleLabels}
          title={showLabels ? 'Collapse filter labels (Show icons only)' : 'Expand filter labels (Show icons & text)'}
          aria-label={showLabels ? 'Collapse filter labels' : 'Expand filter labels'}
        >
          {showLabels ? <ChevronsLeft size={13} /> : <ChevronsRight size={13} />}
        </button>
      </div>

      {/* Hidden copy of the labelled bar, only used to measure how much room the labels need */}
      <div className="filters-measure" aria-hidden="true">
        <div className="filters-bar" ref={measureRef}>
          {renderFilterButtons(true, false)}
          <span className="filter-expand-btn" />
        </div>
      </div>

      {/* Utility Actions */}
      <div className="header-actions" ref={actionsRef}>
        <button
          className="icon-btn"
          onClick={onOpenSettings}
          title="Studio Preferences & Configuration"
        >
          <Settings size={14} />
        </button>
      </div>
    </header>
  );
}
