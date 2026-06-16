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
    paintStrength: 1,
    paintColor: DEFAULT_WATER_PAINT_COLOR,
    maskSmoothPx: 3,
    riverSlimPx: 0,
    lakeFlattenStrength: 1,
    riverChannelStrength: 0.65,
    waterfallCarveStrength: 0.75,
    lakeCoreErosionCells: 1,
    carveDepthM: round2(REFERENCE_WATER_LAYER.carveDepthM * scale),
    lakeDepthM: round2(REFERENCE_WATER_LAYER.lakeDepthM * scale),
    bankSmoothM: round2(REFERENCE_WATER_LAYER.bankSmoothM * scale),
    bankSmoothPx: bankPx,
    waterfallDropM: round2(REFERENCE_WATER_LAYER.waterfallDropM * scale),
    fastRiverGrade: REFERENCE_WATER_LAYER.fastRiverGrade,
    lakeMaxDropM: round2(REFERENCE_WATER_LAYER.lakeMaxDropM * scale),
    largeWaterAreaPx: REFERENCE_WATER_LAYER.largeWaterAreaPx,
    maskThreshold: 8,
    sandBankAmount: 0,
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
    sandBankAmount: Number(merged.sandBankAmount ?? defaults.sandBankAmount ?? 0),
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

/** Sand band width in heightmap cells from 0–1 amount (gentle at low values). */
export function sandBankPxFromAmount(amount, worldSettings = {}, mapSizePx = {}, heightmapCols = null) {
  const a = Math.max(0, Math.min(1, Number(amount) || 0));
  if (a <= 0) return 0;
  const scale = getWaterLayerHorizonScale(worldSettings);
  const maxBankM = REFERENCE_WATER_LAYER.sandBankWidthM * scale;
  const cols = heightmapCols || mapSizePx.width || 1024;
  const mpp = Number(worldSettings?.widthM || REFERENCE_ISLAND_WIDTH_M) / Math.max(1, cols - 1);
  const maxBankPx = Math.max(3, Math.round(maxBankM / Math.max(1e-6, mpp)));
  return Math.max(1, Math.round((a ** 1.35) * maxBankPx));
}

/** Scale heightmap-cell bank width to terrain texture pixels. */
export function sandBankTexPxFromAmount(
  amount,
  worldSettings = {},
  mapSizePx = {},
  heightmapCols = null,
  texSize = 1024,
) {
  const hmPx = sandBankPxFromAmount(amount, worldSettings, mapSizePx, heightmapCols);
  if (hmPx <= 0) return 0;
  const cols = heightmapCols || mapSizePx.width || 1024;
  const scale = Math.max(1, Number(texSize) || 1024) / Math.max(1, cols);
  const a = Math.max(0, Math.min(1, Number(amount) || 0));
  return Math.max(2, Math.round(hmPx * scale * (0.85 + a * 0.35)));
}

export function aggregateRiverOverlaySettings(
  layers = [],
  worldSettings = {},
  mapSizePx = {},
  heightmapCols = null,
  texSize = null,
) {
  const waterLayers = (layers || []).filter((l) => l.kind === 'water' && l.enabled !== false);
  if (!waterLayers.length) {
    return { sandBankAmount: 0, sandBankPx: 0, sandBankTexPx: 0, sandStrength: 0, inheritOceanReflection: false };
  }
  const sandBankAmount = Math.max(...waterLayers.map((l) => Number(l.sandBankAmount ?? 0)));
  const sandBankPx = sandBankPxFromAmount(sandBankAmount, worldSettings, mapSizePx, heightmapCols);
  const sandBankTexPx = texSize
    ? sandBankTexPxFromAmount(sandBankAmount, worldSettings, mapSizePx, heightmapCols, texSize)
    : sandBankPx;
  return {
    sandBankAmount,
    sandBankPx,
    sandBankTexPx,
    sandStrength: sandBankAmount > 0 ? clampSandStrength(sandBankAmount) : 0,
    inheritOceanReflection: waterLayers.some((l) => l.inheritOceanReflection !== false),
  };
}

function clampSandStrength(amount) {
  const a = Math.max(0, Math.min(1, Number(amount) || 0));
  return Math.min(1, 0.42 + a * 0.55);
}
