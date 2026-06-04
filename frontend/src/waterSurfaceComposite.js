/**
 * Water layer textures for 3D viewport.
 */

import { isDryLandM, isWetAtWorld } from './waterMaskFromHeights.js';
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

/** Normalized wave-crest height at world coords (0 = trough, higher = peak). */
export function waveCrestAt(wx, wz, ocean) {
  const waveScaleM = Math.max(8, Number(ocean.waterNoiseScaleM ?? 85));
  const seed = Math.round(Number(ocean.materialSeed ?? ocean.seed ?? 1337)) || 1337;
  const wave = fbmWorld(wx, wz, waveScaleM, seed + 101);
  return Math.max(0, wave - 0.12);
}

/**
 * White foam amount from procedural wave crests (not a shore surf line).
 * shoreFactor: 0..1 multiplier — use distance-from-shore fade so open water is full strength.
 */
export function computeWaveCrestFoam(wx, wz, ocean, rimFactor, shoreFactor = 1) {
  const waveStrength = Number(ocean.waterNoiseStrength ?? 0.1);
  const foamStrength = Math.max(0, Number(ocean.foamStrength ?? 0.2));
  if (rimFactor <= 0.02) return 0;
  if (waveStrength <= 0 && foamStrength <= 0) return 0;

  const crest = waveCrestAt(wx, wz, ocean);
  if (crest <= 0) return 0;

  const mix = crest * Math.max(0.05, waveStrength) * 4 * rimFactor * Math.max(0.15, foamStrength * 2.5);
  return Math.min(1, mix * Math.max(0, Math.min(1, shoreFactor)));
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

function smoothstepF(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Distance-to-land field (meters) — used only to fade crest foam near the coast. */
function landDistanceFieldM(heights, cols, rows, seaLevelM, maxH, worldSettings, mpp) {
  const INF = (cols + rows) * 2;
  const dist = new Float32Array(cols * rows);
  for (let i = 0; i < dist.length; i++) {
    dist[i] = isDryLandM(heights, i, seaLevelM, maxH, worldSettings) ? 0 : INF;
  }
  const D = 1.41421356;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const p = y * cols + x;
      if (x > 0) dist[p] = Math.min(dist[p], dist[p - 1] + 1);
      if (y > 0) dist[p] = Math.min(dist[p], dist[p - cols] + 1);
      if (x > 0 && y > 0) dist[p] = Math.min(dist[p], dist[p - cols - 1] + D);
      if (x < cols - 1 && y > 0) dist[p] = Math.min(dist[p], dist[p - cols + 1] + D);
    }
  }
  for (let y = rows - 1; y >= 0; y--) {
    for (let x = cols - 1; x >= 0; x--) {
      const p = y * cols + x;
      if (x < cols - 1) dist[p] = Math.min(dist[p], dist[p + 1] + 1);
      if (y < rows - 1) dist[p] = Math.min(dist[p], dist[p + cols] + 1);
      if (x < cols - 1 && y < rows - 1) dist[p] = Math.min(dist[p], dist[p + cols + 1] + D);
      if (x > 0 && y < rows - 1) dist[p] = Math.min(dist[p], dist[p + cols - 1] + D);
    }
  }
  const m = Math.max(1e-6, mpp);
  for (let i = 0; i < dist.length; i++) dist[i] *= m;
  return dist;
}

function sampleFieldBilinear(field, cols, rows, cf, rf) {
  const c0 = Math.max(0, Math.min(cols - 1, Math.floor(cf)));
  const r0 = Math.max(0, Math.min(rows - 1, Math.floor(rf)));
  const c1 = Math.min(cols - 1, c0 + 1);
  const r1 = Math.min(rows - 1, r0 + 1);
  const tx = Math.max(0, Math.min(1, cf - c0));
  const ty = Math.max(0, Math.min(1, rf - r0));
  const top = field[r0 * cols + c0] * (1 - tx) + field[r0 * cols + c1] * tx;
  const bot = field[r1 * cols + c0] * (1 - tx) + field[r1 * cols + c1] * tx;
  return top * (1 - ty) + bot * ty;
}

/** Bilinear sample of the shore-distance map (red channel) back to meters. */
function sampleDistanceM(distData, fw, fh, cf, rf, maxDistM) {
  const c0 = Math.max(0, Math.min(fw - 1, Math.floor(cf)));
  const r0 = Math.max(0, Math.min(fh - 1, Math.floor(rf)));
  const c1 = Math.min(fw - 1, c0 + 1);
  const r1 = Math.min(fh - 1, r0 + 1);
  const tx = Math.max(0, Math.min(1, cf - c0));
  const ty = Math.max(0, Math.min(1, rf - r0));
  const v00 = distData[(r0 * fw + c0) * 4];
  const v10 = distData[(r0 * fw + c1) * 4];
  const v01 = distData[(r1 * fw + c0) * 4];
  const v11 = distData[(r1 * fw + c1) * 4];
  const top = v00 * (1 - tx) + v10 * tx;
  const bot = v01 * (1 - tx) + v11 * tx;
  return ((top * (1 - ty) + bot * ty) / 255) * maxDistM;
}

/** World-space shore distance with outward extension past the map edge (matches band padding). */
function distanceAtWorldM(wx, wz, widthM, depthM, cols, rows, mppX, mppZ, maxDistM, distData, landField) {
  const gc = (wx / widthM + 0.5) * Math.max(1, cols - 1);
  const gr = (wz / depthM + 0.5) * Math.max(1, rows - 1);
  const inside = gc >= 0 && gc <= cols - 1 && gr >= 0 && gr <= rows - 1;

  if (inside) {
    if (landField) return sampleFieldBilinear(landField, cols, rows, gc, gr);
    if (distData && maxDistM > 0) return sampleDistanceM(distData, cols, rows, gc, gr, maxDistM);
    return 0;
  }

  const cc = Math.max(0, Math.min(cols - 1, gc));
  const cr = Math.max(0, Math.min(rows - 1, gr));
  const dx = (gc - cc) * mppX;
  const dz = (gr - cr) * mppZ;
  let borderDistM = 0;
  if (landField) {
    borderDistM = sampleFieldBilinear(landField, cols, rows, cc, cr);
  } else if (distData && maxDistM > 0) {
    borderDistM = sampleDistanceM(distData, cols, rows, cc, cr, maxDistM);
  }
  return borderDistM + Math.hypot(dx, dz);
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
  padPxX = 0,
  padPxZ = 0,
  discRadiusM = 0,
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
    // Read the island-sized shore-distance map into an inner buffer...
    const distImg = await loadImage(shoreDistanceUrl);
    const distCanvas = document.createElement('canvas');
    distCanvas.width = cols;
    distCanvas.height = rows;
    const dctx = distCanvas.getContext('2d', { willReadFrequently: true });
    dctx.drawImage(distImg, 0, 0, cols, rows);
    const distData = dctx.getImageData(0, 0, cols, rows).data;

    // ...then paint into a padded canvas so deep bands can finish past the world rect.
    const padX = Math.max(0, Math.round(padPxX));
    const padZ = Math.max(0, Math.round(padPxZ));
    const mppX = mapW / Math.max(1, cols);
    const mppZ = mapD / Math.max(1, rows);
    const outW = cols + 2 * padX;
    const outH = rows + 2 * padZ;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const octx = outCanvas.getContext('2d', { willReadFrequently: true });
    const out = octx.createImageData(outW, outH);
    const data = out.data;

    // Clip the band texture to the deep-ocean disc so the round ocean edge is kept
    // even though the plane that carries it is a (padded) rectangle.
    const centerC = (outW - 1) / 2;
    const centerR = (outH - 1) / 2;
    const discR = Number(discRadiusM) || 0;

    for (let pr = 0; pr < outH; pr++) {
      for (let pc = 0; pc < outW; pc++) {
        const p = (pr * outW + pc) * 4;
        const ic = pc - padX;
        const ir = pr - padZ;
        const inside = ic >= 0 && ic < cols && ir >= 0 && ir < rows;

        if (discR > 0) {
          const wx = (pc - centerC) * mppX;
          const wz = (pr - centerR) * mppZ;
          if (Math.hypot(wx, wz) > discR) {
            data[p + 3] = 0;
            continue;
          }
        }

        let distM;
        if (inside) {
          const idx = ir * cols + ic;
          if (isDryLandM(heights, idx, seaLevelM, maxH, worldSettings)) {
            data[p + 3] = 0;
            continue;
          }
          distM = (distData[idx * 4] / 255) * maxDistM;
        } else {
          // Padding ring: clamp to the nearest island-edge pixel and walk the
          // remaining distance outward so the depth gradient keeps growing.
          const cc = Math.max(0, Math.min(cols - 1, ic));
          const cr2 = Math.max(0, Math.min(rows - 1, ir));
          const borderDistM = (distData[(cr2 * cols + cc) * 4] / 255) * maxDistM;
          const dx = (ic - cc) * mppX;
          const dz = (ir - cr2) * mppZ;
          distM = borderDistM + Math.hypot(dx, dz);
        }

        const bathy01 = bathy01FromDistanceM(distM, edges);
        const [cr, cg, cb] = sampleWaterColor(bathy01, smooth);
        data[p] = cr;
        data[p + 1] = cg;
        data[p + 2] = cb;
        data[p + 3] = 255;
      }
    }

    octx.putImageData(out, 0, 0);
    return outCanvas.toDataURL('image/png');
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
  shoreDistanceUrl = '',
  shoreDistanceMaxM = 0,
  heights = null,
}) {
  const discR = Math.max(50, discRadiusM);
  const discD = discR * 2;
  const widthM = mapW || Number(worldSettings.widthM || 1480);
  const depthM = mapD || Number(worldSettings.depthM || 1086);
  const rimFadeM = Number(ocean.oceanFoamRimFadeM ?? 48);
  const shoreFadeM = Math.max(0, Number(ocean.foamWidthM ?? 12));
  const maxH = getWorldMaxHeightM(maxHeightM, worldSettings);

  const mppX = widthM / Math.max(1, cols);
  const mppZ = depthM / Math.max(1, rows);
  const mpp = Math.max(0.25, (mppX + mppZ) * 0.5);
  const size = Math.max(512, Math.min(2048, Math.round(discD / mpp)));

  // Optional shore-distance field — only used to fade crest foam near the coast (not to draw a surf ring).
  let distData = null;
  let landField = null;
  const maxDistM = Number(shoreDistanceMaxM) > 0
    ? Number(shoreDistanceMaxM)
    : maxShoreDistanceScaleM(worldSettings, mapSizePx, ocean);

  if (shoreFadeM > 0) {
    if (shoreDistanceUrl && maxDistM > 0) {
      const distImg = await loadImage(shoreDistanceUrl);
      const dc = document.createElement('canvas');
      dc.width = cols;
      dc.height = rows;
      const dctx = dc.getContext('2d', { willReadFrequently: true });
      dctx.drawImage(distImg, 0, 0, cols, rows);
      distData = dctx.getImageData(0, 0, cols, rows).data;
    } else if (heights?.length >= cols * rows && cols > 1 && rows > 1) {
      let hasLandSeeds = false;
      for (let i = 0; i < cols * rows; i++) {
        if (isDryLandM(heights, i, seaLevelM, maxH, worldSettings)) {
          hasLandSeeds = true;
          break;
        }
      }
      if (hasLandSeeds) {
        landField = landDistanceFieldM(heights, cols, rows, seaLevelM, maxH, worldSettings, mpp);
      }
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  const data = img.data;
  let foamPixelCount = 0;

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

      if (heights?.length >= cols * rows) {
        if (!isWetAtWorld(wx, wz, rows, cols, heights, seaLevelM, maxH, worldSettings, mapSizePx, ocean)) {
          data[p + 3] = 0;
          continue;
        }
      }

      const rimFactor = oceanDiscRimFade(radial, discR, rimFadeM);

      let shoreFactor = 1;
      if (shoreFadeM > 0 && (distData || landField)) {
        const distM = distanceAtWorldM(
          wx,
          wz,
          widthM,
          depthM,
          cols,
          rows,
          mppX,
          mppZ,
          maxDistM,
          distData,
          landField,
        );
        shoreFactor = smoothstepF(0, shoreFadeM, Number.isFinite(distM) ? distM : shoreFadeM);
      }

      const foam = computeWaveCrestFoam(wx, wz, ocean, rimFactor, shoreFactor);

      if (foam < 0.02) {
        data[p + 3] = 0;
        continue;
      }

      data[p] = 255;
      data[p + 1] = 255;
      data[p + 2] = 255;
      data[p + 3] = Math.round(Math.min(255, foam * 255));
      foamPixelCount += 1;
    }
  }

  if (foamPixelCount === 0) {
    console.warn(
      'Foam layer texture is empty — raise Wave noise / Foam strength in the Water step.',
      { shoreFadeM, hasDistanceField: !!(distData || landField) },
    );
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

export function applySurfaceOverlays(imgData, foamData, options, width, height) {
  const data = imgData.data;
  const waveStrength = Number(options.waterNoiseStrength ?? 0.1);
  const oceanR = Math.max(50, Number(options.oceanRadiusM ?? 850));
  const span = Number(options.previewSpanM) > 0 ? Number(options.previewSpanM) : oceanR * 2;
  const rimFadeM = Number(options.oceanFoamRimFadeM ?? 48);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const p = (row * width + col) * 4;
      if (data[p + 3] < 8 && data[p] + data[p + 1] + data[p + 2] < 12) continue;

      const x = (col / Math.max(1, width - 1) - 0.5) * span;
      const z = (row / Math.max(1, height - 1) - 0.5) * span;
      const radial = Math.hypot(x, z);
      const rimFactor = oceanDiscRimFade(radial, oceanR, rimFadeM);

      if (waveStrength > 0 && rimFactor > 0.02) {
        const crest = waveCrestAt(x, z, options);
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
