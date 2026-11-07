// Multi-select for the file grid and the Details list, following Windows Explorer:
// Ctrl + click toggles an item, Shift + click selects the range from the anchor, Ctrl + A selects all,
// and dragging on empty space draws a box that selects everything it touches.
// The selection is a Set of paths; the focused item (the one the viewer, compare and status bar follow) is kept
// separately by App.jsx.

// Index of the item with this path, or -1
export function indexOfPath(items, path) {
  if (!path) return -1;
  return items.findIndex((item) => item.path === path);
}

// Paths of items[from] through items[to], in either order
export function rangePaths(items, from, to) {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const paths = new Set();
  for (let i = start; i <= end; i++) paths.add(items[i].path);
  return paths;
}

// A copy of the set with `path` added when missing, removed when present
export function togglePath(selected, path) {
  const next = new Set(selected);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

// The last selected item in list order, used as the focus after the focused item is deselected
export function lastSelectedItem(items, selected) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (selected.has(items[i].path)) return items[i];
  }
  return null;
}

// Files in the selection, in list order, for dragging several files out at once (folders are not dragged)
export function selectedFilePaths(items, selected) {
  return items.filter((item) => !item.isDirectory && selected.has(item.path)).map((item) => item.path);
}

const DRAG_THRESHOLD = 4; // px the pointer must move before a press becomes a box selection
const EDGE_ZONE = 28; // px from the top or bottom of the list where it scrolls while the box is dragged
const EDGE_SPEED = 14; // px scrolled per frame in that zone

// Draws a selection box from the pointer press to the pointer. `list` is the scrolling element whose children are
// the items in list order. `baseSelection` is kept under the box (Ctrl held at the press). `onChange(paths, focus)`
// is called as the box covers different items; `onEnd(dragged)` runs on release.
// `hitTest(box)`, when given, returns the indexes of the items under a box in list content coordinates; the icon
// grid uses it, since most of its tiles are not mounted and its children are not in list order.
export function startBoxSelect(event, list, { getItems, baseSelection, onChange, onEnd, hitTest }) {
  const startX = event.clientX;
  const startY = event.clientY;
  const startRect = list.getBoundingClientRect();
  // The press point is kept in list content coordinates, so the box grows over items that scroll into view
  const anchorContent = {
    x: startX - startRect.left + list.scrollLeft,
    y: startY - startRect.top + list.scrollTop
  };

  let pointer = { x: startX, y: startY };
  let dragging = false;
  let rafId = 0;
  let lastKey = null;
  let rectEl = null;

  // The box in viewport coordinates. It is not clipped to the list, so items that scrolled out of view while the
  // box grew stay selected, as in Explorer.
  const currentBox = () => {
    const rect = list.getBoundingClientRect();
    const ax = anchorContent.x - list.scrollLeft + rect.left;
    const ay = anchorContent.y - list.scrollTop + rect.top;
    return {
      left: Math.min(ax, pointer.x),
      right: Math.max(ax, pointer.x),
      top: Math.min(ay, pointer.y),
      bottom: Math.max(ay, pointer.y),
      list: rect
    };
  };

  // Only the part of the box over the list is drawn
  const drawBox = (box) => {
    if (!rectEl) return;
    const left = Math.max(box.left, box.list.left);
    const right = Math.min(box.right, box.list.right);
    const top = Math.max(box.top, box.list.top);
    const bottom = Math.min(box.bottom, box.list.bottom);
    rectEl.style.display = right > left && bottom > top ? '' : 'none';
    rectEl.style.left = `${left}px`;
    rectEl.style.top = `${top}px`;
    rectEl.style.width = `${Math.max(0, right - left)}px`;
    rectEl.style.height = `${Math.max(0, bottom - top)}px`;
  };

  const applySelection = () => {
    const box = currentBox();
    drawBox(box);
    const items = getItems();
    let hits = [];
    if (hitTest) {
      const dx = list.scrollLeft - box.list.left;
      const dy = list.scrollTop - box.list.top;
      hits = hitTest({ left: box.left + dx, right: box.right + dx, top: box.top + dy, bottom: box.bottom + dy }).filter(
        (i) => i < items.length
      );
    } else {
      const children = list.children;
      for (let i = 0; i < children.length && i < items.length; i++) {
        const r = children[i].getBoundingClientRect();
        if (r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top) hits.push(i);
      }
    }

    const key = hits.join(',');
    if (key === lastKey) return;
    lastKey = key;

    const paths = new Set(baseSelection);
    for (const i of hits) paths.add(items[i].path);
    const focus = hits.length ? items[hits[hits.length - 1]] : null;
    onChange(paths, focus);
  };

  // Scrolls while the pointer is held near the top or bottom edge, then re-checks what the box covers
  const frame = () => {
    rafId = 0;
    if (!dragging) return;
    const rect = list.getBoundingClientRect();
    let scrolled = false;
    if (pointer.y < rect.top + EDGE_ZONE && list.scrollTop > 0) {
      list.scrollTop -= EDGE_SPEED;
      scrolled = true;
    } else if (pointer.y > rect.bottom - EDGE_ZONE) {
      list.scrollTop += EDGE_SPEED;
      scrolled = true;
    }
    if (scrolled) applySelection();
    rafId = requestAnimationFrame(frame);
  };

  const onMove = (e) => {
    // A release outside the window can lose its pointerup, so a move with no button held ends the box too
    if (e.buttons === 0) {
      finish();
      return;
    }
    pointer = { x: e.clientX, y: e.clientY };
    if (!dragging) {
      if (Math.hypot(pointer.x - startX, pointer.y - startY) < DRAG_THRESHOLD) return;
      dragging = true;
      // Stop the press from also selecting page text
      window.getSelection?.()?.removeAllRanges();
      rectEl = document.createElement('div');
      rectEl.className = 'box-select-rect';
      document.body.appendChild(rectEl);
      rafId = requestAnimationFrame(frame);
    }
    applySelection();
  };

  const finish = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (rectEl) rectEl.remove();
    rectEl = null;
    const wasDragging = dragging;
    dragging = false;
    onEnd?.(wasDragging);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
}
