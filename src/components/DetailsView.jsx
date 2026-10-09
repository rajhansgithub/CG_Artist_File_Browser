import React, { useMemo } from 'react';
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
import { formatBytes, formatDate, getTypeLabel, isComparableItem } from '../utils/formatHelpers';
import { useFolderIcons } from '../utils/folderIconStore';
import { startNativeDragOut } from '../utils/dragOut';
import FolderIcon from './FolderIcon';

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
  onSetCompareB,
  getDragPaths
}) {
  const { openMenu } = useFolderIcons();
  const Icon = CATEGORY_ICONS[item.category] || FileQuestion;
  const comparable = isComparableItem(item);

  return (
    <div
      className={`details-row ${isSelected ? 'selected' : ''}`}
      draggable={!item.isDirectory}
      onDragStart={(e) => {
        if (startNativeDragOut(e, item, getDragPaths?.(item))) return;
        if (!item.isDirectory) {
          e.dataTransfer.setData('application/json', JSON.stringify(item));
          e.dataTransfer.setData('text/plain', item.path);
          e.dataTransfer.effectAllowed = 'copy';
        }
      }}
      onClick={(e) => onSelect(item, e)}
      onDoubleClick={() => onOpen(item)}
      onContextMenu={(e) => {
        // Right-clicking a selected item keeps the whole selection, like Explorer
        if (!isSelected) onSelect(item);
        openMenu(e, item, true);
      }}
    >
      <div className="details-cell details-name" title={item.name}>
        {item.isDirectory ? (
          <FolderIcon item={item} size={15} strokeWidth={1.5} className="details-icon" />
        ) : (
          <Icon size={15} strokeWidth={1.5} className="details-icon" />
        )}
        <span className="details-name-text">{item.name}</span>
        {isComparableItem(item) && compareAssetA?.path === item.path && (
          <span className="details-slot-tag">A</span>
        )}
        {isComparableItem(item) && compareAssetB?.path === item.path && (
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
              title="Set as A (Compare)"
            >
              A
            </button>
            <button
              className={`details-action-btn ${compareAssetB?.path === item.path ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                if (onSetCompareB) onSetCompareB(item);
              }}
              title="Set as B (Compare)"
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
// The items arrive already sorted; the column headers only report which column was clicked.
export default function DetailsView({
  items,
  selectedPaths,
  onSelect,
  getDragPaths,
  onOpen,
  onToggleFavorite,
  favorites,
  onRevealInExplorer,
  compareAssetA,
  compareAssetB,
  onSetCompareA,
  onSetCompareB,
  sort,
  onSortColumn
}) {
  const favoritePaths = useMemo(() => new Set(favorites.map((f) => f.path)), [favorites]);

  return (
    <div className="details-view" role="table">
      <div className="details-header" role="row">
        {COLUMNS.map((col) => (
          <button
            key={col.key}
            className={`details-header-cell ${col.align === 'right' ? 'right' : ''} ${sort?.key === col.key ? 'sorted' : ''}`}
            onClick={() => onSortColumn(col.key)}
            title={`Sort by ${col.label.toLowerCase()}`}
          >
            <span>{col.label}</span>
            {sort?.key === col.key && (sort.dir === 1 ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
          </button>
        ))}
        <div className="details-header-cell details-actions-head" aria-hidden="true" />
      </div>
      <div className="details-body">
        {items.map((item) => (
          <DetailsRow
            key={item.path}
            item={item}
            isSelected={selectedPaths.has(item.path)}
            isFavorite={favoritePaths.has(item.path)}
            onSelect={onSelect}
            getDragPaths={getDragPaths}
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
