import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Columns,
  ArrowLeftRight,
  Split,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Link as LinkIcon,
  Unlink,
  Film,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Sliders,
  Layers,
  Image as ImageIcon,
  Box as BoxIcon
} from 'lucide-react';
import { loadImageAsset } from '../utils/imageDecoder';
import { toStreamUrl } from '../utils/assetLoader';
import { formatBytes, getCompareKind, isComparableItem } from '../utils/formatHelpers';
import CompareModelPane from './CompareModelPane';
import CompareVideoTransport from './CompareVideoTransport';

const KIND_LABELS = { image: 'IMAGE', model: '3D MODEL', video: 'VIDEO' };
const SHADING_MODES = [
  { id: 'lit', label: 'Lit' },
  { id: 'wire', label: 'Wire' },
  { id: 'clay', label: 'Clay' },
  { id: 'normals', label: 'Normals' }
];

export default function CompareView({
  folderItems = [],
  initialAssetA,
  initialAssetB,
  onClose,
  onRevealInExplorer
}) {
  // What is being compared: 'image', 'model' (3D) or 'video'. Slots A and B always hold the same kind.
  const [kind, setKind] = useState(
    () => getCompareKind(initialAssetA) || getCompareKind(initialAssetB) || 'image'
  );

  // Folder items that can be compared with the current kind (HDR/EXR, audio and PDFs are not comparable)
  const itemsOfKind = (k) => (folderItems || []).filter((i) => getCompareKind(i) === k);
  const eligibleItems = itemsOfKind(kind);

  // Asset selection state - only pick items of the active kind
  const [assetA, setAssetA] = useState(() => {
    if (initialAssetA && getCompareKind(initialAssetA) === kind) return initialAssetA;
    return eligibleItems[0] || null;
  });
  const [assetB, setAssetB] = useState(() => {
    if (initialAssetB && getCompareKind(initialAssetB) === kind) return initialAssetB;
    return eligibleItems.length > 1 ? eligibleItems[1] : (eligibleItems[0] || null);
  });

  const initialPathsRef = useRef({ a: initialAssetA?.path, b: initialAssetB?.path });

  // Switch to another kind of comparison and pick two starting assets of that kind
  const switchKind = (nextKind, preferA = null, preferB = null) => {
    const pool = itemsOfKind(nextKind);
    const a = preferA && getCompareKind(preferA) === nextKind ? preferA : pool[0] || null;
    const b =
      preferB && getCompareKind(preferB) === nextKind
        ? preferB
        : pool.find((i) => i.path !== a?.path) || pool[0] || null;
    setKind(nextKind);
    setAssetA(a);
    setAssetB(b);
  };

  useEffect(() => {
    if (initialAssetA && isComparableItem(initialAssetA)) {
      const nextKind = getCompareKind(initialAssetA);
      // A slot filled with another kind switches the whole comparison, except for the starting pair
      if (nextKind !== kind) {
        if (initialPathsRef.current.a !== initialAssetA.path) switchKind(nextKind, initialAssetA, initialAssetB);
      } else {
        setAssetA(initialAssetA);
      }
    } else if (!assetA && eligibleItems.length > 0) {
      setAssetA(eligibleItems[0]);
    }
  }, [initialAssetA?.path, eligibleItems.length]);

  useEffect(() => {
    if (initialAssetB && isComparableItem(initialAssetB)) {
      const nextKind = getCompareKind(initialAssetB);
      if (nextKind !== kind) {
        if (initialPathsRef.current.b !== initialAssetB.path) switchKind(nextKind, initialAssetA, initialAssetB);
      } else {
        setAssetB(initialAssetB);
      }
    } else if (!assetB && eligibleItems.length > 1) {
      setAssetB(eligibleItems[1]);
    }
  }, [initialAssetB?.path, eligibleItems.length]);

  // Comparison mode: 'wipe' (Split-Screen Wipe Slider), 'split' (Side-by-Side), 'toggle' (A/B Flicker), 'diff' (Difference Map)
  const [compareMode, setCompareMode] = useState('wipe');

  // Zoom and Pan state
  const [zoom, setZoom] = useState(1.0); // 1.0 = Fit to viewport
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Sync state: for 3D models this links the two cameras (orbit one, the other follows)
  const [syncPanZoom, setSyncPanZoom] = useState(true);

  // Zoom mode: 'fit' (Feature-normalized) vs 'pixel1to1' (Native 1:1 pixel match)
  const [zoomAlignment, setZoomAlignment] = useState('normalized'); // 'normalized' | '1to1'

  // Wipe Splitter position (percentage from 0 to 100)
  const [splitPos, setSplitPos] = useState(50);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);

  // A/B Toggle mode active slot
  const [toggleActive, setToggleActive] = useState('A');

  // Difference gain multiplier
  const [diffGain, setDiffGain] = useState(3);

  // Bottom thumbnail strip collapse state
  const [showFilmstrip, setShowFilmstrip] = useState(true);

  // Decoded image data
  const [dataA, setDataA] = useState(null);
  const [dataB, setDataB] = useState(null);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);

  // Video clips: native size of each clip once its metadata is known
  const [videoDimsA, setVideoDimsA] = useState(null);
  const [videoDimsB, setVideoDimsB] = useState(null);
  const videoARef = useRef(null);
  const videoBRef = useRef(null);
  const transportRef = useRef(null);

  // 3D models: one pane per slot, shading shared by both, load status per slot
  const paneARef = useRef(null);
  const paneBRef = useRef(null);
  const [shading, setShading] = useState('lit');
  const [modelStatusA, setModelStatusA] = useState({ loading: false, error: null, stats: null });
  const [modelStatusB, setModelStatusB] = useState({ loading: false, error: null, stats: null });

  // Container measurement
  const containerRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ width: 1200, height: 700 });

  // Update container size on resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          setContainerSize({
            width: entry.contentRect.width,
            height: entry.contentRect.height
          });
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [eligibleItems.length === 0]);

  // Load Asset A
  useEffect(() => {
    if (!assetA || kind !== 'image') {
      setDataA(null);
      setLoadingA(false);
      return;
    }

    let isMounted = true;
    setLoadingA(true);
    loadImageAsset(assetA).then((res) => {
      if (isMounted) {
        setDataA(res);
        setLoadingA(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [assetA?.path, kind]);

  // Load Asset B
  useEffect(() => {
    if (!assetB || kind !== 'image') {
      setDataB(null);
      setLoadingB(false);
      return;
    }

    let isMounted = true;
    setLoadingB(true);
    loadImageAsset(assetB).then((res) => {
      if (isMounted) {
        setDataB(res);
        setLoadingB(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [assetB?.path, kind]);

  useEffect(() => setVideoDimsA(null), [assetA?.path]);
  useEffect(() => setVideoDimsB(null), [assetB?.path]);

  // Copy the camera of one model pane onto the other (only while the cameras are linked)
  const handleCameraChange = (slot, cam) => {
    if (!syncPanZoom) return;
    (slot === 'A' ? paneBRef : paneARef).current?.applyCamera(cam);
  };

  const handleModelStatus = (slot, status) => {
    (slot === 'A' ? setModelStatusA : setModelStatusB)(status);
    // First time both are on screen, or when a new model arrives: show B from exactly A's camera
    if (status.loaded && syncPanZoom) {
      const cam = paneARef.current?.getCamera();
      if (cam) paneBRef.current?.applyCamera(cam);
    }
  };

  // Reset transforms (for 3D models: frame the models again)
  const resetTransform = useCallback(() => {
    if (kind === 'model') {
      paneARef.current?.frame();
      if (syncPanZoom) {
        const cam = paneARef.current?.getCamera();
        if (cam) paneBRef.current?.applyCamera(cam);
      } else {
        paneBRef.current?.frame();
      }
      return;
    }
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  }, [kind, syncPanZoom]);

  // Turning the link back on snaps B to A's current view
  const toggleSync = () => {
    const next = !syncPanZoom;
    setSyncPanZoom(next);
    if (next && kind === 'model') {
      const cam = paneARef.current?.getCamera();
      if (cam) paneBRef.current?.applyCamera(cam);
    }
  };

  // Swap Asset A and Asset B
  const swapAssets = () => {
    const temp = assetA;
    setAssetA(assetB);
    setAssetB(temp);
  };

  // Step prev/next asset in list for slot
  const stepAsset = (slot, direction) => {
    const current = slot === 'A' ? assetA : assetB;
    const curIdx = eligibleItems.findIndex((i) => i.path === current?.path);
    let nextIdx = curIdx + direction;
    if (nextIdx < 0) nextIdx = eligibleItems.length - 1;
    if (nextIdx >= eligibleItems.length) nextIdx = 0;
    const nextItem = eligibleItems[nextIdx];
    if (nextItem) {
      if (slot === 'A') setAssetA(nextItem);
      else setAssetB(nextItem);
    }
  };

  // The pixel difference map only makes sense for images and video frames
  useEffect(() => {
    if (kind === 'model' && compareMode === 'diff') setCompareMode('wipe');
  }, [kind, compareMode]);

  // Keyboard shortcut listener (Spacebar for A/B Toggle; X instead of Space for video, where Space plays)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.code === 'Space' && kind !== 'video') {
        e.preventDefault();
        setToggleActive((prev) => (prev === 'A' ? 'B' : 'A'));
      } else if ((e.key === 'x' || e.key === 'X') && kind === 'video') {
        setToggleActive((prev) => (prev === 'A' ? 'B' : 'A'));
      } else if (e.key === '1') {
        setCompareMode('wipe');
      } else if (e.key === '2') {
        setCompareMode('split');
      } else if (e.key === '3') {
        setCompareMode('toggle');
      } else if (e.key === '4' && kind !== 'model') {
        setCompareMode('diff');
      } else if (e.key === 'r' || e.key === 'R' || ((e.key === 'f' || e.key === 'F') && kind === 'model')) {
        resetTransform();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [resetTransform, kind]);

  // Handle Mouse Wheel Zoom (3D models zoom their camera instead)
  const handleWheel = (e) => {
    if (kind === 'model') return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoom((prev) => Math.min(32.0, Math.max(0.05, prev * factor)));
  };

  // Mouse pan handlers
  const handleMouseDown = (e) => {
    // Only left click initiates panning (3D models orbit with their own controls)
    if (e.button !== 0 || kind === 'model') return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e) => {
    if (isDraggingSplitter && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const clientX = e.clientX;
      const pct = Math.max(1, Math.min(99, ((clientX - rect.left) / rect.width) * 100));
      setSplitPos(pct);
      return;
    }

    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setIsDraggingSplitter(false);
  };

  // Media for each slot: a decoded image, or a video clip streamed straight from disk
  const videoMedia = (asset, dims) =>
    asset ? { url: toStreamUrl(asset.path), width: dims?.width || 0, height: dims?.height || 0 } : null;
  const mediaA = kind === 'video' ? videoMedia(assetA, videoDimsA) : dataA;
  const mediaB = kind === 'video' ? videoMedia(assetB, videoDimsB) : dataB;

  const handleVideoMetadata = (slot, e) => {
    const dims = { width: e.target.videoWidth, height: e.target.videoHeight };
    (slot === 'A' ? setVideoDimsA : setVideoDimsB)(dims);
    // A freshly mounted <video> (compare mode changed) must jump to the shared time again
    transportRef.current?.syncNow();
  };

  const renderMedia = (slot, style) => {
    const media = slot === 'A' ? mediaA : mediaB;
    const asset = slot === 'A' ? assetA : assetB;
    if (kind === 'video') {
      return (
        <video
          ref={slot === 'A' ? videoARef : videoBRef}
          src={media.url}
          preload="auto"
          muted
          playsInline
          draggable={false}
          onLoadedMetadata={(e) => handleVideoMetadata(slot, e)}
          style={style}
        />
      );
    }
    return <img src={media.url} alt={asset?.name} draggable={false} style={style} />;
  };

  // Compute scale and position for Image A and Image B
  const hasImages = Boolean(mediaA?.url && mediaB?.url);

  // Viewport dimensions
  const vpWidth = compareMode === 'split' ? containerSize.width / 2 : containerSize.width;
  const vpHeight = containerSize.height;

  // Fit calculations
  const wA = mediaA?.width || 1920;
  const hA = mediaA?.height || 1080;
  const wB = mediaB?.width || 1920;
  const hB = mediaB?.height || 1080;

  // Scaled dimensions depending on alignment mode
  let renderScaleA = 1.0;
  let renderScaleB = 1.0;

  if (zoomAlignment === 'normalized') {
    // Align Features: the larger picture (most pixels) is the reference. It is fitted to the
    // viewport, and the other picture is scaled to cover the same box, keeping its aspect ratio
    // (a different shape is centred, never stretched or cropped). Pan and zoom then move both together.
    const aIsRef = wA * hA >= wB * hB;
    const refW = aIsRef ? wA : wB;
    const refH = aIsRef ? hA : hB;
    const refFit = Math.min(vpWidth / refW, vpHeight / refH, 1.0);
    renderScaleA = refFit * Math.min(refW / wA, refH / hA) * zoom;
    renderScaleB = refFit * Math.min(refW / wB, refH / hB) * zoom;
  } else {
    // 1:1 Native Pixel Match (1 image pixel = 1 screen pixel at zoom=1)
    renderScaleA = zoom;
    renderScaleB = zoom;
  }

  const dispWidthA = wA * renderScaleA;
  const dispHeightA = hA * renderScaleA;
  const dispWidthB = wB * renderScaleB;
  const dispHeightB = hB * renderScaleB;

  // Offsets to center images in viewport
  const offsetX_A = (vpWidth - dispWidthA) / 2 + pan.x;
  const offsetY_A = (vpHeight - dispHeightA) / 2 + pan.y;

  const offsetX_B = (vpWidth - dispWidthB) / 2 + pan.x;
  const offsetY_B = (vpHeight - dispHeightB) / 2 + pan.y;

  // Short size tag and badge text for a slot: pixels for images and video, triangle count for models
  const formatCount = (n) =>
    n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);
  const slotTag = (slot) => {
    if (kind === 'model') {
      const stats = (slot === 'A' ? modelStatusA : modelStatusB).stats;
      return stats ? `${formatCount(stats.triangles)} tris` : '...';
    }
    return slot === 'A' ? `${wA}×${hA}` : `${wB}×${hB}`;
  };
  const slotInfo = (slot) => `${slotTag(slot)} • ${formatBytes((slot === 'A' ? assetA : assetB)?.size)}`;

  const modelStage = kind === 'model' && Boolean(assetA && assetB);

  // Where each 3D pane sits for the active compare mode. The panes stay mounted across modes.
  const paneBoxStyle = (slot) => {
    const base = { position: 'absolute', top: 0, bottom: 0, overflow: 'hidden', background: '#080808' };
    if (compareMode === 'split') {
      return slot === 'A'
        ? { ...base, left: 0, width: 'calc(50% - 1px)' }
        : { ...base, right: 0, width: 'calc(50% - 1px)' };
    }
    if (compareMode === 'toggle') {
      return { ...base, left: 0, right: 0, visibility: toggleActive === slot ? 'visible' : 'hidden' };
    }
    return {
      ...base,
      left: 0,
      right: 0,
      clipPath:
        slot === 'A'
          ? `polygon(0 0, ${splitPos}% 0, ${splitPos}% 100%, 0 100%)`
          : `polygon(${splitPos}% 0, 100% 0, 100% 100%, ${splitPos}% 100%)`
    };
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        background: '#0a0a0a',
        userSelect: 'none'
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* ─── TOP CONTROL BAR (IMAGE COMPARISON HEADER) ─── */}
      <div
        style={{
          minHeight: 52,
          background: '#111111',
          borderBottom: '1px solid #222222',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 14px',
          gap: 12,
          flexWrap: 'wrap',
          zIndex: 40
        }}
      >
        {/* Brand / Mode Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 4,
              background: '#222222',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #333333'
            }}
          >
            <Split size={14} color="#ffffff" />
          </div>
          <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.04em', color: '#eeeeee' }}>
            {KIND_LABELS[kind]} COMPARISON
          </span>

          {/* What to compare: images, 3D models (synced camera) or video clips (synced frames) */}
          <div
            style={{
              display: 'flex',
              background: '#161616',
              padding: 2,
              borderRadius: 6,
              border: '1px solid #262626'
            }}
          >
            {[
              { id: 'image', label: 'Images', Icon: ImageIcon },
              { id: 'model', label: '3D', Icon: BoxIcon },
              { id: 'video', label: 'Video', Icon: Film }
            ].map(({ id, label, Icon }) => (
              <button
                key={id}
                className={`filter-btn ${kind === id ? 'active' : ''}`}
                style={{ height: 26, fontSize: 11, padding: '0 8px' }}
                onClick={() => kind !== id && switchKind(id, assetA, assetB)}
                title={
                  id === 'model'
                    ? 'Compare two 3D models with a synced camera'
                    : id === 'video'
                    ? 'Compare two video clips with synced playback'
                    : 'Compare two images'
                }
              >
                <Icon size={12} style={{ marginRight: 4 }} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ─── SLOT A SELECTOR ─── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: '#181818',
            padding: '4px 8px',
            borderRadius: 6,
            border: '1px solid #2a2a2a'
          }}
        >
          <span
            style={{
              padding: '2px 6px',
              borderRadius: 3,
              background: '#ffffff',
              color: '#000000',
              fontWeight: 800,
              fontSize: 11
            }}
          >
            A
          </span>
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            onClick={() => stepAsset('A', -1)}
            title="Previous Asset for Slot A"
          >
            <ChevronLeft size={13} />
          </button>
          <select
            className="filter-btn"
            style={{ maxWidth: 200, fontSize: 12, height: 26 }}
            value={assetA?.path || ''}
            onChange={(e) => {
              const item = eligibleItems.find((i) => i.path === e.target.value);
              setAssetA(item);
            }}
          >
            {eligibleItems.map((item) => (
              <option key={item.path} value={item.path}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            onClick={() => stepAsset('A', 1)}
            title="Next Asset for Slot A"
          >
            <ChevronRight size={13} />
          </button>

          {mediaA?.width > 0 && (
            <span style={{ fontSize: 11, color: '#888888', marginLeft: 4, fontFamily: 'monospace' }}>
              {mediaA.width}×{mediaA.height}
            </span>
          )}
        </div>

        {/* ─── SWAP A & B BUTTON ─── */}
        <button
          className="icon-btn"
          style={{
            width: 32,
            height: 32,
            background: '#1c1c1c',
            border: '1px solid #333333'
          }}
          onClick={swapAssets}
          title="Swap Slot A and Slot B [A ⇄ B]"
        >
          <ArrowLeftRight size={14} color="#ffffff" />
        </button>

        {/* ─── SLOT B SELECTOR ─── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: '#181818',
            padding: '4px 8px',
            borderRadius: 6,
            border: '1px solid #2a2a2a'
          }}
        >
          <span
            style={{
              padding: '2px 6px',
              borderRadius: 3,
              background: '#888888',
              color: '#000000',
              fontWeight: 800,
              fontSize: 11
            }}
          >
            B
          </span>
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            onClick={() => stepAsset('B', -1)}
            title="Previous Asset for Slot B"
          >
            <ChevronLeft size={13} />
          </button>
          <select
            className="filter-btn"
            style={{ maxWidth: 200, fontSize: 12, height: 26 }}
            value={assetB?.path || ''}
            onChange={(e) => {
              const item = eligibleItems.find((i) => i.path === e.target.value);
              setAssetB(item);
            }}
          >
            {eligibleItems.map((item) => (
              <option key={item.path} value={item.path}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            onClick={() => stepAsset('B', 1)}
            title="Next Asset for Slot B"
          >
            <ChevronRight size={13} />
          </button>

          {mediaB?.width > 0 && (
            <span style={{ fontSize: 11, color: '#888888', marginLeft: 4, fontFamily: 'monospace' }}>
              {mediaB.width}×{mediaB.height}
            </span>
          )}
        </div>

        {/* ─── COMPARISON MODE SWITCHER ─── */}
        <div
          style={{
            display: 'flex',
            background: '#161616',
            padding: 2,
            borderRadius: 6,
            border: '1px solid #262626'
          }}
        >
          <button
            className={`filter-btn ${compareMode === 'wipe' ? 'active' : ''}`}
            style={{ height: 26, fontSize: 11, padding: '0 8px' }}
            onClick={() => setCompareMode('wipe')}
            title="Split-Screen Wipe Slider (Drag Handle) [Key 1]"
          >
            <Split size={12} style={{ marginRight: 4 }} />
            Wipe
          </button>
          <button
            className={`filter-btn ${compareMode === 'split' ? 'active' : ''}`}
            style={{ height: 26, fontSize: 11, padding: '0 8px' }}
            onClick={() => setCompareMode('split')}
            title="Side-by-Side Dual Viewport [Key 2]"
          >
            <Columns size={12} style={{ marginRight: 4 }} />
            Side-by-Side
          </button>
          <button
            className={`filter-btn ${compareMode === 'toggle' ? 'active' : ''}`}
            style={{ height: 26, fontSize: 11, padding: '0 8px' }}
            onClick={() => setCompareMode('toggle')}
            title="A/B Quick Flicker Toggle (Spacebar) [Key 3]"
          >
            <Layers size={12} style={{ marginRight: 4 }} />
            A/B Toggle
          </button>
          <button
            className={`filter-btn ${compareMode === 'diff' ? 'active' : ''}`}
            style={{ height: 26, fontSize: 11, padding: '0 8px', opacity: kind === 'model' ? 0.4 : 1 }}
            disabled={kind === 'model'}
            onClick={() => setCompareMode('diff')}
            title={kind === 'model' ? 'Difference map is not available for 3D models' : 'Pixel Difference Map [Key 4]'}
          >
            <Sliders size={12} style={{ marginRight: 4 }} />
            Diff
          </button>
        </div>

        {/* ─── ZOOM & ALIGNMENT CONTROLS ─── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Zoom Alignment Mode: Normalized (Features align) vs 1:1 (Native pixels) */}
          {kind !== 'model' && (
          <button
            className={`filter-btn ${zoomAlignment === 'normalized' ? 'active' : ''}`}
            style={{ height: 26, fontSize: 11, padding: '0 7px' }}
            onClick={() =>
              setZoomAlignment((prev) => (prev === 'normalized' ? '1to1' : 'normalized'))
            }
            title={
              zoomAlignment === 'normalized'
                ? 'Align Features: the smaller picture is scaled up to match the larger one, so both cover the same area'
                : '1:1 Pixel Match: 1 screen pixel = 1 native image texel'
            }
          >
            {zoomAlignment === 'normalized' ? 'Align Features' : '1:1 Pixels'}
          </button>
          )}

          {/* Sync Toggle: pan & zoom for images, the shared camera for 3D models (video is always in step) */}
          {kind !== 'video' && (
          <button
            className={`icon-btn ${syncPanZoom ? 'active' : ''}`}
            style={{ width: 26, height: 26 }}
            onClick={toggleSync}
            title={
              kind === 'model'
                ? syncPanZoom
                  ? 'Sync Camera: Locked (orbit one model, the other follows)'
                  : 'Sync Camera: Independent'
                : syncPanZoom
                ? 'Sync Pan & Zoom: Locked'
                : 'Sync Pan & Zoom: Independent'
            }
          >
            {syncPanZoom ? <LinkIcon size={13} /> : <Unlink size={13} />}
          </button>
          )}

          {/* Zoom Out / In (3D models zoom with the mouse wheel) */}
          {kind !== 'model' && (
          <>
          <button
            className="icon-btn"
            style={{ width: 26, height: 26 }}
            onClick={() => setZoom((prev) => Math.max(0.1, prev * 0.8))}
            title="Zoom Out"
          >
            <ZoomOut size={13} />
          </button>

          <span
            style={{
              fontSize: 11,
              fontFamily: 'monospace',
              minWidth: 42,
              textAlign: 'center',
              color: '#cccccc'
            }}
          >
            {Math.round(zoom * 100)}%
          </span>

          <button
            className="icon-btn"
            style={{ width: 26, height: 26 }}
            onClick={() => setZoom((prev) => Math.min(32.0, prev * 1.25))}
            title="Zoom In"
          >
            <ZoomIn size={13} />
          </button>
          </>
          )}

          {/* Reset View */}
          <button
            className="icon-btn"
            style={{ width: 26, height: 26 }}
            onClick={resetTransform}
            title={
              kind === 'model'
                ? 'Frame both models [Key R or F]'
                : 'Reset Pan & Zoom (Fit to Screen) [Key R]'
            }
          >
            <RotateCcw size={13} />
          </button>

          {/* Close button */}
          <button
            className="icon-btn"
            style={{ width: 28, height: 28, marginLeft: 6 }}
            onClick={onClose}
            title="Close Compare View"
          >
            ✕
          </button>
        </div>
      </div>

      {/* ─── MAIN IMAGE COMPARISON VIEWPORT OR EMPTY STATE ─── */}
      {eligibleItems.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#888888',
            gap: 12,
            background: '#0a0a0a',
            padding: 24
          }}
        >
          <ImageIcon size={48} color="#555555" />
          <span style={{ fontSize: 15, fontWeight: 600, color: '#cccccc' }}>
            {kind === 'model'
              ? 'No 3D Models in This Folder'
              : kind === 'video'
              ? 'No Video Clips in This Folder'
              : 'No Comparable Images in This Folder'}
          </span>
          <span
            style={{
              fontSize: 12,
              maxWidth: 460,
              textAlign: 'center',
              color: '#777777',
              lineHeight: 1.5
            }}
          >
            {kind === 'model'
              ? '3D comparison supports OBJ, FBX, glTF/GLB, STL, PLY, USD and Alembic models. Orbit one model and the other follows, for example LOD0 against LOD1.'
              : kind === 'video'
              ? 'Video comparison supports MP4, MOV, WebM, MKV and AVI clips. Play, pause and step both clips together to check one take against another.'
              : 'Image Comparison supports standard 2D image and texture formats (PNG, JPG, WebP, TIF, TGA, DDS, PSD, BMP). 360° HDR and EXR skybox maps are inspected in the dedicated HDR/EXR Studio Inspector.'}
          </span>
        </div>
      ) : (
        <div
          ref={containerRef}
          style={{
            flex: 1,
            position: 'relative',
            background: '#070707',
            overflow: 'hidden',
            cursor: isDraggingSplitter
              ? 'col-resize'
              : kind === 'model'
              ? 'default'
              : isPanning
              ? 'grabbing'
              : 'grab'
          }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
        >
          {/* Subtle Checkerboard Background for Alpha / Canvas Texture inspection */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0.15,
              backgroundImage:
                'linear-gradient(45deg, #181818 25%, transparent 25%), linear-gradient(-45deg, #181818 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #181818 75%), linear-gradient(-45deg, transparent 75%, #181818 75%)',
              backgroundSize: '24px 24px',
              backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px',
              pointerEvents: 'none'
            }}
          />

          {/* ═════════════════ MODE 1: SPLIT WIPE SLIDER ═════════════════ */}
          {compareMode === 'wipe' && (hasImages || modelStage) && (
            <>
              {hasImages && (
                <>
                  {/* Layer B (Right side of wipe) */}
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      clipPath: `polygon(${splitPos}% 0, 100% 0, 100% 100%, ${splitPos}% 100%)`,
                      pointerEvents: 'none'
                    }}
                  >
                    {renderMedia('B', {
                      position: 'absolute',
                      left: `${offsetX_B}px`,
                      top: `${offsetY_B}px`,
                      width: `${dispWidthB}px`,
                      height: `${dispHeightB}px`,
                      imageRendering: zoom >= 2.0 ? 'pixelated' : 'auto'
                    })}
                  </div>

                  {/* Layer A (Left side of wipe) */}
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      clipPath: `polygon(0 0, ${splitPos}% 0, ${splitPos}% 100%, 0 100%)`,
                      pointerEvents: 'none'
                    }}
                  >
                    {renderMedia('A', {
                      position: 'absolute',
                      left: `${offsetX_A}px`,
                      top: `${offsetY_A}px`,
                      width: `${dispWidthA}px`,
                      height: `${dispHeightA}px`,
                      imageRendering: zoom >= 2.0 ? 'pixelated' : 'auto'
                    })}
                  </div>
                </>
              )}

              {/* Draggable Vertical Splitter Line & Knob */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${splitPos}%`,
                  width: 2,
                  background: '#ffffff',
                  boxShadow: '0 0 8px rgba(0,0,0,0.8), 0 0 2px #000000',
                  cursor: 'col-resize',
                  zIndex: 25,
                  transform: 'translateX(-50%)'
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setIsDraggingSplitter(true);
                }}
              >
                {/* Center Handle Knob */}
                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: '#161616',
                    border: '2px solid #ffffff',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.8)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'col-resize',
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#ffffff',
                    gap: 3
                  }}
                >
                  <span style={{ color: '#ffffff' }}>A</span>
                  <span style={{ color: '#666666', fontSize: 10 }}>|</span>
                  <span style={{ color: '#888888' }}>B</span>
                </div>
              </div>

              {/* Floating Metadata Badges */}
              <div className="compare-badge-overlay" style={{ top: 14, left: 14 }}>
                <span style={{ fontWeight: 800, color: '#ffffff', marginRight: 4 }}>[A]</span>
                <span>{assetA?.name}</span>
                <span style={{ color: '#888888', marginLeft: 6 }}>
                  {slotInfo('A')}
                </span>
              </div>

              <div className="compare-badge-overlay" style={{ top: 14, right: 14 }}>
                <span style={{ fontWeight: 800, color: '#888888', marginRight: 4 }}>[B]</span>
                <span>{assetB?.name}</span>
                <span style={{ color: '#888888', marginLeft: 6 }}>
                  {slotInfo('B')}
                </span>
              </div>
            </>
          )}

          {/* ═════════════════ MODE 2: SIDE-BY-SIDE DUAL VIEW ═════════════════ */}
          {compareMode === 'split' && hasImages && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 2,
                background: '#222222',
                pointerEvents: 'none'
              }}
            >
              {/* Left Viewport: Asset A */}
              <div style={{ position: 'relative', overflow: 'hidden', background: '#080808' }}>
                <div className="compare-badge-overlay" style={{ top: 12, left: 12 }}>
                  <span style={{ fontWeight: 800, color: '#ffffff', marginRight: 4 }}>[A]</span>
                  <span>{assetA?.name}</span>
                  <span style={{ color: '#888888', marginLeft: 6 }}>
                    {slotInfo('A')}
                  </span>
                </div>
                {renderMedia('A', {
                  position: 'absolute',
                  left: `${offsetX_A}px`,
                  top: `${offsetY_A}px`,
                  width: `${dispWidthA}px`,
                  height: `${dispHeightA}px`,
                  imageRendering: zoom >= 2.0 ? 'pixelated' : 'auto'
                })}
              </div>

              {/* Right Viewport: Asset B */}
              <div style={{ position: 'relative', overflow: 'hidden', background: '#080808' }}>
                <div className="compare-badge-overlay" style={{ top: 12, left: 12 }}>
                  <span style={{ fontWeight: 800, color: '#888888', marginRight: 4 }}>[B]</span>
                  <span>{assetB?.name}</span>
                  <span style={{ color: '#888888', marginLeft: 6 }}>
                    {slotInfo('B')}
                  </span>
                </div>
                {renderMedia('B', {
                  position: 'absolute',
                  left: `${offsetX_B}px`,
                  top: `${offsetY_B}px`,
                  width: `${dispWidthB}px`,
                  height: `${dispHeightB}px`,
                  imageRendering: zoom >= 2.0 ? 'pixelated' : 'auto'
                })}
              </div>
            </div>
          )}

          {/* ═════════════════ MODE 3: A/B FLICKER TOGGLE ═════════════════ */}
          {compareMode === 'toggle' && (hasImages || modelStage) && (
            <>
              {/* Both layers stay mounted so video clips keep playing in step; only the active one shows */}
              {hasImages && ['A', 'B'].map((slot) => (
                <div
                  key={slot}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                    visibility: toggleActive === slot ? 'visible' : 'hidden'
                  }}
                >
                  {renderMedia(slot, {
                    position: 'absolute',
                    left: `${slot === 'A' ? offsetX_A : offsetX_B}px`,
                    top: `${slot === 'A' ? offsetY_A : offsetY_B}px`,
                    width: `${slot === 'A' ? dispWidthA : dispWidthB}px`,
                    height: `${slot === 'A' ? dispHeightA : dispHeightB}px`,
                    imageRendering: zoom >= 2.0 ? 'pixelated' : 'auto'
                  })}
                </div>
              ))}

              {/* Toggle Banner */}
              <div
                style={{
                  position: 'absolute',
                  top: 14,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(20,20,20,0.85)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid #333333',
                  borderRadius: 20,
                  padding: '4px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  zIndex: 30
                }}
              >
                <button
                  className={`filter-btn ${toggleActive === 'A' ? 'active' : ''}`}
                  style={{ height: 26, fontSize: 11 }}
                  onClick={() => setToggleActive('A')}
                >
                  Show [A] ({slotTag('A')})
                </button>
                <span style={{ fontSize: 11, color: '#666666' }}>
                  {kind === 'video' ? 'Press X' : 'Press Spacebar'}
                </span>
                <button
                  className={`filter-btn ${toggleActive === 'B' ? 'active' : ''}`}
                  style={{ height: 26, fontSize: 11 }}
                  onClick={() => setToggleActive('B')}
                >
                  Show [B] ({slotTag('B')})
                </button>
              </div>
            </>
          )}

          {/* ═════════════════ MODE 4: DIFFERENCE MAP ═════════════════ */}
          {compareMode === 'diff' && hasImages && (
            <>
              {/* Base Layer B */}
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                {renderMedia('B', {
                  position: 'absolute',
                  left: `${offsetX_B}px`,
                  top: `${offsetY_B}px`,
                  width: `${dispWidthB}px`,
                  height: `${dispHeightB}px`
                })}
              </div>

              {/* Overlay Layer A with difference blend mode */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  mixBlendMode: 'difference',
                  filter: `contrast(${diffGain * 100}%)`
                }}
              >
                {renderMedia('A', {
                  position: 'absolute',
                  left: `${offsetX_A}px`,
                  top: `${offsetY_A}px`,
                  width: `${dispWidthA}px`,
                  height: `${dispHeightA}px`
                })}
              </div>

              {/* Difference Gain Control */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 20,
                  right: 20,
                  background: 'rgba(20,20,20,0.85)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid #333333',
                  borderRadius: 6,
                  padding: '6px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  zIndex: 30
                }}
              >
                <span style={{ fontSize: 11, color: '#aaaaaa' }}>Diff Gain:</span>
                {[1, 2, 4, 8].map((g) => (
                  <button
                    key={g}
                    className={`filter-btn ${diffGain === g ? 'active' : ''}`}
                    style={{ height: 22, padding: '0 6px', fontSize: 10 }}
                    onClick={() => setDiffGain(g)}
                  >
                    {g}x
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ═════════════════ 3D MODELS: two panes, one shared camera ═════════════════ */}
          {modelStage && (
            <>
              {['A', 'B'].map((slot) => (
                <div key={slot} style={paneBoxStyle(slot)}>
                  <CompareModelPane
                    ref={slot === 'A' ? paneARef : paneBRef}
                    asset={slot === 'A' ? assetA : assetB}
                    renderMode={shading}
                    onCameraChange={(cam) => handleCameraChange(slot, cam)}
                    onStatus={(status) => handleModelStatus(slot, status)}
                  />
                </div>
              ))}

              {compareMode === 'split' && (
                <>
                  <div className="compare-badge-overlay" style={{ top: 12, left: 12 }}>
                    <span style={{ fontWeight: 800, color: '#ffffff', marginRight: 4 }}>[A]</span>
                    <span>{assetA?.name}</span>
                    <span style={{ color: '#888888', marginLeft: 6 }}>{slotInfo('A')}</span>
                  </div>
                  <div className="compare-badge-overlay" style={{ top: 12, left: 'calc(50% + 12px)' }}>
                    <span style={{ fontWeight: 800, color: '#888888', marginRight: 4 }}>[B]</span>
                    <span>{assetB?.name}</span>
                    <span style={{ color: '#888888', marginLeft: 6 }}>{slotInfo('B')}</span>
                  </div>
                </>
              )}

              {/* Shading (applies to both models) and camera link state */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 16,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(20,20,20,0.85)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid #333333',
                  borderRadius: 6,
                  padding: '5px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  zIndex: 30
                }}
              >
                <span style={{ fontSize: 11, color: '#aaaaaa' }}>Shading:</span>
                {SHADING_MODES.map(({ id, label }) => (
                  <button
                    key={id}
                    className={`filter-btn ${shading === id ? 'active' : ''}`}
                    style={{ height: 22, padding: '0 7px', fontSize: 10 }}
                    onClick={() => setShading(id)}
                  >
                    {label}
                  </button>
                ))}
                <span style={{ fontSize: 11, color: '#666666' }}>
                  {syncPanZoom ? 'Cameras linked: orbit either model' : 'Cameras independent'}
                </span>
              </div>

              {(modelStatusA.loading || modelStatusB.loading) && (
                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    background: 'rgba(0,0,0,0.8)',
                    padding: '10px 18px',
                    borderRadius: 8,
                    fontSize: 12,
                    color: '#ffffff',
                    border: '1px solid #333333',
                    zIndex: 50
                  }}
                >
                  Loading 3D models...
                </div>
              )}

              {(modelStatusA.error || modelStatusB.error) && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 60,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'rgba(40,10,10,0.9)',
                    padding: '8px 16px',
                    borderRadius: 6,
                    fontSize: 12,
                    color: '#ffaaaa',
                    border: '1px solid #553333',
                    zIndex: 50,
                    maxWidth: '80%'
                  }}
                >
                  {modelStatusA.error && <div>[A] {modelStatusA.error}</div>}
                  {modelStatusB.error && <div>[B] {modelStatusB.error}</div>}
                </div>
              )}
            </>
          )}

          {/* Loading indicator */}
          {(loadingA || loadingB) && (
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                background: 'rgba(0,0,0,0.8)',
                padding: '10px 18px',
                borderRadius: 8,
                fontSize: 12,
                color: '#ffffff',
                border: '1px solid #333333',
                zIndex: 50
              }}
            >
              Decoding High-Res Assets...
            </div>
          )}
        </div>
      )}

      {/* ─── SHARED VIDEO TRANSPORT (one timeline for both clips) ─── */}
      {kind === 'video' && assetA && assetB && (
        <CompareVideoTransport
          ref={transportRef}
          videoARef={videoARef}
          videoBRef={videoBRef}
          resetKey={`${assetA.path}|${assetB.path}`}
        />
      )}

      {/* ─── BOTTOM ASSET FILMSTRIP / CAROUSEL DRAWER ─── */}
      <div
        style={{
          background: '#0f0f0f',
          borderTop: '1px solid #222222',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 35
        }}
      >
        {/* Filmstrip Header / Toggle Bar */}
        <div
          style={{
            height: 30,
            padding: '0 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            background: '#141414',
            borderBottom: showFilmstrip ? '1px solid #222222' : 'none'
          }}
          onClick={() => setShowFilmstrip((prev) => !prev)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#888888' }}>
            <Film size={12} />
            <span style={{ fontWeight: 600 }}>FOLDER ASSETS ({eligibleItems.length})</span>
            <span>— Click [Set A] or [Set B] to assign comparison targets</span>
          </div>
          <button className="icon-btn" style={{ width: 20, height: 20 }}>
            {showFilmstrip ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
        </div>

        {/* Horizontal Scrollable Thumbnail Cards */}
        {showFilmstrip && (
          <div
            style={{
              height: 112,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              overflowX: 'auto',
              overflowY: 'hidden'
            }}
          >
            {eligibleItems.map((item) => {
              const isA = assetA?.path === item.path;
              const isB = assetB?.path === item.path;

              return (
                <div
                  key={item.path}
                  style={{
                    minWidth: 140,
                    width: 140,
                    height: 96,
                    background: isA ? '#222222' : isB ? '#1c1c1c' : '#141414',
                    border: isA
                      ? '1px solid #ffffff'
                      : isB
                      ? '1px solid #888888'
                      : '1px solid #252525',
                    borderRadius: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    padding: 6,
                    position: 'relative',
                    cursor: 'default',
                    flexShrink: 0
                  }}
                >
                  {/* Slot Indicators */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {isA && (
                        <span
                          style={{
                            background: '#ffffff',
                            color: '#000000',
                            fontWeight: 800,
                            fontSize: 9,
                            padding: '1px 4px',
                            borderRadius: 2
                          }}
                        >
                          SLOT A
                        </span>
                      )}
                      {isB && (
                        <span
                          style={{
                            background: '#888888',
                            color: '#000000',
                            fontWeight: 800,
                            fontSize: 9,
                            padding: '1px 4px',
                            borderRadius: 2
                          }}
                        >
                          SLOT B
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 9, color: '#666666', fontFamily: 'monospace' }}>
                      {item.extension?.toUpperCase() || ''}
                    </span>
                  </div>

                  {/* Asset Name */}
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: isA || isB ? '#ffffff' : '#cccccc',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginBottom: 6
                    }}
                    title={item.name}
                  >
                    {item.name}
                  </div>

                  {/* Action Buttons: Set A and Set B */}
                  <div style={{ marginTop: 'auto', display: 'flex', gap: 4 }}>
                    <button
                      className={`filter-btn ${isA ? 'active' : ''}`}
                      style={{
                        flex: 1,
                        height: 22,
                        fontSize: 10,
                        padding: 0,
                        justifyContent: 'center',
                        fontWeight: 700
                      }}
                      onClick={() => setAssetA(item)}
                      title="Set this asset as A"
                    >
                      Set A
                    </button>
                    <button
                      className={`filter-btn ${isB ? 'active' : ''}`}
                      style={{
                        flex: 1,
                        height: 22,
                        fontSize: 10,
                        padding: 0,
                        justifyContent: 'center',
                        fontWeight: 700
                      }}
                      onClick={() => setAssetB(item)}
                      title="Set this asset as B"
                    >
                      Set B
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
