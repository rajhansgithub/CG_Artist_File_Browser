import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  Camera,
  Check,
  ExternalLink,
  Film,
  Repeat,
  SunMedium
} from 'lucide-react';
import { isQuickLookNavKey } from '../utils/quickLook';
import { formatBytes, formatTimecode } from '../utils/formatHelpers';
import {
  formatFrameNumber,
  missingFrameCount,
  sequenceRangeLabel
} from '../utils/imageSequence';
import { SequenceFrameLoader } from '../utils/sequenceFrameLoader';

// Color Matrix for channel soloing (RGB, R, G, B, Alpha, Lum) and exposure EV (same maths as the video player)
function getColorMatrix(channel, exposure) {
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

function readStored(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable: the choice just won't be remembered */
  }
}

export default function ImageSequencePlayer({
  asset,
  allFolderItems = [],
  onClose,
  onSelectAsset,
  onRevealInExplorer,
  floating = false
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const cacheBarRef = useRef(null);
  const loaderRef = useRef(null);

  const seq = asset?.sequence || null;
  const seqRef = useRef(seq);
  seqRef.current = seq;

  // present[i] = frame i exists on disk; holdOf[i] = the frame to show at slot i (a missing frame holds the one before it)
  const info = useMemo(() => {
    if (!seq) return null;
    const present = new Uint8Array(seq.slots);
    for (const n of seq.numbers) present[(n - seq.first) / seq.step] = 1;
    const holdOf = new Int32Array(seq.slots);
    let last = 0;
    for (let i = 0; i < seq.slots; i++) {
      if (present[i]) last = i;
      holdOf[i] = last;
    }
    return { present, holdOf };
  }, [asset?.path]);
  const infoRef = useRef(info);
  infoRef.current = info;

  const slots = seq ? seq.slots : 1;
  const frameNumberOf = (slot) => (seq ? seq.first + slot * seq.step : 0);

  // Playback state. The playhead (a slot index) lives in a ref the playback loop reads; `idx` mirrors it for rendering.
  const [idx, setIdx] = useState(0);
  const idxRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playingRef = useRef(false);
  const [fps, setFps] = useState(() => Number(readStored('cg_artist_seq_fps', 24)) || 24);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [repeat, setRepeat] = useState(true);
  const [timecodeMode, setTimecodeMode] = useState('frames'); // 'frames' or 'smpte'
  const fpsRef = useRef(fps);
  const rateRef = useRef(playbackRate);
  const repeatRef = useRef(repeat);
  fpsRef.current = fps;
  rateRef.current = playbackRate;
  repeatRef.current = repeat;

  // A-B loop (slot indices)
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopIn, setLoopIn] = useState(null);
  const [loopOut, setLoopOut] = useState(null);
  const loopRef = useRef({ enabled: false, lo: null, hi: null });
  loopRef.current = { enabled: loopEnabled, lo: loopIn, hi: loopOut };

  // What is on screen
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [awaiting, setAwaiting] = useState(true); // the current frame is still being decoded
  const [buffering, setBuffering] = useState(false); // playback is waiting for frames
  const [frameError, setFrameError] = useState('');
  const [cacheVersion, setCacheVersion] = useState(0);
  const drawnRef = useRef(-1);
  const awaitingRef = useRef(true);
  const bufferingRef = useRef(false);
  const dimsRef = useRef({ width: 0, height: 0 });

  // Viewer controls shared with the video player
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [snapshotFeedback, setSnapshotFeedback] = useState(false);
  const [guideMode, setGuideMode] = useState('none');
  const [fitMode, setFitMode] = useState('best');
  const [exposure, setExposure] = useState(0.0);
  const [isEActive, setIsEActive] = useState(false);
  const [isDraggingExposure, setIsDraggingExposure] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [isZActive, setIsZActive] = useState(false);
  const [isDraggingZoom, setIsDraggingZoom] = useState(false);
  const [isScrubbingMouse, setIsScrubbingMouse] = useState(false);
  const [isShiftActive, setIsShiftActive] = useState(false);
  const [activeChannel, setActiveChannel] = useState('rgb');

  const isEKeyPressedRef = useRef(false);
  const isDraggingExposureRef = useRef(false);
  const wasDraggingExposureRef = useRef(false);
  const dragStartXRef = useRef(0);
  const startExposureRef = useRef(0);
  const isZKeyPressedRef = useRef(false);
  const isDraggingZoomRef = useRef(false);
  const wasDraggingZoomRef = useRef(false);
  const startZoomRef = useRef(1.0);
  const isSeekingMouseRef = useRef(false);
  const wasDraggingSeekRef = useRef(false);
  const seekStartXRef = useRef(0);
  const seekStartSlotRef = useRef(0);
  const wasPlayingBeforeSeekRef = useRef(false);
  const cacheTimerRef = useRef(0);

  // Other sequences in this folder, for the previous / next buttons
  const sequenceAssets = allFolderItems.filter((item) => item.isSequence);
  const currentIndex = sequenceAssets.findIndex((item) => item.path === asset?.path);

  // ---- Playhead helpers (all read refs, so the playback loop and the loader callbacks never see stale state) ----

  // Loop range: the A-B points when set, otherwise the whole clip
  const getRange = () => {
    const { enabled, lo, hi } = loopRef.current;
    const last = seqRef.current ? seqRef.current.slots - 1 : 0;
    let a = enabled && lo !== null ? lo : 0;
    let b = enabled && hi !== null ? hi : last;
    if (b < a) {
      a = 0;
      b = last;
    }
    return { lo: a, hi: b };
  };

  // The slot played after `slot`, or null at the end of a clip that does not loop
  const nextSlot = (slot) => {
    const { lo, hi } = getRange();
    if (slot < hi) return slot + 1;
    return loopRef.current.enabled || repeatRef.current ? lo : null;
  };

  const setAwaitingFlag = (value) => {
    if (awaitingRef.current !== value) {
      awaitingRef.current = value;
      setAwaiting(value);
    }
  };

  const setBufferingFlag = (value) => {
    if (bufferingRef.current !== value) {
      bufferingRef.current = value;
      setBuffering(value);
    }
  };

  // Paints the frame under the playhead if it is decoded. Returns whether something is on screen for this slot.
  const draw = () => {
    const loader = loaderRef.current;
    const canvas = canvasRef.current;
    const hold = infoRef.current?.holdOf;
    if (!loader || !canvas || !hold) return false;
    const src = hold[idxRef.current];
    const frame = loader.get(src);
    if (!frame) return false;
    if (drawnRef.current !== src) {
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
      }
      canvas.getContext('2d').drawImage(frame.bitmap, 0, 0);
      drawnRef.current = src;
      if (dimsRef.current.width !== frame.width || dimsRef.current.height !== frame.height) {
        dimsRef.current = { width: frame.width, height: frame.height };
        setDims(dimsRef.current);
      }
    }
    setFrameError('');
    return true;
  };

  // Brings the screen in line with the playhead: paints the frame if it is decoded, otherwise shows why not
  const syncScreen = () => {
    const ok = draw();
    const loader = loaderRef.current;
    const src = infoRef.current?.holdOf[idxRef.current];
    const failure = !ok && loader && src !== undefined ? loader.error(src) : null;
    setFrameError(failure ? `Frame ${frameNumberOf(src)}: ${failure}` : '');
    setAwaitingFlag(!ok && !failure);
  };

  // Tells the loader which frames to decode next: the playhead first, then what playback will reach
  const refill = () => {
    const loader = loaderRef.current;
    const hold = infoRef.current?.holdOf;
    const total = seqRef.current?.slots;
    if (!loader || !hold || !total) return;
    const cur = idxRef.current;
    const playing = playingRef.current;
    // While playing, read as far ahead as the cache holds; while paused, only enough to make stepping instant
    const ahead = playing ? Math.max(8, Math.min(total - 1, loader.capacity() - 4)) : Math.min(24, total - 1);
    const behind = playing ? 0 : 4;
    const wanted = [];
    const seen = new Set();
    const want = (slot) => {
      const src = hold[slot];
      if (!seen.has(src)) {
        seen.add(src);
        wanted.push(src);
      }
    };
    want(cur);
    let s = cur;
    for (let k = 0; k < ahead; k++) {
      s = nextSlot(s);
      if (s === null) break;
      want(s);
    }
    for (let k = 1; k <= behind && cur - k >= 0; k++) want(cur - k);
    loader.setWanted(wanted, hold[cur]);
  };

  const seek = (slot) => {
    const total = seqRef.current ? seqRef.current.slots : 1;
    const clamped = Math.max(0, Math.min(total - 1, Math.round(slot)));
    idxRef.current = clamped;
    setIdx(clamped);
    // Going to a frame on purpose tries it again if it failed before
    const src = infoRef.current?.holdOf[clamped];
    if (src !== undefined) loaderRef.current?.retry(src);
    syncScreen();
    refill();
  };

  const pausePlayback = () => {
    playingRef.current = false;
    setIsPlaying(false);
    setBufferingFlag(false);
    refill();
  };

  const startPlayback = () => {
    const { lo, hi } = getRange();
    if (idxRef.current >= hi && !repeatRef.current && !loopRef.current.enabled) {
      idxRef.current = lo;
      setIdx(lo);
      syncScreen();
    }
    playingRef.current = true;
    setIsPlaying(true);
    refill();
  };

  const togglePlay = () => {
    if (playingRef.current) pausePlayback();
    else startPlayback();
  };

  const stepFrame = (frames = 1) => {
    if (playingRef.current) pausePlayback();
    seek(idxRef.current + frames);
  };

  // Loader callbacks go through a ref so the loader (created once per sequence) always calls the latest closures
  const hooksRef = useRef({});
  hooksRef.current.onFrame = (src) => {
    if (cacheTimerRef.current === 0) {
      cacheTimerRef.current = window.setTimeout(() => {
        cacheTimerRef.current = 0;
        setCacheVersion((v) => v + 1);
      }, 120);
    }
    const hold = infoRef.current?.holdOf;
    if (hold && hold[idxRef.current] === src) syncScreen();
  };
  hooksRef.current.onError = (src) => {
    const hold = infoRef.current?.holdOf;
    if (hold && hold[idxRef.current] === src) syncScreen();
  };

  // Open a sequence: fresh loader, playhead on the first frame
  useEffect(() => {
    if (!seq) return undefined;
    drawnRef.current = -1;
    dimsRef.current = { width: 0, height: 0 };
    idxRef.current = 0;
    playingRef.current = false;
    bufferingRef.current = false;
    awaitingRef.current = true;
    setIdx(0);
    setIsPlaying(false);
    setBuffering(false);
    setAwaiting(true);
    setFrameError('');
    setDims({ width: 0, height: 0 });
    setLoopIn(null);
    setLoopOut(null);
    setLoopEnabled(false);
    setExposure(0);
    setZoomLevel(1.0);
    setActiveChannel('rgb');

    const loader = new SequenceFrameLoader(seq, {
      onFrame: (src) => hooksRef.current.onFrame(src),
      onError: (src) => hooksRef.current.onError(src)
    });
    loaderRef.current = loader;
    refill();

    return () => {
      loader.dispose();
      loaderRef.current = null;
      window.clearTimeout(cacheTimerRef.current);
      cacheTimerRef.current = 0;
    };
  }, [asset?.path]);

  // Playback clock. Plays in real time: when decoding cannot keep up the playhead skips ahead to the newest
  // decoded frame; when nothing new is ready it waits ("buffering") instead of running on.
  useEffect(() => {
    if (!isPlaying) return undefined;
    let raf = 0;
    let clock = performance.now();

    const show = (slot) => {
      idxRef.current = slot;
      setIdx(slot);
      syncScreen();
      refill();
    };

    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const loader = loaderRef.current;
      const hold = infoRef.current?.holdOf;
      if (!loader || !hold) return;
      const cur = idxRef.current;

      if (bufferingRef.current) {
        const nxt = nextSlot(cur);
        if (nxt === null) {
          pausePlayback();
        } else if (loader.has(hold[nxt])) {
          show(nxt);
          clock = now;
          setBufferingFlag(false);
        }
        return;
      }

      const slotMs = 1000 / (fpsRef.current * rateRef.current);
      const owed = Math.floor((now - clock) / slotMs);
      if (owed < 1) return;

      const limit = Math.min(owed, 120);
      let cand = cur;
      let best = -1;
      let ended = false;
      for (let k = 0; k < limit; k++) {
        const nxt = nextSlot(cand);
        if (nxt === null) {
          ended = true;
          break;
        }
        cand = nxt;
        if (loader.has(hold[cand]) || loader.error(hold[cand])) best = cand;
      }

      if (best >= 0) {
        clock = owed > limit ? now : clock + owed * slotMs;
        show(best);
        if (ended && best === getRange().hi) pausePlayback();
      } else if (ended) {
        pausePlayback();
      } else {
        setBufferingFlag(true);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  // Cache bar under the scrubber: decoded frames in green, missing frames in red
  useEffect(() => {
    const canvas = cacheBarRef.current;
    const loader = loaderRef.current;
    if (!canvas || !loader || !seq) return;
    const width = Math.max(1, canvas.clientWidth);
    if (canvas.width !== width) canvas.width = width;
    canvas.height = 3;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, 3);
    const toX = (slot) => (slot / slots) * width;
    ctx.fillStyle = 'rgba(34, 197, 94, 0.85)';
    for (const slot of loader.cache.keys()) {
      const x0 = Math.floor(toX(slot));
      ctx.fillRect(x0, 0, Math.max(1, Math.ceil(toX(slot + 1)) - x0), 3);
    }
    if (missingFrameCount(seq) > 0 && info) {
      ctx.fillStyle = 'rgba(244, 63, 94, 0.9)';
      for (let slot = 0; slot < slots; slot++) {
        if (!info.present[slot]) ctx.fillRect(Math.floor(toX(slot)), 0, Math.max(1, Math.ceil(toX(slot + 1) - toX(slot))), 3);
      }
    }
  }, [cacheVersion, asset?.path]);

  // Global listeners for exposure drag (E), zoom drag (Z) and Shift-drag scrubbing
  useEffect(() => {
    const handleGlobalMouseMove = (e) => {
      if (isDraggingExposureRef.current) {
        e.preventDefault();
        const deltaX = e.clientX - dragStartXRef.current;
        const newEv = Math.max(-7.0, Math.min(7.0, startExposureRef.current + deltaX * 0.007));
        setExposure(parseFloat(newEv.toFixed(2)));
        return;
      }

      if (isDraggingZoomRef.current) {
        e.preventDefault();
        const deltaX = e.clientX - dragStartXRef.current;
        const newZoom = Math.max(0.1, Math.min(10.0, startZoomRef.current * Math.exp(deltaX * 0.007)));
        setZoomLevel(parseFloat(newZoom.toFixed(2)));
        return;
      }

      if (isSeekingMouseRef.current) {
        e.preventDefault();
        const deltaX = e.clientX - seekStartXRef.current;
        if (Math.abs(deltaX) > 4) {
          wasDraggingSeekRef.current = true;
          setIsScrubbingMouse(true);
        }
        if (wasDraggingSeekRef.current) {
          const total = seqRef.current ? seqRef.current.slots : 1;
          const framesPerPixel = total <= 200 ? 0.25 : total / 800;
          seek(seekStartSlotRef.current + deltaX * framesPerPixel);
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
  }, []);

  const handleSpeedChange = (rate) => setPlaybackRate(rate);

  const handleFpsChange = (value) => {
    setFps(value);
    writeStored('cg_artist_seq_fps', value);
  };

  // Loop In/Out markers
  const setInPoint = () => {
    loopRef.current = { ...loopRef.current, enabled: true, lo: idxRef.current };
    setLoopIn(idxRef.current);
    setLoopEnabled(true);
    refill();
  };

  const setOutPoint = () => {
    loopRef.current = { ...loopRef.current, enabled: true, hi: idxRef.current };
    setLoopOut(idxRef.current);
    setLoopEnabled(true);
    refill();
  };

  const clearLoop = () => {
    loopRef.current = { enabled: false, lo: null, hi: null };
    setLoopIn(null);
    setLoopOut(null);
    setLoopEnabled(false);
    refill();
  };

  // Export the frame on screen as PNG (hotkey: S), with the exposure / channel view applied
  const captureSnapshot = async () => {
    const canvas = canvasRef.current;
    if (!canvas || drawnRef.current < 0 || !seq) return;
    try {
      const out = document.createElement('canvas');
      out.width = canvas.width;
      out.height = canvas.height;
      const ctx = out.getContext('2d');
      if (activeChannel !== 'rgb' || exposure !== 0) {
        try {
          ctx.filter = 'url(#seq-color-filter)';
        } catch {
          ctx.filter = 'none';
        }
      }
      ctx.drawImage(canvas, 0, 0);

      const dataUrl = out.toDataURL('image/png');
      const baseName = seq.prefix.replace(/[._\-\s]+$/, '') || 'sequence';
      const channelSuffix = activeChannel !== 'rgb' ? `_${activeChannel}` : '';
      const expSuffix = exposure !== 0 ? `_ev${exposure >= 0 ? '+' : ''}${exposure.toFixed(1)}` : '';
      const defaultFilename = `${baseName}_frame_${formatFrameNumber(seq, frameNumberOf(idxRef.current))}${channelSuffix}${expSuffix}.png`;

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
      console.error('Failed to capture sequence frame grab:', err);
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  // Prev / Next sequence in the folder
  const handlePrevSequence = () => {
    if (currentIndex > 0 && onSelectAsset) onSelectAsset(sequenceAssets[currentIndex - 1]);
  };

  const handleNextSequence = () => {
    if (currentIndex >= 0 && currentIndex < sequenceAssets.length - 1 && onSelectAsset) {
      onSelectAsset(sequenceAssets[currentIndex + 1]);
    }
  };

  // Keyboard shortcuts: same keys as the video player, plus Home / End. The listeners are attached once and
  // call the handlers of the latest render, so playback re-renders do not re-register them.
  const keysRef = useRef({});
  useEffect(() => {
    const onKeyDown = (e) => keysRef.current.down(e);
    const onKeyUp = (e) => keysRef.current.up(e);
    const onBlur = () => keysRef.current.blur();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  const handleKeyDown = (e) => {
    if (floating && isQuickLookNavKey(e)) return; // the floating window's arrow keys move the grid selection
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    if (e.key === 'Shift') setIsShiftActive(true);

    if (e.key === 'e' || e.key === 'E') {
      isEKeyPressedRef.current = true;
      setIsEActive(true);
    }
    if (e.key === 'z' || e.key === 'Z') {
      isZKeyPressedRef.current = true;
      setIsZActive(true);
    }

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

    if (isZKeyPressedRef.current && e.key === '0') {
      e.preventDefault();
      setZoomLevel(1.0);
      return;
    }

    if (!isEKeyPressedRef.current && !isZKeyPressedRef.current) {
      if (e.key === '1') setActiveChannel('rgb');
      else if (e.key === '2') setActiveChannel('r');
      else if (e.key === '3') setActiveChannel('g');
      else if (e.key === '4') setActiveChannel('b');
      else if (e.key === '5') setActiveChannel('alpha');
      else if (e.key === '6') setActiveChannel('lum');
      else if (e.key === 'c' || e.key === 'C') {
        const channels = ['rgb', 'r', 'g', 'b', 'alpha', 'lum'];
        setActiveChannel((prev) => channels[(channels.indexOf(prev) + 1) % channels.length]);
      }
    }

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      stepFrame(e.shiftKey ? -Math.round(fpsRef.current) : -1);
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      stepFrame(e.shiftKey ? Math.round(fpsRef.current) : 1);
    } else if (e.key === ',' || e.key === '<') {
      e.preventDefault();
      stepFrame(-1);
    } else if (e.key === '.' || e.key === '>') {
      e.preventDefault();
      stepFrame(1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (playingRef.current) pausePlayback();
      seek(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      if (playingRef.current) pausePlayback();
      seek(slots - 1);
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
    if (e.key === 'Shift') setIsShiftActive(false);
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
    setIsShiftActive(false);
    isEKeyPressedRef.current = false;
    setIsEActive(false);
    isDraggingExposureRef.current = false;
    setIsDraggingExposure(false);
    isZKeyPressedRef.current = false;
    setIsZActive(false);
    isDraggingZoomRef.current = false;
    setIsDraggingZoom(false);
  };

  keysRef.current = { down: handleKeyDown, up: handleKeyUp, blur: handleBlur };

  if (!seq || !info) return null;

  const frameNumber = frameNumberOf(idx);
  const isMissingFrame = !info.present[idx];
  const missing = missingFrameCount(seq);
  const totalBytes = asset?.size || 0;
  const inPercent = loopIn !== null && slots > 1 ? (loopIn / (slots - 1)) * 100 : null;
  const outPercent = loopOut !== null && slots > 1 ? (loopOut / (slots - 1)) * 100 : null;

  const colorMatrixValues = getColorMatrix(activeChannel, exposure);
  const filterStyle = activeChannel !== 'rgb' || exposure !== 0 ? 'url(#seq-color-filter)' : 'none';

  // Interactive mouse handlers for the stage: Exposure (E), Zoom (Z) and Shift-drag scrubbing
  const handleStageMouseDown = (e) => {
    if (e.button !== 0) return;

    if (isEKeyPressedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      if (e.detail === 2) {
        setExposure(0.0);
        isDraggingExposureRef.current = false;
        setIsDraggingExposure(false);
        return;
      }
      isDraggingExposureRef.current = true;
      wasDraggingExposureRef.current = true;
      dragStartXRef.current = e.clientX;
      startExposureRef.current = exposure;
      setIsDraggingExposure(true);
      return;
    }

    if (isZKeyPressedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      if (e.detail === 2) {
        setZoomLevel(1.0);
        isDraggingZoomRef.current = false;
        setIsDraggingZoom(false);
        return;
      }
      isDraggingZoomRef.current = true;
      wasDraggingZoomRef.current = true;
      dragStartXRef.current = e.clientX;
      startZoomRef.current = zoomLevel;
      setIsDraggingZoom(true);
      return;
    }

    if (e.shiftKey) {
      e.preventDefault();
      isSeekingMouseRef.current = true;
      wasDraggingSeekRef.current = false;
      seekStartXRef.current = e.clientX;
      seekStartSlotRef.current = idxRef.current;
      wasPlayingBeforeSeekRef.current = playingRef.current;
      if (playingRef.current) pausePlayback();
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

  // Canvas size and fit, same modes as the video player
  const getStageStyle = () => {
    const base = {
      filter: filterStyle,
      transform: zoomLevel !== 1.0 ? `scale(${zoomLevel})` : 'none',
      transformOrigin: 'center center',
      transition: isDraggingExposure || isDraggingZoom ? 'none' : 'filter 0.08s ease, transform 0.08s ease'
    };

    switch (fitMode) {
      case '1:1':
        return {
          ...base,
          width: dims.width > 0 ? `${dims.width}px` : 'auto',
          height: dims.height > 0 ? `${dims.height}px` : 'auto',
          maxWidth: 'none',
          maxHeight: 'none',
          objectFit: 'none',
          flexShrink: 0
        };
      case 'width':
        return { ...base, width: '100%', height: 'auto', maxWidth: 'none', maxHeight: 'none', objectFit: 'contain' };
      case 'height':
        return { ...base, height: '100%', width: 'auto', maxWidth: 'none', maxHeight: 'none', objectFit: 'contain' };
      case 'fill':
        return { ...base, width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none', objectFit: 'fill' };
      case 'off':
        return { ...base, width: 'auto', height: 'auto', maxWidth: 'none', maxHeight: 'none', objectFit: 'none', flexShrink: 0 };
      case 'best':
      default:
        return { ...base, maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain' };
    }
  };

  return (
    <div ref={containerRef} className="media-viewer-container">
      {/* SVG Color Matrix Filter for Exposure & Channel Soloing */}
      <svg style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none', visibility: 'hidden' }}>
        <defs>
          <filter id="seq-color-filter" colorInterpolationFilters="sRGB">
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
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)' }}>{asset?.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              <span>{seq.numbers.length} frames</span>
              <span>•</span>
              <span>{sequenceRangeLabel(seq)}</span>
              {dims.width > 0 && (
                <>
                  <span>•</span>
                  <span>{dims.width} × {dims.height}</span>
                </>
              )}
              <span>•</span>
              <span>{formatBytes(totalBytes)}</span>
              {missing > 0 && (
                <>
                  <span>•</span>
                  <span style={{ color: '#f43f5e' }} title="Frames missing between the first and the last (shown in red on the timeline)">
                    {missing} missing
                  </span>
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
            title="Viewport Fit Mode"
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
              onChange={(e) => handleFpsChange(Number(e.target.value))}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-main)',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer'
              }}
            >
              <option value={12} style={{ color: '#000', backgroundColor: '#fff' }}>12 fps</option>
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
            title={snapshotFeedback ? 'Frame Grab Saved!' : 'Export Frame as PNG (S key)'}
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
              title="Reveal first frame in Windows Explorer"
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

      {/* Main Viewport Stage */}
      <div
        className="media-viewport-stage"
        style={{
          overflow: fitMode === 'best' || fitMode === 'fill' ? (zoomLevel > 1.0 ? 'auto' : 'hidden') : 'auto',
          cursor: isEActive || isDraggingExposure
            ? 'ew-resize'
            : isZActive || isDraggingZoom
            ? 'ew-resize'
            : isScrubbingMouse
            ? 'grabbing'
            : isShiftActive
            ? 'ew-resize'
            : 'pointer'
        }}
        onMouseDown={handleStageMouseDown}
        onClick={handleStageClick}
        onDoubleClick={handleStageDoubleClick}
      >
        <canvas ref={canvasRef} className="video-element" style={getStageStyle()} />

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
            {guideMode === 'cinematic_239' && <div className="guide-matte-239" />}
            {guideMode === 'social_916' && <div className="guide-matte-916" />}
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
              <span style={{ fontSize: 11, color: '#aaaaaa' }}>({Math.pow(2, exposure).toFixed(2)}×)</span>
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
              pointerEvents: 'auto',
              cursor: 'pointer',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)'
            }}
            onClick={(e) => {
              e.stopPropagation();
              setZoomLevel(1.0);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setZoomLevel(1.0);
            }}
            title="Click or Double-Click to Reset Zoom (0)"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Maximize2 size={15} color="#38bdf8" />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#ffffff', fontFamily: 'var(--font-mono)' }}>
                Zoom: {Math.round(zoomLevel * 100)}%
              </span>
              <span style={{ fontSize: 11, color: '#aaaaaa' }}>({zoomLevel.toFixed(2)}×)</span>
            </div>
            <div style={{ fontSize: 10, color: '#888888', letterSpacing: '0.02em' }}>
              Hold Z + Drag Left/Right • Double-Click Canvas, Badge or Press 0 to Reset
            </div>
          </div>
        )}

        {/* Floating Mouse Scrubbing HUD */}
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
                Frame {formatFrameNumber(seq, frameNumber)} / {seq.last}
              </span>
            </div>
            <div style={{ fontSize: 10, color: '#888888', letterSpacing: '0.02em' }}>
              ↔ Scrubbing Timeline (Hold Shift + Drag Left/Right)
            </div>
          </div>
        )}

        {/* Floating status badges */}
        <div
          className="video-stage-badge"
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: '80%' }}
        >
          {loopEnabled && (
            <span className="loop-indicator-badge">
              A-B LOOP ACTIVE ({formatFrameNumber(seq, frameNumberOf(loopIn ?? 0))} → {formatFrameNumber(seq, frameNumberOf(loopOut ?? slots - 1))})
            </span>
          )}
          {isMissingFrame && (
            <span
              className="loop-indicator-badge"
              style={{ background: 'rgba(244, 63, 94, 0.2)', color: '#fb7185', border: '1px solid rgba(244, 63, 94, 0.5)' }}
              title="This frame is not on disk; the previous frame is held"
            >
              MISSING FRAME {formatFrameNumber(seq, frameNumber)}
            </span>
          )}
          {buffering && (
            <span className="loop-indicator-badge" title="Playback is waiting for frames to finish decoding">
              BUFFERING…
            </span>
          )}
          {!buffering && awaiting && !frameError && (
            <span className="loop-indicator-badge">LOADING FRAME {formatFrameNumber(seq, frameNumber)}…</span>
          )}
          {frameError && (
            <span
              className="loop-indicator-badge"
              style={{ background: 'rgba(244, 63, 94, 0.2)', color: '#fb7185', border: '1px solid rgba(244, 63, 94, 0.5)' }}
            >
              {frameError}
            </span>
          )}
          {activeChannel !== 'rgb' && (
            <span
              className="loop-indicator-badge"
              style={{ background: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: '1px solid rgba(255, 255, 255, 0.3)' }}
            >
              CHANNEL: {activeChannel.toUpperCase()}
            </span>
          )}
          {exposure !== 0 && (
            <span
              className="loop-indicator-badge"
              style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.4)' }}
            >
              EXP: {exposure >= 0 ? `+${exposure.toFixed(2)}` : exposure.toFixed(2)} EV
            </span>
          )}
          {zoomLevel !== 1.0 && (
            <span
              className="loop-indicator-badge"
              style={{ background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.4)' }}
            >
              ZOOM: {Math.round(zoomLevel * 100)}%
            </span>
          )}
        </div>
      </div>

      {/* Bottom Timeline, Scrubbing & Transport Bar */}
      <div className="media-controls-dock">
        {/* Scrubber with the frame cache bar and A-B loop flags */}
        <div className="video-scrubber-wrapper">
          <input
            type="range"
            className="video-scrubber"
            min="0"
            max={Math.max(1, slots - 1)}
            step="1"
            value={idx}
            onPointerDown={() => {
              wasPlayingBeforeSeekRef.current = playingRef.current;
              if (playingRef.current) pausePlayback();
            }}
            onPointerUp={(e) => {
              e.currentTarget.blur(); // hand the keyboard back to the player shortcuts
              if (wasPlayingBeforeSeekRef.current) {
                wasPlayingBeforeSeekRef.current = false;
                startPlayback();
              }
            }}
            onChange={(e) => seek(parseInt(e.target.value, 10))}
            title="Drag to scrub"
          />
          <canvas
            ref={cacheBarRef}
            style={{ position: 'absolute', left: 0, bottom: 0, width: '100%', height: 3, pointerEvents: 'none', borderRadius: 2 }}
          />

          {inPercent !== null && (
            <div
              className="loop-marker in"
              style={{ left: `${inPercent}%` }}
              title={`In Point: frame ${formatFrameNumber(seq, frameNumberOf(loopIn))}`}
            />
          )}
          {outPercent !== null && (
            <div
              className="loop-marker out"
              style={{ left: `${outPercent}%` }}
              title={`Out Point: frame ${formatFrameNumber(seq, frameNumberOf(loopOut))}`}
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
              onClick={handlePrevSequence}
              disabled={currentIndex <= 0}
              title="Previous Image Sequence in Folder"
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
              onClick={handleNextSequence}
              disabled={currentIndex < 0 || currentIndex >= sequenceAssets.length - 1}
              title="Next Image Sequence in Folder"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Center: Frame Counter & Timecode Toggle */}
          <div
            className="video-timecode-box"
            onClick={() => setTimecodeMode(timecodeMode === 'frames' ? 'smpte' : 'frames')}
            title={`Frame ${formatFrameNumber(seq, frameNumber)} of ${sequenceRangeLabel(seq)}. Click to toggle between the frame number and SMPTE timecode`}
          >
            {timecodeMode === 'frames' ? (
              <span>
                Frame <strong style={{ color: '#ffffff' }}>{formatFrameNumber(seq, frameNumber)}</strong> / {seq.last}
              </span>
            ) : (
              <span>
                <strong style={{ color: '#ffffff' }}>{formatTimecode(idx / fps, fps)}</strong> / {formatTimecode(slots / fps, fps)}
              </span>
            )}
          </div>

          {/* Right Transport: Loop, A-B Loop, Speed, Fullscreen */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className={`icon-btn ${repeat ? 'active' : ''}`}
              style={{ width: 28, height: 28 }}
              onClick={() => {
                repeatRef.current = !repeatRef.current;
                setRepeat(repeatRef.current);
                refill();
              }}
              title={repeat ? 'Loop clip: on (plays again from the start)' : 'Loop clip: off (stops at the last frame)'}
              aria-pressed={repeat}
            >
              <Repeat size={13} />
            </button>

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
