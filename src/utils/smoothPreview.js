import * as THREE from 'three';

// Smooth preview for the 3D viewer: a Loop subdivision of the triangles, like Maya's smooth mesh preview (key 3).
// It only builds a display copy of the geometry. The model and the file are never changed.

// The most triangles the smoothed model may have in total. Past this the preview would stall the viewer.
export const SMOOTH_TRIANGLE_BUDGET = 800000;
export const SMOOTH_DEFAULT_LEVEL = 2;

// Attributes that are rebuilt rather than carried over
const SKIPPED_ATTRIBUTES = new Set(['position', 'normal', 'tangent']);

// Skinned and morphing meshes move their vertices on the GPU, so a subdivided copy would not follow them
export function canSmoothMesh(mesh) {
  const geometry = mesh.geometry;
  if (!mesh.isMesh || mesh.isSkinnedMesh || !geometry?.attributes?.position) return false;
  if (geometry.attributes.skinIndex || geometry.attributes.skinWeight) return false;
  if (geometry.morphAttributes && Object.keys(geometry.morphAttributes).length > 0) return false;
  return true;
}

export function countGeometryTriangles(geometry) {
  const count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
  return Math.floor(count / 3);
}

// How many subdivisions fit the triangle budget (0 means the model is too dense to smooth)
export function smoothLevelFor(triangles, wanted = SMOOTH_DEFAULT_LEVEL) {
  let level = wanted;
  while (level > 0 && triangles * 4 ** level > SMOOTH_TRIANGLE_BUDGET) level--;
  return level;
}

// A BufferAttribute (plain or interleaved) as a flat Float32Array of count * itemSize values
function readAttribute(attribute) {
  const size = attribute.itemSize;
  if (attribute.isBufferAttribute && !attribute.normalized && attribute.array instanceof Float32Array) {
    return attribute.array.length === attribute.count * size
      ? attribute.array
      : attribute.array.subarray(0, attribute.count * size);
  }
  const out = new Float32Array(attribute.count * size);
  for (let i = 0; i < attribute.count; i++) {
    const o = i * size;
    out[o] = attribute.getX(i);
    if (size > 1) out[o + 1] = attribute.getY(i);
    if (size > 2) out[o + 2] = attribute.getZ(i);
    if (size > 3) out[o + 3] = attribute.getW(i);
  }
  return out;
}

// Vertices at the same spot count as one, so UV seams and hard edges do not tear the surface apart
function weldPositions(positions, vertexCount) {
  const weldedId = new Uint32Array(vertexCount);
  const seen = new Map();
  const unique = [];
  for (let i = 0; i < vertexCount; i++) {
    const o = i * 3;
    const key = `${positions[o]},${positions[o + 1]},${positions[o + 2]}`;
    let id = seen.get(key);
    if (id === undefined) {
      id = unique.length / 3;
      seen.set(key, id);
      unique.push(positions[o], positions[o + 1], positions[o + 2]);
    }
    weldedId[i] = id;
  }
  return { weldedId, positions: Float32Array.from(unique), count: unique.length / 3 };
}

// One Loop subdivision pass over triangles given as corners.
// vids: welded vertex id per corner. wp / wCount: welded positions. attrs: [{ size, data }] per corner.
function subdivideOnce({ tris, vids, wp, wCount, attrs }) {
  // Edges, with the vertex opposite each of up to two triangles that share them
  const edgeOf = new Map();
  const edgeA = new Uint32Array(tris * 3);
  const edgeB = new Uint32Array(tris * 3);
  const opp1 = new Uint32Array(tris * 3);
  const opp2 = new Uint32Array(tris * 3);
  const shared = new Uint8Array(tris * 3);
  const triEdge = new Uint32Array(tris * 3);
  let edgeCount = 0;

  for (let t = 0; t < tris; t++) {
    const base = t * 3;
    for (let k = 0; k < 3; k++) {
      const a = vids[base + k];
      const b = vids[base + ((k + 1) % 3)];
      const c = vids[base + ((k + 2) % 3)];
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const key = lo * wCount + hi;
      let e = edgeOf.get(key);
      if (e === undefined) {
        e = edgeCount++;
        edgeOf.set(key, e);
        edgeA[e] = lo;
        edgeB[e] = hi;
      }
      if (shared[e] === 0) opp1[e] = c;
      else if (shared[e] === 1) opp2[e] = c;
      if (shared[e] < 255) shared[e]++;
      triEdge[base + k] = e;
    }
  }

  const nextCount = wCount + edgeCount;
  const next = new Float32Array(nextCount * 3);

  // New point on each edge: 3/8 of its ends and 1/8 of the two opposite corners, or the middle on an open edge
  for (let e = 0; e < edgeCount; e++) {
    const a = edgeA[e] * 3;
    const b = edgeB[e] * 3;
    const o = (wCount + e) * 3;
    if (shared[e] === 2) {
      const c = opp1[e] * 3;
      const d = opp2[e] * 3;
      for (let i = 0; i < 3; i++) {
        next[o + i] = 0.375 * (wp[a + i] + wp[b + i]) + 0.125 * (wp[c + i] + wp[d + i]);
      }
    } else {
      for (let i = 0; i < 3; i++) next[o + i] = 0.5 * (wp[a + i] + wp[b + i]);
    }
  }

  // Old points move toward their neighbours. Open borders only slide along the border.
  const valence = new Uint32Array(wCount);
  const sum = new Float64Array(wCount * 3);
  const borderCount = new Uint32Array(wCount);
  const borderSum = new Float64Array(wCount * 3);
  for (let e = 0; e < edgeCount; e++) {
    const a = edgeA[e];
    const b = edgeB[e];
    const open = shared[e] !== 2;
    valence[a]++;
    valence[b]++;
    if (open) {
      borderCount[a]++;
      borderCount[b]++;
    }
    for (let i = 0; i < 3; i++) {
      sum[a * 3 + i] += wp[b * 3 + i];
      sum[b * 3 + i] += wp[a * 3 + i];
      if (open) {
        borderSum[a * 3 + i] += wp[b * 3 + i];
        borderSum[b * 3 + i] += wp[a * 3 + i];
      }
    }
  }
  for (let v = 0; v < wCount; v++) {
    const o = v * 3;
    const n = valence[v];
    if (borderCount[v] > 0) {
      if (borderCount[v] === 2) {
        for (let i = 0; i < 3; i++) next[o + i] = 0.75 * wp[o + i] + 0.125 * borderSum[o + i];
      } else {
        for (let i = 0; i < 3; i++) next[o + i] = wp[o + i];
      }
    } else if (n < 3) {
      for (let i = 0; i < 3; i++) next[o + i] = wp[o + i];
    } else {
      const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
      for (let i = 0; i < 3; i++) next[o + i] = (1 - n * beta) * wp[o + i] + beta * sum[o + i];
    }
  }

  // Every triangle becomes four, in the same winding. The four stay together, so material groups still line up.
  const nextTris = tris * 4;
  const nextVids = new Uint32Array(nextTris * 3);
  for (let t = 0; t < tris; t++) {
    const base = t * 3;
    const v0 = vids[base];
    const v1 = vids[base + 1];
    const v2 = vids[base + 2];
    const m01 = wCount + triEdge[base];
    const m12 = wCount + triEdge[base + 1];
    const m20 = wCount + triEdge[base + 2];
    nextVids.set([v0, m01, m20, v1, m12, m01, v2, m20, m12, m01, m12, m20], t * 12);
  }

  const nextAttrs = attrs.map(({ size, data }) => {
    const out = new Float32Array(nextTris * 3 * size);
    for (let t = 0; t < tris; t++) {
      const base = t * 3 * size;
      const o = t * 12 * size;
      for (let i = 0; i < size; i++) {
        const c0 = data[base + i];
        const c1 = data[base + size + i];
        const c2 = data[base + 2 * size + i];
        const m01 = (c0 + c1) * 0.5;
        const m12 = (c1 + c2) * 0.5;
        const m20 = (c2 + c0) * 0.5;
        out[o + i] = c0;
        out[o + size + i] = m01;
        out[o + 2 * size + i] = m20;
        out[o + 3 * size + i] = c1;
        out[o + 4 * size + i] = m12;
        out[o + 5 * size + i] = m01;
        out[o + 6 * size + i] = c2;
        out[o + 7 * size + i] = m20;
        out[o + 8 * size + i] = m12;
        out[o + 9 * size + i] = m01;
        out[o + 10 * size + i] = m12;
        out[o + 11 * size + i] = m20;
      }
    }
    return { size, data: out };
  });

  return { tris: nextTris, vids: nextVids, wp: next, wCount: nextCount, attrs: nextAttrs };
}

// Returns a new, non-indexed BufferGeometry with smooth normals, subdivided `level` times.
// UVs and other per-vertex data are carried over; material groups are kept.
export function buildSmoothGeometry(source, level) {
  const posAttr = source.attributes.position;
  const vertexCount = posAttr.count;
  const index = source.index ? source.index.array : null;
  const tris = Math.floor((index ? index.length : vertexCount) / 3);

  const welded = weldPositions(readAttribute(posAttr), vertexCount);

  const vids = new Uint32Array(tris * 3);
  for (let c = 0; c < tris * 3; c++) vids[c] = welded.weldedId[index ? index[c] : c];

  // Per-corner copies of the other attributes (UVs, vertex colours)
  const attrs = [];
  const names = [];
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (SKIPPED_ATTRIBUTES.has(name) || attribute.itemSize > 4) continue;
    const size = attribute.itemSize;
    const values = readAttribute(attribute);
    const data = new Float32Array(tris * 3 * size);
    for (let c = 0; c < tris * 3; c++) {
      const vertex = index ? index[c] : c;
      for (let i = 0; i < size; i++) data[c * size + i] = values[vertex * size + i];
    }
    attrs.push({ size, data });
    names.push(name);
  }

  let state = { tris, vids, wp: welded.positions, wCount: welded.count, attrs };
  for (let l = 0; l < level; l++) state = subdivideOnce(state);

  // Positions per corner, and normals averaged over the shared point so the surface shades smooth
  const outTris = state.tris;
  const corners = outTris * 3;
  const position = new Float32Array(corners * 3);
  const faceSum = new Float32Array(state.wCount * 3);
  for (let t = 0; t < outTris; t++) {
    const i0 = state.vids[t * 3] * 3;
    const i1 = state.vids[t * 3 + 1] * 3;
    const i2 = state.vids[t * 3 + 2] * 3;
    const wp = state.wp;
    const ux = wp[i1] - wp[i0];
    const uy = wp[i1 + 1] - wp[i0 + 1];
    const uz = wp[i1 + 2] - wp[i0 + 2];
    const vx = wp[i2] - wp[i0];
    const vy = wp[i2 + 1] - wp[i0 + 1];
    const vz = wp[i2 + 2] - wp[i0 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    faceSum[i0] += nx;
    faceSum[i0 + 1] += ny;
    faceSum[i0 + 2] += nz;
    faceSum[i1] += nx;
    faceSum[i1 + 1] += ny;
    faceSum[i1 + 2] += nz;
    faceSum[i2] += nx;
    faceSum[i2 + 1] += ny;
    faceSum[i2 + 2] += nz;
  }
  const normal = new Float32Array(corners * 3);
  for (let c = 0; c < corners; c++) {
    const w = state.vids[c] * 3;
    const o = c * 3;
    position[o] = state.wp[w];
    position[o + 1] = state.wp[w + 1];
    position[o + 2] = state.wp[w + 2];
    const nx = faceSum[w];
    const ny = faceSum[w + 1];
    const nz = faceSum[w + 2];
    const len = Math.hypot(nx, ny, nz) || 1;
    normal[o] = nx / len;
    normal[o + 1] = ny / len;
    normal[o + 2] = nz / len;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  state.attrs.forEach(({ size, data }, i) => {
    geometry.setAttribute(names[i], new THREE.BufferAttribute(data, size));
  });

  // Each original triangle is now 4^level triangles in a row
  const scale = 4 ** level;
  for (const group of source.groups) {
    geometry.addGroup(group.start * scale, group.count * scale, group.materialIndex);
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// A distinct, steady colour for the n-th mesh. Hues step by the golden ratio so neighbours differ.
export function randomMeshColor(n) {
  const hue = (n * 0.61803398875 + 0.12) % 1;
  const saturation = n % 2 === 0 ? 0.65 : 0.5;
  const lightness = n % 3 === 0 ? 0.5 : n % 3 === 1 ? 0.58 : 0.44;
  return new THREE.Color().setHSL(hue, saturation, lightness, THREE.SRGBColorSpace);
}
