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
  ExternalLink,
  Repeat,
  Sliders,
  Grid,
  Film
} from 'lucide-react';
import { formatBytes, formatDuration, formatTimecode } from '../utils/formatHelpers';

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

  // Guides & Safe Areas overlay
  const [guideMode, setGuideMode] = useState('none'); // 'none', 'safe_areas', 'cinematic_239', 'social_916'

  // Video resolution metadata
  const [videoDims, setVideoDims] = useState({ width: 0, height: 0 });

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
  }, [asset]);

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
  const captureSnapshot = () => {
    if (!videoRef.current) return;
    const v = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth || 1920;
    canvas.height = v.videoHeight || 1080;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

    const frameNum = Math.round(currentTime * fps);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${asset.name.replace(/\.[^/.]+$/, '')}_frame_${frameNum}.png`;
    a.click();
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

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

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

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTime, duration, fps, loopEnabled, loopIn, loopOut, isFullscreen, currentIndex]);

  const currentFrame = Math.round(currentTime * fps);
  const totalFrames = Math.round(duration * fps);

  // In / Out marker percentages on scrubber
  const inPercent = loopIn !== null && duration > 0 ? (loopIn / duration) * 100 : null;
  const outPercent = loopOut !== null && duration > 0 ? (loopOut / duration) * 100 : null;

  return (
    <div ref={containerRef} className="media-viewer-container">
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* FPS Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-tertiary)', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border-subtle)' }}>
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

          {/* Snapshot PNG Frame Grab */}
          <button
            className="filter-btn"
            onClick={captureSnapshot}
            title="Export Frame as PNG (S key)"
          >
            <Camera size={13} />
            <span>Frame Grab</span>
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
      <div className="media-viewport-stage" onClick={togglePlay}>
        <video
          ref={videoRef}
          src={streamUrl}
          className="video-element"
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
