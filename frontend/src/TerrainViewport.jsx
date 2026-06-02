import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  buildSlopeFieldFromHeights,
  paintProceduralTerrainTexture,
} from './proceduralTerrainTexture.js';
import {
  clampMeshResolution,
  elevationMetersFromNormalized,
  getIslandHorizonScale,
  getOceanDiscRadiusM,
  meshSpacingCells,
} from './worldSettings.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const SKYBOX_CUBE_PATH = '/island-assets/skybox/sky_03_2k/sky_03_cubemap_2k';
const SKYBOX_MAX_DISTANCE = 5800;
const VIEWPORT_CONFIG_URL = '/viewport_config.json';

const DEFAULT_VIEWPORT_CONFIG = {
  lighting: {
    sunDirection: [0.48, 0.82, 0.38],
    sunColor: '#fff9ee',
    sunIntensity: 3.85,
    ambientColor: '#8eb8d8',
    ambientIntensity: 0.11,
    hemisphereSky: '#a8d8ff',
    hemisphereGround: '#1a4a22',
    hemisphereIntensity: 0.48,
    fillColor: '#c8e4ff',
    fillIntensity: 0.1,
    rimColor: '#ffe8c8',
    rimIntensity: 0.14,
    exposure: 1.28,
    envMapIntensity: 1.05,
  },
  fog: { enabled: true, color: '#9ecae8', density: 0.000024 },
  water: {
    enabled: true,
    waterColor: '#0a2d52',
    sunColor: '#fffef5',
    sunDirection: [0.48, 0.82, 0.38],
    distortionScale: 4.6,
    alpha: 1,
    textureWidth: 1024,
    textureHeight: 1024,
    waveSpeed: 0.52,
    clipBias: 0,
    planeScale: 2.2,
  },
  terrainTextures: { tilingM: 28, paths: {} },
  vegetation: {
    enabled: true,
    density: 0.82,
    maxCount: 3600,
    spacing: 3,
    minHeightNorm: 0.02,
    maxSlopeDeg: 48,
    minHeightM: 2,
    scaleMin: 3.5,
    scaleMax: 14,
    seed: 42,
    colorTint: '#6aad52',
    accentTint: '#4a8c3a',
    carpetLayers: 2,
  },
  terrainRules: {
    rockSlopeStart: 50,
    rockSlopeBlend: 14,
    forestSlopeFade: 48,
    treeDensity: 0.88,
    treePixelSize: 4,
    gravelAmount: 0.12,
    sandHeightM: 14,
    wetSandWidthM: 5,
    forestHeightMin: 0.04,
    forestHeightMax: 0.95,
  },
};

const legacyTextureUrls = {
  sand: new URL('./assets/textures/sand.png', import.meta.url).href,
  grass: new URL('./assets/textures/grass.png', import.meta.url).href,
  trees: new URL('./assets/textures/grass.png', import.meta.url).href,
  rock: new URL('./assets/textures/rock.png', import.meta.url).href,
  gravel: new URL('./assets/textures/gravel.png', import.meta.url).href,
  wet_sand: new URL('./assets/textures/wet_sand.png', import.meta.url).href,
};

/** Paintable terrain materials only — water is the ocean plane, not paintable. */
export const MATERIALS = [
  { id: 'trees', label: 'Trees' },
  { id: 'grass', label: 'Grass' },
  { id: 'sand', label: 'Sand' },
  { id: 'gravel', label: 'Gravel' },
  { id: 'rock', label: 'Rock' },
];

async function loadViewportConfig() {
  try {
    const res = await fetch(VIEWPORT_CONFIG_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ...DEFAULT_VIEWPORT_CONFIG, ...(await res.json()) };
  } catch (err) {
    console.warn('viewport_config.json unavailable, using defaults', err);
    return { ...DEFAULT_VIEWPORT_CONFIG };
  }
}

function hexColor(value, fallback = 0xffffff) {
  try {
    return new THREE.Color(value || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function smoothstep(a, b, x) { const t = clamp((x - a) / Math.max(1e-6, b - a), 0, 1); return t * t * (3 - 2 * t); }
function mix(a, b, t) { return a * (1 - t) + b * t; }
function mixRgb(a, b, t) { return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]; }
function hexToRgb(hex, fallback = [45, 183, 217]) {
  const v = String(hex || '').replace('#', '');
  if (v.length !== 6) return fallback;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
function hashNoise(x, y, seed = 0) {
  const n = Math.sin((x * 127.1 + y * 311.7 + seed * 74.7)) * 43758.5453;
  return n - Math.floor(n);
}
function fbm(x, y, seed = 0) {
  let f = 0, amp = 0.5, scale = 1.0;
  for (let i = 0; i < 4; i++) {
    f += amp * hashNoise(Math.floor(x * scale), Math.floor(y * scale), seed + i * 13);
    amp *= 0.5; scale *= 2.0;
  }
  return f;
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function loadImageData(src, cols, rows) {
  if (!src) return null;
  try {
    const img = await loadImage(src);
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cols, rows);
    return ctx.getImageData(0, 0, cols, rows);
  } catch (err) {
    console.warn('Preview map failed to load', src, err);
    return null;
  }
}

function channelAt(imageData, rows, cols, r, c, channel = 0) {
  if (!imageData?.data) return 0;
  const rr = clamp(Math.round(r), 0, rows - 1);
  const cc = clamp(Math.round(c), 0, cols - 1);
  return imageData.data[(rr * cols + cc) * 4 + channel];
}

async function loadPatternImage(src, fallbackSrc) {
  try {
    const img = await loadImage(src);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return { img, data: ctx.getImageData(0, 0, canvas.width, canvas.height), w: canvas.width, h: canvas.height };
  } catch (err) {
    if (!fallbackSrc) throw err;
    return loadPatternImage(fallbackSrc);
  }
}

function samplePattern(pat, u, v) {
  if (!pat?.data) return null;
  const x = Math.abs(Math.floor(u * pat.w)) % pat.w;
  const y = Math.abs(Math.floor(v * pat.h)) % pat.h;
  const i = (y * pat.w + x) * 4;
  return [pat.data.data[i], pat.data.data[i + 1], pat.data.data[i + 2]];
}

function samplePatternNormal(pat, u, v) {
  const rgb = samplePattern(pat, u, v);
  if (!rgb) return [128, 128, 255];
  return rgb;
}

function isUnderwaterAt(s, r, c, seaNorm) {
  const rr = clamp(Math.round(r), 0, (s.rows || 1) - 1);
  const cc = clamp(Math.round(c), 0, (s.cols || 1) - 1);
  return (s.heights?.[rr * s.cols + cc] || 0) <= seaNorm + 0.003;
}

function vegetationSettings(s, textureSettings = {}) {
  const base = s.viewportConfig?.vegetation || DEFAULT_VIEWPORT_CONFIG.vegetation;
  const ts = textureSettings || {};
  return {
    ...base,
    maxSlopeDeg: ts.forestSlopeFade ?? base.maxSlopeDeg,
    seed: ts.treeSeed ?? base.seed,
    minHeightM: ts.treeMinHeightM ?? base.minHeightM,
    wallTreeSlopeStart: ts.wallTreeSlopeStart ?? base.wallTreeSlopeStart,
    enabled: ts.showForestClumps === true ? base.enabled !== false : false,
  };
}

function loadSkyboxCube() {
  const faces = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  const urls = faces.map((face) => `${SKYBOX_CUBE_PATH}/${face}.png`);
  return new Promise((resolve, reject) => {
    new THREE.CubeTextureLoader().load(
      urls,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

function loadWaterNormals() {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      '/waternormals.jpg',
      (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.NoColorSpace;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}
function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve) => canvas.toBlob(resolve, type));
}
function getWorldDims(rows, cols, settings = {}) {
  const width = Math.max(50, Number(settings?.widthM || 1480));
  const depth = Math.max(50, Number(settings?.depthM || (width * rows / Math.max(1, cols))));
  return { width, depth, radius: Math.max(width, depth) * 4.5 };
}

function getSunDirection(cfg = {}) {
  const raw = cfg?.lighting?.sunDirection || cfg?.water?.sunDirection;
  if (Array.isArray(raw) && raw.length === 3) {
    return new THREE.Vector3(raw[0], raw[1], raw[2]).normalize();
  }
  return new THREE.Vector3(0.48, 0.82, 0.38).normalize();
}

function terrainRules(s, textureSettings = {}) {
  const base = s.viewportConfig?.terrainRules || DEFAULT_VIEWPORT_CONFIG.terrainRules;
  return { ...base, ...textureSettings };
}

function applyOrbitLimits(controls, rows = 64, cols = 64, world = {}) {
  if (!controls) return;
  const dims = getWorldDims(rows, cols, world);
  const span = Math.max(dims.width, dims.depth);
  controls.minDistance = Math.max(70, span * 0.07);
  controls.maxDistance = Math.min(SKYBOX_MAX_DISTANCE, Math.max(span * 1.75, 1100));
}

/** Low, wide framing like the resort reference shot. */
function frameCinematicCamera(s, props = {}) {
  if (!s.camera || !s.controls) return;
  const dims = getWorldDims(s.rows || 64, s.cols || 64, props.worldSettings || {});
  const maxH = Number(props.maxHeightM || 500) * getIslandHorizonScale(props.worldSettings || {});
  const dist = Math.min(Math.max(dims.width, dims.depth) * 1.05, s.controls.maxDistance * 0.8);
  const y = Math.max(90, maxH * 0.38);
  s.camera.position.set(dist * 0.5, y, dist * 1.02);
  s.controls.target.set(0, Math.max(16, maxH * 0.12), 0);
  applyOrbitLimits(s.controls, s.rows, s.cols, props.worldSettings);
  s.controls.update();
}

function setupIslandLighting(scene, cfg = {}) {
  const L = { ...DEFAULT_VIEWPORT_CONFIG.lighting, ...(cfg.lighting || {}) };
  const sunDir = getSunDirection(cfg);

  scene.add(new THREE.AmbientLight(hexColor(L.ambientColor, 0x8eb8d8), Number(L.ambientIntensity ?? 0.11)));

  const hemi = new THREE.HemisphereLight(
    hexColor(L.hemisphereSky, 0xa8d8ff),
    hexColor(L.hemisphereGround, 0x1a4a22),
    Number(L.hemisphereIntensity ?? 0.48),
  );
  hemi.position.set(0, 400, 0);
  scene.add(hemi);

  const fill = new THREE.DirectionalLight(hexColor(L.fillColor, 0xc8e4ff), Number(L.fillIntensity ?? 0.1));
  fill.position.set(-sunDir.x * 900, sunDir.y * 600, -sunDir.z * 900);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(hexColor(L.rimColor, 0xffe8c8), Number(L.rimIntensity ?? 0.14));
  rim.position.set(sunDir.x * 700, sunDir.y * 500, sunDir.z * 700);
  scene.add(rim);

  const sun = new THREE.DirectionalLight(hexColor(L.sunColor, 0xfff9ee), Number(L.sunIntensity ?? 3.85));
  sun.position.copy(sunDir).multiplyScalar(2400);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.00022;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;
  const cam = sun.shadow.camera;
  cam.near = 120;
  cam.far = 4200;
  cam.left = cam.bottom = -1400;
  cam.right = cam.top = 1400;
  cam.updateProjectionMatrix();
  scene.add(sun);

  return { sun, hemi, fill, rim, sunDir };
}

const TerrainViewport = forwardRef(function TerrainViewport({
  heightUrl,
  maxHeightM,
  seaLevelM = 0,
  tool,
  brush,
  selectedMaterial,
  textureSettings,
  layers = [],
  worldSettings = { widthM: 1480, depthM: 1086, verticalExaggeration: 1 },
  waterDepthUrl = '',
  waterColorUrl = '',
  islandMaskUrl = '',
  materialPreviewUrl = '',
  showSeafloor = false,
  oceanSettings = {},
}, ref) {
  const mountRef = useRef(null);
  const hudRef = useRef(null);
  const heightUrlRef = useRef(heightUrl);
  heightUrlRef.current = heightUrl;
  const viewportReadyRef = useRef(false);
  const propsRef = useRef({ tool, brush, selectedMaterial, textureSettings, seaLevelM, maxHeightM, worldSettings, waterDepthUrl, waterColorUrl, islandMaskUrl, materialPreviewUrl, showSeafloor, oceanSettings });
  propsRef.current = { tool, brush, selectedMaterial, textureSettings, seaLevelM, maxHeightM, worldSettings, waterDepthUrl, waterColorUrl, islandMaskUrl, materialPreviewUrl, showSeafloor, oceanSettings };

  const stateRef = useRef({
    rows: 0, cols: 0, heights: null, islandMask: null, materialPreview: null,
    geometry: null, mesh: null, material: null,
    renderer: null, camera: null, scene: null, controls: null,
    textureCanvas: null, textureContext: null, texture: null,
    normalCanvas: null, normalContext: null, normalTexture: null,
    patterns: {}, isPainting: false,
    raycaster: new THREE.Raycaster(), pointer: new THREE.Vector2(),
    water: null, waterNormals: null, skybox: null, viewportConfig: null, seafloor: null, coastlineSkirt: null,
    patternTextures: {}, overlayGroup: null, vegetationGroup: null, brushRing: null,
    lastPointer: { x: 0, y: 0, hit: false },
  });

  useImperativeHandle(ref, () => ({
    async getHeightmapBlob() {
      const s = stateRef.current;
      if (!s.heights) return null;
      const canvas = document.createElement('canvas');
      canvas.width = s.cols; canvas.height = s.rows;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(s.cols, s.rows);
      for (let i = 0; i < s.heights.length; i++) {
        const v = Math.round(clamp(s.heights[i], 0, 1) * 255);
        img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return await canvasToBlob(canvas);
    },
    async getTextureBlob() {
      const s = stateRef.current;
      return s.textureCanvas ? await canvasToBlob(s.textureCanvas) : null;
    },
    async getNormalBlob() {
      const s = stateRef.current;
      return s.normalCanvas ? await canvasToBlob(s.normalCanvas) : null;
    },
    autoTexture() {
      const s = stateRef.current;
      if (s.heights && s.textureContext) paintAutoTexture(s, true);
    },
    regenerateTrees() {
      renderVegetationClumps(stateRef.current);
    },
    resetCamera() {
      frameCinematicCamera(stateRef.current, propsRef.current);
    },
  }));

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const mount = mountRef.current;
      if (!mount) return;
      mount.innerHTML = '';
      const scene = new THREE.Scene();
      const s = stateRef.current;
      // Scene must exist before async loads so rebuildTerrain is not skipped on first paint.
      Object.assign(s, { scene });

      try {
        const skybox = await loadSkyboxCube();
        if (!cancelled) {
          scene.background = skybox;
          scene.environment = skybox;
          s.skybox = skybox;
        }
      } catch (err) {
        console.warn('Skybox load failed, using fallback background', err);
        scene.background = new THREE.Color(0x87bfe8);
      }
      s.viewportConfig = await loadViewportConfig();
      const fogCfg = s.viewportConfig?.fog || DEFAULT_VIEWPORT_CONFIG.fog;
      if (fogCfg?.enabled !== false) {
        scene.fog = new THREE.FogExp2(hexColor(fogCfg.color || '#9ecae8'), Number(fogCfg.density ?? 0.000024));
      }
      setupIslandLighting(scene, s.viewportConfig);

      const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / Math.max(1, mount.clientHeight), 0.5, 12000);
      camera.position.set(820, 280, 1180);

      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(1.15, window.devicePixelRatio || 1));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = Number(s.viewportConfig?.lighting?.exposure ?? 1.28);
      mount.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.target.set(0, 110, 0);
      controls.maxPolarAngle = Math.PI * 0.495;
      controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      applyOrbitLimits(controls, 64, 64, propsRef.current.worldSettings);
      controls.addEventListener('change', () => {
        const dist = camera.position.distanceTo(controls.target);
        if (dist > controls.maxDistance) {
          camera.position.subVectors(camera.position, controls.target).normalize().multiplyScalar(controls.maxDistance).add(controls.target);
        } else if (dist < controls.minDistance) {
          camera.position.subVectors(camera.position, controls.target).normalize().multiplyScalar(controls.minDistance).add(controls.target);
        }
      });
      controls.update();

      const brushRing = makeBrushRing();
      scene.add(brushRing);

      try {
        s.waterNormals = await loadWaterNormals();
      } catch (err) {
        console.warn('Water normals load failed', err);
      }
      Object.assign(s, { camera, renderer, controls, brushRing });

      const texPaths = s.viewportConfig?.terrainTextures?.paths || {};
      s.patternNormals = {};
      s.patternTextures = {};
      const keys = new Set([...Object.keys(texPaths), ...MATERIALS.map((m) => m.id), 'wet_sand']);
      for (const key of keys) {
        const entry = texPaths[key] || texPaths.grass;
        const colorSrc = typeof entry === 'string' ? entry : entry?.color;
        const normalSrc = typeof entry === 'string' ? null : entry?.normal;
        if (!colorSrc) continue;
        try {
          s.patterns[key] = await loadPatternImage(colorSrc, legacyTextureUrls[key]);
          if (normalSrc) s.patternNormals[key] = await loadPatternImage(normalSrc);
          const tex = new THREE.Texture(s.patterns[key].img);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.needsUpdate = true;
          s.patternTextures[key] = tex;
        } catch (e) {
          console.warn('Surface texture failed', key, e);
        }
      }

      viewportReadyRef.current = true;
      if (!cancelled && heightUrlRef.current) {
        await rebuildTerrain(heightUrlRef.current);
      }

      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('resize', resize);
      function resize() {
        if (!mount || !renderer || !camera) return;
        camera.aspect = mount.clientWidth / Math.max(1, mount.clientHeight);
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight);
      }
      function animate(t) {
        if (cancelled) return;
        requestAnimationFrame(animate);
        controls.update();
        animateWater(s, t * 0.001);
        renderer.render(scene, camera);
      }
      animate(0);
    }
    boot().catch((err) => console.error('Terrain viewport boot failed', err));
    return () => {
      cancelled = true;
      viewportReadyRef.current = false;
      const s = stateRef.current;
      if (s.renderer?.domElement) {
        s.renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        s.renderer.domElement.removeEventListener('pointermove', onPointerMove);
      }
      window.removeEventListener('pointerup', onPointerUp);
      if (s.renderer) s.renderer.dispose();
    };
  }, []);

  useEffect(() => {
    if (!heightUrl || !viewportReadyRef.current) return;
    rebuildTerrain(heightUrl);
  }, [heightUrl, maxHeightM]);
  useEffect(() => {
    const s = stateRef.current;
    if (s.controls) s.controls.enabled = tool === 'move' || tool === 'select';
    updateBrushRingVisibility(s);
  }, [tool, brush?.size]);
  useEffect(() => {
    const s = stateRef.current;
    if (s.heights && s.textureContext) paintAutoTexture(s, false);
    renderVegetationClumps(s);
    if (s.material?.normalScale) {
      const st = propsRef.current.textureSettings || {};
      s.material.normalScale.set(Number(st.normalStrength ?? 0.72), Number(st.normalStrength ?? 0.72));
      s.material.roughness = 0.86;
    }
  }, [textureSettings]);
  useEffect(() => {
    const s = stateRef.current;
    if (s.water) s.water.position.y = Number(seaLevelM || 0);
  }, [seaLevelM]);
  useEffect(() => {
    const s = stateRef.current;
    if (heightUrl && s.heights) rebuildTerrain(heightUrl);
  }, [
    worldSettings?.widthM,
    worldSettings?.depthM,
    worldSettings?.verticalExaggeration,
    worldSettings?.terrainMeshResolution,
    worldSettings?.featureSpacingM,
    worldSettings?.featureScale,
  ]);
  useEffect(() => { const s = stateRef.current; if (heightUrl && s.heights) rebuildTerrain(heightUrl); }, [waterDepthUrl, waterColorUrl, islandMaskUrl, materialPreviewUrl, showSeafloor]);
  useEffect(() => {
    const s = stateRef.current;
    if (!s.scene || !s.heights) return;
    rebuildWaterOnly();
  }, [
    worldSettings?.widthM,
    worldSettings?.depthM,
    oceanSettings?.oceanRadiusM,
    oceanSettings?.oceanRadiusAuto,
    oceanSettings?.shoreShelfWidthM,
    oceanSettings?.midWaterDistanceM,
    oceanSettings?.deepWaterDistanceM,
    oceanSettings?.waterColorSteps,
    oceanSettings?.waterNoiseStrength,
    oceanSettings?.waterNoiseScaleM,
  ]);
  useEffect(() => { const s = stateRef.current; if (s.scene && s.mesh) renderOverlayObjects(s, layers || []); }, [layers, heightUrl, maxHeightM]);

  async function rebuildTerrain(src) {
    const s = stateRef.current;
    if (!s.scene) return;
    const img = await loadImage(src);
    const maxGrid = clampMeshResolution(propsRef.current.worldSettings?.terrainMeshResolution, 64, 1024);
    const ratio = img.width / Math.max(1, img.height);
    let cols = maxGrid;
    let rows = Math.max(16, Math.round(maxGrid / ratio));
    if (rows > maxGrid) { rows = maxGrid; cols = Math.max(16, Math.round(maxGrid * ratio)); }
    const c = document.createElement('canvas');
    c.width = cols; c.height = rows;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cols, rows);
    const data = ctx.getImageData(0, 0, cols, rows).data;
    const heights = new Float32Array(rows * cols);
    for (let i = 0; i < heights.length; i++) heights[i] = data[i * 4] / 255;

    if (s.mesh) { s.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); }
    if (s.water) {
      s.scene.remove(s.water);
      s.water.geometry?.dispose();
      s.water.material?.uniforms?.depthMap?.value?.dispose?.();
      s.water.material?.map?.dispose?.();
      s.water.material?.dispose();
      s.water.material?.uniforms?.mirrorSampler?.value?.dispose?.();
    }
    if (s.seafloor) {
      s.scene.remove(s.seafloor);
      s.seafloor.geometry?.dispose();
      s.seafloor.material?.dispose();
      s.seafloor = null;
    }
    if (s.coastlineSkirt) {
      s.scene.remove(s.coastlineSkirt);
      s.coastlineSkirt.geometry?.dispose();
      s.coastlineSkirt.material?.dispose();
      s.coastlineSkirt = null;
    }

    const [islandMask, materialPreview] = await Promise.all([
      loadImageData(propsRef.current.islandMaskUrl, cols, rows),
      loadImageData(propsRef.current.materialPreviewUrl, cols, rows),
    ]);

    s.rows = rows; s.cols = cols; s.heights = heights; s.islandMask = islandMask; s.materialPreview = materialPreview;
    const texSize = clamp(Number(propsRef.current.textureSettings?.textureSize || 1024), 512, 2048);
    const textureCanvas = document.createElement('canvas'); textureCanvas.width = texSize; textureCanvas.height = texSize;
    const normalCanvas = document.createElement('canvas'); normalCanvas.width = texSize; normalCanvas.height = texSize;
    s.textureCanvas = textureCanvas; s.textureContext = textureCanvas.getContext('2d', { willReadFrequently: true });
    s.normalCanvas = normalCanvas; s.normalContext = normalCanvas.getContext('2d', { willReadFrequently: true });
    paintAutoTexture(s, true);
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.wrapS = THREE.ClampToEdgeWrapping; texture.wrapT = THREE.ClampToEdgeWrapping; texture.colorSpace = THREE.SRGBColorSpace;
    const normalTexture = new THREE.CanvasTexture(normalCanvas);
    normalTexture.wrapS = THREE.ClampToEdgeWrapping; normalTexture.wrapT = THREE.ClampToEdgeWrapping;
    s.texture = texture; s.normalTexture = normalTexture;

    const geometry = makeGeometry(heights, rows, cols, Number(maxHeightM || 500), propsRef.current.worldSettings || {}, islandMask, Number(propsRef.current.seaLevelM || 0));
    const st = propsRef.current.textureSettings || {};
    const envIntensity = Number(s.viewportConfig?.lighting?.envMapIntensity ?? 1.05);
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      normalMap: normalTexture,
      normalScale: new THREE.Vector2(Number(st.normalStrength ?? 0.82), Number(st.normalStrength ?? 0.82)),
      roughness: 0.84,
      metalness: 0.01,
      envMap: s.skybox || null,
      envMapIntensity: envIntensity,
      transparent: true,
      alphaTest: 0.035,
      depthWrite: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true; mesh.castShadow = true;
    s.geometry = geometry; s.mesh = mesh; s.material = material;
    s.scene.add(mesh);

    // Diorama preview: flat painted ocean only — no coast skirt or 3D seafloor bowl (export-only).
    s.coastlineSkirt = null;

    const seafloor = await makeSeafloorMesh(
      propsRef.current.waterDepthUrl,
      propsRef.current.showSeafloor,
      rows,
      cols,
      propsRef.current.worldSettings || {},
      propsRef.current.oceanSettings || {},
      Number(propsRef.current.seaLevelM || 0),
    );
    s.seafloor = seafloor;
    if (seafloor) s.scene.add(seafloor);

    const water = await makeWaterPlane(
      Number(propsRef.current.seaLevelM || 0),
      propsRef.current.worldSettings || {},
      rows,
      cols,
    );
    s.water = water;
    if (water) s.scene.add(water);
    applyOrbitLimits(s.controls, rows, cols, propsRef.current.worldSettings);
    renderOverlayObjects(s, layers || []);
    renderVegetationClumps(s);
    if (s.controls && s.camera) {
      frameCinematicCamera(s, propsRef.current);
    }
  }

  async function rebuildWaterOnly() {
    const s = stateRef.current;
    if (!s.scene || !s.heights) return;
    if (s.water) {
      s.scene.remove(s.water);
      s.water.geometry?.dispose();
      s.water.material?.map?.dispose?.();
      s.water.material?.dispose();
      s.water = null;
    }
    const water = await makeWaterPlane(
      Number(propsRef.current.seaLevelM || 0),
      propsRef.current.worldSettings || {},
      s.rows,
      s.cols,
    );
    s.water = water;
    if (water) s.scene.add(water);
  }

  function mapLandPredicate(heights, maxH, islandMask, seaLevel, world = {}) {
    return (idx) => {
      const sourceLand = elevationMetersFromNormalized(heights[idx], maxH, world) > seaLevel + 0.05;
      if (sourceLand) return true;
      if (islandMask?.data) return islandMask.data[idx * 4] > 127;
      return false;
    };
  }

  function makeGeometry(heights, rows, cols, maxH, world = {}, islandMask = null, seaLevel = 0) {
    const { width, depth } = getWorldDims(rows, cols, world);
    const vertices = new Float32Array(rows * cols * 3);
    const uvs = new Float32Array(rows * cols * 2);
    for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
      const i = r * cols + col;
      vertices[i * 3] = (col / (cols - 1) - 0.5) * width;
      vertices[i * 3 + 1] = elevationMetersFromNormalized(heights[i], maxH, world);
      vertices[i * 3 + 2] = (r / (rows - 1) - 0.5) * depth;
      uvs[i * 2] = col / (cols - 1); uvs[i * 2 + 1] = 1 - r / (rows - 1);
    }
    const indices = [];
    const isLandVertex = mapLandPredicate(heights, maxH, islandMask, seaLevel, world);
    for (let r = 0; r < rows - 1; r++) for (let col = 0; col < cols - 1; col++) {
      const a = r * cols + col, b = a + 1, c = (r + 1) * cols + col, d = c + 1;
      if (isLandVertex(a) && isLandVertex(c) && isLandVertex(b)) indices.push(a, c, b);
      if (isLandVertex(b) && isLandVertex(c) && isLandVertex(d)) indices.push(b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return geometry;
  }

  function makeCoastlineSkirtMesh(heights, rows, cols, maxH, world = {}, islandMask = null, seaLevel = 0, skirtDepth = 40) {
    const isLandVertex = mapLandPredicate(heights, maxH, islandMask, seaLevel, world);
    const { width, depth } = getWorldDims(rows, cols, world);
    const vertices = [];
    const indices = [];
    const bottomY = Number(seaLevel || 0) - Math.max(2, Number(skirtDepth || 40));
    const addVertex = (idx, yOverride = null) => {
      const r = Math.floor(idx / cols);
      const col = idx % cols;
      const baseX = (col / Math.max(1, cols - 1) - 0.5) * width;
      const baseZ = (r / Math.max(1, rows - 1) - 0.5) * depth;
      vertices.push(
        baseX,
        yOverride == null ? Math.max(elevationMetersFromNormalized(heights[idx], maxH, world), Number(seaLevel || 0) + 0.15) : yOverride,
        baseZ,
      );
      return vertices.length / 3 - 1;
    };
    const addEdge = (a, b) => {
      const topA = addVertex(a);
      const topB = addVertex(b);
      const botA = addVertex(a, bottomY);
      const botB = addVertex(b, bottomY);
      indices.push(topA, botA, topB, topB, botA, botB);
    };
    for (let r = 0; r < rows - 1; r++) for (let col = 0; col < cols - 1; col++) {
      const a = r * cols + col, b = a + 1, c = (r + 1) * cols + col, d = c + 1;
      if (isLandVertex(a) && isLandVertex(b) && (!isLandVertex(c) || !isLandVertex(d))) addEdge(a, b);
      if (isLandVertex(c) && isLandVertex(d) && (!isLandVertex(a) || !isLandVertex(b))) addEdge(d, c);
      if (isLandVertex(a) && isLandVertex(c) && (!isLandVertex(b) || !isLandVertex(d))) addEdge(c, a);
      if (isLandVertex(b) && isLandVertex(d) && (!isLandVertex(a) || !isLandVertex(c))) addEdge(b, d);
    }
    if (!indices.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: 0xb9aa7d,
      roughness: 0.9,
      metalness: 0,
      envMap: stateRef.current.skybox || null,
      envMapIntensity: 0.32,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'coastline-skirt-preview';
    mesh.receiveShadow = true;
    return mesh;
  }

  async function makeSeafloorMesh(depthUrl, enabled, rows, cols, world = {}, ocean = {}, seaLevel = 0) {
    if (!enabled || !depthUrl) return null;
    const img = await loadImage(depthUrl);
    const c = document.createElement('canvas');
    c.width = cols; c.height = rows;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cols, rows);
    const data = ctx.getImageData(0, 0, cols, rows).data;
    const { width, depth } = getWorldDims(rows, cols, world);
    const maxDepth = Number(ocean.maxOceanDepthM || 220);
    const vertices = new Float32Array(rows * cols * 3);
    const colors = new Float32Array(rows * cols * 3);
    const active = new Uint8Array(rows * cols);
    for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
      const i = r * cols + col;
      const t = data[i * 4] / 255;
      active[i] = t > 0.004 ? 1 : 0;
      vertices[i * 3] = (col / (cols - 1) - 0.5) * width;
      vertices[i * 3 + 1] = Number(seaLevel || 0) - t * maxDepth;
      vertices[i * 3 + 2] = (r / (rows - 1) - 0.5) * depth;
      colors[i * 3] = 0.05 + (1 - t) * 0.16;
      colors[i * 3 + 1] = 0.24 + (1 - t) * 0.32;
      colors[i * 3 + 2] = 0.42 + t * 0.42;
    }
    const indices = [];
    for (let r = 0; r < rows - 1; r++) for (let col = 0; col < cols - 1; col++) {
      const a = r * cols + col, b = a + 1, c0 = (r + 1) * cols + col, d = c0 + 1;
      if (!(active[a] && active[b] && active[c0] && active[d])) continue;
      indices.push(a, c0, b, b, c0, d);
    }
    if (!indices.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'derived-seafloor-preview';
    mesh.receiveShadow = true;
    return mesh;
  }

  function heightAt(s, rr, cc) {
    const r = clamp(Math.round(rr), 0, s.rows - 1);
    const c = clamp(Math.round(cc), 0, s.cols - 1);
    return s.heights[r * s.cols + c] || 0;
  }
  function isLandAt(s, rr, cc, seaNorm) {
    const r = clamp(Math.round(rr), 0, s.rows - 1);
    const c = clamp(Math.round(cc), 0, s.cols - 1);
    if (s.islandMask?.data) return channelAt(s.islandMask, s.rows, s.cols, r, c, 0) > 127;
    return !isUnderwaterAt(s, r, c, seaNorm);
  }
  function materialPreviewColorAt(s, rr, cc) {
    if (!s.materialPreview?.data) return null;
    const r = clamp(Math.round(rr), 0, s.rows - 1);
    const c = clamp(Math.round(cc), 0, s.cols - 1);
    const p = (r * s.cols + c) * 4;
    return [s.materialPreview.data[p], s.materialPreview.data[p + 1], s.materialPreview.data[p + 2]];
  }
  function slopeAt(s, r, c) {
    const maxH = Number(propsRef.current.maxHeightM || 500);
    const world = propsRef.current.worldSettings || {};
    const worldMaxH = maxH * getIslandHorizonScale(world);
    const { width, depth } = getWorldDims(s.rows, s.cols, world);
    const cellX = width / Math.max(1, s.cols - 1);
    const cellZ = depth / Math.max(1, s.rows - 1);
    const dx = Math.abs(heightAt(s, r, c + 1) - heightAt(s, r, c - 1)) * worldMaxH / Math.max(1, cellX * 2);
    const dz = Math.abs(heightAt(s, r + 1, c) - heightAt(s, r - 1, c)) * worldMaxH / Math.max(1, cellZ * 2);
    return Math.atan(Math.sqrt(dx * dx + dz * dz)) * 180 / Math.PI;
  }

  function paintAutoTexture(s, clearPaint = false) {
    const ctx = s.textureContext;
    const canvas = s.textureCanvas;
    const nctx = s.normalContext;
    if (!ctx || !canvas || !nctx || !s.heights) return;

    const textureSettings = propsRef.current.textureSettings || {};
    const settings = { ...terrainRules(s, textureSettings), ...textureSettings };
    const size = canvas.width;
    const maxH = Number(propsRef.current.maxHeightM || 500);
    const world = propsRef.current.worldSettings || {};
    const worldMaxH = maxH * getIslandHorizonScale(world);
    const seaNorm = Number(propsRef.current.seaLevelM || 0) / Math.max(1, worldMaxH);
    const sandNorm = Number(settings.sandHeightM ?? 14) / Math.max(1, worldMaxH);
    const { width, depth } = getWorldDims(s.rows, s.cols, world);
    const pat = s.patterns || {};
    const tilingM = Number(settings.tilingM ?? s.viewportConfig?.terrainTextures?.tilingM ?? 36);
    const tileU = (wx, pw) => ((wx % pw) + pw) % pw / Math.max(1, pw);
    const tileV = (wz, ph) => ((wz % ph) + ph) % ph / Math.max(1, ph);

    const sampleMaterial = (id, tu, tv) => {
      const key = id === 'trees' ? (pat.trees ? 'trees' : 'grass') : id;
      const entry = pat[key] || (id === 'wet_sand' ? (pat.wet_sand || pat.sand) : null) || pat.sand;
      if (!entry) return null;
      return samplePattern(entry, tu, tv);
    };

    const slopes = buildSlopeFieldFromHeights(s.heights, s.rows, s.cols, {
      widthM: width,
      depthM: depth,
      maxHeightM: worldMaxH,
    });

    let previous = null;
    if (settings.preservePaintedEdits && !clearPaint) {
      try { previous = ctx.getImageData(0, 0, size, size); } catch { previous = null; }
    }

    const painted = paintProceduralTerrainTexture({
      size,
      heights: s.heights,
      slopes,
      rows: s.rows,
      cols: s.cols,
      settings,
      seaNorm,
      sandNorm,
      worldW: width,
      worldD: depth,
      landAt: (r, c, h) => isLandAt(s, r, c, seaNorm) && h > seaNorm + 0.02,
      sampleMaterial: Object.keys(pat).length ? sampleMaterial : null,
    });

    const img = painted.color;
    if (previous) {
      for (let p = 0; p < img.data.length; p += 4) {
        if (previous.data[p + 3] > 0 && img.data[p + 3] > 0) {
          const keep = 0.35;
          img.data[p] = Math.round(img.data[p] * (1 - keep) + previous.data[p] * keep);
          img.data[p + 1] = Math.round(img.data[p + 1] * (1 - keep) + previous.data[p + 1] * keep);
          img.data[p + 2] = Math.round(img.data[p + 2] * (1 - keep) + previous.data[p + 2] * keep);
        }
      }
    }

    ctx.putImageData(img, 0, 0);
    nctx.putImageData(painted.normal, 0, 0);
    if (s.texture) s.texture.needsUpdate = true;
    if (s.normalTexture) s.normalTexture.needsUpdate = true;
  }

  function setOceanDiscGridUvs(geometry, width, depth) {
    const pos = geometry.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      uvs[i * 2] = x / Math.max(1, width) + 0.5;
      uvs[i * 2 + 1] = y / Math.max(1, depth) + 0.5;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }

  async function makeWaterPlane(seaLevel, world = {}, rows = 64, cols = 64) {
    const cfg = stateRef.current.viewportConfig?.water || DEFAULT_VIEWPORT_CONFIG.water;
    if (cfg.enabled === false) return null;
    const dims = getWorldDims(rows, cols, world);
    const { width, depth } = dims;
    const ocean = propsRef.current.oceanSettings || {};
    const discRadius = getOceanDiscRadiusM(world, {}, ocean);
    const waterColorUrl = propsRef.current.waterColorUrl;

    let material;
    if (waterColorUrl) {
      const tex = await new Promise((resolve, reject) => {
        new THREE.TextureLoader().load(waterColorUrl, resolve, undefined, reject);
      });
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      material = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.04,
        depthWrite: true,
        side: THREE.DoubleSide,
      });
    } else {
      material = new THREE.MeshBasicMaterial({
        color: 0x1a6f9e,
        transparent: true,
        alphaTest: 0.04,
        depthWrite: true,
        side: THREE.DoubleSide,
      });
    }

    const geometry = new THREE.CircleGeometry(discRadius, 128);
    setOceanDiscGridUvs(geometry, width, depth);
    const water = new THREE.Mesh(geometry, material);
    water.rotation.x = -Math.PI / 2;
    water.position.y = seaLevel + 0.02;
    water.renderOrder = 2;
    water.name = 'island-ocean';
    water.userData.isOcean = true;
    water.userData.discDiameterM = discRadius * 2;
    return water;
  }

  function makeLandDistanceField(rows, cols, heights, maxH, seaLevel, islandMask = null, world = {}) {
    const mapLand = new Uint8Array(rows * cols);
    const isLand = mapLandPredicate(heights || new Float32Array(rows * cols), maxH, islandMask, seaLevel, world);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (isLand(idx)) mapLand[idx] = 1;
    }
    const dist = new Float32Array(rows * cols);
    const inf = Math.max(rows, cols) * 4;
    for (let i = 0; i < dist.length; i++) dist[i] = mapLand[i] ? 0 : inf;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const p = y * cols + x;
      if (x > 0) dist[p] = Math.min(dist[p], dist[p - 1] + 1);
      if (y > 0) dist[p] = Math.min(dist[p], dist[p - cols] + 1);
      if (x > 0 && y > 0) dist[p] = Math.min(dist[p], dist[p - cols - 1] + 1.414);
      if (x < cols - 1 && y > 0) dist[p] = Math.min(dist[p], dist[p - cols + 1] + 1.414);
    }
    for (let y = rows - 1; y >= 0; y--) for (let x = cols - 1; x >= 0; x--) {
      const p = y * cols + x;
      if (x < cols - 1) dist[p] = Math.min(dist[p], dist[p + 1] + 1);
      if (y < rows - 1) dist[p] = Math.min(dist[p], dist[p + cols] + 1);
      if (x < cols - 1 && y < rows - 1) dist[p] = Math.min(dist[p], dist[p + cols + 1] + 1.414);
      if (x > 0 && y < rows - 1) dist[p] = Math.min(dist[p], dist[p + cols - 1] + 1.414);
    }
    return dist;
  }

  function animateWater() {
    // The stylized ocean is intentionally static/opaque to avoid transparent water artifacts.
  }

  function makeBrushRing() {
    const geo = new THREE.RingGeometry(0.92, 1, 96);
    const mat = new THREE.MeshBasicMaterial({ color: 0x7ce9ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    ring.renderOrder = 999;
    return ring;
  }
  function updateBrushRingVisibility(s) {
    if (!s.brushRing) return;
    const currentTool = propsRef.current.tool || 'move';
    s.brushRing.visible = ['raise', 'lower', 'smooth', 'flatten', 'paint'].includes(currentTool) && !!s.lastPointer.hit;
    const width = Number(propsRef.current.worldSettings?.widthM || 1480);
    const radiusWorld = Number(propsRef.current.brush?.size || 40) * width / 1024;
    s.brushRing.scale.set(radiusWorld, radiusWorld, radiusWorld);
  }
  function canvasPosition(ev) {
    const s = stateRef.current;
    const rect = s.renderer.domElement.getBoundingClientRect();
    s.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    s.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  }
  function updateHover(ev) {
    const s = stateRef.current;
    if (!s.mesh || !s.camera || !s.renderer) return null;
    canvasPosition(ev);
    s.raycaster.setFromCamera(s.pointer, s.camera);
    const hit = s.raycaster.intersectObject(s.mesh)[0];
    if (hit) {
      s.lastPointer.hit = true;
      if (s.brushRing) {
        s.brushRing.position.copy(hit.point);
        s.brushRing.position.y += 1.4;
        const normal = hit.face?.normal?.clone()?.transformDirection(s.mesh.matrixWorld) || new THREE.Vector3(0, 1, 0);
        s.brushRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal.normalize());
      }
      updateBrushRingVisibility(s);
      const height = Math.max(0, hit.point.y);
      if (hudRef.current) hudRef.current.textContent = `${(propsRef.current.tool || 'move').toUpperCase()} · ${height.toFixed(1)}m · brush ${Math.round(propsRef.current.brush?.size || 40)}px`;
      return hit;
    }
    s.lastPointer.hit = false;
    updateBrushRingVisibility(s);
    return null;
  }
  function onPointerDown(ev) {
    const s = stateRef.current;
    const currentTool = propsRef.current.tool || 'move';
    if (!s.mesh || ev.button !== 0) return;
    if (currentTool === 'move' || currentTool === 'select') return;
    ev.preventDefault();
    if (s.controls) s.controls.enabled = false;
    s.isPainting = true;
    applyBrush(ev);
  }
  function onPointerMove(ev) {
    const s = stateRef.current;
    updateHover(ev);
    if (!s.isPainting) return;
    ev.preventDefault();
    applyBrush(ev);
  }
  function onPointerUp() {
    const s = stateRef.current;
    s.isPainting = false;
    const currentTool = propsRef.current.tool || 'move';
    if (s.controls) s.controls.enabled = currentTool === 'move' || currentTool === 'select';
  }
  function applyBrush(ev) {
    const s = stateRef.current;
    const currentTool = propsRef.current.tool || 'move';
    if (!['raise', 'lower', 'smooth', 'flatten', 'paint'].includes(currentTool)) return;
    const hit = updateHover(ev);
    if (!hit?.uv) return;
    const u = clamp(hit.uv.x, 0, 1);
    const v = clamp(hit.uv.y, 0, 1);
    const maxH = Number(propsRef.current.maxHeightM || 500);
    const world = propsRef.current.worldSettings || {};
    const worldMaxH = maxH * getIslandHorizonScale(world);
    const seaNorm = Number(propsRef.current.seaLevelM || 0) / Math.max(1, worldMaxH);
    const col = Math.round(u * (s.cols - 1));
    const row = Math.round((1 - v) * (s.rows - 1));
    if (isUnderwaterAt(s, row, col, seaNorm)) return;
    if (currentTool === 'paint') return paintTextureAt(s, u, v, row, col);
    sculptAt(s, u, v, currentTool);
  }
  function paintTextureAt(s, u, v, row, col) {
    const ctx = s.textureContext, canvas = s.textureCanvas;
    const current = propsRef.current, currentBrush = current.brush || {};
    const material = current.selectedMaterial || 'grass';
    if (material === 'water') return;
    const maxH = Number(current.maxHeightM || 500);
    const world = current.worldSettings || {};
    const worldMaxH = maxH * getIslandHorizonScale(world);
    const seaNorm = Number(current.seaLevelM || 0) / Math.max(1, worldMaxH);
    if (isUnderwaterAt(s, row, col, seaNorm)) return;
    const pat = s.patterns[material] || s.patterns.grass;
    const img = pat?.img || pat;
    const radius = Number(currentBrush.size || 40);
    const opacity = Number(currentBrush.opacity || 0.85);
    const edgeSoftness = clamp(Number(currentBrush.edgeSoftness ?? 0.72), 0, 1);
    const noise = clamp(Number(currentBrush.noise ?? 0.25), 0, 1);
    const x = u * canvas.width, y = (1 - v) * canvas.height;
    const size = Math.ceil(radius * 2);
    const temp = document.createElement('canvas'); temp.width = size; temp.height = size;
    const tctx = temp.getContext('2d', { willReadFrequently: true });
    if (img) tctx.fillStyle = tctx.createPattern(img, 'repeat'); else tctx.fillStyle = '#276c35';
    tctx.fillRect(0, 0, size, size);
    const data = tctx.getImageData(0, 0, size, size);
    const center = radius;
    for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) {
      const dx = xx - center, dy = yy - center, d = Math.sqrt(dx * dx + dy * dy) / Math.max(1, radius);
      const softStart = 1 - edgeSoftness;
      let falloff = d <= 1 ? 1 : 0;
      if (d > softStart) falloff = clamp((1 - d) / Math.max(0.001, edgeSoftness), 0, 1);
      falloff = falloff * falloff * (3 - 2 * falloff);
      const n = 1 - noise * 0.55 + hashNoise(xx, yy, Date.now() % 997) * noise;
      data.data[(yy * size + xx) * 4 + 3] = Math.round(255 * falloff * opacity * n);
    }
    tctx.putImageData(data, 0, 0);
    ctx.drawImage(temp, x - radius, y - radius);
    s.texture.needsUpdate = true;
  }
  function sculptAt(s, u, v, currentTool) {
    const current = propsRef.current, currentBrush = current.brush || {};
    const rows = s.rows, cols = s.cols;
    const col = Math.round(u * (cols - 1)), r = Math.round((1 - v) * (rows - 1));
    const sizePx = Number(currentBrush.size || 28) / 1024 * Math.max(rows, cols);
    const strength = Number(currentBrush.strength || 0.45) * 0.018;
    const maxH = Number(current.maxHeightM || 500);
    const world = current.worldSettings || {};
    const worldMaxH = maxH * getIslandHorizonScale(world);
    const target = Number(currentBrush.flattenM || 10) / Math.max(1, worldMaxH);
    const radius = Math.max(1, sizePx);
    const r0 = Math.max(0, Math.floor(r - radius)), r1 = Math.min(rows - 1, Math.ceil(r + radius));
    const c0 = Math.max(0, Math.floor(col - radius)), c1 = Math.min(cols - 1, Math.ceil(col + radius));
    let average = 0, count = 0;
    if (currentTool === 'smooth') {
      for (let yy = r0; yy <= r1; yy++) for (let xx = c0; xx <= c1; xx++) { average += s.heights[yy * cols + xx]; count++; }
      average /= Math.max(1, count);
    }
    for (let yy = r0; yy <= r1; yy++) for (let xx = c0; xx <= c1; xx++) {
      const dx = xx - col, dy = yy - r, dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;
      const falloff = Math.pow(1 - dist / radius, 1.8);
      const idx = yy * cols + xx;
      if (currentTool === 'raise') s.heights[idx] = clamp(s.heights[idx] + strength * falloff, 0, 1);
      if (currentTool === 'lower') s.heights[idx] = clamp(s.heights[idx] - strength * falloff, 0, 1);
      if (currentTool === 'flatten') s.heights[idx] = s.heights[idx] * (1 - falloff * 0.25) + target * falloff * 0.25;
      if (currentTool === 'smooth') s.heights[idx] = s.heights[idx] * (1 - falloff * 0.35) + average * falloff * 0.35;
    }
    updateGeometryHeights(s);
  }
  function updateGeometryHeights(s) {
    const pos = s.geometry.attributes.position.array;
    const maxH = Number(propsRef.current.maxHeightM || 500);
    const world = propsRef.current.worldSettings || {};
    for (let i = 0; i < s.heights.length; i++) {
      pos[i * 3 + 1] = elevationMetersFromNormalized(s.heights[i], maxH, world);
    }
    s.geometry.attributes.position.needsUpdate = true;
    s.geometry.computeVertexNormals();
    renderVegetationClumps(s);
  }
  function terrainHeightAtWorld(s, x, z) {
    if (!s.heights || !s.rows || !s.cols) return 0;
    const { width, depth } = getWorldDims(s.rows, s.cols, propsRef.current.worldSettings || {});
    const u = clamp(x / width + 0.5, 0, 1), v = clamp(z / depth + 0.5, 0, 1);
    const col = clamp(Math.round(u * (s.cols - 1)), 0, s.cols - 1), row = clamp(Math.round(v * (s.rows - 1)), 0, s.rows - 1);
    return elevationMetersFromNormalized(
      s.heights[row * s.cols + col] || 0,
      Number(propsRef.current.maxHeightM || 500),
      propsRef.current.worldSettings || {},
    );
  }

  function renderVegetationClumps(s) {
    if (!s.scene || !s.heights) return;
    if (s.vegetationGroup) {
      s.scene.remove(s.vegetationGroup);
      s.vegetationGroup.traverse((obj) => {
        obj.geometry?.dispose?.();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
          else obj.material.dispose?.();
        }
      });
    }
    const settings = vegetationSettings(s, propsRef.current.textureSettings || {});
    if (settings.enabled === false) return;
    const density = clamp(Number(settings.treeDensity ?? settings.density ?? 0.58), 0, 1);
    if (density <= 0.02) return;
    const maxCount = Math.max(50, Math.round(Number(settings.treeCountMax ?? settings.maxCount ?? 1400)));
    const world = propsRef.current.worldSettings || {};
    const spacingFromM = meshSpacingCells(world, s.rows, s.cols);
    const spacing = Math.max(2, spacingFromM || Math.round(Number(settings.treeSpacing ?? settings.spacing ?? 9)));
    const maxSlope = Number(settings.forestSlopeFade ?? settings.maxSlopeDeg ?? 36);
    const wallSlopeStart = Number(settings.wallTreeSlopeStart ?? 42);
    const minNorm = Number(settings.minHeightNorm ?? 0.035);
    const minHm = Number(settings.treeMinHeightM ?? settings.minHeightM ?? 5);
    const maxH = Number(propsRef.current.maxHeightM || 500);
    const seed = Math.round(Number(settings.treeSeed ?? settings.seed ?? 42));
    const featureScale = Math.max(0.25, Number(world.featureScale ?? 1));
    const scaleMin = Number(settings.scaleMin ?? 3.5) * featureScale;
    const scaleMax = Number(settings.scaleMax ?? 14) * featureScale;
    const carpetLayers = Math.max(1, Math.round(Number(settings.carpetLayers ?? 2)));
    const { width, depth } = getWorldDims(s.rows, s.cols, propsRef.current.worldSettings || {});
    const group = new THREE.Group();
    group.name = 'Procedural distant forest clumps';
    const grassTex = s.patternTextures?.trees || s.patternTextures?.grass;
    const canopyMat = new THREE.MeshStandardMaterial({
      color: hexColor(settings.colorTint || '#6aad52'),
      map: grassTex || null,
      roughness: 0.9,
      metalness: 0,
      envMap: s.skybox || null,
      envMapIntensity: Number(s.viewportConfig?.lighting?.envMapIntensity ?? 1.05),
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: hexColor(settings.accentTint || '#4a8c3a'),
      map: grassTex || null,
      roughness: 0.93,
      metalness: 0,
    });
    const canopyGeo = new THREE.ConeGeometry(1, 1.5, 5);
    const accentGeo = new THREE.ConeGeometry(1, 1.1, 4);
    const canopyMatrices = [];
    const accentMatrices = [];
    const dummy = new THREE.Object3D();
    let placed = 0;
    for (let layer = 0; layer < carpetLayers && placed < maxCount; layer++) {
      const layerSpacing = Math.max(2, spacing - layer);
      for (let r = 2; r < s.rows - 2 && placed < maxCount; r += layerSpacing) {
        for (let c = 2; c < s.cols - 2 && placed < maxCount; c += layerSpacing) {
          const h = heightAt(s, r, c);
          const slope = slopeAt(s, r, c);
          if (h < minNorm || elevationMetersFromNormalized(h, maxH, world) < minHm || slope > maxSlope) continue;
          const n = fbm(r / 2.8 + layer * 17, c / 2.8 + layer * 11, seed + layer * 31);
          const slopePenalty = 1 - smoothstep(wallSlopeStart, maxSlope, slope) * 0.52;
          const localDensity = density * slopePenalty;
          if (n > localDensity + layer * 0.06) continue;
          const cellW = width / Math.max(1, s.cols - 1);
          const cellD = depth / Math.max(1, s.rows - 1);
          const jitterX = (hashNoise(r, c, seed + layer * 101) - 0.5) * cellW * layerSpacing * 0.82;
          const jitterZ = (hashNoise(c, r, seed + layer * 151) - 0.5) * cellD * layerSpacing * 0.82;
          const x = (c / (s.cols - 1) - 0.5) * width + jitterX;
          const z = (r / (s.rows - 1) - 0.5) * depth + jitterZ;
          const y = elevationMetersFromNormalized(h, maxH, world);
          const canopyScale = scaleMin + (1 - n) * (scaleMax - scaleMin) * (layer === 0 ? 1 : 0.65);
          dummy.position.set(x, y + canopyScale * 0.38, z);
          dummy.rotation.set(0, hashNoise(r, c, seed + 9) * Math.PI * 2, 0);
          dummy.scale.set(canopyScale * (0.86 + hashNoise(r, c, seed + 19) * 0.34), canopyScale * (slope > wallSlopeStart ? 0.86 : 1), canopyScale * (0.86 + hashNoise(c, r, seed + 29) * 0.34));
          dummy.updateMatrix();
          canopyMatrices.push(dummy.matrix.clone());
          placed += 1;
          if (n < 0.5 && placed < maxCount) {
            dummy.position.set(x + canopyScale * 0.15, y + canopyScale * 0.62, z + canopyScale * 0.1);
            dummy.rotation.set(0, hashNoise(r, c, seed + 39) * Math.PI * 2, 0);
            dummy.scale.set(canopyScale * 0.5, canopyScale * 0.62, canopyScale * 0.48);
            dummy.updateMatrix();
            accentMatrices.push(dummy.matrix.clone());
            placed += 1;
          }
        }
      }
    }
    if (canopyMatrices.length) {
      const canopyBatch = new THREE.InstancedMesh(canopyGeo, canopyMat, canopyMatrices.length);
      canopyMatrices.forEach((matrix, index) => canopyBatch.setMatrixAt(index, matrix));
      canopyBatch.instanceMatrix.needsUpdate = true;
      canopyBatch.castShadow = true;
      canopyBatch.receiveShadow = true;
      group.add(canopyBatch);
    }
    if (accentMatrices.length) {
      const accentBatch = new THREE.InstancedMesh(accentGeo, accentMat, accentMatrices.length);
      accentMatrices.forEach((matrix, index) => accentBatch.setMatrixAt(index, matrix));
      accentBatch.instanceMatrix.needsUpdate = true;
      accentBatch.castShadow = false;
      accentBatch.receiveShadow = true;
      group.add(accentBatch);
    }
    s.vegetationGroup = group;
    s.scene.add(group);
  }

  function renderOverlayObjects(s, layerList) {
    if (!s.scene) return;
    if (s.overlayGroup) { s.scene.remove(s.overlayGroup); s.overlayGroup.traverse(obj => { obj.geometry?.dispose?.(); obj.material?.dispose?.(); }); }
    const group = new THREE.Group(); group.name = 'Overlay layer features';
    const structureMat = new THREE.MeshStandardMaterial({ color: 0xff6b5f, roughness: 0.72, metalness: 0.05 });
    const markerMat = new THREE.MeshStandardMaterial({ color: 0xffd34d, roughness: 0.55, emissive: 0x332200 });
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x52d6ff, roughness: 0.2, transparent: true, opacity: 0.75, emissive: 0x064466 });
    for (const layer of layerList || []) {
      if (!layer?.enabled || !layer.analysis?.features) continue;
      for (const f of layer.analysis.features.slice(0, 500)) {
        const x = Number(f.world?.[0] || 0), z = Number(f.world?.[2] || 0), y = terrainHeightAtWorld(s, x, z);
        let mesh = null;
        if (layer.kind === 'structure') {
          const h = Number(f.objectHeightM || layer.objectHeightM || 8), w = Math.max(2, Number(f.widthM || 4)), d = Math.max(2, Number(f.depthM || 4));
          if ((f.shape || layer.shape) === 'sphere') { mesh = new THREE.Mesh(new THREE.SphereGeometry(Math.max(w, d, h) * 0.5, 24, 16), structureMat); mesh.position.set(x, y + Math.max(w, d, h) * 0.5, z); }
          else if ((f.shape || layer.shape) === 'cylinder') { mesh = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(1, w * 0.5), Math.max(1, d * 0.5), h, 28), structureMat); mesh.position.set(x, y + h * 0.5, z); mesh.rotation.y = -THREE.MathUtils.degToRad(Number(f.orientationDeg || 0)); }
          else { mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), structureMat); mesh.position.set(x, y + h * 0.5, z); mesh.rotation.y = -THREE.MathUtils.degToRad(Number(f.orientationDeg || 0)); }
          mesh.castShadow = true; mesh.receiveShadow = true;
        } else if (layer.kind === 'marker') {
          const radius = Number(f.radiusM || layer.radiusM || 4);
          mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, radius * 3.0, 20), markerMat); mesh.position.set(x, y + radius * 1.6, z);
        } else if (layer.kind === 'water' && (f.waterFeature === 'waterfall' || f.waterFeature === 'fast-river')) {
          const radius = f.waterFeature === 'waterfall' ? 5 : 3, hh = f.waterFeature === 'waterfall' ? Math.max(16, Number(f.heightDropM || 16)) : 10;
          mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, hh, 18), waterMat); mesh.position.set(x, y + hh * 0.5, z);
        }
        if (mesh) { mesh.userData = { layer: layer.name, feature: f }; group.add(mesh); }
      }
    }
    s.overlayGroup = group; s.scene.add(group);
  }

  return <div className="viewport-shell">
    <div className="viewport" ref={mountRef} />
    <div className="viewport-hud" ref={hudRef}>MOVE · orbit camera</div>
  </div>;
});

export default TerrainViewport;
