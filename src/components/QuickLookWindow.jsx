import { useEffect, useRef, useState } from 'react';
import { Maximize2, X } from 'lucide-react';
import ImageViewer from './ImageViewer';
import TxTexViewer from './TxTexViewer';
import ImageSequencePlayer from './ImageSequencePlayer';
import VideoPlayer from './VideoPlayer';
import PdfViewer from './PdfViewer';
import AudioPlayer from './AudioPlayer';
import Viewport3D from './Viewport3D';
import HdrExrInspector from './HdrExrInspector';
import { getQuickLookViewer } from '../utils/quickLook';

// The same viewers the full view uses, shown here in a small window with `floating` set (see the .quick-look-window CSS)
const QUICK_LOOK_VIEWERS = {
  studio3d: Viewport3D,
  hdrexr: HdrExrInspector,
  txtex: TxTexViewer,
  image: ImageViewer,
  sequence: ImageSequencePlayer,
  video: VideoPlayer,
  audio: AudioPlayer,
  pdf: PdfViewer
};

const SIZE_KEY = 'quickLookWindowSize';
const DEFAULT_SIZE = { width: 480, height: 320 };

// The size the user last left the window at. Storage can be unavailable, so the default is the fallback.
function loadSavedSize() {
  try {
    const saved = JSON.parse(localStorage.getItem(SIZE_KEY));
    if (saved?.width > 0 && saved?.height > 0) return saved;
  } catch {
    // Not stored yet, or storage is blocked
  }
  return DEFAULT_SIZE;
}

// A small window over the grid. It shows the selected file in its own viewer and follows the selection, so the arrow keys
// (handled by the grid) move through the folder. Space or Esc closes it (hooks/useQuickLook.js). Viewers use `floating`
// to start audio and video by themselves and to leave the arrow keys to the grid.
export default function QuickLookWindow({ asset, folderItems, sequenceGroups, onSelectAsset, onOpenFull, onClose, onRevealInExplorer }) {
  const windowRef = useRef(null);
  const [size] = useState(loadSavedSize);

  // Remember the size the user drags the corner to
  useEffect(() => {
    const el = windowRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      try {
        localStorage.setItem(SIZE_KEY, JSON.stringify({ width: el.offsetWidth, height: el.offsetHeight }));
      } catch {
        // Not remembered when storage is blocked
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Drag by the title bar. The window moves with left / top from then on.
  const onHeaderPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const el = windowRef.current;
    const start = el.getBoundingClientRect();
    const grabX = e.clientX - start.left;
    const grabY = e.clientY - start.top;
    e.preventDefault();
    const onMove = (ev) => {
      const left = Math.max(0, Math.min(ev.clientX - grabX, window.innerWidth - start.width));
      const top = Math.max(0, Math.min(ev.clientY - grabY, window.innerHeight - start.height));
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Double-click opens the full viewer. Buttons, fields and sliders inside the window keep their own clicks.
  const onDoubleClick = (e) => {
    if (e.target.closest('button, input, select, textarea, a, [role="slider"]')) return;
    onOpenFull();
  };

  const viewer = getQuickLookViewer(asset);
  const Viewer = viewer ? QUICK_LOOK_VIEWERS[viewer] : null;
  // Audio, video and image sequences are mounted again per file, so the previous one stops and the next starts
  const viewerKey = viewer === 'audio' || viewer === 'video' || viewer === 'sequence' ? asset.path : viewer;

  return (
    <div
      ref={windowRef}
      className="quick-look-window"
      style={{ width: size.width, height: size.height }}
      role="dialog"
      aria-label={`Quick Look: ${asset.name}`}
      onDoubleClick={onDoubleClick}
    >
      <div className="quick-look-header" onPointerDown={onHeaderPointerDown}>
        <span className="quick-look-title" title={asset.path}>
          {asset.name}
        </span>
        <button type="button" className="quick-look-btn" title="Open full viewer (Enter or double-click)" onClick={onOpenFull}>
          <Maximize2 size={14} />
        </button>
        <button type="button" className="quick-look-btn" title="Close (Space or Esc)" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="quick-look-body">
        {Viewer ? (
          <Viewer
            key={viewerKey}
            asset={asset}
            allFolderItems={viewer === 'sequence' ? sequenceGroups : folderItems}
            onClose={onClose}
            onSelectAsset={onSelectAsset}
            onRevealInExplorer={onRevealInExplorer}
            floating
          />
        ) : (
          <div className="quick-look-empty">No quick preview for this item. Use the arrow keys to move on, or Space to close.</div>
        )}
      </div>
    </div>
  );
}
