/** Generic GLB model pack schema and placement presets for step 4 · Details. */

export const MATERIAL_IDS = {
  water: 0,
  wet_sand: 1,
  sand: 2,
  grass: 3,
  forest: 4,
  rock: 5,
  gravel: 6,
  dirt: 7,
};

export const PLACEMENT_MODES = [
  { id: 'scatter-on-land', label: 'Scatter on land' },
  { id: 'scatter-near-coast', label: 'Scatter near coast' },
  { id: 'scatter-on-beach', label: 'Scatter on beach' },
  { id: 'scatter-inland', label: 'Scatter inland' },
  { id: 'scatter-on-steep-slopes', label: 'Scatter on steep slopes' },
  { id: 'scatter-near-paths', label: 'Scatter near paths' },
  { id: 'scatter-near-rivers', label: 'Scatter near rivers' },
  { id: 'scatter-on-mask', label: 'Scatter on mask layer' },
  { id: 'manual-marker-based', label: 'Manual marker-based' },
];

export const DEFAULT_PACK_PLACEMENT = {
  mode: 'scatter-on-land',
  density: 0.35,
  maxCount: 120,
  seed: 42,
  scaleMin: 1,
  scaleMax: 3,
  randomRotation: true,
  slopeMinDeg: 0,
  slopeMaxDeg: 35,
  heightMinM: 0,
  heightMaxM: 800,
  coastDistanceMinM: 0,
  coastDistanceMaxM: 500,
  allowedMaterials: [],
  avoidMaterials: [],
  avoidWater: true,
  avoidRivers: true,
  avoidPaths: true,
  avoidStructures: true,
  avoidDocks: true,
  avoidOtherModelPacks: true,
  clearVegetationRadiusM: 2.5,
  snapToGround: true,
  alignToNormal: false,
  jitterM: 1.2,
  clusterRadiusM: 0,
  noiseScaleM: 14,
  noiseThreshold: 0.45,
  maskLayerId: null,
  markerLayerId: null,
};

let packIdCounter = 0;

export function createModelPackId() {
  packIdCounter += 1;
  return `pack-${Date.now().toString(36)}-${packIdCounter}`;
}

export function createEmptyModelPack(overrides = {}) {
  return normalizeModelPack({
    id: createModelPackId(),
    name: 'New model pack',
    tags: [],
    enabled: true,
    glbDataUrl: '',
    glbFileName: '',
    variantMeta: [],
    placement: { ...DEFAULT_PACK_PLACEMENT },
    ...overrides,
  });
}

export function normalizeModelPack(raw = {}) {
  const placement = { ...DEFAULT_PACK_PLACEMENT, ...(raw.placement || {}) };
  const hasGlb = !!(raw.hasGlb || raw.glbDataUrl || raw.glbUrl);
  return {
    id: String(raw.id || createModelPackId()),
    name: String(raw.name || 'Model pack'),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    enabled: raw.enabled !== false,
    hasGlb,
    glbFileName: raw.glbFileName || '',
    variantMeta: Array.isArray(raw.variantMeta) ? raw.variantMeta : [],
    placement: {
      ...placement,
      density: Number(placement.density ?? DEFAULT_PACK_PLACEMENT.density),
      maxCount: Math.max(1, Math.round(Number(placement.maxCount ?? DEFAULT_PACK_PLACEMENT.maxCount))),
      seed: Math.round(Number(placement.seed ?? DEFAULT_PACK_PLACEMENT.seed)),
      scaleMin: Number(placement.scaleMin ?? DEFAULT_PACK_PLACEMENT.scaleMin),
      scaleMax: Number(placement.scaleMax ?? DEFAULT_PACK_PLACEMENT.scaleMax),
      slopeMinDeg: Number(placement.slopeMinDeg ?? DEFAULT_PACK_PLACEMENT.slopeMinDeg),
      slopeMaxDeg: Number(placement.slopeMaxDeg ?? DEFAULT_PACK_PLACEMENT.slopeMaxDeg),
      heightMinM: Number(placement.heightMinM ?? DEFAULT_PACK_PLACEMENT.heightMinM),
      heightMaxM: Number(placement.heightMaxM ?? DEFAULT_PACK_PLACEMENT.heightMaxM),
      coastDistanceMinM: Number(placement.coastDistanceMinM ?? DEFAULT_PACK_PLACEMENT.coastDistanceMinM),
      coastDistanceMaxM: Number(placement.coastDistanceMaxM ?? DEFAULT_PACK_PLACEMENT.coastDistanceMaxM),
      allowedMaterials: Array.isArray(placement.allowedMaterials) ? placement.allowedMaterials : [],
      avoidMaterials: Array.isArray(placement.avoidMaterials) ? placement.avoidMaterials : [],
      jitterM: Number(placement.jitterM ?? DEFAULT_PACK_PLACEMENT.jitterM),
      clusterRadiusM: Number(placement.clusterRadiusM ?? DEFAULT_PACK_PLACEMENT.clusterRadiusM),
      noiseScaleM: Number(placement.noiseScaleM ?? DEFAULT_PACK_PLACEMENT.noiseScaleM),
      noiseThreshold: Number(placement.noiseThreshold ?? DEFAULT_PACK_PLACEMENT.noiseThreshold),
      clearVegetationRadiusM: Number(placement.clearVegetationRadiusM ?? DEFAULT_PACK_PLACEMENT.clearVegetationRadiusM),
    },
  };
}

export function normalizeModelPacks(list) {
  if (!Array.isArray(list)) return [];
  return list.map((p) => normalizeModelPack(p));
}

/** Merge placement-mode preset into resolved rules (no renderer special cases). */
export function resolvePlacementRules(placement = {}) {
  const base = { ...DEFAULT_PACK_PLACEMENT, ...placement };
  const mode = base.mode || 'scatter-on-land';
  const rules = { ...base };

  switch (mode) {
    case 'scatter-near-coast':
      rules.avoidWater = true;
      rules.coastDistanceMinM = Math.max(rules.coastDistanceMinM, 1);
      rules.coastDistanceMaxM = Math.min(rules.coastDistanceMaxM, 45);
      rules.slopeMaxDeg = Math.min(rules.slopeMaxDeg, 28);
      break;
    case 'scatter-on-beach':
      rules.avoidWater = true;
      rules.coastDistanceMinM = Math.max(rules.coastDistanceMinM, 0);
      rules.coastDistanceMaxM = Math.min(rules.coastDistanceMaxM, 22);
      rules.allowedMaterials = rules.allowedMaterials.length
        ? rules.allowedMaterials
        : ['sand', 'wet_sand', 'grass'];
      rules.slopeMaxDeg = Math.min(rules.slopeMaxDeg, 18);
      break;
    case 'scatter-inland':
      rules.avoidWater = true;
      rules.coastDistanceMinM = Math.max(rules.coastDistanceMinM, 25);
      rules.coastDistanceMaxM = Math.max(rules.coastDistanceMaxM, 500);
      break;
    case 'scatter-on-steep-slopes':
      rules.avoidWater = true;
      rules.slopeMinDeg = Math.max(rules.slopeMinDeg, 32);
      rules.slopeMaxDeg = Math.max(rules.slopeMaxDeg, 55);
      rules.allowedMaterials = rules.allowedMaterials.length
        ? rules.allowedMaterials
        : ['rock', 'gravel'];
      break;
    case 'scatter-near-paths':
      rules.avoidPaths = false;
      rules.preferPathMask = true;
      rules.coastDistanceMinM = 0;
      break;
    case 'scatter-near-rivers':
      rules.avoidRivers = false;
      rules.preferRiverMask = true;
      break;
    case 'scatter-on-mask':
      rules.requireMaskLayer = true;
      break;
    case 'manual-marker-based':
      rules.requireMarkerLayer = true;
      rules.maxCount = Math.min(rules.maxCount, 80);
      break;
    default:
      rules.avoidWater = rules.avoidWater !== false;
      break;
  }

  if (rules.scaleMax < rules.scaleMin) {
    const t = rules.scaleMin;
    rules.scaleMin = rules.scaleMax;
    rules.scaleMax = t;
  }
  return rules;
}

export function materialNameFromId(id) {
  const entry = Object.entries(MATERIAL_IDS).find(([, v]) => v === id);
  return entry ? entry[0] : null;
}

export function materialIdFromName(name) {
  if (name == null || name === '') return null;
  const key = String(name).toLowerCase().replace(/\s+/g, '_');
  return MATERIAL_IDS[key] ?? null;
}
