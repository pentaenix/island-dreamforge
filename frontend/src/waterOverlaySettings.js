/**
 * World-scaled defaults and API options for river/lake height overlays.
 */

import {
  REFERENCE_ISLAND_WIDTH_M,
  getDerivedDepthM,
  getIslandHorizonScale,
  getMetersPerPixel,
} from './worldSettings.js';
import { DEFAULT_WATER_PAINT_COLOR } from './riverTexturePaint.js';

/** Resort-scale reference values (1480 m island). */
export const REFERENCE_WATER_LAYER = {
  carveDepthM: 1.5,
  lakeDepthM: 0.75,
  bankSmoothM: 20,
  bankSmoothPx: 14,
  waterfallDropM: 18,
  fastRiverGrade: 0.25,
  lakeMaxDropM: 2,
  largeWaterAreaPx: 2500,
  sandBankWidthM: 12,
  sandStrength: 0.82,
};

export function getWaterLayerHorizonScale(worldSettings = {}) {
  return getIslandHorizonScale(worldSettings);
}

/** Defaults for a new water overlay layer at the current island scale. */
export function getScaledWaterLayerDefaults(worldSettings = {}, mapSizePx = {}) {
  const scale = getWaterLayerHorizonScale(worldSettings);
  const mpp = getMetersPerPixel(worldSettings, mapSizePx) || (REFERENCE_ISLAND_WIDTH_M / 1024);
  const bankPx = Math.max(4, Math.round(REFERENCE_WATER_LAYER.bankSmoothM / Math.max(1e-6, mpp)));
  return {
    mode: 'visual-only',
    paintStrength: 0.92,
    paintColor: DEFAULT_WATER_PAINT_COLOR,
    lakeFlattenEnabled: true,
    lakeFlattenStrength: 0.55,
    carveDepthM: round2(REFERENCE_WATER_LAYER.carveDepthM * scale),
    lakeDepthM: round2(REFERENCE_WATER_LAYER.lakeDepthM * scale),
    bankSmoothM: round2(REFERENCE_WATER_LAYER.bankSmoothM * scale),
    bankSmoothPx: bankPx,
    waterfallDropM: round2(REFERENCE_WATER_LAYER.waterfallDropM * scale),
    fastRiverGrade: REFERENCE_WATER_LAYER.fastRiverGrade,
    lakeMaxDropM: round2(REFERENCE_WATER_LAYER.lakeMaxDropM * scale),
    largeWaterAreaPx: REFERENCE_WATER_LAYER.largeWaterAreaPx,
    maskThreshold: 8,
    sandBanksEnabled: false,
    sandBankWidthM: round2(REFERENCE_WATER_LAYER.sandBankWidthM * scale),
    sandStrength: REFERENCE_WATER_LAYER.sandStrength,
    inheritOceanReflection: true,
  };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function bankSmoothPxForLayer(layer = {}, worldSettings = {}, mapSizePx = {}, heightmapCols = null) {
  const cols = heightmapCols || mapSizePx.width || 1024;
  const mpp = Number(worldSettings?.widthM || REFERENCE_ISLAND_WIDTH_M) / Math.max(1, cols - 1);
  if (Number.isFinite(Number(layer.bankSmoothM))) {
    return Math.max(0, Math.round(Number(layer.bankSmoothM) / Math.max(1e-6, mpp)));
  }
  return Math.max(0, Math.round(Number(layer.bankSmoothPx ?? REFERENCE_WATER_LAYER.bankSmoothPx)));
}

export function sandBankPxForLayer(layer = {}, worldSettings = {}, mapSizePx = {}, heightmapCols = null) {
  const cols = heightmapCols || mapSizePx.width || 1024;
  const mpp = Number(worldSettings?.widthM || REFERENCE_ISLAND_WIDTH_M) / Math.max(1, cols - 1);
  const bankM = Number(layer.sandBankWidthM ?? REFERENCE_WATER_LAYER.sandBankWidthM);
  return Math.max(2, Math.round(bankM / Math.max(1e-6, mpp)));
}

/** Options payload for /api/bake-water and /api/analyze-layer. */
export function buildWaterLayerApiOptions(layer, worldSettings = {}, mapSizePx = {}, maxHeightM = 500) {
  const scale = getWaterLayerHorizonScale(worldSettings);
  const widthM = Number(worldSettings.widthM || REFERENCE_ISLAND_WIDTH_M);
  const depthM = getDerivedDepthM(worldSettings, mapSizePx);
  const cols = mapSizePx.width || 1024;
  const defaults = getScaledWaterLayerDefaults(worldSettings, mapSizePx);

  const merged = { ...defaults, ...layer };
  return {
    ...merged,
    maxHeightM: Number(maxHeightM || 500),
    widthM,
    depthM,
    terrainWidthM: widthM,
    terrainDepthM: depthM,
    islandHorizonScale: scale,
    islandHeightScale: scale,
    carveDepthM: Number(merged.carveDepthM ?? defaults.carveDepthM),
    riverDepthM: Number(merged.carveDepthM ?? defaults.carveDepthM),
    lakeDepthM: Number(merged.lakeDepthM ?? defaults.lakeDepthM),
    bankSmoothM: Number(merged.bankSmoothM ?? defaults.bankSmoothM),
    bankSmoothPx: bankSmoothPxForLayer(merged, worldSettings, mapSizePx, cols),
    waterfallDropM: Number(merged.waterfallDropM ?? defaults.waterfallDropM),
    fastRiverGrade: Number(merged.fastRiverGrade ?? defaults.fastRiverGrade),
    lakeMaxDropM: Number(merged.lakeMaxDropM ?? defaults.lakeMaxDropM),
    largeWaterAreaPx: Number(merged.largeWaterAreaPx ?? defaults.largeWaterAreaPx),
    maskThreshold: Number(merged.maskThreshold ?? 8),
    sandBanksEnabled: merged.sandBanksEnabled === true,
    sandBankWidthM: Number(merged.sandBankWidthM ?? defaults.sandBankWidthM),
    sandStrength: Number(merged.sandStrength ?? defaults.sandStrength),
    inheritOceanReflection: merged.inheritOceanReflection !== false,
  };
}

/** Slider maxima that grow with island size. */
export function getWaterLayerSliderLimits(worldSettings = {}) {
  const scale = getWaterLayerHorizonScale(worldSettings);
  return {
    carveDepthMax: round2(Math.max(12, 12 * scale)),
    bankSmoothMax: round2(Math.max(120, 120 * scale)),
    lakeDepthMax: round2(Math.max(8, 8 * scale)),
    sandBankMax: round2(Math.max(80, 80 * scale)),
  };
}

export function createBlankWaterOverlayDataUrl(mapSizePx = {}) {
  const w = Math.max(64, Math.round(Number(mapSizePx.width) || 1024));
  const h = Math.max(64, Math.round(Number(mapSizePx.height) || w));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  return canvas.toDataURL('image/png');
}

export function aggregateRiverOverlaySettings(layers = []) {
  const waterLayers = (layers || []).filter((l) => l.kind === 'water' && l.enabled !== false);
  if (!waterLayers.length) {
    return { sandBanksEnabled: false, inheritOceanReflection: false };
  }
  return {
    sandBanksEnabled: waterLayers.some((l) => l.sandBanksEnabled === true),
    sandBankWidthM: Math.max(...waterLayers.map((l) => Number(l.sandBankWidthM || 0))),
    sandStrength: Math.max(...waterLayers.map((l) => Number(l.sandStrength || 0.82))),
    inheritOceanReflection: waterLayers.some((l) => l.inheritOceanReflection !== false),
  };
}

/** Merged lake-flatten settings from active water layers. */
export function aggregateLakeFlattenSettings(layers = [], maxHeightM = 500, worldSettings = {}) {
  const active = (layers || []).filter((l) => l.kind === 'water' && l.enabled !== false && l.url);
  if (!active.length || !active.some((l) => l.lakeFlattenEnabled !== false)) {
    return { enabled: false };
  }
  const scale = getIslandHorizonScale(worldSettings);
  const worldMaxH = Math.max(1, Number(maxHeightM || 500) * scale);
  return {
    enabled: true,
    lakeDepthM: Math.max(...active.map((l) => Number(l.lakeDepthM ?? REFERENCE_WATER_LAYER.lakeDepthM * scale))),
    flattenStrength: Math.max(...active.map((l) => Number(l.lakeFlattenStrength ?? 0.55))),
    largeWaterAreaPx: Math.min(...active.map((l) => Number(l.largeWaterAreaPx ?? REFERENCE_WATER_LAYER.largeWaterAreaPx))),
    depthNorm: Math.max(...active.map((l) => Number(l.lakeDepthM ?? REFERENCE_WATER_LAYER.lakeDepthM * scale))) / worldMaxH,
  };
}
