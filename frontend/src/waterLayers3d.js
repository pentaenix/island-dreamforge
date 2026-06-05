/**
 * Ocean stack (bottom → top):
 * 1. Circle — solid deepest color (disc diameter).
 * 2. Rectangle — depth band map (padded rect, disc-clipped).
 * 3. Square — wave-crest foam.
 * 4. Circle (optional) — reflection-only disc just above foam; viewport only.
 */

import * as THREE from 'three';
import { buildFoamLayerTextureUrl, buildWaterBandsMapUrl } from './waterSurfaceComposite.js';
import { createOceanReflectionDiscMesh, isWaterReflectionEnabled } from './waterFoamReflection.js';
import { defaultBandEdgesM, ISLAND_WATER_HEX } from './waterPalette.js';
import { buildDiscLandAlphaUrl } from './waterMaskFromHeights.js';
import { getOceanDiscRadiusM, getWorldDimsM } from './worldSettings.js';

const DEEP_OCEAN_HEX = ISLAND_WATER_HEX[ISLAND_WATER_HEX.length - 1];

/** Fixed Y for the bottom deep-ocean disc (local to the water group). */
export const OCEAN_DEEP_Y_M = 0.02;

export const DEFAULT_OCEAN_LAYER_HEIGHTS_M = {
  bands: 0.1,
  foam: 0.14,
  reflection: 0.12,
};

/** Read absolute local Y for an upper stack layer — no clamping; use fallback only when unset/invalid. */
function layerHeightM(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Local Y heights for each ocean stack layer (deep disc is fixed). */
export function getOceanLayerHeightsM(ocean = {}) {
  const deep = OCEAN_DEEP_Y_M;
  return {
    deep,
    bands: layerHeightM(ocean.oceanBandsOffsetM, DEFAULT_OCEAN_LAYER_HEIGHTS_M.bands),
    foam: layerHeightM(ocean.oceanFoamOffsetM, DEFAULT_OCEAN_LAYER_HEIGHTS_M.foam),
    reflection: layerHeightM(ocean.oceanReflectionOffsetM, DEFAULT_OCEAN_LAYER_HEIGHTS_M.reflection),
  };
}

export function applyOceanLayerHeights(waterGroup, ocean = {}) {
  if (!waterGroup) return;
  const h = getOceanLayerHeightsM(ocean);
  waterGroup.userData.layerHeights = { ...h };
  for (const child of waterGroup.children) {
    if (child.name === 'ocean-deep-disc') child.position.y = h.deep;
    else if (child.name === 'ocean-bands-rect') child.position.y = h.bands;
    else if (child.name === 'ocean-foam-square') child.position.y = h.foam;
    else if (child.name === 'ocean-reflection-disc') child.position.y = h.reflection;
  }
  waterGroup.updateMatrixWorld(true);
}

function layerMaterial(opts) {
  return new THREE.MeshBasicMaterial({
    side: THREE.FrontSide,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    alphaTest: 0.03,
    ...opts,
  });
}

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.flipY = true;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

export function disposeWaterStack(water) {
  if (!water) return;
  water.traverse((child) => {
    if (!child.isMesh) return;
    if (child.userData?.disposeReflection) {
      child.userData.disposeReflection();
    } else {
      const mat = child.material;
      if (mat) {
        mat.map?.dispose();
        mat.alphaMap?.dispose();
        mat.dispose();
      }
    }
    child.geometry?.dispose();
  });
}

export async function createWaterStack3d({
  seaLevel,
  world,
  rows,
  cols,
  ocean,
  maxHeightM,
  waterColorUrl,
  waterDepthUrl,
  foamMaskUrl,
  shoreDistanceUrl = '',
  shoreDistanceMaxM = 0,
  heights,
}) {
  if (!heights?.length || rows < 2 || cols < 2) return null;

  const mapSizePx = { width: cols, height: rows };
  const discRadius = Math.max(50, getOceanDiscRadiusM(world, mapSizePx, ocean));
  const discDiameter = discRadius * 2;
  const { width: mapW, depth: mapD } = getWorldDimsM(rows, cols, world);
  const bandSmooth = Number(ocean.waterBandSmoothness ?? ocean.waterColorSmoothness ?? 0.35);

  const group = new THREE.Group();
  group.name = 'island-ocean-stack';
  group.userData.isOcean = true;
  group.userData.discDiameterM = discDiameter;
  group.userData.bandsTextureUrl = '';
  group.userData.foamTextureUrl = '';

  const layerY = getOceanLayerHeightsM(ocean);

  const baseGeo = new THREE.CircleGeometry(discRadius, 128);
  const baseMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(DEEP_OCEAN_HEX),
    side: THREE.FrontSide,
    depthWrite: true,
    transparent: false,
  });
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.rotation.x = -Math.PI / 2;
  baseMesh.position.y = layerY.deep;
  baseMesh.renderOrder = 0;
  baseMesh.name = 'ocean-deep-disc';
  group.add(baseMesh);

  if (waterColorUrl) {
    const edges = defaultBandEdgesM(ocean);
    const bandReachM = edges[edges.length - 1] || 0;
    const reachM = Math.max(bandReachM, discRadius);
    const mppX = mapW / Math.max(1, cols);
    const mppZ = mapD / Math.max(1, rows);
    const usePad = !!shoreDistanceUrl;
    const padPxX = usePad ? Math.max(0, Math.round(Math.max(0, reachM - mapW / 2) / Math.max(1e-6, mppX))) : 0;
    const padPxZ = usePad ? Math.max(0, Math.round(Math.max(0, reachM - mapD / 2) / Math.max(1e-6, mppZ))) : 0;

    const bandsUrl = await buildWaterBandsMapUrl({
      rows,
      cols,
      heights,
      mapW,
      mapD,
      seaLevelM: seaLevel,
      maxHeightM,
      worldSettings: world,
      oceanSettings: ocean,
      waterColorUrl,
      shoreDistanceUrl: shoreDistanceUrl || '',
      shoreDistanceMaxM,
      bandSmoothness: bandSmooth,
      padPxX,
      padPxZ,
      discRadiusM: usePad ? discRadius : 0,
    }).catch((err) => {
      console.warn('Water bands map failed', err);
      return waterColorUrl;
    });

    group.userData.bandsTextureUrl = bandsUrl || waterColorUrl || '';
    const bandsTex = await loadTexture(bandsUrl || waterColorUrl);
    const paddedW = (cols + 2 * padPxX) * mppX;
    const paddedD = (rows + 2 * padPxZ) * mppZ;
    const bandsGeo = new THREE.PlaneGeometry(paddedW, paddedD, 1, 1);
    const bandsMat = layerMaterial({
      map: bandsTex,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -3,
    });
    const bandsMesh = new THREE.Mesh(bandsGeo, bandsMat);
    bandsMesh.rotation.x = -Math.PI / 2;
    bandsMesh.position.y = layerY.bands;
    bandsMesh.renderOrder = 1;
    bandsMesh.name = 'ocean-bands-rect';
    group.add(bandsMesh);
  }

  const foamUrl = await buildFoamLayerTextureUrl({
    foamMaskUrl: foamMaskUrl || '',
    discRadiusM: discRadius,
    mapW,
    mapD,
    rows,
    cols,
    seaLevelM: seaLevel,
    maxHeightM,
    worldSettings: world,
    oceanSettings: ocean,
    mapSizePx,
    ocean,
    shoreDistanceUrl: shoreDistanceUrl || '',
    shoreDistanceMaxM,
    heights,
  }).catch((err) => {
    console.warn('Foam layer failed', err);
    return '';
  });

  group.userData.foamTextureUrl = foamUrl || '';
  if (foamUrl) {
    const foamTex = await loadTexture(foamUrl);
    const foamGeo = new THREE.PlaneGeometry(discDiameter, discDiameter, 1, 1);
    const foamMesh = new THREE.Mesh(
      foamGeo,
      layerMaterial({
        map: foamTex,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -4,
      }),
    );
    foamMesh.rotation.x = -Math.PI / 2;
    foamMesh.position.y = layerY.foam;
    foamMesh.renderOrder = 3;
    foamMesh.name = 'ocean-foam-square';
    group.add(foamMesh);
  }

  if (isWaterReflectionEnabled(ocean)) {
    const wetMaskUrl = buildDiscLandAlphaUrl(
      discRadius,
      rows,
      cols,
      heights,
      seaLevel,
      maxHeightM,
      world,
      ocean,
      mapSizePx,
      512,
    );
    const wetMaskTex = await loadTexture(wetMaskUrl);
    const reflectionMesh = createOceanReflectionDiscMesh(discRadius, ocean, wetMaskTex);
    reflectionMesh.rotation.x = -Math.PI / 2;
    reflectionMesh.position.y = layerY.reflection;
    reflectionMesh.renderOrder = 2;
    group.userData.reflectionEnabled = true;
    group.add(reflectionMesh);
  }

  applyOceanLayerHeights(group, ocean);
  return group;
}
