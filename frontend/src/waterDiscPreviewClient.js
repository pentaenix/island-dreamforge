/** Tropical ramp — keep in sync with backend/app/bathymetry.py TROPICAL_RAMP */
const TROPICAL_RAMP = [
  [241, 229, 178],
  [189, 244, 231],
  [83, 214, 210],
  [31, 182, 201],
  [8, 127, 176],
  [6, 43, 99],
];

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / Math.max(1e-6, b - a)));
  return t * t * (3 - 2 * t);
}

function hashNoise(ix, iy, seed) {
  const s = Math.sin((ix + seed * 13.17) * 12.9898 + (iy - seed * 7.91) * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function fbmWorld(x, z, scaleM, seed) {
  const sx = x / Math.max(5, scaleM);
  const sz = z / Math.max(5, scaleM);
  let f = 0;
  let amp = 0.5;
  let scale = 1;
  for (let i = 0; i < 4; i++) {
    f += amp * hashNoise(Math.floor(sx * scale), Math.floor(sz * scale), seed + i * 17);
    amp *= 0.5;
    scale *= 2;
  }
  return f * 2 - 1;
}

function valueNoiseWorld(x, z, scaleM, seed) {
  const step = Math.max(5, scaleM);
  const sx = x / step;
  const sz = z / step;
  const x0 = Math.floor(sx);
  const z0 = Math.floor(sz);
  const x1 = x0 + 1;
  const z1 = z0 + 1;
  const tx = sx - x0;
  const tz = sz - z0;
  const a = hashNoise(x0, z0, seed);
  const b = hashNoise(x1, z0, seed + 3);
  const c = hashNoise(x0, z1, seed + 7);
  const d = hashNoise(x1, z1, seed + 11);
  return ((a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz) * 2 - 1;
}

function bandEdgesFromOptions(opts) {
  const shallow = Number(opts.shallowShelfM ?? opts.shoreShelfWidthM ?? 24);
  const mid = Number(opts.midShelfM ?? opts.midWaterDistanceM ?? 70);
  const deep = Number(opts.deepStartM ?? opts.deepWaterDistanceM ?? 150);
  const edges = [0, Math.max(4, shallow * 0.35), shallow, mid, deep, deep + 80];
  for (let i = 1; i < edges.length; i++) {
    if (edges[i] <= edges[i - 1]) edges[i] = edges[i - 1] + 1;
  }
  return edges;
}

function bathy01FromDistance(distM, edges) {
  const n = Math.max(1, edges.length - 1);
  for (let i = 0; i < n; i++) {
    const lo = edges[i];
    const hi = i + 1 < edges.length ? edges[i + 1] : edges[edges.length - 1] + 1e6;
    if (distM >= lo && distM < hi) return i / Math.max(1, n - 1);
  }
  return 1;
}

function colorFromBathy(t) {
  const idx = Math.round(Math.max(0, Math.min(1, t)) * (TROPICAL_RAMP.length - 1));
  return TROPICAL_RAMP[idx];
}

function drawPreviewModel(data, size, row, col, radial, sphereR, oceanR) {
  const p = (row * size + col) * 4;
  if (radial > sphereR) return false;
  const u = radial / Math.max(1, sphereR);
  const shade = 0.55 + 0.45 * Math.sqrt(Math.max(0, 1 - u * u));
  const warm = 1 - u * 0.35;
  data[p] = Math.round(118 * shade * warm);
  data[p + 1] = Math.round(98 * shade * warm);
  data[p + 2] = Math.round(72 * shade);
  data[p + 3] = 255;
  return true;
}

/**
 * Shape-agnostic water disc + center model preview (no island heightmap).
 */
export function buildWaterDiscPreview(options = {}) {
  const oceanR = Math.max(50, Number(options.oceanRadiusM) || 850);
  let sphereR = Math.max(20, Number(options.previewSphereRadiusM) || 220);
  sphereR = Math.min(sphereR, oceanR - 20);

  const seed = Math.round(Number(options.materialSeed ?? options.seed ?? 1337)) || 1337;
  const reefStrength = Number(options.reefNoiseStrength ?? 0.08);
  const coastalVar = Number(options.coastalVariationStrength ?? 0.15);
  const foamWidth = Number(options.foamWidthM ?? 12);
  const foamStrength = Number(options.foamStrength ?? 0.2);
  const waveStrength = Number(options.waterNoiseStrength ?? 0.1);
  const waveScaleM = Math.max(8, Number(options.waterNoiseScaleM ?? 85));
  const reefScaleM = Math.max(8, Number(options.waterNoiseScaleM ?? 85) * 0.65);

  const size = 640;
  const edges = bandEdgesFromOptions(options);
  const shallowEdge = edges[2] ?? 24;
  const deepEdge = edges[edges.length - 2] ?? 150;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const span = oceanR * 2;
  const pixelM = span / Math.max(1, size - 1);

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const x = (col / (size - 1) - 0.5) * span;
      const z = (row / (size - 1) - 0.5) * span;
      const radial = Math.hypot(x, z);

      if (drawPreviewModel(data, size, row, col, radial, sphereR, oceanR)) continue;

      if (radial > oceanR) {
        const p = (row * size + col) * 4;
        data[p] = 2;
        data[p + 1] = 7;
        data[p + 2] = 11;
        data[p + 3] = 255;
        continue;
      }

      let distM = Math.max(0, radial - sphereR);
      const coastNoise = valueNoiseWorld(x, z, Math.max(shallowEdge * 2, 40), seed + 11);
      distM *= 1 + coastalVar * coastNoise * 0.22;

      if (reefStrength > 0) {
        const reef = valueNoiseWorld(x, z, reefScaleM, seed + 29);
        const shallowW = 1 - smoothstep(shallowEdge, deepEdge, distM);
        distM += reef * reefStrength * shallowW * shallowEdge * 0.35;
      }

      let bathy = bathy01FromDistance(distM, edges);

      if (waveStrength > 0) {
        const wave = fbmWorld(x, z, waveScaleM, seed + 101);
        bathy = Math.max(0, Math.min(1, bathy + wave * waveStrength * 0.22));
      }

      let [r, g, b] = colorFromBathy(bathy);

      const foamT = 1 - smoothstep(Math.max(pixelM, foamWidth * 0.12), foamWidth, distM);
      if (foamT > 0 && foamStrength > 0) {
        const foamNoise = (valueNoiseWorld(x, z, Math.max(3, foamWidth * 0.5), seed + 71) + 1) * 0.5;
        const foamMix = foamT * foamStrength * (0.7 + 0.3 * foamNoise);
        r = Math.round(r * (1 - foamMix) + 245 * foamMix);
        g = Math.round(g * (1 - foamMix) + 252 * foamMix);
        b = Math.round(b * (1 - foamMix) + 255 * foamMix);
      }

      if (waveStrength > 0) {
        const sparkle = fbmWorld(x * 1.3 + 40, z * 1.3 - 20, waveScaleM * 0.45, seed + 203);
        const glint = Math.max(0, sparkle) * waveStrength * 0.35;
        r = Math.min(255, Math.round(r + glint * 90));
        g = Math.min(255, Math.round(g + glint * 110));
        b = Math.min(255, Math.round(b + glint * 80));
      }

      const p = (row * size + col) * 4;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return {
    waterColor: canvas.toDataURL('image/png'),
    oceanRadiusM: oceanR,
    oceanDiameterM: oceanR * 2,
    previewSphereRadiusM: sphereR,
    mode: 'disc_sphere_client',
  };
}
