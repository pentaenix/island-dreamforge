/**
 * Island Dreamforge ocean palette (shallow → deep).
 * Keep in sync with backend/app/water_palette.py and water_band_steps.py
 */
export const ISLAND_WATER_HEX = [
  '#D8EFE8',
  '#7ED0D5',
  '#2DA8C1',
  '#117FA2',
  '#0A6283',
  '#064864',
];

export const NUM_WATER_BANDS = 6;

function hexToRgb(hex) {
  const v = String(hex).replace('#', '').trim();
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

export const ISLAND_WATER_RAMP = ISLAND_WATER_HEX.map((hex, i, arr) => [
  i / Math.max(1, arr.length - 1),
  hexToRgb(hex),
]);

function smoothstep01(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** Sample RGB; smoothness 0 = hard steps, 1 = smooth ramps between palette stops. */
export function sampleWaterColor(t01, smoothness = 0) {
  const ramp = ISLAND_WATER_RAMP;
  const t = Math.max(0, Math.min(1, Number(t01) || 0));
  const s = Math.max(0, Math.min(1, Number(smoothness) || 0));

  if (s <= 0.02) {
    const idx = Math.round(t * (ramp.length - 1));
    return [...ramp[idx][1]];
  }

  let seg = 0;
  for (; seg < ramp.length - 2; seg++) {
    if (t <= ramp[seg + 1][0]) break;
  }
  const [t0, c0] = ramp[seg];
  const [t1, c1] = ramp[seg + 1];
  const local = (t - t0) / Math.max(1e-6, t1 - t0);
  const soft = smoothstep01(local);
  const hard = local >= 0.5 ? 1 : 0;
  const blend = hard * (1 - s) + soft * s;
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * blend),
    Math.round(c0[1] + (c1[1] - c0[1]) * blend),
    Math.round(c0[2] + (c1[2] - c0[2]) * blend),
  ];
}

export function bandWidthsM(baseM, increaseM, count = NUM_WATER_BANDS, growthPower = 2) {
  const base = Math.max(1, Number(baseM) || 12);
  const inc = Math.max(0, Number(increaseM) || 0);
  const power = Math.max(1, Number(growthPower) || 2);
  return Array.from({ length: count }, (_, i) => base + inc * (i ** power));
}

export function bandEdgesFromSteps(baseM, increaseM, count = NUM_WATER_BANDS, growthPower = 2) {
  const edges = [0];
  for (const w of bandWidthsM(baseM, increaseM, count, growthPower)) {
    edges.push(edges[edges.length - 1] + w);
  }
  return edges;
}

export function defaultBandEdgesM(options = {}) {
  const custom = options.waterBandEdgesM;
  if (Array.isArray(custom) && custom.length >= 2) {
    return [...custom].map(Number).sort((a, b) => a - b);
  }

  return bandEdgesFromSteps(
    options.waterBandStepM ?? 12,
    options.waterBandStepIncreaseM ?? 8,
    NUM_WATER_BANDS,
    options.waterBandStepGrowthPower ?? 2,
  );
}

/** Total meters from shore covered by step + increase bands (for auto band-reach sizing). */
export function totalBandReachM(options = {}) {
  const edges = defaultBandEdgesM(options);
  return edges[edges.length - 1] || 0;
}

/** Map meters-from-shore to 0..1; each band gets equal palette span, widths grow by step + increase. */
export function bathy01FromDistanceM(distM, edges) {
  const dist = Number(distM) || 0;
  const n = Math.max(1, edges.length - 1);
  for (let i = 0; i < n; i++) {
    const lo = edges[i];
    const hi = i + 1 < edges.length ? edges[i + 1] : edges[edges.length - 1] + 1e6;
    if (dist >= lo && dist < hi) {
      const local = (dist - lo) / Math.max(1e-6, hi - lo);
      return (i + local) / Math.max(1, n - 1);
    }
  }
  return dist >= edges[edges.length - 1] ? 1 : 0;
}

/** Fade foam/waves near ocean disc edge (0 at rim, 1 inland). */
export function oceanDiscRimFade(radialM, oceanRadiusM, rimFadeM = 48) {
  const rim = Math.max(8, Number(rimFadeM) || 48);
  const oceanR = Number(oceanRadiusM) || 850;
  const inner = Math.max(0, oceanR - rim);
  const edge = oceanR - Math.max(4, rim * 0.08);
  const t = Math.max(0, Math.min(1, (radialM - inner) / Math.max(1e-6, edge - inner)));
  const s = t * t * (3 - 2 * t);
  return 1 - s;
}
