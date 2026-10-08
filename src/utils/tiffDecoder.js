/**
 * TIFF -> RGBA8 decoding shared by the viewer, texture decoder and thumbnail service.
 *
 * UTIF.js only understands chunky (PlanarConfiguration = 1) pixel data, where the samples of
 * each pixel are stored together (RGBRGB...). Files written with PlanarConfiguration = 2
 * (separate planes: all R, then all G, then all B) were decoded as if they were chunky, which
 * showed up as three squeezed greyscale copies of the image followed by black. Such files are
 * decoded plane by plane here and re-interleaved before the normal UTIF conversion runs.
 */

// UTIF logs through a global `log` on some code paths; make sure it exists.
function ensureUtifLog() {
  if (typeof globalThis !== 'undefined' && typeof globalThis.log !== 'function') {
    globalThis.log = console.log;
  }
}

// Decode a PlanarConfiguration = 2 IFD in place so that `ifd.data` is chunky (interleaved).
function decodePlanarIfd(UTIF, arrayBuf, ifd, ifds) {
  const spp = ifd.t277 ? ifd.t277[0] : 1;
  const bps = ifd.t258 ? Math.min(32, ifd.t258[0]) : 1;
  const tiled = ifd.t322 != null;
  const offsKey = tiled ? 't324' : 't273';
  const cntsKey = tiled ? 't325' : 't279';
  const offsets = ifd[offsKey];
  const counts = ifd[cntsKey];

  // Only byte-aligned samples can be interleaved by simple byte copying.
  if (spp < 2 || bps % 8 !== 0 || !offsets || offsets.length % spp !== 0) {
    throw new Error('Unsupported planar TIFF layout');
  }

  const perPlane = offsets.length / spp;
  const planes = [];
  for (let p = 0; p < spp; p++) {
    // Treat each plane as its own single-sample chunky image.
    const plane = { ...ifd };
    delete plane.data;
    plane.t277 = [1];
    plane.t258 = [ifd.t258[0]];
    plane.t284 = [1];
    plane[offsKey] = offsets.slice(p * perPlane, (p + 1) * perPlane);
    if (counts) plane[cntsKey] = counts.slice(p * perPlane, (p + 1) * perPlane);
    UTIF.decodeImage(arrayBuf, plane, ifds);
    if (!plane.data) throw new Error('Planar TIFF plane could not be decoded');
    planes.push(plane.data);
  }

  const sampleBytes = bps / 8;
  const pixels = ifd.width * ifd.height;
  const out = new Uint8Array(pixels * spp * sampleBytes);
  for (let p = 0; p < spp; p++) {
    const src = planes[p];
    const count = Math.min(pixels, Math.floor(src.length / sampleBytes));
    for (let i = 0; i < count; i++) {
      for (let b = 0; b < sampleBytes; b++) {
        out[(i * spp + p) * sampleBytes + b] = src[i * sampleBytes + b];
      }
    }
  }

  ifd.data = out;
  ifd.t284 = [1];
}

/**
 * Decodes the first image of a TIFF file.
 * @param {ArrayBuffer} arrayBuf
 * @returns {Promise<{width: number, height: number, data: Uint8Array} | null>} RGBA8 pixels, or null if the file has no image
 */
export async function decodeTiffToRGBA(arrayBuf) {
  ensureUtifLog();
  const { default: UTIF } = await import('three/addons/libs/utif.module.js');
  const ifds = UTIF.decode(arrayBuf);
  if (!ifds || ifds.length === 0) return null;

  const ifd = ifds[0];
  if (ifd.t284 && ifd.t284[0] === 2 && ifd.t256 && ifd.t257) {
    ifd.width = ifd.t256[0];
    ifd.height = ifd.t257[0];
    decodePlanarIfd(UTIF, arrayBuf, ifd, ifds);
  } else {
    UTIF.decodeImage(arrayBuf, ifd, ifds);
  }

  return {
    width: ifd.width,
    height: ifd.height,
    data: UTIF.toRGBA8(ifd)
  };
}
