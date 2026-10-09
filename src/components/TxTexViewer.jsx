import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Layers,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Sliders,
  Camera,
  Check
} from 'lucide-react';
import { formatBytes, isTxTexFormat } from '../utils/formatHelpers';
import { getFileBuffer } from '../utils/thumbnailService';
import { parseTxTex, TxTexReader, TxTexError } from '../utils/txTexDecoder';
import {
  RENDER_PRESETS,
  DISTANCE_PRESETS,
  REPEAT_PRESETS,
  COVERAGE_MIN,
  COVERAGE_MAX,
  coverageToSlider,
  sliderToCoverage,
  formatCoverage,
  formatPixels,
  sizeLabel,
  judge,
  pickMipLevels,
  describeMipChoice,
  buildChart
} from '../utils/txTexAnalysis';
import { CHANNEL_MODES, applyChannel, paintRenderPreview } from '../utils/txTexPreview';

const TONE_COLORS = {
  soft: '#ef4444',
  'slightly-soft': '#f59e0b',
  good: '#22c55e',
  'more-than-enough': '#2dd4bf',
  overkill: '#60a5fa'
};

const CELL_WORDS = {
  soft: 'Soft',
  'slightly-soft': 'Slight',
  good: 'Sharp',
  'more-than-enough': 'Plenty',
  overkill: 'Overkill'
};

const WHAT_IF_WIDTHS = [2048, 4096, 8192, 16384];
const ZOOM_CHOICES = ['auto', 1, 2, 4, 8, 16, 32];
const FRAME_ASPECT = 9 / 16;
const MAX_AUTO_ZOOM = 64;
const SIDEBAR_SPACE = 334;

function fileNameOnly(p) {
  return (p || '').split(/[/\\]/).pop();
}

function Section({ title, badge, open, onToggle, children }) {
  return (
    <div className="inspector-section-card" style={{ flexShrink: 0 }}>
      <div className="inspector-section-header" onClick={onToggle}>
        <div className="inspector-section-title">
          <span>{title}</span>
        </div>
        <div className="inspector-section-meta">
          {badge && <span className="section-badge-pill">{badge}</span>}
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </div>
      </div>
      {open && <div className="inspector-section-body">{children}</div>}
    </div>
  );
}

function Chip({ active, onClick, children, title, disabled, style }) {
  return (
    <button
      type="button"
      className={`txtex-chip ${active ? 'active' : ''}`}
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={style}
    >
      {children}
    </button>
  );
}

function StatRow({ label, value, title }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 10.5 }} title={title}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text-main)', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{value}</span>
    </div>
  );
}

export default function TxTexViewer({
  asset,
  allFolderItems = [],
  onClose,
  onSelectAsset,
  onRevealInExplorer
}) {
  const containerRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const textureCanvasRef = useRef(null);

  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [error, setError] = useState(null);
  const [model, setModel] = useState(null); // { parsed, reader }
  const [tab, setTab] = useState('render'); // 'render' (opens here) | 'texture'
  const [viewLevel, setViewLevel] = useState(0); // level shown on the Texture tab
  const [selectedLevel, setSelectedLevel] = useState(0); // top level of the texture being tested for sharpness
  const [simWidth, setSimWidth] = useState(null); // "what if the texture were this wide" (only bigger than the file); null = the file as it is
  const [pxDraft, setPxDraft] = useState(null);
  const [channel, setChannel] = useState('rgb');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [open, setOpen] = useState({ sharp: true, chart: true, mips: true, details: false });
  const [pane, setPane] = useState({ w: 900, h: 600 });
  const [snapshotFeedback, setSnapshotFeedback] = useState(false);

  // "Will it be sharp enough?" settings
  const [renderId, setRenderId] = useState('2k');
  const [coverage, setCoverage] = useState(0.15);
  const [repeats, setRepeats] = useState(1);
  const [zoomChoice, setZoomChoice] = useState('auto');
  const [view, setView] = useState({ x: 0, y: 0 }); // pan of the render preview, in render pixels

  // Texture tab
  const [levelImage, setLevelImage] = useState(null);
  const [levelBusy, setLevelBusy] = useState(false);
  const [levelError, setLevelError] = useState(null);
  const [tScale, setTScale] = useState(1);
  const [tPos, setTPos] = useState({ x: 0, y: 0 });
  const [fitted, setFitted] = useState(true);
  const dragRef = useRef(null);

  // Render preview
  const [paintError, setPaintError] = useState(null);
  const [painting, setPainting] = useState(false);

  const txItems = useMemo(
    () => allFolderItems.filter((item) => !item.isDirectory && isTxTexFormat(item.extension)),
    [allFolderItems]
  );
  const currentIndex = txItems.findIndex((item) => item.path === asset?.path);

  /* ---------------------------------------------------------------- load the file */
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    setModel(null);
    setLevelImage(null);
    setLevelError(null);
    setPaintError(null);
    setSelectedLevel(0);
    setSimWidth(null);
    setViewLevel(0);
    setView({ x: 0, y: 0 });
    setFitted(true);
    if (!asset) return undefined;

    (async () => {
      try {
        const buf = await getFileBuffer(asset.path);
        if (!buf) throw new TxTexError('empty', 'Could not read the texture file.');
        const parsed = parseTxTex(buf, asset.extension);
        if (cancelled) return;
        setModel({ parsed, reader: new TxTexReader(buf, parsed) });
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        console.warn('TX/TEX load failed:', err);
        setError(err instanceof TxTexError ? err.message : `The file could not be read (${err?.message || 'unknown error'}).`);
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [asset?.path]);

  // Drop cached tiles when leaving the file
  useEffect(() => {
    return () => {
      if (model?.reader) model.reader.clearCache();
    };
  }, [model]);

  /* ---------------------------------------------------------------- pane size */
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      setPane({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setPane({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const mips = model?.parsed.mips || [];
  const info = model?.parsed.info;
  const level0 = mips[0];
  const safeLevel = Math.min(selectedLevel, Math.max(0, mips.length - 1));
  const testLevel = mips[safeLevel];
  const simulating = !!simWidth && !!level0 && simWidth > level0.width && safeLevel === 0;
  const textureWidth = simulating ? simWidth : testLevel?.width;
  const shownIndex = Math.min(viewLevel, Math.max(0, mips.length - 1));
  const shownLevel = mips[shownIndex];

  /* ---------------------------------------------------------------- sharpness numbers */
  const render = RENDER_PRESETS.find((r) => r.id === renderId) || RENDER_PRESETS[1];
  const frameW = render.width;
  const frameH = Math.round(frameW * FRAME_ASPECT);

  const analysis = useMemo(() => {
    if (!level0 || !testLevel) return null;
    const verdict = judge({ textureWidth, frameWidth: frameW, coverage, repeats });
    const copy = verdict.footprint;
    const lambda = Math.log2(level0.width / Math.max(copy, 1e-6));
    const pick = pickMipLevels(lambda, mips.length, safeLevel);
    return { verdict, lambda, pick, objW: frameW * coverage, objH: (frameW * coverage) / (level0.width / level0.height) };
  }, [level0, testLevel, textureWidth, mips.length, safeLevel, frameW, coverage, repeats]);

  const chart = useMemo(() => {
    if (!testLevel) return null;
    return buildChart({ textureWidth, repeats });
  }, [testLevel, textureWidth, repeats]);

  const recommendedMip = useMemo(() => {
    if (!analysis) return null;
    const want = analysis.verdict.recommendedWidth;
    if (!['more-than-enough', 'overkill'].includes(analysis.verdict.level)) return null;
    if (want >= textureWidth) return null;
    return mips.find((m) => m.width === want) || null;
  }, [analysis, mips, testLevel, textureWidth]);

  // Bigger-than-the-file sizes to try ("what if I exported this at 8K?"), up to 16K
  const whatIfSizes = useMemo(
    () => (level0 ? WHAT_IF_WIDTHS.filter((w) => w > level0.width) : []),
    [level0]
  );

  /* ---------------------------------------------------------------- texture tab: decode the shown level */
  useEffect(() => {
    if (!model || tab !== 'texture' || !shownLevel) return undefined;
    const signal = { cancelled: false };
    setLevelBusy(true);
    setLevelError(null);
    (async () => {
      try {
        const img = await model.reader.decodeLevelReduced(shownLevel.index, 4096, signal);
        if (signal.cancelled) return;
        setLevelImage({ levelIndex: shownLevel.index, ...img });
        setFitted(true);
        setLevelBusy(false);
      } catch (err) {
        if (signal.cancelled || err?.code === 'cancelled') return;
        console.warn('TX/TEX level decode failed:', err);
        setLevelImage(null);
        setLevelError(err?.message || 'This level could not be decoded.');
        setLevelBusy(false);
      }
    })();
    return () => {
      signal.cancelled = true;
    };
  }, [model, tab, shownLevel?.index]);

  // Put the decoded level (in the chosen channel) on the texture canvas
  useEffect(() => {
    const canvas = textureCanvasRef.current;
    if (!canvas || !levelImage || tab !== 'texture') return;
    canvas.width = levelImage.width;
    canvas.height = levelImage.height;
    const shown = applyChannel(levelImage.rgba, channel);
    canvas.getContext('2d').putImageData(new ImageData(shown, levelImage.width, levelImage.height), 0, 0);
  }, [levelImage, channel, tab]);

  // Fit the level into the free area
  const availW = Math.max(200, pane.w - (sidebarOpen ? SIDEBAR_SPACE : 0) - 24);
  const availH = Math.max(160, pane.h - 56 - 16);
  useEffect(() => {
    if (!levelImage || !fitted) return;
    const s = Math.min(availW / levelImage.width, availH / levelImage.height, 8);
    setTScale(s);
    setTPos({ x: 0, y: 0 });
  }, [levelImage, fitted, availW, availH]);

  const fitTexture = () => {
    setFitted(true);
  };

  /* ---------------------------------------------------------------- render tab: paint the footprint */
  const autoZoom = useMemo(() => {
    if (!analysis) return 1;
    let z = 1;
    while (z * 2 <= MAX_AUTO_ZOOM && analysis.objW * z * 2 <= availW * 0.92 && analysis.objH * z * 2 <= availH * 0.92) z *= 2;
    return z;
  }, [analysis, availW, availH]);
  const zoom = zoomChoice === 'auto' ? autoZoom : zoomChoice;

  const unsupportedMsg = analysis
    ? (mips[analysis.pick.lower]?.unsupported || mips[analysis.pick.upper]?.unsupported || null)
    : null;

  const paintKey = analysis
    ? [asset?.path, frameW, coverage, repeats, safeLevel, channel, zoom, availW, availH, view.x, view.y].join('|')
    : '';

  useEffect(() => {
    if (!model || tab !== 'render' || !analysis || !previewCanvasRef.current) return undefined;
    const canvas = previewCanvasRef.current;
    const signal = { cancelled: false };
    const winW = Math.max(16, Math.floor(availW / zoom));
    const winH = Math.max(16, Math.floor(availH / zoom));
    if (unsupportedMsg) {
      setPaintError(null);
      return undefined;
    }
    setPaintError(null);
    // Wait a beat so dragging a slider does not decode for every intermediate value
    const timer = setTimeout(async () => {
      setPainting(true);
      try {
        // Draw on a spare canvas and copy over at the end so the visible one never flickers
        const spare = document.createElement('canvas');
        const result = await paintRenderPreview({
          reader: model.reader,
          mips,
          canvas: spare,
          winW,
          winH,
          viewX: view.x,
          viewY: view.y,
          frameW,
          frameH,
          objW: analysis.objW,
          objH: analysis.objH,
          repeats,
          pick: analysis.pick,
          channel,
          signal
        });
        if (signal.cancelled || !result) return;
        canvas.width = winW;
        canvas.height = winH;
        canvas.getContext('2d').drawImage(spare, 0, 0);
        setPainting(false);
      } catch (err) {
        if (signal.cancelled || err?.code === 'cancelled') return;
        console.warn('TX/TEX preview failed:', err);
        setPaintError(err?.message || 'The preview could not be drawn.');
        setPainting(false);
      }
    }, 40);
    return () => {
      signal.cancelled = true;
      clearTimeout(timer);
    };
  }, [model, tab, paintKey]);

  /* ---------------------------------------------------------------- interactions */
  const goToNext = useCallback(() => {
    if (txItems.length === 0) return;
    onSelectAsset(txItems[currentIndex < txItems.length - 1 ? currentIndex + 1 : 0]);
  }, [txItems, currentIndex, onSelectAsset]);
  const goToPrev = useCallback(() => {
    if (txItems.length === 0) return;
    onSelectAsset(txItems[currentIndex > 0 ? currentIndex - 1 : txItems.length - 1]);
  }, [txItems, currentIndex, onSelectAsset]);

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') goToNext();
      else if (e.key === 'ArrowLeft') goToPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goToNext, goToPrev]);

  const onWheel = (e) => {
    if (tab !== 'texture' || !levelImage) return;
    e.preventDefault();
    setFitted(false);
    setTScale((s) => Math.min(64, Math.max(0.05, s * (e.deltaY < 0 ? 1.18 : 0.85))));
  };

  const onMouseDown = (e) => {
    if (e.button !== 0 || e.target.closest('.viewport-hud') || e.target.closest('.hdr-inspector-sidebar') || e.target.closest('.txtex-floating')) return;
    dragRef.current = { x: e.clientX, y: e.clientY, tPos, view };
  };
  const onMouseMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (tab === 'texture') {
      setFitted(false);
      setTPos({ x: d.tPos.x + dx, y: d.tPos.y + dy });
    } else {
      setView({ x: d.view.x - dx / zoom, y: d.view.y - dy / zoom });
    }
  };
  const onMouseUp = () => {
    dragRef.current = null;
  };

  const resetPan = () => {
    setView({ x: 0, y: 0 });
    fitTexture();
  };

  const handleExportPng = async () => {
    const canvas = tab === 'texture' ? textureCanvasRef.current : previewCanvasRef.current;
    if (!canvas || !canvas.width) return;
    try {
      let out = canvas;
      if (tab === 'render' && zoom > 1) {
        out = document.createElement('canvas');
        out.width = canvas.width * zoom;
        out.height = canvas.height * zoom;
        const ctx = out.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(canvas, 0, 0, out.width, out.height);
      }
      const dataUrl = out.toDataURL('image/png');
      const baseName = asset?.name ? asset.name.replace(/\.[^/.]+$/, '') : 'texture';
      const defaultFilename = tab === 'texture'
        ? `${baseName}_level${shownLevel?.index ?? 0}.png`
        : `${baseName}_${render.label}_${formatCoverage(coverage).replace('%', 'pct')}.png`;
      if (window.electronAPI?.saveImageFileDialog) {
        const res = await window.electronAPI.saveImageFileDialog(defaultFilename, dataUrl);
        if (!(res && res.success)) return;
      } else {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = defaultFilename;
        a.click();
      }
      setSnapshotFeedback(true);
      setTimeout(() => setSnapshotFeedback(false), 2000);
    } catch (err) {
      console.error('Failed to export image:', err);
    }
  };

  const setPixels = (px) => {
    const v = Math.min(COVERAGE_MAX, Math.max(COVERAGE_MIN, px / frameW));
    setCoverage(v);
    setView({ x: 0, y: 0 });
  };

  if (!asset) return null;

  const hasAlpha = !!info?.hasAlpha;
  const verdict = analysis?.verdict;
  const accent = verdict ? TONE_COLORS[verdict.level] : '#38bdf8';
  const copyPx = verdict ? verdict.footprint : 0;
  const totalBytes = info?.fileBytes || asset.size;

  /* ---------------------------------------------------------------- render */
  return (
    <div
      ref={containerRef}
      className="viewport-wrapper"
      style={{
        background: '#0a0a0a',
        userSelect: 'none',
        overflow: 'hidden',
        cursor: dragRef.current ? 'grabbing' : 'grab'
      }}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onDoubleClick={(e) => {
        if (!e.target.closest('.viewport-hud') && !e.target.closest('.hdr-inspector-sidebar') && !e.target.closest('.txtex-floating')) resetPan();
      }}
    >
      {/* Top toolbar */}
      <div className={`viewport-hud with-sidebar ${!sidebarOpen ? 'sidebar-collapsed' : ''}`}>
        <button className={`hud-btn ${tab === 'texture' ? 'active' : ''}`} onClick={() => setTab('texture')} title="Look at the texture itself, one mip level at a time">
          <Layers size={13} />
          <span className="hud-label">Texture</span>
        </button>
        <button className={`hud-btn ${tab === 'render' ? 'active' : ''}`} onClick={() => setTab('render')} title="See the texture at the size it will have in the final render">
          <span>In the render</span>
        </button>

        <div className="hud-divider" />

        {CHANNEL_MODES.map((m) => (
          <button
            key={m}
            className={`hud-btn ${channel === m ? 'active' : ''}`}
            onClick={() => setChannel(m)}
            disabled={m === 'a' && !hasAlpha}
            title={m === 'rgb' ? 'Colour' : m === 'a' ? (hasAlpha ? 'Alpha (transparency)' : 'This texture has no alpha channel') : `${m.toUpperCase()} channel only`}
            style={m === 'a' && !hasAlpha ? { opacity: 0.35, cursor: 'default' } : undefined}
          >
            <span>{m === 'rgb' ? 'RGB' : m.toUpperCase()}</span>
          </button>
        ))}

        {tab === 'texture' && (
          <>
            <div className="hud-divider" />
            <button className="hud-btn" onClick={() => { setFitted(false); setTScale((s) => Math.min(64, s * 1.25)); }} title="Zoom in">
              <ZoomIn size={13} />
            </button>
            <button className="hud-btn" onClick={() => { setFitted(false); setTScale((s) => Math.max(0.05, s * 0.8)); }} title="Zoom out">
              <ZoomOut size={13} />
            </button>
            <button className="hud-btn" onClick={fitTexture} title="Fit to screen (double-click)">
              <Maximize2 size={13} />
              <span className="hud-label">Fit</span>
            </button>
            <button className="hud-btn" onClick={() => { setFitted(false); setTScale(1); setTPos({ x: 0, y: 0 }); }} title="Actual pixels">
              <span>1:1</span>
            </button>
          </>
        )}

        <div className="hud-divider" />

        <button
          className={`hud-btn ${snapshotFeedback ? 'active' : ''}`}
          onClick={handleExportPng}
          disabled={status !== 'ready'}
          title="Export what you see as PNG"
        >
          {snapshotFeedback ? <Check size={13} color="#22c55e" /> : <Camera size={13} />}
          <span className="hud-label">{snapshotFeedback ? 'Saved!' : 'Export PNG'}</span>
        </button>
        <button className="hud-btn" onClick={() => onRevealInExplorer(asset.path)} title="Reveal in Windows Explorer">
          <ExternalLink size={13} />
          <span className="hud-label">Explorer</span>
        </button>
        <button
          className={`hud-btn ${sidebarOpen ? 'active' : ''}`}
          onClick={() => setSidebarOpen(!sidebarOpen)}
          title={sidebarOpen ? 'Hide the panel' : 'Show the panel'}
        >
          <Sliders size={13} />
          <span className="hud-label">Panel</span>
          {sidebarOpen ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
        {onClose && (
          <button className="hud-btn" onClick={onClose} style={{ marginLeft: 4 }} title="Close view (Esc)">
            ✕
          </button>
        )}
      </div>

      {/* Main area */}
      <div
        style={{
          position: 'absolute',
          left: 12,
          top: 56,
          bottom: 16,
          right: sidebarOpen ? SIDEBAR_SPACE : 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden'
        }}
      >
        {status === 'loading' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div
              className="spin-icon"
              style={{ width: 38, height: 38, borderRadius: '50%', border: '3px solid rgba(255, 255, 255, 0.2)', borderTopColor: '#ffffff' }}
            />
            <span style={{ fontSize: 13, color: '#e0e0e0', fontFamily: 'var(--font-mono)' }}>Reading {asset.name}...</span>
          </div>
        )}

        {status === 'error' && (
          <MessageCard
            title="This texture can't be opened"
            message={error}
            asset={asset}
            onRevealInExplorer={onRevealInExplorer}
          />
        )}

        {status === 'ready' && tab === 'texture' && (
          <>
            {levelBusy && !levelImage && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                <div
                  className="spin-icon"
                  style={{ width: 34, height: 34, borderRadius: '50%', border: '3px solid rgba(255, 255, 255, 0.2)', borderTopColor: '#ffffff' }}
                />
                <span style={{ fontSize: 12, color: '#e0e0e0', fontFamily: 'var(--font-mono)' }}>
                  Decoding Level {shownLevel?.index} ({shownLevel?.width} × {shownLevel?.height})...
                </span>
              </div>
            )}
            {levelError && !levelBusy && (
              <MessageCard
                title={`Level ${shownLevel?.index} can't be shown`}
                message={levelError}
                note="The size and level list on the right still work."
                asset={asset}
                onRevealInExplorer={onRevealInExplorer}
              />
            )}
            {!levelError && (
              <canvas
                ref={textureCanvasRef}
                style={{
                  display: levelImage ? 'block' : 'none',
                  transform: `translate(${tPos.x}px, ${tPos.y}px) scale(${tScale})`,
                  transformOrigin: 'center center',
                  imageRendering: tScale > 2 ? 'pixelated' : 'auto',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)',
                  flexShrink: 0,
                  pointerEvents: 'none'
                }}
              />
            )}
          </>
        )}

        {status === 'ready' && tab === 'render' && analysis && (
          <>
            <canvas
              ref={previewCanvasRef}
              style={{
                width: Math.floor(availW / zoom) * zoom,
                height: Math.floor(availH / zoom) * zoom,
                imageRendering: zoom > 1 ? 'pixelated' : 'auto',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)',
                opacity: painting ? 0.85 : 1,
                transition: 'opacity 0.1s',
                flexShrink: 0,
                pointerEvents: 'none',
                visibility: unsupportedMsg || paintError ? 'hidden' : 'visible'
              }}
            />
            {(unsupportedMsg || paintError) && (
              <div style={{ position: 'absolute', display: 'flex' }}>
                <MessageCard
                  title="This preview isn't available"
                  message={unsupportedMsg || paintError}
                  note="The verdict, chart and level list on the right still work, they only need the size of the texture."
                  asset={asset}
                  onRevealInExplorer={onRevealInExplorer}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Render tab helpers */}
      {status === 'ready' && tab === 'render' && analysis && !unsupportedMsg && !paintError && (
        <>
          <FrameMap frameW={frameW} frameH={frameH} analysis={analysis} renderLabel={render.label} coverage={coverage} zoom={zoom} right={sidebarOpen ? SIDEBAR_SPACE + 12 : 24} />
          <div className="txtex-floating txtex-zoombar" style={{ right: sidebarOpen ? SIDEBAR_SPACE + 12 : 24 }}>
            <span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginRight: 2 }}>Magnify</span>
            {ZOOM_CHOICES.map((z) => (
              <Chip key={z} active={zoomChoice === z} onClick={() => setZoomChoice(z)} title={z === 'auto' ? 'Fit the object in the window' : `${z}× — each square is one pixel of the final render`}>
                {z === 'auto' ? 'Auto' : `${z}×`}
              </Chip>
            ))}
          </div>
        </>
      )}

      {/* Previous / next */}
      {txItems.length > 1 && (
        <>
          <button className="icon-btn txtex-arrow" style={{ left: 16 }} onClick={(e) => { e.stopPropagation(); goToPrev(); }} title="Previous texture (Left arrow)">
            <ChevronLeft size={20} />
          </button>
          <button className="icon-btn txtex-arrow" style={{ right: sidebarOpen ? SIDEBAR_SPACE + 6 : 16 }} onClick={(e) => { e.stopPropagation(); goToNext(); }} title="Next texture (Right arrow)">
            <ChevronRight size={20} />
          </button>
        </>
      )}

      {/* Info overlay */}
      <div className="viewport-stats-overlay">
        <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: 2 }}>{asset.name}</div>
        {level0 && (
          <div className="stat-row">
            <span>Size:</span>
            <span className="stat-value">{level0.width} × {level0.height}</span>
          </div>
        )}
        {mips.length > 0 && (
          <div className="stat-row">
            <span>Mip levels:</span>
            <span className="stat-value">{mips.length}</span>
          </div>
        )}
        {tab === 'texture' && shownLevel && (
          <div className="stat-row">
            <span>Showing:</span>
            <span className="stat-value">
              Level {shownLevel.index}{levelImage && levelImage.factor > 1 ? ` (shown at ${levelImage.width} px)` : ''}
              {tab === 'texture' ? ` · ${Math.round(tScale * 100)}%` : ''}
            </span>
          </div>
        )}
        {tab === 'render' && analysis && (
          <div className="stat-row">
            <span>Magnified:</span>
            <span className="stat-value">{zoom}×</span>
          </div>
        )}
        <div className="stat-row">
          <span>File Size:</span>
          <span className="stat-value">{formatBytes(totalBytes)}</span>
        </div>
        {txItems.length > 1 && (
          <div className="stat-row">
            <span>Asset:</span>
            <span className="stat-value">{currentIndex + 1} of {txItems.length}</span>
          </div>
        )}
      </div>

      {/* Right panel */}
      <div className={`hdr-inspector-sidebar ${!sidebarOpen ? 'collapsed' : ''}`}>
        <div className="hdr-controls-panel">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 12.5, color: '#ffffff' }}>
              <Layers size={15} color="#38bdf8" />
              <span>{asset.extension?.toLowerCase() === '.tex' ? 'TEX TEXTURE' : asset.extension?.toLowerCase() === '.tx' ? 'TX TEXTURE' : 'TX / TEX TEXTURE'}</span>
              <span style={{ fontSize: 9.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{asset.extension}</span>
            </div>
          </div>

          {status === 'loading' && <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: 6 }}>Reading the file...</div>}
          {status === 'error' && <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: 6 }}>{error}</div>}

          {status === 'ready' && analysis && (
            <>
              <Section
                title="WILL IT BE SHARP ENOUGH?"
                badge={`${render.label} · ${formatCoverage(coverage)}`}
                open={open.sharp}
                onToggle={() => setOpen((o) => ({ ...o, sharp: !o.sharp }))}
              >
                {/* Verdict */}
                <div style={{ borderLeft: `3px solid ${accent}`, background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '8px 10px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: accent, marginBottom: 3 }}>{verdict.headline}</div>
                  <div style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--text-main)' }}>{verdict.detail}</div>
                  {recommendedMip && (
                    <button
                      type="button"
                      className="txtex-link"
                      onClick={() => { setSelectedLevel(mips.indexOf(recommendedMip)); setSimWidth(null); setTab('render'); }}
                    >
                      Try it with {sizeLabel(recommendedMip.width)} (Level {recommendedMip.index})
                    </button>
                  )}
                  {safeLevel > 0 && (
                    <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--text-secondary)' }}>
                      Testing as if the texture were only {sizeLabel(testLevel.width)} ({testLevel.width} × {testLevel.height}).{' '}
                      <button type="button" className="txtex-link" style={{ display: 'inline', margin: 0 }} onClick={() => setSelectedLevel(0)}>
                        Back to full size
                      </button>
                    </div>
                  )}
                  {simulating && (
                    <div style={{ marginTop: 6, fontSize: 10.5, color: '#f59e0b', lineHeight: 1.4 }}>
                      What if: pretending the texture is {sizeLabel(simWidth)}. Your file is only {sizeLabel(level0.width)}, so the preview below still shows your real pixels.{' '}
                      <button type="button" className="txtex-link" style={{ display: 'inline', margin: 0 }} onClick={() => setSimWidth(null)}>
                        Back to the file’s size
                      </button>
                    </div>
                  )}
                </div>

                {whatIfSizes.length > 0 && (
                  <div className="control-group">
                    <div className="control-label">
                      <span>Texture size</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 400 }}>{simulating ? `what if ${sizeLabel(simWidth)}` : `${sizeLabel(textureWidth)} · from your file`}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <Chip
                        active={!simulating}
                        onClick={() => setSimWidth(null)}
                        title={`The size of the file you opened (${level0.width} px wide)`}
                        style={{ flex: 1 }}
                      >
                        File ({sizeLabel(level0.width)})
                      </Chip>
                      {whatIfSizes.map((w) => (
                        <Chip
                          key={w}
                          active={simulating && simWidth === w}
                          onClick={() => { setSelectedLevel(0); setSimWidth(w); }}
                          title={`Pretend the texture is ${w} px wide. This is a what-if: the preview still shows your file's pixels.`}
                          style={{ flex: 1 }}
                        >
                          {sizeLabel(w)}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}

                <div className="control-group">
                  <div className="control-label"><span>Final render size</span><span style={{ fontFamily: 'var(--font-mono)', fontWeight: 400 }}>{frameW} px wide</span></div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {RENDER_PRESETS.map((r) => (
                      <Chip key={r.id} active={renderId === r.id} onClick={() => { setRenderId(r.id); setView({ x: 0, y: 0 }); }} title={`${r.width} pixels wide`} style={{ flex: 1 }}>
                        {r.label}
                      </Chip>
                    ))}
                  </div>
                </div>

                <div className="control-group">
                  <div className="control-label">
                    <span>How big is it in the shot?</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 400 }}>{formatCoverage(coverage)} of the width</span>
                  </div>
                  <input
                    type="range"
                    className="range-slider"
                    min={0}
                    max={1000}
                    step={1}
                    value={coverageToSlider(coverage)}
                    onChange={(e) => { setCoverage(sliderToCoverage(Number(e.target.value))); setView({ x: 0, y: 0 }); }}
                    aria-label="How much of the frame width the object covers"
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: 'var(--text-muted)' }}>
                    <span>far away</span>
                    <span>fills the frame</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {DISTANCE_PRESETS.map((d) => (
                      <Chip key={d.id} active={Math.abs(Math.log(coverage / d.coverage)) < 0.02} onClick={() => { setCoverage(d.coverage); setView({ x: 0, y: 0 }); }} title={d.hint}>
                        {d.label}
                      </Chip>
                    ))}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                    <span style={{ whiteSpace: 'nowrap' }}>or type the pixels:</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      className="txtex-number"
                      value={pxDraft ?? (analysis.objW >= 100 ? Math.round(analysis.objW) : Number(analysis.objW.toFixed(1)))}
                      onChange={(e) => {
                        setPxDraft(e.target.value);
                        const v = Number(e.target.value);
                        if (v > 0) setPixels(v);
                      }}
                      onBlur={() => setPxDraft(null)}
                    />
                    <span style={{ whiteSpace: 'nowrap' }}>px wide</span>
                  </label>
                </div>

                <div className="control-group">
                  <div className="control-label">
                    <span>Texture repeats across it</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 400 }}>{repeats}×</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {REPEAT_PRESETS.map((r) => (
                      <Chip key={r} active={repeats === r} onClick={() => setRepeats(r)} style={{ flex: 1 }} title={r === 1 ? 'The texture covers the object once' : `The texture tiles ${r} times across the object`}>
                        {r}×
                      </Chip>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 2, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <StatRow label="One copy of the texture is" value={`${formatPixels(copyPx)} px wide`} title="How many pixels of the final image one copy of the texture spans" />
                  <StatRow
                    label="Texture pixels per render pixel"
                    value={`${verdict.texelsPerPixel >= 10 ? Math.round(verdict.texelsPerPixel) : verdict.texelsPerPixel.toFixed(2)} : 1`}
                    title="Around 1 : 1 is a perfect match. Below 1 the texture is stretched (soft), above 1 it has more detail than the image can show."
                  />
                  <StatRow label="The renderer reads" value={describeMipChoice(mips, analysis.pick)} title="Smaller copies (mip levels) of the texture are used for objects that are further away" />
                </div>
                {mips.length === 1 && (
                  <div style={{ fontSize: 10.5, color: '#f59e0b', lineHeight: 1.4 }}>
                    This file has no smaller mip levels, so the renderer has to read the full-size texture everywhere. Export it again with maketx / txmake to add them.
                  </div>
                )}
                {info && !info.isPlainTexture && (
                  <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    This is a “{info.textureFormat}” texture. The check above treats it like a flat texture on an object.
                  </div>
                )}
              </Section>

              <Section
                title="WHERE DOES IT HOLD UP?"
                badge={`${simulating ? 'what if ' : ''}${sizeLabel(textureWidth)}${repeats > 1 ? ` ×${repeats}` : ''}`}
                open={open.chart}
                onToggle={() => setOpen((o) => ({ ...o, chart: !o.chart }))}
              >
                <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  Every shot size and distance at a glance. Click a square to try it.
                </div>
                <div className="txtex-chart">
                  <div />
                  {RENDER_PRESETS.map((r) => (
                    <div key={r.id} className="txtex-chart-head">{r.label}</div>
                  ))}
                  {chart.map((row) => (
                    <React.Fragment key={row.distance.id}>
                      <div className="txtex-chart-label" title={row.distance.hint}>{row.distance.label}</div>
                      {row.cells.map((cell) => {
                        const selected = cell.render.id === renderId && Math.abs(Math.log(coverage / row.distance.coverage)) < 0.02;
                        return (
                          <button
                            key={cell.render.id}
                            type="button"
                            className={`txtex-cell ${selected ? 'selected' : ''}`}
                            style={{ background: TONE_COLORS[cell.verdict.level] }}
                            title={`${cell.render.label} render, ${row.distance.label.toLowerCase()}: ${cell.verdict.headline}`}
                            onClick={() => { setRenderId(cell.render.id); setCoverage(row.distance.coverage); setView({ x: 0, y: 0 }); }}
                          >
                            {CELL_WORDS[cell.verdict.level]}
                          </button>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 10px', fontSize: 9.5, color: 'var(--text-secondary)' }}>
                  {[
                    ['soft', 'Soft: too blurry'],
                    ['slightly-soft', 'Slight: a bit soft'],
                    ['good', 'Sharp: just right'],
                    ['more-than-enough', 'Plenty: more than needed'],
                    ['overkill', 'Overkill: far more than needed']
                  ].map(([k, t]) => (
                    <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: TONE_COLORS[k], display: 'inline-block' }} />
                      {t}
                    </span>
                  ))}
                </div>
              </Section>

              <Section
                title="MIP LEVELS"
                badge={`${mips.length} level${mips.length === 1 ? '' : 's'}`}
                open={open.mips}
                onToggle={() => setOpen((o) => ({ ...o, mips: !o.mips }))}
              >
                <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  Smaller copies of the texture. The renderer uses the small ones for things that are far away.
                  {tab === 'texture' ? ' Click a level to look at it.' : ' Click a level to pretend the texture was only that big.'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {mips.map((lv, i) => {
                    const used = i === analysis.pick.lower || (analysis.pick.mix > 0.15 && i === analysis.pick.upper);
                    const w = Math.max(3, (lv.width / level0.width) * 100);
                    const picked = tab === 'texture' ? i === shownIndex : i === safeLevel;
                    return (
                      <button
                        key={lv.index}
                        type="button"
                        className={`txtex-level ${picked ? 'selected' : ''}`}
                        onClick={() => { if (tab === 'texture') setViewLevel(i); else { setSelectedLevel(i); setSimWidth(null); } }}
                        title={lv.unsupported || `Level ${lv.index}: ${lv.width} × ${lv.height}`}
                      >
                        <span className="txtex-level-name">L{lv.index}</span>
                        <span className="txtex-level-bar">
                          <span style={{ width: `${w}%`, background: used ? accent : '#5a5a5a' }} />
                        </span>
                        <span className="txtex-level-size">{lv.width}×{lv.height}</span>
                        <span className="txtex-level-tag">
                          {lv.unsupported ? 'can’t show' : used ? 'used' : formatBytes(lv.storedBytes)}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>
                  “used” = what the renderer reads with your settings. Sizes on the right are what each level takes up in the file.
                </div>
              </Section>

              <Section title="FILE DETAILS" badge={info.compression} open={open.details} onToggle={() => setOpen((o) => ({ ...o, details: !o.details }))}>
                {info.madeWith && <StatRow label="Written by" value={info.madeWith} />}
                {info.textureFormat && <StatRow label="Texture type" value={info.textureFormat} />}
                {info.wrapModes && <StatRow label="Edges (wrap)" value={info.wrapModes} title="What happens outside the 0-1 texture area" />}
                <StatRow label="Channels" value={`${info.channels}${info.hasAlpha ? ' (with alpha)' : ''}`} />
                <StatRow label="Pixel type" value={`${info.bitsPerChannel}-bit ${info.isFloat ? 'float' : 'integer'}`} />
                <StatRow label="Tiles" value={info.tileWidth ? `${info.tileWidth} × ${info.tileHeight}` : 'none (strips)'} title="The renderer loads only the tiles it needs" />
                <StatRow label="Compression" value={info.compression} />
                {info.averageColor && <StatRow label="Average colour" value={info.averageColor.split(',').map((v) => Number(v).toFixed(2)).join(', ')} />}
                {info.constantColor && <StatRow label="Constant colour" value={info.constantColor} title="The whole texture is a single colour" />}
                <StatRow label="File size" value={formatBytes(totalBytes)} />
                {info.isFloat && (
                  <div style={{ fontSize: 9.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    Floating point textures are shown with a standard sRGB curve.
                  </div>
                )}
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageCard({ title, message, note, asset, onRevealInExplorer }) {
  return (
    <div
      className="txtex-floating"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: 24,
        background: 'rgba(25, 25, 25, 0.95)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 8,
        maxWidth: 460,
        textAlign: 'center',
        position: 'relative',
        cursor: 'default'
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: '#ff6b6b' }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{message}</div>
      {note && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{note}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button className="hud-btn" onClick={() => onRevealInExplorer(asset.path)} style={{ padding: '6px 14px' }}>
          Reveal in Explorer
        </button>
        {window.electronAPI?.openExternal && (
          <button className="hud-btn" onClick={() => window.electronAPI.openExternal(asset.path)} style={{ padding: '6px 14px' }}>
            Open in Default App
          </button>
        )}
      </div>
    </div>
  );
}

// Small map of the whole frame with the object drawn to scale
function FrameMap({ frameW, frameH, analysis, renderLabel, coverage, zoom, right }) {
  const mapW = 132;
  const mapH = Math.round(mapW * (frameH / frameW));
  const ow = Math.min(mapW * 1.5, Math.max(2, (analysis.objW / frameW) * mapW));
  const oh = Math.min(mapH * 1.5, Math.max(2, (analysis.objH / frameW) * mapW));
  return (
    <div className="txtex-floating txtex-framemap" style={{ right, top: 56 }}>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 5 }}>
        Your {renderLabel} shot ({frameW} × {frameH})
      </div>
      <div style={{ width: mapW, height: mapH, background: '#242424', border: '1px solid rgba(255,255,255,0.25)', position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: ow,
            height: oh,
            transform: 'translate(-50%, -50%)',
            background: 'rgba(56, 189, 248, 0.55)',
            border: '1px solid #38bdf8'
          }}
        />
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 5 }}>
        The object covers {formatCoverage(coverage)} of the width
        <br />
        = {formatPixels(analysis.objW)} px across
      </div>
      {zoom > 1 && (
        <div style={{ fontSize: 9.5, color: 'var(--text-muted)', marginTop: 4 }}>
          Each square is one pixel of your final image.
        </div>
      )}
    </div>
  );
}
