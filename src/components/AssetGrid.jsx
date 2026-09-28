import React, { useState, useEffect, useRef } from 'react';
import {
  Folder,
  Box,
  SunMedium,
  Image as ImageIcon,
  Grid,
  FileQuestion,
  Star,
  ExternalLink,
  Eye,
  Maximize2,
  Film,
  Music
} from 'lucide-react';
import { formatBytes, formatDate, getFileBadgeClass } from '../utils/formatHelpers';
import { getOrGenerateThumbnail } from '../utils/thumbnailService';

function AssetCard({
  item,
  isSelected,
  isFavorite,
  onSelect,
  onOpen,
  onToggleFavorite,
  onRevealInExplorer,
  onAddToCompare,
  compareAssetA,
  compareAssetB,
  onSetCompareA,
  onSetCompareB
}) {
  const [thumbUrl, setThumbUrl] = useState(item.thumbnail || null);
  const [isLoadingThumb, setIsLoadingThumb] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    if (thumbUrl || item.isDirectory) return;

    let isMounted = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          observer.disconnect();

          // Standard images load directly via toAssetUrl
          const ext = (item.extension || '').toLowerCase();
          if (['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext)) {
            const directUrl = window.electronAPI?.toAssetUrl
              ? window.electronAPI.toAssetUrl(item.path)
              : item.path;
            setThumbUrl(directUrl);
            return;
          }

          // HDR, EXR, or 3D files decode through thumbnailService
          setIsLoadingThumb(true);
          getOrGenerateThumbnail(item)
            .then((url) => {
              if (isMounted && url) {
                setThumbUrl(url);
              }
            })
            .finally(() => {
              if (isMounted) setIsLoadingThumb(false);
            });
        }
      },
      { rootMargin: '120px' }
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => {
      isMounted = false;
      observer.disconnect();
    };
  }, [item, thumbUrl]);

  // FOLDER CARD
  if (item.isDirectory) {
    return (
      <div
        ref={cardRef}
        className={`asset-card ${isSelected ? 'selected' : ''}`}
        onClick={() => onSelect(item)}
        onDoubleClick={() => onOpen(item)}
      >
        <div
          className="card-preview folder-preview"
          style={{ background: '#161616', cursor: 'pointer' }}
        >
          <Folder size={40} color="var(--text-secondary)" strokeWidth={1.5} />
          <span className="card-badge" style={{ background: '#222222', borderColor: '#444444' }}>
            FOLDER
          </span>

          {/* Star button on Folders! */}
          <button
            className={`card-fav-btn ${isFavorite ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(item);
            }}
            title={isFavorite ? 'Unstar folder' : 'Star folder'}
          >
            <Star size={13} fill={isFavorite ? '#ffffff' : 'none'} />
          </button>
        </div>

        <div className="card-meta">
          <span className="card-title" title={item.name}>
            {item.name}
          </span>
          <div className="card-sub">
            <span>Folder</span>
            <span style={{ opacity: 0.6 }}>Double click to open</span>
          </div>
        </div>
      </div>
    );
  }

  // FILE CARD (3D, HDR, EXR, IMAGE)
  const ext = (item.extension || '').replace(/^\./, '').toUpperCase();
  const badgeClass = getFileBadgeClass(item.extension);

  return (
    <div
      ref={cardRef}
      className={`asset-card ${isSelected ? 'selected' : ''}`}
      draggable={!item.isDirectory}
      onDragStart={(e) => {
        if (!item.isDirectory) {
          e.dataTransfer.setData('application/json', JSON.stringify(item));
          e.dataTransfer.setData('text/plain', item.path);
          e.dataTransfer.effectAllowed = 'copy';
        }
      }}
      onClick={() => onSelect(item)}
      onDoubleClick={() => onOpen(item)}
    >
      {/* Thumbnail / Tone-Mapped Preview Visual (Exact 2:1 ratio for panoramic completeness) */}
      <div className="card-preview">
        <span className={`card-badge ${badgeClass}`}>{ext || 'FILE'}</span>

        {compareAssetA?.path === item.path && (
          <span className="slot-badge-card slot-badge-a" style={{ left: 50 }}>
            SLOT A
          </span>
        )}
        {compareAssetB?.path === item.path && (
          <span className="slot-badge-card slot-badge-b" style={{ left: 50 }}>
            SLOT B
          </span>
        )}

        <button
          className={`card-fav-btn ${isFavorite ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(item);
          }}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star size={13} fill={isFavorite ? '#ffffff' : 'none'} />
        </button>

        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={item.name}
            className="card-thumb-image"
            onError={() => setThumbUrl(null)}
          />
        ) : (
          <div
            className="card-placeholder-wrapper"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              height: '100%',
              background: '#0d0d0d'
            }}
          >
            {item.category === 'hdr' && (
              <div
                className={`card-placeholder-icon ${isLoadingThumb ? 'pulse-anim' : ''}`}
                style={{ color: '#888888' }}
              >
                <SunMedium size={36} strokeWidth={1.2} />
              </div>
            )}
            {item.category === '3d' && (
              <div
                className={`card-placeholder-icon ${isLoadingThumb ? 'pulse-anim' : ''}`}
                style={{ color: '#888888' }}
              >
                <Box size={36} strokeWidth={1.2} />
              </div>
            )}
            {item.category === 'image' && (
              <div
                className={`card-placeholder-icon ${isLoadingThumb ? 'pulse-anim' : ''}`}
                style={{ color: '#888888' }}
              >
                <ImageIcon size={36} strokeWidth={1.2} />
              </div>
            )}
            {item.category === 'texture' && (
              <div
                className={`card-placeholder-icon ${isLoadingThumb ? 'pulse-anim' : ''}`}
                style={{ color: '#888888' }}
              >
                <Grid size={36} strokeWidth={1.2} />
              </div>
            )}
            {item.category === 'video' && (
              <div
                className={`card-placeholder-icon ${isLoadingThumb ? 'pulse-anim' : ''}`}
                style={{ color: '#888888' }}
              >
                <Film size={36} strokeWidth={1.2} />
              </div>
            )}
            {item.category === 'audio' && (
              <div
                className="card-placeholder-icon"
                style={{ color: '#888888', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
              >
                <Music size={32} strokeWidth={1.2} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 10 }}>
                  <span style={{ width: 2, height: 6, background: '#666', borderRadius: 1 }} />
                  <span style={{ width: 2, height: 12, background: '#888', borderRadius: 1 }} />
                  <span style={{ width: 2, height: 8, background: '#666', borderRadius: 1 }} />
                  <span style={{ width: 2, height: 14, background: '#aaa', borderRadius: 1 }} />
                  <span style={{ width: 2, height: 5, background: '#555', borderRadius: 1 }} />
                </div>
              </div>
            )}
            {item.category === 'other' && (
              <div className="card-placeholder-icon">
                <FileQuestion size={32} strokeWidth={1.2} />
              </div>
            )}

            {isLoadingThumb && (
              <div
                style={{
                  fontSize: 9,
                  color: 'var(--text-muted)',
                  marginTop: 4,
                  fontFamily: 'var(--font-mono)'
                }}
              >
                Loading...
              </div>
            )}
          </div>
        )}

        {/* Hover Quick Actions */}
        <div
          style={{
            position: 'absolute',
            bottom: 6,
            right: 6,
            display: 'flex',
            gap: 4,
            zIndex: 8
          }}
        >
          <button
            className="icon-btn"
            style={{ width: 26, height: 26, background: 'rgba(15, 15, 15, 0.85)', backdropFilter: 'blur(4px)' }}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(item);
            }}
            title="Open in Viewer"
          >
            <Eye size={12} />
          </button>
          {!item.isDirectory && (
            <>
              <button
                className={`icon-btn ${compareAssetA?.path === item.path ? 'active' : ''}`}
                style={{
                  width: 26,
                  height: 26,
                  background: compareAssetA?.path === item.path ? '#ffffff' : 'rgba(15, 15, 15, 0.85)',
                  color: compareAssetA?.path === item.path ? '#000000' : '#ffffff',
                  fontWeight: 800,
                  fontSize: 10,
                  backdropFilter: 'blur(4px)'
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onSetCompareA) onSetCompareA(item);
                }}
                title={compareAssetA?.path === item.path ? 'Assigned as Image A' : 'Set as Image A (iCAT Compare)'}
              >
                A
              </button>
              <button
                className={`icon-btn ${compareAssetB?.path === item.path ? 'active' : ''}`}
                style={{
                  width: 26,
                  height: 26,
                  background: compareAssetB?.path === item.path ? '#888888' : 'rgba(15, 15, 15, 0.85)',
                  color: compareAssetB?.path === item.path ? '#000000' : '#ffffff',
                  fontWeight: 800,
                  fontSize: 10,
                  backdropFilter: 'blur(4px)'
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onSetCompareB) onSetCompareB(item);
                }}
                title={compareAssetB?.path === item.path ? 'Assigned as Image B' : 'Set as Image B (iCAT Compare)'}
              >
                B
              </button>
            </>
          )}
          <button
            className="icon-btn"
            style={{ width: 26, height: 26, background: 'rgba(15, 15, 15, 0.85)', backdropFilter: 'blur(4px)' }}
            onClick={(e) => {
              e.stopPropagation();
              onRevealInExplorer(item.path);
            }}
            title="Reveal in Windows Explorer"
          >
            <ExternalLink size={12} />
          </button>
        </div>
      </div>

      {/* Compact Metadata Footer */}
      <div className="card-meta">
        <span className="card-title" title={item.name}>
          {item.name}
        </span>
        <div className="card-sub">
          <span>{formatBytes(item.size)}</span>
          <span>{formatDate(item.modified).split(',')[0]}</span>
        </div>
      </div>
    </div>
  );
}

export default function AssetGrid({
  items,
  selectedItem,
  onSelect,
  onOpen,
  onToggleFavorite,
  favorites,
  onRevealInExplorer,
  onAddToCompare,
  compareAssetA,
  compareAssetB,
  onSetCompareA,
  onSetCompareB,
  gridSize = 240,
  onGridSizeChange
}) {
  const containerRef = useRef(null);
  const isFav = (item) => favorites.some((f) => f.path === item.path);

  // Ctrl + Mouse Scroll Wheel to dynamically zoom/resize thumbnail grid (just like Windows Explorer!)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 25 : -25;
        if (onGridSizeChange) {
          onGridSizeChange((prev) => Math.min(500, Math.max(120, prev + delta)));
        }
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [onGridSizeChange]);

  if (!items || items.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          gap: 10
        }}
      >
        <Box size={40} strokeWidth={1} style={{ opacity: 0.4 }} />
        <div style={{ fontSize: 14, fontWeight: 500 }}>No assets found in this folder</div>
        <div style={{ fontSize: 12 }}>Choose another drive or folder from the sidebar</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="grid-container"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${gridSize}px, 1fr))`
      }}
    >
      {items.map((item) => (
        <AssetCard
          key={item.path}
          item={item}
          isSelected={selectedItem?.path === item.path}
          isFavorite={isFav(item)}
          onSelect={onSelect}
          onOpen={onOpen}
          onToggleFavorite={onToggleFavorite}
          onRevealInExplorer={onRevealInExplorer}
          onAddToCompare={onAddToCompare}
          compareAssetA={compareAssetA}
          compareAssetB={compareAssetB}
          onSetCompareA={onSetCompareA}
          onSetCompareB={onSetCompareB}
        />
      ))}
    </div>
  );
}
