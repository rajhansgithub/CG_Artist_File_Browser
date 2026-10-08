import React, { useState, useMemo } from 'react';
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
  Film,
  Music,
  FileText,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import { formatBytes, formatDate, getTypeLabel, isComparableImage } from '../utils/formatHelpers';

const COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'modified', label: 'Date modified' },
  { key: 'type', label: 'Type' },
  { key: 'size', label: 'Size', align: 'right' }
];

const CATEGORY_ICONS = {
  folder: Folder,
  '3d': Box,
  hdr: SunMedium,
  image: ImageIcon,
  texture: Grid,
  video: Film,
  audio: Music,
  pdf: FileText
};

function compareItems(a, b, key) {
  switch (key) {
    case 'modified':
      return (a.modified || 0) - (b.modified || 0);
    case 'size':
      return (a.size || 0) - (b.size || 0);
    case 'type':
      return getTypeLabel(a).localeCompare(getTypeLabel(b)) || a.name.localeCompare(b.name, undefined, { numeric: true });
    default:
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  }
}

function DetailsRow({
  item,
  isSelected,
  isFavorite,
  onSelect,
  onOpen,
  onToggleFavorite,
  onRevealInExplorer,
  compareAssetA,
  compareAssetB,
  onSetCompareA,
  onSetCompareB
}) {
  const Icon = item.isDirectory ? Folder : CATEGORY_ICONS[item.category] || FileQuestion;
  const comparable = isComparableImage(item);

  return (
    <div
      className={`details-row ${isSelected ? 'selected' : ''}`}
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
      <div className="details-cell details-name" title={item.name}>
        <Icon size={15} strokeWidth={1.5} className="details-icon" />
        <span className="details-name-text">{item.name}</span>
        {isComparableImage(item) && compareAssetA?.path === item.path && (
          <span className="details-slot-tag">A</span>
        )}
        {isComparableImage(item) && compareAssetB?.path === item.path && (
          <span className="details-slot-tag">B</span>
        )}
      </div>
      <div className="details-cell details-muted">{formatDate(item.modified)}</div>
      <div className="details-cell details-muted">{getTypeLabel(item)}</div>
      <div className="details-cell details-muted details-size">{item.isDirectory ? '' : formatBytes(item.size)}</div>
      <div className="details-cell details-actions">
        <button
          className={`details-action-btn fav ${isFavorite ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(item);
          }}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star size={12} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
        {!item.isDirectory && (
          <button
            className="details-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(item);
            }}
            title="Open in Viewer"
          >
            <Eye size={12} />
          </button>
        )}
        {comparable && (
          <>
            <button
              className={`details-action-btn ${compareAssetA?.path === item.path ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                if (onSetCompareA) onSetCompareA(item);
              }}
              title="Set as Image A (Image Comparison)"
            >
              A
            </button>
            <button
              className={`details-action-btn ${compareAssetB?.path === item.path ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                if (onSetCompareB) onSetCompareB(item);
              }}
              title="Set as Image B (Image Comparison)"
            >
              B
            </button>
          </>
        )}
        <button
          className="details-action-btn"
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
  );
}

// Windows Explorer-style "Details" list: one row per item, sortable columns, no thumbnails to load.
export default function DetailsView({
  items,
  selectedItem,
  onSelect,
  onOpen,
  onToggleFavorite,
  favorites,
  onRevealInExplorer,
  compareAssetA,
  compareAssetB,
  onSetCompareA,
  onSetCompareB
}) {
  const [sort, setSort] = useState(null); // null keeps the folder's own order; otherwise { key, dir: 1 | -1 }

  const favoritePaths = useMemo(() => new Set(favorites.map((f) => f.path)), [favorites]);

  const rows = useMemo(() => {
    if (!sort) return items;
    // Folders stay on top, like Explorer, whichever way a column is sorted
    return [...items].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return compareItems(a, b, sort.key) * sort.dir;
    });
  }, [items, sort]);

  const handleHeaderClick = (key) => {
    setSort((prev) => (prev && prev.key === key ? { key, dir: -prev.dir } : { key, dir: 1 }));
  };

  return (
    <div className="details-view" role="table">
      <div className="details-header" role="row">
        {COLUMNS.map((col) => (
          <button
            key={col.key}
            className={`details-header-cell ${col.align === 'right' ? 'right' : ''} ${sort?.key === col.key ? 'sorted' : ''}`}
            onClick={() => handleHeaderClick(col.key)}
            title={`Sort by ${col.label.toLowerCase()}`}
          >
            <span>{col.label}</span>
            {sort?.key === col.key && (sort.dir === 1 ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
          </button>
        ))}
        <div className="details-header-cell details-actions-head" aria-hidden="true" />
      </div>
      <div className="details-body">
        {rows.map((item) => (
          <DetailsRow
            key={item.path}
            item={item}
            isSelected={selectedItem?.path === item.path}
            isFavorite={favoritePaths.has(item.path)}
            onSelect={onSelect}
            onOpen={onOpen}
            onToggleFavorite={onToggleFavorite}
            onRevealInExplorer={onRevealInExplorer}
            compareAssetA={compareAssetA}
            compareAssetB={compareAssetB}
            onSetCompareA={onSetCompareA}
            onSetCompareB={onSetCompareB}
          />
        ))}
      </div>
    </div>
  );
}
