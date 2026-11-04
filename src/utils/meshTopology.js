import * as THREE from 'three';

// Mesh topology helpers for the 3D viewer.
// Loaders hand over triangles only, so the original quads and n-gons are found again from the triangles:
// two neighbouring triangles on the same flat plane that together make a convex corner-to-corner polygon
// are one polygon, and the edge between them is only a triangulation line.
// Vertices at the same spot count as one, so UV seams and split normals do not break the neighbour search.

// Past these sizes the viewer falls back to the plain triangle view / skips the work
export const POLYGON_WIRE_MAX_TRIANGLES = 800000;
export const ANGLE_NORMALS_MAX_TRIANGLES = 1000000;

// Two triangles are on the same plane when their normals are within half a degree
const COPLANAR_COS = Math.cos((0.5 * Math.PI) / 180);
// A merged polygon must stay strictly convex at the corners it joins, so flat grids do not melt into one face
const STRAIGHT_LIMIT = Math.PI - 0.002;
const NO_EDGE = 0xffffffff;

// Float32 xyz copy of a position attribute (plain or interleaved)
function readPositions(attribute) {
  const count = attribute.count;
  const out = new Float32Array(count * 3);
  if (attribute.isBufferAttribute && !attribute.normalized && attribute.itemSize === 3 && attribute.array instanceof Float32Array) {
    out.set(attribute.array.subarray(0, count * 3));
  } else {
    for (let i = 0; i < count; i++) {
      out[i * 3] = attribute.getX(i);
      out[i * 3 + 1] = attribute.getY(i);
      out[i * 3 + 2] = attribute.getZ(i);
    }
  }
  return out;
}

// Welded id per vertex: vertices at exactly the same position share an id
function weldVertexIds(positions, vertexCount) {
  const bits = new Uint32Array(positions.buffer, positions.byteOffset, vertexCount * 3);
  let size = 16;
  while (size < vertexCount * 2) size <<= 1;
  const mask = size - 1;
  const table = new Int32Array(size).fill(-1);
  const ids = new Uint32Array(vertexCount);
  let count = 0;

  for (let i = 0; i < vertexCount; i++) {
    const o = i * 3;
    // -0 and 0 are the same spot
    for (let k = 0; k < 3; k++) if (positions[o + k] === 0) positions[o + k] = 0;
    let h = Math.imul(bits[o], 73856093) ^ Math.imul(bits[o + 1], 19349663) ^ Math.imul(bits[o + 2], 83492791);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    let slot = h & mask;
    let found = -1;
    while (table[slot] !== -1) {
      const j = table[slot];
      const p = j * 3;
      if (bits[p] === bits[o] && bits[p + 1] === bits[o + 1] && bits[p + 2] === bits[o + 2]) {
        found = j;
        break;
      }
      slot = (slot + 1) & mask;
    }
    if (found === -1) {
      table[slot] = i;
      ids[i] = count++;
    } else {
      ids[i] = ids[found];
    }
  }
  return { ids, count };
}

function hashPair(a, b) {
  let h = Math.imul(a, 0x9e3779b1) ^ Math.imul((b + 0x7f4a7c15) | 0, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

// Welded triangle mesh: per triangle a unit normal and the three corner angles, plus the edge table
function analyzeMesh(geometry) {
  const position = geometry.attributes.position;
  const vertexCount = position.count;
  const index = geometry.index ? geometry.index.array : null;
  const tris = Math.floor((index ? geometry.index.count : vertexCount) / 3);
  if (tris <= 0) return null;

  const positions = readPositions(position);
  const welded = weldVertexIds(positions, vertexCount);
  const weld = welded.ids;
  const vertexOf = index ? (c) => index[c] : (c) => c;

  // Face normals and the angle at each corner
  const normal = new Float32Array(tris * 3);
  const angle = new Float32Array(tris * 3);
  const valid = new Uint8Array(tris);
  for (let t = 0; t < tris; t++) {
    const p0 = vertexOf(t * 3) * 3;
    const p1 = vertexOf(t * 3 + 1) * 3;
    const p2 = vertexOf(t * 3 + 2) * 3;
    const ax = positions[p1] - positions[p0];
    const ay = positions[p1 + 1] - positions[p0 + 1];
    const az = positions[p1 + 2] - positions[p0 + 2];
    const bx = positions[p2] - positions[p0];
    const by = positions[p2 + 1] - positions[p0 + 1];
    const bz = positions[p2 + 2] - positions[p0 + 2];
    const cx = bx - ax;
    const cy = by - ay;
    const cz = bz - az;
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 0) || !Number.isFinite(len)) continue;
    valid[t] = 1;
    normal[t * 3] = nx / len;
    normal[t * 3 + 1] = ny / len;
    normal[t * 3 + 2] = nz / len;
    // angle at corner 0 (a, b), corner 1 (-a, c), corner 2 (-b, -c)
    angle[t * 3] = Math.atan2(len, ax * bx + ay * by + az * bz);
    angle[t * 3 + 1] = Math.atan2(len, -(ax * cx + ay * cy + az * cz));
    angle[t * 3 + 2] = Math.atan2(len, bx * cx + by * cy + bz * cz);
  }

  // Edge table over welded vertices
  const maxEdges = tris * 3;
  const eLo = new Uint32Array(maxEdges);
  const eHi = new Uint32Array(maxEdges);
  const eVa = new Uint32Array(maxEdges); // original vertex ids of the first sighting, for drawing
  const eVb = new Uint32Array(maxEdges);
  const eT1 = new Int32Array(maxEdges).fill(-1);
  const eT2 = new Int32Array(maxEdges).fill(-1);
  const eCount = new Uint8Array(maxEdges);
  const triEdge = new Uint32Array(tris * 3).fill(NO_EDGE); // edge id per triangle side (side k = corner k to k+1)
  let tableSize = 16;
  while (tableSize < maxEdges * 2) tableSize <<= 1;
  const mask = tableSize - 1;
  const table = new Int32Array(tableSize).fill(-1);
  let edgeCount = 0;

  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      const c0 = t * 3 + k;
      const c1 = t * 3 + ((k + 1) % 3);
      const v0 = vertexOf(c0);
      const v1 = vertexOf(c1);
      const a = weld[v0];
      const b = weld[v1];
      if (a === b) continue; // collapsed side
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      let slot = hashPair(lo, hi) & mask;
      let e = -1;
      while (table[slot] !== -1) {
        const j = table[slot];
        if (eLo[j] === lo && eHi[j] === hi) {
          e = j;
          break;
        }
        slot = (slot + 1) & mask;
      }
      if (e === -1) {
        e = edgeCount++;
        table[slot] = e;
        eLo[e] = lo;
        eHi[e] = hi;
        eVa[e] = v0;
        eVb[e] = v1;
        eT1[e] = t;
      } else if (eCount[e] === 1) {
        eT2[e] = t;
      }
      if (eCount[e] < 255) eCount[e]++;
      triEdge[c0] = e;
    }
  }

  return {
    tris,
    positions,
    vertexOf,
    weld,
    weldedCount: welded.count,
    normal,
    angle,
    valid,
    edgeCount,
    eLo,
    eHi,
    eVa,
    eVb,
    eT1,
    eT2,
    eCount,
    triEdge
  };
}

// Marks the edges that are only triangulation lines inside a quad or n-gon. Returns a per-edge flag array.
function findHiddenEdges(m) {
  const { tris, weld, vertexOf, normal, angle, valid, edgeCount, eLo, eHi, eVa, eVb, eT1, eT2, eCount, positions } = m;

  // Candidates: shared by exactly two triangles on the same plane
  const candidates = [];
  for (let e = 0; e < edgeCount; e++) {
    if (eCount[e] !== 2) continue;
    const t1 = eT1[e];
    const t2 = eT2[e];
    if (!valid[t1] || !valid[t2]) continue;
    const dot =
      normal[t1 * 3] * normal[t2 * 3] +
      normal[t1 * 3 + 1] * normal[t2 * 3 + 1] +
      normal[t1 * 3 + 2] * normal[t2 * 3 + 2];
    if (dot >= COPLANAR_COS) candidates.push(e);
  }
  const hidden = new Uint8Array(edgeCount);
  if (candidates.length === 0) return hidden;

  // Longest edges first: a quad's diagonal is the likeliest line to be only a triangulation line
  const length = new Float32Array(edgeCount);
  for (const e of candidates) {
    const a = eVa[e] * 3;
    const b = eVb[e] * 3;
    length[e] = Math.hypot(positions[a] - positions[b], positions[a + 1] - positions[b + 1], positions[a + 2] - positions[b + 2]);
  }
  const order = Uint32Array.from(candidates).sort((x, y) => length[y] - length[x]);

  const parent = new Int32Array(tris);
  const size = new Uint32Array(tris).fill(1);
  for (let t = 0; t < tris; t++) parent[t] = t;
  const groups = new Array(tris).fill(null); // welded vertex -> corner angle of the polygon there (only once merged)
  const find = (t) => {
    while (parent[t] !== t) {
      parent[t] = parent[parent[t]];
      t = parent[t];
    }
    return t;
  };

  const angleAt = (root, w) => {
    const g = groups[root];
    if (g) return g.get(w) ?? 0;
    for (let k = 0; k < 3; k++) if (weld[vertexOf(root * 3 + k)] === w) return angle[root * 3 + k];
    return 0;
  };
  const hasVertex = (root, w) => {
    const g = groups[root];
    if (g) return g.has(w);
    for (let k = 0; k < 3; k++) if (weld[vertexOf(root * 3 + k)] === w) return true;
    return false;
  };
  const vertexMap = (root) => {
    let g = groups[root];
    if (!g) {
      g = new Map();
      for (let k = 0; k < 3; k++) {
        const w = weld[vertexOf(root * 3 + k)];
        g.set(w, (g.get(w) ?? 0) + angle[root * 3 + k]);
      }
      groups[root] = g;
    }
    return g;
  };

  for (let i = 0; i < order.length; i++) {
    const e = order[i];
    const r1 = find(eT1[e]);
    const r2 = find(eT2[e]);
    if (r1 === r2) continue;
    const a = eLo[e];
    const b = eHi[e];

    // The joined polygon must stay strictly convex at both ends of the shared edge
    if (angleAt(r1, a) + angleAt(r2, a) > STRAIGHT_LIMIT) continue;
    if (angleAt(r1, b) + angleAt(r2, b) > STRAIGHT_LIMIT) continue;

    // The two may touch only along that edge, otherwise the result is not one simple polygon
    const small = size[r1] <= size[r2] ? r1 : r2;
    const big = small === r1 ? r2 : r1;
    let shared = 0;
    let ok = true;
    if (groups[small]) {
      for (const w of groups[small].keys()) {
        if (hasVertex(big, w) && ++shared > 2) {
          ok = false;
          break;
        }
      }
    } else {
      for (let k = 0; k < 3; k++) {
        if (hasVertex(big, weld[vertexOf(small * 3 + k)]) && ++shared > 2) {
          ok = false;
          break;
        }
      }
    }
    if (!ok) continue;

    const bigMap = vertexMap(big);
    const smallMap = vertexMap(small);
    for (const [w, ang] of smallMap) bigMap.set(w, (bigMap.get(w) ?? 0) + ang);
    groups[small] = null;
    parent[small] = big;
    size[big] += size[small];
  }

  // An edge is a triangulation line when both of its triangles ended up in one polygon
  for (const e of candidates) {
    if (find(eT1[e]) === find(eT2[e])) hidden[e] = 1;
  }
  return hidden;
}

// Line indices (pairs of vertex ids into the geometry's position buffer) for a wireframe that shows the
// original polygon edges. Returns null when the geometry has no triangles.
// `keepTriangles` shows every triangle edge (for meshes that really are triangles, like STL).
export function buildPolygonWireIndices(geometry, { keepTriangles = false } = {}) {
  const m = analyzeMesh(geometry);
  if (!m) return null;
  const hidden = keepTriangles ? new Uint8Array(m.edgeCount) : findHiddenEdges(m);

  let visible = 0;
  for (let e = 0; e < m.edgeCount; e++) if (!hidden[e]) visible++;
  const indices = new Uint32Array(visible * 2);
  let w = 0;
  let hiddenCount = 0;
  for (let e = 0; e < m.edgeCount; e++) {
    if (hidden[e]) {
      hiddenCount++;
      continue;
    }
    indices[w++] = m.eVa[e];
    indices[w++] = m.eVb[e];
  }
  return { indices, hiddenEdges: hiddenCount };
}

// UV layout lines for the UV view: [u0, v0, u1, v1, ...] for the polygon edges of the geometry.
// Seam edges show on both sides because each side has its own UVs.
export function buildUvLines(geometry) {
  const uvAttr = geometry.attributes.uv;
  if (!uvAttr || !geometry.attributes.position) return null;
  const m = analyzeMesh(geometry);
  if (!m) return null;
  const hidden = findHiddenEdges(m);
  const uv = new Float32Array(uvAttr.count * 2);
  for (let i = 0; i < uvAttr.count; i++) {
    uv[i * 2] = uvAttr.getX(i);
    uv[i * 2 + 1] = uvAttr.getY(i);
  }

  const out = [];
  const same = (va, vb, vc, vd) => {
    // the same UV segment, in either direction
    const eps = 1e-6;
    const eq = (p, q) => Math.abs(uv[p * 2] - uv[q * 2]) < eps && Math.abs(uv[p * 2 + 1] - uv[q * 2 + 1]) < eps;
    return (eq(va, vc) && eq(vb, vd)) || (eq(va, vd) && eq(vb, vc));
  };
  for (let t = 0; t < m.tris; t++) {
    for (let k = 0; k < 3; k++) {
      const e = m.triEdge[t * 3 + k];
      if (e === NO_EDGE || hidden[e]) continue;
      const v0 = m.vertexOf(t * 3 + k);
      const v1 = m.vertexOf(t * 3 + ((k + 1) % 3));
      // Drawn once per distinct UV segment: skip a side that repeats the first sighting
      if (m.eT1[e] !== t && same(v0, v1, m.eVa[e], m.eVb[e])) continue;
      out.push(uv[v0 * 2], uv[v0 * 2 + 1], uv[v1 * 2], uv[v1 * 2 + 1]);
    }
  }
  return Float32Array.from(out);
}

// Copy of the geometry with normals softened by angle, like Maya's Soften / Harden Edge.
// A shared edge is soft when the two faces meet at less than `angleDeg`. Faces joined by soft edges
// share a normal at each vertex (weighted by the corner angle); a hard edge splits the normal.
// 0 = all hard (faceted), 180 = all soft. The result is non-indexed; the source is not touched.
export function buildAngleNormalGeometry(source, angleDeg) {
  const m = analyzeMesh(source);
  if (!m) return null;
  const { tris, vertexOf, weld, normal, angle, valid, edgeCount, eLo, eHi, eT1, eT2, eCount } = m;

  const corners = tris * 3;
  const parent = new Int32Array(corners);
  for (let c = 0; c < corners; c++) parent[c] = c;
  const find = (c) => {
    while (parent[c] !== c) {
      parent[c] = parent[parent[c]];
      c = parent[c];
    }
    return c;
  };
  const union = (x, y) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  };
  const cornerAt = (t, w) => {
    for (let k = 0; k < 3; k++) if (weld[vertexOf(t * 3 + k)] === w) return t * 3 + k;
    return -1;
  };

  if (angleDeg > 0) {
    const cosLimit = Math.cos((Math.min(angleDeg, 180) * Math.PI) / 180) - 1e-6;
    for (let e = 0; e < edgeCount; e++) {
      if (eCount[e] !== 2) continue;
      const t1 = eT1[e];
      const t2 = eT2[e];
      if (!valid[t1] || !valid[t2]) continue;
      const dot =
        normal[t1 * 3] * normal[t2 * 3] +
        normal[t1 * 3 + 1] * normal[t2 * 3 + 1] +
        normal[t1 * 3 + 2] * normal[t2 * 3 + 2];
      if (dot < cosLimit) continue;
      for (const w of [eLo[e], eHi[e]]) {
        const c1 = cornerAt(t1, w);
        const c2 = cornerAt(t2, w);
        if (c1 >= 0 && c2 >= 0) union(c1, c2);
      }
    }
  }

  // Sum the face normals of each group, weighted by the corner angle
  const sum = new Float32Array(corners * 3);
  for (let c = 0; c < corners; c++) {
    const t = (c / 3) | 0;
    if (!valid[t]) continue;
    const r = find(c) * 3;
    const w = angle[c];
    sum[r] += normal[t * 3] * w;
    sum[r + 1] += normal[t * 3 + 1] * w;
    sum[r + 2] += normal[t * 3 + 2] * w;
  }
  const out = new Float32Array(corners * 3);
  for (let c = 0; c < corners; c++) {
    const t = (c / 3) | 0;
    const r = find(c) * 3;
    let x = sum[r];
    let y = sum[r + 1];
    let z = sum[r + 2];
    let len = Math.hypot(x, y, z);
    if (!(len > 1e-12)) {
      x = normal[t * 3];
      y = normal[t * 3 + 1];
      z = normal[t * 3 + 2];
      len = Math.hypot(x, y, z);
    }
    if (len > 0) {
      out[c * 3] = x / len;
      out[c * 3 + 1] = y / len;
      out[c * 3 + 2] = z / len;
    } else {
      out[c * 3 + 2] = 1;
    }
  }

  let geometry;
  if (source.index) {
    geometry = source.toNonIndexed();
  } else {
    geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
    for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
    if (source.morphAttributes) {
      for (const [name, list] of Object.entries(source.morphAttributes)) geometry.morphAttributes[name] = list;
      geometry.morphTargetsRelative = source.morphTargetsRelative;
    }
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  geometry.deleteAttribute('tangent');
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
