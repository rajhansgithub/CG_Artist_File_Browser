import * as THREE from 'three';

// Procedural MatCap textures for the 3D viewport. Nothing is bundled: each sphere is
// drawn once on a small canvas the first time it is used and then cached.

const SIZE = 512;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
const mixRgb = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

// Light direction (view space, normalised) shared by the diffuse-style MatCaps
const LIGHT = (() => {
  const l = [-0.45, 0.6, 0.66];
  const len = Math.hypot(...l);
  return l.map((v) => v / len);
})();

// Reflection of the view ray (0,0,-1) around the sphere normal
const reflectView = (n) => [2 * n[2] * n[0], 2 * n[2] * n[1], 2 * n[2] * n[2] - 1];

// Soft studio environment: bright sky, dark floor, a horizon line and two softboxes
function studioEnvironment(r) {
  const sky = mixRgb([0.62, 0.68, 0.78], [0.96, 0.97, 1.0], smoothstep(0, 0.9, r[1]));
  const floor = mixRgb([0.05, 0.05, 0.06], [0.18, 0.17, 0.17], smoothstep(-1, -0.1, r[1]));
  let c = mixRgb(floor, sky, smoothstep(-0.04, 0.04, r[1]));
  const horizon = 1 - smoothstep(0, 0.035, Math.abs(r[1]));
  c = mixRgb(c, [1, 1, 1], horizon * 0.5);
  const box = (cx, cy, rx, ry) => {
    const dx = (r[0] - cx) / rx;
    const dy = (r[1] - cy) / ry;
    return 1 - smoothstep(0.7, 1, Math.hypot(dx, dy));
  };
  const lights = Math.max(box(-0.55, 0.55, 0.28, 0.2), box(0.6, 0.35, 0.18, 0.28));
  return mixRgb(c, [1, 1, 1], lights);
}

const MATCAPS = {
  clay: {
    label: 'Clay',
    shade: (n) => {
      const diffuse = clamp01(n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      const fill = clamp01(-n[0] * 0.5 + n[1] * -0.2 + n[2] * 0.4) * 0.12;
      const v = 0.2 + 0.72 * diffuse + fill;
      return [v * 0.86, v * 0.85, v * 0.83];
    }
  },
  red_wax: {
    label: 'Red Wax',
    shade: (n) => {
      const ndl = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2];
      const wrap = clamp01((ndl + 0.35) / 1.35);
      const base = mixRgb([0.2, 0.03, 0.03], [0.82, 0.17, 0.13], wrap);
      // Soft subsurface glow toward the edge facing away from the light
      const glow = Math.pow(1 - clamp01(n[2]), 2.5) * (1 - clamp01(ndl)) * 0.35;
      const h = [LIGHT[0], LIGHT[1], LIGHT[2] + 1];
      const hl = Math.hypot(...h);
      const spec = Math.pow(clamp01((n[0] * h[0] + n[1] * h[1] + n[2] * h[2]) / hl), 36) * 0.65;
      return [base[0] + glow + spec, base[1] + glow * 0.25 + spec, base[2] + glow * 0.2 + spec];
    }
  },
  chrome: {
    label: 'Chrome',
    shade: (n) => {
      const c = studioEnvironment(reflectView(n));
      return [c[0] * 0.95, c[1] * 0.96, c[2] * 1.0];
    }
  },
  zebra: {
    label: 'Zebra',
    shade: (n) => {
      const r = reflectView(n);
      // Stripes run along the reflected direction, so bends and seams show as kinks
      const wave = Math.sin(r[1] * Math.PI * 9 + r[0] * 1.2);
      const v = smoothstep(-0.3, 0.3, wave);
      const shade = 0.05 + 0.93 * v;
      return [shade, shade, shade];
    }
  },
  ceramic: {
    label: 'Ceramic',
    shade: (n) => {
      const ndl = clamp01(n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      const base = 0.5 + 0.45 * ndl;
      const h = [LIGHT[0], LIGHT[1], LIGHT[2] + 1];
      const hl = Math.hypot(...h);
      const spec = Math.pow(clamp01((n[0] * h[0] + n[1] * h[1] + n[2] * h[2]) / hl), 90) * 0.9;
      const rim = Math.pow(1 - clamp01(n[2]), 3) * 0.22;
      const v = base + spec + rim;
      return [v * 0.97, v * 0.98, v];
    }
  }
};

export const MATCAP_OPTIONS = Object.entries(MATCAPS).map(([id, def]) => ({ id, label: def.label }));

const textureCache = new Map();
const materialCache = new Map();

function buildTexture(id) {
  const def = MATCAPS[id];
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(SIZE, SIZE);
  const data = image.data;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let nx = ((x + 0.5) / SIZE) * 2 - 1;
      let ny = 1 - ((y + 0.5) / SIZE) * 2;
      let len = Math.hypot(nx, ny);
      // Outside the sphere reuse the rim colour so texture filtering never bleeds in black
      if (len > 0.995) {
        nx = (nx / len) * 0.995;
        ny = (ny / len) * 0.995;
        len = 0.995;
      }
      const n = [nx, ny, Math.sqrt(Math.max(0, 1 - len * len))];
      const c = def.shade(n);
      const i = (y * SIZE + x) * 4;
      data[i] = Math.round(clamp01(c[0]) * 255);
      data[i + 1] = Math.round(clamp01(c[1]) * 255);
      data[i + 2] = Math.round(clamp01(c[2]) * 255);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// One shared material per MatCap, created on first use
export function getMatcapMaterial(id) {
  if (!MATCAPS[id]) return null;
  let material = materialCache.get(id);
  if (!material) {
    let texture = textureCache.get(id);
    if (!texture) {
      texture = buildTexture(id);
      textureCache.set(id, texture);
    }
    // toneMapped off so the sphere colours show exactly as drawn
    material = new THREE.MeshMatcapMaterial({ matcap: texture, toneMapped: false });
    materialCache.set(id, material);
  }
  return material;
}

export function disposeMatcaps() {
  materialCache.forEach((m) => m.dispose());
  textureCache.forEach((t) => t.dispose());
  materialCache.clear();
  textureCache.clear();
}
