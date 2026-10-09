import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Search, X } from 'lucide-react';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import '../styles/model-outliner.css';

// Read-only prim tree for the 3D viewer (Viewport3D.jsx). Rows are a fixed height and only the visible slice is
// drawn, so a big stage with thousands of prims stays light. Expanding a branch or typing in search never walks
// the scene again: the tree is built once per loaded model.
const ROW_HEIGHT = 22;
const OVERSCAN_ROWS = 8;
// Deeper levels keep the same indent so a deep stage does not push its names off the panel
const MAX_INDENT_LEVELS = 12;
const FALLBACK_HEIGHT = 400;

// Helper overlays (wireframe lines) live under real meshes but are not part of the model's own hierarchy
function isHelperObject(obj) {
  return Boolean(obj.userData?.isHelper || obj.userData?.isWireframeOverlay);
}

function buildNode(obj, depth) {
  const node = {
    id: obj.uuid,
    obj,
    name: obj.name || `<${obj.type}>`,
    type: obj.type,
    depth,
    children: []
  };
  for (const child of obj.children) {
    if (isHelperObject(child)) continue;
    node.children.push(buildNode(child, depth + 1));
  }
  return node;
}

function countNodes(nodes) {
  let total = 0;
  for (const node of nodes) total += 1 + countNodes(node.children);
  return total;
}

// The top two levels start open (the model and its direct children); everything deeper stays folded
function initialExpanded(nodes) {
  const open = new Set();
  const walk = (list) => {
    for (const node of list) {
      if (node.depth < 1 && node.children.length) {
        open.add(node.id);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return open;
}

function flattenVisible(nodes, expanded, out) {
  for (const node of nodes) {
    out.push(node);
    if (node.children.length && expanded.has(node.id)) flattenVisible(node.children, expanded, out);
  }
  return out;
}

function collectMatches(nodes, query, out) {
  for (const node of nodes) {
    if (node.name.toLowerCase().includes(query)) out.push(node);
    collectMatches(node.children, query, out);
  }
  return out;
}

export default function ModelOutliner({ root, selectedId, onSelect, onVisibilityChange, onClose }) {
  const tree = useMemo(() => (root ? [buildNode(root, 0)] : []), [root]);
  const total = useMemo(() => countNodes(tree), [tree]);

  const [expanded, setExpanded] = useState(() => initialExpanded(tree));
  const [query, setQuery] = useState('');
  const searchText = useDebouncedValue(query.trim().toLowerCase(), 150);
  const [scrollTop, setScrollTop] = useState(0);
  const [listHeight, setListHeight] = useState(0);
  // Bumped when a visibility eye is clicked, so the row re-reads obj.visible
  const [, setVisibilityTick] = useState(0);
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    const measure = () => setListHeight(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(
    () => (searchText ? collectMatches(tree, searchText, []) : flattenVisible(tree, expanded, [])),
    [tree, expanded, searchText]
  );

  const viewHeight = listHeight || FALLBACK_HEIGHT;
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const lastRow = Math.min(rows.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN_ROWS);
  const visibleRows = rows.slice(firstRow, lastRow);

  const toggleExpanded = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleVisible = (obj) => {
    obj.visible = !obj.visible;
    setVisibilityTick((tick) => tick + 1);
    onVisibilityChange?.();
  };

  return (
    <div className="viewport-outliner" role="tree" aria-label="Model outliner">
      <div className="outliner-header">
        <span className="outliner-title">Outliner</span>
        <span className="outliner-count">{total.toLocaleString()} prims</span>
        <button className="outliner-icon-btn" onClick={onClose} title="Close outliner (O)" aria-label="Close outliner">
          <X size={13} />
        </button>
      </div>

      <div className="outliner-search">
        <Search size={12} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search prims"
          spellCheck={false}
        />
        {query && (
          <button className="outliner-icon-btn" onClick={() => setQuery('')} aria-label="Clear search">
            <X size={11} />
          </button>
        )}
      </div>

      <div
        className="outliner-list"
        ref={listRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div className="outliner-spacer" style={{ height: rows.length * ROW_HEIGHT }}>
          {visibleRows.map((node, i) => {
            const isOpen = expanded.has(node.id);
            const hasChildren = node.children.length > 0;
            const isSelected = node.id === selectedId;
            const isHidden = !node.obj.visible;
            return (
              <div
                key={node.id}
                role="treeitem"
                aria-selected={isSelected}
                className={`outliner-row${isSelected ? ' selected' : ''}${isHidden ? ' is-hidden' : ''}`}
                style={{ top: (firstRow + i) * ROW_HEIGHT, paddingLeft: 4 + Math.min(node.depth, MAX_INDENT_LEVELS) * 12 }}
                onClick={() => onSelect?.(node.obj)}
                title={node.name}
              >
                {hasChildren && !searchText ? (
                  <button
                    className="outliner-twist"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpanded(node.id);
                    }}
                    aria-label={isOpen ? 'Collapse' : 'Expand'}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                ) : (
                  <span className="outliner-twist-spacer" />
                )}
                <span className="outliner-name">{node.name}</span>
                <span className="outliner-type">{node.type}</span>
                <button
                  className="outliner-icon-btn outliner-eye"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleVisible(node.obj);
                  }}
                  title={isHidden ? 'Show' : 'Hide'}
                  aria-label={isHidden ? 'Show' : 'Hide'}
                >
                  {isHidden ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            );
          })}
        </div>
        {rows.length === 0 && (
          <div className="outliner-empty">{searchText ? 'No prims match' : 'Nothing to show'}</div>
        )}
      </div>
    </div>
  );
}
