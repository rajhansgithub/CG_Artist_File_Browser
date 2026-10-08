import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  SunMedium,
  Image as ImageIcon,
  Grid,
  FileQuestion,
  Star,
  ExternalLink,
  Eye,
  Film,
  Music,
  FileText
} from 'lucide-react';
import { formatBytes, formatDate, getFileBadgeClass, isComparableImage } from '../utils/formatHelpers';
import { getOrGenerateThumbnail } from '../utils/thumbnailService';
import { useFolderIcons } from '../utils/folderIconStore';
import DetailsView from './DetailsView';
import FolderIcon from './FolderIcon';

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
  const { openMenu } = useFolderIcons();
  const [thumbUrl, setThumbUrl] = useState(item.thumbnail || null);
  const [aspectRatio, setAspectRatio] = useState(null);
  const [isLoadingThumb, setIsLoadingThumb] = useState(false);
  const cardRef = useRef(null);
  const imgRef = useRef(null);

  useEffect(() => {
    setThumbUrl(item.thumbnail || null);
    setAspectRatio(null);
  }, [item.path, item.thumbnail]);

  const handleImgLoad = (e) => {
    const { naturalWidth, naturalHeight } = e.target;
    if (naturalWidth && naturalHeight) {
      setAspectRatio(naturalWidth / naturalHeight);
    }
  };

  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current?.naturalWidth && imgRef.current?.naturalHeight) {
      setAspectRatio(imgRef.current.naturalWidth / imgRef.current.naturalHeight);
    }
  }, [thumbUrl]);

  useEffect(() => {
    if (thumbUrl || item.isDirectory) return;

    let isMounted = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          observer.disconnect();

          // All file types go through thumbnailService (native thumbnails first, with fallbacks)
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
        onContextMenu={(e) => {
          onSelect(item);
          openMenu(e, item);
        }}
      >
        <div
          className="card-preview folder-preview"
          style={{ background: '#161616', cursor: 'pointer' }}
        >
          <FolderIcon item={item} size={40} color="var(--text-secondary)" strokeWidth={1.5} />
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
      {/* Thumbnail / Tone-Mapped Preview Visual (Exact aspect ratio of file, 2:1 placeholder before loaded) */}
      <div
        className="card-preview"
        style={aspectRatio ? { aspectRatio: `${aspectRatio}` } : { aspectRatio: '2 / 1' }}
      >
        <span className={`card-badge ${badgeClass}`}>{ext || 'FILE'}</span>

        {isComparableImage(item) && compareAssetA?.path === item.path && (
          <span className="slot-badge-card slot-badge-a" style={{ left: 50 }}>
            SLOT A
          </span>
        )}
        {isComparableImage(item) && compareAssetB?.path === item.path && (
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
            ref={imgRef}
            src={thumbUrl}
            alt={item.name}
            className="card-thumb-image"
            onLoad={handleImgLoad}
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
            {item.category === 'pdf' && (
              <div
                className={`card-placeholder-icon ${isLoadingThumb ? 'pulse-anim' : ''}`}
                style={{ color: '#888888' }}
              >
                <FileText size={36} strokeWidth={1.2} />
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
          {isComparableImage(item) && (
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
                title={compareAssetA?.path === item.path ? 'Assigned as Image A' : 'Set as Image A (Image Comparison)'}
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
                title={compareAssetB?.path === item.path ? 'Assigned as Image B' : 'Set as Image B (Image Comparison)'}
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
  onGridSizeChange,
  folderView = 'icons'
}) {
  const wrapRef = useRef(null);
  const folderViewRef = useRef(folderView);
  folderViewRef.current = folderView;
  const isFav = (item) => favorites.some((f) => f.path === item.path);

  // Ctrl + Mouse Scroll Wheel resizes the thumbnails (Large icons view only, like Windows Explorer).
  // The listener sits on a wrapper that is always rendered. It used to sit on the grid itself, which
  // does not exist while a folder is empty or still loading, so the listener was never attached and
  // Ctrl + wheel silently did nothing until the grid happened to remount.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const handleWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault(); // never let the webview zoom the whole page
      if (folderViewRef.current !== 'icons' || !onGridSizeChange || !e.deltaY) return;
      // One wheel notch (~100px) is 25px of thumbnail; touchpads and smooth wheels send small deltas
      const pixels = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const delta = Math.max(-50, Math.min(50, -pixels * 0.25));
      onGridSizeChange((prev) => Math.min(500, Math.max(120, Math.round(prev + delta))));
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [onGridSizeChange]);

  let content;
  if (!items || items.length === 0) {
    content = (
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
  } else if (folderView === 'details') {
    content = (
      <DetailsView
        items={items}
        selectedItem={selectedItem}
        onSelect={onSelect}
        onOpen={onOpen}
        onToggleFavorite={onToggleFavorite}
        favorites={favorites}
        onRevealInExplorer={onRevealInExplorer}
        compareAssetA={compareAssetA}
        compareAssetB={compareAssetB}
        onSetCompareA={onSetCompareA}
        onSetCompareB={onSetCompareB}
      />
    );
  } else {
    content = (
      <div
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

  return (
    <div ref={wrapRef} className="asset-view">
      {content}
    </div>
  );
}
