import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { formatBytes, formatDate, formatDuration, getTypeLabel, toStreamUrl } from '../utils/formatHelpers';
import '../styles/inspector-drawer.css';

// Details of the selected file, shown beside the folder grid without opening the file. The size in pixels, the colour
// layout and the EXR channels come from the backend's header read. The duration (and a video's frame size) come from
// the browser's own metadata, which loads only the start of the media file.
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

export default function InspectorDrawer({ item, onClose }) {
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
      <div className="inspector-header">
        <span>Inspector</span>
        <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={onClose} title="Hide the Inspector (I)" aria-label="Hide the Inspector">
          <X size={13} />
        </button>
      </div>

      {!item ? (
        <p className="inspector-empty">Select a file or folder to see its details here.</p>
      ) : (
        <div className="inspector-body">
          {item.thumbnail && <img className="inspector-thumb" src={item.thumbnail} alt="" draggable={false} />}
          <div className="inspector-name" title={item.name}>{item.name}</div>

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
              {info?.width && info?.height ? `${info.width} × ${info.height} px` : mediaForItem?.width ? `${mediaForItem.width} × ${mediaForItem.height} px` : ''}
            </Row>
            <Row label="Colour">{describeColour(info?.colorType)}</Row>
            {info?.channels?.length > 0 && <Row label="Channels">{info.channels.join(', ')}</Row>}
            {info?.sampleType && <Row label="Sample type">{info.sampleType}</Row>}
            {info?.compression && <Row label="Compression">{info.compression}</Row>}
            {info?.parts > 1 && <Row label="Parts">{info.parts}</Row>}
            {Number.isFinite(mediaForItem?.duration) && <Row label="Duration">{formatDuration(mediaForItem.duration)}</Row>}
            {mediaForItem?.failed && <Row label="Media">Could not read the media details</Row>}
            <Row label="Created">{info?.created ? formatDate(info.created) : info === null ? 'Reading…' : ''}</Row>
            <Row label="Modified">{formatDate(item.modified)}</Row>
          </dl>

          <div className="inspector-path" title={item.path}>{item.path}</div>
        </div>
      )}
    </aside>
  );
}
