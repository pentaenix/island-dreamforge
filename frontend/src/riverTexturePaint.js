/**
 * Paint river/lake overlays onto the terrain albedo (viewport texture).
 * Overlay PNG is a mask only — paint color comes from layer settings.
 */

import { ISLAND_WATER_HEX } from './waterPalette.js';
import { smoothMaskGridMulti, erodeMaskGridMulti } from './maskSmooth.js';

export const DEFAULT_WATER_PAINT_COLOR = ISLAND_WATER_HEX[2] || '#2DA8C1';

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (url && !String(url).startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function overlayPixelIsWater(data, p, threshold) {
  const a = data[p + 3];
  if (a >= threshold) return true;
  return data[p] + data[p + 1] + data[p + 2] >= threshold * 2;
}

async function loadLayerOverlayData(layer) {
  const img = await loadImage(layer.url);
  const overlayW = img.width;
  const overlayH = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = overlayW;
  canvas.height = overlayH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, overlayW, overlayH).data, overlayW, overlayH };
}

/** Fraction of overlay taps that read as water [0,1] — softens blocky PNG strokes. */
function overlaySampleCoverageAt(data, overlayW, overlayH, ox, oy, threshold, tapRadius = 1.5) {
  const r = Math.ceil(tapRadius);
  let sum = 0;
  let n = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const sx = Math.min(overlayW - 1, Math.max(0, Math.round(ox + dx)));
      const sy = Math.min(overlayH - 1, Math.max(0, Math.round(oy + dy)));
      const op = (sy * overlayW + sx) * 4;
      sum += overlayPixelIsWater(data, op, threshold) ? 1 : 0;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/** Build grayscale mask by mapping grid UV directly onto overlay (not binary point samples). */
function fillWaterMaskFromOverlay(mask, maskW, maskH, data, overlayW, overlayH, threshold) {
  const tap = Math.max(1, Math.round(Math.max(overlayW, overlayH) / Math.max(maskW, maskH, 1)));
  for (let y = 0; y < maskH; y++) {
    const oy = (y / Math.max(1, maskH - 1)) * (overlayH - 1);
    for (let x = 0; x < maskW; x++) {
      const ox = (x / Math.max(1, maskW - 1)) * (overlayW - 1);
      const cov = overlaySampleCoverageAt(data, overlayW, overlayH, ox, oy, threshold, tap * 0.65 + 1);
      mask[y * maskW + x] = Math.round(cov * 255);
    }
  }
}

function smoothPassesForRadius(r) {
  if (r >= 8) return 3;
  if (r >= 4) return 2;
  return 1;
}

/** Scale blur radius so texture-resolution masks get similar world-space softness as height grid. */
function effectiveSmoothRadius(basePx, gridW, overlayW) {
  const b = Math.max(0, Number(basePx) || 0);
  if (b < 1) return 0;
  const scale = Math.max(1, Number(overlayW) || gridW) / Math.max(1, gridW);
  return Math.max(1, Math.round(b * Math.sqrt(scale)));
}

function applyMaskSmooth(mask, gridH, gridW, baseSmoothPx, overlayW) {
  const radius = effectiveSmoothRadius(baseSmoothPx, gridW, overlayW);
  if (radius < 1) return mask;
  return smoothMaskGridMulti(mask, gridH, gridW, radius, smoothPassesForRadius(radius));
}

function applyRiverSlim(mask, gridH, gridW, slimPx) {
  const s = Math.round(Number(slimPx) || 0);
  if (s < 1) return mask;
  return erodeMaskGridMulti(mask, gridH, gridW, 1, s);
}

export function aggregateRiverSlimPx(waterLayers = []) {
  const active = (waterLayers || []).filter((l) => l.kind === 'water' && l.enabled !== false);
  return active.length ? Math.max(...active.map((l) => Number(l.riverSlimPx ?? 0))) : 0;
}

export function aggregateMaskSmoothPx(waterLayers = [], extraSmoothPx = 0) {
  const active = (waterLayers || []).filter((l) => l.kind === 'water' && l.enabled !== false);
  const fromLayers = active.length
    ? Math.max(...active.map((l) => Number(l.maskSmoothPx ?? 0)))
    : 0;
  return Math.max(fromLayers, Number(extraSmoothPx) || 0);
}

export function hexToRgb(hex, fallback = [45, 168, 193]) {
  const v = String(hex || '').replace('#', '').trim();
  if (v.length < 6) return fallback;
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

/** Build a single-layer mask at texture resolution (used for blue water color on 3D). */
export async function buildWaterOverlayMaskForLayer(layer, texW, texH, rows, cols, threshold = 8) {
  const mask = new Uint8Array(texW * texH);
  if (!layer?.url || texW < 1 || texH < 1) return mask;

  const t = Number(layer.maskThreshold ?? threshold);
  let overlay;
  try {
    overlay = await loadLayerOverlayData(layer);
  } catch {
    return mask;
  }
  const { data, overlayW, overlayH } = overlay;

  fillWaterMaskFromOverlay(mask, texW, texH, data, overlayW, overlayH, t);
  let out = applyMaskSmooth(mask, texH, texW, layer.maskSmoothPx ?? 3, overlayW);
  out = applyRiverSlim(out, texH, texW, layer.riverSlimPx ?? 0);
  return out;
}

/** Smoothed mask without slim — for sand banks that should hug the full water fringe. */
export async function buildWaterOverlayCarveMaskForLayer(layer, texW, texH, rows, cols, threshold = 8) {
  const mask = new Uint8Array(texW * texH);
  if (!layer?.url || texW < 1 || texH < 1) return mask;

  const t = Number(layer.maskThreshold ?? threshold);
  let overlay;
  try {
    overlay = await loadLayerOverlayData(layer);
  } catch {
    return mask;
  }
  const { data, overlayW, overlayH } = overlay;
  fillWaterMaskFromOverlay(mask, texW, texH, data, overlayW, overlayH, t);
  return applyMaskSmooth(mask, texH, texW, layer.maskSmoothPx ?? 3, overlayW);
}

export async function buildCombinedWaterOverlayCarveMask(
  waterLayers,
  texW,
  texH,
  rows,
  cols,
  threshold = 8,
) {
  const combined = new Uint8Array(texW * texH);
  const active = (waterLayers || []).filter((l) => l.kind === 'water' && l.enabled !== false && l.url);
  if (!active.length || texW < 1 || texH < 1) return combined;

  for (const layer of active) {
    const layerMask = await buildWaterOverlayCarveMaskForLayer(layer, texW, texH, rows, cols, threshold);
    for (let i = 0; i < combined.length; i++) {
      combined[i] = Math.max(combined[i], layerMask[i]);
    }
  }
  return combined;
}

/**
 * Build a texture-resolution mask from one or more water overlay layers.
 */
export async function buildCombinedWaterOverlayMask(
  waterLayers,
  texW,
  texH,
  rows,
  cols,
  threshold = 8,
) {
  const combined = new Uint8Array(texW * texH);
  const active = (waterLayers || []).filter((l) => l.kind === 'water' && l.enabled !== false && l.url);
  if (!active.length || texW < 1 || texH < 1) return combined;

  for (const layer of active) {
    const layerMask = await buildWaterOverlayMaskForLayer(layer, texW, texH, rows, cols, threshold);
    for (let i = 0; i < combined.length; i++) {
      combined[i] = Math.max(combined[i], layerMask[i]);
    }
  }
  return combined;
}

/** Heightmap-resolution mask for lake flatten / river carve (Step 3 height panel). */
export async function buildHeightmapWaterMask(waterLayers, rows, cols, threshold = 8, smoothRadius = 0) {
  const combined = new Uint8Array(rows * cols);
  const active = (waterLayers || []).filter((l) => l.kind === 'water' && l.enabled !== false && l.url);
  if (!active.length || rows < 2 || cols < 2) {
    return { mask: combined, carveMask: combined, classifyMask: combined, overlayW: cols, overlayH: rows };
  }

  let overlayW = cols;
  let overlayH = rows;

  for (const layer of active) {
    const t = Number(layer.maskThreshold ?? threshold);
    let overlay;
    try {
      overlay = await loadLayerOverlayData(layer);
    } catch {
      continue;
    }
    overlayW = overlay.overlayW;
    overlayH = overlay.overlayH;
    const layerMask = new Uint8Array(rows * cols);
    fillWaterMaskFromOverlay(layerMask, cols, rows, overlay.data, overlayW, overlayH, t);
    for (let i = 0; i < combined.length; i++) {
      combined[i] = Math.max(combined[i], layerMask[i]);
    }
  }

  const smoothPx = aggregateMaskSmoothPx(active, smoothRadius);
  const classifyMask = combined;
  const carveMask = applyMaskSmooth(combined, rows, cols, smoothPx, overlayW);
  const slimPx = aggregateRiverSlimPx(active);
  const mask = slimPx > 0 ? applyRiverSlim(carveMask, rows, cols, slimPx) : carveMask;
  return { mask, carveMask, classifyMask, overlayW, overlayH };
}

/** Per-layer paint specs for texture tinting on the 3D island. */
export async function buildWaterOverlayPaintLayers(waterLayers, texW, texH, rows, cols, threshold = 8) {
  const active = (waterLayers || []).filter((l) => l.kind === 'water' && l.enabled !== false && l.url);
  const layers = [];
  for (const layer of active) {
    const mask = await buildWaterOverlayMaskForLayer(layer, texW, texH, rows, cols, threshold);
    layers.push({
      id: layer.id,
      mask,
      paintColor: layer.paintColor || DEFAULT_WATER_PAINT_COLOR,
      paintStrength: Number(layer.paintStrength ?? 1),
    });
  }
  return layers;
}

/** Count painted mask pixels (for diagnostics). */
export function countMaskPixels(maskGrid) {
  if (!maskGrid?.length) return 0;
  let n = 0;
  for (let i = 0; i < maskGrid.length; i++) {
    if (maskGrid[i] > 32) n++;
  }
  return n;
}

/** Blend inland water color onto terrain texture pixels where mask > 0. */
export function applyWaterOverlayPaintToImageData(
  imgData,
  texW,
  texH,
  maskGrid,
  {
    waterRgb = [45, 168, 200],
    strength = 1,
    landOnly = true,
    landGrid = null,
  } = {},
) {
  if (!imgData?.data || !maskGrid?.length) return imgData;
  const data = imgData.data;
  const s = Math.max(0, Number(strength) || 1);
  const [wr, wg, wb] = waterRgb;

  for (let ty = 0; ty < texH; ty++) {
    for (let tx = 0; tx < texW; tx++) {
      const mi = ty * texW + tx;
      if (maskGrid[mi] < 4) continue;
      if (landOnly && landGrid && !landGrid[mi]) continue;
      const p = mi * 4;
      if (data[p + 3] < 8) continue;
      const coverage = maskGrid[mi] / 255;
      const m = clamp01(coverage * s);
      const effective = 1 - (1 - m) ** (s >= 1 ? 1.15 : 1.6);
      data[p] = Math.round(data[p] * (1 - effective) + wr * effective);
      data[p + 1] = Math.round(data[p + 1] * (1 - effective) + wg * effective);
      data[p + 2] = Math.round(data[p + 2] * (1 - effective) + wb * effective);
    }
  }
  return imgData;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

export function buildLandGridForTexture(texW, texH, rows, cols, landAtFn) {
  const grid = new Uint8Array(texW * texH);
  if (!landAtFn) return grid;
  for (let ty = 0; ty < texH; ty++) {
    const r = Math.min(rows - 1, Math.round((ty / Math.max(1, texH - 1)) * (rows - 1)));
    for (let tx = 0; tx < texW; tx++) {
      const c = Math.min(cols - 1, Math.round((tx / Math.max(1, texW - 1)) * (cols - 1)));
      if (landAtFn(r, c)) grid[ty * texW + tx] = 1;
    }
  }
  return grid;
}

export function aggregateWaterPaintStrength(waterLayers) {
  const active = (waterLayers || []).filter((l) => l.kind === 'water' && l.enabled !== false && l.url);
  if (!active.length) return 0.9;
  return Math.max(...active.map((l) => Number(l.paintStrength ?? 0.9)));
}
