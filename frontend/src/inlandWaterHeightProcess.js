/**
 * Heightmap-level inland water: classify lakes / rivers / waterfalls and reshape terrain.
 * Reusable for path flattening later (same mask → height ops pattern).
 */

import { minLakeAreaCells } from './waterLakeFlatten.js';
import { getIslandHorizonScale } from './worldSettings.js';

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Soft mask: cell counts as water for carving / connectivity. */
export const MASK_CARVE_MIN = 6;
export const MASK_CONNECT_THRESHOLD = 16;
export const MASK_LAND_THRESHOLD = 20;

/** 8-connected water blobs (uses low threshold so blurred river masks stay connected). */
export function findWaterComponents(mask, rows, cols, minArea = 3, waterThreshold = MASK_CONNECT_THRESHOLD) {
  const seen = new Uint8Array(rows * cols);
  const components = [];
  let nextId = 0;
  const t = Math.max(1, Number(waterThreshold) || MASK_CONNECT_THRESHOLD);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const start = r * cols + c;
      if (mask[start] < t || seen[start]) continue;

      const stack = [start];
      const pixels = [];
      seen[start] = 1;
      let minR = r;
      let maxR = r;
      let minC = c;
      let maxC = c;

      while (stack.length) {
        const idx = stack.pop();
        pixels.push(idx);
        const rr = (idx / cols) | 0;
        const cc = idx % cols;
        minR = Math.min(minR, rr);
        maxR = Math.max(maxR, rr);
        minC = Math.min(minC, cc);
        maxC = Math.max(maxC, cc);

        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = rr + dr;
            const nc = cc + dc;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
            const ni = nr * cols + nc;
            if (mask[ni] >= t && !seen[ni]) {
              seen[ni] = 1;
              stack.push(ni);
            }
          }
        }
      }

      if (pixels.length < minArea) continue;
      const width = maxC - minC + 1;
      const height = maxR - minR + 1;
      components.push({
        id: nextId++,
        pixels,
        area: pixels.length,
        minR,
        maxR,
        minC,
        maxC,
        width,
        height,
        aspect: Math.max(width, height) / Math.max(1, Math.min(width, height)),
      });
    }
  }
  components.sort((a, b) => b.area - a.area);
  return components;
}

function componentHeightStats(comp, heightsNorm, rows, cols, maxHeightM) {
  const vals = comp.pixels.map((i) => heightsNorm[i] ?? 0);
  vals.sort((a, b) => a - b);
  const minH = vals[0] ?? 0;
  const maxH = vals[vals.length - 1] ?? 0;
  const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  const dropM = (maxH - minH) * maxHeightM;
  const lengthPx = Math.max(comp.width, comp.height, 1);
  const mpp = maxHeightM > 0 ? maxHeightM / Math.max(1, Math.max(rows, cols)) : 1;
  const grade = dropM / Math.max(1, lengthPx * mpp * 0.5);
  return {
    minNorm: minH,
    maxNorm: maxH,
    meanNorm: mean,
    medianNorm: vals[Math.floor(vals.length / 2)] ?? mean,
    dropM,
    grade,
  };
}

function buildComponentAdjacency(components, rows, cols) {
  const label = new Int32Array(rows * cols).fill(-1);
  for (const comp of components) {
    for (const idx of comp.pixels) label[idx] = comp.id;
  }
  const adj = new Map();
  for (const comp of components) adj.set(comp.id, new Set());

  for (const comp of components) {
    for (const idx of comp.pixels) {
      const rr = (idx / cols) | 0;
      const cc = idx % cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = rr + dr;
          const nc = cc + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const other = label[nr * cols + nc];
          if (other >= 0 && other !== comp.id) {
            adj.get(comp.id).add(other);
            adj.get(other).add(comp.id);
          }
        }
      }
    }
  }
  return adj;
}

/** Shrink lake flatten region inward so banks stay natural. */
function lakeCorePixels(comp, rows, cols, erosionCells = 1) {
  if (erosionCells <= 0 || comp.area < 24) return comp.pixels;

  const set = new Set(comp.pixels);
  const core = [];
  for (const idx of comp.pixels) {
    const rr = (idx / cols) | 0;
    const cc = idx % cols;
    let border = false;
    for (let dr = -erosionCells; dr <= erosionCells && !border; dr++) {
      for (let dc = -erosionCells; dc <= erosionCells && !border; dc++) {
        if (Math.abs(dr) + Math.abs(dc) > erosionCells) continue;
        const nr = rr + dr;
        const nc = cc + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || !set.has(nr * cols + nc)) {
          border = true;
        }
      }
    }
    if (!border) core.push(idx);
  }
  return core.length >= Math.max(8, Math.floor(comp.area * 0.25)) ? core : comp.pixels;
}

export function classifyInlandWaterComponents(components, adjacency, heightsNorm, rows, cols, options = {}) {
  const {
    largeWaterAreaPx = 2500,
    overlayW = cols,
    overlayH = rows,
    lakeMaxDropM = 2,
    waterfallDropM = 18,
    fastRiverGrade = 0.25,
    maxHeightM = 500,
  } = options;

  const minLakeArea = minLakeAreaCells(largeWaterAreaPx, overlayW, overlayH, cols, rows);
  const classifications = new Map();
  const statsById = new Map();

  for (const comp of components) {
    statsById.set(comp.id, componentHeightStats(comp, heightsNorm, rows, cols, maxHeightM));
  }

  for (const comp of components) {
    const stats = statsById.get(comp.id);
    if (comp.area >= minLakeArea && comp.aspect < 3.5 && stats.dropM <= lakeMaxDropM * 1.5) {
      classifications.set(comp.id, 'lake');
    }
  }

  for (const comp of components) {
    if (classifications.has(comp.id)) continue;
    const stats = statsById.get(comp.id);
    const neighbors = [...(adjacency.get(comp.id) || [])];
    const touchesLake = neighbors.some((id) => classifications.get(id) === 'lake');
    const elongated = comp.aspect >= 1.35;

    if (stats.dropM >= waterfallDropM && stats.grade >= fastRiverGrade * 0.85) {
      classifications.set(comp.id, 'waterfall');
    } else if (
      touchesLake
      || elongated
      || comp.area < minLakeArea
    ) {
      classifications.set(comp.id, 'river');
    } else if (
      comp.area >= minLakeArea * 0.35
      && stats.dropM <= lakeMaxDropM * 2
      && comp.aspect < 2.5
    ) {
      classifications.set(comp.id, 'lake');
    }
  }

  // Any remaining painted water defaults to river channel (not skipped).
  for (const comp of components) {
    if (!classifications.has(comp.id) && comp.area >= 3) {
      classifications.set(comp.id, 'river');
    }
  }

  return { classifications, statsById, minLakeArea };
}

/** Land height outside the soft water fringe — expand search until dry ground is found. */
function sampleBankHeight(
  heightsSource,
  waterMask,
  rows,
  cols,
  idx,
  maxRadius = 14,
  landThreshold = MASK_LAND_THRESHOLD,
) {
  const rr = (idx / cols) | 0;
  const cc = idx % cols;
  let bankH = -1;

  for (let R = 1; R <= maxRadius; R++) {
    for (let dr = -R; dr <= R; dr++) {
      for (let dc = -R; dc <= R; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== R) continue;
        const nr = rr + dr;
        const nc = cc + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const ni = nr * cols + nc;
        if ((waterMask[ni] ?? 0) >= landThreshold) continue;
        bankH = Math.max(bankH, heightsSource[ni] ?? 0);
      }
    }
    if (bankH >= 0) return bankH;
  }

  // Lake interior / very wide water: use local high rim in a wider ring.
  for (let dr = -maxRadius; dr <= maxRadius; dr++) {
    for (let dc = -maxRadius; dc <= maxRadius; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = rr + dr;
      const nc = cc + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      bankH = Math.max(bankH, heightsSource[nr * cols + nc] ?? 0);
    }
  }
  return bankH < 0 ? (heightsSource[idx] ?? 0) : bankH;
}

/** Carve using soft mask coverage so blurred river centers still cut depth. */
function applyMaskDrivenRiverCarve(
  heightsSource,
  heightsOut,
  carveMask,
  labelMask,
  rows,
  cols,
  riverDepthNorm,
  riverChannelStrength,
  carveMin = MASK_CARVE_MIN,
) {
  if (riverDepthNorm <= 0 || riverChannelStrength <= 0 || !carveMask?.length) return 0;
  let changed = 0;
  for (let idx = 0; idx < carveMask.length; idx++) {
    const coverage = carveMask[idx] / 255;
    if (coverage < carveMin / 255) continue;
    if (labelMask[idx] === 1 || labelMask[idx] === 3) continue;

    const h = heightsSource[idx];
    const bankH = sampleBankHeight(heightsSource, carveMask, rows, cols, idx);
    const depth = riverDepthNorm * clamp(0.35 + coverage * 0.85, 0.2, 1);
    const target = Math.max(0, bankH - depth);
    if (h <= target + 1e-6) continue;

    const strength = riverChannelStrength * clamp(0.4 + coverage * 0.9, 0.35, 1);
    const before = heightsOut[idx];
    blendHeight(heightsSource, heightsOut, idx, Math.min(h, target), strength);
    if (Math.abs(heightsOut[idx] - before) > 1e-5) {
      changed++;
      if (labelMask[idx] === 0) labelMask[idx] = 2;
    }
  }
  return changed;
}

function blendHeight(src, dst, idx, target, strength) {
  const s = clamp(strength, 0, 2.5);
  dst[idx] = src[idx] * (1 - Math.min(1, s)) + target * Math.min(1, s);
}

/** Flatten toward a shelf; strength 1 = full removal of excess, >1 pulls extra depth. */
function applyLakeFlattenAt(heightsSource, heightsOut, idx, h, flatLevel, strength, lakeDepthNorm) {
  const s = clamp(Number(strength) || 0, 0, 2.5);
  if (h <= flatLevel) return;
  const excess = h - flatLevel;
  const extraDepth = Math.max(0, s - 1) * lakeDepthNorm;
  const target = Math.max(0, flatLevel - extraDepth);
  const reduction = excess * Math.min(1, s) + extraDepth;
  heightsOut[idx] = Math.max(target, h - reduction);
}

/**
 * Apply lake flatten, river channels, and waterfall notches on a normalized height field.
 */
export function processInlandWaterHeights(
  heightsSource,
  rows,
  cols,
  waterMask,
  options = {},
) {
  const heightsOut = Float32Array.from(heightsSource);
  const features = [];
  const empty = {
    heights: heightsOut,
    summary: { lakes: 0, rivers: 0, waterfalls: 0, ponds: 0, changedPixels: 0 },
    features,
    labelMask: new Uint8Array(rows * cols),
  };

  if (!waterMask?.length || !heightsSource?.length) return empty;

  const carveMask = options.carveMask?.length ? options.carveMask : waterMask;
  const classifyMask = options.classifyMask?.length ? options.classifyMask : carveMask;
  const components = findWaterComponents(classifyMask, rows, cols, 3, 32);
  const adjacency = components.length ? buildComponentAdjacency(components, rows, cols) : new Map();
  const { classifications, statsById, minLakeArea } = components.length
    ? classifyInlandWaterComponents(components, adjacency, heightsSource, rows, cols, options)
    : { classifications: new Map(), statsById: new Map(), minLakeArea: 0 };

  const {
    lakeDepthM = 0.75,
    lakeFlattenStrength = 0.55,
    riverCarveDepthM = 1.5,
    riverChannelStrength = 0.65,
    waterfallDropM = 18,
    waterfallCarveStrength = 0.75,
    maxHeightM = 500,
    lakeCoreErosionCells = 1,
  } = options;

  const lakeDepthNorm = lakeDepthM / Math.max(1, maxHeightM);
  const riverDepthNorm = riverCarveDepthM / Math.max(1, maxHeightM);
  const waterfallDepthNorm = waterfallDropM / Math.max(1, maxHeightM);
  const labelMask = new Uint8Array(rows * cols);
  let changedPixels = 0;
  const summary = { lakes: 0, rivers: 0, waterfalls: 0, ponds: 0, changedPixels: 0 };

  for (const comp of components) {
    const kind = classifications.get(comp.id);
    if (!kind) continue;
    const stats = statsById.get(comp.id);
    summary[kind === 'lake' ? 'lakes' : kind === 'river' ? 'rivers' : kind === 'waterfall' ? 'waterfalls' : 'ponds'] += 1;

    if (kind === 'lake') {
      const core = lakeCorePixels(comp, rows, cols, lakeCoreErosionCells);
      const coreVals = core.map((i) => heightsSource[i]).sort((a, b) => a - b);
      const median = coreVals[Math.floor(coreVals.length / 2)] ?? stats.medianNorm;
      const flatLevel = Math.max(0, median - lakeDepthNorm);
      for (const idx of comp.pixels) labelMask[idx] = 1;

      for (const idx of core) {
        const h = heightsSource[idx];
        if (h <= flatLevel && lakeFlattenStrength <= 1) continue;
        const before = heightsOut[idx];
        applyLakeFlattenAt(heightsSource, heightsOut, idx, h, flatLevel, lakeFlattenStrength, lakeDepthNorm);
        if (Math.abs(heightsOut[idx] - before) > 1e-5) changedPixels++;
      }
    } else if (kind === 'river') {
      for (const idx of comp.pixels) {
        if (labelMask[idx] === 0) labelMask[idx] = 2;
      }
    } else if (kind === 'waterfall') {
      let crestIdx = comp.pixels[0];
      let maxDrop = 0;
      for (const idx of comp.pixels) {
        const rr = (idx / cols) | 0;
        const cc = idx % cols;
        const h = heightsSource[idx];
        let localDrop = 0;
        if (rr > 0) localDrop = Math.max(localDrop, h - (heightsSource[idx - cols] ?? h));
        if (rr < rows - 1) localDrop = Math.max(localDrop, h - (heightsSource[idx + cols] ?? h));
        if (cc > 0) localDrop = Math.max(localDrop, h - (heightsSource[idx - 1] ?? h));
        if (cc < cols - 1) localDrop = Math.max(localDrop, h - (heightsSource[idx + 1] ?? h));
        if (localDrop > maxDrop) {
          maxDrop = localDrop;
          crestIdx = idx;
        }
      }

      for (const idx of comp.pixels) {
        labelMask[idx] = 3;
        const extra = idx === crestIdx ? waterfallDepthNorm * 0.45 : waterfallDepthNorm * 0.2;
        const target = Math.max(0, heightsSource[idx] - riverDepthNorm - extra);
        const before = heightsOut[idx];
        blendHeight(heightsSource, heightsOut, idx, Math.min(heightsSource[idx], target), waterfallCarveStrength);
        if (Math.abs(heightsOut[idx] - before) > 1e-5) changedPixels++;
      }

      const rr = (crestIdx / cols) | 0;
      const cc = crestIdx % cols;
      features.push({
        kind: 'waterfall',
        componentId: comp.id,
        row: rr,
        col: cc,
        xNorm: cc / Math.max(1, cols - 1),
        yNorm: rr / Math.max(1, rows - 1),
        dropM: stats.dropM,
        grade: stats.grade,
        areaPx: comp.area,
      });
    }
  }

  // Primary river carve: soft smoothed mask (no slim), weighted by coverage.
  const riverCells = applyMaskDrivenRiverCarve(
    heightsSource,
    heightsOut,
    carveMask,
    labelMask,
    rows,
    cols,
    riverDepthNorm,
    riverChannelStrength,
  );
  if (riverCells > 0) {
    changedPixels += riverCells;
    if (summary.rivers === 0) summary.rivers = 1;
  }

  summary.changedPixels = changedPixels;
  summary.minLakeAreaCells = minLakeArea;
  return { heights: heightsOut, summary, features, labelMask, classifications, components };
}

/** Build processor options from water overlay layers + world scale. */
export function inlandWaterProcessOptionsFromLayers(layers = [], worldSettings = {}, mapSizePx = {}, maxHeightM = 500) {
  const active = (layers || []).filter((l) => l.kind === 'water' && l.enabled !== false && l.url);
  if (!active.length) return null;

  const scale = getIslandHorizonScale(worldSettings);
  return {
    largeWaterAreaPx: Math.min(...active.map((l) => Number(l.largeWaterAreaPx ?? 2500))),
    lakeDepthM: Math.max(...active.map((l) => Number(l.lakeDepthM ?? 0.75 * scale))),
    lakeFlattenStrength: Math.max(...active.map((l) => Number(l.lakeFlattenStrength ?? 1))),
    riverMaskSmoothPx: Math.max(...active.map((l) => Number(l.maskSmoothPx ?? 3))),
    riverSlimPx: Math.max(...active.map((l) => Number(l.riverSlimPx ?? 0))),
    riverCarveDepthM: Math.max(...active.map((l) => Number(l.carveDepthM ?? 1.5 * scale))),
    riverChannelStrength: Math.max(...active.map((l) => Number(l.riverChannelStrength ?? 0.65))),
    waterfallDropM: Math.max(...active.map((l) => Number(l.waterfallDropM ?? 18 * scale))),
    waterfallCarveStrength: Math.max(...active.map((l) => Number(l.waterfallCarveStrength ?? 0.75))),
    lakeMaxDropM: Math.max(...active.map((l) => Number(l.lakeMaxDropM ?? 2 * scale))),
    fastRiverGrade: Math.min(...active.map((l) => Number(l.fastRiverGrade ?? 0.25))),
    maxHeightM: Number(maxHeightM || 500),
    overlayW: mapSizePx?.width || 1024,
    overlayH: mapSizePx?.height || mapSizePx?.width || 1024,
    lakeCoreErosionCells: Math.max(1, Math.round(Math.min(...active.map((l) => Number(l.lakeCoreErosionCells ?? 1))))),
    sandBankAmount: Math.max(...active.map((l) => Number(l.sandBankAmount ?? 0))),
  };
}
