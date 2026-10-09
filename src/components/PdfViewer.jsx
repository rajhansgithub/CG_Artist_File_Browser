import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  FileText
} from 'lucide-react';
import { isQuickLookNavKey } from '../utils/quickLook';
import { formatBytes } from '../utils/formatHelpers';
import { openPdfDocument } from '../utils/pdfLoader';

// PDF points are 1/72 in, CSS pixels 1/96 in, so a "100%" page is 96/72 of the PDF scale.
const CSS_PER_POINT = 96 / 72;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const PAGE_GAP = 12;
const GUTTER = 48;

// One page. Only rasterised while near the viewport, so a 500-page document stays cheap in memory.
function PdfPage({ pdf, pageNumber, scale, rotation, cssWidth, cssHeight, root }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !root) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0].isIntersecting),
      { root, rootMargin: '900px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!visible) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }

    let cancelled = false;
    let task = null;
    (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: scale * dpr, rotation });
        const ctx = canvas.getContext('2d');
        // Render into an offscreen canvas first so zooming never flashes a blank page.
        const buffer = document.createElement('canvas');
        buffer.width = Math.max(1, Math.floor(viewport.width));
        buffer.height = Math.max(1, Math.floor(viewport.height));
        const bufferCtx = buffer.getContext('2d');
        bufferCtx.fillStyle = '#ffffff';
        bufferCtx.fillRect(0, 0, buffer.width, buffer.height);
        task = page.render({ canvasContext: bufferCtx, viewport });
        await task.promise;
        if (cancelled) return;
        canvas.width = buffer.width;
        canvas.height = buffer.height;
        ctx.drawImage(buffer, 0, 0);
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') {
          console.warn(`PDF page ${pageNumber} render failed:`, err);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (task) task.cancel();
    };
  }, [visible, pdf, pageNumber, scale, rotation]);

  return (
    <div
      ref={wrapRef}
      data-page={pageNumber}
      style={{
        width: cssWidth,
        height: cssHeight,
        flexShrink: 0,
        background: '#ffffff',
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.7)',
        position: 'relative'
      }}
    >
      <canvas ref={canvasRef} style={{ width: cssWidth, height: cssHeight, display: 'block' }} />
    </div>
  );
}

export default function PdfViewer({
  asset,
  allFolderItems = [],
  onClose,
  onSelectAsset,
  onRevealInExplorer,
  floating = false
}) {
  const [pdf, setPdf] = useState(null);
  const [pageSizes, setPageSizes] = useState([]); // [width, height] in PDF points at rotation 0
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [zoomMode, setZoomMode] = useState('width'); // 'width' | 'page' | number (1 = 100%)
  const [rotation, setRotation] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scrollEl, setScrollEl] = useState(null);
  const [isPanning, setIsPanning] = useState(false);

  const scrollRef = useRef(null);
  const panRef = useRef(null);
  const scrollFractionRef = useRef(null);
  const currentPageRef = useRef(1);

  // Stable ref callback: an inline one would be re-invoked every render and loop through setScrollEl
  const attachScrollEl = useCallback((el) => {
    scrollRef.current = el;
    setScrollEl(el);
  }, []);

  const pdfAssets = allFolderItems.filter((item) => !item.isDirectory && item.category === 'pdf');
  const currentIndex = pdfAssets.findIndex((item) => item.path === asset?.path);

  // Load the document whenever the asset changes
  useEffect(() => {
    if (!asset) return;
    let cancelled = false;
    let loaded = null;

    setPdf(null);
    setPageSizes([]);
    setLoadError(null);
    setIsLoading(true);
    setCurrentPage(1);
    setPageInput('1');
    currentPageRef.current = 1;
    setRotation(0);
    setZoomMode('width');

    (async () => {
      try {
        const doc = await openPdfDocument(asset.path);
        if (cancelled) {
          doc.destroy().catch(() => {});
          return;
        }
        loaded = doc;

        // Fetch page 1 dimensions first to initialize all pages instantly
        const firstPage = await doc.getPage(1);
        const firstV = firstPage.getViewport({ scale: 1 });
        firstPage.cleanup();
        const defaultDim = [firstV.width, firstV.height];

        // Immediately initialize all pages with default dimension so scroll bar and totalPages are instant
        const sizes = new Array(doc.numPages).fill(defaultDim);
        sizes[0] = defaultDim;
        setPdf(doc);
        setPageSizes(sizes.slice());
        setIsLoading(false);

        // Fetch exact dimensions for remaining pages in background batches if needed
        if (doc.numPages > 1) {
          const CHUNK = 50;
          for (let start = 2; start <= doc.numPages; start += CHUNK) {
            if (cancelled) return;
            const batch = [];
            for (let n = start; n < Math.min(start + CHUNK, doc.numPages + 1); n++) {
              batch.push(
                doc.getPage(n).then((page) => {
                  const v = page.getViewport({ scale: 1 });
                  page.cleanup();
                  return { index: n - 1, dim: [v.width, v.height] };
                })
              );
            }
            const results = await Promise.all(batch);
            if (cancelled) return;
            let updated = false;
            for (const r of results) {
              if (sizes[r.index][0] !== r.dim[0] || sizes[r.index][1] !== r.dim[1]) {
                sizes[r.index] = r.dim;
                updated = true;
              }
            }
            if (updated && !cancelled) setPageSizes(sizes.slice());
          }
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to open PDF:', err);
        setLoadError(
          err?.name === 'PasswordException'
            ? 'This PDF is password protected.'
            : err?.message || 'The file could not be read as a PDF.'
        );
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (loaded) loaded.destroy().catch(() => {});
    };
  }, [asset?.path]);

  // Track the scroll container size
  useEffect(() => {
    if (!scrollEl) return;
    const update = () => setViewport({ width: scrollEl.clientWidth, height: scrollEl.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scrollEl);
    return () => observer.disconnect();
  }, [scrollEl]);

  const rotated = rotation % 180 !== 0;
  const dims = (index) => {
    const size = pageSizes[index] || pageSizes[0] || [612, 792];
    return rotated ? [size[1], size[0]] : size;
  };

  // Effective zoom (1 = 100%)
  let zoom = 1;
  if (typeof zoomMode === 'number') {
    zoom = zoomMode;
  } else if (pageSizes.length > 0 && viewport.width > 0) {
    let widest = 0;
    for (let i = 0; i < pageSizes.length; i++) {
      const w = dims(i)[0];
      if (w > widest) widest = w;
    }
    if (widest <= 0) widest = 612;

    const fitWidth = (viewport.width - GUTTER) / (widest * CSS_PER_POINT);
    if (zoomMode === 'width') {
      zoom = fitWidth;
    } else {
      const [pw, ph] = dims(Math.max(0, currentPage - 1));
      const VERTICAL_GUTTER = 64 + GUTTER;
      const fitPage = Math.min(
        fitWidth * (widest / pw),
        Math.max(0.1, (viewport.height - VERTICAL_GUTTER) / (ph * CSS_PER_POINT))
      );
      zoom = fitPage;
    }
  }
  zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const scale = zoom * CSS_PER_POINT;

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Keep the reading position when the zoom changes
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const fraction = scrollFractionRef.current;
    if (el && fraction != null) {
      el.scrollTop = fraction * el.scrollHeight;
      scrollFractionRef.current = null;
    }
  }, [scale, rotation]);

  const rememberScroll = () => {
    const el = scrollRef.current;
    if (el && el.scrollHeight > 0) scrollFractionRef.current = el.scrollTop / el.scrollHeight;
  };

  const setZoomNumber = useCallback(
    (next) => {
      rememberScroll();
      setZoomMode(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));
    },
    []
  );
  const zoomBy = (factor) => setZoomNumber(zoomRef.current * factor);
  const fitWidth = () => {
    rememberScroll();
    setZoomMode('width');
  };
  const fitPage = () => {
    rememberScroll();
    setZoomMode('page');
  };
  const rotate = () => {
    rememberScroll();
    setRotation((r) => (r + 90) % 360);
  };

  const goToPage = useCallback((n) => {
    const el = scrollRef.current;
    if (!el) return;
    const target = Math.min(Math.max(1, n), Math.max(1, pageSizes.length));
    currentPageRef.current = target;
    setCurrentPage(target);
    setPageInput(String(target));
    const pageEl = el.querySelector(`[data-page="${target}"]`);
    if (pageEl) {
      const elRect = el.getBoundingClientRect();
      const pageRect = pageEl.getBoundingClientRect();
      const targetTop = el.scrollTop + (pageRect.top - elRect.top) - PAGE_GAP;
      el.scrollTo({ top: Math.max(0, targetTop), behavior: 'auto' });
    }
  }, [pageSizes.length]);

  // Which page is in view
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const elRect = el.getBoundingClientRect();
    const probe = elRect.top + el.clientHeight * 0.35;
    const pages = el.querySelectorAll('[data-page]');
    let found = 1;
    for (let i = 0; i < pages.length; i++) {
      const r = pages[i].getBoundingClientRect();
      if (r.bottom > probe) {
        found = i + 1;
        break;
      }
      found = i + 1;
    }
    if (found !== currentPageRef.current) {
      currentPageRef.current = found;
      setCurrentPage(found);
      setPageInput(String(found));
    }
  };

  const selectAssetAt = (index) => {
    if (pdfAssets.length > 1 && onSelectAsset) {
      onSelectAsset(pdfAssets[(index + pdfAssets.length) % pdfAssets.length]);
    }
  };
  const goToPrevAsset = () => selectAssetAt(currentIndex - 1);
  const goToNextAsset = () => selectAssetAt(currentIndex + 1);

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (floating && isQuickLookNavKey(e)) return; // the floating window's arrow keys move the grid selection
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      const el = scrollRef.current;
      const page = currentPageRef.current;

      if (e.key === 'Escape') {
        if (onClose) onClose();
      } else if (e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) {
        e.preventDefault();
        goToPage(page + 1);
      } else if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) {
        e.preventDefault();
        goToPage(page - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        goToPage(1);
      } else if (e.key === 'End') {
        e.preventDefault();
        goToPage(pageSizes.length);
      } else if (e.key === 'ArrowDown' && el) {
        e.preventDefault();
        el.scrollBy({ top: 80 });
      } else if (e.key === 'ArrowUp' && el) {
        e.preventDefault();
        el.scrollBy({ top: -80 });
      } else if (e.key === 'ArrowRight') {
        goToNextAsset();
      } else if (e.key === 'ArrowLeft') {
        goToPrevAsset();
      } else if (e.key === '+' || e.key === '=') {
        zoomBy(1.2);
      } else if (e.key === '-' || e.key === '_') {
        zoomBy(1 / 1.2);
      } else if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        fitWidth();
      } else if (e.key === '1' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setZoomNumber(1);
      } else if (e.key === 'f' || e.key === 'F') {
        fitPage();
      } else if (e.key === 'r' || e.key === 'R') {
        rotate();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToPage, onClose, pageSizes.length, setZoomNumber]);

  // Ctrl + wheel zooms (needs a non-passive listener to stop the webview zooming itself)
  useEffect(() => {
    if (!scrollEl) return;
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    scrollEl.addEventListener('wheel', onWheel, { passive: false });
    return () => scrollEl.removeEventListener('wheel', onWheel);
  }, [scrollEl, setZoomNumber]);

  // Drag to pan
  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    const el = scrollRef.current;
    panRef.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    setIsPanning(true);
  };
  const handleMouseMove = (e) => {
    if (!panRef.current) return;
    const el = scrollRef.current;
    el.scrollLeft = panRef.current.left - (e.clientX - panRef.current.x);
    el.scrollTop = panRef.current.top - (e.clientY - panRef.current.y);
  };
  const endPan = () => {
    panRef.current = null;
    setIsPanning(false);
  };

  const submitPageInput = (e) => {
    e.preventDefault();
    const n = parseInt(pageInput, 10);
    if (!Number.isNaN(n)) goToPage(n);
    else setPageInput(String(currentPage));
  };

  if (!asset) return null;

  const totalPages = pageSizes.length;

  return (
    <div
      className="viewport-wrapper"
      style={{
        background: '#0a0a0a',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
        overflow: 'hidden'
      }}
    >
      {/* Top Floating Controls Toolbar */}
      <div className="viewport-hud">
        <button className="hud-btn" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} title="Previous Page (Page Up)">
          <ChevronUp size={13} />
        </button>
        <form onSubmit={submitPageInput} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
            onFocus={(e) => e.target.select()}
            onBlur={() => setPageInput(String(currentPage))}
            aria-label="Page number"
            style={{
              width: 38,
              padding: '3px 4px',
              textAlign: 'center',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              background: 'var(--bg-hover)',
              color: 'var(--text-main)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-xs)'
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
            / {totalPages || '–'}
          </span>
        </form>
        <button className="hud-btn" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages} title="Next Page (Page Down)">
          <ChevronDown size={13} />
        </button>

        <div className="hud-divider" />

        <button className="hud-btn" onClick={() => zoomBy(1 / 1.2)} title="Zoom Out (-)">
          <ZoomOut size={13} />
          <span className="hud-label">Zoom Out</span>
        </button>
        <span style={{ fontSize: 11, minWidth: 40, textAlign: 'center', color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button className="hud-btn" onClick={() => zoomBy(1.2)} title="Zoom In (+)">
          <ZoomIn size={13} />
          <span className="hud-label">Zoom In</span>
        </button>
        <button className={`hud-btn ${zoomMode === 'width' ? 'active' : ''}`} onClick={fitWidth} title="Fit Width (Ctrl+0)">
          <Maximize2 size={13} />
          <span className="hud-label">Fit Width</span>
        </button>
        <button className={`hud-btn ${zoomMode === 'page' ? 'active' : ''}`} onClick={fitPage} title="Fit Page (F)">
          <FileText size={13} />
          <span className="hud-label">Fit Page</span>
        </button>
        <button className="hud-btn" onClick={() => setZoomNumber(1)} title="100% (Ctrl+1)">
          <span>1:1</span>
        </button>
        <button className="hud-btn" onClick={rotate} title="Rotate 90° Clockwise (R)">
          <RotateCw size={13} />
          <span className="hud-label">Rotate</span>
        </button>

        <div className="hud-divider" />

        {window.electronAPI?.openExternal && (
          <button className="hud-btn" onClick={() => window.electronAPI.openExternal(asset.path)} title="Open in default PDF app">
            <FileText size={13} />
            <span className="hud-label">Open</span>
          </button>
        )}
        <button className="hud-btn" onClick={() => onRevealInExplorer(asset.path)} title="Reveal in Windows Explorer">
          <ExternalLink size={13} />
          <span className="hud-label">Explorer</span>
        </button>

        {onClose && (
          <button className="hud-btn" onClick={onClose} style={{ marginLeft: 4 }} title="Close View (Esc)">
            ✕
          </button>
        )}
      </div>

      {/* Scrolling page column */}
      <div
        ref={attachScrollEl}
        tabIndex={-1}
        onScroll={handleScroll}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endPan}
        onMouseLeave={endPan}
        style={{
          flex: 1,
          width: '100%',
          overflow: 'auto',
          padding: `64px ${GUTTER / 2}px ${GUTTER}px`,
          cursor: isPanning ? 'grabbing' : 'grab',
          outline: 'none'
        }}
      >
        {pdf && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: PAGE_GAP,
              width: 'max-content',
              minWidth: '100%'
            }}
          >
            {pageSizes.map((_, i) => {
              const [w, h] = dims(i);
              return (
                <PdfPage
                  key={i}
                  pdf={pdf}
                  pageNumber={i + 1}
                  scale={scale}
                  rotation={rotation}
                  cssWidth={Math.floor(w * scale)}
                  cssHeight={Math.floor(h * scale)}
                  root={scrollEl}
                />
              );
            })}
          </div>
        )}
      </div>

      {isLoading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            pointerEvents: 'none'
          }}
        >
          <div
            className="spin-icon"
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              border: '3px solid rgba(255, 255, 255, 0.2)',
              borderTopColor: '#ffffff'
            }}
          />
          <span style={{ fontSize: 13, color: '#e0e0e0', fontFamily: 'var(--font-mono)' }}>
            Opening {asset.name}...
          </span>
        </div>
      )}

      {loadError && !isLoading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              padding: 24,
              background: 'rgba(25, 25, 25, 0.95)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 8,
              maxWidth: 420,
              textAlign: 'center'
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: '#ff6b6b' }}>PDF Preview Unavailable</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{loadError}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="hud-btn" onClick={() => onRevealInExplorer(asset.path)} style={{ padding: '6px 14px' }}>
                Reveal in Explorer
              </button>
              {window.electronAPI?.openExternal && (
                <button
                  className="hud-btn"
                  onClick={() => window.electronAPI.openExternal(asset.path)}
                  style={{ padding: '6px 14px' }}
                >
                  Open in Default App
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Previous / Next PDF in the folder */}
      {pdfAssets.length > 1 && (
        <>
          {[
            { side: 'left', onClick: goToPrevAsset, title: 'Previous PDF (Left Arrow)', Icon: ChevronLeft },
            { side: 'right', onClick: goToNextAsset, title: 'Next PDF (Right Arrow)', Icon: ChevronRight }
          ].map(({ side, onClick, title, Icon }) => (
            <button
              key={side}
              className="icon-btn"
              style={{
                position: 'absolute',
                [side]: 16,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: 'rgba(20, 20, 20, 0.85)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                backdropFilter: 'blur(8px)',
                zIndex: 15
              }}
              onClick={(e) => {
                e.stopPropagation();
                onClick();
              }}
              title={title}
            >
              <Icon size={20} />
            </button>
          ))}
        </>
      )}

      {/* Info HUD */}
      <div className="viewport-stats-overlay">
        <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: 2 }}>{asset.name}</div>
        <div className="stat-row">
          <span>Pages:</span>
          <span className="stat-value">{totalPages || '–'}</span>
        </div>
        <div className="stat-row">
          <span>File Size:</span>
          <span className="stat-value">{formatBytes(asset.size)}</span>
        </div>
        <div className="stat-row">
          <span>Zoom:</span>
          <span className="stat-value">{Math.round(zoom * 100)}%</span>
        </div>
        {pdfAssets.length > 1 && (
          <div className="stat-row">
            <span>Asset:</span>
            <span className="stat-value">
              {currentIndex + 1} of {pdfAssets.length}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
