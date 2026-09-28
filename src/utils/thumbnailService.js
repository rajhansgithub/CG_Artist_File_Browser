import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EXRLoader } from './exrLoaderExtended.js';
import { TIFFLoader } from 'three/addons/loaders/TIFFLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { load3DModel } from './assetLoader.js';

// In-memory cache for ultra-fast UI rendering
const memoryCache = new Map();

// Concurrency queue to keep scrolling butter-smooth
class ThumbnailQueue {
  constructor(concurrency = 3) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  enqueue(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.running >= this.concurrency || this.queue.length === 0) return;

    this.running++;
    const { task, resolve, reject } = this.queue.shift();

    try {
      const result = await task();
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      this.running--;
      this.process();
    }
  }
}

const queue = new ThumbnailQueue(3);

// Convert raw number or half-float to float
function toFloat(val, isHalfFloat) {
  if (val === undefined || val === null) return 0;
  if (isHalfFloat) {
    return THREE.DataUtils.fromHalfFloat(val);
  }
  return typeof val === 'number' && !isNaN(val) && isFinite(val) ? Math.max(0, val) : 0;
}

// ACES Filmic Tone Mapping formula
function acesFilmic(x) {
  if (isNaN(x) || !isFinite(x) || x <= 0) return 0;
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  const mapped = (x * (a * x + b)) / (x * (c * x + d) + e);
  const clamped = Math.min(1.0, Math.max(0.0, mapped));
  // Gamma 2.2 curve
  return Math.min(255, Math.max(0, Math.round(Math.pow(clamped, 1.0 / 2.2) * 255)));
}

// Convert float/half-float HDR/EXR image data to a 256x128 tone-mapped JPEG dataURL
function renderToneMappedThumbnail(parsed, targetW = 256, targetH = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(targetW, targetH);
  const out = imgData.data;

  const w = parsed.width;
  const h = parsed.height;
  const data = parsed.data;
  if (!data || w <= 0 || h <= 0) return null;

  const isHalf = data instanceof Uint16Array;
  const numChannels = data.length >= w * h * 4 ? 4 : (data.length >= w * h * 3 ? 3 : 1);

  // Auto-exposure sampling: sample luminance across pixels to normalize middle gray ~0.18
  let sampleSum = 0;
  let sampleCount = 0;
  const step = Math.max(1, Math.floor((w * h) / 500));
  for (let i = 0; i < w * h * numChannels; i += step * numChannels) {
    const r = toFloat(data[i], isHalf);
    const g = numChannels >= 3 ? toFloat(data[i + 1], isHalf) : r;
    const b = numChannels >= 3 ? toFloat(data[i + 2], isHalf) : r;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum > 0.0001 && isFinite(lum)) {
      sampleSum += lum;
      sampleCount++;
    }
  }

  let exposureMult = 1.0;
  if (sampleCount > 0) {
    const avgLum = sampleSum / sampleCount;
    if (avgLum > 0.00001) {
      exposureMult = Math.min(32.0, Math.max(0.05, 0.18 / avgLum));
    }
  }

  const isExr = !!parsed.isExr;

  // Resample & ACES tone map
  for (let y = 0; y < targetH; y++) {
    // In EXRLoader, scanline data was inverted during decode so row 0 in data is the bottom of the EXR.
    // Invert Y when mapping to canvas (where y=0 is top) so the thumbnail is rendered upright.
    // For RGBELoader (.hdr), row 0 in data is already the top of the HDR.
    const normY = y / targetH;
    const srcY = isExr
      ? Math.min(h - 1, Math.max(0, Math.floor((1 - normY) * h)))
      : Math.min(h - 1, Math.max(0, Math.floor(normY * h)));

    for (let x = 0; x < targetW; x++) {
      const srcX = Math.floor((x / targetW) * w);
      const pixelIndex = srcY * w + srcX;
      const srcIdx = pixelIndex * numChannels;
      const dstIdx = (y * targetW + x) * 4;

      const r = toFloat(data[srcIdx], isHalf) * exposureMult;
      const g = (numChannels >= 3 ? toFloat(data[srcIdx + 1], isHalf) : r) * exposureMult;
      const b = (numChannels >= 3 ? toFloat(data[srcIdx + 2], isHalf) : r) * exposureMult;

      out[dstIdx] = acesFilmic(r);
      out[dstIdx + 1] = acesFilmic(g);
      out[dstIdx + 2] = acesFilmic(b);
      out[dstIdx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.85);
}

function renderRgbaThumbnail(parsed, targetW = 256, targetH = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(targetW, targetH);
  const out = imgData.data;

  const w = parsed.width;
  const h = parsed.height;
  const data = parsed.data;
  const totalPixels = w * h;
  const isGrayscale = data.length === totalPixels;
  const isRgb = data.length === totalPixels * 3;

  for (let y = 0; y < targetH; y++) {
    const srcY = Math.floor((y / targetH) * h);
    for (let x = 0; x < targetW; x++) {
      const srcX = Math.floor((x / targetW) * w);
      const pixelIdx = srcY * w + srcX;
      const dstIdx = (y * targetW + x) * 4;

      if (isGrayscale) {
        const val = data[pixelIdx];
        out[dstIdx] = val;
        out[dstIdx + 1] = val;
        out[dstIdx + 2] = val;
        out[dstIdx + 3] = 255;
      } else if (isRgb) {
        const srcIdx = pixelIdx * 3;
        out[dstIdx] = data[srcIdx];
        out[dstIdx + 1] = data[srcIdx + 1];
        out[dstIdx + 2] = data[srcIdx + 2];
        out[dstIdx + 3] = 255;
      } else {
        const srcIdx = pixelIdx * 4;
        out[dstIdx] = data[srcIdx];
        out[dstIdx + 1] = data[srcIdx + 1];
        out[dstIdx + 2] = data[srcIdx + 2];
        out[dstIdx + 3] = 255;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.85);
}

// Reusable offscreen 3D renderer for high-quality, focused model previews on dark background
let offscreen3DRenderer = null;
let offscreen3DScene = null;
let offscreen3DCamera = null;

function getOffscreen3DRenderer() {
  if (!offscreen3DRenderer) {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 160;
    offscreen3DRenderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    offscreen3DRenderer.setSize(320, 160, false);
    offscreen3DRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    offscreen3DRenderer.toneMappingExposure = 1.3;

    offscreen3DScene = new THREE.Scene();
    offscreen3DScene.background = new THREE.Color(0x0a0a0a); // Pure dark background

    offscreen3DCamera = new THREE.PerspectiveCamera(45, 320 / 160, 0.01, 1000);

    // Studio Lighting
    const hemi = new THREE.HemisphereLight(0xffffff, 0x181818, 0.9);
    offscreen3DScene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(5, 8, 5);
    offscreen3DScene.add(key);

    const fill = new THREE.DirectionalLight(0x888888, 1.0);
    fill.position.set(-5, 4, -4);
    offscreen3DScene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 1.6);
    rim.position.set(0, 5, -6);
    offscreen3DScene.add(rim);
  }
  return { renderer: offscreen3DRenderer, scene: offscreen3DScene, camera: offscreen3DCamera };
}

// Render offscreen 3D thumbnail with auto-framing on dark background
async function renderOffscreen3DThumbnail(item) {
  const { renderer, scene, camera } = getOffscreen3DRenderer();

  const { root } = await load3DModel(item);
  if (!root) throw new Error('No root object returned from load3DModel');

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim <= 0) throw new Error('Invalid model dimensions');

  // Center model at origin
  root.position.sub(center);
  root.updateMatrixWorld(true);

  // If model has no materials or pure black, apply neutral studio clay material
  let hasValidMaterial = false;
  root.traverse((child) => {
    if (child.isMesh && child.material) {
      hasValidMaterial = true;
    }
  });

  if (!hasValidMaterial) {
    const defaultMat = new THREE.MeshStandardMaterial({
      color: 0x909090,
      roughness: 0.35,
      metalness: 0.15
    });
    root.traverse((child) => {
      if (child.isMesh) child.material = defaultMat;
    });
  }

  scene.add(root);

  // Position camera so model fills the frame comfortably
  const fovRad = camera.fov * (Math.PI / 180);
  let dist = (maxDim / 2) / Math.tan(fovRad / 2);
  dist *= 1.35; // optimal 35% margin

  camera.position.set(dist * 0.75, dist * 0.45, dist * 0.85);
  camera.lookAt(0, 0, 0);
  camera.near = Math.max(0.001, dist * 0.01);
  camera.far = Math.max(1000, dist * 100);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/jpeg', 0.88);

  scene.remove(root);
  return dataUrl;
}

// Load binary buffer safely via Electron IPC or Fetch
async function getFileBuffer(filePath) {
  if (typeof window !== 'undefined' && !window.log) {
    window.log = console.log;
  }
  if (window.electronAPI?.readFileBuffer) {
    const buf = await window.electronAPI.readFileBuffer(filePath);
    if (buf) {
      if (buf instanceof ArrayBuffer) return buf;
      if (ArrayBuffer.isView(buf)) return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      if (buf.data) return new Uint8Array(buf.data).buffer;
      return new Uint8Array(buf).buffer;
    }
  }

  // Fallback to fetch
  const url = window.electronAPI?.toAssetUrl ? window.electronAPI.toAssetUrl(filePath) : filePath;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} loading ${filePath}`);
  return await response.arrayBuffer();
}

/**
 * Generate or retrieve thumbnail for any file
 */
export async function getOrGenerateThumbnail(item) {
  if (!item || item.isDirectory) return null;

  // 1. Check in-memory cache
  if (memoryCache.has(item.path)) {
    return memoryCache.get(item.path);
  }

  // 2. Check disk cache if already loaded by readDirectory
  if (item.thumbnail) {
    memoryCache.set(item.path, item.thumbnail);
    return item.thumbnail;
  }

  const ext = (item.extension || '').toLowerCase();

  // Standard web images don't need decoding — load directly!
  if (['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext)) {
    const directUrl = window.electronAPI?.toAssetUrl
      ? window.electronAPI.toAssetUrl(item.path)
      : item.path;
    memoryCache.set(item.path, directUrl);
    return directUrl;
  }

  // Handle TIFF textures (.tif, .tiff)
  if (ext === '.tif' || ext === '.tiff') {
    return queue.enqueue(async () => {
      try {
        if (typeof window !== 'undefined') window.log = console.log;
        if (typeof globalThis !== 'undefined') globalThis.log = console.log;

        const arrayBuf = await getFileBuffer(item.path);
        let parsed = null;

        try {
          const { default: UTIF } = await import('three/addons/libs/utif.module.js');
          const ifds = UTIF.decode(arrayBuf);
          if (ifds && ifds.length > 0) {
            UTIF.decodeImage(arrayBuf, ifds[0], ifds);
            const rgba = UTIF.toRGBA8(ifds[0]);
            parsed = {
              width: ifds[0].width,
              height: ifds[0].height,
              data: rgba
            };
          }
        } catch (utifErr) {
          console.warn('Direct UTIF decode failed in thumbnail, trying TIFFLoader:', utifErr);
        }

        if (!parsed || !parsed.data) {
          const loader = new TIFFLoader();
          parsed = loader.parse(arrayBuf);
        }

        if (parsed && parsed.data) {
          const dataUrl = renderRgbaThumbnail(parsed);
          memoryCache.set(item.path, dataUrl);
          if (window.electronAPI?.saveThumbnail) {
            window.electronAPI.saveThumbnail(item.path, dataUrl).catch(() => {});
          }
          return dataUrl;
        }
      } catch (err) {
        console.error(`Failed to decode TIFF ${item.name}:`, err);
      }
      return null;
    });
  }

  // Handle TGA textures (.tga)
  if (ext === '.tga') {
    return queue.enqueue(async () => {
      try {
        const arrayBuf = await getFileBuffer(item.path);
        const loader = new TGALoader();
        const parsed = loader.parse(arrayBuf);
        if (parsed && parsed.data) {
          const dataUrl = renderRgbaThumbnail(parsed);
          memoryCache.set(item.path, dataUrl);
          if (window.electronAPI?.saveThumbnail) {
            window.electronAPI.saveThumbnail(item.path, dataUrl).catch(() => {});
          }
          return dataUrl;
        }
      } catch (err) {
        console.error(`Failed to decode TGA ${item.name}:`, err);
      }
      return null;
    });
  }

  // Handle HDR and EXR files (True float decoding + ACES Filmic Tone Mapping)
  if (ext === '.hdr' || ext === '.exr') {
    return queue.enqueue(async () => {
      try {
        const arrayBuf = await getFileBuffer(item.path);
        let parsed = null;

        if (ext === '.hdr') {
          const loader = new RGBELoader();
          loader.type = THREE.FloatType;
          parsed = loader.parse(arrayBuf);
          if (parsed) {
            parsed.isHdr = true;
            parsed.isExr = false;
          }
        } else if (ext === '.exr') {
          const loader = new EXRLoader();
          loader.setDataType(THREE.FloatType);
          parsed = loader.parse(arrayBuf);
          if (parsed) {
            parsed.isHdr = false;
            parsed.isExr = true;
          }
        }

        if (!parsed || !parsed.data) {
          throw new Error('Failed to parse HDR/EXR image data');
        }

        const dataUrl = renderToneMappedThumbnail(parsed);
        memoryCache.set(item.path, dataUrl);

        // Save to disk cache asynchronously
        if (window.electronAPI?.saveThumbnail) {
          window.electronAPI.saveThumbnail(item.path, dataUrl).catch((e) => {
            console.warn('Failed to save thumbnail to disk cache:', e);
          });
        }

        return dataUrl;
      } catch (err) {
        console.error(`Failed to generate thumbnail for ${item.name}:`, err);
        return null;
      }
    });
  }

  // Handle 3D Models: OBJ, FBX, GLTF, GLB, STL, PLY via offscreen Three.js renderer
  if (['.obj', '.fbx', '.gltf', '.glb', '.stl', '.ply'].includes(ext)) {
    return queue.enqueue(async () => {
      try {
        const dataUrl = await renderOffscreen3DThumbnail(item);
        if (dataUrl) {
          memoryCache.set(item.path, dataUrl);
          if (window.electronAPI?.saveThumbnail) {
            window.electronAPI.saveThumbnail(item.path, dataUrl).catch(() => {});
          }
          return dataUrl;
        }
      } catch (e) {
        // Fallback to Blender if available
        if (window.electronAPI?.renderThumbnail) {
          try {
            const res = await window.electronAPI.renderThumbnail(item.path);
            if (res && res.success && res.thumbnailPath) {
              const thumbUrl = window.electronAPI.toAssetUrl(res.thumbnailPath);
              memoryCache.set(item.path, thumbUrl);
              return thumbUrl;
            }
          } catch (blenderErr) {}
        }
      }
      return null;
    });
  }

  // Handle Video formats: MP4, WEBM, MOV, MKV, AVI
  if (['.mp4', '.webm', '.mov', '.mkv', '.avi'].includes(ext) || item.category === 'video') {
    return queue.enqueue(async () => {
      try {
        const dataUrl = await renderOffscreenVideoThumbnail(item);
        if (dataUrl) {
          memoryCache.set(item.path, dataUrl);
          if (window.electronAPI?.saveThumbnail) {
            window.electronAPI.saveThumbnail(item.path, dataUrl).catch(() => {});
          }
          return dataUrl;
        }
      } catch (e) {
        console.warn('Video thumbnail capture error:', e);
      }
      return null;
    });
  }

  // For Alembic / USD files, use Blender thumbnail bridge
  if (['.abc', '.usd', '.usda', '.usdc', '.usdz', '.blend'].includes(ext) && window.electronAPI?.renderThumbnail) {
    return queue.enqueue(async () => {
      try {
        const res = await window.electronAPI.renderThumbnail(item.path);
        if (res && res.success && res.thumbnailPath) {
          const thumbUrl = window.electronAPI.toAssetUrl(res.thumbnailPath);
          memoryCache.set(item.path, thumbUrl);
          return thumbUrl;
        }
      } catch (e) {
        // silent fallback to format icon
      }
      return null;
    });
  }

  return null;
}

// Render offscreen video frame capture for video thumbnails
function renderOffscreenVideoThumbnail(item) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const streamUrl = window.electronAPI?.toAssetUrl ? window.electronAPI.toAssetUrl(item.path) : item.path;
    video.src = streamUrl;
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';

    let resolved = false;
    const cleanUp = () => {
      if (!resolved) {
        resolved = true;
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };

    video.onloadedmetadata = () => {
      const seekTime = Math.min(1.0, video.duration > 0.5 ? video.duration * 0.1 : 0.1);
      video.currentTime = isFinite(seekTime) ? seekTime : 0.1;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, 320, 180);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        cleanUp();
        resolve(dataUrl);
      } catch (err) {
        cleanUp();
        resolve(null);
      }
    };

    video.onerror = () => {
      cleanUp();
      resolve(null);
    };

    setTimeout(() => {
      cleanUp();
      resolve(null);
    }, 4000);
  });
}

