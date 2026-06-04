/**
 * Export the live 3D viewport as GLB — terrain + circular ocean stack, unlit textures only.
 * Matches what you see in the preview minus skybox and lighting.
 */

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

function unlitMaterialFrom(source, { isTerrain = false } = {}) {
  if (!source) {
    return new THREE.MeshBasicMaterial({ color: 0xffffff, side: isTerrain ? THREE.DoubleSide : THREE.FrontSide });
  }
  const mats = Array.isArray(source) ? source : [source];
  const src = mats[0];

  // Viewport-only foam reflection uses a shader — export foam crest texture without the mirror pass.
  const foamMap = src.isShaderMaterial && src.uniforms?.foamMap?.value
    ? src.uniforms.foamMap.value
    : null;

  const hasAlphaCutout = !!(foamMap || src.alphaTest || (src.transparent && src.map));
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
    node.material = unlitMaterialFrom(node.material, { isTerrain: terrain });
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
 * Build an export root: land mesh + water stack (deep disc, bands, foam), no lights/skybox.
 */
export function buildViewportExportRoot({ mesh, water }) {
  const root = new THREE.Group();
  root.name = 'island_dreamforge_preview';

  if (mesh) {
    const land = cloneWithUnlitMaterials(mesh, { terrain: true });
    land.name = 'terrain';
    root.add(land);
  }

  if (water) {
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
    root.add(ocean);
  }

  return root;
}

/**
 * @returns {Promise<Blob>} GLB binary
 */
export async function exportViewportSceneGlb(sceneObjects) {
  const root = buildViewportExportRoot(sceneObjects);
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
