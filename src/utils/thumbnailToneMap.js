/**
 * Float (HDR / EXR) to 8-bit thumbnail pixels: auto exposure towards middle grey, then ACES filmic and a
 * gamma 2.2 curve. Pure JavaScript with no DOM access, so it runs both on the UI thread and in the thumbnail
 * worker. The output keeps the thumbnail's aspect ratio, up to 256 px on the long side.
 */
import * as THREE from 'three';

// Convert raw number or half-float to float
export function toFloat(val, isHalfFloat) {
  if (val === undefined || val === null) return 0;
  if (isHalfFloat) {
    return THREE.DataUtils.fromHalfFloat(val);
  }
  return typeof val === 'number' && !isNaN(val) && isFinite(val) ? Math.max(0, val) : 0;
}

// ACES Filmic Tone Mapping formula
export function acesFilmic(x) {
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

// Computes thumbnail dimensions preserving aspect ratio (up to maxDim)
export function getThumbnailDimensions(width, height, maxDim = 256) {
  if (!width || !height) return { w: 256, h: 128 };
  if (width >= height) {
    const tw = maxDim;
    const th = Math.max(1, Math.round((maxDim * height) / width));
    return { w: tw, h: th };
  } else {
    const th = maxDim;
    const tw = Math.max(1, Math.round((maxDim * width) / height));
    return { w: tw, h: th };
  }
}

/**
 * `parsed` is the output of EXRLoader / RGBELoader ({ width, height, data, isExr }).
 * Returns { width, height, rgba } where rgba is a Uint8ClampedArray of width * height * 4 bytes.
 */
export function toneMapToRgba(parsed) {
  const w = parsed.width;
  const h = parsed.height;
  const { w: targetW, h: targetH } = getThumbnailDimensions(w, h);

  const data = parsed.data;
  if (!data || w <= 0 || h <= 0) return null;

  const rgba = new Uint8ClampedArray(targetW * targetH * 4);

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

      rgba[dstIdx] = acesFilmic(r);
      rgba[dstIdx + 1] = acesFilmic(g);
      rgba[dstIdx + 2] = acesFilmic(b);
      rgba[dstIdx + 3] = 255;
    }
  }

  return { width: targetW, height: targetH, rgba };
}
