import { useLayoutEffect, useMemo, useState } from 'react';
import { subscribeAspects, tileAspect } from './tileAspects';

// Hairline between tiles, across and down. The grid has no side padding.
export const GRID_GAP = 2;
// Space under the last row, so the bottom filter dock never covers it
export const GRID_BOTTOM_SPACE = 76;
// Rows kept mounted above and below the viewport, in viewport heights
const OVERSCAN = 1;
const FALLBACK_VIEWPORT_HEIGHT = 900;

/**
 * Lays tiles out in justified rows, like a photo gallery: every tile in a row has the same height and a width
 * that follows its picture's shape, and each row is scaled so it fills the width exactly. No empty space is left
 * under a wide picture. The last row keeps the target height and is not stretched.
 *
 * aspects: width / height of each tile. width: the grid's inner width. target: the row height to aim for.
 */
export function justifyRows(aspects, width, target, gap = GRID_GAP) {
  const n = aspects.length;
  const lefts = new Float64Array(n);
  const widths = new Float64Array(n);
  const rowOf = new Int32Array(n);
  const rows = [];
  if (!n || width <= 0 || target <= 0) return { rows, lefts, widths, rowOf, total: 0 };

  let i = 0;
  let top = 0;
  while (i < n) {
    const start = i;
    let sum = 0;
    let height = Infinity;
    // Add tiles until the row, scaled to fill the width, is no taller than the target
    while (i < n) {
      sum += aspects[i];
      i++;
      height = (width - gap * (i - start - 1)) / sum;
      if (height <= target) break;
    }
    // Keep the last tile only if that lands closer to the target than leaving it for the next row
    if (height <= target && i - start > 1) {
      const prevSum = sum - aspects[i - 1];
      const prevHeight = (width - gap * (i - start - 2)) / prevSum;
      if (prevHeight - target < target - height) {
        i--;
        sum = prevSum;
        height = prevHeight;
      }
    }
    // A short last row is not blown up to fill the width
    const lastRow = i >= n && height > target;
    if (lastRow) height = target;
    height = Math.max(1, Math.round(height));

    let x = 0;
    for (let k = start; k < i; k++) {
      const left = Math.round(x);
      const isRowEnd = k === i - 1 && !lastRow;
      const right = isRowEnd ? Math.round(width) : Math.round(x + aspects[k] * height);
      lefts[k] = left;
      widths[k] = Math.max(1, right - left);
      rowOf[k] = rows.length;
      x += aspects[k] * height + gap;
    }
    rows.push({ start, end: i, top, height });
    top += height + gap;
  }
  return { rows, lefts, widths, rowOf, total: Math.max(0, top - gap) };
}

// Index of the last row whose top is at or above y
function rowAt(rows, y) {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rows[mid].top <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Scrolls a tile fully into view, the same way scrollIntoView({ block: 'nearest' }) would.
// Works for tiles that are not mounted, since the position comes from the layout, not the DOM.
export function scrollGridItemIntoView(grid, layout, index) {
  if (!grid || !layout || index < 0 || index >= layout.rowOf.length) return;
  const row = layout.rows[layout.rowOf[index]];
  const top = row.top;
  const bottom = top + row.height;
  if (top < grid.scrollTop) grid.scrollTop = top;
  else if (bottom > grid.scrollTop + grid.clientHeight) grid.scrollTop = bottom - grid.clientHeight;
}

// The tile in another row that sits most nearly under (or over) the given tile
function closestInRow(layout, row, index) {
  const center = layout.lefts[index] + layout.widths[index] / 2;
  const { start, end } = layout.rows[row];
  let best = start;
  let bestDistance = Infinity;
  for (let k = start; k < end; k++) {
    const distance = Math.abs(layout.lefts[k] + layout.widths[k] / 2 - center);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = k;
    }
  }
  return best;
}

// Where an arrow key, Page Up or Page Down moves the focus from `index`. Rows hold a different number of tiles,
// so Up and Down go to the tile above or below, not a fixed number of places.
export function gridKeyTarget(layout, index, key, viewHeight) {
  const count = layout?.rowOf.length || 0;
  if (!count) return index;
  const last = count - 1;
  if (index < 0) return 0;
  const row = layout.rowOf[index];
  const lastRow = layout.rows.length - 1;
  switch (key) {
    case 'ArrowRight':
      return Math.min(index + 1, last);
    case 'ArrowLeft':
      return Math.max(index - 1, 0);
    case 'ArrowDown':
      return row < lastRow ? closestInRow(layout, row + 1, index) : index;
    case 'ArrowUp':
      return row > 0 ? closestInRow(layout, row - 1, index) : index;
    case 'PageDown':
    case 'PageUp': {
      const rowHeight = layout.rows[row].height + GRID_GAP;
      const step = Math.max(1, Math.floor((viewHeight || rowHeight) / rowHeight) - 1);
      const target = key === 'PageDown' ? Math.min(row + step, lastRow) : Math.max(row - step, 0);
      if (target === row) return key === 'PageDown' ? last : 0;
      return closestInRow(layout, target, index);
    }
    default:
      return index;
  }
}

// Indexes of the tiles that a box (in grid content coordinates) touches, mounted or not
export function gridHits(layout, box) {
  const hits = [];
  if (!layout?.rows.length) return hits;
  for (let r = rowAt(layout.rows, box.top); r < layout.rows.length; r++) {
    const row = layout.rows[r];
    if (row.top >= box.bottom) break;
    if (row.top + row.height <= box.top) continue;
    for (let k = row.start; k < row.end; k++) {
      const left = layout.lefts[k];
      if (left < box.right && left + layout.widths[k] > box.left) hits.push(k);
    }
  }
  return hits;
}

/**
 * Justified rows for the icon grid, with only the rows near the viewport mounted.
 *
 * Tile shapes come from tileAspects.js. A thumbnail that loads with a new shape lays the grid out again.
 * Every position is computed, nothing is measured from the DOM, so the scroll height is exact from the start.
 */
export function useJustifiedGrid({ items, rowHeight, enabled }) {
  const [grid, setGrid] = useState(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [aspectVersion, setAspectVersion] = useState(0);

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    return subscribeAspects(() => setAspectVersion((v) => v + 1));
  }, [enabled]);

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

  const layout = useMemo(() => {
    const list = enabled && items ? items : [];
    const aspects = list.map(tileAspect);
    return { ...justifyRows(aspects, viewport.width, rowHeight), aspects };
    // aspectVersion: a thumbnail loaded with a new shape
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, items, viewport.width, rowHeight, aspectVersion]);

  const viewHeight = viewport.height || FALLBACK_VIEWPORT_HEIGHT;
  const { rows } = layout;
  let startIndex = 0;
  let endIndex = 0;
  if (rows.length) {
    const from = Math.max(0, scrollTop - viewHeight * OVERSCAN);
    const to = Math.max(0, scrollTop + viewHeight * (1 + OVERSCAN));
    startIndex = rows[rowAt(rows, from)].start;
    endIndex = rows[rowAt(rows, to)].end;
  }

  return {
    layout,
    startIndex,
    endIndex,
    viewHeight,
    gridRef: setGrid
  };
}
