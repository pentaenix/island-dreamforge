/**
 * Three independent layers (bottom → top):
 * 1. Circle — solid deepest color (disc diameter slider only).
 * 2. Rectangle — island footprint, exported band map texture (0–1 UV, map-sized plane).
 * 3. Square — foam (disc diameter; separate from band map).
 */

import * as THREE from 'three';
import { buildFoamLayerTextureUrl, buildWaterBandsMapUrl } from './waterSurfaceComposite.js';
import { defaultBandEdgesM, ISLAND_WATER_HEX } from './waterPalette.js';
import { getOceanDiscRadiusM, getWorldDimsM } from './worldSettings.js';

const DEEP_OCEAN_HEX = ISLAND_WATER_HEX[ISLAND_WATER_HEX.length - 1];

export const OCEAN_LAYER_Y_M = {
  deep: 0.3,
  bands: 1.65,
  foam: 2.9,
};

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
    child.geometry?.dispose();
    const mat = child.material;
    if (!mat) return;
    mat.map?.dispose();
    mat.alphaMap?.dispose();
    mat.dispose();
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

  const baseGeo = new THREE.CircleGeometry(discRadius, 128);
  const baseMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(DEEP_OCEAN_HEX),
    side: THREE.FrontSide,
    depthWrite: true,
    transparent: false,
  });
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.rotation.x = -Math.PI / 2;
  baseMesh.position.y = OCEAN_LAYER_Y_M.deep;
  baseMesh.renderOrder = 0;
  baseMesh.name = 'ocean-deep-disc';
  group.add(baseMesh);

  if (waterColorUrl) {
    // Auto band sizing: grow the texture (and plane) so the smooth gradient covers
    // the whole deep-ocean disc, then clip the texture to that disc so the round
    // silhouette is kept. This removes the seam where the band rectangle used to
    // stop short of the (larger) deep disc beneath it.
    const edges = defaultBandEdgesM(ocean);
    const bandReachM = edges[edges.length - 1] || 0;
    const reachM = Math.max(bandReachM, discRadius);
    const mppX = mapW / Math.max(1, cols);
    const mppZ = mapD / Math.max(1, rows);
    const usePad = !!shoreDistanceUrl;
    const padPxX = usePad ? Math.max(0, Math.round(Math.max(0, reachM - mapW / 2) / Math.max(1e-6, mppX))) : 0;
    const padPxZ = usePad ? Math.max(0, Math.round(Math.max(0, reachM - mapD / 2) / Math.max(1e-6, mppZ))) : 0;
    const paddedW = (cols + 2 * padPxX) * mppX;
    const paddedD = (rows + 2 * padPxZ) * mppZ;

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

    const bandsTex = await loadTexture(bandsUrl || waterColorUrl);
    const bandsGeo = new THREE.PlaneGeometry(paddedW, paddedD, 1, 1);
    const bandsMat = layerMaterial({
      map: bandsTex,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -3,
    });
    const bandsMesh = new THREE.Mesh(bandsGeo, bandsMat);
    bandsMesh.rotation.x = -Math.PI / 2;
    bandsMesh.position.y = OCEAN_LAYER_Y_M.bands;
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

  if (foamUrl) {
    const foamTex = await loadTexture(foamUrl);
    const foamGeo = new THREE.PlaneGeometry(discDiameter, discDiameter, 1, 1);
    const foamMat = layerMaterial({
      map: foamTex,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -4,
    });
    const foamMesh = new THREE.Mesh(foamGeo, foamMat);
    foamMesh.rotation.x = -Math.PI / 2;
    foamMesh.position.y = OCEAN_LAYER_Y_M.foam;
    foamMesh.renderOrder = 2;
    foamMesh.name = 'ocean-foam-square';
    group.add(foamMesh);
  }

  return group;
}
