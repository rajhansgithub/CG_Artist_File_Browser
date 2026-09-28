import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Repeat,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Music,
  Activity,
  Sliders,
  Square
} from 'lucide-react';
import { formatBytes, formatDuration } from '../utils/formatHelpers';

export default function AudioPlayer({
  asset,
  allFolderItems = [],
  onClose,
  onSelectAsset,
  onRevealInExplorer
}) {
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const vuCanvasRef = useRef(null);
  const containerRef = useRef(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isLooping, setIsLooping] = useState(false);

  // Audio analysis & waveform state
  const [waveformData, setWaveformData] = useState(null);
  const [audioMeta, setAudioMeta] = useState({
    sampleRate: null,
    channels: null,
    bitDepth: '16/24-bit PCM'
  });
  const [isDecodingWaveform, setIsDecodingWaveform] = useState(false);

  // Decoded audio sample data references for high-accuracy real-time stereo VU meter
  const decodedBufferRef = useRef(null);
  const leftChannelRef = useRef(null);
  const rightChannelRef = useRef(null);
  const animFrameRef = useRef(null);

  // Filter audio assets in current folder
  const audioAssets = allFolderItems.filter(
    (item) => !item.isDirectory && item.category === 'audio'
  );
  const currentIndex = audioAssets.findIndex((item) => item.path === asset?.path);

  const streamUrl = asset
    ? window.electronAPI?.toAssetUrl
      ? window.electronAPI.toAssetUrl(asset.path)
      : asset.path
    : '';

  // Decode audio file into waveform data
  useEffect(() => {
    if (!asset) return;

    let isMounted = true;
    setIsDecodingWaveform(true);
    setWaveformData(null);
    setCurrentTime(0);
    setIsPlaying(false);

    (async () => {
      try {
        let arrayBuffer = null;
        if (window.electronAPI?.readFileBuffer) {
          const buf = await window.electronAPI.readFileBuffer(asset.path);
          if (buf) {
            if (buf instanceof ArrayBuffer) {
              arrayBuffer = buf;
            } else if (ArrayBuffer.isView(buf)) {
              arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            } else if (buf.data) {
              arrayBuffer = new Uint8Array(buf.data).buffer;
            } else {
              arrayBuffer = new Uint8Array(buf).buffer;
            }
          }
        }

        if (!arrayBuffer) {
          const res = await fetch(streamUrl);
          if (res.ok) {
            arrayBuffer = await res.arrayBuffer();
          }
        }

        if (!arrayBuffer) throw new Error('Could not read audio buffer');

        // Create offline or standard AudioContext to decode
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const tempCtx = new AudioContextClass();
        const decodedBuffer = await tempCtx.decodeAudioData(arrayBuffer);

        if (!isMounted) {
          tempCtx.close();
          return;
        }

        setDuration(decodedBuffer.duration);
        setAudioMeta({
          sampleRate: decodedBuffer.sampleRate,
          channels: decodedBuffer.numberOfChannels === 1 ? 'Mono' : decodedBuffer.numberOfChannels === 2 ? 'Stereo' : `${decodedBuffer.numberOfChannels} Ch`,
          bitDepth: asset.extension.toLowerCase() === '.flac' ? '24-bit Lossless' : asset.extension.toLowerCase() === '.wav' ? '24/32-bit Float' : 'Compressed'
        });

        // Downsample to 250 peaks for high-resolution canvas drawing
        const rawChannelData = decodedBuffer.getChannelData(0);
        const samples = 250;
        const blockSize = Math.floor(rawChannelData.length / samples);
        const peaks = [];

        for (let i = 0; i < samples; i++) {
          const start = i * blockSize;
          let max = 0;
          for (let j = 0; j < blockSize; j++) {
            const val = Math.abs(rawChannelData[start + j] || 0);
            if (val > max) max = val;
          }
          peaks.push(max);
        }

        // Store raw channels in refs for real-time stereo VU monitoring
        decodedBufferRef.current = decodedBuffer;
        leftChannelRef.current = decodedBuffer.getChannelData(0);
        rightChannelRef.current =
          decodedBuffer.numberOfChannels > 1
            ? decodedBuffer.getChannelData(1)
            : decodedBuffer.getChannelData(0);

        setWaveformData(peaks);
        setIsDecodingWaveform(false);
        tempCtx.close();
      } catch (err) {
        console.warn('Waveform decode error:', err);
        if (isMounted) setIsDecodingWaveform(false);
      }
    })();

    return () => {
      isMounted = false;
      decodedBufferRef.current = null;
      leftChannelRef.current = null;
      rightChannelRef.current = null;
    };
  }, [asset]);

  // Draw interactive waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveformData) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Draw baseline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    const progress = duration > 0 ? currentTime / duration : 0;
    const barWidth = width / waveformData.length;
    const gap = 1.5;

    waveformData.forEach((peak, i) => {
      const x = i * barWidth;
      const barH = Math.max(3, peak * (height * 0.85));
      const y = (height - barH) / 2;

      // Colorize: White for played, muted grey for unplayed
      const isPlayed = i / waveformData.length <= progress;
      ctx.fillStyle = isPlayed ? '#ffffff' : 'rgba(255, 255, 255, 0.22)';
      ctx.fillRect(x, y, Math.max(1, barWidth - gap), barH);
    });

    // Draw active playhead needle
    const playheadX = progress * width;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 6;
    ctx.fillRect(playheadX - 1, 0, 2, height);
    ctx.shadowBlur = 0;
  }, [waveformData, currentTime, duration]);

  // Real-time stereo VU meter draw loop using actual channel sample analysis
  useEffect(() => {
    const vuCanvas = vuCanvasRef.current;
    if (!vuCanvas) return;

    const ctx = vuCanvas.getContext('2d');

    const drawVU = () => {
      animFrameRef.current = requestAnimationFrame(drawVU);
      ctx.clearRect(0, 0, vuCanvas.width, vuCanvas.height);

      let peakValL = 0;
      let peakValR = 0;

      if (isPlaying && decodedBufferRef.current && leftChannelRef.current) {
        const sr = decodedBufferRef.current.sampleRate || 44100;
        const currentAudioTime = audioRef.current ? audioRef.current.currentTime : currentTime;
        const centerSample = Math.floor(currentAudioTime * sr);
        const windowSize = 512;
        const startSample = Math.max(0, centerSample - 256);
        const endSample = Math.min(leftChannelRef.current.length, startSample + windowSize);

        let maxL = 0;
        let maxR = 0;
        const lData = leftChannelRef.current;
        const rData = rightChannelRef.current || lData;
        for (let i = startSample; i < endSample; i++) {
          const valL = Math.abs(lData[i] || 0);
          const valR = Math.abs(rData[i] || 0);
          if (valL > maxL) maxL = valL;
          if (valR > maxR) maxR = valR;
        }
        peakValL = Math.min(1, maxL * 1.35);
        peakValR = Math.min(1, maxR * 1.35);
      }

      // Draw dual stereo meters (L and R)
      const w = vuCanvas.width;
      const h = vuCanvas.height;
      const meterH = (h - 4) / 2;

      const peaks = [peakValL, peakValR];
      for (let channel = 0; channel < 2; channel++) {
        const y = channel * (meterH + 4);
        // Background track
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(0, y, w, meterH);

        // Active fill
        const fillW = peaks[channel] * w;
        const isClipping = peaks[channel] > 0.88;
        ctx.fillStyle = isClipping ? '#ef4444' : '#ffffff';
        ctx.fillRect(0, y, fillW, meterH);
      }
    };

    drawVU();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, currentTime]);

  const togglePlay = () => {
    if (!audioRef.current) return;

    if (audioRef.current.paused) {
      audioRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch((err) => {
          console.warn('Audio playback error:', err);
        });
    } else {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleStop = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setCurrentTime(0);
    setIsPlaying(false);
  };

  // Waveform click to scrub
  const handleWaveformClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || duration <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = pct * duration;
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleSpeedChange = (rate) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (audioRef.current) {
      audioRef.current.volume = val;
      audioRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    const nextMuted = !isMuted;
    audioRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  // Prev / Next file navigation
  const handlePrevAudio = () => {
    if (currentIndex > 0 && onSelectAsset) {
      onSelectAsset(audioAssets[currentIndex - 1]);
    }
  };

  const handleNextAudio = () => {
    if (currentIndex < audioAssets.length - 1 && onSelectAsset) {
      onSelectAsset(audioAssets[currentIndex + 1]);
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
        if (audioRef.current) {
          audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (audioRef.current) {
          audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 5);
        }
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        setIsLooping((prev) => !prev);
      } else if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [duration, onClose]);

  return (
    <div ref={containerRef} className="media-viewer-container">
      {/* Audio element */}
      <audio
        ref={audioRef}
        src={streamUrl}
        loop={isLooping}
        crossOrigin="anonymous"
        preload="auto"
        onLoadedMetadata={() => {
          if (audioRef.current) {
            const dur = audioRef.current.duration;
            if (isFinite(dur) && dur > 0) setDuration(dur);
            audioRef.current.volume = isMuted ? 0 : volume;
            audioRef.current.muted = isMuted;
            audioRef.current.playbackRate = playbackRate;
          }
        }}
        onTimeUpdate={() => {
          if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
        }}
        onEnded={() => {
          if (!isLooping) setIsPlaying(false);
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />

      {/* Header Bar */}
      <div className="media-viewer-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="logo-badge" style={{ background: '#262626' }}>
            <Music size={15} color="#ffffff" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)' }}>
              {asset?.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)' }}>
              <span>{formatBytes(asset?.size)}</span>
              {audioMeta.sampleRate && (
                <>
                  <span>•</span>
                  <span>{audioMeta.sampleRate.toLocaleString()} Hz</span>
                </>
              )}
              {audioMeta.channels && (
                <>
                  <span>•</span>
                  <span>{audioMeta.channels}</span>
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
          {/* Metadata Chips */}
          <div style={{ display: 'flex', gap: 6 }}>
            <span className="spec-badge">{audioMeta.channels || 'Audio'}</span>
            <span className="spec-badge">{audioMeta.sampleRate ? `${Math.round(audioMeta.sampleRate / 1000)} kHz` : asset.extension}</span>
          </div>

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

      {/* Center Stage: Interactive Waveform & Spectrum Visualizer */}
      <div className="audio-stage-container">
        {/* Waveform Card */}
        <div className="audio-card-box">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Activity size={14} color="#ffffff" />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#ffffff' }}>
                WAVEFORM INSPECTOR
              </span>
            </div>

            {/* Live Stereo VU meter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>VU:</span>
              <canvas ref={vuCanvasRef} width={80} height={16} style={{ borderRadius: 2 }} />
            </div>
          </div>

          {/* Waveform Canvas */}
          <div className="waveform-wrapper" onClick={handleWaveformClick}>
            {isDecodingWaveform ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                Decoding audio waveform...
              </div>
            ) : (
              <canvas
                ref={canvasRef}
                width={800}
                height={160}
                style={{ width: '100%', height: '100%', cursor: 'pointer' }}
              />
            )}
          </div>

          {/* Timecode Indicators */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            <span style={{ color: '#ffffff', fontWeight: 700 }}>
              {formatDuration(currentTime)}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>
              {formatDuration(duration)}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Transport Controls */}
      <div className="media-controls-dock">
        <div className="video-transport-row">
          {/* Left Transport */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              className="icon-btn"
              style={{ width: 28, height: 28 }}
              onClick={handlePrevAudio}
              disabled={currentIndex <= 0}
              title="Previous Audio File in Folder"
            >
              <ChevronLeft size={14} />
            </button>

            <button
              className="icon-btn"
              style={{ width: 28, height: 28 }}
              onClick={handleStop}
              title="Stop and Return to Start"
            >
              <Square size={12} />
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
              onClick={handleNextAudio}
              disabled={currentIndex >= audioAssets.length - 1}
              title="Next Audio File in Folder"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Center: Seamless Game Audio Loop Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className={`filter-btn ${isLooping ? 'active' : ''}`}
              onClick={() => setIsLooping(!isLooping)}
              title="Seamless Loop (L) — Verify game audio loops without clipping"
            >
              <Repeat size={13} />
              <span>{isLooping ? 'Looping (Active)' : 'Seamless Loop'}</span>
            </button>
          </div>

          {/* Right Transport: Speed, Volume */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Speed Multiplier */}
            <select
              value={playbackRate}
              onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
              className="filter-btn"
              style={{ height: 28, fontSize: 11, fontFamily: 'var(--font-mono)' }}
              title="Playback Rate"
            >
              <option value={0.5} style={{ color: '#000', backgroundColor: '#fff' }}>0.5x</option>
              <option value={0.75} style={{ color: '#000', backgroundColor: '#fff' }}>0.75x</option>
              <option value={1.0} style={{ color: '#000', backgroundColor: '#fff' }}>1.0x</option>
              <option value={1.25} style={{ color: '#000', backgroundColor: '#fff' }}>1.25x</option>
              <option value={1.5} style={{ color: '#000', backgroundColor: '#fff' }}>1.5x</option>
            </select>

            {/* Volume */}
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
          </div>
        </div>
      </div>
    </div>
  );
}
