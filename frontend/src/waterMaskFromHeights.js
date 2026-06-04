import { elevationMetersFromNormalized, getOceanDiscRadiusM, getWorldMaxHeightM } from './worldSettings.js';

/** Terrain mesh / procedural texture: land above sea + 0.14 m. */
export function isLandVertexM(heights, idx, seaLevelM, maxHeightM, worldSettings) {
  const y = elevationMetersFromNormalized(heights[idx], maxHeightM, worldSettings);
  return y > Number(seaLevelM || 0) + 0.14;
}

/** Match backend bathymetry: dry land = height above sea + 0.25 m (not morphological fill). */
export function isDryLandM(heights, idx, seaLevelM, maxHeightM, worldSettings) {
  const y = elevationMetersFromNormalized(heights[idx], maxHeightM, worldSettings);
  return y > Number(seaLevelM || 0) + 0.25;
}

export function isWetAtWorld(
  wx,
  wz,
  rows,
  cols,
  heights,
  seaLevelM,
  maxHeightM,
  worldSettings,
  mapSizePx,
  oceanSettings,
) {
  const widthM = Number(worldSettings?.widthM || 1480);
  const depthM = Number(worldSettings?.depthM || 1086);
  const radial = Math.hypot(wx, wz);
  const discR = getOceanDiscRadiusM(worldSettings, mapSizePx, oceanSettings);
  if (radial > discR) return false;
  const col = (wx / widthM + 0.5) * (cols - 1);
  const row = (wz / depthM + 0.5) * (rows - 1);
  const c = Math.round(col);
  const r = Math.round(row);
  if (c < 0 || c >= cols || r < 0 || r >= rows) {
    return radial <= discR;
  }
  const idx = r * cols + c;
  return !isDryLandM(heights, idx, seaLevelM, maxHeightM, worldSettings);
}

export function isWetAtCell(rows, cols, heights, r, c, seaLevelM, maxHeightM, worldSettings, mapSizePx, oceanSettings) {
  const widthM = Number(worldSettings?.widthM || 1480);
  const depthM = Number(worldSettings?.depthM || 1086);
  const wx = (c / Math.max(1, cols - 1) - 0.5) * widthM;
  const wz = (r / Math.max(1, rows - 1) - 0.5) * depthM;
  return isWetAtWorld(wx, wz, rows, cols, heights, seaLevelM, maxHeightM, worldSettings, mapSizePx, oceanSettings);
}

/**
 * Heightmap-aligned wet mask (for exports / previews on the map grid).
 */
export function buildRuntimeWaterMaskDataUrl(
  heights,
  rows,
  cols,
  seaLevelM,
  maxHeightM,
  worldSettings,
  oceanSettings = {},
  mapSizePx = {},
) {
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(cols, rows);
  const data = img.data;
  const maxH = getWorldMaxHeightM(maxHeightM, worldSettings);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wet = isWetAtCell(rows, cols, heights, r, c, seaLevelM, maxH, worldSettings, mapSizePx, oceanSettings);
      const p = (r * cols + c) * 4;
      const v = wet ? 255 : 0;
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
      data[p + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Land cutout for the ocean disc — uses CircleGeometry's default radial UVs (0.5,0.5), NOT heightmap UVs.
 */
export function buildDiscLandAlphaUrl(
  discRadiusM,
  rows,
  cols,
  heights,
  seaLevelM,
  maxHeightM,
  worldSettings,
  oceanSettings,
  mapSizePx,
  sizePx = 256,
) {
  const canvas = document.createElement('canvas');
  canvas.width = sizePx;
  canvas.height = sizePx;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(sizePx, sizePx);
  const data = img.data;
  const maxH = getWorldMaxHeightM(maxHeightM, worldSettings);
  const d = discRadiusM * 2;

  for (let row = 0; row < sizePx; row++) {
    for (let col = 0; col < sizePx; col++) {
      const p = (row * sizePx + col) * 4;
      const u = col / Math.max(1, sizePx - 1);
      const v = row / Math.max(1, sizePx - 1);
      const wx = (u - 0.5) * d;
      const wz = (v - 0.5) * d;
      if (Math.hypot(wx, wz) > discRadiusM) {
        data[p + 3] = 0;
        continue;
      }
      const wet = isWetAtWorld(
        wx,
        wz,
        rows,
        cols,
        heights,
        seaLevelM,
        maxH,
        worldSettings,
        mapSizePx,
        oceanSettings,
      );
      const a = wet ? 255 : 0;
      data[p] = a;
      data[p + 1] = a;
      data[p + 2] = a;
      data[p + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}
