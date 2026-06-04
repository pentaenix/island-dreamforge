/**
 * Three independent layers (bottom → top):
 * 1. Circle — solid deepest color (disc diameter slider only).
 * 2. Rectangle — band reach plane; texture matches plane 1:1 (more pixels, not scaled art).
 * 3. Square — foam (disc diameter; separate from band map).
 */

import * as THREE from 'three';
import { buildFoamLayerTextureUrl, buildWaterBandsMapUrl } from './waterSurfaceComposite.js';
import { ISLAND_WATER_HEX } from './waterPalette.js';
import {
  getBandsPlaneDimsM,
  getBandsTexDimsPx,
  getOceanDiscRadiusM,
  getWorldDimsM,
} from './worldSettings.js';

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
  heights,
  bandsPlaneWidthM = 0,
  bandsPlaneDepthM = 0,
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
    const target = getBandsPlaneDimsM(world, mapSizePx, ocean);
    const planeW = Number(bandsPlaneWidthM) > 0 ? Number(bandsPlaneWidthM) : target.width;
    const planeD = Number(bandsPlaneDepthM) > 0 ? Number(bandsPlaneDepthM) : target.depth;

    const bandsUrl = await buildWaterBandsMapUrl({
      rows,
      cols,
      heights,
      mapW,
      mapD,
      bandsPlaneWidthM: planeW,
      bandsPlaneDepthM: planeD,
      seaLevelM: seaLevel,
      maxHeightM,
      worldSettings: world,
      waterColorUrl,
      waterDepthUrl: waterDepthUrl || '',
      bandSmoothness: bandSmooth,
    }).catch((err) => {
      console.warn('Water bands map failed', err);
      return waterColorUrl;
    });

    const bandsTex = await loadTexture(bandsUrl || waterColorUrl);
    const texW = bandsTex.image?.width ?? cols;
    const texH = bandsTex.image?.height ?? rows;
    const expected = getBandsTexDimsPx(rows, cols, world, mapSizePx, ocean);
    const isExpandedExport =
      texW >= expected.outCols - 1 && texH >= expected.outRows - 1;

    bandsTex.wrapS = THREE.ClampToEdgeWrapping;
    bandsTex.wrapT = THREE.ClampToEdgeWrapping;
    if (!isExpandedExport && planeW > mapW + 1) {
      const repeatX = mapW / planeW;
      const repeatY = mapD / planeD;
      bandsTex.repeat.set(repeatX, repeatY);
      bandsTex.offset.set((1 - repeatX) / 2, (1 - repeatY) / 2);
      console.warn(
        'Band map is island-sized; regenerate derived maps for full band-reach canvas',
      );
    } else {
      bandsTex.repeat.set(1, 1);
      bandsTex.offset.set(0, 0);
    }

    const bandsGeo = new THREE.PlaneGeometry(planeW, planeD, 1, 1);
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
