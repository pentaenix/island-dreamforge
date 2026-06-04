/**
 * Water layer textures for 3D viewport.
 */

import { isDryLandM } from './waterMaskFromHeights.js';
import { bathy01FromDistanceM, defaultBandEdgesM, oceanDiscRimFade, sampleWaterColor } from './waterPalette.js';
import { getWorldMaxHeightM, maxShoreDistanceScaleM } from './worldSettings.js';

function hashNoise(ix, iy, seed) {
  const s = Math.sin((ix + seed * 13.17) * 12.9898 + (iy - seed * 7.91) * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function fbmWorld(x, z, scaleM, seed) {
  const sx = x / Math.max(5, scaleM);
  const sz = z / Math.max(5, scaleM);
  let f = 0;
  let amp = 0.5;
  let scale = 1;
  for (let i = 0; i < 4; i++) {
    f += amp * hashNoise(Math.floor(sx * scale), Math.floor(sz * scale), seed + i * 17);
    amp *= 0.5;
    scale *= 2;
  }
  return f * 2 - 1;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function sampleFoamAt(foamData, fw, fh, col, row) {
  if (!foamData) return 0;
  const c = Math.max(0, Math.min(fw - 1, col));
  const r = Math.max(0, Math.min(fh - 1, row));
  return foamData[(r * fw + c) * 4] / 255;
}

/**
 * Color depth bands from shore-distance + live band sliders (falls back to exported waterColor).
 */
export async function buildWaterBandsMapUrl({
  rows,
  cols,
  heights,
  mapW,
  mapD,
  seaLevelM,
  maxHeightM,
  worldSettings,
  oceanSettings = {},
  waterColorUrl = '',
  shoreDistanceUrl = '',
  shoreDistanceMaxM = 0,
  bandSmoothness = 0.35,
}) {
  const smooth = Math.max(0, Math.min(1, Number(bandSmoothness) || 0));
  const maxH = getWorldMaxHeightM(maxHeightM, worldSettings);
  const mapSizePx = { width: cols, height: rows };
  const edges = defaultBandEdgesM(oceanSettings);
  const maxDistM = Number(shoreDistanceMaxM) > 0
    ? Number(shoreDistanceMaxM)
    : maxShoreDistanceScaleM(worldSettings, mapSizePx, oceanSettings);

  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (shoreDistanceUrl) {
    const distImg = await loadImage(shoreDistanceUrl);
    ctx.drawImage(distImg, 0, 0, cols, rows);
    const distData = ctx.getImageData(0, 0, cols, rows).data;
    const out = ctx.createImageData(cols, rows);
    const data = out.data;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const p = (r * cols + c) * 4;
        const idx = r * cols + c;

        if (isDryLandM(heights, idx, seaLevelM, maxH, worldSettings)) {
          data[p + 3] = 0;
          continue;
        }

        const distM = (distData[p] / 255) * maxDistM;
        const bathy01 = bathy01FromDistanceM(distM, edges);
        const [cr, cg, cb] = sampleWaterColor(bathy01, smooth);
        data[p] = cr;
        data[p + 1] = cg;
        data[p + 2] = cb;
        data[p + 3] = 255;
      }
    }

    ctx.putImageData(out, 0, 0);
    return canvas.toDataURL('image/png');
  }

  if (!waterColorUrl) return '';

  const colorImg = await loadImage(waterColorUrl);
  ctx.drawImage(colorImg, 0, 0, cols, rows);
  const img = ctx.getImageData(0, 0, cols, rows);
  const data = img.data;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = (r * cols + c) * 4;
      const idx = r * cols + c;

      if (isDryLandM(heights, idx, seaLevelM, maxH, worldSettings)) {
        data[p + 3] = 0;
        continue;
      }

      if (data[p] + data[p + 1] + data[p + 2] < 12) {
        data[p + 3] = 0;
        continue;
      }
      data[p + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

export async function buildFoamLayerTextureUrl({
  foamMaskUrl,
  discRadiusM,
  mapW,
  mapD,
  rows,
  cols,
  seaLevelM,
  maxHeightM,
  worldSettings,
  oceanSettings,
  mapSizePx,
  ocean = {},
}) {
  const size = 512;
  const discR = Math.max(50, discRadiusM);
  const discD = discR * 2;
  const widthM = mapW || Number(worldSettings.widthM || 1480);
  const depthM = mapD || Number(worldSettings.depthM || 1086);
  const rimFadeM = Number(ocean.oceanFoamRimFadeM ?? 48);
  const waveStrength = Number(ocean.waterNoiseStrength ?? 0.1);
  const waveScaleM = Math.max(8, Number(ocean.waterNoiseScaleM ?? 85));
  const seed = Math.round(Number(ocean.materialSeed ?? ocean.seed ?? 1337)) || 1337;

  const fw = mapSizePx.width || size;
  const fh = mapSizePx.height || size;

  let foamData = null;
  if (foamMaskUrl) {
    const foamImg = await loadImage(foamMaskUrl);
    const fc = document.createElement('canvas');
    fc.width = fw;
    fc.height = fh;
    const fctx = fc.getContext('2d');
    fctx.drawImage(foamImg, 0, 0, fw, fh);
    foamData = fctx.getImageData(0, 0, fw, fh).data;
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  const data = img.data;

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const p = (row * size + col) * 4;
      const u = col / Math.max(1, size - 1);
      const v = row / Math.max(1, size - 1);
      const wx = (u - 0.5) * discD;
      const wz = (v - 0.5) * discD;
      const radial = Math.hypot(wx, wz);

      if (radial > discR) {
        data[p + 3] = 0;
        continue;
      }

      const rimFactor = oceanDiscRimFade(radial, discR, rimFadeM);
      const gc = (wx / widthM + 0.5) * Math.max(1, fw - 1);
      const gr = (wz / depthM + 0.5) * Math.max(1, fh - 1);
      let foam = sampleFoamAt(foamData, fw, fh, gc, gr) * rimFactor;

      if (waveStrength > 0 && rimFactor > 0.02 && foam > 0.02) {
        const wave = fbmWorld(wx, wz, waveScaleM, seed + 101);
        const crest = Math.max(0, wave - 0.12);
        foam = Math.min(1, foam + crest * waveStrength * 0.35 * rimFactor);
      }

      if (foam < 0.02) {
        data[p + 3] = 0;
        continue;
      }

      data[p] = 245;
      data[p + 1] = 252;
      data[p + 2] = 255;
      data[p + 3] = Math.round(Math.min(255, foam * 255));
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

export function applySurfaceOverlays(imgData, foamData, options, width, height) {
  const data = imgData.data;
  const waveStrength = Number(options.waterNoiseStrength ?? 0.1);
  const waveScaleM = Math.max(8, Number(options.waterNoiseScaleM ?? 85));
  const oceanR = Math.max(50, Number(options.oceanRadiusM ?? 850));
  const span = Number(options.previewSpanM) > 0 ? Number(options.previewSpanM) : oceanR * 2;
  const rimFadeM = Number(options.oceanFoamRimFadeM ?? 48);
  const seed = Math.round(Number(options.materialSeed ?? options.seed ?? 1337)) || 1337;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const p = (row * width + col) * 4;
      if (data[p + 3] < 8 && data[p] + data[p + 1] + data[p + 2] < 12) continue;

      const x = (col / Math.max(1, width - 1) - 0.5) * span;
      const z = (row / Math.max(1, height - 1) - 0.5) * span;
      const radial = Math.hypot(x, z);
      const rimFactor = oceanDiscRimFade(radial, oceanR, rimFadeM);

      if (waveStrength > 0 && rimFactor > 0.02) {
        const wave = fbmWorld(x, z, waveScaleM, seed + 101);
        const crest = Math.max(0, wave - 0.12);
        const glint = crest * waveStrength * 0.55 * rimFactor;
        data[p] = Math.min(255, Math.round(data[p] + glint * 75));
        data[p + 1] = Math.min(255, Math.round(data[p + 1] + glint * 95));
        data[p + 2] = Math.min(255, Math.round(data[p + 2] + glint * 65));
      }

      if (foamData) {
        let foam = (foamData[p] / 255) * rimFactor;
        if (foam > 0.02) {
          data[p] = Math.round(data[p] * (1 - foam) + 245 * foam);
          data[p + 1] = Math.round(data[p + 1] * (1 - foam) + 252 * foam);
          data[p + 2] = Math.round(data[p + 2] * (1 - foam) + 255 * foam);
        }
      }
    }
  }
}

export async function buildWaterSurfaceTextureUrl(
  waterColorUrl,
  foamMaskUrl,
  options = {},
  waterMaskUrl = '',
) {
  const depthImg = await loadImage(waterColorUrl);
  const w = depthImg.width;
  const h = depthImg.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(depthImg, 0, 0);
  const imgData = ctx.getImageData(0, 0, w, h);

  let foamData = null;
  if (foamMaskUrl) {
    const foamImg = await loadImage(foamMaskUrl);
    const fc = document.createElement('canvas');
    fc.width = w;
    fc.height = h;
    const fctx = fc.getContext('2d');
    fctx.drawImage(foamImg, 0, 0, w, h);
    foamData = fctx.getImageData(0, 0, w, h).data;
  }

  applySurfaceOverlays(imgData, foamData, options, w, h);

  if (waterMaskUrl) {
    const maskImg = await loadImage(waterMaskUrl);
    const mc = document.createElement('canvas');
    mc.width = w;
    mc.height = h;
    const mctx = mc.getContext('2d');
    mctx.drawImage(maskImg, 0, 0, w, h);
    const maskData = mctx.getImageData(0, 0, w, h).data;
    const data = imgData.data;
    for (let i = 0; i < w * h; i++) {
      const p = i * 4;
      if (maskData[p] < 10) data[p + 3] = 0;
      else data[p + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}
