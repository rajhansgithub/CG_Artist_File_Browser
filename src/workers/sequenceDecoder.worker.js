/**
 * Frame decoder for image sequence playback. Runs in a Web Worker so reading and decoding a frame
 * (an EXR can take 100+ ms) never blocks the UI thread. One message in, one message out:
 *
 *   in : { id, url, ext, exposure?, buffer? }   url = asset URL of the frame; buffer = file bytes when the
 *                                               caller already read them (fallback if fetching the URL fails)
 *   out: { id, ok: true, bitmap, width, height, exposure? }   bitmap is an ImageBitmap (transferred, not copied)
 *        { id, ok: false, error, fetchFailed? }
 *
 * HDR / EXR frames are tone mapped the way the still image viewer does it (ACES filmic after an
 * auto exposure). The exposure is measured on the first frame the caller decodes and passed back in for
 * every other frame, so a sequence does not flicker as the picture content changes.
 */
import { FloatType } from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EXRLoader } from '../utils/exrLoaderExtended.js';
import { decodeTiffToRGBA } from '../utils/tiffDecoder';

// Some bundled decoders (UTIF) look for `window`
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
};

// ACES filmic as a lookup table: linear value (0..32, 1/1024 steps) -> 0..255
const LUT_SCALE = 1024;
const LUT_SIZE = 32 * LUT_SCALE;
const acesLut = (() => {
  const lut = new Uint8ClampedArray(LUT_SIZE);
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  for (let i = 0; i < LUT_SIZE; i++) {
    const x = i / LUT_SCALE;
    lut[i] = Math.round(Math.min(1, Math.max(0, (x * (a * x + b)) / (x * (c * x + d) + e))) * 255);
  }
  return lut;
})();

function toneMap(v) {
  const i = v * LUT_SCALE;
  if (!(i > 0)) return 0; // negative, zero and NaN
  return i >= LUT_SIZE ? 255 : acesLut[i | 0];
}

// Same measurement as the still image viewer: scale the picture so its average luminance lands on 18% grey
function measureExposure(data, pixelCount) {
  let sum = 0;
  let count = 0;
  const step = Math.max(1, Math.floor(pixelCount / 20000));
  for (let i = 0; i < pixelCount; i += step) {
    const idx = i * 4;
    const lum = 0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2];
    if (lum > 0.0001 && isFinite(lum)) {
      sum += lum;
      count++;
    }
  }
  if (count === 0) return 1;
  const avg = sum / count;
  return avg > 0.00001 ? Math.min(32, Math.max(0.05, 0.18 / avg)) : 1;
}

function toneMapToImageData(parsed, flipRows, exposure) {
  const { width: w, height: h, data } = parsed;
  const mult = typeof exposure === 'number' ? exposure : measureExposure(data, w * h);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = (flipRows ? h - 1 - y : y) * w * 4;
    const dst = y * w * 4;
    for (let x = 0; x < w * 4; x += 4) {
      out[dst + x] = toneMap(data[src + x] * mult);
      out[dst + x + 1] = toneMap(data[src + x + 1] * mult);
      out[dst + x + 2] = toneMap(data[src + x + 2] * mult);
      out[dst + x + 3] = 255;
    }
  }
  return { image: new ImageData(out, w, h), exposure: mult };
}

function rgbaToImageData(width, height, data) {
  const total = width * height;
  if (data.length === total * 4) {
    return new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width, height);
  }
  const out = new Uint8ClampedArray(total * 4);
  if (data.length === total) {
    for (let i = 0; i < total; i++) {
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = data[i];
      out[i * 4 + 3] = 255;
    }
  } else {
    for (let i = 0; i < total; i++) {
      out[i * 4] = data[i * 3];
      out[i * 4 + 1] = data[i * 3 + 1];
      out[i * 4 + 2] = data[i * 3 + 2];
      out[i * 4 + 3] = 255;
    }
  }
  return new ImageData(out, width, height);
}

async function readBytes({ url, buffer }) {
  if (buffer) return buffer;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    const e = new Error(`Could not read the frame (${err.message || err})`);
    e.fetchFailed = true;
    throw e;
  }
  if (!res.ok) {
    const e = new Error(`Could not read the frame (HTTP ${res.status})`);
    e.fetchFailed = true;
    throw e;
  }
  return res.arrayBuffer();
}

async function decode(msg) {
  const ext = (msg.ext || '').toLowerCase();

  if (MIME[ext]) {
    const bytes = await readBytes(msg);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: MIME[ext] }));
    return { bitmap, width: bitmap.width, height: bitmap.height };
  }

  const bytes = await readBytes(msg);
  let image;
  let exposure;

  if (ext === '.exr') {
    const loader = new EXRLoader();
    loader.setDataType(FloatType);
    ({ image, exposure } = toneMapToImageData(loader.parse(bytes), true, msg.exposure));
  } else if (ext === '.hdr') {
    const loader = new RGBELoader();
    loader.setDataType(FloatType);
    ({ image, exposure } = toneMapToImageData(loader.parse(bytes), false, msg.exposure));
  } else if (ext === '.tif' || ext === '.tiff') {
    const parsed = await decodeTiffToRGBA(bytes);
    if (!parsed || !parsed.data) throw new Error('This TIFF has no readable image');
    image = rgbaToImageData(parsed.width, parsed.height, parsed.data);
  } else if (ext === '.tga') {
    const { TGALoader } = await import('three/addons/loaders/TGALoader.js');
    const parsed = new TGALoader().parse(bytes);
    if (!parsed || !parsed.data) throw new Error('This TGA has no readable image');
    image = rgbaToImageData(parsed.width, parsed.height, parsed.data);
  } else {
    throw new Error(`Unsupported frame format ${ext}`);
  }

  const bitmap = await createImageBitmap(image);
  return { bitmap, width: image.width, height: image.height, exposure };
}

self.onmessage = async (event) => {
  const msg = event.data;
  try {
    const result = await decode(msg);
    self.postMessage({ id: msg.id, ok: true, ...result }, [result.bitmap]);
  } catch (err) {
    self.postMessage({
      id: msg.id,
      ok: false,
      error: String(err?.message || err),
      fetchFailed: !!err?.fetchFailed
    });
  }
};
