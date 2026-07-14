/**
 * Export the live 3D viewport as GLB — terrain + baked ocean disc, unlit textures only.
 * Ocean is composited into one mesh so GLB viewers don't Z-fight stacked band planes.
 */

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { getOceanLayerHeightsM } from './waterLayers3d.js';
import { ISLAND_WATER_HEX } from './waterPalette.js';

const DEEP_OCEAN_HEX = ISLAND_WATER_HEX[ISLAND_WATER_HEX.length - 1];
const BAKE_TEX_SIZE = 2048;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (url && !String(url).startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function unlitMaterialFrom(source, { isTerrain = false, oceanLayer = '' } = {}) {
  if (!source) {
    return new THREE.MeshBasicMaterial({ color: 0xffffff, side: isTerrain ? THREE.DoubleSide : THREE.FrontSide });
  }
  const mats = Array.isArray(source) ? source : [source];
  const src = mats[0];

  const foamMap = src.isShaderMaterial && src.uniforms?.foamMap?.value
    ? src.uniforms.foamMap.value
    : null;

  const isOceanOverlay = oceanLayer === 'ocean-bands-rect' || oceanLayer === 'ocean-foam-square';
  const isOceanDeep = oceanLayer === 'ocean-deep-disc';
  const hasAlphaCutout = !!(foamMap || src.alphaTest || (src.transparent && src.map));

  if (isOceanDeep) {
    const mat = new THREE.MeshBasicMaterial({
      color: src.color ? src.color.clone() : new THREE.Color(DEEP_OCEAN_HEX),
      map: src.map || null,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
    });
    if (mat.map) {
      mat.map = mat.map.clone();
      mat.map.needsUpdate = true;
    }
    return mat;
  }

  if (isOceanOverlay) {
    const mat = new THREE.MeshBasicMaterial({
      map: src.map ? src.map.clone() : null,
      color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
      transparent: true,
      opacity: 1,
      alphaTest: Math.max(0.03, src.alphaTest || 0.03),
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: src.polygonOffsetFactor ?? -2,
      polygonOffsetUnits: src.polygonOffsetUnits ?? -3,
      side: THREE.FrontSide,
    });
    if (mat.map) mat.map.needsUpdate = true;
    return mat;
  }

  const mat = new THREE.MeshBasicMaterial({
    map: foamMap || src.map || null,
    color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
    transparent: false,
    opacity: 1,
    alphaTest: hasAlphaCutout ? Math.max(0.03, src.alphaTest || 0.04) : 0,
    side: isTerrain ? THREE.DoubleSide : (src.side ?? THREE.FrontSide),
    depthWrite: true,
    depthTest: true,
  });
  if (mat.map) {
    mat.map = mat.map.clone();
    mat.map.needsUpdate = true;
  }
  return mat;
}

function cloneWithUnlitMaterials(object, { terrain = false } = {}) {
  const clone = object.clone(true);
  clone.traverse((node) => {
    if (!node.isMesh) return;
    node.material = unlitMaterialFrom(node.material, { isTerrain: terrain, oceanLayer: node.name || '' });
    node.castShadow = false;
    node.receiveShadow = false;
  });
  return clone;
}

function disposeExportRoot(root) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry?.dispose();
    const mat = node.material;
    if (!mat) return;
    mat.map?.dispose();
    mat.dispose();
  });
}

/**
 * Composite deep ocean + bands + foam into one disc texture (matches viewport stacking).
 */
async function bakeOceanDiscTexture(water) {
  const discDiameter = Number(water.userData?.discDiameterM) || 0;
  const discRadius = discDiameter * 0.5;
  if (discRadius < 1) return null;

  const bandsMesh = water.getObjectByName('ocean-bands-rect');
  const foamMesh = water.getObjectByName('ocean-foam-square');
  const bandsUrl = water.userData?.bandsTextureUrl || '';
  const foamUrl = water.userData?.foamTextureUrl || '';

  const size = BAKE_TEX_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const cx = size * 0.5;
  const cy = size * 0.5;
  const r = size * 0.5;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = DEEP_OCEAN_HEX;
  ctx.fillRect(0, 0, size, size);

  if (bandsUrl) {
    try {
      const bandsImg = await loadImage(bandsUrl);
      let drawW = size;
      let drawH = size;
      if (bandsMesh?.geometry?.parameters) {
        const { width, height } = bandsMesh.geometry.parameters;
        if (width > 0 && height > 0) {
          drawW = size * (width / discDiameter);
          drawH = size * (height / discDiameter);
        }
      }
      const dx = (size - drawW) * 0.5;
      const dy = (size - drawH) * 0.5;
      ctx.drawImage(bandsImg, dx, dy, drawW, drawH);
    } catch (err) {
      console.warn('[export] Ocean bands bake failed', err);
    }
  }

  if (foamUrl) {
    try {
      const foamImg = await loadImage(foamUrl);
      ctx.drawImage(foamImg, 0, 0, size, size);
    } catch (err) {
      console.warn('[export] Ocean foam bake failed', err);
    }
  }

  ctx.restore();
  return { canvas, discRadius };
}

/**
 * Single ocean disc mesh for GLB export — no stacked planes, no Z-fighting.
 */
async function buildBakedOceanMesh(water) {
  const baked = await bakeOceanDiscTexture(water);
  if (!baked) return null;

  const { canvas, discRadius } = baked;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = true;
  texture.needsUpdate = true;

  const layerY = getOceanLayerHeightsM(water.userData?.oceanSettings || {});
  const deepY = water.getObjectByName('ocean-deep-disc')?.position.y ?? layerY.deep;

  const group = new THREE.Group();
  group.name = 'ocean_stack_baked';
  group.position.copy(water.position);
  group.quaternion.copy(water.quaternion);
  group.scale.copy(water.scale);

  const geo = new THREE.CircleGeometry(discRadius, 128);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.FrontSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = deepY;
  mesh.name = 'ocean-baked-disc';
  group.add(mesh);

  return group;
}

/** Fallback: clone stack with viewport depth/polygon-offset rules preserved. */
function cloneOceanStackForExport(water) {
  const ocean = cloneWithUnlitMaterials(water, { terrain: false });
  const toRemove = [];
  ocean.traverse((node) => {
    if (node.userData?.isOceanReflection) toRemove.push(node);
  });
  for (const node of toRemove) {
    node.parent?.remove(node);
    node.geometry?.dispose();
    node.userData.disposeReflection?.();
  }
  ocean.name = 'ocean_stack';
  ocean.position.copy(water.position);
  ocean.quaternion.copy(water.quaternion);
  ocean.scale.copy(water.scale);
  return ocean;
}

/**
 * Build an export root: land mesh + baked ocean disc, no lights/skybox.
 */
export async function buildViewportExportRoot({ mesh, water, extras = [] }) {
  const root = new THREE.Group();
  root.name = 'island_dreamforge_preview';

  if (mesh) {
    const land = cloneWithUnlitMaterials(mesh, { terrain: true });
    land.name = 'terrain';
    root.add(land);
  }

  for (const extra of extras) {
    if (!extra) continue;
    const clone = cloneWithUnlitMaterials(extra, { terrain: false });
    root.add(clone);
  }

  if (water) {
    const bakedOcean = await buildBakedOceanMesh(water);
    if (bakedOcean) {
      root.add(bakedOcean);
    } else {
      root.add(cloneOceanStackForExport(water));
    }
  }

  return root;
}

/**
 * @returns {Promise<Blob>} GLB binary
 */
export async function exportViewportSceneGlb(sceneObjects) {
  const root = await buildViewportExportRoot(sceneObjects);
  const exporter = new GLTFExporter();

  try {
    const arrayBuffer = await new Promise((resolve, reject) => {
      exporter.parse(
        root,
        (result) => {
          if (result instanceof ArrayBuffer) resolve(result);
          else reject(new Error('GLTF export did not return binary GLB'));
        },
        (error) => reject(error),
        { binary: true, embedImages: true, onlyVisible: true, truncateDrawRange: true },
      );
    });
    return new Blob([arrayBuffer], { type: 'model/gltf-binary' });
  } finally {
    disposeExportRoot(root);
  }
}
