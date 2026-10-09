/**
 * Reader for Arnold ".tx" and RenderMan ".tex" texture files.
 *
 * Both are ordinary TIFF files (classic or BigTIFF) in which every mip level is its own image
 * (IFD), stored as tiles (usually 64x64, deflate or LZW compressed). Pixar adds a few private tags
 * (texture format, wrap modes, ...) and OpenImageIO's maketx writes its own notes into the
 * ImageDescription tag. Nothing here needs a dependency except fflate (already bundled with three)
 * for deflate.
 *
 * Because every level is a separate set of tiles, a level - or just a small region of it - can be decoded
 * without touching the rest of the file. The sharpness preview relies on that to look at 8K textures
 * pixel for pixel without holding them in memory.
 *
 * Not supported (reported with a readable message instead): PixarLog / Pixar "lossless" compression, JPEG
 * compression, palette / CMYK / YCbCr data, 1-bit and 12-bit samples, and files that are OpenEXR inside.
 */
import { unzlibSync } from 'three/addons/libs/fflate.module.js';

export class TxTexError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TxTexError';
    this.code = code;
  }
}

const TAG = {
  NEW_SUBFILE_TYPE: 254,
  WIDTH: 256,
  HEIGHT: 257,
  BITS: 258,
  COMPRESSION: 259,
  PHOTOMETRIC: 262,
  DESCRIPTION: 270,
  STRIP_OFFSETS: 273,
  SAMPLES: 277,
  ROWS_PER_STRIP: 278,
  STRIP_COUNTS: 279,
  PLANAR: 284,
  SOFTWARE: 305,
  PREDICTOR: 317,
  TILE_W: 322,
  TILE_H: 323,
  TILE_OFFSETS: 324,
  TILE_COUNTS: 325,
  EXTRA_SAMPLES: 338,
  SAMPLE_FORMAT: 339,
  PIXAR_TEXTURE_FORMAT: 33302,
  PIXAR_WRAP_MODES: 33303,
  PIXAR_FOV_COT: 33304
};

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8, 17: 8, 18: 8 };

const COMPRESSION_NAMES = {
  1: 'None',
  5: 'LZW',
  6: 'JPEG (old)',
  7: 'JPEG',
  8: 'Deflate',
  32773: 'PackBits',
  32946: 'Deflate',
  32908: 'Pixar Film',
  32909: 'PixarLog'
};

// Largest single level that may be decoded in one go (pixels). Anything bigger is read through
// decodeLevelReduced / decodeRegion only.
const MAX_REGION_PIXELS = 16 * 1024 * 1024;

/* ------------------------------------------------------------------ container detection */

/**
 * Looks at the first bytes of the file.
 * @returns {'tiff'|'bigtiff'|'exr'|'unknown'}
 */
export function sniffContainer(arrayBuffer) {
  const b = new Uint8Array(arrayBuffer, 0, Math.min(8, arrayBuffer.byteLength));
  if (b.length < 4) return 'unknown';
  const le = b[0] === 0x49 && b[1] === 0x49;
  const be = b[0] === 0x4d && b[1] === 0x4d;
  if (le || be) {
    const magic = le ? b[2] | (b[3] << 8) : (b[2] << 8) | b[3];
    if (magic === 42) return 'tiff';
    if (magic === 43) return 'bigtiff';
  }
  if (b[0] === 0x76 && b[1] === 0x2f && b[2] === 0x31 && b[3] === 0x01) return 'exr';
  return 'unknown';
}

/* ------------------------------------------------------------------ TIFF structure parsing */

function parseIfds(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const len = arrayBuffer.byteLength;
  const little = view.getUint8(0) === 0x49;
  const big = view.getUint16(2, little) === 43;

  const u16 = (o) => view.getUint16(o, little);
  const u32 = (o) => view.getUint32(o, little);
  const u64 = (o) => {
    const lo = little ? u32(o) : u32(o + 4);
    const hi = little ? u32(o + 4) : u32(o);
    return hi * 4294967296 + lo;
  };
  const offsetAt = big ? u64 : u32;
  const ptrSize = big ? 8 : 4;

  function readValues(type, count, valueOffset) {
    const size = TYPE_SIZE[type];
    if (!size) return null;
    const total = size * count;
    let o = valueOffset;
    if (total > ptrSize) {
      o = offsetAt(valueOffset);
      if (o + total > len) throw new TxTexError('truncated', 'The file ends before all of its data (it may be incomplete or still being written).');
    }
    if (type === 2) {
      let s = '';
      for (let i = 0; i < count; i++) {
        const c = view.getUint8(o + i);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s;
    }
    const out = new Array(count);
    for (let i = 0; i < count; i++) {
      const p = o + i * size;
      switch (type) {
        case 1: case 7: out[i] = view.getUint8(p); break;
        case 6: out[i] = view.getInt8(p); break;
        case 3: out[i] = u16(p); break;
        case 8: out[i] = view.getInt16(p, little); break;
        case 4: case 13: out[i] = u32(p); break;
        case 9: out[i] = view.getInt32(p, little); break;
        case 16: case 18: out[i] = u64(p); break;
        case 17: out[i] = u64(p); break;
        case 11: out[i] = view.getFloat32(p, little); break;
        case 12: out[i] = view.getFloat64(p, little); break;
        case 5: { const d = u32(p + 4); out[i] = d ? u32(p) / d : 0; break; }
        case 10: { const d = view.getInt32(p + 4, little); out[i] = d ? view.getInt32(p, little) / d : 0; break; }
        default: out[i] = 0;
      }
    }
    return out;
  }

  const ifds = [];
  const seen = new Set();
  let next = big ? u64(8) : u32(4);
  if (!next || next >= len) {
    throw new TxTexError('truncated', 'The file ends before its image directory (it may be incomplete or still being written).');
  }
  while (next && next < len && !seen.has(next) && ifds.length < 64) {
    seen.add(next);
    let count;
    let entryStart;
    if (big) {
      count = u64(next);
      entryStart = next + 8;
    } else {
      count = u16(next);
      entryStart = next + 2;
    }
    const entrySize = big ? 20 : 12;
    if (entryStart + count * entrySize + ptrSize > len) {
      if (ifds.length > 0) break; // keep the levels that were read completely
      throw new TxTexError('truncated', 'The file ends before its image directory is complete (it may be incomplete or still being written).');
    }
    const tags = {};
    for (let i = 0; i < count; i++) {
      const e = entryStart + i * entrySize;
      const tag = u16(e);
      const type = u16(e + 2);
      const n = big ? u64(e + 4) : u32(e + 4);
      const valueAt = big ? e + 12 : e + 8;
      // Offset / byte-count arrays can be big; everything else is tiny.
      const v = readValues(type, n, valueAt);
      if (v !== null) tags[tag] = v;
    }
    ifds.push({ offset: next, tags });
    next = offsetAt(entryStart + count * entrySize);
  }
  return { ifds, little };
}

function first(v, fallback) {
  if (Array.isArray(v)) return v.length ? v[0] : fallback;
  return v === undefined ? fallback : v;
}

function buildLevel(ifd, index) {
  const t = ifd.tags;
  const width = first(t[TAG.WIDTH], 0);
  const height = first(t[TAG.HEIGHT], 0);
  const spp = first(t[TAG.SAMPLES], 1);
  const bitsArr = t[TAG.BITS] || [1];
  const bits = bitsArr[0];
  const sampleFormatArr = t[TAG.SAMPLE_FORMAT] || [1];
  const sampleFormat = sampleFormatArr[0];
  const compression = first(t[TAG.COMPRESSION], 1);
  const photometric = first(t[TAG.PHOTOMETRIC], 1);
  const planar = first(t[TAG.PLANAR], 1);
  const predictor = first(t[TAG.PREDICTOR], 1);
  const tiled = t[TAG.TILE_W] !== undefined && t[TAG.TILE_H] !== undefined;
  const rowsPerStrip = Math.min(height, first(t[TAG.ROWS_PER_STRIP], height) || height);
  const tileWidth = tiled ? first(t[TAG.TILE_W], 0) : width;
  const tileHeight = tiled ? first(t[TAG.TILE_H], 0) : rowsPerStrip;
  const offsets = (tiled ? t[TAG.TILE_OFFSETS] : t[TAG.STRIP_OFFSETS]) || [];
  const counts = (tiled ? t[TAG.TILE_COUNTS] : t[TAG.STRIP_COUNTS]) || [];

  const level = {
    index,
    width,
    height,
    samplesPerPixel: spp,
    bitsPerSample: bits,
    sampleFormat,
    compression,
    compressionName: COMPRESSION_NAMES[compression] || `type ${compression}`,
    photometric,
    planar,
    predictor,
    tiled,
    tileWidth,
    tileHeight,
    offsets,
    counts,
    extraSamples: t[TAG.EXTRA_SAMPLES] || [],
    newSubfileType: first(t[TAG.NEW_SUBFILE_TYPE], 0),
    unsupported: null
  };

  let storedBytes = 0;
  for (const c of counts) storedBytes += c;
  level.storedBytes = storedBytes;

  // Why this level cannot be decoded (the file can still be listed and described).
  if (!width || !height || !tileWidth || !tileHeight) {
    level.unsupported = 'This level has no usable size.';
  } else if (bitsArr.some((b) => b !== bits)) {
    level.unsupported = 'The colour channels use different bit depths, which is not supported.';
  } else if (![8, 16, 32].includes(bits) || (bits === 32 && sampleFormat !== 3 && sampleFormat !== 1)) {
    level.unsupported = `${bits}-bit ${sampleFormat === 3 ? 'floating point' : ''} samples are not supported.`.replace('  ', ' ');
  } else if (sampleFormat === 3 && bits === 8) {
    level.unsupported = '8-bit floating point samples are not supported.';
  } else if (sampleFormat === 2) {
    level.unsupported = 'Signed integer samples are not supported.';
  } else if (![0, 1, 2].includes(photometric)) {
    level.unsupported = 'Only greyscale and RGB textures are supported (this one uses palette, CMYK or YCbCr colour).';
  } else if (![1, 5, 8, 32946, 32773].includes(compression)) {
    if (compression === 32909 || compression === 32908) {
      level.unsupported = 'This texture uses Pixar’s own compression, which this viewer cannot read yet. Re-export it from txmake with LZW (-format tiff) or from maketx.';
    } else if (compression === 7 || compression === 6) {
      level.unsupported = 'This texture uses JPEG compression, which is not supported.';
    } else {
      level.unsupported = `Compression type ${compression} is not supported.`;
    }
  } else if (predictor !== 1 && predictor !== 2 && predictor !== 3) {
    level.unsupported = `Predictor ${predictor} is not supported.`;
  } else if (predictor === 3 && sampleFormat !== 3) {
    level.unsupported = 'A floating point predictor on non-floating point data is not supported.';
  } else if (planar !== 1 && planar !== 2) {
    level.unsupported = 'Unknown channel layout.';
  } else if (offsets.length === 0 || offsets.length !== counts.length) {
    level.unsupported = 'The tile table of this level is missing or damaged.';
  }

  const tilesAcross = tileWidth ? Math.ceil(width / tileWidth) : 0;
  const tilesDown = tileHeight ? Math.ceil(height / tileHeight) : 0;
  level.tilesAcross = tilesAcross;
  level.tilesDown = tilesDown;
  const perPlane = tilesAcross * tilesDown;
  if (!level.unsupported && offsets.length < perPlane * (planar === 2 ? spp : 1)) {
    level.unsupported = 'The tile table of this level is incomplete.';
  }
  level.tilesPerPlane = perPlane;
  return level;
}

function parseKeyValueNotes(description) {
  // OpenImageIO writes "oiio:SHA-1=... oiio:AverageColor=r,g,b ..." (and sometimes "oiio:ConstantColor=...").
  const notes = {};
  if (!description) return notes;
  const re = /(oiio:[A-Za-z0-9_-]+)=([^\s]+)/g;
  let m;
  while ((m = re.exec(description)) !== null) notes[m[1]] = m[2];
  return notes;
}

/**
 * Reads the structure of a .tx / .tex file (no pixels are decoded).
 * @param {ArrayBuffer} arrayBuffer
 * @param {string} extension '.tx' or '.tex'
 * @returns {{ levels: object[], mips: object[], info: object }}
 * @throws {TxTexError} when the file is not a texture this viewer can open at all
 */
export function parseTxTex(arrayBuffer, extension = '') {
  const ext = String(extension || '').toLowerCase();
  if (!arrayBuffer || arrayBuffer.byteLength < 16) {
    throw new TxTexError('empty', 'This file is empty or too small to be a texture.');
  }
  const container = sniffContainer(arrayBuffer);
  if (container === 'exr') {
    throw new TxTexError(
      'exr',
      'This texture is stored as OpenEXR inside. Mip levels inside EXR texture files cannot be opened yet. Re-export it as a TIFF-based texture (maketx writes TIFF for .tx; txmake -format tiff for .tex).'
    );
  }
  if (container === 'unknown') {
    if (ext === '.tex') {
      throw new TxTexError(
        'not-tiff',
        'This does not look like a RenderMan texture. A “.tex” file can also be a LaTeX document, or a texture in Pixar’s own format that this viewer cannot read yet (txmake -format pixar).'
      );
    }
    throw new TxTexError('not-tiff', 'This does not look like a valid Arnold .tx texture (it is not a TIFF-based file).');
  }

  const { ifds, little } = parseIfds(arrayBuffer);
  if (ifds.length === 0) throw new TxTexError('empty', 'This texture contains no images.');

  const levels = ifds.map((ifd, i) => buildLevel(ifd, i));
  const t0 = ifds[0].tags;
  const description = typeof t0[TAG.DESCRIPTION] === 'string' ? t0[TAG.DESCRIPTION] : '';
  const software = typeof t0[TAG.SOFTWARE] === 'string' ? t0[TAG.SOFTWARE] : '';
  const notes = parseKeyValueNotes(description);
  const textureFormat = typeof t0[TAG.PIXAR_TEXTURE_FORMAT] === 'string' ? t0[TAG.PIXAR_TEXTURE_FORMAT] : '';
  const wrapModes = typeof t0[TAG.PIXAR_WRAP_MODES] === 'string' ? t0[TAG.PIXAR_WRAP_MODES] : '';

  // Mip pyramid = the levels that keep the proportions of level 0 (a RenderMan ripmap also stores
  // squashed variants, which are not part of the normal pyramid).
  const w0 = levels[0].width;
  const h0 = levels[0].height;
  const mips = [];
  for (const lv of levels) {
    if (lv.index === 0) { mips.push(lv); continue; }
    const prev = mips[mips.length - 1];
    const sameShape = Math.abs(lv.width * h0 - w0 * lv.height) <= Math.max(w0, h0);
    if (sameShape && lv.width <= prev.width && lv.height <= prev.height && (lv.width < prev.width || lv.height < prev.height)) {
      mips.push(lv);
    }
  }

  const madeWith = /OpenImageIO/i.test(software) || Object.keys(notes).length > 0 ? 'OpenImageIO maketx' : '';

  const info = {
    container,
    littleEndian: little,
    madeWith,
    software,
    textureFormat,
    wrapModes,
    averageColor: notes['oiio:AverageColor'] || '',
    constantColor: notes['oiio:ConstantColor'] || '',
    levelCount: mips.length,
    totalIfds: levels.length,
    hasMipmaps: mips.length > 1,
    isPlainTexture: !textureFormat || /plain/i.test(textureFormat),
    channels: levels[0].samplesPerPixel,
    hasAlpha: levelHasAlpha(levels[0]),
    isFloat: levels[0].sampleFormat === 3,
    bitsPerChannel: levels[0].bitsPerSample,
    tileWidth: levels[0].tiled ? levels[0].tileWidth : 0,
    tileHeight: levels[0].tiled ? levels[0].tileHeight : 0,
    compression: levels[0].compressionName,
    fileBytes: arrayBuffer.byteLength
  };

  return { levels, mips, info };
}

export function levelHasAlpha(level) {
  const spp = level.samplesPerPixel;
  if (level.photometric === 2) return spp >= 4;
  return spp === 2 || spp >= 4;
}

/* ------------------------------------------------------------------ decompression */

function lzwDecode(src, outLen) {
  const out = new Uint8Array(outLen);
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const length = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) { suffix[i] = i; length[i] = 1; prefix[i] = -1; }

  let width = 9;
  let nextCode = 258;
  let bitBuf = 0;
  let bitCount = 0;
  let pos = 0;
  let o = 0;
  let old = -1;

  const writeString = (code) => {
    // Writes the string for `code` at out[o...], backwards from the end, and returns its first byte.
    const n = length[code];
    let p = o + n;
    let c = code;
    let firstByte = 0;
    while (c >= 0) {
      p--;
      if (p < outLen) out[p] = suffix[c];
      firstByte = suffix[c];
      c = prefix[c];
    }
    o += n;
    return firstByte;
  };

  while (o < outLen) {
    while (bitCount < width && pos < src.length) {
      bitBuf = (bitBuf << 8) | src[pos++];
      bitCount += 8;
    }
    if (bitCount < width) break;
    const code = (bitBuf >>> (bitCount - width)) & ((1 << width) - 1);
    bitCount -= width;
    bitBuf &= (1 << bitCount) - 1;

    if (code === 257) break;
    if (code === 256) {
      width = 9;
      nextCode = 258;
      old = -1;
      continue;
    }
    if (old === -1) {
      if (code > 255) break;
      out[o++] = code;
      old = code;
      continue;
    }
    let firstByte;
    if (code < nextCode) {
      firstByte = writeString(code);
    } else if (code === nextCode) {
      // Code not in the table yet: previous string followed by its own first byte
      let fb = 0;
      for (let c = old; c >= 0; c = prefix[c]) fb = suffix[c];
      writeString(old);
      if (o < outLen) out[o] = fb;
      o++;
      firstByte = fb;
    } else {
      break; // corrupt stream
    }
    if (nextCode < 4096) {
      prefix[nextCode] = old;
      suffix[nextCode] = firstByte;
      length[nextCode] = length[old] + 1;
      nextCode++;
      if (nextCode >= (1 << width) - 1 && width < 12) width++;
    }
    old = code;
  }
  return out;
}

function packBitsDecode(src, outLen) {
  const out = new Uint8Array(outLen);
  let i = 0;
  let o = 0;
  while (i < src.length && o < outLen) {
    const n = (src[i++] << 24) >> 24;
    if (n >= 0) {
      const c = n + 1;
      for (let k = 0; k < c && o < outLen; k++) out[o++] = src[i++];
    } else if (n !== -128) {
      const c = 1 - n;
      const v = src[i++];
      for (let k = 0; k < c && o < outLen; k++) out[o++] = v;
    }
  }
  return out;
}

function decompress(level, bytes, expected) {
  switch (level.compression) {
    case 1: {
      if (bytes.length >= expected) return bytes.subarray(0, expected);
      const out = new Uint8Array(expected);
      out.set(bytes);
      return out;
    }
    case 5: return lzwDecode(bytes, expected);
    case 8:
    case 32946: {
      try {
        const out = unzlibSync(bytes, { out: new Uint8Array(expected) });
        if (out.length === expected) return out;
        const padded = new Uint8Array(expected);
        padded.set(out.subarray(0, expected));
        return padded;
      } catch (e) {
        // Output longer than expected (padded tile) still decodes if fflate is allowed to size it itself.
        const out = unzlibSync(bytes);
        const padded = new Uint8Array(expected);
        padded.set(out.subarray(0, expected));
        return padded;
      }
    }
    case 32773: return packBitsDecode(bytes, expected);
    default:
      throw new TxTexError('unsupported-compression', level.unsupported || 'Unsupported compression.');
  }
}

/* ------------------------------------------------------------------ tile -> samples */

let halfTable = null;
function getHalfTable() {
  if (halfTable) return halfTable;
  halfTable = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = (h & 0x8000) ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const m = h & 0x3ff;
    let v;
    if (e === 0) v = s * Math.pow(2, -14) * (m / 1024);
    else if (e === 31) v = m ? NaN : s * Infinity;
    else v = s * Math.pow(2, e - 15) * (1 + m / 1024);
    halfTable[h] = v;
  }
  return halfTable;
}

// sRGB display curve for float textures, 4096 steps.
let srgbTable = null;
function getSrgbTable() {
  if (srgbTable) return srgbTable;
  srgbTable = new Uint8ClampedArray(4097);
  for (let i = 0; i <= 4096; i++) {
    const x = i / 4096;
    const v = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    srgbTable[i] = Math.round(v * 255);
  }
  return srgbTable;
}

function floatToByte(x) {
  if (!(x > 0)) return 0;
  if (x >= 1) return 255;
  return getSrgbTable()[(x * 4096 + 0.5) | 0];
}

function undoPredictor(level, data, widthSamples, rows, samplesInRow, stride) {
  // `data` is a Uint8Array holding `rows` rows of `widthSamples` samples in host byte order.
  const bytes = level.bitsPerSample / 8;
  if (level.predictor === 2) {
    if (bytes === 1) {
      for (let r = 0; r < rows; r++) {
        const base = r * widthSamples;
        for (let i = stride; i < samplesInRow; i++) data[base + i] = (data[base + i] + data[base + i - stride]) & 0xff;
      }
    } else if (bytes === 2) {
      const d = new Uint16Array(data.buffer, data.byteOffset, data.byteLength >> 1);
      for (let r = 0; r < rows; r++) {
        const base = r * widthSamples;
        for (let i = stride; i < samplesInRow; i++) d[base + i] = (d[base + i] + d[base + i - stride]) & 0xffff;
      }
    } else if (bytes === 4) {
      const d = new Uint32Array(data.buffer, data.byteOffset, data.byteLength >> 2);
      for (let r = 0; r < rows; r++) {
        const base = r * widthSamples;
        for (let i = stride; i < samplesInRow; i++) d[base + i] = (d[base + i] + d[base + i - stride]) >>> 0;
      }
    }
    return data;
  }
  if (level.predictor === 3) {
    // Floating point predictor: per row, bytes are differenced and split into byte planes (most significant first).
    const rowBytes = widthSamples * bytes;
    const used = samplesInRow * bytes;
    const out = new Uint8Array(data.length);
    const tmp = new Uint8Array(used);
    for (let r = 0; r < rows; r++) {
      const base = r * rowBytes;
      for (let i = stride; i < used; i++) data[base + i] = (data[base + i] + data[base + i - stride]) & 0xff;
      tmp.set(data.subarray(base, base + used));
      for (let s = 0; s < samplesInRow; s++) {
        for (let b = 0; b < bytes; b++) {
          out[base + s * bytes + b] = tmp[(bytes - b - 1) * samplesInRow + s];
        }
      }
    }
    return out;
  }
  return data;
}

/**
 * Decodes one tile (or strip) of one colour plane into host-order samples.
 * @returns {{ data: Uint8Array, rows: number, tileW: number }}
 */
function decodeTilePlane(arrayBuffer, level, little, tileIndex, plane) {
  const spp = level.planar === 2 ? 1 : level.samplesPerPixel;
  const bytes = level.bitsPerSample / 8;
  const tx = tileIndex % level.tilesAcross;
  const ty = Math.floor(tileIndex / level.tilesAcross);
  const tileW = level.tileWidth;
  const rows = level.tiled ? level.tileHeight : Math.min(level.tileHeight, level.height - ty * level.tileHeight);
  const widthSamples = tileW * spp;
  const expected = widthSamples * rows * bytes;

  const k = plane * level.tilesPerPlane + tileIndex;
  const off = level.offsets[k];
  const cnt = level.counts[k];
  if (off === undefined || off + cnt > arrayBuffer.byteLength) {
    throw new TxTexError('truncated', 'The file ends before all of its tiles (it may be incomplete or still being written).');
  }
  let data;
  if (cnt === 0) {
    data = new Uint8Array(expected);
  } else {
    data = decompress(level, new Uint8Array(arrayBuffer, off, cnt), expected);
    // Work on a private, aligned copy when the bytes alias the file or an offset view.
    if (data.byteOffset % 4 !== 0 || data.buffer === arrayBuffer) data = new Uint8Array(data);
  }

  const swapNeeded = bytes > 1 && !little && level.predictor !== 3;
  if (swapNeeded) {
    if (bytes === 2) {
      for (let i = 0; i + 1 < data.length; i += 2) { const t = data[i]; data[i] = data[i + 1]; data[i + 1] = t; }
    } else {
      for (let i = 0; i + 3 < data.length; i += 4) {
        const a = data[i]; const b = data[i + 1];
        data[i] = data[i + 3]; data[i + 1] = data[i + 2]; data[i + 2] = b; data[i + 3] = a;
      }
    }
  }
  if (level.predictor !== 1) {
    data = undoPredictor(level, data, widthSamples, rows, widthSamples, spp);
  }
  return { data, rows, tileW, tx, ty };
}

/**
 * Decodes one tile to display-ready RGBA8 (colours un-premultiplied, float data sRGB-encoded).
 * The array is tileW x rows pixels; pixels outside the image edge are left in place.
 */
function decodeTileRgba(arrayBuffer, level, little, tileIndex) {
  const spp = level.samplesPerPixel;
  const planes = [];
  if (level.planar === 2) {
    for (let p = 0; p < spp; p++) planes.push(decodeTilePlane(arrayBuffer, level, little, tileIndex, p));
  } else {
    planes.push(decodeTilePlane(arrayBuffer, level, little, tileIndex, 0));
  }
  const { rows, tileW, tx, ty } = planes[0];
  const out = new Uint8ClampedArray(tileW * rows * 4);

  const bits = level.bitsPerSample;
  const isFloat = level.sampleFormat === 3;
  const premult = level.extraSamples.length > 0 && level.extraSamples[0] === 1;
  const hasAlpha = levelHasAlpha(level);
  const grey = level.photometric !== 2 && spp <= 2;
  const invert = level.photometric === 0;

  // Typed views per plane
  const views = planes.map((p) => {
    const d = p.data;
    if (bits === 8) return d;
    if (bits === 16) return new Uint16Array(d.buffer, d.byteOffset, d.byteLength >> 1);
    return isFloat ? new Float32Array(d.buffer, d.byteOffset, d.byteLength >> 2) : new Uint32Array(d.buffer, d.byteOffset, d.byteLength >> 2);
  });
  const half = isFloat && bits === 16 ? getHalfTable() : null;

  // Returns the value of channel c at pixel i as 0..1 (float) or as a byte for integer data.
  const chunky = level.planar !== 2;
  const px = tileW * rows;
  const toByte = (raw) => {
    if (isFloat) return floatToByte(half ? half[raw] : raw);
    if (bits === 8) return raw;
    if (bits === 16) return (raw + 128) / 257 | 0;
    return raw >>> 24;
  };
  const toUnit = (raw) => {
    if (isFloat) return half ? half[raw] : raw;
    if (bits === 8) return raw / 255;
    if (bits === 16) return raw / 65535;
    return raw / 4294967295;
  };

  const sampleAt = (c, i) => (chunky ? views[0][i * spp + c] : views[c][i]);

  for (let i = 0; i < px; i++) {
    let r; let g; let b; let a = 255;
    if (grey) {
      r = g = b = toByte(sampleAt(0, i));
      if (invert) { r = g = b = 255 - r; }
      if (spp === 2) a = isFloat ? Math.round(Math.min(1, Math.max(0, toUnit(sampleAt(1, i)))) * 255) : toByte(sampleAt(1, i));
    } else {
      if (premult && hasAlpha && spp >= 4) {
        const au = Math.min(1, Math.max(0, toUnit(sampleAt(3, i))));
        a = Math.round(au * 255);
        if (au > 0) {
          const cr = toUnit(sampleAt(0, i)) / au;
          const cg = toUnit(sampleAt(1, i)) / au;
          const cb = toUnit(sampleAt(2, i)) / au;
          if (isFloat) { r = floatToByte(cr); g = floatToByte(cg); b = floatToByte(cb); }
          else { r = Math.round(Math.min(1, cr) * 255); g = Math.round(Math.min(1, cg) * 255); b = Math.round(Math.min(1, cb) * 255); }
        } else { r = g = b = 0; }
      } else {
        r = toByte(sampleAt(0, i));
        g = toByte(sampleAt(1, i));
        b = toByte(sampleAt(2, i));
        if (hasAlpha && spp >= 4) a = isFloat ? Math.round(Math.min(1, Math.max(0, toUnit(sampleAt(3, i)))) * 255) : toByte(sampleAt(3, i));
      }
    }
    const o = i * 4;
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
  }
  return { rgba: out, tileW, rows, tx, ty };
}

/* ------------------------------------------------------------------ public decoding API */

// Decoded tiles kept for instant slider moves, counted in bytes because tile sizes vary.
const TILE_CACHE_BYTES = 96 * 1024 * 1024;

/** A decoder bound to one file's bytes. Keeps a small cache of decoded tiles so slider moves are instant. */
export class TxTexReader {
  constructor(arrayBuffer, parsed) {
    this.buffer = arrayBuffer;
    this.parsed = parsed;
    this.little = parsed.info.littleEndian;
    this.cache = new Map();
    this.cacheBytes = 0;
  }

  level(index) {
    return this.parsed.levels[index];
  }

  _tile(levelIndex, tileIndex, useCache = true) {
    const key = levelIndex * 1e7 + tileIndex;
    if (useCache) {
      const hit = this.cache.get(key);
      if (hit) {
        this.cache.delete(key);
        this.cache.set(key, hit);
        return hit;
      }
    }
    const lv = this.parsed.levels[levelIndex];
    const tile = decodeTileRgba(this.buffer, lv, this.little, tileIndex);
    if (useCache) {
      this.cache.set(key, tile);
      this.cacheBytes += tile.rgba.byteLength;
      while (this.cacheBytes > TILE_CACHE_BYTES && this.cache.size > 1) {
        const oldest = this.cache.keys().next().value;
        this.cacheBytes -= this.cache.get(oldest).rgba.byteLength;
        this.cache.delete(oldest);
      }
    }
    return tile;
  }

  /**
   * Decodes a rectangle of one level at full resolution to RGBA8.
   * @returns {Promise<{x:number,y:number,width:number,height:number,rgba:Uint8ClampedArray}>} region clipped to the level
   */
  async decodeRegion(levelIndex, x, y, w, h, signal) {
    const lv = this.parsed.levels[levelIndex];
    if (lv.unsupported) throw new TxTexError('unsupported', lv.unsupported);
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(lv.width, Math.ceil(x + w));
    const y1 = Math.min(lv.height, Math.ceil(y + h));
    const rw = Math.max(0, x1 - x0);
    const rh = Math.max(0, y1 - y0);
    if (rw * rh > MAX_REGION_PIXELS * 4) {
      throw new TxTexError('too-large', 'That area is too large to show at full detail. Zoom in or pick a smaller level.');
    }
    const rgba = new Uint8ClampedArray(rw * rh * 4);
    if (rw === 0 || rh === 0) return { x: x0, y: y0, width: rw, height: rh, rgba };

    const tw = lv.tileWidth;
    const th = lv.tileHeight;
    const tx0 = Math.floor(x0 / tw);
    const tx1 = Math.floor((x1 - 1) / tw);
    const ty0 = Math.floor(y0 / th);
    const ty1 = Math.floor((y1 - 1) / th);
    let done = 0;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (signal && signal.cancelled) throw new TxTexError('cancelled', 'cancelled');
        const tile = this._tile(levelIndex, ty * lv.tilesAcross + tx);
        const sx0 = Math.max(x0, tx * tw);
        const sx1 = Math.min(x1, tx * tw + tile.tileW);
        const sy0 = Math.max(y0, ty * th);
        const sy1 = Math.min(y1, ty * th + tile.rows);
        for (let yy = sy0; yy < sy1; yy++) {
          const src = ((yy - ty * th) * tile.tileW + (sx0 - tx * tw)) * 4;
          const dst = ((yy - y0) * rw + (sx0 - x0)) * 4;
          rgba.set(tile.rgba.subarray(src, src + (sx1 - sx0) * 4), dst);
        }
        if (++done % 48 === 0) await new Promise((r) => setTimeout(r, 0));
      }
    }
    return { x: x0, y: y0, width: rw, height: rh, rgba };
  }

  /**
   * Decodes a whole level, averaging down by a power of two when it is larger than `maxDim`.
   * @returns {Promise<{width:number,height:number,factor:number,rgba:Uint8ClampedArray}>}
   */
  async decodeLevelReduced(levelIndex, maxDim = 4096, signal, onProgress) {
    const lv = this.parsed.levels[levelIndex];
    if (lv.unsupported) throw new TxTexError('unsupported', lv.unsupported);
    let factor = 1;
    while (Math.max(lv.width, lv.height) / factor > maxDim) factor *= 2;
    // Averaging inside a tile needs the factor to divide the tile size; strips of odd height fall back to 1:1 sampling.
    const averaged = lv.tileWidth % factor === 0 && lv.tileHeight % factor === 0;
    const ow = Math.ceil(lv.width / factor);
    const oh = Math.ceil(lv.height / factor);
    const out = new Uint8ClampedArray(ow * oh * 4);
    const total = lv.tilesAcross * lv.tilesDown;
    const useCache = factor === 1 && total <= 1024;

    for (let ti = 0; ti < total; ti++) {
      if (signal && signal.cancelled) throw new TxTexError('cancelled', 'cancelled');
      const tile = this._tile(levelIndex, ti, useCache);
      const baseX = tile.tx * lv.tileWidth;
      const baseY = tile.ty * lv.tileHeight;
      const validW = Math.min(tile.tileW, lv.width - baseX);
      const validH = Math.min(tile.rows, lv.height - baseY);
      if (factor === 1) {
        for (let yy = 0; yy < validH; yy++) {
          const src = yy * tile.tileW * 4;
          out.set(tile.rgba.subarray(src, src + validW * 4), ((baseY + yy) * ow + baseX) * 4);
        }
      } else if (averaged) {
        const bw = Math.ceil(validW / factor);
        const bh = Math.ceil(validH / factor);
        for (let by = 0; by < bh; by++) {
          for (let bx = 0; bx < bw; bx++) {
            let r = 0; let g = 0; let b = 0; let a = 0; let n = 0;
            const ys = by * factor;
            const xs = bx * factor;
            for (let yy = ys; yy < Math.min(validH, ys + factor); yy++) {
              for (let xx = xs; xx < Math.min(validW, xs + factor); xx++) {
                const s = (yy * tile.tileW + xx) * 4;
                r += tile.rgba[s]; g += tile.rgba[s + 1]; b += tile.rgba[s + 2]; a += tile.rgba[s + 3]; n++;
              }
            }
            const d = ((baseY / factor + by) * ow + (baseX / factor + bx)) * 4;
            out[d] = r / n; out[d + 1] = g / n; out[d + 2] = b / n; out[d + 3] = a / n;
          }
        }
      } else {
        for (let yy = 0; yy < validH; yy += factor) {
          for (let xx = 0; xx < validW; xx += factor) {
            const s = (yy * tile.tileW + xx) * 4;
            const d = (Math.floor((baseY + yy) / factor) * ow + Math.floor((baseX + xx) / factor)) * 4;
            out[d] = tile.rgba[s]; out[d + 1] = tile.rgba[s + 1]; out[d + 2] = tile.rgba[s + 2]; out[d + 3] = tile.rgba[s + 3];
          }
        }
      }
      if (ti % 24 === 23) {
        if (onProgress) onProgress((ti + 1) / total);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    if (onProgress) onProgress(1);
    return { width: ow, height: oh, factor, rgba: out };
  }

  clearCache() {
    this.cache.clear();
    this.cacheBytes = 0;
  }
}

/**
 * Picks the mip level to use for a small preview (thumbnail): the smallest one that is at least `minDim` wide or tall.
 */
export function pickPreviewLevel(parsed, minDim = 256) {
  const usable = parsed.mips.filter((lv) => !lv.unsupported);
  if (usable.length === 0) return null;
  let best = usable[0];
  for (const lv of usable) {
    if (Math.max(lv.width, lv.height) >= minDim) best = lv;
  }
  return best;
}
