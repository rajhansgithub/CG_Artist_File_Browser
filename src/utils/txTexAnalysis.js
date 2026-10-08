/**
 * The maths behind the .tx / .tex "Will it be sharp enough?" panel. No UI and no file access here.
 *
 * The idea in one picture: the render is `frameWidth` pixels wide. The object (and so the texture
 * stretched over it) covers `coverage` of that width, i.e. `footprint = frameWidth * coverage` pixels.
 * If the texture repeats `repeats` times across the object, one copy of it spans `footprint / repeats`
 * pixels. The renderer needs about one texture pixel (texel) for every render pixel:
 *
 *   texels per pixel = texture width / (pixels one copy spans on screen)
 *
 *   below 1  -> the texture is stretched over more pixels than it has: soft
 *   about 1  -> a perfect match
 *   above 1  -> more detail than the render can show: the renderer reads a smaller mip level
 */

export const RENDER_PRESETS = [
  { id: '1k', label: '1K', width: 1024 },
  { id: '2k', label: '2K', width: 2048 },
  { id: '3k', label: '3K', width: 3072 },
  { id: '4k', label: '4K', width: 4096 },
  { id: '8k', label: '8K', width: 8192 }
];

// "How much of the frame does the object cover" shortcuts (share of the frame width).
export const DISTANCE_PRESETS = [
  { id: 'speck', label: 'Tiny speck', hint: 'about 0.5% of the frame', coverage: 0.005 },
  { id: 'far', label: 'Far away', hint: 'about 3% of the frame', coverage: 0.03 },
  { id: 'mid', label: 'Mid shot', hint: 'about 15% of the frame', coverage: 0.15 },
  { id: 'close', label: 'Close-up', hint: 'about 50% of the frame', coverage: 0.5 },
  { id: 'full', label: 'Fills frame', hint: 'the whole frame width', coverage: 1 },
  { id: 'extreme', label: 'Extreme close-up', hint: '3x the frame, you only see part of it', coverage: 3 }
];

export const REPEAT_PRESETS = [1, 2, 4, 8];

export const COVERAGE_MIN = 0.001; // 0.1 % of the frame width
export const COVERAGE_MAX = 4; // 400 %

// The slider works on a log scale so that "10 pixels" and "the whole frame" are both easy to reach.
export function coverageToSlider(coverage) {
  const c = Math.min(COVERAGE_MAX, Math.max(COVERAGE_MIN, coverage));
  return Math.round((Math.log(c / COVERAGE_MIN) / Math.log(COVERAGE_MAX / COVERAGE_MIN)) * 1000);
}

export function sliderToCoverage(value) {
  return COVERAGE_MIN * Math.pow(COVERAGE_MAX / COVERAGE_MIN, Math.min(1000, Math.max(0, value)) / 1000);
}

export function formatCoverage(coverage) {
  const pct = coverage * 100;
  if (pct >= 100) return `${Math.round(pct)}%`;
  if (pct >= 10) return `${pct.toFixed(0)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(2)}%`;
}

export function formatPixels(px) {
  if (px >= 100) return `${Math.round(px).toLocaleString('en-US')}`;
  if (px >= 10) return `${px.toFixed(0)}`;
  return `${px.toFixed(1).replace(/\.0$/, '')}`;
}

/** "2048" -> "2K", "512" -> "512 px". */
export function sizeLabel(px) {
  if (px >= 1024 && px % 1024 === 0) return `${px / 1024}K`;
  return `${Math.round(px).toLocaleString('en-US')} px`;
}

export function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Pixels the whole texture (one copy) spans in the final render.
 */
export function copyFootprint(frameWidth, coverage, repeats = 1) {
  return (frameWidth * coverage) / Math.max(1, repeats);
}

/**
 * How many texture pixels land on each render pixel for a texture that is `textureWidth` wide.
 */
export function texelsPerPixel(textureWidth, frameWidth, coverage, repeats = 1) {
  const span = copyFootprint(frameWidth, coverage, repeats);
  return span > 0 ? textureWidth / span : Infinity;
}

/**
 * Which mip level(s) a renderer reads for a given texel density.
 * `topLevel` is the first level that exists for the texture being tested (0 = whole file; 2 = pretend the
 * texture was exported 4x smaller, which lets artists try "is the 1K one enough?").
 *
 * @param {number} lambda log2(texels per pixel) measured on level 0
 * @param {number} levelCount number of levels in the pyramid
 * @param {number} topLevel
 * @returns {{ lower: number, upper: number, mix: number }} blend of two neighbouring levels (mix = weight of `upper`)
 */
export function pickMipLevels(lambda, levelCount, topLevel = 0) {
  const last = Math.max(0, levelCount - 1);
  const top = Math.min(topLevel, last);
  const l = Math.max(top, Math.min(last, lambda));
  const lower = Math.floor(l);
  const upper = Math.min(last, lower + 1);
  const mix = upper === lower ? 0 : l - lower;
  return { lower, upper, mix };
}

function aOrAn(label) {
  return /^(8|11|18)/.test(label) ? 'an' : 'a';
}

function capitalize(t) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Plain-words judgement.
 *
 * verdict.level: 'soft' | 'slightly-soft' | 'good' | 'more-than-enough' | 'overkill'
 * verdict.tone:  'bad' | 'warn' | 'good' | 'info'   (used for colour)
 */
export function judge({ textureWidth, frameWidth, coverage, repeats = 1 }) {
  const footprint = copyFootprint(frameWidth, coverage, repeats);
  const tpp = texelsPerPixel(textureWidth, frameWidth, coverage, repeats);
  // Texture width that would give about one texel per pixel (a little soft is fine, hence 0.9).
  const needed = Math.max(1, footprint);
  const recommended = Math.max(64, nextPowerOfTwo(Math.ceil(needed * 0.9)));
  const recLabel = sizeLabel(recommended);
  const texLabel = sizeLabel(textureWidth);
  const spread = tpp > 0 ? 1 / tpp : Infinity;

  let level;
  let tone;
  let headline;
  let detail;

  const px = formatPixels(footprint);
  const where = repeats > 1
    ? `one copy of the texture is about ${px} px wide in the final image`
    : `the object is about ${px} px wide in the final image`;

  if (footprint < 2) {
    level = 'overkill';
    tone = 'info';
    headline = 'Too small to see';
    detail = `At this size ${where}, so the texture only shows up as an average colour. Only the very smallest mip levels matter.`;
  } else if (tpp < 0.5) {
    level = 'soft';
    tone = 'bad';
    headline = 'Too soft for this shot';
    detail = `${capitalize(where)} but this texture is only ${texLabel}, so each texture pixel is stretched over about ${spread.toFixed(1)} image pixels and it will look blurry. You need about ${aOrAn(recLabel)} ${recLabel} texture here.`;
  } else if (tpp < 0.9) {
    level = 'slightly-soft';
    tone = 'warn';
    headline = 'A little soft';
    detail = `${capitalize(where)} and this texture is ${texLabel}. Each texture pixel covers about ${spread.toFixed(1)} image pixels, so it will look slightly soft. ${recLabel} would be sharper.`;
  } else if (tpp < 2) {
    level = 'good';
    tone = 'good';
    headline = 'Sharp enough';
    detail = `${texLabel} matches this shot well: ${where}, so there is about one texture pixel for every image pixel. No blur and no waste.`;
  } else if (tpp < 4) {
    level = 'more-than-enough';
    tone = 'good';
    headline = 'More than enough';
    detail = `${capitalize(where)}, but this texture is ${texLabel}. ${capitalize(aOrAn(recLabel))} ${recLabel} texture would look the same.`;
  } else {
    level = 'overkill';
    tone = 'info';
    headline = 'Overkill at this distance';
    detail = `${capitalize(where)}, but this texture is ${texLabel}. ${capitalize(aOrAn(recLabel))} ${recLabel} texture would look the same and use far less memory.`;
  }

  return {
    level,
    tone,
    headline,
    detail,
    footprint,
    texelsPerPixel: tpp,
    recommendedWidth: recommended,
    recommendedLabel: recLabel
  };
}

/**
 * Grid for the "where does this texture hold up" chart: one row per distance, one column per render size.
 */
export function buildChart({ textureWidth, repeats = 1, presets = DISTANCE_PRESETS, renders = RENDER_PRESETS }) {
  return presets.map((d) => ({
    distance: d,
    cells: renders.map((r) => {
      const v = judge({ textureWidth, frameWidth: r.width, coverage: d.coverage, repeats });
      return { render: r, verdict: v };
    })
  }));
}

/**
 * Short sentence for the mip level(s) in use.
 */
export function describeMipChoice(mipLevels, pick) {
  const name = (lv) => `Level ${lv.index} (${lv.width} × ${lv.height})`;
  const a = mipLevels[pick.lower];
  const b = mipLevels[pick.upper];
  if (!a) return '';
  if (pick.mix < 0.15 || !b || a === b) return name(a);
  if (pick.mix > 0.85) return name(b);
  return `a mix of ${name(a)} and Level ${b.index}`;
}
