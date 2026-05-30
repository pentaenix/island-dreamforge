/** Client-side elevation profiles for the Heights step (line diagrams only). */

/** Profile chart always uses this headroom above max height (matches Heights studio UX). */
export const PROFILE_Y_HEADROOM_M = 100;

/** Draft grid resolution — higher = closer match to generated heightmap profile. */
const DRAFT_PREVIEW_MAX_SIDE = 512;

function rgbFromHex(hex) {
  const v = String(hex || '').replace('#', '').trim();
  if (v.length !== 6) return [0, 0, 0];
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function colorDistance(rgb, hex) {
  const s = rgbFromHex(hex);
  return Math.sqrt((rgb[0] - s[0]) ** 2 + (rgb[1] - s[1]) ** 2 + (rgb[2] - s[2]) ** 2);
}

function nearestSampleHeight(rgb, samples, exact, radius) {
  if (!samples?.length) return 0;
  let best = samples[0];
  let bestD = Infinity;
  for (const s of samples) {
    const d = colorDistance(rgb, s.hex);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
    if (exact && d < 1.5) return Number(s.height) || 0;
  }
  if (exact) return Number(best.height) || 0;
  if (bestD > radius) return Number(samples[0].height) || 0;
  return Number(best.height) || 0;
}

function boxBlurPass(heights, rows, cols, radius) {
  if (radius < 1) return heights;
  const out = new Float32Array(heights.length);
  const w = Math.min(Math.max(1, Math.round(radius)), 24);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      let n = 0;
      for (let dr = -w; dr <= w; dr++) {
        for (let dc = -w; dc <= w; dc++) {
          const rr = Math.min(rows - 1, Math.max(0, r + dr));
          const cc = Math.min(cols - 1, Math.max(0, c + dc));
          sum += heights[rr * cols + cc];
          n++;
        }
      }
      out[r * cols + c] = sum / n;
    }
  }
  return out;
}

/** Two-pass box blur approximates Gaussian (matches backend band smoothing better). */
function gaussianBlurApprox(heights, rows, cols, sigma) {
  const r = Math.max(1, sigma);
  return boxBlurPass(boxBlurPass(heights, rows, cols, r), rows, cols, r);
}

function blendFields(a, b, t) {
  const out = new Float32Array(a.length);
  const keep = 1 - t;
  for (let i = 0; i < a.length; i++) out[i] = a[i] * keep + b[i] * t;
  return out;
}

function draftBaseCacheKey(mapUrl, samples, exact, radius) {
  const hexKey = samples.map((s) => s.hex).join('|');
  return `${mapUrl}::${hexKey}::${exact ? 1 : 0}::${radius}`;
}

/** Re-map cached pixel colors to meters when only sample heights change (instant). */
export function applySamplesToBase(base, samples, opts = {}) {
  if (!base?.pixels) return base;
  const exact = !!opts.exactColorMode;
  const radius = Number(opts.similarRadius ?? 12);
  const { pixels, rows, cols } = base;
  const baseMeters = new Float32Array(rows * cols);
  for (let i = 0; i < baseMeters.length; i++) {
    const rgb = [pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2]];
    baseMeters[i] = nearestSampleHeight(rgb, samples, exact, radius);
  }
  base.baseMeters = baseMeters;
  return base;
}

const draftBaseCache = new Map();

/**
 * Color-matched height in meters per pixel (no blur). Cached until map/samples/color matching change.
 */
export async function buildDraftBaseField(mapUrl, samples, opts = {}) {
  if (!mapUrl || !samples?.length) return null;
  const exact = !!opts.exactColorMode;
  const radius = Number(opts.similarRadius ?? 12);
  const key = draftBaseCacheKey(mapUrl, samples, exact, radius);
  const cached = draftBaseCache.get(key);
  if (cached) return cached;

  const img = await loadImage(mapUrl);
  const maxGrid = Math.max(64, Number(opts.profilePreviewMaxSide ?? DRAFT_PREVIEW_MAX_SIDE));
  const ratio = img.width / Math.max(1, img.height);
  let cols = maxGrid;
  let rows = Math.max(16, Math.round(maxGrid / ratio));
  if (rows > maxGrid) {
    rows = maxGrid;
    cols = Math.max(16, Math.round(maxGrid * ratio));
  }
  const pixelScale = cols / Math.max(1, img.width);
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, cols, rows);
  const data = ctx.getImageData(0, 0, cols, rows).data;
  const pixels = new Uint8Array(rows * cols * 3);
  const baseMeters = new Float32Array(rows * cols);
  for (let i = 0; i < baseMeters.length; i++) {
    pixels[i * 3] = data[i * 4];
    pixels[i * 3 + 1] = data[i * 4 + 1];
    pixels[i * 3 + 2] = data[i * 4 + 2];
    const rgb = [pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2]];
    baseMeters[i] = nearestSampleHeight(rgb, samples, exact, radius);
  }
  const base = {
    baseMeters,
    pixels,
    rows,
    cols,
    mapUrl,
    key,
    srcWidth: img.width,
    srcHeight: img.height,
    pixelScale,
  };
  draftBaseCache.set(key, base);
  return base;
}

/**
 * Band smoothing aligned with backend: blend raw color heights toward Gaussian-blurred
 * ramps (not repeated full averaging, which flattens everything to one level).
 */
export function smoothDraftField(base, opts = {}) {
  if (!base?.baseMeters) return null;
  const { baseMeters, rows, cols } = base;
  const ceilingM = Math.max(1, Number(opts.maxHeightM || 500));
  const raw = Float32Array.from(baseMeters);
  let meters = raw;
  const blend = Math.max(0, Math.min(1, Number(opts.bandBlendStrength ?? 0.86)));
  // bandTransitionPx is in source-map pixels; scale blur to match downsampled draft grid.
  const pxScale = Math.max(1e-6, Number(base.pixelScale ?? 1));
  const sigma = Math.max(0, Number(opts.bandTransitionPx ?? 11)) * pxScale;
  const passes = Math.max(1, Number(opts.bandBlendPasses ?? 2));

  if (blend > 0 && sigma > 0) {
    let broad = gaussianBlurApprox(raw, rows, cols, sigma);
    meters = blendFields(raw, broad, blend);
    for (let p = 1; p < passes; p++) {
      broad = gaussianBlurApprox(meters, rows, cols, Math.max(1, sigma * 0.55));
      meters = blendFields(meters, broad, blend * 0.35);
    }
  }

  const extraSigma = Number(opts.smoothingSigma ?? 0) * pxScale;
  if (extraSigma > 0.2) {
    meters = gaussianBlurApprox(meters, rows, cols, Math.min(8, extraSigma));
  }

  const heights = new Float32Array(meters.length);
  for (let i = 0; i < meters.length; i++) heights[i] = Math.min(meters[i], ceilingM);
  return { heights, rows, cols, maxHeightM: ceilingM, kind: 'draft' };
}

/** Unsmoothed color-band heights (clamped) — aligns with handle positions on the chart. */
export function rawDraftFieldFromBase(base, maxHeightM = 500) {
  if (!base?.baseMeters) return null;
  const ceilingM = Math.max(1, Number(maxHeightM || 500));
  const heights = new Float32Array(base.baseMeters.length);
  for (let i = 0; i < heights.length; i++) heights[i] = Math.min(base.baseMeters[i], ceilingM);
  return { heights, rows: base.rows, cols: base.cols, maxHeightM: ceilingM, kind: 'raw' };
}

/** @deprecated Prefer buildDraftBaseField + smoothDraftField for live slider updates. */
export async function buildDraftHeightField(mapUrl, samples, opts = {}) {
  const base = await buildDraftBaseField(mapUrl, samples, opts);
  return base ? smoothDraftField(base, opts) : null;
}

export function clearDraftBaseCache() {
  draftBaseCache.clear();
}

export async function decodeHeightPreview(previewUrl, maxHeightM) {
  if (!previewUrl) return null;
  const img = await loadImage(previewUrl);
  const cols = img.width;
  const rows = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, cols, rows).data;
  const ceilingM = Math.max(1, maxHeightM);
  const heights = new Float32Array(rows * cols);
  for (let i = 0; i < heights.length; i++) heights[i] = (data[i * 4] / 255) * ceilingM;
  return { heights, rows, cols, maxHeightM: ceilingM, kind: 'generated' };
}

/**
 * Orthographic elevation envelope: at each horizontal position, the highest
 * terrain visible from that viewing direction (standard side-view / section drawing).
 *
 * @param {'width'|'depth'} axis — width = view along long edge; depth = view along short edge
 */
export function extractOrthographicProfile(field, axis) {
  if (!field?.heights) return [];
  const { heights, rows, cols } = field;
  const points = [];
  if (axis === 'width') {
    for (let c = 0; c < cols; c++) {
      let peak = 0;
      for (let r = 0; r < rows; r++) peak = Math.max(peak, heights[r * cols + c]);
      points.push({ t: cols > 1 ? c / (cols - 1) : 0, meters: peak });
    }
  } else {
    for (let r = 0; r < rows; r++) {
      let peak = 0;
      for (let c = 0; c < cols; c++) peak = Math.max(peak, heights[r * cols + c]);
      points.push({ t: rows > 1 ? r / (rows - 1) : 0, meters: peak });
    }
  }
  return points;
}

/** @deprecated use extractOrthographicProfile */
export function extractProfile(field, axis) {
  return extractOrthographicProfile(field, axis);
}

/**
 * Fixed vertical range for the profile chart.
 *
 * yMin  = 0 (or sea level if below 0)
 * yTop  = maxHeightM + PROFILE_Y_HEADROOM_M   (full scale, scale = 1)
 * yMax  = maxHeightM + headroom                (always above the ceiling)
 *
 * profileScale ≥ 1 compresses only the headroom above the ceiling so the
 * ceiling line always stays inside the visible range and its Y position
 * matches the axis label at maxHeightM exactly.
 */
export function profileYRange(maxHeightM, seaLevelM = 0, profileScale = 1) {
  const ceilingM = Math.max(1, Number(maxHeightM || 500));
  const yTop = ceilingM + PROFILE_Y_HEADROOM_M;
  const zoom = Math.max(1, Number(profileScale) || 1);
  // Compress headroom above ceiling as zoom increases, but never less than 10 m.
  const headroom = Math.max(10, PROFILE_Y_HEADROOM_M / zoom);
  return {
    yMin: Math.min(0, Number(seaLevelM) || 0),
    yMax: ceilingM + headroom,   // always ≥ ceilingM + 10 → ceiling is always on-chart
    yTop,
  };
}

export function profileSpanM(axis, worldSettings = {}, mapSizePx = {}) {
  const widthM = Number(worldSettings.widthM || 1480);
  const depthM = Number(worldSettings.depthM || 1086);
  if (mapSizePx?.width && mapSizePx?.height) {
    return axis === 'width'
      ? widthM
      : (worldSettings.lockAspect !== false
        ? Math.round(widthM * mapSizePx.height / mapSizePx.width)
        : Number(worldSettings.depthM || depthM));
  }
  return axis === 'width' ? widthM : depthM;
}
