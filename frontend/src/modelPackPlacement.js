/**
 * Generic deterministic placement evaluator for GLB model packs.
 */

import { elevationMetersFromNormalized, getIslandHorizonScale } from './worldSettings.js';
import {
  materialIdFromName,
  resolvePlacementRules,
} from './modelPackSettings.js';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export function hashNoise(x, y, seed = 0) {
  const n = Math.sin((x * 127.1 + y * 311.7 + seed * 74.7)) * 43758.5453;
  return n - Math.floor(n);
}

function getWorldDims(rows, cols, world = {}) {
  const width = Math.max(50, Number(world?.widthM || 1480));
  const depth = Math.max(50, Number(world?.depthM || (width * rows / Math.max(1, cols))));
  return { width, depth };
}

function heightAt(heights, rows, cols, r, c) {
  const rr = clamp(Math.round(r), 0, rows - 1);
  const cc = clamp(Math.round(c), 0, cols - 1);
  return heights[rr * cols + cc] || 0;
}

function slopeAt(heights, rows, cols, r, c, maxH, world) {
  const worldMaxH = maxH * getIslandHorizonScale(world);
  const { width, depth } = getWorldDims(rows, cols, world);
  const cellX = width / Math.max(1, cols - 1);
  const cellZ = depth / Math.max(1, rows - 1);
  const h = (rr, cc) => heightAt(heights, rows, cols, rr, cc);
  const dx = Math.abs(h(r, c + 1) - h(r, c - 1)) * worldMaxH / Math.max(1, cellX * 2);
  const dz = Math.abs(h(r + 1, c) - h(r - 1, c)) * worldMaxH / Math.max(1, cellZ * 2);
  return Math.atan(Math.sqrt(dx * dx + dz * dz)) * 180 / Math.PI;
}

function gridToWorld(r, c, rows, cols, world) {
  const { width, depth } = getWorldDims(rows, cols, world);
  const x = (c / Math.max(1, cols - 1) - 0.5) * width;
  const z = (r / Math.max(1, rows - 1) - 0.5) * depth;
  return { x, z, width, depth };
}

function sampleMaskAt(mask, maskW, maskH, r, c, rows, cols) {
  if (!mask?.length) return 0;
  const tx = Math.min(maskW - 1, Math.max(0, Math.round((c / Math.max(1, cols - 1)) * (maskW - 1))));
  const ty = Math.min(maskH - 1, Math.max(0, Math.round((r / Math.max(1, rows - 1)) * (maskH - 1))));
  return mask[ty * maskW + tx] || 0;
}

function sampleMaterialId(materialPreview, rows, cols, r, c) {
  if (!materialPreview?.data) return null;
  const rr = clamp(Math.round(r), 0, rows - 1);
  const cc = clamp(Math.round(c), 0, cols - 1);
  return materialPreview.data[(rr * cols + cc) * 4];
}

function materialAllowed(materialId, allowed, avoided) {
  if (materialId == null) return true;
  if (avoided?.length) {
    const avoidIds = avoided.map(materialIdFromName).filter((v) => v != null);
    if (avoidIds.includes(materialId)) return false;
  }
  if (!allowed?.length) return true;
  const allowIds = allowed.map(materialIdFromName).filter((v) => v != null);
  return allowIds.includes(materialId);
}

/** Distance from each land cell to nearest water (meters). */
export function computeCoastDistanceM(heights, rows, cols, seaLevelM, maxH, world) {
  const worldMaxH = maxH * getIslandHorizonScale(world);
  const seaNorm = seaLevelM / Math.max(1, worldMaxH);
  const isLand = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      isLand[r * cols + c] = (heights[r * cols + c] || 0) > seaNorm + 0.004 ? 1 : 0;
    }
  }
  const dist = new Float32Array(rows * cols);
  const inf = Math.max(rows, cols) * 8;
  for (let i = 0; i < dist.length; i++) dist[i] = isLand[i] ? inf : 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const p = y * cols + x;
      if (!isLand[p]) continue;
      if (x > 0) dist[p] = Math.min(dist[p], dist[p - 1] + 1);
      if (y > 0) dist[p] = Math.min(dist[p], dist[p - cols] + 1);
      if (x > 0 && y > 0) dist[p] = Math.min(dist[p], dist[p - cols - 1] + 1.414);
      if (x < cols - 1 && y > 0) dist[p] = Math.min(dist[p], dist[p - cols + 1] + 1.414);
    }
  }
  for (let y = rows - 1; y >= 0; y--) {
    for (let x = cols - 1; x >= 0; x--) {
      const p = y * cols + x;
      if (!isLand[p]) continue;
      if (x < cols - 1) dist[p] = Math.min(dist[p], dist[p + 1] + 1);
      if (y < rows - 1) dist[p] = Math.min(dist[p], dist[p + cols] + 1);
      if (x < cols - 1 && y < rows - 1) dist[p] = Math.min(dist[p], dist[p + cols + 1] + 1.414);
      if (x > 0 && y < rows - 1) dist[p] = Math.min(dist[p], dist[p + cols - 1] + 1.414);
    }
  }
  const { width, depth } = getWorldDims(rows, cols, world);
  const mpp = ((width / Math.max(1, cols - 1)) + (depth / Math.max(1, rows - 1))) * 0.5;
  for (let i = 0; i < dist.length; i++) {
    if (!isLand[i]) dist[i] = 0;
    else dist[i] *= mpp;
  }
  return dist;
}

function nearOtherPack(x, z, placed, minDistM) {
  if (!placed?.length || minDistM <= 0) return false;
  const minSq = minDistM * minDistM;
  for (const p of placed) {
    const dx = p.position[0] - x;
    const dz = p.position[2] - z;
    if (dx * dx + dz * dz < minSq) return true;
  }
  return false;
}

function evaluateCell(ctx, rules, r, c, n) {
  const {
    heights, rows, cols, maxH, world, seaLevelM, masks, materialPreview, coastDist,
  } = ctx;
  const worldMaxH = maxH * getIslandHorizonScale(world);
  const seaNorm = seaLevelM / Math.max(1, worldMaxH);
  const hNorm = heightAt(heights, rows, cols, r, c);
  if (hNorm <= seaNorm + 0.004) {
    if (rules.avoidWater !== false) return false;
  }

  const hM = elevationMetersFromNormalized(hNorm, maxH, world);
  if (hM < rules.heightMinM || hM > rules.heightMaxM) return false;

  const slope = slopeAt(heights, rows, cols, r, c, maxH, world);
  if (slope < rules.slopeMinDeg || slope > rules.slopeMaxDeg) return false;

  const coastM = coastDist[r * cols + c] ?? 0;
  if (coastM < rules.coastDistanceMinM || coastM > rules.coastDistanceMaxM) return false;

  const texW = masks.texW || cols;
  const texH = masks.texH || rows;
  const packDetailMask = ctx.detailMasksByLayer?.[rules.maskLayerId] || masks.detailMask;
  const waterV = sampleMaskAt(masks.waterMask, texW, texH, r, c, rows, cols);
  const pathV = sampleMaskAt(masks.pathMask, texW, texH, r, c, rows, cols);
  const riverV = sampleMaskAt(masks.riverMask, texW, texH, r, c, rows, cols);
  const structV = sampleMaskAt(masks.structureMask, texW, texH, r, c, rows, cols);
  const dockV = sampleMaskAt(masks.dockMask, texW, texH, r, c, rows, cols);
  const detailV = sampleMaskAt(packDetailMask, texW, texH, r, c, rows, cols);

  if (rules.avoidWater !== false && waterV > 48) return false;
  if (rules.avoidRivers !== false && riverV > 48) return false;
  if (rules.avoidPaths !== false && pathV > 48) return false;
  if (rules.avoidStructures !== false && structV > 32) return false;
  if (rules.avoidDocks !== false && dockV > 32) return false;

  if (rules.preferPathMask && pathV < 24) return false;
  if (rules.preferRiverMask && riverV < 24) return false;
  if (rules.requireMaskLayer && detailV < 24) return false;

  const matId = sampleMaterialId(materialPreview, rows, cols, r, c);
  if (!materialAllowed(matId, rules.allowedMaterials, rules.avoidMaterials)) return false;

  const noiseScale = Math.max(1, rules.noiseScaleM);
  const noiseVal = hashNoise(r / noiseScale, c / noiseScale, rules.seed + 17);
  if (noiseVal < rules.noiseThreshold) return false;

  if (n > rules.density) return false;

  return true;
}

function pickVariant(variants, r, c, seed) {
  if (!variants?.length) return null;
  const idx = Math.floor(hashNoise(r, c, seed + 91) * variants.length) % variants.length;
  return variants[idx];
}

/**
 * @returns {{ instances: Array, manifest: Array }}
 */
export function placeModelPack(pack, loaded, ctx, priorPlaced = []) {
  const rules = resolvePlacementRules(pack.placement || {});
  if (pack.enabled === false || !loaded?.variants?.length) {
    return { instances: [], manifest: [] };
  }

  const {
    heights, rows, cols, maxH, world, seaLevelM, layers,
  } = ctx;
  const coastDist = ctx.coastDist || computeCoastDistanceM(heights, rows, cols, seaLevelM, maxH, world);
  const evalCtx = { ...ctx, coastDist };

  const instances = [];
  const manifest = [];
  const maxCount = Math.max(1, Math.round(rules.maxCount));
  const spacing = Math.max(2, Math.round(16 - rules.density * 10));
  const otherSpacing = rules.avoidOtherModelPacks ? Math.max(2, rules.jitterM * 2.5) : 0;
  const allPrior = [...priorPlaced];

  if (rules.requireMarkerLayer || pack.placement?.mode === 'manual-marker-based') {
    const layerId = rules.markerLayerId || rules.maskLayerId;
    const markerLayers = (layers || []).filter((l) => l.kind === 'marker' && l.enabled !== false);
    const layer = layerId
      ? markerLayers.find((l) => l.id === layerId)
      : markerLayers[0];
    const features = layer?.analysis?.features || [];
    for (let i = 0; i < features.length && instances.length < maxCount; i++) {
      const f = features[i];
      const x = Number(f.world?.[0] || 0);
      const z = Number(f.world?.[2] || 0);
      if (nearOtherPack(x, z, allPrior, otherSpacing)) continue;
      const n = hashNoise(x, z, rules.seed + i);
      const variant = pickVariant(loaded.variants, i, i, rules.seed);
      const scale = rules.scaleMin + (1 - n) * (rules.scaleMax - rules.scaleMin);
      const rotY = rules.randomRotation ? hashNoise(z, x, rules.seed) * Math.PI * 2 : 0;
      const entry = {
        packId: pack.id,
        packName: pack.name,
        variantId: variant.id,
        variantName: variant.name,
        position: [x, 0, z],
        rotation: [0, rotY, 0],
        scale: [scale, scale, scale],
      };
      instances.push(entry);
      manifest.push(entry);
      allPrior.push(entry);
    }
    return { instances, manifest };
  }

  let placed = 0;
  for (let r = 2; r < rows - 2 && placed < maxCount; r += spacing) {
    for (let c = 2; c < cols - 2 && placed < maxCount; c += spacing) {
      const n = hashNoise(r, c, rules.seed);
      if (!evaluateCell(evalCtx, rules, r, c, n)) continue;

      const { x, z, width, depth } = gridToWorld(r, c, rows, cols, world);
      const cellW = width / Math.max(1, cols - 1);
      const cellD = depth / Math.max(1, rows - 1);
      const jx = (hashNoise(r, c, rules.seed + 3) - 0.5) * rules.jitterM;
      const jz = (hashNoise(c, r, rules.seed + 5) - 0.5) * rules.jitterM;
      const wx = x + jx;
      const wz = z + jz;
      if (nearOtherPack(wx, wz, allPrior, otherSpacing)) continue;

      if (rules.clusterRadiusM > 0 && hashNoise(r, c, rules.seed + 7) > 0.35) {
        const clusterN = Math.min(4, Math.floor(rules.density * 6));
        for (let k = 0; k < clusterN && placed < maxCount; k++) {
          const ang = hashNoise(r, c, rules.seed + k * 13) * Math.PI * 2;
          const rad = hashNoise(c, r, rules.seed + k * 17) * rules.clusterRadiusM;
          const cx = wx + Math.cos(ang) * rad;
          const cz = wz + Math.sin(ang) * rad;
          const cr = clamp(Math.round(((cz / depth) + 0.5) * (rows - 1)), 2, rows - 3);
          const cc = clamp(Math.round(((cx / width) + 0.5) * (cols - 1)), 2, cols - 3);
          const cn = hashNoise(cr, cc, rules.seed + k);
          if (!evaluateCell(evalCtx, rules, cr, cc, cn)) continue;
          if (nearOtherPack(cx, cz, allPrior, otherSpacing)) continue;
          pushInstance(pack, loaded, rules, cr, cc, cx, cz, cn, instances, manifest);
          allPrior.push(instances[instances.length - 1]);
          placed += 1;
        }
        continue;
      }

      pushInstance(pack, loaded, rules, r, c, wx, wz, n, instances, manifest);
      allPrior.push(instances[instances.length - 1]);
      placed += 1;
    }
  }

  return { instances, manifest };
}

function pushInstance(pack, loaded, rules, r, c, x, z, n, instances, manifest) {
  const variant = pickVariant(loaded.variants, r, c, rules.seed);
  const scale = rules.scaleMin + (1 - n) * (rules.scaleMax - rules.scaleMin);
  const rotY = rules.randomRotation ? hashNoise(c, r, rules.seed + 3) * Math.PI * 2 : 0;
  const entry = {
    packId: pack.id,
    packName: pack.name,
    variantId: variant.id,
    variantName: variant.name,
    position: [x, 0, z],
    rotation: [0, rotY, 0],
    scale: [scale, scale, scale],
    rules: {
      snapToGround: rules.snapToGround !== false,
      alignToNormal: rules.alignToNormal === true,
      clearVegetationRadiusM: rules.clearVegetationRadiusM,
    },
  };
  instances.push(entry);
  manifest.push({
    packId: entry.packId,
    packName: entry.packName,
    variantId: entry.variantId,
    variantName: entry.variantName,
    position: entry.position,
    rotation: entry.rotation,
    scale: entry.scale,
  });
}

export function buildModelPackVegetationMask(manifest, texW, texH, rows, cols, world) {
  const mask = new Uint8Array(texW * texH);
  if (!manifest?.length) return mask;
  const { width, depth } = getWorldDims(rows, cols, world);
  for (const inst of manifest) {
    const radiusM = Number(inst.rules?.clearVegetationRadiusM ?? inst.clearVegetationRadiusM ?? 0);
    if (radiusM <= 0) continue;
    const x = inst.position[0];
    const z = inst.position[2];
    const tx = Math.round(((x / width) + 0.5) * (texW - 1));
    const ty = Math.round(((z / depth) + 0.5) * (texH - 1));
    const rPx = Math.max(2, Math.ceil(radiusM * texW / Math.max(1, width)));
    for (let dy = -rPx; dy <= rPx; dy++) {
      for (let dx = -rPx; dx <= rPx; dx++) {
        if (dx * dx + dy * dy > rPx * rPx) continue;
        const px = tx + dx;
        const py = ty + dy;
        if (px < 0 || py < 0 || px >= texW || py >= texH) continue;
        mask[py * texW + px] = 255;
      }
    }
  }
  return mask;
}

export function placeAllModelPacks(packs, loadedById, ctx) {
  const allInstances = [];
  const allManifest = [];
  const prior = [];
  for (const pack of packs || []) {
    if (pack.enabled === false || !pack.glbDataUrl) continue;
    const loaded = loadedById[pack.id];
    if (!loaded) continue;
    const { instances, manifest } = placeModelPack(pack, loaded, ctx, prior);
    allInstances.push(...instances);
    allManifest.push(...manifest);
    prior.push(...instances);
  }
  return { instances: allInstances, manifest: allManifest };
}
