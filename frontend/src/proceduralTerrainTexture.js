/**
 * Procedural terrain albedo + normal — used by the texture swatch preview and
 * shares the same rules as TerrainViewport.paintAutoTexture.
 */

import * as THREE from 'three';
import { settingsForViewDistance } from './textureSettings.js';
import { textureNormsFromSettings } from './textureNorms.js';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function smoothstep(a, b, x) {
  const t = clamp((x - a) / Math.max(1e-6, b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function mix(a, b, t) { return a * (1 - t) + b * t; }
function mixRgb(a, b, t) {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}
function hashNoise(x, y, seed = 0) {
  const n = Math.sin((x * 127.1 + y * 311.7 + seed * 74.7)) * 43758.5453;
  return n - Math.floor(n);
}
function fbm(x, y, seed = 0) {
  let f = 0;
  let amp = 0.5;
  let scale = 1;
  for (let i = 0; i < 4; i++) {
    f += amp * hashNoise(Math.floor(x * scale), Math.floor(y * scale), seed + i * 13);
    amp *= 0.5;
    scale *= 2;
  }
  return f;
}

const FALLBACK = {
  sand: [226, 207, 146],
  grass: [96, 154, 75],
  forest: [48, 118, 56],
  treesDark: [30, 86, 44],
  rock: [125, 118, 104],
  rockLight: [167, 158, 136],
  gravel: [151, 139, 116],
  wetSand: [186, 169, 128],
  water: [25, 72, 112],
};

const SUN_DIR = { x: 0.48, y: 0.82, z: 0.38 };

/** Fixed “demo island” height + slope — not tied to the user’s map. */
export function buildSyntheticMountField(gridRows = 96, gridCols = 96) {
  const heights = new Float32Array(gridRows * gridCols);
  const slopes = new Float32Array(gridRows * gridCols);
  const seaNorm = 0.06;
  const sandNorm = 0.14;
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const u = c / Math.max(1, gridCols - 1);
      const v = r / Math.max(1, gridRows - 1);
      const dx = (u - 0.5) * 1.35;
      const dz = (v - 0.5) * 1.15;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const island = 1 - smoothstep(0.34, 0.82, dist);
      const peak = smoothstep(0.02, 0.5, 1 - dist * 0.95);
      const ridge = 0.58 + 0.42 * Math.sin(u * 9.2 + 0.4) * Math.cos(v * 7.1);
      const bowl = 0.12 + 0.82 * peak * ridge;
      let h = seaNorm + island * bowl;
      const shelf = smoothstep(0.5, 0.78, dist);
      h = mix(h, seaNorm + sandNorm * 0.55, shelf * 0.35);
      const i = r * gridCols + c;
      heights[i] = clamp(h, 0, 1);
    }
  }
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const i = r * gridCols + c;
      const h = heights[i];
      const hr = heights[clamp(r + 1, 0, gridRows - 1) * gridCols + c] ?? h;
      const hl = heights[clamp(r - 1, 0, gridRows - 1) * gridCols + c] ?? h;
      const hc = heights[r * gridCols + clamp(c + 1, 0, gridCols - 1)] ?? h;
      const hb = heights[r * gridCols + clamp(c - 1, 0, gridCols - 1)] ?? h;
      const gx = (hc - hb) * 120;
      const gz = (hr - hl) * 120;
      slopes[i] = Math.atan(Math.sqrt(gx * gx + gz * gz)) * 180 / Math.PI;
    }
  }
  return { heights, slopes, rows: gridRows, cols: gridCols, seaNorm, sandNorm };
}

function tileRgb(material, u, v) {
  const t = material || FALLBACK.grass;
  const n = fbm(u * 12, v * 12, 3);
  return [
    clamp(t[0] + (n - 0.5) * 18, 0, 255),
    clamp(t[1] + (n - 0.5) * 16, 0, 255),
    clamp(t[2] + (n - 0.5) * 12, 0, 255),
  ];
}

/**
 * @param {object} opts
 * @param {number} opts.size - output square px
 * @param {Float32Array} opts.heights
 * @param {Float32Array} opts.slopes
 * @param {number} opts.rows
 * @param {number} opts.cols
 * @param {object} opts.settings - texture settings
 * @param {number} [opts.seaNorm]
 * @param {number} [opts.sandNorm]
 */
/** Slope in degrees per height grid cell (matches TerrainViewport.slopeAt). */
export function buildSlopeFieldFromHeights(heights, rows, cols, { widthM, depthM, maxHeightM }) {
  const slopes = new Float32Array(rows * cols);
  const cellX = widthM / Math.max(1, cols - 1);
  const cellZ = depthM / Math.max(1, rows - 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const h = heights[i] ?? 0;
      const hr = heights[clamp(r + 1, 0, rows - 1) * cols + c] ?? h;
      const hl = heights[clamp(r - 1, 0, rows - 1) * cols + c] ?? h;
      const hc = heights[r * cols + clamp(c + 1, 0, cols - 1)] ?? h;
      const hb = heights[r * cols + clamp(c - 1, 0, cols - 1)] ?? h;
      const dx = Math.abs(hc - hb) * maxHeightM / Math.max(1, cellX * 2);
      const dz = Math.abs(hr - hl) * maxHeightM / Math.max(1, cellZ * 2);
      slopes[i] = Math.atan(Math.sqrt(dx * dx + dz * dz)) * 180 / Math.PI;
    }
  }
  return slopes;
}

export function paintProceduralTerrainTexture(opts) {
  const {
    size = 512,
    heights,
    slopes,
    rows,
    cols,
    settings = {},
    seaNorm: seaNormIn,
    sandNorm: sandNormIn,
    wetNorm: wetNormIn,
    worldW = 1480,
    worldD = 1086,
    landAt = null,
    sampleMaterial = null,
  } = opts;
  const norms = textureNormsFromSettings(settings, {
    maxHeightM: opts.maxHeightM,
    seaLevelM: opts.seaLevelM,
  });
  const seaNorm = seaNormIn ?? norms.seaNorm;
  const sandNorm = sandNormIn ?? norms.sandNorm;
  const wetNorm = wetNormIn ?? norms.wetNorm;

  const pixel = Math.max(1, Number(settings.pixelSize || 3));
  const coarseBlocks = 1 + Math.floor(Number(settings.distantPixelBoost ?? 0) * 2.2);
  const fuzzy = Number(settings.fuzziness ?? 0.16);
  const variation = Number(settings.variation ?? 0.18);
  const contrast = Number(settings.materialContrast ?? 0.42);
  const rockStart = Number(settings.rockSlopeStart ?? 50);
  const rockBlend = Number(settings.rockSlopeBlend ?? 14);
  const forestFade = Number(settings.forestSlopeFade ?? 48);
  const treeDensity = Number(settings.treeDensity ?? 0.88);
  const treePixel = Math.max(2, Number(settings.treePixelSize ?? 6));
  const gravelAmount = Number(settings.gravelAmount ?? 0.12);
  const forestMin = 0.04;
  const forestMax = 0.92;
  const tilingM = Number(settings.tilingM ?? 36);
  const macroTiling = Math.max(24, Number(settings.macroTilingM ?? 110));
  const macroV = Number(settings.macroVariation ?? 0.48);
  const aerial = Number(settings.aerialSoftness ?? 0.32);
  const img = new ImageData(size, size);
  const normalImg = new ImageData(size, size);
  const data = img.data;
  const nd = normalImg.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const blockX = Math.floor(x / (pixel * coarseBlocks)) * pixel * coarseBlocks;
      const blockY = Math.floor(y / (pixel * coarseBlocks)) * pixel * coarseBlocks;
      const r = clamp(Math.floor((y / size) * rows), 0, rows - 1);
      const c = clamp(Math.floor((x / size) * cols), 0, cols - 1);
      const i = r * cols + c;
      const h = heights[i] ?? 0;
      const slope = slopes[i] ?? 0;
      const land = landAt ? landAt(r, c, h, i) : h > seaNorm + 0.02;
      const coarse = fbm(blockX / (8 + pixel), blockY / (8 + pixel), 12);
      const fine = fbm(x / Math.max(2, pixel), y / Math.max(2, pixel), 31);
      const treeNoise = fbm(Math.floor(x / treePixel), Math.floor(y / treePixel), 55);
      const rockNoise = fbm(x / 18, y / 5, 88);
      const gravelNoise = fbm(x / 3, y / 3, 99);
      const shore = smoothstep(seaNorm, seaNorm + wetNorm, h);
      const rockT = smoothstep(rockStart, rockStart + rockBlend, slope);
      const forestBlock = (treeNoise < treeDensity && slope < forestFade) ? 1 : 0;
      const highForest = smoothstep(forestMin, forestMax, h) * (1 - rockT) * (0.62 + 0.38 * forestBlock);
      const gravelT = gravelAmount * smoothstep(22, 38, slope) * (1 - rockT) * smoothstep(sandNorm * 0.5, 0.22, h);
      const worldX = (c / Math.max(1, cols - 1)) * worldW;
      const worldZ = (r / Math.max(1, rows - 1)) * worldD;
      const tu = (worldX % tilingM) / tilingM;
      const tv = (worldZ % tilingM) / tilingM;
      const pick = (id, u, v, fb) => (sampleMaterial ? sampleMaterial(id, u, v, worldX, worldZ) : null) || tileRgb(fb, u, v);
      const sandRgb = pick('sand', tu, tv, FALLBACK.sand);
      const grassRgb = pick('grass', tu + 0.11, tv + 0.07, FALLBACK.grass);
      const treeRgb = pick('trees', tu + 0.19, tv + 0.13, FALLBACK.forest);
      const wetRgb = pick('wet_sand', tu + 0.03, tv + 0.05, FALLBACK.wetSand);
      const rockRgb = pick('rock', tu * 0.5, tv * 0.5, FALLBACK.rock);
      const gravelRgb = pick('gravel', tu * 0.35, tv * 0.35, FALLBACK.gravel);

      let color;
      let normalRgb = [128, 128, 255];
      if (!land) {
        color = [...FALLBACK.water];
      } else if (h < seaNorm + wetNorm) {
        color = mixRgb(wetRgb, sandRgb, shore);
      } else if (h < seaNorm + sandNorm) {
        color = mixRgb(sandRgb, grassRgb, smoothstep(seaNorm + wetNorm, seaNorm + sandNorm, h));
      } else {
        const canopyDark = mixRgb(treeRgb, FALLBACK.treesDark, 0.35 + treeNoise * 0.25);
        const forestRgb = mixRgb(grassRgb, canopyDark, highForest * (0.72 + 0.28 * treeNoise));
        const gravelMix = mixRgb(forestRgb, gravelRgb, gravelT * (0.35 + 0.45 * gravelNoise));
        const rockCol = mixRgb(rockRgb, FALLBACK.rockLight, rockNoise * 0.45 + fine * 0.1);
        color = mixRgb(gravelMix, rockCol, rockT);
        if (rockT > 0.35) color = mixRgb(color, rockCol, Math.min(1, rockT * 1.1));
      }

      if (land && (macroV > 0 || aerial > 0)) {
        const macro = fbm(worldX / macroTiling, worldZ / macroTiling, 21);
        const macroTint = mixRgb(grassRgb, sandRgb, smoothstep(0.35, 0.75, macro));
        color = mixRgb(color, macroTint, macroV * (0.35 + macro * 0.4));
        const soft = [
          color[0] * 0.9 + 12,
          color[1] * 0.92 + 14,
          color[2] * 0.88 + 10,
        ];
        color = mixRgb(color, soft, aerial * (0.25 + (1 - fine) * 0.35));
      }

      const nx = (c / Math.max(1, cols - 1) - 0.5) * 2;
      const nz = (r / Math.max(1, rows - 1) - 0.5) * 2;
      const lightBias = clamp(
        0.5 + 0.5 * (nx * SUN_DIR.x * 0.7 + nz * SUN_DIR.z * 0.55 + SUN_DIR.y * 0.25),
        0,
        1,
      );
      const highlight = [clamp(color[0] * 1.14 + 14, 0, 255), clamp(color[1] * 1.1 + 18, 0, 255), clamp(color[2] * 0.95, 0, 255)];
      const shadow = [color[0] * 0.7, color[1] * 0.76, color[2] * 0.84];
      color = mixRgb(mixRgb(color, shadow, (1 - lightBias) * 0.2), highlight, lightBias * 0.26);
      normalRgb = mixRgb(
        mixRgb([128, 140, 255], [140, 128, 220], shore),
        mixRgb([118, 118, 200], [150, 145, 130], rockT),
        rockT * 0.6 + gravelT * 0.15,
      );

      const shoreBand = h > seaNorm - 0.01 && h < seaNorm + sandNorm + wetNorm * 1.6;
      const shoreOpaque = land || shoreBand;
      if (shoreOpaque && !land) {
        color = mixRgb(wetRgb, sandRgb, clamp(shore * 1.15, 0, 1));
      }

      const foliageNorm = Number(settings.foliageNormalStrength ?? 0.72);
      if (land && highForest > 0.06 && rockT < 0.5) {
        const tuftCell = fbm(Math.floor(x / treePixel), Math.floor(y / treePixel), 77);
        const crown = smoothstep(0.38, 0.68, tuftCell) * forestBlock * highForest * (1 - rockT);
        color = mixRgb(color, FALLBACK.treesDark, crown * 0.4);
        color = mixRgb(color, [color[0] + 18, color[1] + 26, color[2] + 6], crown * 0.2 * (0.5 + treeNoise));
        const tgx = (fbm((x + 1) / treePixel, y / treePixel, 88) - fbm((x - 1) / treePixel, y / treePixel, 88))
          * foliageNorm * 58 * crown;
        const tgz = (fbm(x / treePixel, (y + 1) / treePixel, 88) - fbm(x / treePixel, (y - 1) / treePixel, 88))
          * foliageNorm * 58 * crown;
        normalRgb[0] = clamp(normalRgb[0] + tgx, 0, 255);
        normalRgb[1] = clamp(normalRgb[1] + 32 * crown + 12 * foliageNorm * forestBlock, 0, 255);
        normalRgb[2] = clamp(normalRgb[2] + tgz, 0, 255);
      }

      const artistNoise = (fine - 0.5) * 14 * variation;
      const p = (y * size + x) * 4;
      const fuzzMask = 1 - fuzzy * 0.1 + fuzzy * (0.68 + coarse * 0.32);
      const mid = 128 + (color[0] + color[1] + color[2]) / 3 - 128;
      const contrasted = [
        clamp(mid + (color[0] - mid) * (1 + contrast), 0, 255),
        clamp(mid + (color[1] - mid) * (1 + contrast), 0, 255),
        clamp(mid + (color[2] - mid) * (1 + contrast), 0, 255),
      ];
      data[p] = clamp(Math.round(contrasted[0] * fuzzMask + artistNoise), 0, 255);
      data[p + 1] = clamp(Math.round(contrasted[1] * fuzzMask + artistNoise), 0, 255);
      data[p + 2] = clamp(Math.round(contrasted[2] * fuzzMask + artistNoise * 0.45), 0, 255);
      data[p + 3] = shoreOpaque ? 255 : 0;
      const bump = (fine - 0.5) * Number(settings.normalStrength ?? 0.72) * 36;
      nd[p] = clamp(Math.round(normalRgb[0] + bump * 0.12), 0, 255);
      nd[p + 1] = clamp(Math.round(normalRgb[1] + bump * 0.08), 0, 255);
      nd[p + 2] = clamp(Math.round(normalRgb[2]), 0, 255);
      nd[p + 3] = shoreOpaque ? 255 : 0;
    }
  }
  return { color: img, normal: normalImg };
}

function imageDataToDataUrl(imageData) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Fixed world scale for the texture-step demo mount (not the user's island). */
export const DEMO_MOUNT_WORLD = { widthM: 420, depthM: 420, maxHeightM: 165 };

/**
 * Height grid → Three.js land mesh (top-down UVs match paintProceduralTerrainTexture).
 */
export function buildDemoMountGeometry(mount, world = DEMO_MOUNT_WORLD) {
  const { heights, rows, cols } = mount;
  const { widthM, depthM, maxHeightM } = world;
  const vertices = new Float32Array(rows * cols * 3);
  const uvs = new Float32Array(rows * cols * 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      vertices[i * 3] = (c / Math.max(1, cols - 1) - 0.5) * widthM;
      vertices[i * 3 + 1] = (heights[i] ?? 0) * maxHeightM;
      vertices[i * 3 + 2] = (r / Math.max(1, rows - 1) - 0.5) * depthM;
      uvs[i * 2] = c / Math.max(1, cols - 1);
      uvs[i * 2 + 1] = 1 - r / Math.max(1, rows - 1);
    }
  }
  const indices = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const cIdx = (r + 1) * cols + c;
      const d = cIdx + 1;
      indices.push(a, cIdx, b, b, cIdx, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Procedural albedo + normal for the demo mount mesh. */
export function paintDemoMountTextures(settings, mount, texSize = 640, world = {}) {
  const norms = textureNormsFromSettings(settings, world);
  return paintProceduralTerrainTexture({
    size: texSize,
    heights: mount.heights,
    slopes: mount.slopes,
    rows: mount.rows,
    cols: mount.cols,
    settings,
    seaNorm: norms.seaNorm,
    sandNorm: norms.sandNorm,
    wetNorm: norms.wetNorm,
    maxHeightM: norms.maxHeightM,
    seaLevelM: norms.seaLevelM,
  });
}

export function imageDataToCanvasTexture(imageData, { color = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Shape-agnostic texture swatch (demo mount) with near / mid / far readouts.
 */
export function buildTextureSwatchPreview(settings = {}, world = {}) {
  const mount = buildSyntheticMountField(96, 96);
  const norms = textureNormsFromSettings(settings, world);
  const paintOpts = {
    ...mount,
    seaNorm: norms.seaNorm,
    sandNorm: norms.sandNorm,
    wetNorm: norms.wetNorm,
    maxHeightM: norms.maxHeightM,
    seaLevelM: norms.seaLevelM,
  };
  const near = paintProceduralTerrainTexture({ size: 560, ...paintOpts, settings });
  const mid = paintProceduralTerrainTexture({
    size: 280,
    ...paintOpts,
    settings: settingsForViewDistance(settings, 1.85),
  });
  const far = paintProceduralTerrainTexture({
    size: 140,
    ...paintOpts,
    settings: settingsForViewDistance(settings, 3.2),
  });

  return {
    albedoUrl: imageDataToDataUrl(near.color),
    normalUrl: imageDataToDataUrl(near.normal),
    nearUrl: imageDataToDataUrl(near.color),
    midUrl: imageDataToDataUrl(mid.color),
    farUrl: imageDataToDataUrl(far.color),
  };
}
