// Native drag-out: dragging a file card starts a real Windows file drag, so the file can be dropped into
// Blender, Maya, Photoshop, Unreal or File Explorer. Without the native bridge (browser preview, other
// platforms) the card keeps its in-page drag.

const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

// True from the start of a native drag until just after it ends. The native drop event can arrive a moment
// after the drag call returns, so the flag is released slightly late.
let dragOutActive = false;

export function isDragOutActive() {
  return dragOutActive;
}

// Call from a card's onDragStart. Returns true when the native drag took over.
export function startNativeDragOut(event, item) {
  const api = window.electronAPI;
  if (!isWindows || !api?.startDragOut || !item || item.isDirectory || !item.path) return false;

  event.preventDefault();
  dragOutActive = true;
  api
    .startDragOut([item.path])
    .catch((err) => console.warn('Drag out failed:', err))
    .finally(() => {
      setTimeout(() => {
        dragOutActive = false;
      }, 300);
    });
  return true;
}

// Compare dock slot ('A' or 'B') under a native drag position (physical pixels), or null.
export function dockSlotAt(position) {
  if (!position) return null;
  const scale = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(position.x / scale, position.y / scale);
  const slot = el?.closest?.('.dock-slot');
  if (!slot) return null;
  return slot.querySelector('.dock-slot-tag.b') ? 'B' : 'A';
}
