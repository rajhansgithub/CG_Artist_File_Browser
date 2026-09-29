import React, { useState, useEffect, useRef } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Info,
  Camera,
  Check
} from 'lucide-react';
import { formatBytes } from '../utils/formatHelpers';

export default function ImageViewer({
  asset,
  allFolderItems = [],
  onClose,
  onSelectAsset,
  onRevealInExplorer
}) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [displaySrc, setDisplaySrc] = useState(null);
  const [isDecoding, setIsDecoding] = useState(false);
  const [decodeError, setDecodeError] = useState(null);
  const [snapshotFeedback, setSnapshotFeedback] = useState(false);
  const containerRef = useRef(null);

  // List of all image and texture assets in current folder
  const imageAssets = allFolderItems.filter(
    (item) => !item.isDirectory && (item.category === 'image' || item.category === 'texture')
  );
  const currentIndex = imageAssets.findIndex((item) => item.path === asset?.path);

  // Clean up blob URL on unmount or file switch
  const blobUrlRef = useRef(null);

  // Reset transforms and load image source (supports full TIFF / TGA decoding)
  useEffect(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setRotation(0);
    setDimensions({ width: 0, height: 0 });
    setDecodeError(null);

    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    if (!asset) {
      setDisplaySrc(null);
      return;
    }

    const ext = (asset.extension || '').toLowerCase();

    if (ext === '.tif' || ext === '.tiff' || ext === '.tga') {
      setDisplaySrc(null);
      setIsDecoding(true);
      let isMounted = true;

      (async () => {
        try {
          if (typeof window !== 'undefined') {
            window.log = console.log;
          }
          if (typeof globalThis !== 'undefined') {
            globalThis.log = console.log;
          }

          let arrayBuf = null;
          if (window.electronAPI?.readFileBuffer) {
            const buf = await window.electronAPI.readFileBuffer(asset.path);
            if (buf) {
              if (buf instanceof ArrayBuffer) {
                arrayBuf = buf;
              } else if (ArrayBuffer.isView(buf)) {
                arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
              } else if (buf.data) {
                arrayBuf = new Uint8Array(buf.data).buffer;
              } else {
                arrayBuf = new Uint8Array(buf).buffer;
              }
            }
          }

          if (!arrayBuf) {
            const url = window.electronAPI?.toAssetUrl ? window.electronAPI.toAssetUrl(asset.path) : asset.path;
            const res = await fetch(url);
            if (res.ok) {
              arrayBuf = await res.arrayBuffer();
            }
          }

          if (!arrayBuf) throw new Error('Could not read texture file buffer');

          let parsed = null;
          if (ext === '.tga') {
            const { TGALoader } = await import('three/addons/loaders/TGALoader.js');
            parsed = new TGALoader().parse(arrayBuf);
          } else {
            // TIFF format: attempt direct UTIF decode with IFD context first
            try {
              const { default: UTIF } = await import('three/addons/libs/utif.module.js');
              const ifds = UTIF.decode(arrayBuf);
              if (ifds && ifds.length > 0) {
                UTIF.decodeImage(arrayBuf, ifds[0], ifds);
                const rgba = UTIF.toRGBA8(ifds[0]);
                parsed = {
                  width: ifds[0].width,
                  height: ifds[0].height,
                  data: rgba
                };
              }
            } catch (utifErr) {
              console.warn('Direct UTIF decode failed, falling back to TIFFLoader:', utifErr);
            }

            if (!parsed || !parsed.data) {
              const { TIFFLoader } = await import('three/addons/loaders/TIFFLoader.js');
              parsed = new TIFFLoader().parse(arrayBuf);
            }
          }

          if (parsed && parsed.data && isMounted) {
            const canvas = document.createElement('canvas');
            canvas.width = parsed.width;
            canvas.height = parsed.height;
            const ctx = canvas.getContext('2d');
            const imgData = ctx.createImageData(parsed.width, parsed.height);

            const totalPixels = parsed.width * parsed.height;
            if (parsed.data.length === totalPixels * 4) {
              imgData.data.set(parsed.data);
            } else if (parsed.data.length === totalPixels) {
              // Grayscale 1-channel (displacement, roughness, metallic, etc.)
              for (let i = 0; i < totalPixels; i++) {
                const v = parsed.data[i];
                imgData.data[i * 4] = v;
                imgData.data[i * 4 + 1] = v;
                imgData.data[i * 4 + 2] = v;
                imgData.data[i * 4 + 3] = 255;
              }
            } else if (parsed.data.length >= totalPixels * 3) {
              // 3-channel RGB
              for (let i = 0; i < totalPixels; i++) {
                imgData.data[i * 4] = parsed.data[i * 3];
                imgData.data[i * 4 + 1] = parsed.data[i * 3 + 1];
                imgData.data[i * 4 + 2] = parsed.data[i * 3 + 2];
                imgData.data[i * 4 + 3] = 255;
              }
            } else {
              imgData.data.set(parsed.data.subarray(0, imgData.data.length));
            }

            ctx.putImageData(imgData, 0, 0);

            canvas.toBlob((blob) => {
              if (!isMounted || !blob) return;
              const objectUrl = URL.createObjectURL(blob);
              blobUrlRef.current = objectUrl;
              setDisplaySrc(objectUrl);
              setDimensions({ width: parsed.width, height: parsed.height });
              setIsDecoding(false);
            }, 'image/png');
            return;
          } else {
            throw new Error('TIFF parsed texture data is empty');
          }
        } catch (e) {
          console.error('Failed to decode texture in viewer:', e);
          if (isMounted) {
            setDecodeError(e.message || 'Unable to decode texture');
          }
        } finally {
          if (isMounted) setIsDecoding(false);
        }
      })();

      return () => {
        isMounted = false;
      };
    } else {
      const src = window.electronAPI?.toAssetUrl
        ? window.electronAPI.toAssetUrl(asset.path)
        : asset.path;
      setDisplaySrc(src);
      setIsDecoding(false);
    }
  }, [asset?.path]);

  // Clean up blob URL on component unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        goToNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        goToPrev();
      } else if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        fitToScreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, imageAssets]);

  const goToNext = () => {
    if (currentIndex < imageAssets.length - 1) {
      onSelectAsset(imageAssets[currentIndex + 1]);
    } else if (imageAssets.length > 0) {
      onSelectAsset(imageAssets[0]); // loop to start
    }
  };

  const goToPrev = () => {
    if (currentIndex > 0) {
      onSelectAsset(imageAssets[currentIndex - 1]);
    } else if (imageAssets.length > 0) {
      onSelectAsset(imageAssets[imageAssets.length - 1]); // loop to end
    }
  };

  // Mouse wheel zoom
  const handleWheel = (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    setScale((prevScale) => Math.min(25, Math.max(0.1, prevScale * zoomFactor)));
  };

  // Pan dragging
  const handleMouseDown = (e) => {
    if (e.button !== 0) return; // left click only
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const fitToScreen = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setRotation(0);
  };

  const setActualSize = () => {
    setScale(2);
    setPosition({ x: 0, y: 0 });
  };

  const rotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleImageLoad = (e) => {
    setDimensions({
      width: e.target.naturalWidth,
      height: e.target.naturalHeight
    });
  };

  const imageSrc = window.electronAPI?.toAssetUrl
    ? window.electronAPI.toAssetUrl(asset?.path)
    : asset?.path;

  const handleExportPng = async () => {
    if (!displaySrc) return;
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || dimensions.width || 1920;
        canvas.height = img.naturalHeight || dimensions.height || 1080;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        const baseName = asset?.name ? asset.name.replace(/\.[^/.]+$/, '') : 'image';
        const defaultFilename = `${baseName}_export.png`;

        if (window.electronAPI?.saveImageFileDialog) {
          const res = await window.electronAPI.saveImageFileDialog(defaultFilename, dataUrl);
          if (res && res.success) {
            setSnapshotFeedback(true);
            setTimeout(() => setSnapshotFeedback(false), 2000);
          }
        } else {
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = defaultFilename;
          a.click();
          setSnapshotFeedback(true);
          setTimeout(() => setSnapshotFeedback(false), 2000);
        }
      };
      img.src = displaySrc;
    } catch (err) {
      console.error('Failed to export image:', err);
    }
  };

  if (!asset) return null;

  return (
    <div
      ref={containerRef}
      className="viewport-wrapper"
      style={{
        background: '#0a0a0a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
        overflow: 'hidden'
      }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Top Floating Controls Toolbar */}
      <div className="viewport-hud">
        <button className="hud-btn" onClick={() => setScale((s) => Math.min(25, s * 1.25))} title="Zoom In (+)">
          <ZoomIn size={13} />
          <span className="hud-label">Zoom In</span>
        </button>
        <button className="hud-btn" onClick={() => setScale((s) => Math.max(0.1, s * 0.8))} title="Zoom Out (-)">
          <ZoomOut size={13} />
          <span className="hud-label">Zoom Out</span>
        </button>
        <button className="hud-btn" onClick={fitToScreen} title="Fit to Screen (Ctrl+0)">
          <Maximize2 size={13} />
          <span className="hud-label">Fit</span>
        </button>
        <button className="hud-btn" onClick={setActualSize} title="100% Actual Pixels">
          <span>1:1</span>
        </button>
        <button className="hud-btn" onClick={rotate} title="Rotate 90° Clockwise">
          <RotateCw size={13} />
          <span className="hud-label">Rotate</span>
        </button>

        <div className="hud-divider" />

        <button
          className={`hud-btn ${snapshotFeedback ? 'active' : ''}`}
          onClick={handleExportPng}
          disabled={!displaySrc}
          title="Export as PNG"
        >
          {snapshotFeedback ? <Check size={13} color="#22c55e" /> : <Camera size={13} />}
          <span className="hud-label">{snapshotFeedback ? 'Saved!' : 'Export PNG'}</span>
        </button>

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

      {/* Main Image Display */}
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: isDragging ? 'grabbing' : 'grab'
        }}
      >
        {isDecoding && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
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
              Decoding High-Res Texture ({asset.name})...
            </span>
          </div>
        )}

        {decodeError && !isDecoding && (
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
            <div style={{ fontSize: 14, fontWeight: 600, color: '#ff6b6b' }}>
              Texture Preview Unavailable
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {decodeError}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                className="hud-btn"
                onClick={() => onRevealInExplorer(asset.path)}
                style={{ padding: '6px 14px' }}
              >
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
        )}

        {!isDecoding && !decodeError && displaySrc && (
          <img
            src={displaySrc}
            alt={asset.name}
            onLoad={handleImageLoad}
            style={{
              maxWidth: '90%',
              maxHeight: '90%',
              objectFit: 'contain',
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale}) rotate(${rotation}deg)`,
              transition: isDragging ? 'none' : 'transform 0.1s ease-out',
              pointerEvents: 'none',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)'
            }}
            draggable={false}
          />
        )}
      </div>

      {/* Previous / Next Floating Arrows */}
      {imageAssets.length > 1 && (
        <>
          <button
            className="icon-btn"
            style={{
              position: 'absolute',
              left: 16,
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
              goToPrev();
            }}
            title="Previous Asset (Left Arrow)"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            className="icon-btn"
            style={{
              position: 'absolute',
              right: 16,
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
              goToNext();
            }}
            title="Next Asset (Right Arrow)"
          >
            <ChevronRight size={20} />
          </button>
        </>
      )}

      {/* Image Info HUD Overlay */}
      <div className="viewport-stats-overlay">
        <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: 2 }}>
          {asset.name}
        </div>
        {dimensions.width > 0 && (
          <div className="stat-row">
            <span>Dimensions:</span>
            <span className="stat-value">
              {dimensions.width} × {dimensions.height}
            </span>
          </div>
        )}
        <div className="stat-row">
          <span>File Size:</span>
          <span className="stat-value">{formatBytes(asset.size)}</span>
        </div>
        <div className="stat-row">
          <span>Zoom:</span>
          <span className="stat-value">{Math.round(scale * 100)}%</span>
        </div>
        {imageAssets.length > 1 && (
          <div className="stat-row">
            <span>Asset:</span>
            <span className="stat-value">
              {currentIndex + 1} of {imageAssets.length}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
