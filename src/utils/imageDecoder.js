import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

// In-memory cache for decoded images: Map<path, { url, width, height, isBlob, format }>
const imageCache = new Map();

// Helper to convert half-float or raw number to float
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
  return Math.min(255, Math.max(0, Math.round(mapped * 255)));
}

/**
 * Loads and decodes an image asset of any supported type (PNG, JPG, WEBP, TIFF, TGA, HDR, EXR)
 * Returns a Promise resolving to { url, width, height, isBlob, format, error }
 */
export async function loadImageAsset(asset) {
  if (!asset || !asset.path) {
    return { error: 'No asset provided' };
  }

  const path = asset.path;
  const ext = (asset.extension || (path.slice(path.lastIndexOf('.')))).toLowerCase();

  // Check memory cache
  if (imageCache.has(path)) {
    return imageCache.get(path);
  }

  try {
    // 1. TIFF and TGA textures
    if (ext === '.tif' || ext === '.tiff' || ext === '.tga') {
      const decoded = await decodeTextureFile(asset, ext);
      imageCache.set(path, decoded);
      return decoded;
    }

    // 2. HDR and EXR images
    if (ext === '.hdr' || ext === '.exr') {
      const decoded = await decodeHdrExrFile(asset, ext);
      imageCache.set(path, decoded);
      return decoded;
    }

    // 3. Standard browser-supported images (PNG, JPG, WEBP, BMP, SVG, GIF)
    const src = window.electronAPI?.toAssetUrl
      ? window.electronAPI.toAssetUrl(asset.path)
      : asset.path;

    const img = await loadHtmlImage(src);
    const result = {
      url: src,
      width: img.naturalWidth || img.width || 1920,
      height: img.naturalHeight || img.height || 1080,
      isBlob: false,
      format: ext.replace('.', '').toUpperCase()
    };
    imageCache.set(path, result);
    return result;
  } catch (err) {
    console.error(`Failed to decode image asset: ${path}`, err);
    return {
      url: window.electronAPI?.toAssetUrl ? window.electronAPI.toAssetUrl(asset.path) : asset.path,
      width: 1920,
      height: 1080,
      isBlob: false,
      format: ext.replace('.', '').toUpperCase(),
      error: err.message || 'Failed to decode image'
    };
  }
}

/**
 * Helper to load standard HTML Image to determine dimensions
 */
function loadHtmlImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('Image failed to load: ' + src));
    img.src = src;
  });
}

/**
 * Reads array buffer from electron API or fetch
 */
async function fetchAssetBuffer(asset) {
  if (window.electronAPI?.readFileBuffer) {
    const buf = await window.electronAPI.readFileBuffer(asset.path);
    if (buf) {
      if (buf instanceof ArrayBuffer) return buf;
      if (ArrayBuffer.isView(buf)) {
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      }
      if (buf.data) return new Uint8Array(buf.data).buffer;
      return new Uint8Array(buf).buffer;
    }
  }

  const url = window.electronAPI?.toAssetUrl ? window.electronAPI.toAssetUrl(asset.path) : asset.path;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} reading asset`);
  return await res.arrayBuffer();
}

/**
 * Decodes TIFF or TGA files to Canvas Blob URL
 */
async function decodeTextureFile(asset, ext) {
  if (typeof window !== 'undefined') window.log = console.log;
  if (typeof globalThis !== 'undefined') globalThis.log = console.log;

  const arrayBuf = await fetchAssetBuffer(asset);
  let parsed = null;

  if (ext === '.tga') {
    const { TGALoader } = await import('three/addons/loaders/TGALoader.js');
    parsed = new TGALoader().parse(arrayBuf);
  } else {
    // Try UTIF first
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
    } catch (e) {
      console.warn('UTIF failed, trying TIFFLoader fallback:', e);
    }

    if (!parsed || !parsed.data) {
      const { TIFFLoader } = await import('three/addons/loaders/TIFFLoader.js');
      parsed = new TIFFLoader().parse(arrayBuf);
    }
  }

  if (!parsed || !parsed.data) {
    throw new Error('Texture data could not be parsed');
  }

  const canvas = document.createElement('canvas');
  canvas.width = parsed.width;
  canvas.height = parsed.height;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(parsed.width, parsed.height);

  const totalPixels = parsed.width * parsed.height;
  if (parsed.data.length === totalPixels * 4) {
    imgData.data.set(parsed.data);
  } else if (parsed.data.length === totalPixels) {
    for (let i = 0; i < totalPixels; i++) {
      const v = parsed.data[i];
      imgData.data[i * 4] = v;
      imgData.data[i * 4 + 1] = v;
      imgData.data[i * 4 + 2] = v;
      imgData.data[i * 4 + 3] = 255;
    }
  } else if (parsed.data.length >= totalPixels * 3) {
    for (let i = 0; i < totalPixels; i++) {
      imgData.data[i * 4] = parsed.data[i * 3];
      imgData.data[i * 4 + 1] = parsed.data[i * 3 + 1];
      imgData.data[i * 4 + 2] = parsed.data[i * 3 + 2];
      imgData.data[i * 4 + 3] = 255;
    }
  } else {
    imgData.data.set(parsed.data.subarray(0, imgData.data.length));
  }

  ctx.putImageData(imgData, 0, 0);

  const blobUrl = await new Promise((resolve) => {
    canvas.toBlob((b) => {
      resolve(b ? URL.createObjectURL(b) : null);
    }, 'image/png');
  });

  return {
    url: blobUrl,
    width: parsed.width,
    height: parsed.height,
    isBlob: true,
    format: ext.replace('.', '').toUpperCase()
  };
}

/**
 * Decodes HDR or EXR files with ACES filmic tone mapping to Canvas Blob URL
 */
async function decodeHdrExrFile(asset, ext) {
  const arrayBuf = await fetchAssetBuffer(asset);
  let parsed = null;

  if (ext === '.hdr') {
    parsed = new RGBELoader().parse(arrayBuf);
  } else {
    parsed = new EXRLoader().parse(arrayBuf);
    if (parsed) parsed.isExr = true;
  }

  if (!parsed || !parsed.data) {
    throw new Error('HDR/EXR data could not be parsed');
  }

  const w = parsed.width;
  const h = parsed.height;
  const data = parsed.data;
  const isHalf = parsed.type === THREE.HalfFloatType;
  const isExr = !!parsed.isExr;

  // Auto exposure calculation
  let sampleSum = 0;
  let sampleCount = 0;
  const step = Math.max(1, Math.floor((w * h) / 20000));
  for (let i = 0; i < w * h; i += step) {
    const idx = i * 4;
    const r = toFloat(data[idx], isHalf);
    const g = toFloat(data[idx + 1], isHalf);
    const b = toFloat(data[idx + 2], isHalf);
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

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(w, h);
  const out = imgData.data;

  for (let y = 0; y < h; y++) {
    // Invert Y for EXR scanlines so upright
    const srcY = isExr ? h - 1 - y : y;

    for (let x = 0; x < w; x++) {
      const srcIdx = (srcY * w + x) * 4;
      const dstIdx = (y * w + x) * 4;

      const r = toFloat(data[srcIdx], isHalf) * exposureMult;
      const g = toFloat(data[srcIdx + 1], isHalf) * exposureMult;
      const b = toFloat(data[srcIdx + 2], isHalf) * exposureMult;

      out[dstIdx] = acesFilmic(r);
      out[dstIdx + 1] = acesFilmic(g);
      out[dstIdx + 2] = acesFilmic(b);
      out[dstIdx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);

  const blobUrl = await new Promise((resolve) => {
    canvas.toBlob((b) => {
      resolve(b ? URL.createObjectURL(b) : null);
    }, 'image/png');
  });

  return {
    url: blobUrl,
    width: w,
    height: h,
    isBlob: true,
    format: ext.replace('.', '').toUpperCase()
  };
}
