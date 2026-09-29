import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  Camera,
  Check,
  ExternalLink,
  Repeat,
  Sliders,
  Grid,
  Film,
  SunMedium,
  Layers
} from 'lucide-react';
import { formatBytes, formatDuration, formatTimecode } from '../utils/formatHelpers';

// Color Matrix computation for Channel soloing (RGB, R, G, B, Alpha, Lum) and Exposure EV
function getVideoColorMatrix(channel, exposure) {
  const E = Math.pow(2, exposure);
  switch (channel) {
    case 'r':
      return `${E} 0 0 0 0  ${E} 0 0 0 0  ${E} 0 0 0 0  0 0 0 0 1`;
    case 'g':
      return `0 ${E} 0 0 0  0 ${E} 0 0 0  0 ${E} 0 0 0  0 0 0 0 1`;
    case 'b':
      return `0 0 ${E} 0 0  0 0 ${E} 0 0  0 0 ${E} 0 0  0 0 0 0 1`;
    case 'alpha':
      return `0 0 0 ${E} 0  0 0 0 ${E} 0  0 0 0 ${E} 0  0 0 0 0 1`;
    case 'lum': {
      const r = (0.2126 * E).toFixed(4);
      const g = (0.7152 * E).toFixed(4);
      const b = (0.0722 * E).toFixed(4);
      return `${r} ${g} ${b} 0 0  ${r} ${g} ${b} 0 0  ${r} ${g} ${b} 0 0  0 0 0 0 1`;
    }
    case 'rgb':
    default:
      return `${E} 0 0 0 0  0 ${E} 0 0 0  0 0 ${E} 0 0  0 0 0 1 0`;
  }
}

export default function VideoPlayer({
  asset,
  allFolderItems = [],
  onClose,
  onSelectAsset,
  onRevealInExplorer
}) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);

  // Production frame rates & timecode
  const [fps, setFps] = useState(24); // 24 (Film/CG default), 25, 29.97, 30, 60
  const [timecodeMode, setTimecodeMode] = useState('frames'); // 'frames' or 'smpte'

  // A-B Loop points (Animation cycle review)
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopIn, setLoopIn] = useState(null);
  const [loopOut, setLoopOut] = useState(null);
  const [snapshotFeedback, setSnapshotFeedback] = useState(false);

  // Guides & Safe Areas overlay
  const [guideMode, setGuideMode] = useState('none'); // 'none', 'safe_areas', 'cinematic_239', 'social_916'

  // Video resolution metadata
  const [videoDims, setVideoDims] = useState({ width: 0, height: 0 });

  // Viewport Fit mode: 'width' (default), 'best', '1:1', 'height', 'fill', 'off'
  const [fitMode, setFitMode] = useState('width');

  // Exposure control in EV (-7.0 to +7.0, default 0.0)
  const [exposure, setExposure] = useState(0.0);
  const [isEActive, setIsEActive] = useState(false);
  const [isDraggingExposure, setIsDraggingExposure] = useState(false);

  // Zoom control via Hold Z + Drag Up/Down (range: 0.1 to 10.0, default 1.0)
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [isZActive, setIsZActive] = useState(false);
  const [isDraggingZoom, setIsDraggingZoom] = useState(false);

  // Mouse Seeking via Left-Click Drag Left/Right
  const [isScrubbingMouse, setIsScrubbingMouse] = useState(false);

  // Channel soloing: 'rgb', 'r', 'g', 'b', 'alpha', 'lum' (default: 'rgb')
  const [activeChannel, setActiveChannel] = useState('rgb');

  // Refs for drag & shortcut handling
  const isEKeyPressedRef = useRef(false);
  const isDraggingExposureRef = useRef(false);
  const wasDraggingExposureRef = useRef(false);
  const dragStartXRef = useRef(0);
  const startExposureRef = useRef(0);

  const isZKeyPressedRef = useRef(false);
  const isDraggingZoomRef = useRef(false);
  const wasDraggingZoomRef = useRef(false);
  const dragStartYRef = useRef(0);
  const startZoomRef = useRef(1.0);

  const isSeekingMouseRef = useRef(false);
  const wasDraggingSeekRef = useRef(false);
  const seekStartXRef = useRef(0);
  const seekStartTimeRef = useRef(0);
  const wasPlayingBeforeSeekRef = useRef(false);

  // Filter video assets in current folder for playlist stepping
  const videoAssets = allFolderItems.filter(
    (item) => !item.isDirectory && item.category === 'video'
  );
  const currentIndex = videoAssets.findIndex((item) => item.path === asset?.path);

  const streamUrl = asset
    ? window.electronAPI?.toAssetUrl
      ? window.electronAPI.toAssetUrl(asset.path)
      : asset.path
    : '';

  // Reset state when asset changes
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setLoopIn(null);
    setLoopOut(null);
    setLoopEnabled(false);
    setExposure(0);
    setZoomLevel(1.0);
    setActiveChannel('rgb');
  }, [asset]);

  // Global mousemove and mouseup listeners for Exposure Drag (E), Zoom Drag (Z), and Timeline Scrubbing
  useEffect(() => {
    const handleGlobalMouseMove = (e) => {
      // 1. Exposure drag (Hold E + Left-Click Drag Left/Right)
      if (isDraggingExposureRef.current) {
        e.preventDefault();
        const deltaX = e.clientX - dragStartXRef.current;
        const sensitivity = 0.007;
        const newEv = Math.max(-7.0, Math.min(7.0, startExposureRef.current + deltaX * sensitivity));
        setExposure(parseFloat(newEv.toFixed(2)));
        return;
      }

      // 2. Zoom drag (Hold Z + Left-Click Drag Up/Down)
      if (isDraggingZoomRef.current) {
        e.preventDefault();
        const deltaY = e.clientY - dragStartYRef.current;
        // Drag UP (deltaY < 0) zooms in, Drag DOWN (deltaY > 0) zooms out
        const newZoom = Math.max(0.1, Math.min(10.0, startZoomRef.current * Math.exp(-deltaY * 0.007)));
        setZoomLevel(parseFloat(newZoom.toFixed(2)));
        return;
      }

      // 3. Video Scrubbing drag (Left-Click Drag Left/Right on stage)
      if (isSeekingMouseRef.current) {
        e.preventDefault();
        const deltaX = e.clientX - seekStartXRef.current;
        if (Math.abs(deltaX) > 4) {
          wasDraggingSeekRef.current = true;
          setIsScrubbingMouse(true);
        }
        if (wasDraggingSeekRef.current && videoRef.current) {
          const dur = isFinite(duration) && duration > 0 ? duration : (videoRef.current.duration || 60);
          const timePerPixel = dur < 15 ? (dur / 400) : Math.max(0.02, Math.min(0.25, dur / 800));
          const newTime = Math.max(0, Math.min(dur, seekStartTimeRef.current + deltaX * timePerPixel));
          videoRef.current.currentTime = newTime;
          setCurrentTime(newTime);
        }
      }
    };

    const handleGlobalMouseUp = () => {
      if (isDraggingExposureRef.current) {
        isDraggingExposureRef.current = false;
        setIsDraggingExposure(false);
        setTimeout(() => {
          wasDraggingExposureRef.current = false;
        }, 80);
      }

      if (isDraggingZoomRef.current) {
        isDraggingZoomRef.current = false;
        setIsDraggingZoom(false);
        setTimeout(() => {
          wasDraggingZoomRef.current = false;
        }, 80);
      }

      if (isSeekingMouseRef.current) {
        isSeekingMouseRef.current = false;
        setIsScrubbingMouse(false);
        setTimeout(() => {
          wasDraggingSeekRef.current = false;
        }, 80);
      }
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [duration]);

  // Video event handlers
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const dur = videoRef.current.duration;
      setDuration(isFinite(dur) && dur > 0 ? dur : 0);
      setVideoDims({
        width: videoRef.current.videoWidth || 0,
        height: videoRef.current.videoHeight || 0
      });
      videoRef.current.playbackRate = playbackRate;
      videoRef.current.volume = isMuted ? 0 : volume;
      videoRef.current.muted = isMuted;
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current && !isScrubbing) {
      const time = videoRef.current.currentTime;
      setCurrentTime(time);

      // Check A-B loop boundary
      if (loopEnabled && loopOut !== null && loopIn !== null) {
        if (time >= loopOut) {
          videoRef.current.currentTime = loopIn;
          videoRef.current.play().catch(() => {});
        }
      }
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  // Step 1 exact frame (forward or backward)
  const stepFrame = (frames = 1) => {
    if (!videoRef.current) return;
    videoRef.current.pause();
    setIsPlaying(false);
    const frameDuration = fps > 0 ? 1 / fps : 1 / 24;
    const maxDur = isFinite(duration) && duration > 0 ? duration : 999999;
    const newTime = Math.max(0, Math.min(maxDur, videoRef.current.currentTime + frames * frameDuration));
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  };

  const handleSpeedChange = (rate) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  // Loop In/Out markers
  const setInPoint = () => {
    setLoopIn(currentTime);
    setLoopEnabled(true);
  };

  const setOutPoint = () => {
    setLoopOut(currentTime);
    setLoopEnabled(true);
  };

  const clearLoop = () => {
    setLoopIn(null);
    setLoopOut(null);
    setLoopEnabled(false);
  };

  // Capture uncompressed video snapshot frame (hotkey: S)
  const captureSnapshot = async () => {
    if (!videoRef.current) return;
    try {
      const v = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth || 1920;
      canvas.height = v.videoHeight || 1080;
      const ctx = canvas.getContext('2d');

      // Apply SVG filter on snapshot if exposure or channel isolation is active
      if (activeChannel !== 'rgb' || exposure !== 0) {
        try {
          ctx.filter = 'url(#video-color-filter)';
        } catch {
          ctx.filter = 'none';
        }
      }

      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

      const frameNum = Math.round(currentTime * fps);
      const dataUrl = canvas.toDataURL('image/png');
      const baseName = asset?.name ? asset.name.replace(/\.[^/.]+$/, '') : 'video';
      const channelSuffix = activeChannel !== 'rgb' ? `_${activeChannel}` : '';
      const expSuffix = exposure !== 0 ? `_ev${exposure >= 0 ? '+' : ''}${exposure.toFixed(1)}` : '';
      const defaultFilename = `${baseName}_frame_${frameNum}${channelSuffix}${expSuffix}.png`;

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
    } catch (err) {
      console.error('Failed to capture video frame grab:', err);
    }
  };

  // Fullscreen
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  // Prev / Next file navigation
  const handlePrevVideo = () => {
    if (currentIndex > 0 && onSelectAsset) {
      onSelectAsset(videoAssets[currentIndex - 1]);
    }
  };

  const handleNextVideo = () => {
    if (currentIndex < videoAssets.length - 1 && onSelectAsset) {
      onSelectAsset(videoAssets[currentIndex + 1]);
    }
  };

  // Keyboard navigation & Shortcuts (Exposure hold E, Channel Soloing 1-6/C, Playback)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      // E Key for Exposure interactive drag
      if (e.key === 'e' || e.key === 'E') {
        isEKeyPressedRef.current = true;
        setIsEActive(true);
      }

      // Z Key for Zoom interactive drag
      if (e.key === 'z' || e.key === 'Z') {
        isZKeyPressedRef.current = true;
        setIsZActive(true);
      }

      // If holding E, allow quick adjustments or reset
      if (isEKeyPressedRef.current) {
        if (e.key === '0') {
          e.preventDefault();
          setExposure(0);
          return;
        }
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          setExposure((prev) => Math.min(7.0, parseFloat((prev + 0.5).toFixed(1))));
          return;
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          setExposure((prev) => Math.max(-7.0, parseFloat((prev - 0.5).toFixed(1))));
          return;
        }
      }

      // If holding Z, allow 0 to reset zoom
      if (isZKeyPressedRef.current) {
        if (e.key === '0') {
          e.preventDefault();
          setZoomLevel(1.0);
          return;
        }
      }

      // Channel Soloing Shortcuts (when not holding E or Z)
      if (!isEKeyPressedRef.current && !isZKeyPressedRef.current) {
        if (e.key === '1') {
          setActiveChannel('rgb');
        } else if (e.key === '2') {
          setActiveChannel('r');
        } else if (e.key === '3') {
          setActiveChannel('g');
        } else if (e.key === '4') {
          setActiveChannel('b');
        } else if (e.key === '5') {
          setActiveChannel('alpha');
        } else if (e.key === '6') {
          setActiveChannel('lum');
        } else if (e.key === 'c' || e.key === 'C') {
          const channels = ['rgb', 'r', 'g', 'b', 'alpha', 'lum'];
          setActiveChannel((prev) => {
            const idx = channels.indexOf(prev);
            return channels[(idx + 1) % channels.length];
          });
        }
      }

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) {
          stepFrame(-fps); // -1 second
        } else {
          stepFrame(-1); // -1 frame
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) {
          stepFrame(fps); // +1 second
        } else {
          stepFrame(1); // +1 frame
        }
      } else if (e.key === ',' || e.key === '<') {
        e.preventDefault();
        stepFrame(-1);
      } else if (e.key === '.' || e.key === '>') {
        e.preventDefault();
        stepFrame(1);
      } else if (e.key === '[' || e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        setInPoint();
      } else if (e.key === ']' || e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        setOutPoint();
      } else if (e.key === '\\') {
        e.preventDefault();
        clearLoop();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        captureSnapshot();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'Escape') {
        if (isFullscreen) {
          document.exitFullscreen().catch(() => {});
          setIsFullscreen(false);
        } else if (onClose) {
          onClose();
        }
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === 'e' || e.key === 'E') {
        isEKeyPressedRef.current = false;
        setIsEActive(false);
        if (isDraggingExposureRef.current) {
          isDraggingExposureRef.current = false;
          setIsDraggingExposure(false);
          setTimeout(() => {
            wasDraggingExposureRef.current = false;
          }, 80);
        }
      }
      if (e.key === 'z' || e.key === 'Z') {
        isZKeyPressedRef.current = false;
        setIsZActive(false);
        if (isDraggingZoomRef.current) {
          isDraggingZoomRef.current = false;
          setIsDraggingZoom(false);
          setTimeout(() => {
            wasDraggingZoomRef.current = false;
          }, 80);
        }
      }
    };

    const handleBlur = () => {
      isEKeyPressedRef.current = false;
      setIsEActive(false);
      isDraggingExposureRef.current = false;
      setIsDraggingExposure(false);
      isZKeyPressedRef.current = false;
      setIsZActive(false);
      isDraggingZoomRef.current = false;
      setIsDraggingZoom(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [currentTime, duration, fps, loopEnabled, loopIn, loopOut, isFullscreen, currentIndex, activeChannel, exposure, zoomLevel]);

  const currentFrame = Math.round(currentTime * fps);
  const totalFrames = Math.round(duration * fps);

  // In / Out marker percentages on scrubber
  const inPercent = loopIn !== null && duration > 0 ? (loopIn / duration) * 100 : null;
  const outPercent = loopOut !== null && duration > 0 ? (loopOut / duration) * 100 : null;

  // Color Matrix Filter string for Exposure & Channel Soloing
  const colorMatrixValues = getVideoColorMatrix(activeChannel, exposure);
  const filterStyle = (activeChannel !== 'rgb' || exposure !== 0)
    ? 'url(#video-color-filter)'
    : 'none';

  // Interactive mouse handlers for stage: Exposure (E), Zoom (Z), and Timeline Scrubbing
  const handleStageMouseDown = (e) => {
    if (e.button !== 0) return; // Left click only

    // 1. Exposure drag / double-click reset (Hold E)
    if (isEKeyPressedRef.current) {
      if (e.detail === 2) {
        e.preventDefault();
        e.stopPropagation();
        setExposure(0.0);
        isDraggingExposureRef.current = false;
        setIsDraggingExposure(false);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      isDraggingExposureRef.current = true;
      wasDraggingExposureRef.current = true;
      dragStartXRef.current = e.clientX;
      startExposureRef.current = exposure;
      setIsDraggingExposure(true);
      return;
    }

    // 2. Zoom drag / double-click reset (Hold Z)
    if (isZKeyPressedRef.current) {
      if (e.detail === 2) {
        e.preventDefault();
        e.stopPropagation();
        setZoomLevel(1.0);
        isDraggingZoomRef.current = false;
        setIsDraggingZoom(false);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      isDraggingZoomRef.current = true;
      wasDraggingZoomRef.current = true;
      dragStartYRef.current = e.clientY;
      startZoomRef.current = zoomLevel;
      setIsDraggingZoom(true);
      return;
    }

    // 3. Timeline Seeking with mouse drag (Left click & drag left/right)
    e.preventDefault();
    isSeekingMouseRef.current = true;
    wasDraggingSeekRef.current = false;
    seekStartXRef.current = e.clientX;
    seekStartTimeRef.current = videoRef.current ? videoRef.current.currentTime : 0;
    if (isPlaying && videoRef.current) {
      wasPlayingBeforeSeekRef.current = true;
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      wasPlayingBeforeSeekRef.current = false;
    }
  };

  const handleStageClick = () => {
    if (
      wasDraggingExposureRef.current ||
      wasDraggingZoomRef.current ||
      wasDraggingSeekRef.current ||
      isEKeyPressedRef.current ||
      isZKeyPressedRef.current
    ) {
      wasDraggingExposureRef.current = false;
      wasDraggingZoomRef.current = false;
      wasDraggingSeekRef.current = false;
      return;
    }
    togglePlay();
  };

  const handleStageDoubleClick = (e) => {
    if (isEKeyPressedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      setExposure(0.0);
      return;
    }
    if (isZKeyPressedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      setZoomLevel(1.0);
      return;
    }
    toggleFullscreen();
  };

  // Compute Video styles based on fitMode and zoomLevel
  const getVideoStyle = () => {
    const base = {
      filter: filterStyle,
      transform: zoomLevel !== 1.0 ? `scale(${zoomLevel})` : 'none',
      transformOrigin: 'center center',
      transition: (isDraggingExposure || isDraggingZoom) ? 'none' : 'filter 0.08s ease, transform 0.08s ease'
    };

    switch (fitMode) {
      case '1:1':
        return {
          ...base,
          width: videoDims.width > 0 ? `${videoDims.width}px` : 'auto',
          height: videoDims.height > 0 ? `${videoDims.height}px` : 'auto',
          maxWidth: 'none',
          maxHeight: 'none',
          objectFit: 'none',
          flexShrink: 0
        };
      case 'width':
        return {
          ...base,
          width: '100%',
          height: 'auto',
          maxWidth: 'none',
          maxHeight: 'none',
          objectFit: 'contain'
        };
      case 'height':
        return {
          ...base,
          height: '100%',
          width: 'auto',
          maxWidth: 'none',
          maxHeight: 'none',
          objectFit: 'contain'
        };
      case 'fill':
        return {
          ...base,
          width: '100%',
          height: '100%',
          maxWidth: 'none',
          maxHeight: 'none',
          objectFit: 'fill'
        };
      case 'off':
        return {
          ...base,
          width: 'auto',
          height: 'auto',
          maxWidth: 'none',
          maxHeight: 'none',
          objectFit: 'none',
          flexShrink: 0
        };
      case 'best':
      default:
        return {
          ...base,
          maxWidth: '100%',
          maxHeight: '100%',
          width: 'auto',
          height: 'auto',
          objectFit: 'contain'
        };
    }
  };

  return (
    <div ref={containerRef} className="media-viewer-container">
      {/* SVG Color Matrix Filter for Exposure & Channel Soloing */}
      <svg style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none', visibility: 'hidden' }}>
        <defs>
          <filter id="video-color-filter" colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={colorMatrixValues} />
          </filter>
        </defs>
      </svg>

      {/* Top Header Bar */}
      <div className="media-viewer-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="logo-badge" style={{ background: '#262626' }}>
            <Film size={15} color="#ffffff" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)' }}>
              {asset?.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)' }}>
              <span>{formatBytes(asset?.size)}</span>
              {videoDims.width > 0 && (
                <>
                  <span>•</span>
                  <span>{videoDims.width} × {videoDims.height}</span>
                </>
              )}
              {duration > 0 && (
                <>
                  <span>•</span>
                  <span>{formatDuration(duration)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Header Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {/* Channel Soloing: RGB, R, G, B, Alpha, Lum */}
          <div
            style={{
              display: 'flex',
              background: 'var(--bg-tertiary)',
              padding: 2,
              borderRadius: 5,
              border: '1px solid var(--border-subtle)',
              height: 28
            }}
            title="Channel Soloing (Keys 1-6, C to cycle)"
          >
            {[
              { id: 'rgb', label: 'RGB', title: 'Full RGB Color [1]' },
              { id: 'r', label: 'R', title: 'Solo Red Channel [2]' },
              { id: 'g', label: 'G', title: 'Solo Green Channel [3]' },
              { id: 'b', label: 'B', title: 'Solo Blue Channel [4]' },
              { id: 'alpha', label: 'Alpha', title: 'Solo Alpha Channel (Transparency Matte) [5]' },
              { id: 'lum', label: 'Lum', title: 'Luminance Channel (Perceptual Grayscale) [6]' }
            ].map((ch) => (
              <button
                key={ch.id}
                className={`filter-btn ${activeChannel === ch.id ? 'active' : ''}`}
                style={{
                  height: 22,
                  padding: '0 6px',
                  fontSize: 10,
                  fontWeight: activeChannel === ch.id ? 700 : 500
                }}
                onClick={() => setActiveChannel(ch.id)}
                title={ch.title}
              >
                {ch.label}
              </button>
            ))}
          </div>

          {/* Exposure Control */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              background: 'var(--bg-tertiary)',
              padding: '2px 8px',
              borderRadius: 4,
              border: exposure !== 0 ? '1px solid #f59e0b' : '1px solid var(--border-subtle)',
              height: 28
            }}
            title="Exposure: Hold [E] + Left Click & Drag horizontally to adjust. Press 0 to reset."
          >
            <SunMedium size={12} color={exposure !== 0 ? '#f59e0b' : 'var(--text-muted)'} />
            <span
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                color: exposure !== 0 ? '#ffffff' : 'var(--text-secondary)',
                minWidth: 46,
                textAlign: 'center'
              }}
            >
              {exposure >= 0 ? `+${exposure.toFixed(1)}` : exposure.toFixed(1)} EV
            </span>
            <input
              type="range"
              min="-5"
              max="5"
              step="0.1"
              value={exposure}
              onChange={(e) => setExposure(parseFloat(e.target.value))}
              style={{ width: 50, height: 4, cursor: 'pointer' }}
              title={`Exposure: ${exposure >= 0 ? '+' : ''}${exposure.toFixed(1)} EV`}
            />
            {exposure !== 0 && (
              <button
                className="icon-btn"
                style={{ width: 18, height: 18, marginLeft: 1 }}
                onClick={() => setExposure(0)}
                title="Reset Exposure to 0.0 EV"
              >
                <RotateCcw size={10} />
              </button>
            )}
          </div>

          {/* Fit Mode Selector */}
          <select
            value={fitMode}
            onChange={(e) => setFitMode(e.target.value)}
            className="filter-btn"
            style={{ height: 28, fontSize: 11 }}
            title="Video Viewport Fit Mode"
          >
            <option value="width" style={{ color: '#000', backgroundColor: '#fff' }}>Fit: Width</option>
            <option value="best" style={{ color: '#000', backgroundColor: '#fff' }}>Fit: Best</option>
            <option value="1:1" style={{ color: '#000', backgroundColor: '#fff' }}>Fit: 1:1</option>
            <option value="height" style={{ color: '#000', backgroundColor: '#fff' }}>Fit: Height</option>
            <option value="fill" style={{ color: '#000', backgroundColor: '#fff' }}>Fit: Fill</option>
            <option value="off" style={{ color: '#000', backgroundColor: '#fff' }}>Fit: Off</option>
          </select>

          {/* FPS Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-tertiary)', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)', height: 28 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>FPS:</span>
            <select
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-main)',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer'
              }}
            >
              <option value={24} style={{ color: '#000', backgroundColor: '#fff' }}>24 fps (Film/VFX)</option>
              <option value={25} style={{ color: '#000', backgroundColor: '#fff' }}>25 fps (PAL)</option>
              <option value={29.97} style={{ color: '#000', backgroundColor: '#fff' }}>29.97 fps (NTSC)</option>
              <option value={30} style={{ color: '#000', backgroundColor: '#fff' }}>30 fps</option>
              <option value={60} style={{ color: '#000', backgroundColor: '#fff' }}>60 fps (Game)</option>
            </select>
          </div>

          {/* Guide / Safe Area Overlay */}
          <select
            value={guideMode}
            onChange={(e) => setGuideMode(e.target.value)}
            className="filter-btn"
            style={{ height: 28, fontSize: 11 }}
            title="Aspect Ratio & Safe Area Guides"
          >
            <option value="none" style={{ color: '#000', backgroundColor: '#fff' }}>Guides: None</option>
            <option value="safe_areas" style={{ color: '#000', backgroundColor: '#fff' }}>Action & Title Safe</option>
            <option value="cinematic_239" style={{ color: '#000', backgroundColor: '#fff' }}>2.39:1 Anamorphic</option>
            <option value="social_916" style={{ color: '#000', backgroundColor: '#fff' }}>9:16 Vertical Safe</option>
          </select>

          {/* Snapshot PNG Frame Grab (Icon Only) */}
          <button
            className={`icon-btn ${snapshotFeedback ? 'active' : ''}`}
            onClick={captureSnapshot}
            title={snapshotFeedback ? "Frame Grab Saved!" : "Export Frame as PNG (S key)"}
            style={{ width: 28, height: 28 }}
          >
            {snapshotFeedback ? <Check size={14} color="#22c55e" /> : <Camera size={14} />}
          </button>

          {/* Reveal in Explorer */}
          {onRevealInExplorer && (
            <button
              className="icon-btn"
              style={{ width: 28, height: 28 }}
              onClick={() => onRevealInExplorer(asset.path)}
              title="Reveal in Windows Explorer"
            >
              <ExternalLink size={13} />
            </button>
          )}

          {/* Close */}
          {onClose && (
            <button
              className="icon-btn"
              style={{ width: 28, height: 28 }}
              onClick={onClose}
              title="Close Player (Esc)"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Main Video Viewport Stage */}
      <div
        className="media-viewport-stage"
        style={{
          overflow: fitMode === 'best' || fitMode === 'fill' ? (zoomLevel > 1.0 ? 'auto' : 'hidden') : 'auto',
          cursor: isEActive || isDraggingExposure
            ? 'ew-resize'
            : isZActive || isDraggingZoom
            ? 'ns-resize'
            : isScrubbingMouse
            ? 'grabbing'
            : 'ew-resize'
        }}
        onMouseDown={handleStageMouseDown}
        onClick={handleStageClick}
        onDoubleClick={handleStageDoubleClick}
      >
        <video
          ref={videoRef}
          src={streamUrl}
          className="video-element"
          style={getVideoStyle()}
          crossOrigin="anonymous"
          preload="auto"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            if (loopEnabled && loopIn !== null) {
              videoRef.current.currentTime = loopIn;
              videoRef.current.play().catch(() => {});
            } else {
              setIsPlaying(false);
            }
          }}
          playsInline
        />

        {/* Guides Overlay */}
        {guideMode !== 'none' && (
          <div className="video-guides-overlay" style={{ pointerEvents: 'none' }}>
            {guideMode === 'safe_areas' && (
              <>
                <div className="guide-box action-safe" title="Action Safe (90%)" />
                <div className="guide-box title-safe" title="Title Safe (80%)" />
                <div className="guide-crosshair" />
              </>
            )}
            {guideMode === 'cinematic_239' && (
              <div className="guide-matte-239" />
            )}
            {guideMode === 'social_916' && (
              <div className="guide-matte-916" />
            )}
          </div>
        )}

        {/* Floating Exposure HUD when adjusting or holding E */}
        {(isEActive || isDraggingExposure) && (
          <div
            style={{
              position: 'absolute',
              top: 24,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(12, 12, 12, 0.92)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.22)',
              borderRadius: 8,
              padding: '8px 18px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              zIndex: 40,
              pointerEvents: 'none',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <SunMedium size={15} color="#f59e0b" />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#ffffff', fontFamily: 'var(--font-mono)' }}>
                Exposure: {exposure >= 0 ? `+${exposure.toFixed(2)}` : exposure.toFixed(2)} EV
              </span>
              <span style={{ fontSize: 11, color: '#aaaaaa' }}>
                ({Math.pow(2, exposure).toFixed(2)}×)
              </span>
            </div>
            <div style={{ fontSize: 10, color: '#888888', letterSpacing: '0.02em' }}>
              Hold E + Drag Left/Right • Double-Click with E or 0 to Reset
            </div>
          </div>
        )}

        {/* Floating Zoom HUD when adjusting or holding Z */}
        {(isZActive || isDraggingZoom) && (
          <div
            style={{
              position: 'absolute',
              top: 24,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(12, 12, 12, 0.92)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              borderRadius: 8,
              padding: '8px 18px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              zIndex: 40,
              pointerEvents: 'none',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Maximize2 size={15} color="#38bdf8" />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#ffffff', fontFamily: 'var(--font-mono)' }}>
                Zoom: {Math.round(zoomLevel * 100)}%
              </span>
              <span style={{ fontSize: 11, color: '#aaaaaa' }}>
                ({zoomLevel.toFixed(2)}×)
              </span>
            </div>
            <div style={{ fontSize: 10, color: '#888888', letterSpacing: '0.02em' }}>
              Hold Z + Drag Up/Down • Double-Click with Z or 0 to Reset
            </div>
          </div>
        )}

        {/* Floating Mouse Scrubbing / Seeking HUD */}
        {isScrubbingMouse && (
          <div
            style={{
              position: 'absolute',
              top: 24,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(12, 12, 12, 0.92)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(56, 189, 248, 0.5)',
              borderRadius: 8,
              padding: '8px 18px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              zIndex: 40,
              pointerEvents: 'none',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Film size={15} color="#38bdf8" />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#ffffff', fontFamily: 'var(--font-mono)' }}>
                {formatTimecode(currentTime, fps)} / {formatTimecode(duration, fps)}
              </span>
              <span style={{ fontSize: 11, color: '#38bdf8' }}>
                [Frame {currentFrame}]
              </span>
            </div>
            <div style={{ fontSize: 10, color: '#888888', letterSpacing: '0.02em' }}>
              ↔ Scrubbing Timeline (Drag Left / Right)
            </div>
          </div>
        )}

        {/* Floating Quick Action Overlay on Hover */}
        <div
          className="video-stage-badge"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            display: 'flex',
            gap: 6
          }}
        >
          {loopEnabled && (
            <span className="loop-indicator-badge">
              A-B LOOP ACTIVE ({loopIn !== null ? formatTimecode(loopIn, fps) : '0'} → {loopOut !== null ? formatTimecode(loopOut, fps) : 'End'})
            </span>
          )}
          {activeChannel !== 'rgb' && (
            <span
              className="loop-indicator-badge"
              style={{
                background: 'rgba(255, 255, 255, 0.15)',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.3)'
              }}
            >
              CHANNEL: {activeChannel.toUpperCase()}
            </span>
          )}
          {exposure !== 0 && (
            <span
              className="loop-indicator-badge"
              style={{
                background: 'rgba(245, 158, 11, 0.2)',
                color: '#fbbf24',
                border: '1px solid rgba(245, 158, 11, 0.4)'
              }}
            >
              EXP: {exposure >= 0 ? `+${exposure.toFixed(2)}` : exposure.toFixed(2)} EV
            </span>
          )}
          {zoomLevel !== 1.0 && (
            <span
              className="loop-indicator-badge"
              style={{
                background: 'rgba(56, 189, 248, 0.2)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.4)'
              }}
            >
              ZOOM: {Math.round(zoomLevel * 100)}%
            </span>
          )}
        </div>
      </div>

      {/* Bottom Timeline, Scrubbing & Transport Bar */}
      <div className="media-controls-dock">
        {/* Scrubber Timeline Bar with A-B loop flags */}
        <div className="video-scrubber-wrapper">
          <input
            type="range"
            className="video-scrubber"
            min="0"
            max={isFinite(duration) && duration > 0 ? duration : 1}
            step={fps > 0 ? 1 / fps : 0.0416}
            value={currentTime}
            onPointerDown={() => setIsScrubbing(true)}
            onPointerUp={() => setIsScrubbing(false)}
            onChange={handleSeek}
          />

          {/* Loop In / Out Marker Flags */}
          {inPercent !== null && (
            <div
              className="loop-marker in"
              style={{ left: `${inPercent}%` }}
              title={`In Point: ${formatTimecode(loopIn, fps)}`}
            />
          )}
          {outPercent !== null && (
            <div
              className="loop-marker out"
              style={{ left: `${outPercent}%` }}
              title={`Out Point: ${formatTimecode(loopOut, fps)}`}
            />
          )}
        </div>

        {/* Transport Toolbar Row */}
        <div className="video-transport-row">
          {/* Left Transport: Prev, Step Back, Play/Pause, Step Fwd, Next */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              className="icon-btn"
              style={{ width: 28, height: 28 }}
              onClick={handlePrevVideo}
              disabled={currentIndex <= 0}
              title="Previous Video in Folder"
            >
              <ChevronLeft size={14} />
            </button>

            <button
              className="icon-btn"
              style={{ width: 28, height: 28 }}
              onClick={() => stepFrame(-1)}
              title="Step -1 Frame (Left Arrow / comma)"
            >
              <span style={{ fontSize: 11, fontWeight: 700 }}>-1F</span>
            </button>

            <button
              className="icon-btn active"
              style={{ width: 34, height: 34, borderRadius: '50%' }}
              onClick={togglePlay}
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} style={{ marginLeft: 2 }} />}
            </button>

            <button
              className="icon-btn"
              style={{ width: 28, height: 28 }}
              onClick={() => stepFrame(1)}
              title="Step +1 Frame (Right Arrow / period)"
            >
              <span style={{ fontSize: 11, fontWeight: 700 }}>+1F</span>
            </button>

            <button
              className="icon-btn"
              style={{ width: 28, height: 28 }}
              onClick={handleNextVideo}
              disabled={currentIndex >= videoAssets.length - 1}
              title="Next Video in Folder"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Center: Frame Counter & Timecode Toggle */}
          <div
            className="video-timecode-box"
            onClick={() => setTimecodeMode(timecodeMode === 'frames' ? 'smpte' : 'frames')}
            title="Click to toggle between Exact Frame Counter and SMPTE Timecode"
          >
            {timecodeMode === 'frames' ? (
              <span>
                Frame <strong style={{ color: '#ffffff' }}>{currentFrame}</strong> / {totalFrames}
              </span>
            ) : (
              <span>
                <strong style={{ color: '#ffffff' }}>{formatTimecode(currentTime, fps)}</strong> / {formatTimecode(duration, fps)}
              </span>
            )}
          </div>

          {/* Right Transport: A-B Loop, Speed, Volume, Fullscreen */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* A-B Loop Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border-subtle)' }}>
              <button
                className={`text-btn ${loopIn !== null ? 'active' : ''}`}
                style={{ fontSize: 11, padding: '2px 5px', fontWeight: 600 }}
                onClick={setInPoint}
                title="Set Loop In Point ([ or I)"
              >
                In
              </button>
              <button
                className={`text-btn ${loopOut !== null ? 'active' : ''}`}
                style={{ fontSize: 11, padding: '2px 5px', fontWeight: 600 }}
                onClick={setOutPoint}
                title="Set Loop Out Point (] or O)"
              >
                Out
              </button>
              {loopEnabled && (
                <button
                  className="icon-btn"
                  style={{ width: 18, height: 18, fontSize: 10 }}
                  onClick={clearLoop}
                  title="Clear A-B Loop (\)"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Playback Speed Multiplier */}
            <select
              value={playbackRate}
              onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
              className="filter-btn"
              style={{ height: 28, fontSize: 11, fontFamily: 'var(--font-mono)' }}
              title="Playback Speed Multiplier"
            >
              <option value={0.25} style={{ color: '#000', backgroundColor: '#fff' }}>0.25x</option>
              <option value={0.5} style={{ color: '#000', backgroundColor: '#fff' }}>0.5x</option>
              <option value={1.0} style={{ color: '#000', backgroundColor: '#fff' }}>1.0x</option>
              <option value={1.5} style={{ color: '#000', backgroundColor: '#fff' }}>1.5x</option>
              <option value={2.0} style={{ color: '#000', backgroundColor: '#fff' }}>2.0x</option>
            </select>

            {/* Volume & Mute */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                className="icon-btn"
                style={{ width: 28, height: 28 }}
                onClick={toggleMute}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                style={{ width: 60, height: 4, cursor: 'pointer' }}
                title={`Volume: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
              />
            </div>

            {/* Fullscreen */}
            <button
              className="icon-btn"
              style={{ width: 28, height: 28 }}
              onClick={toggleFullscreen}
              title="Toggle Fullscreen (F)"
            >
              {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
