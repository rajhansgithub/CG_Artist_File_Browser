import * as THREE from 'three';
import { TIFFLoader } from 'three/addons/loaders/TIFFLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { load3DModel } from './assetLoader.js';
import { openPdfDocument } from './pdfLoader.js';
import { decodeTiffToRGBA } from './tiffDecoder.js';
import { parseTxTex, TxTexReader, pickPreviewLevel } from './txTexDecoder.js';
import { ThumbnailLane } from './thumbnailScheduler.js';
import { getThumbnailDimensions } from './thumbnailToneMap.js';

// In-memory cache for ultra-fast UI rendering
const memoryCache = new Map();

// Two lanes keep scrolling smooth. `mainLane` runs the JavaScript decoders, which block the UI thread while
// they work, so only two run at once. `nativeLane` waits on the Rust decoder, which runs on its own threads.
// Both drop a job whose card has scrolled away or left the folder before the job starts (see AssetGrid).
const mainLane = new ThumbnailLane(2);
const nativeLane = new ThumbnailLane(2);
const NATIVE_THUMBNAIL_EXTENSIONS = ['.hdr', '.exr', '.tga', '.tif', '.tiff', '.png', '.jpg', '.jpeg', '.webp', '.bmp'];

// Thumbnail pixels (RGBA bytes, already tone mapped) to a JPEG dataURL
function rgbaToDataUrl(rgba, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas.toDataURL('image/jpeg', 0.85);
}

// HDR / EXR decoding runs in a Web Worker (src/workers/thumbnail.worker.js), one file at a time.
let thumbWorker = null;
let nextThumbJobId = 1;
const thumbJobs = new Map();

function getThumbWorker() {
  if (!thumbWorker) {
    thumbWorker = new Worker(new URL('../workers/thumbnail.worker.js', import.meta.url), { type: 'module' });
    thumbWorker.onmessage = (event) => {
      const job = thumbJobs.get(event.data.id);
      if (!job) return;
      thumbJobs.delete(event.data.id);
      if (event.data.ok) job.resolve(event.data);
      else job.reject(new Error(event.data.error || 'HDR/EXR decode failed'));
    };
    thumbWorker.onerror = (event) => {
      for (const job of thumbJobs.values()) job.reject(new Error(event.message || 'Thumbnail worker failed'));
      thumbJobs.clear();
      thumbWorker.terminate();
      thumbWorker = null;
    };
  }
  return thumbWorker;
}

function decodeFloatImageInWorker(arrayBuf, ext) {
  return new Promise((resolve, reject) => {
    const id = nextThumbJobId++;
    thumbJobs.set(id, { resolve, reject });
    getThumbWorker().postMessage({ id, ext, buffer: arrayBuf }, [arrayBuf]);
  });
}

function renderRgbaThumbnail(parsed, targetW, targetH) {
  const w = parsed.width;
  const h = parsed.height;
  if (!targetW || !targetH) {
    const dims = getThumbnailDimensions(w, h);
    targetW = dims.w;
    targetH = dims.h;
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(targetW, targetH);
  const out = imgData.data;
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
export async function getFileBuffer(filePath) {
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
 * Thumbnail already in memory, or null. Synchronous, so a card can show it on its first render.
 */
export function getCachedThumbnail(path) {
  return memoryCache.get(path) || null;
}

/**
 * Generate or retrieve thumbnail for any file. Pass an AbortSignal to drop the request while it waits in line
 * (the card scrolled away or the folder changed); the promise then resolves to null.
 */
export async function getOrGenerateThumbnail(item, { signal } = {}) {
  if (!item || item.isDirectory) return null;
  if (signal?.aborted) return null;

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

  // Try the native (Rust) thumbnail first. It decodes off the UI thread and caches a small JPEG/PNG. On failure
  // (or outside the desktop app) fall through to the previous behaviour below: JS decoders for HDR/EXR/TGA/TIFF,
  // the original file itself for standard images.
  if (NATIVE_THUMBNAIL_EXTENSIONS.includes(ext) && window.electronAPI?.generateThumbnail) {
    const nativeUrl = await nativeLane.run(signal, () => window.electronAPI.generateThumbnail(item.path));
    if (nativeUrl) {
      memoryCache.set(item.path, nativeUrl);
      return nativeUrl;
    }
  }

  // Standard web images don't need decoding — fall back to loading the file directly
  if (['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext)) {
    const directUrl = window.electronAPI?.toAssetUrl
      ? window.electronAPI.toAssetUrl(item.path)
      : item.path;
    memoryCache.set(item.path, directUrl);
    return directUrl;
  }

  // PDF: render the first page with pdf.js (lazy-loaded) and cache it like every other thumbnail
  if (ext === '.pdf') {
    return mainLane.run(signal, async () => {
      let pdf = null;
      try {
        pdf = await openPdfDocument(item.path);
        const page = await pdf.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const maxDim = Math.max(base.width, base.height) || 256;
        const scale = 256 / maxDim;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        memoryCache.set(item.path, dataUrl);
        if (window.electronAPI?.saveThumbnail) {
          window.electronAPI.saveThumbnail(item.path, dataUrl).catch(() => {});
        }
        return dataUrl;
      } catch (err) {
        console.warn(`PDF thumbnail failed for ${item.name}:`, err);
        return null;
      } finally {
        if (pdf) pdf.destroy().catch(() => {});
      }
    });
  }

  // Arnold .tx / RenderMan .tex: read a small mip level instead of decoding the full-size image
  if (ext === '.tx' || ext === '.tex') {
    return mainLane.run(signal, async () => {
      try {
        const arrayBuf = await getFileBuffer(item.path);
        const parsed = parseTxTex(arrayBuf, ext);
        const level = pickPreviewLevel(parsed, 256);
        if (!level) return null;
        const img = await new TxTexReader(arrayBuf, parsed).decodeLevelReduced(level.index, 512);
        const dataUrl = renderRgbaThumbnail({ width: img.width, height: img.height, data: img.rgba });
        memoryCache.set(item.path, dataUrl);
        if (window.electronAPI?.saveThumbnail) {
          window.electronAPI.saveThumbnail(item.path, dataUrl).catch(() => {});
        }
        return dataUrl;
      } catch (err) {
        // Not a texture this app can read (for example a LaTeX .tex file): keep the placeholder icon
        console.warn(`No thumbnail for ${item.name}:`, err?.message || err);
      }
      return null;
    });
  }

  // Handle TIFF textures (.tif, .tiff)
  if (ext === '.tif' || ext === '.tiff') {
    return mainLane.run(signal, async () => {
      try {
        if (typeof window !== 'undefined') window.log = console.log;
        if (typeof globalThis !== 'undefined') globalThis.log = console.log;

        const arrayBuf = await getFileBuffer(item.path);
        let parsed = null;

        try {
          parsed = await decodeTiffToRGBA(arrayBuf);
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
    return mainLane.run(signal, async () => {
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

  // Handle HDR and EXR files (True float decoding + ACES Filmic Tone Mapping), decoded in a worker
  if (ext === '.hdr' || ext === '.exr') {
    return mainLane.run(signal, async () => {
      try {
        const arrayBuf = await getFileBuffer(item.path);
        const { width, height, rgba } = await decodeFloatImageInWorker(arrayBuf, ext);
        const dataUrl = rgbaToDataUrl(rgba, width, height);
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
    return mainLane.run(signal, async () => {
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
    return mainLane.run(signal, async () => {
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
    return mainLane.run(signal, async () => {
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
        const vw = video.videoWidth || 320;
        const vh = video.videoHeight || 180;
        const maxDim = 320;
        let targetW, targetH;
        if (vw >= vh) {
          targetW = maxDim;
          targetH = Math.max(1, Math.round((maxDim * vh) / vw));
        } else {
          targetH = maxDim;
          targetW = Math.max(1, Math.round((maxDim * vw) / vh));
        }
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, targetW, targetH);
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

