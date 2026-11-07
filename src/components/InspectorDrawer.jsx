import React, { useEffect, useRef, useState } from 'react';
import { X, ExternalLink, FolderSearch, FolderOpen, FileQuestion, Plus } from 'lucide-react';
import {
  formatBytes,
  formatDate,
  formatDuration,
  getTypeLabel,
  isComparableItem,
  toStreamUrl
} from '../utils/formatHelpers';
import { getCachedThumbnail } from '../utils/thumbnailService';
import { LABEL_COLORS } from '../utils/fileLabelStore';
import FolderIcon from './FolderIcon';
import { FileLabelPopover } from './LabelPanels';
import '../styles/inspector-drawer.css';

// Details of the selected file, shown beside the folder grid without opening the file. The size in pixels, the colour
// layout, the EXR channels and a video or audio file's codecs, frame rate, sample rate, channels and bit depth come from
// the backend's header read. The duration (and a video's frame size) come from the browser's own metadata, which loads
// only the start of the media file; the backend's reading stands in when the browser cannot play the format.
const INFO_CACHE_LIMIT = 300;
const infoCache = new Map();

function readInfo(item) {
  const key = `${item.path}|${item.modified}`;
  if (infoCache.has(key)) return Promise.resolve(infoCache.get(key));
  const request = window.electronAPI?.getFileInfo ? window.electronAPI.getFileInfo(item.path) : Promise.resolve(null);
  return request.catch(() => null).then((info) => {
    if (infoCache.size >= INFO_CACHE_LIMIT) infoCache.delete(infoCache.keys().next().value);
    infoCache.set(key, info);
    return info;
  });
}

// "Rgba8" → "RGBA, 8-bit", "Rgb32F" → "RGB, 32-bit float"
const COLOUR_NAMES = { L: 'Grey', La: 'Grey and alpha', Rgb: 'RGB', Rgba: 'RGBA' };
function describeColour(colorType) {
  const match = /^(La|Rgba|Rgb|L)(\d+)(F?)$/.exec(colorType || '');
  if (!match) return colorType || '';
  const [, model, bits, float] = match;
  return `${COLOUR_NAMES[model]}, ${bits}-bit${float ? ' float' : ''}`;
}

// 24 → "24 fps", 23.976023976 → "23.976 fps"
function describeFrameRate(fps) {
  return Number.isFinite(fps) && fps > 0 ? `${Number(fps.toFixed(3))} fps` : '';
}

// 48000 → "48 kHz", 44100 → "44.1 kHz"
function describeSampleRate(hz) {
  return hz > 0 ? `${Number((hz / 1000).toFixed(3))} kHz` : '';
}

const CHANNEL_NAMES = { 1: 'Mono', 2: 'Stereo', 6: '5.1', 8: '7.1' };
function describeChannels(count) {
  if (!(count > 0)) return '';
  return CHANNEL_NAMES[count] ? `${CHANNEL_NAMES[count]} (${count})` : `${count} channels`;
}

// The file's average rate: its size over its length, which is what a player's properties show too
function describeBitrate(bytes, seconds) {
  if (!(bytes > 0) || !(seconds > 0)) return '';
  const bitsPerSecond = (bytes * 8) / seconds;
  if (bitsPerSecond >= 1e6) return `${Number((bitsPerSecond / 1e6).toFixed(2))} Mbps`;
  return `${Math.round(bitsPerSecond / 1e3)} kbps`;
}

// A row with no value is left out, so a folder has no Resolution and a plain file has no Channels
function Row({ label, children }) {
  if (!children) return null;
  return (
    <div className="inspector-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// The drawer's width is set by dragging its left edge. The width is kept in this browser, so it is the same next time.
const WIDTH_KEY = 'inspectorDrawerWidth';
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 220;
const MAX_WIDTH = 640;

// Never wider than 60% of the window, so the grid keeps room
function maxWidth() {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(window.innerWidth * 0.6)));
}

function clampWidth(width) {
  return Math.round(Math.min(maxWidth(), Math.max(MIN_WIDTH, width)));
}

function loadWidth() {
  try {
    const saved = Number(window.localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_WIDTH;
  } catch (_) {
    return DEFAULT_WIDTH;
  }
}

function saveWidth(width) {
  try {
    window.localStorage.setItem(WIDTH_KEY, String(width));
  } catch (_) {
    // Storage can be unavailable (private windows, blocked site data): the width then lasts for this session only
  }
}

// Channel views of the preview: one channel shown as grey. Alpha is offered only when the file has one.
const CHANNELS = [
  { id: 'rgb', label: 'RGB' },
  { id: 'r', label: 'R', matrix: '1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1' },
  { id: 'g', label: 'G', matrix: '0 1 0 0 0  0 1 0 0 0  0 1 0 0 0  0 0 0 0 1' },
  { id: 'b', label: 'B', matrix: '0 0 1 0 0  0 0 1 0 0  0 0 1 0 0  0 0 0 0 1' },
  { id: 'a', label: 'A', matrix: '0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 0 1' }
];
const CHANNEL_KINDS = new Set(['image', 'texture', 'hdr']);

// Short names for the maps of a texture set
const ROLE_SHORT = { albedo: 'Color', normal: 'Normal', roughness: 'Rough', metallic: 'Metal', height: 'Height', ao: 'AO', opacity: 'Opacity', specular: 'Spec', emissive: 'Emit', orm: 'ORM' };

function Preview({ item, hasAlpha }) {
  const [channel, setChannel] = useState('rgb');
  const [failed, setFailed] = useState(null);
  const url = item.isDirectory ? null : getCachedThumbnail(item.path) || item.thumbnail || null;
  useEffect(() => setChannel('rgb'), [item.path]);

  if (item.isDirectory) {
    return (
      <div className="inspector-preview empty">
        <FolderIcon item={item} size={56} strokeWidth={1.2} color="var(--accent)" />
      </div>
    );
  }
  if (!url || failed === url) {
    return (
      <div className="inspector-preview empty">
        <FileQuestion size={40} strokeWidth={1.2} />
      </div>
    );
  }
  const channels = CHANNEL_KINDS.has(item.category) ? CHANNELS.filter((c) => c.id !== 'a' || hasAlpha) : [];
  const active = CHANNELS.find((c) => c.id === channel);
  return (
    <div className="inspector-preview">
      {channels.length > 0 && (
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
          {channels
            .filter((c) => c.matrix)
            .map((c) => (
              <filter key={c.id} id={`inspector-ch-${c.id}`} colorInterpolationFilters="sRGB">
                <feColorMatrix type="matrix" values={c.matrix} />
              </filter>
            ))}
        </svg>
      )}
      <img
        src={url}
        alt=""
        draggable={false}
        style={active?.matrix ? { filter: `url(#inspector-ch-${active.id})` } : undefined}
        onError={() => setFailed(url)}
      />
      {channels.length > 0 && (
        <div className="inspector-channels" role="group" aria-label="Channel">
          {channels.map((c) => (
            <button
              key={c.id}
              className={`ch-${c.id} ${channel === c.id ? 'active' : ''}`}
              onClick={() => setChannel(c.id)}
              title={c.id === 'rgb' ? 'All channels' : `Show the ${c.label} channel as grey`}
              aria-pressed={channel === c.id}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function InspectorDrawer({
  item,
  onClose,
  onOpen,
  onReveal,
  compareAssetA,
  compareAssetB,
  onSetCompareA,
  onSetCompareB,
  textureSet,
  onViewTextureSet,
  externalApps,
  onSendToApp,
  label,
  labelActions
}) {
  const [tagAnchor, setTagAnchor] = useState(null);
  const path = item?.path || '';
  const modified = item?.modified;
  const [info, setInfo] = useState(null); // null while the header is being read
  const [media, setMedia] = useState(null); // { path, width, height, duration } or { path, failed }
  const [width, setWidth] = useState(loadWidth);
  const [resizing, setResizing] = useState(false);
  const drag = useRef(null); // { startX, startWidth, latest } while the edge is being dragged

  // The cursor stays a resize cursor while dragging, even when it leaves the edge
  useEffect(() => {
    document.body.classList.toggle('inspector-resizing', resizing);
    return () => document.body.classList.remove('inspector-resizing');
  }, [resizing]);

  const startResize = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width, latest: width };
    setResizing(true);
  };

  // The edge is on the left, so dragging left widens the drawer
  const moveResize = (e) => {
    if (!drag.current) return;
    drag.current.latest = clampWidth(drag.current.startWidth - (e.clientX - drag.current.startX));
    setWidth(drag.current.latest);
  };

  const endResize = () => {
    if (!drag.current) return;
    saveWidth(drag.current.latest);
    drag.current = null;
    setResizing(false);
  };

  const shownWidth = clampWidth(width);

  useEffect(() => {
    let stale = false;
    setInfo(null);
    if (!item) return undefined;
    readInfo(item).then((res) => {
      if (!stale) setInfo(res || {});
    });
    return () => {
      stale = true;
    };
  }, [path, modified]);

  // Media metadata belongs to one file, so a new selection starts over
  const mediaForItem = media && media.path === path ? media : null;
  const isMedia = item?.category === 'video' || item?.category === 'audio';
  const duration = Number.isFinite(mediaForItem?.duration) ? mediaForItem.duration : info?.duration;
  const hasHeaderDetails = Boolean(info?.duration || info?.videoCodec || info?.audioCodec);

  return (
    <aside className="inspector-drawer" aria-label="Inspector" style={{ width: shownWidth }}>
      <div
        className={`inspector-resize-handle ${resizing ? 'resizing' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the Inspector"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={maxWidth()}
        aria-valuenow={shownWidth}
        title="Drag to resize"
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      />
      <button className="inspector-close" onClick={onClose} title="Hide the Inspector (I)" aria-label="Hide the Inspector">
        <X size={13} />
      </button>

      {!item ? (
        <p className="inspector-empty">Select a file or folder to see its details here.</p>
      ) : (
        <div className="inspector-body">
          <Preview item={item} hasAlpha={/^(La|Rgba)/.test(info?.colorType || '')} />
          <div className="inspector-title">
            <span className="inspector-name" title={item.name}>{item.name}</span>
            {!item.isDirectory && <span className="inspector-pill">{(item.extension || '').replace(/^\./, '').toUpperCase()}</span>}
          </div>

          {/* One click each: open, Compare slots, reveal */}
          <div className="inspector-actions">
            <button className="ins-act primary" onClick={() => onOpen?.(item)} title={item.isDirectory ? 'Open folder' : 'Open in Viewer'}>
              {item.isDirectory ? <FolderOpen size={14} /> : <ExternalLink size={14} />}
              <span>Open</span>
            </button>
            {isComparableItem(item) && (
              <>
                <button
                  className={`ins-act slot-a ${compareAssetA?.path === item.path ? 'active' : ''}`}
                  onClick={() => onSetCompareA?.(item)}
                  title={compareAssetA?.path === item.path ? 'Assigned as A' : 'Set as A (Compare)'}
                >
                  A
                </button>
                <button
                  className={`ins-act slot-b ${compareAssetB?.path === item.path ? 'active' : ''}`}
                  onClick={() => onSetCompareB?.(item)}
                  title={compareAssetB?.path === item.path ? 'Assigned as B' : 'Set as B (Compare)'}
                >
                  B
                </button>
              </>
            )}
            <button className="ins-act square" onClick={() => onReveal?.(item.path)} title="Reveal in Windows Explorer" aria-label="Reveal in Windows Explorer">
              <FolderSearch size={14} />
            </button>
          </div>

          {/* preload="metadata" reads the start of the file only: nothing plays and nothing is buffered */}
          {isMedia && item.category === 'video' && (
            <video
              key={path}
              className="inspector-probe"
              src={toStreamUrl(path)}
              preload="metadata"
              muted
              onLoadedMetadata={(e) => setMedia({ path, width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight, duration: e.currentTarget.duration })}
              onError={() => setMedia({ path, failed: true })}
            />
          )}
          {isMedia && item.category === 'audio' && (
            <audio
              key={path}
              className="inspector-probe"
              src={toStreamUrl(path)}
              preload="metadata"
              onLoadedMetadata={(e) => setMedia({ path, duration: e.currentTarget.duration })}
              onError={() => setMedia({ path, failed: true })}
            />
          )}

          <dl className="inspector-list">
            <Row label="Type">{getTypeLabel(item)}</Row>
            <Row label="Size">{item.isDirectory ? '' : formatBytes(item.size)}</Row>
            <Row label="Resolution">
              {isMedia && mediaForItem?.width
                ? `${mediaForItem.width} × ${mediaForItem.height} px`
                : info?.width && info?.height
                  ? `${info.width} × ${info.height} px`
                  : ''}
            </Row>
            <Row label="Colour">{describeColour(info?.colorType)}</Row>
            {info?.channels?.length > 0 && <Row label="Channels">{info.channels.join(', ')}</Row>}
            {info?.sampleType && <Row label="Sample type">{info.sampleType}</Row>}
            {info?.compression && <Row label="Compression">{info.compression}</Row>}
            {info?.parts > 1 && <Row label="Parts">{info.parts}</Row>}
            {Number.isFinite(duration) && <Row label="Duration">{formatDuration(duration)}</Row>}
            <Row label="Video codec">{info?.videoCodec}</Row>
            <Row label="Frame rate">{describeFrameRate(info?.frameRate)}</Row>
            <Row label="Audio codec">{info?.audioCodec}</Row>
            <Row label="Sample rate">{describeSampleRate(info?.sampleRate)}</Row>
            <Row label="Channels">{describeChannels(info?.audioChannels)}</Row>
            <Row label="Bit depth">{info?.bitDepth > 0 ? `${info.bitDepth}-bit` : ''}</Row>
            {isMedia && <Row label="Bitrate">{describeBitrate(item.size, duration)}</Row>}
            {mediaForItem?.failed && !hasHeaderDetails && <Row label="Media">Could not read the media details</Row>}
            <Row label="Created">{info?.created ? formatDate(info.created) : info === null ? 'Reading…' : ''}</Row>
            <Row label="Modified">{formatDate(item.modified)}</Row>
          </dl>

          {textureSet && (
            <div className="inspector-section">
              <h4>Texture set · {textureSet.base}</h4>
              <button className="inspector-set" onClick={() => onViewTextureSet?.(textureSet)} title="View as texture set">
                {textureSet.maps.slice(0, 4).map((m) => {
                  const url = getCachedThumbnail(m.item.path) || m.item.thumbnail;
                  return (
                    <span key={m.role} className={`set-map ${m.item.path === item.path ? 'current' : ''}`} title={m.item.name}>
                      {url ? <img src={url} alt="" draggable={false} /> : null}
                      <em>{ROLE_SHORT[m.role] || m.label}</em>
                    </span>
                  );
                })}
                {textureSet.maps.length > 4 && <span className="set-map more">+{textureSet.maps.length - 4}</span>}
              </button>
            </div>
          )}

          {labelActions && (
            <div className="inspector-section">
              <h4>Labels</h4>
              <div className="inspector-colors" role="group" aria-label="Colour label">
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c.id}
                    className={label?.color === c.id ? 'active' : ''}
                    style={{ background: c.hex, color: c.hex }}
                    onClick={() => labelActions.setColor([item.path], label?.color === c.id ? null : c.id)}
                    title={label?.color === c.id ? `Remove ${c.name}` : c.name}
                    aria-label={c.name}
                    aria-pressed={label?.color === c.id}
                  />
                ))}
              </div>
              <div className="inspector-tags">
                {(label?.tags || []).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
                <button
                  className="add"
                  onClick={(e) => {
                    const button = e.currentTarget;
                    setTagAnchor((a) => (a ? null : button));
                  }}
                  title="Edit tags"
                >
                  <Plus size={11} /> tag
                </button>
              </div>
              {tagAnchor && (
                <FileLabelPopover
                  anchor={tagAnchor}
                  label={label || { color: null, tags: [] }}
                  onSetColor={(color) => labelActions.setColor([item.path], color)}
                  onAddTag={(tag) => labelActions.editTags([item.path], [tag], [])}
                  onRemoveTag={(tag) => labelActions.editTags([item.path], [], [tag])}
                  onClose={() => setTagAnchor(null)}
                />
              )}
            </div>
          )}

          {!item.isDirectory && externalApps?.length > 0 && (
            <div className="inspector-section">
              <h4>Send to</h4>
              <div className="inspector-tags">
                {externalApps.map((app) => (
                  <button key={app.path} className="app" onClick={() => onSendToApp?.([item], app)} title={`Open in ${app.name}`}>
                    {app.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="inspector-path" title={item.path}>
            <FolderIcon item={{ path: item.path.replace(/[\\/][^\\/]*$/, '') }} size={12} />
            <span>{item.path}</span>
          </div>
        </div>
      )}
    </aside>
  );
}
