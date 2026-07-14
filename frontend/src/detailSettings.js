/** Defaults for step 4 · Details — visual dressing only (no height changes). */

import { normalizeModelPacks } from './modelPackSettings.js';
import { stripPackBlobsForState } from './modelPackBlobStore.js';

export const PATH_COLOR_PRESETS = {
  sand: '#e8d9b0',
  dirt: '#b89a6e',
  pale_stone: '#d4cbb8',
};

export const RESORT_COLOR_PRESETS = {
  'resort-light': { wall: '#f2ebe0', roof: '#c4a882' },
  'roof-red': { wall: '#efe8dc', roof: '#a85c4a' },
  neutral: { wall: '#d8d4cc', roof: '#8a8478' },
};

export const DEFAULT_DETAIL_SETTINGS = {
  workflowVersion: 6,
  modelPacks: [],
  paths: {
    enabled: true,
    maskThreshold: 8,
    pathWidthPx: 0,
    pathWidthM: 3.5,
    edgeSoftness: 0.55,
    colorPreset: 'sand',
    vegetationClearRadiusM: 4,
  },
  beachPalms: {
    enabled: false,
    density: 0.42,
    maxCount: 120,
    minDistanceToWaterM: 2,
    maxDistanceToWaterM: 35,
    scaleMin: 4,
    scaleMax: 9,
    seed: 77,
  },
  rockScars: {
    enabled: false,
    slopeStartDeg: 38,
    slopeFullDeg: 58,
    minHeightM: 40,
    density: 0.55,
    warmth: 0.72,
    seed: 31,
  },
  resort: {
    enabled: false,
    buildingsPerComponent: 4,
    sizeMinM: 3,
    sizeMaxM: 8,
    colorPreset: 'resort-light',
    flattenGround: true,
    seed: 19,
  },
  docks: {
    enabled: true,
    plankWidthM: 2.2,
    plankLengthM: 8,
    heightM: 1.2,
    seed: 53,
  },
  landmarks: {
    enabled: true,
    defaultType: 'poi',
    scale: 1,
    seed: 11,
  },
  canopy: {
    enabled: false,
    canopyDensity: 0.88,
    canopyMaxCount: 4200,
    canopyScaleMin: 4,
    canopyScaleMax: 16,
    colorVariation: 0.35,
    accentClumps: true,
    seed: 42,
  },
};

export function normalizeDetailSettings(raw = {}) {
  const merged = {
    workflowVersion: Number(raw.workflowVersion) || DEFAULT_DETAIL_SETTINGS.workflowVersion,
    paths: { ...DEFAULT_DETAIL_SETTINGS.paths, ...(raw.paths || {}) },
    beachPalms: { ...DEFAULT_DETAIL_SETTINGS.beachPalms, ...(raw.beachPalms || {}) },
    rockScars: { ...DEFAULT_DETAIL_SETTINGS.rockScars, ...(raw.rockScars || {}) },
    resort: { ...DEFAULT_DETAIL_SETTINGS.resort, ...(raw.resort || {}) },
    docks: { ...DEFAULT_DETAIL_SETTINGS.docks, ...(raw.docks || {}) },
    landmarks: { ...DEFAULT_DETAIL_SETTINGS.landmarks, ...(raw.landmarks || {}) },
    canopy: { ...DEFAULT_DETAIL_SETTINGS.canopy, ...(raw.canopy || {}) },
    modelPacks: stripPackBlobsForState(normalizeModelPacks(raw.modelPacks || [])),
  };
  return merged;
}

/** Pokémon Concierge–style island dressing preset. */
export function pokemonResortDressingPreset() {
  return normalizeDetailSettings({
    paths: {
      enabled: true,
      colorPreset: 'sand',
      edgeSoftness: 0.62,
      vegetationClearRadiusM: 5,
    },
    beachPalms: {
      enabled: true,
      density: 0.48,
      maxCount: 160,
      minDistanceToWaterM: 3,
      maxDistanceToWaterM: 28,
    },
    rockScars: {
      enabled: true,
      slopeStartDeg: 34,
      slopeFullDeg: 52,
      minHeightM: 28,
      density: 0.62,
      warmth: 0.78,
    },
    resort: {
      enabled: true,
      buildingsPerComponent: 5,
      sizeMinM: 2.5,
      sizeMaxM: 7,
      colorPreset: 'resort-light',
    },
    docks: { enabled: true },
    landmarks: { enabled: true, defaultType: 'windmill' },
    canopy: {
      enabled: true,
      canopyDensity: 0.92,
      canopyMaxCount: 5000,
      canopyScaleMin: 5,
      canopyScaleMax: 18,
      colorVariation: 0.42,
      accentClumps: true,
    },
  });
}

export function normalizeRestoredStage(raw, workflowVersion) {
  const s = Number(raw) || 1;
  const wf = workflowVersion == null ? 4 : Number(workflowVersion) || 5;
  if (wf < 5) {
    if (s >= 4) return 5;
    return Math.min(4, Math.max(1, s));
  }
  return Math.min(5, Math.max(1, s));
}
