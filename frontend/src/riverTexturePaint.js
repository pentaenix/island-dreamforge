/**
 * Paint river/lake overlays onto the terrain albedo (viewport texture).
 * Overlay PNG is a mask only — paint color comes from layer settings.
 */

import { ISLAND_WATER_HEX } from './waterPalette.js';

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

function overlaySampleIsWater(data, overlayW, overlayH, row, col, rows, cols, threshold) {
  const oy = Math.min(overlayH - 1, Math.round((row / Math.max(1, rows - 1)) * (overlayH - 1)));
  const ox = Math.min(overlayW - 1, Math.round((col / Math.max(1, cols - 1)) * (overlayW - 1)));
  const op = (oy * overlayW + ox) * 4;
  return overlayPixelIsWater(data, op, threshold);
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

/** Build a single-layer mask at texture resolution. */
export async function buildWaterOverlayMaskForLayer(layer, texW, texH, rows, cols, threshold = 8) {
  const mask = new Uint8Array(texW * texH);
  if (!layer?.url || texW < 1 || texH < 1 || rows < 2 || cols < 2) return mask;

  const t = Number(layer.maskThreshold ?? threshold);
  let overlay;
  try {
    overlay = await loadLayerOverlayData(layer);
  } catch {
    return mask;
  }
  const { data, overlayW, overlayH } = overlay;

  for (let ty = 0; ty < texH; ty++) {
    const row = Math.min(rows - 1, Math.round((ty / Math.max(1, texH - 1)) * (rows - 1)));
    for (let tx = 0; tx < texW; tx++) {
      const col = Math.min(cols - 1, Math.round((tx / Math.max(1, texW - 1)) * (cols - 1)));
      if (overlaySampleIsWater(data, overlayW, overlayH, row, col, rows, cols, t)) {
        mask[ty * texW + tx] = 255;
      }
    }
  }
  return mask;
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
  if (!active.length || texW < 1 || texH < 1 || rows < 2 || cols < 2) return combined;

  for (const layer of active) {
    const layerMask = await buildWaterOverlayMaskForLayer(layer, texW, texH, rows, cols, threshold);
    for (let i = 0; i < combined.length; i++) {
      if (layerMask[i] > 32) combined[i] = 255;
    }
  }
  return combined;
}

/** Heightmap-resolution mask for lake flattening. */
export async function buildHeightmapWaterMask(waterLayers, rows, cols, threshold = 8) {
  const combined = new Uint8Array(rows * cols);
  const active = (waterLayers || []).filter((l) => l.kind === 'water' && l.enabled !== false && l.url);
  if (!active.length || rows < 2 || cols < 2) {
    return { mask: combined, overlayW: cols, overlayH: rows };
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
    const { data } = overlay;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (overlaySampleIsWater(data, overlayW, overlayH, r, c, rows, cols, t)) {
          combined[r * cols + c] = 255;
        }
      }
    }
  }
  return { mask: combined, overlayW, overlayH };
}

/** Per-layer paint specs for texture tinting. */
export async function buildWaterOverlayPaintLayers(waterLayers, texW, texH, rows, cols, threshold = 8) {
  const active = (waterLayers || []).filter((l) => l.kind === 'water' && l.enabled !== false && l.url);
  const layers = [];
  for (const layer of active) {
    const mask = await buildWaterOverlayMaskForLayer(layer, texW, texH, rows, cols, threshold);
    layers.push({
      id: layer.id,
      mask,
      paintColor: layer.paintColor || DEFAULT_WATER_PAINT_COLOR,
      paintStrength: Number(layer.paintStrength ?? 0.92),
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
    strength = 0.9,
    landOnly = true,
    landGrid = null,
  } = {},
) {
  if (!imgData?.data || !maskGrid?.length) return imgData;
  const data = imgData.data;
  const s = Math.max(0, Math.min(1, Number(strength) || 0.9));
  const [wr, wg, wb] = waterRgb;

  for (let ty = 0; ty < texH; ty++) {
    for (let tx = 0; tx < texW; tx++) {
      const mi = ty * texW + tx;
      if (maskGrid[mi] < 32) continue;
      if (landOnly && landGrid && !landGrid[mi]) continue;
      const p = mi * 4;
      if (data[p + 3] < 8) continue;
      const m = (maskGrid[mi] / 255) * s;
      data[p] = Math.round(data[p] * (1 - m) + wr * m);
      data[p + 1] = Math.round(data[p + 1] * (1 - m) + wg * m);
      data[p + 2] = Math.round(data[p + 2] * (1 - m) + wb * m);
    }
  }
  return imgData;
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
