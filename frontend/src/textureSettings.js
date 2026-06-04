/** Shared defaults for procedural terrain textures (step 2 + 3D viewport). */

import { DEFAULT_DIORAMA_LIGHTING } from './dioramaLighting.js';
import { MATERIAL_COLOR_DEFAULTS } from './materialColors.js';

export const DEFAULT_TEXTURE_SETTINGS = {
  textureSize: 2048,
  pixelSize: 3,
  fuzziness: 0.16,
  normalStrength: 0.72,
  /** Fake canopy relief in the normal map (no extra geometry). */
  foliageNormalStrength: 0.78,
  materialContrast: 0.42,
  variation: 0.18,
  tilingM: 36,
  macroTilingM: 110,
  macroVariation: 0.48,
  distantPixelBoost: 0.55,
  aerialSoftness: 0.32,
  treeDensity: 0.98,
  treeCountMax: 9000,
  treeSpacing: 2,
  treeSeed: 42,
  treeMinHeightM: 1,
  treePixelSize: 6,
  forestSlopeFade: 76,
  wallTreeSlopeStart: 42,
  rockSlopeStart: 68,
  rockSlopeBlend: 14,
  rockFeatureScale: 0.55,
  gravelAmount: 0.12,
  sandHeightM: 14,
  wetSandWidthM: 5,
  preservePaintedEdits: true,
  /** 3D cone clumps on the island mesh (off by default; forest slider is texture-only). */
  showForestClumps: false,
  /** 0 = PNG swatches only, 1 = full procedural palette from materialColors. */
  materialColorStrength: 1,
  materialColors: { ...MATERIAL_COLOR_DEFAULTS },
  dioramaLighting: { ...DEFAULT_DIORAMA_LIGHTING },
  /** When true, island 3D uses procedural colors only (fixes overly bright PNG greens). */
  proceduralColorsOnly: true,
};

export function normalizeTextureSettings(raw = {}) {
  const merged = { ...DEFAULT_TEXTURE_SETTINGS, ...raw };
  merged.materialColors = { ...MATERIAL_COLOR_DEFAULTS, ...(raw.materialColors || {}) };
  merged.dioramaLighting = { ...DEFAULT_DIORAMA_LIGHTING, ...(raw.dioramaLighting || {}) };
  merged.materialColorStrength = Math.max(0, Math.min(1, Number(merged.materialColorStrength ?? 1)));
  return merged;
}

export function settingsForViewDistance(settings, factor = 1) {
  const f = Math.max(1, Number(factor) || 1);
  return {
    ...settings,
    pixelSize: Math.min(18, Math.round(Number(settings.pixelSize || 3) * f)),
    treePixelSize: Math.min(28, Math.round(Number(settings.treePixelSize || 6) * f * 0.85)),
    variation: Number(settings.variation ?? 0.18) * Math.max(0.4, 1 - (f - 1) * 0.22),
    macroVariation: Math.min(1, Number(settings.macroVariation ?? 0.48) * (0.9 + (f - 1) * 0.12)),
    distantPixelBoost: Math.min(1.4, Number(settings.distantPixelBoost ?? 0.55) * f),
    aerialSoftness: Math.min(0.65, Number(settings.aerialSoftness ?? 0.32) * (0.85 + (f - 1) * 0.2)),
  };
}
