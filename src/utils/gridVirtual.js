import { useLayoutEffect, useMemo, useRef, useState } from 'react';

// Must match .grid-container in src/styles/index.css (padding and gap)
export const GRID_PADDING = 0;
export const GRID_GAP = 2;

// Height guess for rows, used only until the first row has been measured
const ESTIMATED_FOOTER = 48;
const ESTIMATED_MIN_PREVIEW = 85;
// Rows kept mounted above and below the viewport, in viewport heights
const OVERSCAN = 1;
const FALLBACK_VIEWPORT_HEIGHT = 900;

// Index of the last row whose top is at or above y
function rowAt(tops, rowCount, y) {
  let lo = 0;
  let hi = rowCount - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Scrolls a row fully into view, the same way scrollIntoView({ block: 'nearest' }) would.
// Works for rows that are not mounted, since the position comes from the layout, not the DOM.
export function scrollGridRowIntoView(grid, layout, row) {
  if (!grid || !layout || row < 0 || row >= layout.rowCount) return;
  const top = GRID_PADDING + layout.tops[row];
  const bottom = top + layout.rowHeights[row];
  if (top < grid.scrollTop) grid.scrollTop = top;
  else if (bottom > grid.scrollTop + grid.clientHeight) grid.scrollTop = bottom - grid.clientHeight;
}

/**
 * Mounts only the rows of the icon grid that are near the viewport.
 *
 * The grid keeps its CSS (auto-fill columns, gap, padding), so the cards look the same. Rows above and
 * below the mounted block are stood in for by spacer rows. Row heights are measured from the drawn cards,
 * because a card's height follows its thumbnail's aspect ratio. Rows that were never drawn use the average.
 */
export function useVirtualGrid({ items, minWidth, enabled }) {
  const [grid, setGrid] = useState(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [heightVersion, setHeightVersion] = useState(0);
  // Column count read back from the browser, used only when its rounding disagrees with the formula
  const [domColumns, setDomColumns] = useState(null);
  // Measured row heights by the path of the row's first item, reset whenever the column layout changes
  const heightCache = useRef({ key: '', heights: new Map() });
  const measureRef = useRef(null);
  const measureFrameRef = useRef(0);
  const watcherRef = useRef(null);

  useLayoutEffect(() => {
    if (!grid || !enabled) return undefined;

    let frame = 0;
    const readViewport = () => {
      const width = grid.clientWidth;
      const height = grid.clientHeight;
      setViewport((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setScrollTop(grid.scrollTop);
      });
    };

    const observer = new ResizeObserver(readViewport);
    observer.observe(grid);
    grid.addEventListener('scroll', onScroll, { passive: true });
    readViewport();
    setScrollTop(grid.scrollTop);

    return () => {
      observer.disconnect();
      grid.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [grid, enabled]);

  const contentWidth = Math.max(0, viewport.width - 2 * GRID_PADDING);
  const widthKey = `${Math.round(contentWidth)}|${minWidth}`;
  const formulaColumns = Math.max(1, Math.floor((contentWidth + GRID_GAP) / (minWidth + GRID_GAP)));
  const columns = domColumns?.key === widthKey ? domColumns.columns : formulaColumns;
  const cacheKey = `${columns}|${widthKey}`;
  if (heightCache.current.key !== cacheKey) {
    heightCache.current = { key: cacheKey, heights: new Map() };
  }
  const heights = heightCache.current.heights;

  const layout = useMemo(() => {
    const rowCount = enabled && items ? Math.ceil(items.length / columns) : 0;
    const rowHeights = new Float64Array(rowCount);
    const tops = new Float64Array(rowCount + 1);
    // Rows never drawn get the average of the measured ones, which follows the folder's image shapes better than a fixed guess
    let knownSum = 0;
    let knownCount = 0;
    for (let r = 0; r < rowCount; r++) {
      const known = heights.get(items[r * columns].path);
      if (known === undefined) {
        rowHeights[r] = NaN;
      } else {
        rowHeights[r] = known;
        knownSum += known;
        knownCount++;
      }
    }
    const cardWidth = (contentWidth - (columns - 1) * GRID_GAP) / columns;
    const guess = Math.max(cardWidth / 2, ESTIMATED_MIN_PREVIEW) + ESTIMATED_FOOTER;
    const estimate = knownCount ? knownSum / knownCount : guess;
    for (let r = 0; r < rowCount; r++) {
      if (Number.isNaN(rowHeights[r])) rowHeights[r] = estimate;
      tops[r + 1] = tops[r] + rowHeights[r] + GRID_GAP;
    }
    const total = rowCount ? tops[rowCount] - GRID_GAP : 0;
    return { columns, rowCount, rowHeights, tops, total };
    // heights lives in heightCache and changes only with cacheKey, or with heightVersion after a measurement
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, items, columns, contentWidth, cacheKey, heightVersion]);

  const viewHeight = viewport.height || FALLBACK_VIEWPORT_HEIGHT;
  const { rowCount, tops, rowHeights } = layout;
  let startRow = 0;
  let endRow = -1;
  if (rowCount > 0) {
    const from = Math.max(0, scrollTop - GRID_PADDING - viewHeight * OVERSCAN);
    const to = Math.max(0, scrollTop - GRID_PADDING + viewHeight * (1 + OVERSCAN));
    startRow = rowAt(tops, rowCount, from);
    endRow = rowAt(tops, rowCount, to);
  }

  const startIndex = startRow * columns;
  const endIndex = rowCount ? Math.min(items.length, (endRow + 1) * columns) : 0;
  // Spacer rows stand in for the unmounted rows above and below. Padding would not do: a flex item cannot
  // shrink below its padding, so a tall bottom padding would stretch the scroll container itself.
  const topSpacer = rowCount && startRow > 0 ? tops[startRow] - GRID_GAP : 0;
  const remaining = rowCount ? layout.total - (tops[endRow] + rowHeights[endRow]) : 0;
  const bottomSpacer = remaining > GRID_GAP ? remaining - GRID_GAP : 0;

  // Reads the rows drawn right now and stores their heights. A changed height triggers a new layout.
  const measureRows = () => {
    if (!grid || !enabled) return;
    let changed = false;
    const cards = grid.querySelectorAll('.asset-card');
    for (let k = 0; k < cards.length; k++) {
      const index = startIndex + k;
      if (index % columns !== 0) continue;
      const height = cards[k].getBoundingClientRect().height;
      const path = items[index].path;
      const known = heights.get(path);
      if (known === undefined || Math.abs(known - height) > 0.5) {
        heights.set(path, height);
        changed = true;
      }
    }
    if (changed) setHeightVersion((v) => v + 1);

    // The browser's own column count wins if its rounding differs from the formula
    const trackCount = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
    if (trackCount > 0 && trackCount !== columns) {
      setDomColumns({ key: widthKey, columns: trackCount });
    }
  };
  measureRef.current = measureRows;

  // Measuring runs in a frame of its own, not inside a commit. Cards animate their height for a moment after a
  // thumbnail loads, and measuring inside the commit would chain state updates until React gives up.
  const scheduleMeasure = () => {
    if (measureFrameRef.current) return;
    measureFrameRef.current = requestAnimationFrame(() => {
      measureFrameRef.current = 0;
      measureRef.current?.();
    });
  };

  // One ResizeObserver per grid: a drawn card that changes size (its thumbnail loaded, the window resized) measures again
  useLayoutEffect(() => {
    if (!grid || !enabled) return undefined;
    const watcher = new ResizeObserver(scheduleMeasure);
    watcherRef.current = watcher;
    return () => {
      watcher.disconnect();
      watcherRef.current = null;
      if (measureFrameRef.current) cancelAnimationFrame(measureFrameRef.current);
      measureFrameRef.current = 0;
    };
  }, [grid, enabled]);

  // After every commit: schedule a measure of the drawn rows and watch their cards
  useLayoutEffect(() => {
    if (!grid || !enabled) return;
    scheduleMeasure();
    const watcher = watcherRef.current;
    if (!watcher) return;
    watcher.disconnect();
    grid.querySelectorAll('.asset-card').forEach((card) => watcher.observe(card));
  });

  return {
    layout,
    startIndex,
    endIndex,
    topSpacer,
    bottomSpacer,
    gridRef: setGrid
  };
}
