/**
 * Paint path overlays onto terrain albedo (mask PNG aligned to map).
 * Paths paint after base terrain, before rivers (rivers win on overlap).
 */

import { smoothMaskGridMulti } from './maskSmooth.js';
import { PATH_COLOR_PRESETS } from './detailSettings.js';

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (url && !String(url).startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function overlayPixelIsMask(data, p, threshold) {
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

function overlaySampleCoverageAt(data, overlayW, overlayH, ox, oy, threshold, tapRadius = 1.5) {
  const r = Math.ceil(tapRadius);
  let sum = 0;
  let n = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const sx = Math.min(overlayW - 1, Math.max(0, Math.round(ox + dx)));
      const sy = Math.min(overlayH - 1, Math.max(0, Math.round(oy + dy)));
      const op = (sy * overlayW + sx) * 4;
      sum += overlayPixelIsMask(data, op, threshold) ? 1 : 0;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

function fillMaskFromOverlay(mask, maskW, maskH, data, overlayW, overlayH, threshold) {
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

function effectiveSmoothRadius(basePx, gridW, overlayW) {
  const b = Math.max(0, Number(basePx) || 0);
  if (b < 1) return 0;
  const scale = Math.max(1, Number(overlayW) || gridW) / Math.max(1, gridW);
  return Math.max(1, Math.round(b * Math.sqrt(scale)));
}

function applyMaskSmooth(mask, gridH, gridW, baseSmoothPx, overlayW, edgeSoftness = 0.5) {
  const radius = effectiveSmoothRadius(baseSmoothPx, gridW, overlayW);
  if (radius < 1) return mask;
  const passes = edgeSoftness > 0.7 ? 3 : edgeSoftness > 0.4 ? 2 : 1;
  return smoothMaskGridMulti(mask, gridH, gridW, radius, passes);
}

function hexToRgb(hex, fallback = [232, 217, 176]) {
  const v = String(hex || '').replace('#', '').trim();
  if (v.length < 6) return fallback;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function hashNoise(x, y, seed = 0) {
  const n = Math.sin((x * 127.1 + y * 311.7 + seed * 74.7)) * 43758.5453;
  return n - Math.floor(n);
}

export async function buildPathOverlayMaskForLayer(layer, texW, texH, pathSettings = {}, threshold = 8) {
  const mask = new Uint8Array(texW * texH);
  if (!layer?.url || layer.enabled === false || texW < 1 || texH < 1) return mask;

  const t = Number(layer.maskThreshold ?? pathSettings.maskThreshold ?? threshold);
  let overlay;
  try {
    overlay = await loadLayerOverlayData(layer);
  } catch {
    return mask;
  }
  const { data, overlayW, overlayH } = overlay;
  fillMaskFromOverlay(mask, texW, texH, data, overlayW, overlayH, t);

  const widthPx = Number(layer.pathWidthPx ?? pathSettings.pathWidthPx ?? 0);
  const edgeSoft = Number(layer.edgeSoftness ?? pathSettings.edgeSoftness ?? 0.55);
  const smoothPx = widthPx > 0 ? Math.max(1, Math.round(widthPx * 0.35)) : Math.round(2 + edgeSoft * 6);
  return applyMaskSmooth(mask, texH, texW, smoothPx, overlayW, edgeSoft);
}

export async function buildCombinedPathOverlayMask(pathLayers, texW, texH, pathSettings = {}, threshold = 8) {
  const combined = new Uint8Array(texW * texH);
  const active = (pathLayers || []).filter((l) => l.kind === 'path' && l.enabled !== false && l.url);
  if (!active.length || texW < 1 || texH < 1) return combined;

  for (const layer of active) {
    const layerMask = await buildPathOverlayMaskForLayer(layer, texW, texH, pathSettings, threshold);
    for (let i = 0; i < combined.length; i++) {
      combined[i] = Math.max(combined[i], layerMask[i]);
    }
  }
  return combined;
}

export function pathColorRgb(layer, pathSettings = {}) {
  const preset = layer?.colorPreset || pathSettings.colorPreset || 'sand';
  const hex = PATH_COLOR_PRESETS[preset] || PATH_COLOR_PRESETS.sand;
  return hexToRgb(hex);
}

export function applyPathOverlayPaintToImageData(
  imgData,
  texW,
  texH,
  maskGrid,
  {
    pathRgb = [232, 217, 176],
    strength = 1,
    edgeSoftness = 0.55,
    seed = 42,
    riverMask = null,
  } = {},
) {
  if (!imgData?.data || !maskGrid?.length) return imgData;
  const data = imgData.data;
  const s = Math.max(0, Number(strength) || 1);
  const [pr, pg, pb] = pathRgb;

  for (let ty = 0; ty < texH; ty++) {
    for (let tx = 0; tx < texW; tx++) {
      const mi = ty * texW + tx;
      if (maskGrid[mi] < 4) continue;
      if (riverMask?.length && riverMask[mi] > 48) continue;
      const p = mi * 4;
      if (data[p + 3] < 8) continue;
      const noise = 0.92 + hashNoise(tx * 0.17, ty * 0.13, seed) * 0.16;
      const coverage = (maskGrid[mi] / 255) * noise;
      const soft = clamp01(coverage * s * (0.85 + edgeSoftness * 0.2));
      const effective = 1 - (1 - soft) ** 1.25;
      data[p] = Math.round(data[p] * (1 - effective) + pr * effective);
      data[p + 1] = Math.round(data[p + 1] * (1 - effective) + pg * effective);
      data[p + 2] = Math.round(data[p + 2] * (1 - effective) + pb * effective);
    }
  }
  return imgData;
}

export function countPathMaskPixels(maskGrid) {
  if (!maskGrid?.length) return 0;
  let n = 0;
  for (let i = 0; i < maskGrid.length; i++) {
    if (maskGrid[i] > 32) n++;
  }
  return n;
}
