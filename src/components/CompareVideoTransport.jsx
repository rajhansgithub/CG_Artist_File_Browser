import React, {
  useState,
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef
} from 'react';
import { Play, Pause, Repeat, Volume2, VolumeX } from 'lucide-react';
import { formatTimecode } from '../utils/formatHelpers';

const FPS_OPTIONS = [24, 25, 29.97, 30, 60];
const RATE_OPTIONS = [0.25, 0.5, 1, 2];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const durationOf = (v) => (v && isFinite(v.duration) && v.duration > 0 ? v.duration : 0);

// Shared transport for the two <video> elements of the Compare view.
// One timeline drives both clips: play, pause, scrub and frame-step move A and B together.
// "B offset" shifts clip B by whole frames so two takes that start at different moments can be lined up.
const CompareVideoTransport = forwardRef(function CompareVideoTransport(
  { videoARef, videoBRef, resetKey },
  ref
) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [total, setTotal] = useState(0);
  const [fps, setFps] = useState(24);
  const [rate, setRate] = useState(1);
  const [offset, setOffset] = useState(0); // frames; clip B shows time + offset / fps
  const [loop, setLoop] = useState(false);
  const [muted, setMuted] = useState(true);

  // Mirrors for the animation loop and for handlers that must never see stale values
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const fpsRef = useRef(24);
  const rateRef = useRef(1);
  const offsetRef = useRef(0);
  const loopRef = useRef(false);
  const mutedRef = useRef(true);

  fpsRef.current = fps;
  rateRef.current = rate;
  offsetRef.current = offset;
  loopRef.current = loop;
  mutedRef.current = muted;

  const offsetSeconds = () => offsetRef.current / fpsRef.current;

  const getTotal = () => {
    const durA = durationOf(videoARef.current);
    const durB = durationOf(videoBRef.current);
    return Math.max(durA, durB - offsetSeconds(), 0);
  };

  const applyMediaSettings = () => {
    const a = videoARef.current;
    const b = videoBRef.current;
    if (a) {
      a.muted = mutedRef.current;
      a.playbackRate = rateRef.current;
    }
    if (b) {
      b.muted = true; // only clip A is ever audible
      b.playbackRate = rateRef.current;
    }
  };

  // Put both clips on the frame for shared time t
  const seekTo = (t) => {
    const a = videoARef.current;
    const b = videoBRef.current;
    const end = getTotal();
    const next = clamp(t, 0, end);
    timeRef.current = next;
    if (a && durationOf(a)) a.currentTime = clamp(next, 0, durationOf(a));
    if (b && durationOf(b)) b.currentTime = clamp(next + offsetSeconds(), 0, durationOf(b));
    setTotal(end);
    setTime(next);
  };

  const playBoth = () => {
    const a = videoARef.current;
    const b = videoBRef.current;
    const t = timeRef.current;
    const off = offsetSeconds();
    applyMediaSettings();
    if (a && t < durationOf(a) - 0.02) a.play().catch(() => {});
    if (b && t + off >= 0 && t + off < durationOf(b) - 0.02) b.play().catch(() => {});
  };

  const pauseBoth = () => {
    videoARef.current?.pause();
    videoBRef.current?.pause();
  };

  const play = () => {
    if (timeRef.current >= getTotal() - 0.02) seekTo(0);
    playingRef.current = true;
    setPlaying(true);
    playBoth();
  };

  const pause = () => {
    playingRef.current = false;
    setPlaying(false);
    pauseBoth();
    seekTo(timeRef.current);
  };

  const togglePlay = () => (playingRef.current ? pause() : play());

  const step = (frames) => {
    if (playingRef.current) pause();
    seekTo(timeRef.current + frames / fpsRef.current);
  };

  const changeOffset = (delta) => {
    const next = offsetRef.current + delta;
    offsetRef.current = next;
    setOffset(next);
    seekTo(timeRef.current);
  };

  // The parent calls this after a <video> element (re)mounts, e.g. when the compare mode changes
  useImperativeHandle(ref, () => ({
    syncNow() {
      applyMediaSettings();
      seekTo(timeRef.current);
      if (playingRef.current) playBoth();
    }
  }));

  // New clips: back to the start, paused, no offset
  useEffect(() => {
    playingRef.current = false;
    setPlaying(false);
    pauseBoth();
    offsetRef.current = 0;
    setOffset(0);
    timeRef.current = 0;
    setTime(0);
    setTotal(getTotal());
  }, [resetKey]);

  // Follow the timeline while playing. The longer clip is the clock, the other one is kept in step.
  useEffect(() => {
    if (!playing) return;
    let frameId;

    const follow = (v, expected) => {
      const dur = durationOf(v);
      if (!v || !dur) return;
      if (expected < 0 || expected >= dur - 0.02) {
        if (!v.paused) v.pause();
        const held = clamp(expected, 0, dur);
        if (Math.abs(v.currentTime - held) > 0.05) v.currentTime = held;
      } else {
        if (Math.abs(v.currentTime - expected) > 0.12) v.currentTime = expected;
        if (v.paused) v.play().catch(() => {});
      }
    };

    const tick = () => {
      const a = videoARef.current;
      const b = videoBRef.current;
      const off = offsetSeconds();
      const durA = durationOf(a);
      const durB = durationOf(b);
      const end = Math.max(durA, durB - off, 0);
      const aIsClock = durA >= durB - off;
      const clock = aIsClock ? a : b;

      let t = timeRef.current;
      if (clock && !clock.seeking) t = aIsClock ? clock.currentTime : clock.currentTime - off;

      if (end > 0 && (t >= end - 0.02 || (clock && clock.ended))) {
        if (loopRef.current) {
          seekTo(0);
          playBoth();
        } else {
          playingRef.current = false;
          setPlaying(false);
          pauseBoth();
          seekTo(end);
          return;
        }
      } else {
        timeRef.current = t;
        if (aIsClock) follow(b, t + off);
        else follow(a, t);
        setTime(t);
      }
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [playing]);

  useEffect(() => {
    applyMediaSettings();
  }, [rate, muted]);

  // Keyboard: Space play/pause, arrows step a frame (Shift = one second), Home to start
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const jump = e.shiftKey ? fpsRef.current : 1;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft' || e.key === ',') {
        e.preventDefault();
        step(-jump);
      } else if (e.key === 'ArrowRight' || e.key === '.') {
        e.preventDefault();
        step(jump);
      } else if (e.key === 'Home') {
        e.preventDefault();
        seekTo(0);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => () => pauseBoth(), []);

  const frameNumber = Math.round(time * fps);
  const totalFrames = Math.round(total * fps);
  const offsetLabel = `${offset > 0 ? '+' : ''}${offset}f`;

  return (
    <div className="media-controls-dock">
      <div className="video-scrubber-wrapper">
        <input
          type="range"
          className="video-scrubber"
          min="0"
          max={total > 0 ? total : 1}
          step={1 / fps}
          value={time}
          onChange={(e) => seekTo(parseFloat(e.target.value))}
        />
      </div>

      <div className="video-transport-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            className="icon-btn"
            style={{ width: 28, height: 28 }}
            onClick={() => step(-1)}
            title="Step both clips -1 frame (Left Arrow)"
          >
            <span style={{ fontSize: 11, fontWeight: 700 }}>-1F</span>
          </button>
          <button
            className="icon-btn active"
            style={{ width: 34, height: 34, borderRadius: '50%' }}
            onClick={togglePlay}
            title={playing ? 'Pause both clips (Space)' : 'Play both clips (Space)'}
          >
            {playing ? <Pause size={15} /> : <Play size={15} style={{ marginLeft: 2 }} />}
          </button>
          <button
            className="icon-btn"
            style={{ width: 28, height: 28 }}
            onClick={() => step(1)}
            title="Step both clips +1 frame (Right Arrow)"
          >
            <span style={{ fontSize: 11, fontWeight: 700 }}>+1F</span>
          </button>
        </div>

        <div className="video-timecode-box" title="Shared frame counter and timecode for both clips">
          <span>
            Frame <strong style={{ color: '#ffffff' }}>{frameNumber}</strong> / {totalFrames}
            <span style={{ marginLeft: 10, color: '#888888' }}>{formatTimecode(time, fps)}</span>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              background: 'var(--bg-tertiary)',
              padding: '2px 6px',
              borderRadius: 4,
              border: '1px solid var(--border-subtle)'
            }}
            title="Shift clip B against clip A by whole frames to line two takes up"
          >
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>B offset</span>
            <button
              className="text-btn"
              style={{ fontSize: 11, padding: '2px 5px', fontWeight: 700 }}
              onClick={() => changeOffset(-1)}
            >
              -
            </button>
            <span
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                minWidth: 30,
                textAlign: 'center',
                color: offset === 0 ? 'var(--text-secondary)' : '#ffffff'
              }}
            >
              {offsetLabel}
            </span>
            <button
              className="text-btn"
              style={{ fontSize: 11, padding: '2px 5px', fontWeight: 700 }}
              onClick={() => changeOffset(1)}
            >
              +
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'var(--bg-tertiary)',
              padding: '2px 8px',
              borderRadius: 4,
              border: '1px solid var(--border-subtle)',
              height: 28
            }}
          >
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>FPS:</span>
            <select
              value={fps}
              onChange={(e) => {
                const next = Number(e.target.value);
                fpsRef.current = next;
                setFps(next);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-main)',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer'
              }}
            >
              {FPS_OPTIONS.map((f) => (
                <option key={f} value={f} style={{ color: '#000', backgroundColor: '#fff' }}>
                  {f} fps
                </option>
              ))}
            </select>
          </div>

          <select
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            title="Playback speed for both clips"
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 4,
              height: 28,
              color: 'var(--text-main)',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer'
            }}
          >
            {RATE_OPTIONS.map((r) => (
              <option key={r} value={r} style={{ color: '#000', backgroundColor: '#fff' }}>
                {r}x
              </option>
            ))}
          </select>

          <button
            className={`icon-btn ${loop ? 'active' : ''}`}
            style={{ width: 28, height: 28 }}
            onClick={() => setLoop((prev) => !prev)}
            title={loop ? 'Loop: on' : 'Loop: off'}
          >
            <Repeat size={13} />
          </button>
          <button
            className="icon-btn"
            style={{ width: 28, height: 28 }}
            onClick={() => setMuted((prev) => !prev)}
            title={muted ? 'Clip A audio: muted' : 'Clip A audio: on (clip B is always silent)'}
          >
            {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
        </div>
      </div>
    </div>
  );
});

export default CompareVideoTransport;
