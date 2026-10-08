/**
 * Canvas helpers for the .tx / .tex viewer: channel views and the "as the renderer sees it" preview.
 */

export const CHANNEL_MODES = ['rgb', 'r', 'g', 'b', 'a'];

/**
 * Returns RGBA8 for the chosen channel view. The input is never modified unless `inPlace` is set.
 * 'rgb' shows the colour without transparency; 'r' / 'g' / 'b' / 'a' show that channel as greyscale.
 */
export function applyChannel(src, mode, inPlace = false) {
  const out = inPlace ? src : new Uint8ClampedArray(src.length);
  const n = src.length;
  if (mode === 'rgb') {
    if (!inPlace) out.set(src);
    for (let i = 3; i < n; i += 4) out[i] = 255;
    return out;
  }
  const c = mode === 'r' ? 0 : mode === 'g' ? 1 : mode === 'b' ? 2 : 3;
  for (let i = 0; i < n; i += 4) {
    const v = src[i + c];
    out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255;
  }
  return out;
}

export function rgbaToCanvas(rgba, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
}

/**
 * Paints the object as it lands on the pixels of the final render.
 *
 * Coordinates are in *render pixels* with (0, 0) at the centre of the frame: the frame is
 * frameW x frameH, the object is `objW` wide (`objH` tall) in the middle of it, and the texture repeats
 * `repeats` times across it. The window shows `winW x winH` render pixels around (viewX, viewY);
 * the canvas is exactly that big, so one canvas pixel is one render pixel. The caller scales it up
 * without smoothing to make single pixels visible.
 *
 * The mip levels in `pick` are blended like a renderer's trilinear filter does.
 */
export async function paintRenderPreview({ reader, mips, canvas, winW, winH, viewX, viewY, frameW, frameH, objW, objH, repeats, pick, channel, signal }) {
  canvas.width = winW;
  canvas.height = winH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalAlpha = 1;

  // Outside the frame, then the frame itself
  ctx.fillStyle = '#080808';
  ctx.fillRect(0, 0, winW, winH);
  const fx0 = winW / 2 + (-frameW / 2 - viewX);
  const fy0 = winH / 2 + (-frameH / 2 - viewY);
  ctx.fillStyle = '#242424';
  ctx.fillRect(fx0, fy0, frameW, frameH);

  const copyW = objW / repeats;
  const copyH = objH / repeats;
  const originX = winW / 2 + (-objW / 2 - viewX);
  const originY = winH / 2 + (-objH / 2 - viewY);

  // Copies that touch the window
  const i0 = Math.max(0, Math.floor((0 - originX) / copyW));
  const i1 = Math.min(repeats - 1, Math.floor((winW - originX) / copyW));
  const j0 = Math.max(0, Math.floor((0 - originY) / copyH));
  const j1 = Math.min(repeats - 1, Math.floor((winH - originY) / copyH));

  const layers = [{ level: pick.lower, alpha: 1 }];
  if (pick.upper !== pick.lower && pick.mix > 0.004) layers.push({ level: pick.upper, alpha: pick.mix });

  let decodedPixels = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const cx = originX + i * copyW; // top-left of this copy in window pixels
      const cy = originY + j * copyH;
      // part of the copy inside the window (in window px)
      const vx0 = Math.max(0, cx);
      const vy0 = Math.max(0, cy);
      const vx1 = Math.min(winW, cx + copyW);
      const vy1 = Math.min(winH, cy + copyH);
      if (vx1 <= vx0 || vy1 <= vy0) continue;

      for (const layer of layers) {
        if (signal && signal.cancelled) return null;
        const lv = mips[layer.level];
        const sx = lv.width / copyW; // level texels per render pixel
        const sy = lv.height / copyH;
        const region = await reader.decodeRegion(lv.index, (vx0 - cx) * sx - 1, (vy0 - cy) * sy - 1, (vx1 - vx0) * sx + 2, (vy1 - vy0) * sy + 2, signal);
        if (region.width === 0 || region.height === 0) continue;
        decodedPixels += region.width * region.height;
        const shown = applyChannel(region.rgba, channel, true);
        const tmp = rgbaToCanvas(shown, region.width, region.height);
        ctx.globalAlpha = layer.alpha;
        ctx.drawImage(tmp, cx + region.x / sx, cy + region.y / sy, region.width / sx, region.height / sy);
      }
    }
  }
  ctx.globalAlpha = 1;
  return { decodedPixels };
}
