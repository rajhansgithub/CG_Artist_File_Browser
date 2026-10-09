import React, { useEffect, useState } from 'react';
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

export default function InspectorDrawer({ item, onClose }) {
  const path = item?.path || '';
  const modified = item?.modified;
  const [info, setInfo] = useState(null); // null while the header is being read
  const [media, setMedia] = useState(null); // { path, width, height, duration } or { path, failed }

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
    <aside className="inspector-drawer" aria-label="Inspector">
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
