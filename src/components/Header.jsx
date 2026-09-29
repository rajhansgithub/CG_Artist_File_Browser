import React from 'react';
import {
  Layers,
  Search,
  Box,
  SunMedium,
  Image as ImageIcon,
  Grid,
  Columns,
  LayoutGrid,
  Star,
  Settings,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Film,
  Volume2
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
        <span className="version-badge">v1.0.1</span>

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

      {/* Filter Type Pills */}
      <div className="filters-bar">
        <button
          className={`filter-btn ${filterType === 'all' && !showFavoritesOnly ? 'active' : ''}`}
          onClick={() => {
            setFilterType('all');
            setShowFavoritesOnly(false);
          }}
        >
          All
        </button>
        <button
          className={`filter-btn ${filterType === '3d' ? 'active' : ''}`}
          onClick={() => {
            setFilterType('3d');
            setShowFavoritesOnly(false);
          }}
        >
          <Box size={12} />
          3D Models
        </button>
        <button
          className={`filter-btn ${filterType === 'hdr' ? 'active' : ''}`}
          onClick={() => {
            setFilterType('hdr');
            setShowFavoritesOnly(false);
          }}
        >
          <SunMedium size={12} />
          HDR & EXR
        </button>
        <button
          className={`filter-btn ${filterType === 'image' ? 'active' : ''}`}
          onClick={() => {
            setFilterType('image');
            setShowFavoritesOnly(false);
          }}
        >
          <ImageIcon size={12} />
          Images
        </button>
        <button
          className={`filter-btn ${filterType === 'texture' ? 'active' : ''}`}
          onClick={() => {
            setFilterType('texture');
            setShowFavoritesOnly(false);
          }}
          title="Textures (.tif, .tiff, .tga, .dds)"
        >
          <Grid size={12} />
          Textures (TIFF)
        </button>
        <button
          className={`filter-btn ${filterType === 'video' ? 'active' : ''}`}
          onClick={() => {
            setFilterType('video');
            setShowFavoritesOnly(false);
          }}
          title="Videos & Playblasts (.mp4, .mov, .webm, .mkv)"
        >
          <Film size={12} />
          Videos
        </button>
        <button
          className={`filter-btn ${filterType === 'audio' ? 'active' : ''}`}
          onClick={() => {
            setFilterType('audio');
            setShowFavoritesOnly(false);
          }}
          title="Audio & Foley (.wav, .mp3, .ogg, .flac)"
        >
          <Volume2 size={12} />
          Audio
        </button>
        <button
          className={`filter-btn ${showFavoritesOnly ? 'active' : ''}`}
          onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
        >
          <Star size={12} fill={showFavoritesOnly ? '#ffffff' : 'none'} color={showFavoritesOnly ? '#ffffff' : 'currentColor'} />
          Favorites
        </button>
      </div>

      {/* View Mode & Utility Actions */}
      <div className="header-actions">
        <button
          className={`icon-btn ${viewMode === 'grid' ? 'active' : ''}`}
          onClick={() => setViewMode('grid')}
          title="Grid Gallery View"
        >
          <LayoutGrid size={14} />
        </button>
        <button
          className={`icon-btn ${viewMode === 'studio3d' ? 'active' : ''}`}
          onClick={() => setViewMode('studio3d')}
          title="3D Model Studio"
        >
          <Box size={14} />
        </button>
        <button
          className={`icon-btn ${viewMode === 'hdrexr' ? 'active' : ''}`}
          onClick={() => setViewMode('hdrexr')}
          title="HDR / EXR Studio Inspector"
        >
          <SunMedium size={14} />
        </button>
        <button
          className={`icon-btn ${viewMode === 'compare' ? 'active' : ''}`}
          onClick={() => setViewMode('compare')}
          title="Image Comparison"
        >
          <Columns size={14} />
        </button>

        <div style={{ width: 1, height: 18, background: 'var(--border-subtle)', margin: '0 2px' }} />

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
