import {
  bathy01FromDistanceM,
  defaultBandEdgesM,
  oceanDiscRimFade,
  sampleWaterColor,
} from './waterPalette.js';
import { applySurfaceOverlays } from './waterSurfaceComposite.js';
import { getWaterDiscPreviewSpanM } from './worldSettings.js';

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / Math.max(1e-6, b - a)));
  return t * t * (3 - 2 * t);
}

function hashNoise(ix, iy, seed) {
  const s = Math.sin((ix + seed * 13.17) * 12.9898 + (iy - seed * 7.91) * 78.233) * 43758.5453;
  return s - Math.floor(s);
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

function drawPreviewModel(data, size, row, col, radial, sphereR) {
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
  const bandSmooth = Number(options.waterBandSmoothness ?? options.waterColorSmoothness ?? 0.35);

  const size = 640;
  const edges = defaultBandEdgesM(options);
  const shallowEdge = edges[2] ?? 24;
  const deepEdge = edges[edges.length - 2] ?? 150;
  const reefScaleM = Math.max(8, Number(options.waterNoiseScaleM ?? 85) * 0.65);

  const depthCanvas = document.createElement('canvas');
  depthCanvas.width = size;
  depthCanvas.height = size;
  const depthCtx = depthCanvas.getContext('2d', { willReadFrequently: true });
  const depthImg = depthCtx.createImageData(size, size);
  const depthData = depthImg.data;

  const foamCanvas = document.createElement('canvas');
  foamCanvas.width = size;
  foamCanvas.height = size;
  const foamCtx = foamCanvas.getContext('2d', { willReadFrequently: true });
  const foamImg = foamCtx.createImageData(size, size);
  const foamData = foamImg.data;

  const viewSpanM = Number(options.waterDiscPreviewSpanM) > 0
    ? Number(options.waterDiscPreviewSpanM)
    : getWaterDiscPreviewSpanM(
      { widthM: options.widthM, depthM: options.depthM, lockAspect: options.lockAspect },
      { width: options.mapWidthPx, height: options.mapHeightPx },
      oceanR,
    );
  const pixelM = viewSpanM / Math.max(1, size - 1);

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const x = (col / (size - 1) - 0.5) * viewSpanM;
      const z = (row / (size - 1) - 0.5) * viewSpanM;
      const radial = Math.hypot(x, z);
      const p = (row * size + col) * 4;

      if (drawPreviewModel(depthData, size, row, col, radial, sphereR)) {
        foamData[p + 3] = 0;
        continue;
      }

      if (radial > oceanR) {
        depthData[p] = 14;
        depthData[p + 1] = 36;
        depthData[p + 2] = 52;
        depthData[p + 3] = 255;
        foamData[p + 3] = 0;
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

      const bathy = bathy01FromDistanceM(distM, edges);
      const [r, g, b] = sampleWaterColor(bathy, bandSmooth);
      depthData[p] = r;
      depthData[p + 1] = g;
      depthData[p + 2] = b;
      depthData[p + 3] = 255;

      const rimFadeM = Number(options.oceanFoamRimFadeM ?? 48);
      const rimFactor = oceanDiscRimFade(radial, oceanR, rimFadeM);
      const foamT = 1 - smoothstep(Math.max(pixelM, foamWidth * 0.12), foamWidth, distM);
      let foamMix = 0;
      if (foamT > 0 && foamStrength > 0 && rimFactor > 0.02) {
        const foamNoise = (valueNoiseWorld(x, z, Math.max(3, foamWidth * 0.5), seed + 71) + 1) * 0.5;
        foamMix = foamT * foamStrength * (0.7 + 0.3 * foamNoise) * rimFactor;
      }
      const fv = Math.round(Math.min(255, foamMix * 255));
      foamData[p] = fv;
      foamData[p + 1] = fv;
      foamData[p + 2] = fv;
      foamData[p + 3] = 255;
    }
  }

  depthCtx.putImageData(depthImg, 0, 0);
  foamCtx.putImageData(foamImg, 0, 0);

  const displayCanvas = document.createElement('canvas');
  displayCanvas.width = size;
  displayCanvas.height = size;
  const displayCtx = displayCanvas.getContext('2d', { willReadFrequently: true });
  displayCtx.drawImage(depthCanvas, 0, 0);
  const displayImg = displayCtx.getImageData(0, 0, size, size);
  applySurfaceOverlays(displayImg, foamData, { ...options, oceanRadiusM: oceanR, previewSpanM: viewSpanM }, size, size);
  displayCtx.putImageData(displayImg, 0, 0);

  return {
    waterColor: displayCanvas.toDataURL('image/png'),
    waterColorDepth: depthCanvas.toDataURL('image/png'),
    foamMask: foamCanvas.toDataURL('image/png'),
    oceanRadiusM: oceanR,
    oceanDiameterM: oceanR * 2,
    previewSphereRadiusM: sphereR,
    mode: 'disc_sphere_client',
  };
}
