import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { ArrowLeft, BookOpen, Code, ExternalLink, FileText, ListTree, Minus, Plus } from 'lucide-react';
import { isQuickLookNavKey } from '../utils/quickLook';
import { getParentDir } from '../utils/pathHelpers';
import { isMarkdownPath } from '../utils/markdownPaths';
import { renderMarkdown } from '../utils/markdownRender';
import '../styles/markdown-viewer.css';

// A very large file is cut here so the window stays responsive; the page says so at the top.
const MAX_BYTES = 2 * 1024 * 1024;
const MIN_SCALE = 0.7;
const MAX_SCALE = 1.8;
const SCALE_KEY = 'markdownFontScale';
const OUTLINE_KEY = 'markdownOutlineOpen';
// Below this width the outline would squeeze the text too much, so it stays closed
const OUTLINE_MIN_WIDTH = 820;
const READING_WORDS_PER_MINUTE = 220;

function loadScale() {
  try {
    const saved = parseFloat(localStorage.getItem(SCALE_KEY));
    if (saved >= MIN_SCALE && saved <= MAX_SCALE) return saved;
  } catch {
    // Storage can be unavailable; the default size is used
  }
  return 1;
}

function loadOutlineOpen() {
  try {
    return localStorage.getItem(OUTLINE_KEY) !== '0';
  } catch {
    return true;
  }
}

function remember(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Not remembered when storage is blocked
  }
}

// Bytes to text: UTF-16 files (Windows Notepad can save them) by their BOM, otherwise UTF-8, otherwise Windows-1252.
// A file cut short may end inside a character, which `stream` leaves out instead of treating as an error.
function decodeText(bytes, cutShort) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: cutShort });
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

async function readDocument(path) {
  const api = window.electronAPI;
  const buffer = api?.readFileRange ? await api.readFileRange(path, 0, MAX_BYTES + 1) : await api.readFileBuffer(path);
  let bytes = new Uint8Array(buffer);
  const truncated = bytes.length > MAX_BYTES;
  if (truncated) bytes = bytes.subarray(0, MAX_BYTES);
  return { text: decodeText(bytes, truncated), truncated };
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

// Pictures that cannot be loaded (moved file, offline share, blocked address) become a small note with the picture's
// name instead of the browser's broken-image symbol
function replaceWithMissingNote(img) {
  const note = document.createElement('span');
  note.className = 'md-img-missing';
  note.textContent = img.alt || img.dataset.mdName || 'Picture not available';
  note.title = 'This picture could not be loaded';
  img.replaceWith(note);
}

export default function MarkdownViewer({
  asset,
  allFolderItems = [],
  onClose,
  onSelectAsset,
  onRevealInExplorer,
  floating = false
}) {
  const [doc, setDoc] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [showSource, setShowSource] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(loadOutlineOpen);
  const [scale, setScale] = useState(loadScale);
  const [activeHeading, setActiveHeading] = useState(0);
  const [lightbox, setLightbox] = useState(null);
  const [notice, setNotice] = useState('');
  const [hasBack, setHasBack] = useState(false);
  const [wrapWidth, setWrapWidth] = useState(0);

  const wrapRef = useRef(null);
  const scrollRef = useRef(null);
  const bodyRef = useRef(null);
  const historyRef = useRef([]); // files left through links, so Back can return to them
  const linkNavRef = useRef(false); // true while the file changes because of a link (history is kept)
  const pendingSlugRef = useRef('');
  const noticeTimerRef = useRef(null);
  const frameRef = useRef(0);

  const markdownAssets = allFolderItems.filter((item) => !item.isDirectory && item.category === 'markdown');
  const currentIndex = markdownAssets.findIndex((item) => item.path === asset?.path);

  const showNotice = useCallback((text) => {
    setNotice(text);
    clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(''), 3500);
  }, []);
  useEffect(() => () => clearTimeout(noticeTimerRef.current), []);

  // Read and render the file whenever the asset changes
  useEffect(() => {
    if (!asset) return undefined;
    let cancelled = false;

    if (!linkNavRef.current) historyRef.current = [];
    linkNavRef.current = false;
    setHasBack(historyRef.current.length > 0);
    setLoadError(null);
    setIsLoading(true);

    (async () => {
      try {
        const { text, truncated } = await readDocument(asset.path);
        if (cancelled) return;
        const toAssetUrl = (path) => (window.electronAPI?.toAssetUrl ? window.electronAPI.toAssetUrl(path) : path);
        const rendered = renderMarkdown(text, { baseDir: getParentDir(asset.path), toAssetUrl });
        if (cancelled) return;
        setDoc({ ...rendered, text, truncated });
        setIsLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to open Markdown file:', err);
        setDoc(null);
        setLoadError(typeof err === 'string' ? err : err?.message || 'The file could not be read.');
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [asset?.path]);

  // Put the cleaned page into the document column
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || !doc || showSource) return undefined;
    body.replaceChildren(doc.fragment.cloneNode(true));
    for (const img of body.querySelectorAll('img[data-md-broken]')) replaceWithMissingNote(img);
    // 'error' does not bubble, so it is caught on the way down
    const onImageError = (e) => {
      if (e.target?.tagName === 'IMG') replaceWithMissingNote(e.target);
    };
    body.addEventListener('error', onImageError, true);
    return () => body.removeEventListener('error', onImageError, true);
  }, [doc, showSource]);

  const scrollToSlug = useCallback((slug, smooth = true) => {
    const body = bodyRef.current;
    const scroller = scrollRef.current;
    if (!body || !scroller || !slug) return false;
    const wanted = slug.toLowerCase();
    const target = Array.from(body.querySelectorAll('[data-md-slug]')).find((el) => el.dataset.mdSlug.toLowerCase() === wanted);
    if (!target) return false;
    const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 24;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ top: Math.max(0, top), behavior: smooth && !reduceMotion ? 'smooth' : 'auto' });
    return true;
  }, []);

  // New page: back to the top, or to the section a link pointed at
  useLayoutEffect(() => {
    if (!doc) return;
    const slug = pendingSlugRef.current;
    pendingSlugRef.current = '';
    if (slug && scrollToSlug(slug, false)) return;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setActiveHeading(0);
  }, [doc, scrollToSlug]);

  // Track the width of the window, so the outline can step aside in a narrow one
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const update = () => setWrapWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The section in view marks its entry in the outline
  const updateActiveHeading = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const body = bodyRef.current;
      const scroller = scrollRef.current;
      if (!body || !scroller) return;
      const limit = scroller.getBoundingClientRect().top + 90;
      const headingEls = body.querySelectorAll('[data-md-index]');
      let active = 0;
      for (const el of headingEls) {
        if (el.getBoundingClientRect().top <= limit) active = Number(el.dataset.mdIndex);
        else break;
      }
      // At the very bottom the last section is the one being read, even when it is too short to reach the top
      if (headingEls.length && scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
        active = headingEls.length - 1;
      }
      setActiveHeading(active);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  const changeScale = useCallback((next) => {
    const clamped = Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)) * 100) / 100;
    setScale(clamped);
    remember(SCALE_KEY, clamped);
  }, []);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const zoomBy = useCallback((step) => changeScale(scaleRef.current + step), [changeScale]);

  const toggleOutline = useCallback(() => {
    setOutlineOpen((open) => {
      remember(OUTLINE_KEY, open ? '0' : '1');
      return !open;
    });
  }, []);

  // Opens another Markdown file in this viewer, remembering where we came from
  const openMarkdownFile = useCallback(
    (path, slug) => {
      const known = allFolderItems.find((item) => item.path.toLowerCase() === path.toLowerCase());
      if (floating && !known) {
        showNotice('Open the full viewer (Enter) to follow links to other folders.');
        return;
      }
      const name = path.split(/[\\/]/).pop();
      const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
      const item = known || { name, path, isDirectory: false, category: 'markdown', extension: ext, size: 0 };
      historyRef.current.push(asset);
      pendingSlugRef.current = slug || '';
      linkNavRef.current = true;
      onSelectAsset?.(item);
    },
    [allFolderItems, asset, floating, onSelectAsset, showNotice]
  );

  const goBack = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    linkNavRef.current = true;
    onSelectAsset?.(previous);
  }, [onSelectAsset]);

  const openLink = useCallback(
    async (link) => {
      const { mdKind: kind, mdSlug: slug, mdUrl: url, mdPath: path } = link.dataset;
      const api = window.electronAPI;
      if (kind === 'anchor') {
        if (!scrollToSlug(slug)) showNotice('That section was not found in this document.');
      } else if (kind === 'external') {
        const result = await api?.openUrl?.(url);
        if (result && !result.ok) showNotice(result.error || 'The link could not be opened.');
      } else if (kind === 'local') {
        if (isMarkdownPath(path)) openMarkdownFile(path, slug);
        else if (!(await api?.openExternal?.(path))) showNotice('That file or folder was not found.');
      } else {
        showNotice('This kind of link is not opened from a document.');
      }
    },
    [openMarkdownFile, scrollToSlug, showNotice]
  );

  const onBodyClick = useCallback(
    async (e) => {
      const copy = e.target.closest?.('.md-code-copy');
      if (copy) {
        const text = copy.closest('.md-code')?.querySelector('pre')?.textContent || '';
        const ok = await copyText(text.replace(/\n$/, ''));
        copy.textContent = ok ? 'Copied' : 'Copy failed';
        setTimeout(() => {
          copy.textContent = 'Copy';
        }, 1600);
        return;
      }
      const link = e.target.closest?.('a');
      if (link && e.currentTarget.contains(link)) {
        e.preventDefault();
        openLink(link);
        return;
      }
      if (e.target.tagName === 'IMG') setLightbox({ src: e.target.currentSrc || e.target.src, alt: e.target.alt || '' });
    },
    [openLink]
  );
  // Middle-click and the like must never take the page itself anywhere
  const onBodyAuxClick = useCallback((e) => {
    if (e.target.closest?.('a')) e.preventDefault();
  }, []);

  const selectAssetAt = (index) => {
    if (markdownAssets.length > 1 && onSelectAsset) {
      onSelectAsset(markdownAssets[(index + markdownAssets.length) % markdownAssets.length]);
    }
  };

  // Keyboard
  useEffect(() => {
    const onKeyDown = (e) => {
      if (floating && isQuickLookNavKey(e)) return; // the floating window's arrow keys move the grid selection
      if (isEditable(e.target)) return;
      const scroller = scrollRef.current;
      const key = e.key;

      if (key === 'Escape') {
        if (lightbox) {
          setLightbox(null);
        } else if (onClose) {
          onClose();
        }
        return;
      }
      if (lightbox) return;

      if (key === 'Backspace') {
        // In the floating window Backspace belongs to the grid (parent folder)
        if (floating) return;
        e.preventDefault();
        goBack();
      } else if (e.ctrlKey || e.metaKey) {
        if (key === '0') {
          e.preventDefault();
          changeScale(1);
        }
      } else if (key === 'PageDown' || (key === ' ' && !e.shiftKey)) {
        e.preventDefault();
        scroller?.scrollBy({ top: scroller.clientHeight * 0.9 });
      } else if (key === 'PageUp' || (key === ' ' && e.shiftKey)) {
        e.preventDefault();
        scroller?.scrollBy({ top: -scroller.clientHeight * 0.9 });
      } else if (key === 'Home') {
        e.preventDefault();
        scroller?.scrollTo({ top: 0 });
      } else if (key === 'End') {
        e.preventDefault();
        scroller?.scrollTo({ top: scroller.scrollHeight });
      } else if (key === 'ArrowDown') {
        e.preventDefault();
        scroller?.scrollBy({ top: 70 });
      } else if (key === 'ArrowUp') {
        e.preventDefault();
        scroller?.scrollBy({ top: -70 });
      } else if (key === 'ArrowRight') {
        selectAssetAt(currentIndex + 1);
      } else if (key === 'ArrowLeft') {
        selectAssetAt(currentIndex - 1);
      } else if (key === '+' || key === '=') {
        zoomBy(0.1);
      } else if (key === '-' || key === '_') {
        zoomBy(-0.1);
      } else if (key === 'o' || key === 'O') {
        toggleOutline();
      } else if (key === 's' || key === 'S') {
        setShowSource((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Ctrl + wheel changes the text size (needs a non-passive listener to stop the webview zooming itself)
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return undefined;
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 0.05 : -0.05);
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  if (!asset) return null;

  const headings = doc?.headings || [];
  const outlineVisible = outlineOpen && !floating && !showSource && headings.length > 0 && wrapWidth >= OUTLINE_MIN_WIDTH;
  const topLevel = headings.length ? Math.min(...headings.map((h) => h.level)) : 1;
  const minutes = doc ? Math.max(1, Math.round(doc.words / READING_WORDS_PER_MINUTE)) : 0;

  return (
    <div
      ref={wrapRef}
      className={`md-viewer ${floating ? 'floating' : ''}`}
      style={{ '--md-scale': scale }}
    >
      <div className="md-main">
        <div className="viewport-hud md-hud">
          {hasBack && (
            <button className="hud-btn" onClick={goBack} title="Back to the previous document (Backspace)">
              <ArrowLeft size={13} />
              <span className="hud-label">Back</span>
            </button>
          )}
          <span className="md-hud-title" title={asset.path}>
            {asset.name}
          </span>
          <div className="hud-divider" />
          <button
            className={`hud-btn ${outlineVisible ? 'active' : ''}`}
            onClick={toggleOutline}
            disabled={showSource || headings.length === 0}
            title="Outline of the headings (O)"
          >
            <ListTree size={13} />
            <span className="hud-label">Outline</span>
          </button>
          <button
            className={`hud-btn ${showSource ? 'active' : ''}`}
            onClick={() => setShowSource((v) => !v)}
            title={showSource ? 'Back to the formatted page (S)' : 'Show the Markdown text (S)'}
          >
            {showSource ? <BookOpen size={13} /> : <Code size={13} />}
            <span className="hud-label">{showSource ? 'Formatted' : 'Source'}</span>
          </button>
          <div className="hud-divider" />
          <button className="hud-btn" onClick={() => zoomBy(-0.1)} disabled={scale <= MIN_SCALE} title="Smaller text (-)">
            <Minus size={13} />
          </button>
          <button className="hud-btn md-hud-zoom" onClick={() => changeScale(1)} title="Reset the text size (Ctrl+0)">
            {Math.round(scale * 100)}%
          </button>
          <button className="hud-btn" onClick={() => zoomBy(0.1)} disabled={scale >= MAX_SCALE} title="Larger text (+)">
            <Plus size={13} />
          </button>
          <div className="hud-divider" />
          {window.electronAPI?.openExternal && (
            <button className="hud-btn" onClick={() => window.electronAPI.openExternal(asset.path)} title="Open in the default app">
              <FileText size={13} />
              <span className="hud-label">Open</span>
            </button>
          )}
          <button className="hud-btn" onClick={() => onRevealInExplorer?.(asset.path)} title="Reveal in Windows Explorer">
            <ExternalLink size={13} />
            <span className="hud-label">Explorer</span>
          </button>
          {onClose && (
            <button className="hud-btn" onClick={onClose} style={{ marginLeft: 4 }} title="Close View (Esc)">
              ✕
            </button>
          )}
        </div>

        <div ref={scrollRef} className="md-scroll" tabIndex={-1} onScroll={updateActiveHeading}>
          {doc && (
            <div className="md-page">
              {doc.truncated && (
                <div className="md-note">This file is large, so only the first 2 MB is shown here. Use Open to read all of it.</div>
              )}
              {showSource ? (
                <pre className="md-source">{doc.text}</pre>
              ) : (
                <>
                  {doc.frontMatter && (
                    <details className="md-frontmatter">
                      <summary>Document properties</summary>
                      <pre>{doc.frontMatter}</pre>
                    </details>
                  )}
                  <div ref={bodyRef} className="md-body" onClick={onBodyClick} onAuxClick={onBodyAuxClick} />
                </>
              )}
            </div>
          )}
        </div>

        {isLoading && (
          <div className="md-overlay">
            <div className="spin-icon md-spinner" />
            <span className="md-overlay-text">Opening {asset.name}...</span>
          </div>
        )}

        {loadError && !isLoading && (
          <div className="md-overlay">
            <div className="md-error">
              <div className="md-error-title">Markdown Preview Unavailable</div>
              <div className="md-error-text">{loadError}</div>
              <div className="md-error-actions">
                <button className="hud-btn" onClick={() => onRevealInExplorer?.(asset.path)} style={{ padding: '6px 14px' }}>
                  Reveal in Explorer
                </button>
                {hasBack && (
                  <button className="hud-btn" onClick={goBack} style={{ padding: '6px 14px' }}>
                    Back
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {notice && <div className="md-toast" role="status">{notice}</div>}
      </div>

      {outlineVisible && (
        <aside className="md-outline" aria-label="Outline">
          <div className="md-outline-title">On this page</div>
          <nav className="md-outline-list">
            {headings
              .filter((h) => h.level <= topLevel + 3)
              .map((h) => (
                <button
                  key={h.index}
                  className={`md-outline-item ${h.index === activeHeading ? 'active' : ''}`}
                  style={{ paddingLeft: 14 + (h.level - topLevel) * 12 }}
                  onClick={() => scrollToSlug(h.slug)}
                  title={h.text}
                >
                  {h.text}
                </button>
              ))}
          </nav>
          <div className="md-outline-foot">
            {doc.words.toLocaleString()} words · {minutes} min read
          </div>
        </aside>
      )}

      {lightbox && (
        <div className="md-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Picture">
          <img src={lightbox.src} alt={lightbox.alt} />
        </div>
      )}
    </div>
  );
}

function isEditable(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;
}
