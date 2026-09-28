import React from 'react';
import {
  HardDrive,
  Folder,
  Star,
  ChevronRight,
  RefreshCw,
  Box,
  SunMedium,
  Image as ImageIcon,
  Film,
  Volume2
} from 'lucide-react';

export default function Sidebar({
  drives,
  currentPath,
  onNavigate,
  favorites,
  folderItems,
  blenderStatus,
  onOpenSettings,
  onRefresh,
  collapsed
}) {
  const folders = (folderItems || []).filter((item) => item.isDirectory);
  const starredFolders = (favorites || []).filter((item) => item.isDirectory);
  const favoriteFiles = (favorites || []).filter((item) => !item.isDirectory);
  const modelCount = (folderItems || []).filter((i) => i.category === '3d').length;
  const hdrCount = (folderItems || []).filter((i) => i.category === 'hdr').length;
  const imageCount = (folderItems || []).filter((i) => i.category === 'image').length;
  const textureCount = (folderItems || []).filter((i) => i.category === 'texture').length;
  const videoCount = (folderItems || []).filter((i) => i.category === 'video').length;
  const audioCount = (folderItems || []).filter((i) => i.category === 'audio').length;

  if (collapsed) {
    return null;
  }

  return (
    <aside className="sidebar">
      {/* Drives Section */}
      <div>
        <div className="sidebar-section-title">
          <span>DRIVES & VOLUMES</span>
          <button
            onClick={onRefresh}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            title="Refresh drives"
          >
            <RefreshCw size={11} />
          </button>
        </div>
        <div className="drives-grid">
          {drives.map((d) => {
            const isSelected = currentPath && currentPath.toUpperCase().startsWith(d.mount.toUpperCase());
            return (
              <div
                key={d.mount}
                className={`drive-card ${isSelected ? 'active' : ''}`}
                onClick={() => onNavigate(d.name)}
                title={`${d.label} (${d.mount})`}
              >
                <div className="drive-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <HardDrive size={12} color="var(--text-secondary)" />
                    <span>{d.mount}</span>
                  </div>
                </div>
                {d.freeGB && d.totalGB ? (
                  <span className="drive-free">{d.freeGB} GB free</span>
                ) : (
                  <span className="drive-free">Local Disk</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pinned Folders Section */}
      {starredFolders.length > 0 && (
        <div>
          <div className="sidebar-section-title">
            <span>PINNED FOLDERS</span>
            <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>{starredFolders.length}</span>
          </div>
          <div className="nav-list">
            {starredFolders.map((sf) => (
              <div
                key={sf.path}
                className="nav-item"
                onClick={() => onNavigate(sf.path, false)}
                title={sf.path}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Folder size={13} color="#ffffff" strokeWidth={2} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {sf.name}
                </span>
                <button
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(sf);
                  }}
                  title="Unpin folder"
                >
                  <Star size={11} fill="#ffffff" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Favorite Assets Section */}
      {favoriteFiles.length > 0 && (
        <div>
          <div className="sidebar-section-title">
            <span>STARRED ASSETS</span>
            <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>{favoriteFiles.length}</span>
          </div>
          <div className="nav-list">
            {favoriteFiles.slice(0, 10).map((fav) => (
              <div
                key={fav.path}
                className="nav-item"
                onClick={() => onNavigate(fav.path, true)}
                title={fav.path}
              >
                <Star size={12} fill="#ffffff" color="#ffffff" />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {fav.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Current Folder Subdirectories */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="sidebar-section-title">
          <span>SUBFOLDERS</span>
          <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>{folders.length}</span>
        </div>
        <div className="nav-list" style={{ overflowY: 'auto', flex: 1 }}>
          {folders.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 8px', fontStyle: 'italic' }}>
              No subfolders
            </div>
          ) : (
            folders.map((f) => (
              <div
                key={f.path}
                className="nav-item"
                onClick={() => onNavigate(f.path)}
                title={f.path}
              >
                <Folder size={13} color="var(--text-secondary)" />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                <ChevronRight size={11} style={{ opacity: 0.3 }} />
              </div>
            ))
          )}
        </div>
      </div>

      {/* Directory Asset Summary */}
      <div
        style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          padding: '10px'
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: 0.5 }}>
          CURRENT FOLDER ASSETS
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', textAlign: 'center', gap: '8px 4px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, color: 'var(--text-main)' }}>
              <Box size={11} />
              <span style={{ fontSize: 11.5, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{modelCount}</span>
            </div>
            <div style={{ fontSize: 8.5, color: 'var(--text-muted)', marginTop: 2 }}>3D</div>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, color: 'var(--text-main)' }}>
              <SunMedium size={11} />
              <span style={{ fontSize: 11.5, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{hdrCount}</span>
            </div>
            <div style={{ fontSize: 8.5, color: 'var(--text-muted)', marginTop: 2 }}>HDR</div>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, color: 'var(--text-main)' }}>
              <ImageIcon size={11} />
              <span style={{ fontSize: 11.5, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{imageCount}</span>
            </div>
            <div style={{ fontSize: 8.5, color: 'var(--text-muted)', marginTop: 2 }}>Images</div>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, color: 'var(--text-main)' }}>
              <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.7 }}>TIF</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{textureCount}</span>
            </div>
            <div style={{ fontSize: 8.5, color: 'var(--text-muted)', marginTop: 2 }}>Textures</div>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, color: 'var(--text-main)' }}>
              <Film size={11} />
              <span style={{ fontSize: 11.5, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{videoCount}</span>
            </div>
            <div style={{ fontSize: 8.5, color: 'var(--text-muted)', marginTop: 2 }}>Videos</div>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, color: 'var(--text-main)' }}>
              <Volume2 size={11} />
              <span style={{ fontSize: 11.5, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{audioCount}</span>
            </div>
            <div style={{ fontSize: 8.5, color: 'var(--text-muted)', marginTop: 2 }}>Audio</div>
          </div>
        </div>
      </div>

      {/* Blender Bridge Status */}
      <div
        style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          padding: '8px 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer'
        }}
        onClick={onOpenSettings}
        title="Click to configure Blender converter"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: blenderStatus?.available ? '#ffffff' : '#666666'
            }}
          />
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)' }}>
            Blender ABC/USD
          </div>
        </div>
        <span style={{ fontSize: 9.5, color: blenderStatus?.available ? '#ffffff' : 'var(--text-muted)' }}>
          {blenderStatus?.available ? 'Ready' : 'Setup'}
        </span>
      </div>
    </aside>
  );
}
