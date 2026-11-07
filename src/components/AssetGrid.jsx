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
  FileText,
  BookOpen,
  Tag,
  Check,
  FolderOpen,
  FolderSearch
} from 'lucide-react';
import { formatBytes, formatDate, getFileBadgeClass, isComparableItem } from '../utils/formatHelpers';
import { getOrGenerateThumbnail, getCachedThumbnail } from '../utils/thumbnailService';
import { normalizeFolderKey, useFolderIcons } from '../utils/folderIconStore';
import { useFolderPeek } from '../utils/folderPeek';
import { getLabelColor, labelFor } from '../utils/fileLabelStore';
import { startNativeDragOut } from '../utils/dragOut';
import {
  indexOfPath,
  rangePaths,
  togglePath,
  lastSelectedItem,
  selectedFilePaths,
  startBoxSelect
} from '../utils/gridSelection';
import { GRID_GAP, scrollGridRowIntoView, useVirtualGrid } from '../utils/gridVirtual';
import DetailsView from './DetailsView';
import FolderIcon from './FolderIcon';
import { FileLabelPopover } from './LabelPanels';

// Tags shown on a card; the rest are counted
const CARD_TAG_LIMIT = 3;

const EMPTY_SET = new Set();
const NAV_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];

// Preview shapes outlive a card. When a card scrolls out of the virtualized grid and back, it keeps its height.
const previewAspectCache = new Map();

// Colour and tags of a card (files and folders): a button that shows on hover, a stripe in the colour while the
// item has one, and the editor that the button opens
function CardLabel({ path, label, labelActions }) {
  const [labelAnchor, setLabelAnchor] = useState(null);
  const labelColor = getLabelColor(label?.color);
  const hasLabel = !!labelColor || !!label?.tags?.length;

  return (
    <>
      <button
        className={`card-act ${hasLabel ? 'on' : ''}`}
        style={labelColor ? { color: labelColor.hex } : undefined}
        onClick={(e) => {
          e.stopPropagation();
          // Read the button now: React clears currentTarget once the event has been handled
          const button = e.currentTarget;
          setLabelAnchor((anchor) => (anchor ? null : button));
        }}
        title="Colour and tags"
        aria-label="Colour and tags"
      >
        <Tag size={14} fill={labelColor ? 'currentColor' : 'none'} />
      </button>

      {labelAnchor && (
        <FileLabelPopover
          anchor={labelAnchor}
          label={label || { color: null, tags: [] }}
          onSetColor={(color) => labelActions.setColor([path], color)}
          onAddTag={(tag) => labelActions.editTags([path], [tag], [])}
          onRemoveTag={(tag) => labelActions.editTags([path], [], [tag])}
          onClose={() => setLabelAnchor(null)}
        />
      )}
    </>
  );
}

// Marks that stay on a tile: its Compare slot (A or B) and its star. The star unstars in one click.
function CardMarks({ item, isFavorite, onToggleFavorite, isA, isB }) {
  if (!isA && !isB && !isFavorite) return null;
  return (
    <div className="card-marks">
      {isA && <span className="card-mark slot-a" title="Compare slot A">A</span>}
      {isB && <span className="card-mark slot-b" title="Compare slot B">B</span>}
      {isFavorite && (
        <button
          className="card-mark star"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(item);
          }}
          title={item.isDirectory ? 'Unpin folder' : 'Remove from favorites'}
          aria-label={item.isDirectory ? 'Unpin folder' : 'Remove from favorites'}
        >
          <Star size={12} fill="currentColor" />
        </button>
      )}
    </div>
  );
}

// Small kind icon shown on a tile in Simple mode (plain pictures need none)
const KIND_ICONS = { '3d': Box, hdr: SunMedium, texture: Grid, video: Film, audio: Music, pdf: FileText, markdown: BookOpen };
// Placeholder while a thumbnail loads, or when there is none
const PLACEHOLDER_ICONS = { hdr: SunMedium, '3d': Box, image: ImageIcon, texture: Grid, video: Film, pdf: FileText, markdown: BookOpen };

// The first tags of a card, the rest counted
function CardTags({ tags }) {
  if (!tags.length) return null;
  return (
    <div className="card-tags">
      {tags.slice(0, CARD_TAG_LIMIT).map((tag) => (
        <span key={tag} className="card-tag">
          {tag}
        </span>
      ))}
      {tags.length > CARD_TAG_LIMIT && <span className="card-tag card-tag-more">+{tags.length - CARD_TAG_LIMIT}</span>}
    </div>
  );
}

function AssetCard({
  item,
  isSelected,
  isCut,
  isFavorite,
  label,
  labelActions,
  onSelect,
  onOpen,
  onToggleFavorite,
  onRevealInExplorer,
  onAddToCompare,
  compareAssetA,
  compareAssetB,
  onSetCompareA,
  onSetCompareB,
  onOpenExternal,
  peekEnabled,
  getDragPaths
}) {
  const { openMenu, assignments } = useFolderIcons();
  // A folder with an icon of its own (picked here or set in Explorer) keeps it; others show pictures from inside
  const hasCustomIcon = item.isDirectory && (!!assignments?.[normalizeFolderKey(item.path)] || !!item.systemIcon);
  const peekUrls = useFolderPeek(item.path, item.isDirectory && peekEnabled && !hasCustomIcon);
  // Thumbnails already in memory are shown at once, so a card remounted by scrolling does not flash its placeholder
  const [thumbUrl, setThumbUrl] = useState(() => item.thumbnail || getCachedThumbnail(item.path));
  const [aspectRatio, setAspectRatio] = useState(() => previewAspectCache.get(item.path) ?? null);
  const [isLoadingThumb, setIsLoadingThumb] = useState(false);
  const cardRef = useRef(null);
  const imgRef = useRef(null);

  const rememberAspect = (ratio) => {
    previewAspectCache.set(item.path, ratio);
    setAspectRatio(ratio);
  };

  useEffect(() => {
    setThumbUrl(item.thumbnail || getCachedThumbnail(item.path));
    setAspectRatio(previewAspectCache.get(item.path) ?? null);
  }, [item.path, item.thumbnail]);

  const handleImgLoad = (e) => {
    const { naturalWidth, naturalHeight } = e.target;
    if (naturalWidth && naturalHeight) {
      rememberAspect(naturalWidth / naturalHeight);
    }
  };

  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current?.naturalWidth && imgRef.current?.naturalHeight) {
      rememberAspect(imgRef.current.naturalWidth / imgRef.current.naturalHeight);
    }
  }, [thumbUrl]);

  useEffect(() => {
    if (thumbUrl || item.isDirectory) return;

    let isMounted = true;
    // Aborted when the card unmounts (scrolled away, folder left) so a thumbnail still waiting in line never starts
    const controller = new AbortController();
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          observer.disconnect();

          // All file types go through thumbnailService (native thumbnails first, with fallbacks)
          setIsLoadingThumb(true);
          getOrGenerateThumbnail(item, { signal: controller.signal })
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
      controller.abort();
    };
    // Keyed on the path, not the item object: a re-render that only rebuilds the item objects must not cancel
    // a thumbnail that is already waiting or decoding for this card.
  }, [item.path, item.isDirectory, thumbUrl]);

  const marks = (
    <CardMarks
      item={item}
      isFavorite={isFavorite}
      onToggleFavorite={onToggleFavorite}
      isA={isComparableItem(item) && compareAssetA?.path === item.path}
      isB={isComparableItem(item) && compareAssetB?.path === item.path}
    />
  );
  const labelColor = getLabelColor(label?.color);
  const tags = label?.tags || [];
  const check = isSelected && (
    <span className="card-check" aria-hidden="true">
      <Check size={12} strokeWidth={3} />
    </span>
  );

  // FOLDER CARD: up to four pictures from inside it, else its icon
  if (item.isDirectory) {
    const showPeek = peekUrls.length > 0 && !hasCustomIcon;
    return (
      <div
        ref={cardRef}
        className={`asset-card folder-card ${isSelected ? 'selected' : ''} ${isCut ? 'cut' : ''}`}
        onClick={(e) => onSelect(item, e)}
        onDoubleClick={() => onOpen(item)}
        onContextMenu={(e) => {
          // Right-clicking a selected item keeps the whole selection, like Explorer
          if (!isSelected) onSelect(item);
          openMenu(e, item, true);
        }}
      >
        <div className="card-preview folder-preview" style={{ cursor: 'pointer' }}>
          {showPeek ? (
            <div className={`folder-peek n${Math.min(peekUrls.length, 4)}`}>
              {peekUrls.slice(0, 4).map((url) => (
                <img key={url} src={url} alt="" draggable={false} />
              ))}
            </div>
          ) : (
            <FolderIcon item={item} size={52} color="var(--accent)" strokeWidth={1.25} />
          )}
          {check}
          {marks}

          <div className="card-actions">
            <button
              className="card-act primary"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(item);
              }}
              title="Open folder"
              aria-label="Open folder"
            >
              <FolderOpen size={14} />
            </button>
            <button
              className="card-act"
              onClick={(e) => {
                e.stopPropagation();
                onRevealInExplorer(item.path);
              }}
              title="Reveal in Windows Explorer"
              aria-label="Reveal in Windows Explorer"
            >
              <FolderSearch size={14} />
            </button>
            <span className="card-act-sep" />
            <button
              className={`card-act ${isFavorite ? 'on' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(item);
              }}
              title={isFavorite ? 'Unpin folder' : 'Pin folder'}
              aria-label={isFavorite ? 'Unpin folder' : 'Pin folder'}
            >
              <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
            </button>
            <CardLabel path={item.path} label={label} labelActions={labelActions} />
          </div>
        </div>

        <div className="card-meta">
          <CardTags tags={tags} />
          <span className="card-chip">
            {labelColor && <span className="card-dot" style={{ background: labelColor.hex }} />}
            <FolderIcon item={item} size={13} className="card-chip-icon" />
            <span className="card-title" title={item.name}>
              {item.name}
            </span>
          </span>
        </div>
      </div>
    );
  }

  // FILE CARD
  const ext = (item.extension || '').replace(/^\./, '').toUpperCase();
  const badgeClass = getFileBadgeClass(item.extension);
  const KindIcon = KIND_ICONS[item.category];

  return (
    <div
      ref={cardRef}
      className={`asset-card ${isSelected ? 'selected' : ''} ${isCut ? 'cut' : ''}`}
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
      {/* Thumbnail / Tone-Mapped Preview Visual (Exact aspect ratio of file, 2:1 placeholder before loaded) */}
      <div
        className="card-preview"
        style={aspectRatio ? { aspectRatio: `${aspectRatio}` } : { aspectRatio: '2 / 1' }}
      >
        {/* Pro shows the extension; Simple shows a small kind icon on anything that is not a plain picture */}
        <span className={`card-badge card-badge-ext ${badgeClass}`}>{ext || 'FILE'}</span>
        {KindIcon && (
          <span className="card-badge card-badge-kind" title={ext}>
            <KindIcon size={12} />
          </span>
        )}
        {check}
        {marks}

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
          <div className="card-placeholder-wrapper">
            <div className={`card-placeholder-icon ${isLoadingThumb ? 'pulse-anim' : ''}`}>
              {item.category === 'audio' ? (
                <>
                  <Music size={32} strokeWidth={1.2} />
                  <div className="card-wave">
                    <span style={{ height: 6 }} />
                    <span style={{ height: 12 }} />
                    <span style={{ height: 8 }} />
                    <span style={{ height: 14 }} />
                    <span style={{ height: 5 }} />
                  </div>
                </>
              ) : (
                React.createElement(PLACEHOLDER_ICONS[item.category] || FileQuestion, { size: 36, strokeWidth: 1.2 })
              )}
            </div>
            {isLoadingThumb && <div className="card-loading">Loading...</div>}
          </div>
        )}

        {/* Hover bar: open, set as A or B for Compare, open in its app, reveal, star, colour and tags */}
        <div className="card-actions">
          <button
            className="card-act primary"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(item);
            }}
            title="Open in Viewer"
            aria-label="Open in Viewer"
          >
            <Eye size={14} />
          </button>
          {isComparableItem(item) && (
            <>
              <button
                className={`card-act letter ${compareAssetA?.path === item.path ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onSetCompareA) onSetCompareA(item);
                }}
                title={compareAssetA?.path === item.path ? 'Assigned as A' : 'Set as A (Compare)'}
                aria-label="Set as A for Compare"
              >
                A
              </button>
              <button
                className={`card-act letter b ${compareAssetB?.path === item.path ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onSetCompareB) onSetCompareB(item);
                }}
                title={compareAssetB?.path === item.path ? 'Assigned as B' : 'Set as B (Compare)'}
                aria-label="Set as B for Compare"
              >
                B
              </button>
            </>
          )}
          <span className="card-act-sep" />
          {onOpenExternal && (
            <button
              className="card-act"
              onClick={(e) => {
                e.stopPropagation();
                onOpenExternal(item);
              }}
              title="Open in its default app"
              aria-label="Open in its default app"
            >
              <ExternalLink size={14} />
            </button>
          )}
          <button
            className="card-act"
            onClick={(e) => {
              e.stopPropagation();
              onRevealInExplorer(item.path);
            }}
            title="Reveal in Windows Explorer"
            aria-label="Reveal in Windows Explorer"
          >
            <FolderSearch size={14} />
          </button>
          <span className="card-act-sep" />
          <button
            className={`card-act ${isFavorite ? 'on' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(item);
            }}
            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
          </button>
          <CardLabel path={item.path} label={label} labelActions={labelActions} />
        </div>
      </div>

      {/* Name chip on the picture. Pro adds the size (or frame count) and the tags. */}
      <div className="card-meta">
        <CardTags tags={tags} />
        <span className="card-chip">
          {labelColor && <span className="card-dot" style={{ background: labelColor.hex }} />}
          <span className="card-title" title={item.name}>
            {item.name}
          </span>
          <span className="card-sub" title={formatDate(item.modified)}>
            {item.isSequence ? `${item.frameCount} frames` : formatBytes(item.size)}
          </span>
        </span>
      </div>
    </div>
  );
}

export default function AssetGrid({
  items,
  selectedItem,
  selectedPaths,
  cutPaths,
  onSelect,
  onSelectionChange,
  onOpen,
  onToggleFavorite,
  favorites,
  labels = {},
  labelActions,
  onRevealInExplorer,
  onAddToCompare,
  compareAssetA,
  compareAssetB,
  onSetCompareA,
  onSetCompareB,
  gridSize = 240,
  onGridSizeChange,
  folderView = 'icons',
  sort,
  onSortColumn,
  keyboardEnabled = true,
  onGoUp,
  onOpenFolderMenu,
  onOpenExternal,
  canPeekFolder
}) {
  const wrapRef = useRef(null);
  const folderViewRef = useRef(folderView);
  folderViewRef.current = folderView;

  // The paths of every selected item. Without a multi-selection it is just the focused item.
  const selected = selectedPaths || (selectedItem ? new Set([selectedItem.path]) : EMPTY_SET);

  // Latest values for the keyboard listener, which is attached once and must not see stale props
  const keyStateRef = useRef({});
  keyStateRef.current = { items, selectedItem, onSelect, onSelectionChange, onOpen, onGoUp };
  const scrollToSelectionRef = useRef(false);
  // The item that Shift + click and Shift + arrow extend from; it moves on every plain or Ctrl click
  const anchorPathRef = useRef(null);
  // A box selection ends with a click on the empty area, which must not clear what the box just selected
  const suppressClickRef = useRef(false);

  // Icon view mounts only the rows near the viewport (see utils/gridVirtual.js); details view is not virtualized
  const virtual = useVirtualGrid({
    items,
    minWidth: gridSize,
    enabled: folderView !== 'details' && !!items && items.length > 0
  });
  const gridLayoutRef = useRef(null);
  gridLayoutRef.current = virtual.layout;

  // The element of the n-th row in the details list
  const getItemElement = (index) => {
    const list = wrapRef.current?.querySelector('.details-body');
    return list?.children[index] || null;
  };

  // Where Shift + click or Shift + arrow extends from: the anchor, else the focused item, else the target itself
  const anchorIndexFor = (list, fallback) => {
    const anchor = indexOfPath(list, anchorPathRef.current);
    if (anchor >= 0) return anchor;
    return fallback;
  };

  // Click handling for cards and rows: plain click selects one item, Ctrl toggles it, Shift selects the range
  const pickItem = (item, event) => {
    const index = indexOfPath(items, item.path);
    if (index < 0 || (!event?.ctrlKey && !event?.shiftKey)) {
      anchorPathRef.current = item.path;
      onSelect(item);
      return;
    }

    const anchor = anchorIndexFor(items, indexOfPath(items, selectedItem?.path));
    if (event.shiftKey && anchor >= 0) {
      const range = rangePaths(items, anchor, index);
      // Ctrl + Shift adds the range to what is selected, Shift alone replaces it
      const paths = event.ctrlKey ? new Set([...selected, ...range]) : range;
      onSelectionChange(paths, item);
      return;
    }
    if (event.shiftKey) {
      // Nothing to extend from yet, so Shift + click on its own just selects the item
      anchorPathRef.current = item.path;
      onSelect(item);
      return;
    }

    const next = togglePath(selected, item.path);
    anchorPathRef.current = item.path;
    onSelectionChange(next, next.has(item.path) ? item : lastSelectedItem(items, next));
  };

  // Dragging a selected file drags every selected file; dragging anything else drags just that item
  const getDragPaths = (item) => {
    if (selected.size < 2 || !selected.has(item.path)) return null;
    return selectedFilePaths(items, selected);
  };

  // Press on the empty area of the list: a plain press clears the selection, a drag draws a box over the items
  const handleBackgroundPointerDown = (event) => {
    suppressClickRef.current = false;
    if (event.button !== 0 || !event.target.matches?.('.grid-container, .details-body')) return;
    startBoxSelect(event, event.target, {
      getItems: () => keyStateRef.current.items,
      baseSelection: event.ctrlKey ? new Set(selected) : new Set(),
      onChange: (paths, focus) => keyStateRef.current.onSelectionChange(paths, focus),
      onEnd: (dragged) => {
        suppressClickRef.current = dragged;
      }
    });
  };

  const handleBackgroundClick = (event) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (event.ctrlKey || !event.target.matches?.('.grid-container, .details-body')) return;
    anchorPathRef.current = null;
    onSelectionChange(new Set(), null);
  };

  // Arrow keys move the selection, Enter opens it and Backspace goes to the parent folder.
  // Shift + arrow keys extend the selection from the anchor, Ctrl + A selects everything.
  // Ignored while typing in a box, while a window is open (keyboardEnabled) and with Alt held.
  useEffect(() => {
    if (!keyboardEnabled) return undefined;

    const columnCount = () => {
      if (folderViewRef.current === 'details') return 1;
      return gridLayoutRef.current?.columns || 1;
    };

    const onKeyDown = (e) => {
      if (e.altKey || e.metaKey || e.defaultPrevented) return;
      // Only Ctrl + A (select all) and the navigation keys with Shift are handled with a modifier
      const selectAll = e.ctrlKey && (e.key === 'a' || e.key === 'A');
      if (e.ctrlKey && !selectAll) return;
      if (e.shiftKey && !NAV_KEYS.includes(e.key)) return;
      const target = e.target;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;

      const {
        items: list,
        selectedItem: focused,
        onSelect: select,
        onSelectionChange: changeSelection,
        onOpen: open,
        onGoUp: goUp
      } = keyStateRef.current;

      if (e.key === 'Backspace') {
        e.preventDefault();
        if (goUp) goUp();
        return;
      }

      if (!list || list.length === 0) return;
      if (selectAll) {
        e.preventDefault();
        const focus = focused && indexOfPath(list, focused.path) >= 0 ? focused : list[0];
        anchorPathRef.current = focus.path;
        changeSelection(new Set(list.map((item) => item.path)), focus);
        return;
      }

      const last = list.length - 1;
      const cols = columnCount();
      const current = focused ? list.findIndex((item) => item.path === focused.path) : -1;

      if (e.key === 'Enter') {
        // A focused button already reacts to Enter by itself
        if (tag === 'BUTTON' || tag === 'A' || current < 0) return;
        e.preventDefault();
        open(list[current]);
        return;
      }

      let next = current;
      switch (e.key) {
        case 'ArrowRight':
          if (cols === 1) return;
          next = current < 0 ? 0 : Math.min(current + 1, last);
          break;
        case 'ArrowLeft':
          if (cols === 1) return;
          next = current < 0 ? 0 : Math.max(current - 1, 0);
          break;
        case 'ArrowDown':
          if (current < 0) next = 0;
          else if (current + cols <= last) next = current + cols;
          else if (Math.floor(current / cols) < Math.floor(last / cols)) next = last; // short last row
          break;
        case 'ArrowUp':
          next = current < 0 ? 0 : current - cols >= 0 ? current - cols : current;
          break;
        case 'PageDown':
        case 'PageUp': {
          // Grid rows come from the layout, since most of their cards are not mounted
          const sampleHeight =
            folderViewRef.current === 'details'
              ? getItemElement(0)?.offsetHeight
              : gridLayoutRef.current?.rowHeights[Math.floor(Math.max(current, 0) / cols)];
          const rowHeight = sampleHeight ? sampleHeight + GRID_GAP : 100;
          const view = wrapRef.current?.querySelector('.grid-container, .details-body');
          const rows = Math.max(1, Math.floor((view?.clientHeight || rowHeight) / rowHeight) - 1);
          const step = rows * cols;
          next = current < 0 ? 0 : e.key === 'PageDown' ? Math.min(current + step, last) : Math.max(current - step, 0);
          break;
        }
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = last;
          break;
        default:
          return;
      }

      e.preventDefault();
      if (next !== current) {
        scrollToSelectionRef.current = true;
        if (e.shiftKey) {
          // Shift + arrow selects everything from the anchor to the new focus; the anchor stays where it is
          const anchor = anchorIndexFor(list, current >= 0 ? current : next);
          changeSelection(rangePaths(list, anchor, next), list[next]);
        } else {
          anchorPathRef.current = list[next].path;
          select(list[next]);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keyboardEnabled]);

  // Keep the item chosen with the keyboard in view (a mouse click never scrolls). In the grid it stays in view
  // while rows are measured and move, until the user scrolls or clicks by hand (see the listeners below).
  useEffect(() => {
    if (!scrollToSelectionRef.current) return;
    const index = selectedItem ? items.findIndex((item) => item.path === selectedItem.path) : -1;
    if (index < 0) return;
    if (folderViewRef.current === 'details') {
      scrollToSelectionRef.current = false;
      getItemElement(index)?.scrollIntoView({ block: 'nearest' });
      return;
    }
    const layout = gridLayoutRef.current;
    if (layout) {
      scrollGridRowIntoView(wrapRef.current?.querySelector('.grid-container'), layout, Math.floor(index / layout.columns));
    }
  }, [selectedItem, items, virtual.layout]);

  // A wheel turn or a click hands scrolling back to the user
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const stopFollowing = () => {
      scrollToSelectionRef.current = false;
    };
    el.addEventListener('wheel', stopFollowing, { passive: true });
    el.addEventListener('pointerdown', stopFollowing);
    return () => {
      el.removeEventListener('wheel', stopFollowing);
      el.removeEventListener('pointerdown', stopFollowing);
    };
  }, []);
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
        selectedPaths={selected}
        cutPaths={cutPaths}
        onSelect={pickItem}
        getDragPaths={getDragPaths}
        onOpen={onOpen}
        onToggleFavorite={onToggleFavorite}
        favorites={favorites}
        onRevealInExplorer={onRevealInExplorer}
        compareAssetA={compareAssetA}
        compareAssetB={compareAssetB}
        onSetCompareA={onSetCompareA}
        onSetCompareB={onSetCompareB}
        sort={sort}
        onSortColumn={onSortColumn}
      />
    );
  } else {
    content = (
      <div
        ref={virtual.gridRef}
        className="grid-container"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${gridSize}px, 1fr))`
        }}
      >
        {virtual.topSpacer > 0 && <div style={{ gridColumn: '1 / -1', height: virtual.topSpacer }} />}
        {items.slice(virtual.startIndex, virtual.endIndex).map((item) => (
          <AssetCard
            key={item.path}
            item={item}
            isSelected={selected.has(item.path)}
            isCut={!!cutPaths?.has(item.path)}
            isFavorite={isFav(item)}
            label={labelFor(labels, item.path)}
            labelActions={labelActions}
            onSelect={pickItem}
            getDragPaths={getDragPaths}
            onOpen={onOpen}
            onToggleFavorite={onToggleFavorite}
            onRevealInExplorer={onRevealInExplorer}
            onAddToCompare={onAddToCompare}
            compareAssetA={compareAssetA}
            compareAssetB={compareAssetB}
            onSetCompareA={onSetCompareA}
            onSetCompareB={onSetCompareB}
            onOpenExternal={onOpenExternal}
            peekEnabled={item.isDirectory && (canPeekFolder ? canPeekFolder(item.path) : true)}
          />
        ))}
        {virtual.bottomSpacer > 0 && <div style={{ gridColumn: '1 / -1', height: virtual.bottomSpacer }} />}
      </div>
    );
  }

  // The background handlers only act on the empty area: a press or click on a card or row never reaches them
  // as the target, and the list itself is the target when the press lands between items
  // Right-click on the empty space (not on a card, a row or the details header) opens the folder menu (Refresh)
  const handleBackgroundContextMenu = (event) => {
    if (event.target.closest?.('.asset-card, .details-row, .details-header')) return;
    onOpenFolderMenu?.(event);
  };

  return (
    <div
      ref={wrapRef}
      className="asset-view"
      onPointerDown={handleBackgroundPointerDown}
      onClick={handleBackgroundClick}
      onContextMenu={handleBackgroundContextMenu}
    >
      {content}
    </div>
  );
}
