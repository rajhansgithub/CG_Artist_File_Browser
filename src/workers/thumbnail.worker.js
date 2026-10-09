/**
 * Decodes HDR / EXR files for grid thumbnails off the UI thread. A parse of a multi-layer EXR can take
 * seconds on the main thread, which froze the whole app while a folder of renders loaded. One message in,
 * one message out:
 *
 *   in : { id, ext, buffer }   buffer = the file bytes (transferred, not copied)
 *   out: { id, ok: true, width, height, rgba }   rgba = Uint8ClampedArray of the tone-mapped thumbnail
 *        { id, ok: false, error }
 */
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EXRLoader } from '../utils/exrLoaderExtended.js';
import { toneMapToRgba } from '../utils/thumbnailToneMap.js';

self.onmessage = (event) => {
  const { id, ext, buffer } = event.data;
  try {
    let parsed = null;
    if (ext === '.hdr') {
      const loader = new RGBELoader();
      loader.type = THREE.FloatType;
      parsed = loader.parse(buffer);
      if (parsed) {
        parsed.isHdr = true;
        parsed.isExr = false;
      }
    } else {
      const loader = new EXRLoader();
      loader.setDataType(THREE.FloatType);
      parsed = loader.parse(buffer);
      if (parsed) {
        parsed.isHdr = false;
        parsed.isExr = true;
      }
    }

    if (!parsed || !parsed.data) {
      throw new Error('Failed to parse HDR/EXR image data');
    }

    const thumb = toneMapToRgba(parsed);
    if (!thumb) throw new Error('Empty HDR/EXR image');
    self.postMessage({ id, ok: true, width: thumb.width, height: thumb.height, rgba: thumb.rgba }, [thumb.rgba.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
