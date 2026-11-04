import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { buildUvLines, POLYGON_WIRE_MAX_TRIANGLES } from '../utils/meshTopology';
import { randomMeshColor } from '../utils/smoothPreview';
import '../styles/viewport-panels.css';

// UV layout panel for the 3D viewer. Shows the UV wireframe of the picked object in the outliner (all of its
// meshes), or of every visible mesh when nothing is picked. The 0-1 tile is outlined. Scroll to zoom, drag to pan,
// double-click to fit. Read-only: the file and the model are never changed.
const MAX_SEGMENTS = 600000;
const PANEL_SIZE = 340;

function collectMeshes(root, selected) {
  const start = selected && root.getObjectByProperty('uuid', selected.uuid) ? selected : root;
  const meshes = [];
  start.traverse((child) => {
    if (child.userData?.isHelper || child.userData?.isWireframeOverlay) return;
    if (child.isMesh && child.geometry?.attributes?.uv && child.visible) meshes.push(child);
  });
  return { meshes, scoped: start !== root };
}

export default function UvView({ root, selected, onClose }) {
  const canvasRef = useRef(null);
  const [view, setView] = useState(null); // { cx, cy, scale } scale = pixels per UV unit; null = fit
  const [colorByMesh, setColorByMesh] = useState(true);
  const dragRef = useRef(null);

  // Line data per mesh, built once per picked object
  const data = useMemo(() => {
    const { meshes, scoped } = collectMeshes(root, selected);
    const sets = [];
    let segments = 0;
    let skipped = 0;
    let minU = 0;
    let maxU = 1;
    let minV = 0;
    let maxV = 1;
    meshes.forEach((mesh, i) => {
      const orig = mesh.userData.origGeometry || mesh.geometry;
      const tris = orig.index ? orig.index.count / 3 : orig.attributes.position.count / 3;
      if (tris > POLYGON_WIRE_MAX_TRIANGLES || segments > MAX_SEGMENTS) {
        skipped++;
        return;
      }
      const lines = buildUvLines(orig);
      if (!lines || lines.length === 0) return;
      for (let k = 0; k < lines.length; k += 2) {
        const u = lines[k];
        const v = lines[k + 1];
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
      segments += lines.length / 4;
      sets.push({ lines, number: mesh.userData.meshNumber ?? i });
    });
    return { sets, segments, skipped, meshCount: meshes.length, scoped, bounds: { minU, maxU, minV, maxV } };
  }, [root, selected]);

  // Fit view: the whole UV range (at least the 0-1 tile) with a little margin
  const fit = useMemo(() => {
    const { minU, maxU, minV, maxV } = data.bounds;
    const span = Math.max(maxU - minU, maxV - minV, 1e-3);
    return { cx: (minU + maxU) / 2, cy: (minV + maxV) / 2, scale: (PANEL_SIZE * 0.92) / span };
  }, [data]);

  useEffect(() => setView(null), [data]);
  const cam = view || fit;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = PANEL_SIZE * dpr;
    canvas.height = PANEL_SIZE * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, PANEL_SIZE, PANEL_SIZE);

    // UV (u, v) -> pixel; v points up
    const toX = (u) => PANEL_SIZE / 2 + (u - cam.cx) * cam.scale;
    const toY = (v) => PANEL_SIZE / 2 - (v - cam.cy) * cam.scale;

    // Tile grid lines at whole numbers, 0-1 tile outlined
    const { minU, maxU, minV, maxV } = data.bounds;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    for (let u = Math.floor(minU); u <= Math.ceil(maxU); u++) {
      ctx.moveTo(toX(u), 0);
      ctx.lineTo(toX(u), PANEL_SIZE);
    }
    for (let v = Math.floor(minV); v <= Math.ceil(maxV); v++) {
      ctx.moveTo(0, toY(v));
      ctx.lineTo(PANEL_SIZE, toY(v));
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.strokeRect(toX(0), toY(1), cam.scale, cam.scale);

    // Mesh edges
    ctx.lineWidth = 1;
    for (const set of data.sets) {
      ctx.strokeStyle = colorByMesh && data.sets.length > 1 ? randomMeshColor(set.number).getStyle() : '#38bdf8';
      ctx.beginPath();
      const l = set.lines;
      for (let k = 0; k < l.length; k += 4) {
        ctx.moveTo(toX(l[k]), toY(l[k + 1]));
        ctx.lineTo(toX(l[k + 2]), toY(l[k + 3]));
      }
      ctx.stroke();
    }
  }, [data, cam, colorByMesh]);

  const onWheel = (e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const scale = Math.min(Math.max(cam.scale * factor, fit.scale * 0.2), fit.scale * 400);
    // keep the UV under the cursor fixed
    const u = cam.cx + (px - PANEL_SIZE / 2) / cam.scale;
    const v = cam.cy - (py - PANEL_SIZE / 2) / cam.scale;
    setView({ cx: u - (px - PANEL_SIZE / 2) / scale, cy: v + (py - PANEL_SIZE / 2) / scale, scale });
  };

  // React attaches wheel listeners as passive; attach our own so the page does not scroll
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  });

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, cx: cam.cx, cy: cam.cy };
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    setView({
      cx: d.cx - (e.clientX - d.x) / cam.scale,
      cy: d.cy + (e.clientY - d.y) / cam.scale,
      scale: cam.scale
    });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const title = data.scoped ? 'UV view · selected' : 'UV view';
  let note = null;
  if (data.meshCount === 0) note = 'No UVs in this model';
  else if (data.sets.length === 0 && data.skipped > 0) note = 'Model is too dense to show UVs';
  else if (data.sets.length === 0) note = 'No UVs in this model';
  else if (data.skipped > 0) note = `${data.skipped} dense mesh${data.skipped > 1 ? 'es' : ''} not shown`;

  return (
    <div className="uv-view" style={{ width: PANEL_SIZE + 2 }}>
      <div className="uv-view-header">
        <span className="uv-view-title">{title}</span>
        <span className="uv-view-count">{data.segments.toLocaleString()} edges</span>
        <button
          className={`uv-view-btn ${colorByMesh ? 'active' : ''}`}
          onClick={() => setColorByMesh(!colorByMesh)}
          title="Colour each mesh differently"
        >
          Colors
        </button>
        <button className="uv-view-btn" onClick={() => setView(null)} title="Fit all (double-click the view)">
          Fit
        </button>
        <button className="uv-view-close" onClick={onClose} title="Close UV view (U key)">
          <X size={14} />
        </button>
      </div>
      <div className="uv-view-body" style={{ width: PANEL_SIZE, height: PANEL_SIZE }}>
        <canvas
          ref={canvasRef}
          style={{ width: PANEL_SIZE, height: PANEL_SIZE }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => setView(null)}
        />
        {note && <div className="uv-view-note">{note}</div>}
      </div>
    </div>
  );
}
