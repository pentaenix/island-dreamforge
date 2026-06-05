/** Island world scale + mesh density — shared by Heights UI, viewport, and export. */

import { defaultBandEdgesM, totalBandReachM } from './waterPalette.js';

/** Design-time reference width — color sample heights are authored at this footprint. */
export const REFERENCE_ISLAND_WIDTH_M = 1480;

/** Ocean disc radius = max(width, depth) × this ratio (extends past shoreline). */
export const OCEAN_DISC_RADIUS_RATIO = 0.58;

export const DEFAULT_WORLD_SETTINGS = {
  widthM: 1480,
  depthM: 1086,
  lockAspect: true,
  verticalExaggeration: 1.0,
  /** Max heightmap grid side for 3D preview and default mesh export (polygon density). */
  terrainMeshResolution: 384,
  /** Real-world spacing for trees / future paths & buildings (meters, not island-relative). */
  featureSpacingM: 22,
  /** Visual size multiplier for trees & future constructions (does not stretch with island width). */
  featureScale: 1,
};

export const ISLAND_SIZE_PRESETS = [
  { id: 'resort', label: 'Resort', widthM: 1480, hint: '~1.5 km' },
  { id: 'large', label: 'Large', widthM: 5000, hint: '~5 km' },
  { id: 'massive', label: 'Massive', widthM: 15000, hint: '~15 km' },
  { id: 'epic', label: 'Epic', widthM: 30000, hint: '~30 km' },
];

export const TERRAIN_MESH_PRESETS = [
  { id: 'draft', label: 'Draft', resolution: 128 },
  { id: 'balanced', label: 'Balanced', resolution: 384 },
  { id: 'detailed', label: 'Detailed', resolution: 512 },
  { id: 'ultra', label: 'Ultra', resolution: 768 },
];

export function clampMeshResolution(value, min = 64, max = 1024) {
  return Math.min(max, Math.max(min, Math.round(Number(value) || DEFAULT_WORLD_SETTINGS.terrainMeshResolution)));
}

export function getDerivedDepthM(worldSettings, mapSizePx = {}) {
  const w = worldSettings || {};
  if (w.lockAspect !== false && mapSizePx.width && mapSizePx.height) {
    return Math.round(Number(w.widthM || 1480) * mapSizePx.height / mapSizePx.width);
  }
  return Number(w.depthM || 1086);
}

/** Terrain + water band plane footprint (m) — must match TerrainViewport getWorldDims. */
export function getWorldDimsM(rows, cols, worldSettings = {}) {
  const width = Math.max(50, Number(worldSettings?.widthM || 1480));
  const depth = Math.max(
    50,
    Number(worldSettings?.depthM || getDerivedDepthM(worldSettings, { width: cols, height: rows })),
  );
  return { width, depth };
}

/** Horizontal scale vs resort default — also applied to terrain elevation in world meters. */
export function getIslandHorizonScale(worldSettings) {
  const w = Number(worldSettings?.widthM ?? REFERENCE_ISLAND_WIDTH_M);
  return Math.max(0.05, w / REFERENCE_ISLAND_WIDTH_M);
}

/** World-space terrain elevation (m) from normalized heightmap sample [0, 1]. */
export function elevationMetersFromNormalized(norm, maxHeightM, worldSettings) {
  const n = Number(norm) || 0;
  const ceiling = Math.max(1, Number(maxHeightM || 500));
  return n * ceiling * getIslandHorizonScale(worldSettings);
}

/** Convert world meters on chart / 3D back to stored design sample height. */
export function designMetersFromWorld(worldMeters, worldSettings) {
  const scale = getIslandHorizonScale(worldSettings);
  return (Number(worldMeters) || 0) / Math.max(1e-6, scale);
}

export function getWorldMaxHeightM(maxHeightM, worldSettings) {
  return Math.max(1, Number(maxHeightM || 500)) * getIslandHorizonScale(worldSettings);
}

/** Max disc diameter slider (m) — preview frame uses this so the disc can grow visibly. */
export const WATER_DISC_SLIDER_MAX_DIAMETER_M = 48000;

/**
 * World span for the Water-tab disc preview — frames the current disc with padding
 * (not the full 48 km slider max, or the disc looks like a speck on black).
 */
export function getWaterDiscPreviewSpanM(worldSettings, mapSizePx = {}, oceanRadiusM = null) {
  const footprintD = getOceanFootprintRadiusM(worldSettings, mapSizePx) * 2;
  const r = Number(oceanRadiusM);
  const discD = Number.isFinite(r) && r > 0 ? r * 2 : footprintD;
  const framed = discD * 1.24;
  return Math.min(WATER_DISC_SLIDER_MAX_DIAMETER_M, Math.max(framed, 520));
}

/** Furthest distance from map center to a corner (m) — auto disc won't exceed this. */
export function getOceanFootprintRadiusM(worldSettings, mapSizePx = {}) {
  const width = Number(worldSettings?.widthM ?? DEFAULT_WORLD_SETTINGS.widthM);
  const depth = getDerivedDepthM(worldSettings, mapSizePx);
  return Math.hypot(width * 0.5, depth * 0.5);
}

export function getAutoOceanDiscRadiusM(worldSettings, mapSizePx = {}) {
  const span = Math.max(
    Number(worldSettings?.widthM ?? DEFAULT_WORLD_SETTINGS.widthM),
    getDerivedDepthM(worldSettings, mapSizePx),
  );
  const autoRadius = Math.max(400, span * OCEAN_DISC_RADIUS_RATIO);
  return Math.min(autoRadius, getOceanFootprintRadiusM(worldSettings, mapSizePx));
}

/**
 * 3D ocean disc radius (m) — visual circle only; not used for band map generation.
 */
export function getOceanDiscRadiusM(worldSettings, mapSizePx = {}, oceanSettings = {}) {
  if (oceanSettings?.oceanRadiusAuto !== false) {
    return getAutoOceanDiscRadiusM(worldSettings, mapSizePx);
  }
  const manual = Number(oceanSettings.oceanRadiusM);
  if (Number.isFinite(manual) && manual > 0) {
    return Math.max(50, manual);
  }
  return getAutoOceanDiscRadiusM(worldSettings, mapSizePx);
}

/** Max shore distance used when encoding shore-distance preview maps (m). */
export function maxShoreDistanceScaleM(worldSettings, mapSizePx = {}, oceanSettings = {}) {
  const edges = defaultBandEdgesM(oceanSettings, worldSettings);
  const oceanR = getWaterMapRadiusM(worldSettings, mapSizePx, oceanSettings);
  return Math.max(1, oceanR, edges[edges.length - 1] || 1);
}

/** Auto radius for bathymetry / derived band maps — generous vs island footprint. */
export function getAutoWaterMapRadiusM(worldSettings, mapSizePx = {}, exportSettings = {}) {
  const footprint = getOceanFootprintRadiusM(worldSettings, mapSizePx);
  const bandReach = totalBandReachM(exportSettings, worldSettings);
  const span = Math.max(
    Number(worldSettings?.widthM ?? DEFAULT_WORLD_SETTINGS.widthM),
    getDerivedDepthM(worldSettings, mapSizePx),
  );
  return Math.max(footprint * 1.15, bandReach * 2.5, span * 0.72);
}

/**
 * Bathymetry & exported waterColor reach (m). Regenerate derived maps after changing.
 * Independent from the 3D disc diameter slider.
 */
export function getWaterMapRadiusM(worldSettings, mapSizePx = {}, oceanSettings = {}) {
  if (oceanSettings?.waterMapRadiusAuto !== false) {
    return getAutoWaterMapRadiusM(worldSettings, mapSizePx, oceanSettings);
  }
  const manual = Number(oceanSettings.waterMapRadiusM);
  if (Number.isFinite(manual) && manual > 0) {
    return Math.max(50, manual);
  }
  return getAutoWaterMapRadiusM(worldSettings, mapSizePx, oceanSettings);
}

export function getMetersPerPixel(worldSettings, mapSizePx = {}) {
  if (!mapSizePx.width) return 0;
  return Number(worldSettings?.widthM || 0) / Math.max(1, mapSizePx.width);
}

export function getIslandFootprintKm2(worldSettings, mapSizePx = {}) {
  const w = Number(worldSettings?.widthM || 0);
  const d = getDerivedDepthM(worldSettings, mapSizePx);
  return (w * d) / 1_000_000;
}

export function estimateTerrainPolygons(worldSettings, mapSizePx = {}) {
  const maxSide = clampMeshResolution(worldSettings?.terrainMeshResolution);
  if (!mapSizePx.width || !mapSizePx.height) {
    return { rows: maxSide, cols: maxSide, quads: maxSide * maxSide };
  }
  const ratio = mapSizePx.width / Math.max(1, mapSizePx.height);
  let cols = maxSide;
  let rows = Math.max(16, Math.round(maxSide / ratio));
  if (rows > maxSide) {
    rows = maxSide;
    cols = Math.max(16, Math.round(maxSide * ratio));
  }
  const landQuads = Math.max(0, (rows - 1) * (cols - 1));
  return { rows, cols, quads: landQuads * 2 };
}

export function meshSpacingCells(worldSettings, rows, cols) {
  const width = Math.max(50, Number(worldSettings?.widthM || 1480));
  const depth = Math.max(50, Number(worldSettings?.depthM || width));
  const spacingM = Math.max(4, Number(worldSettings?.featureSpacingM ?? 22));
  const cellW = width / Math.max(1, cols - 1);
  const cellD = depth / Math.max(1, rows - 1);
  const cell = Math.max(0.5, Math.min(cellW, cellD));
  return Math.max(2, Math.round(spacingM / cell));
}

export function buildMeshExportOptions(worldSettings, derivedDepthM, extra = {}) {
  const islandHeightScale = getIslandHorizonScale(worldSettings);
  return {
    widthM: Number(worldSettings?.widthM || 1480),
    depthM: Number(derivedDepthM || worldSettings?.depthM || 1086),
    verticalScale: Number(worldSettings?.verticalExaggeration || 1) * islandHeightScale,
    islandHeightScale,
    meshResolution: clampMeshResolution(worldSettings?.terrainMeshResolution),
    addSkirt: true,
    ...extra,
  };
}

export function normalizeWorldSettings(raw = {}) {
  const merged = { ...DEFAULT_WORLD_SETTINGS, ...raw };
  merged.widthM = Math.max(10, Number(merged.widthM) || DEFAULT_WORLD_SETTINGS.widthM);
  merged.depthM = Math.max(10, Number(merged.depthM) || DEFAULT_WORLD_SETTINGS.depthM);
  merged.verticalExaggeration = Math.max(1, Number(merged.verticalExaggeration) || 1);
  merged.terrainMeshResolution = clampMeshResolution(merged.terrainMeshResolution);
  merged.featureSpacingM = Math.max(4, Math.min(120, Number(merged.featureSpacingM) || 22));
  merged.featureScale = Math.max(0.25, Math.min(3, Number(merged.featureScale) || 1));
  return merged;
}
