/** Procedural terrain palette — editable per material in the texture step. */

export const MATERIAL_COLOR_DEFAULTS = {
  sand: '#e2cf92',
  grass: '#609a4b',
  forest: '#307638',
  treesDark: '#1e562c',
  rock: '#7d7668',
  rockLight: '#a79e88',
  gravel: '#978b74',
  wetSand: '#baa980',
  water: '#194870',
};

export const MATERIAL_COLOR_LABELS = [
  { id: 'sand', label: 'Sand' },
  { id: 'grass', label: 'Grass' },
  { id: 'forest', label: 'Forest / trees' },
  { id: 'rock', label: 'Rock' },
  { id: 'gravel', label: 'Gravel' },
  { id: 'wetSand', label: 'Wet sand' },
];

function hexToRgb(hex) {
  const v = String(hex || '').replace('#', '').trim();
  if (v.length < 6) return [96, 154, 75];
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

function mixRgb(a, b, t) {
  const u = Math.max(0, Math.min(1, t));
  return [
    a[0] * (1 - u) + b[0] * u,
    a[1] * (1 - u) + b[1] * u,
    a[2] * (1 - u) + b[2] * u,
  ];
}

/** RGB tuples for proceduralTerrainTexture (FALLBACK shape). */
export function resolveMaterialPalette(settings = {}) {
  const custom = settings.materialColors || {};
  const strength = Math.max(0, Math.min(1, Number(settings.materialColorStrength ?? 1)));
  const out = {};
  for (const [key, hexDefault] of Object.entries(MATERIAL_COLOR_DEFAULTS)) {
    const def = hexToRgb(hexDefault);
    const customHex = custom[key];
    if (!customHex || strength <= 0) {
      out[key] = def;
    } else {
      out[key] = mixRgb(def, hexToRgb(customHex), strength);
    }
  }
  return out;
}

/** Blend a sampled PNG swatch toward the user's material tint. */
export function tintSampledMaterial(rgb, materialId, settings = {}) {
  if (!rgb || !settings.materialColors) return rgb;
  const strength = Math.max(0, Math.min(1, Number(settings.materialColorStrength ?? 1)));
  if (strength <= 0) return rgb;
  const key = materialId === 'trees' ? 'forest' : materialId === 'wet_sand' ? 'wetSand' : materialId;
  const hex = settings.materialColors[key];
  if (!hex) return rgb;
  return mixRgb(rgb, hexToRgb(hex), strength * 0.72);
}
