import React, { useState } from 'react';
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
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react';

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
  // Collapsible filter labels state: default false (icons only), persisted in localStorage
  const [expandFilterLabels, setExpandFilterLabels] = useState(() => {
    try {
      return localStorage.getItem('cg_filter_labels_expanded') === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleExpandLabels = () => {
    setExpandFilterLabels((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('cg_filter_labels_expanded', String(next));
      } catch (err) {
        console.error('Failed to save filter labels expansion state:', err);
      }
      return next;
    });
  };

  return (
    <header className="app-header">
      {/* Brand logo, Sidebar Toggle & Open button */}
      <div className="logo-section">
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
        <span className="version-badge">v1.0.4</span>

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
      <div className="search-wrapper">
        <Search size={14} className="search-icon" />
        <input
          type="text"
          className="search-input"
          placeholder="Filter 3D, HDR, Video (.mp4), Audio (.wav)..."
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

      {/* Filter Type Pills (Collapsible: Icons only by default, expandable to Icons + Text) */}
      <div className="filters-bar">
        <button
          className={`filter-btn ${!expandFilterLabels ? 'icon-only' : ''} ${filterType === 'all' && !showFavoritesOnly ? 'active' : ''}`}
          onClick={() => {
            setFilterType('all');
            setShowFavoritesOnly(false);
          }}
          title="All Files"
          aria-label="All Files"
        >
          <Layers size={13} />
          {expandFilterLabels && <span>All</span>}
        </button>

        <button
          className={`filter-btn ${!expandFilterLabels ? 'icon-only' : ''} ${filterType === '3d' ? 'active' : ''}`}
          onClick={() => {
            setFilterType('3d');
            setShowFavoritesOnly(false);
          }}
          title="3D Models (.obj, .fbx, .gltf, .glb, .stl, .ply, .usd, .abc)"
          aria-label="3D Models"
        >
          <Box size={13} />
          {expandFilterLabels && <span>3D Models</span>}
        </button>

        <button
          className={`filter-btn ${!expandFilterLabels ? 'icon-only' : ''} ${filterType === 'hdr' ? 'active' : ''}`}
          onClick={() => {
            setFilterType('hdr');
            setShowFavoritesOnly(false);
          }}
          title="HDR & EXR Environment Maps (.hdr, .exr)"
          aria-label="HDR & EXR"
        >
          <SunMedium size={13} />
          {expandFilterLabels && <span>HDR & EXR</span>}
        </button>

        <button
          className={`filter-btn ${!expandFilterLabels ? 'icon-only' : ''} ${filterType === 'image' ? 'active' : ''}`}
          onClick={() => {
            setFilterType('image');
            setShowFavoritesOnly(false);
          }}
          title="Images (.png, .jpg, .webp, .bmp)"
          aria-label="Images"
        >
          <ImageIcon size={13} />
          {expandFilterLabels && <span>Images</span>}
        </button>

        <button
          className={`filter-btn ${!expandFilterLabels ? 'icon-only' : ''} ${filterType === 'texture' ? 'active' : ''}`}
          onClick={() => {
            setFilterType('texture');
            setShowFavoritesOnly(false);
          }}
          title="Textures (.tif, .tiff, .tga, .dds, .psd)"
          aria-label="Textures"
        >
          <Grid size={13} />
          {expandFilterLabels && <span>Textures (TIFF)</span>}
        </button>

        <button
          className={`filter-btn ${!expandFilterLabels ? 'icon-only' : ''} ${filterType === 'video' ? 'active' : ''}`}
          onClick={() => {
            setFilterType('video');
            setShowFavoritesOnly(false);
          }}
          title="Videos & Playblasts (.mp4, .mov, .webm, .mkv)"
          aria-label="Videos"
        >
          <Film size={13} />
          {expandFilterLabels && <span>Videos</span>}
        </button>

        <button
          className={`filter-btn ${!expandFilterLabels ? 'icon-only' : ''} ${filterType === 'audio' ? 'active' : ''}`}
          onClick={() => {
            setFilterType('audio');
            setShowFavoritesOnly(false);
          }}
          title="Audio & Foley (.wav, .mp3, .ogg, .flac)"
          aria-label="Audio"
        >
          <Volume2 size={13} />
          {expandFilterLabels && <span>Audio</span>}
        </button>

        <button
          className={`filter-btn ${!expandFilterLabels ? 'icon-only' : ''} ${showFavoritesOnly ? 'active' : ''}`}
          onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
          title="Starred Favorites"
          aria-label="Favorites"
        >
          <Star
            size={13}
            fill={showFavoritesOnly ? 'currentColor' : 'none'}
            color="currentColor"
          />
          {expandFilterLabels && <span>Favorites</span>}
        </button>

        {/* Collapsible toggle button */}
        <button
          className={`filter-expand-btn ${expandFilterLabels ? 'expanded' : ''}`}
          onClick={handleToggleExpandLabels}
          title={expandFilterLabels ? 'Collapse filter labels (Show icons only)' : 'Expand filter labels (Show icons & text)'}
          aria-label={expandFilterLabels ? 'Collapse filter labels' : 'Expand filter labels'}
        >
          {expandFilterLabels ? <ChevronsLeft size={13} /> : <ChevronsRight size={13} />}
        </button>
      </div>

      {/* Utility Actions */}
      <div className="header-actions">
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
