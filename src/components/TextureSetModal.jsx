import React, { useEffect, useState } from 'react';
import { Layers, X } from 'lucide-react';
import { getOrGenerateThumbnail } from '../utils/thumbnailService';

// One map of a texture set: its thumbnail, role and file name. Clicking it opens that map in its viewer.
function TextureMapCard({ map, onOpen }) {
  const [thumbUrl, setThumbUrl] = useState(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    getOrGenerateThumbnail(map.item, { signal: controller.signal }).then((url) => {
      if (active && url) setThumbUrl(url);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [map.item]);

  return (
    <button type="button" className="texture-set-card" onClick={() => onOpen(map.item)} title={map.item.name}>
      <div className="texture-set-thumb">{thumbUrl && <img src={thumbUrl} alt="" draggable={false} />}</div>
      <span className="texture-set-role">{map.label}</span>
      <span className="texture-set-name">{map.item.name}</span>
    </button>
  );
}

// Shows the maps of a texture set side by side. The files stay where they are: this only groups them for viewing.
export default function TextureSetModal({ set, onOpenMap, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card texture-set-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Layers size={16} color="var(--text-main)" />
            <span className="texture-set-title">{set.base}</span>
            <span className="texture-set-count">{set.maps.length} maps</span>
          </div>
          <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="texture-set-grid">
            {set.maps.map((map) => (
              <TextureMapCard key={map.item.path} map={map} onOpen={onOpenMap} />
            ))}
          </div>
        </div>

        <div className="modal-footer" style={{ justifyContent: 'flex-start' }}>
          <span className="texture-set-hint">Click a map to open it. The files stay in their folder.</span>
        </div>
      </div>
    </div>
  );
}
