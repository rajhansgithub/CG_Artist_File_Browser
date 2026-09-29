import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Columns,
  ArrowLeftRight,
  Split,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Link as LinkIcon,
  Unlink,
  Eye,
  Film,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Sliders,
  Layers,
  Box,
  Image as ImageIcon
} from 'lucide-react';
import { loadImageAsset } from '../utils/imageDecoder';
import { formatBytes, isComparableImage } from '../utils/formatHelpers';

export default function CompareView({
  folderItems = [],
  initialAssetA,
  initialAssetB,
  onClose,
  onRevealInExplorer
}) {
  // All non-directory items eligible for image comparison (excludes HDR/EXR, 3D, Video, Audio)
  const eligibleItems = (folderItems || []).filter(isComparableImage);

  // Asset selection state - only pick valid 2D comparable images
  const [assetA, setAssetA] = useState(() => {
    if (initialAssetA && isComparableImage(initialAssetA)) return initialAssetA;
    return eligibleItems[0] || null;
  });
  const [assetB, setAssetB] = useState(() => {
    if (initialAssetB && isComparableImage(initialAssetB)) return initialAssetB;
    return eligibleItems.length > 1 ? eligibleItems[1] : (eligibleItems[0] || null);
  });

  useEffect(() => {
    if (initialAssetA && isComparableImage(initialAssetA)) {
      setAssetA(initialAssetA);
    } else if (!assetA && eligibleItems.length > 0) {
      setAssetA(eligibleItems[0]);
    }
  }, [initialAssetA?.path, eligibleItems]);

  useEffect(() => {
    if (initialAssetB && isComparableImage(initialAssetB)) {
      setAssetB(initialAssetB);
    } else if (!assetB && eligibleItems.length > 1) {
      setAssetB(eligibleItems[1]);
    }
  }, [initialAssetB?.path, eligibleItems]);

  // Comparison mode: 'wipe' (Split-Screen Wipe Slider), 'split' (Side-by-Side), 'toggle' (A/B Flicker), 'diff' (Difference Map)
  const [compareMode, setCompareMode] = useState('wipe');

  // Zoom and Pan state
  const [zoom, setZoom] = useState(1.0); // 1.0 = Fit to viewport
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Sync state
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
  }, []);

  // Load Asset A
  useEffect(() => {
    if (!assetA) {
      setDataA(null);
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
  }, [assetA?.path]);

  // Load Asset B
  useEffect(() => {
    if (!assetB) {
      setDataB(null);
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
  }, [assetB?.path]);

  // Reset transforms
  const resetTransform = useCallback(() => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  }, []);

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

  // Keyboard shortcut listener (Spacebar for A/B Toggle)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        setToggleActive((prev) => (prev === 'A' ? 'B' : 'A'));
      } else if (e.key === '1') {
        setCompareMode('wipe');
      } else if (e.key === '2') {
        setCompareMode('split');
      } else if (e.key === '3') {
        setCompareMode('toggle');
      } else if (e.key === '4') {
        setCompareMode('diff');
      } else if (e.key === 'r' || e.key === 'R') {
        resetTransform();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [resetTransform]);

  // Handle Mouse Wheel Zoom
  const handleWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoom((prev) => Math.min(32.0, Math.max(0.05, prev * factor)));
  };

  // Mouse pan handlers
  const handleMouseDown = (e) => {
    // Only left click initiates panning
    if (e.button !== 0) return;
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

  // Compute scale and position for Image A and Image B
  const hasImages = Boolean(dataA?.url && dataB?.url);

  // Viewport dimensions
  const vpWidth = compareMode === 'split' ? containerSize.width / 2 : containerSize.width;
  const vpHeight = containerSize.height;

  // Fit calculations
  const wA = dataA?.width || 1920;
  const hA = dataA?.height || 1080;
  const wB = dataB?.width || 1920;
  const hB = dataB?.height || 1080;

  const baseFitA = Math.min(vpWidth / wA, vpHeight / hA, 1.0);
  const baseFitB = Math.min(vpWidth / wB, vpHeight / hB, 1.0);

  // Scaled dimensions depending on alignment mode
  let renderScaleA = 1.0;
  let renderScaleB = 1.0;

  if (zoomAlignment === 'normalized') {
    // Both scale to fit viewport, then zoom multiplies proportionally.
    // 4K and 2K occupy the exact same screen bounds!
    renderScaleA = baseFitA * zoom;
    renderScaleB = baseFitB * zoom;
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
            IMAGE COMPARISON
          </span>
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

          {dataA?.width > 0 && (
            <span style={{ fontSize: 11, color: '#888888', marginLeft: 4, fontFamily: 'monospace' }}>
              {dataA.width}×{dataA.height}
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

          {dataB?.width > 0 && (
            <span style={{ fontSize: 11, color: '#888888', marginLeft: 4, fontFamily: 'monospace' }}>
              {dataB.width}×{dataB.height}
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
            style={{ height: 26, fontSize: 11, padding: '0 8px' }}
            onClick={() => setCompareMode('diff')}
            title="Pixel Difference Map [Key 4]"
          >
            <Sliders size={12} style={{ marginRight: 4 }} />
            Diff
          </button>
        </div>

        {/* ─── ZOOM & ALIGNMENT CONTROLS ─── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Zoom Alignment Mode: Normalized (Features align) vs 1:1 (Native pixels) */}
          <button
            className={`filter-btn ${zoomAlignment === 'normalized' ? 'active' : ''}`}
            style={{ height: 26, fontSize: 11, padding: '0 7px' }}
            onClick={() =>
              setZoomAlignment((prev) => (prev === 'normalized' ? '1to1' : 'normalized'))
            }
            title={
              zoomAlignment === 'normalized'
                ? 'Aligned Features: 4K & 2K are scaled to align identical framing'
                : '1:1 Pixel Match: 1 screen pixel = 1 native image texel'
            }
          >
            {zoomAlignment === 'normalized' ? 'Align Features' : '1:1 Pixels'}
          </button>

          {/* Sync Pan & Zoom Toggle */}
          <button
            className={`icon-btn ${syncPanZoom ? 'active' : ''}`}
            style={{ width: 26, height: 26 }}
            onClick={() => setSyncPanZoom((prev) => !prev)}
            title={syncPanZoom ? 'Sync Pan & Zoom: Locked' : 'Sync Pan & Zoom: Independent'}
          >
            {syncPanZoom ? <LinkIcon size={13} /> : <Unlink size={13} />}
          </button>

          {/* Zoom Out / In */}
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

          {/* Reset View */}
          <button
            className="icon-btn"
            style={{ width: 26, height: 26 }}
            onClick={resetTransform}
            title="Reset Pan & Zoom (Fit to Screen) [Key R]"
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
            No Comparable Images in This Folder
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
            Image Comparison supports standard 2D image and texture formats (PNG, JPG, WebP, TIF, TGA, DDS, PSD, BMP). 360° HDR and EXR skybox maps are inspected in the dedicated HDR/EXR Studio Inspector.
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
            cursor: isDraggingSplitter ? 'col-resize' : isPanning ? 'grabbing' : 'grab'
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
          {compareMode === 'wipe' && hasImages && (
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
                <img
                  src={dataB.url}
                  alt={assetB?.name}
                  draggable={false}
                  style={{
                    position: 'absolute',
                    left: `${offsetX_B}px`,
                    top: `${offsetY_B}px`,
                    width: `${dispWidthB}px`,
                    height: `${dispHeightB}px`,
                    imageRendering: zoom >= 2.0 ? 'pixelated' : 'auto'
                  }}
                />
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
                <img
                  src={dataA.url}
                  alt={assetA?.name}
                  draggable={false}
                  style={{
                    position: 'absolute',
                    left: `${offsetX_A}px`,
                    top: `${offsetY_A}px`,
                    width: `${dispWidthA}px`,
                    height: `${dispHeightA}px`,
                    imageRendering: zoom >= 2.0 ? 'pixelated' : 'auto'
                  }}
                />
              </div>

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
                  {wA}×{hA} • {formatBytes(assetA?.size)}
                </span>
              </div>

              <div className="compare-badge-overlay" style={{ top: 14, right: 14 }}>
                <span style={{ fontWeight: 800, color: '#888888', marginRight: 4 }}>[B]</span>
                <span>{assetB?.name}</span>
                <span style={{ color: '#888888', marginLeft: 6 }}>
                  {wB}×{hB} • {formatBytes(assetB?.size)}
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
                    {wA}×{hA} • {formatBytes(assetA?.size)}
                  </span>
                </div>
                <img
                  src={dataA.url}
                  alt={assetA?.name}
                  draggable={false}
                  style={{
                    position: 'absolute',
                    left: `${offsetX_A}px`,
                    top: `${offsetY_A}px`,
                    width: `${dispWidthA}px`,
                    height: `${dispHeightA}px`,
                    imageRendering: zoom >= 2.0 ? 'pixelated' : 'auto'
                  }}
                />
              </div>

              {/* Right Viewport: Asset B */}
              <div style={{ position: 'relative', overflow: 'hidden', background: '#080808' }}>
                <div className="compare-badge-overlay" style={{ top: 12, left: 12 }}>
                  <span style={{ fontWeight: 800, color: '#888888', marginRight: 4 }}>[B]</span>
                  <span>{assetB?.name}</span>
                  <span style={{ color: '#888888', marginLeft: 6 }}>
                    {wB}×{hB} • {formatBytes(assetB?.size)}
                  </span>
                </div>
                <img
                  src={dataB.url}
                  alt={assetB?.name}
                  draggable={false}
                  style={{
                    position: 'absolute',
                    left: `${offsetX_B}px`,
                    top: `${offsetY_B}px`,
                    width: `${dispWidthB}px`,
                    height: `${dispHeightB}px`,
                    imageRendering: zoom >= 2.0 ? 'pixelated' : 'auto'
                  }}
                />
              </div>
            </div>
          )}

          {/* ═════════════════ MODE 3: A/B FLICKER TOGGLE ═════════════════ */}
          {compareMode === 'toggle' && hasImages && (
            <>
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                <img
                  src={toggleActive === 'A' ? dataA.url : dataB.url}
                  alt={toggleActive === 'A' ? assetA?.name : assetB?.name}
                  draggable={false}
                  style={{
                    position: 'absolute',
                    left: `${toggleActive === 'A' ? offsetX_A : offsetX_B}px`,
                    top: `${toggleActive === 'A' ? offsetY_A : offsetY_B}px`,
                    width: `${toggleActive === 'A' ? dispWidthA : dispWidthB}px`,
                    height: `${toggleActive === 'A' ? dispHeightA : dispHeightB}px`,
                    imageRendering: zoom >= 2.0 ? 'pixelated' : 'auto'
                  }}
                />
              </div>

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
                  Show [A] ({wA}×{hA})
                </button>
                <span style={{ fontSize: 11, color: '#666666' }}>Press Spacebar</span>
                <button
                  className={`filter-btn ${toggleActive === 'B' ? 'active' : ''}`}
                  style={{ height: 26, fontSize: 11 }}
                  onClick={() => setToggleActive('B')}
                >
                  Show [B] ({wB}×{hB})
                </button>
              </div>
            </>
          )}

          {/* ═════════════════ MODE 4: DIFFERENCE MAP ═════════════════ */}
          {compareMode === 'diff' && hasImages && (
            <>
              {/* Base Layer B */}
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                <img
                  src={dataB.url}
                  alt={assetB?.name}
                  draggable={false}
                  style={{
                    position: 'absolute',
                    left: `${offsetX_B}px`,
                    top: `${offsetY_B}px`,
                    width: `${dispWidthB}px`,
                    height: `${dispHeightB}px`
                  }}
                />
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
                <img
                  src={dataA.url}
                  alt={assetA?.name}
                  draggable={false}
                  style={{
                    position: 'absolute',
                    left: `${offsetX_A}px`,
                    top: `${offsetY_A}px`,
                    width: `${dispWidthA}px`,
                    height: `${dispHeightA}px`
                  }}
                />
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
                      title="Set this asset as Image A"
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
                      title="Set this asset as Image B"
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
