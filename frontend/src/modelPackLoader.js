/**
 * GLB model pack loader — GLTFLoader, variant extraction, normalization, cache.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map();

function cacheKey(packId, url) {
  return `${packId}::${url}`;
}

function collectMeshes(root) {
  const meshes = [];
  root.traverse((node) => {
    if (node.isMesh) meshes.push(node);
  });
  return meshes;
}

function normalizeVariantRoot(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
  const targetHeight = 1;
  const scale = targetHeight / maxDim;
  root.position.sub(center);
  root.position.y += (size.y * scale) * 0.5;
  root.scale.setScalar(scale);
  return { heightM: size.y * scale, widthM: Math.max(size.x, size.z) * scale };
}

function extractVariants(scene) {
  const variants = [];
  const children = scene.children.filter((c) => c.visible !== false);

  if (children.length <= 1) {
    const root = new THREE.Group();
    const clone = scene.clone(true);
    root.add(clone);
    const dims = normalizeVariantRoot(root);
    variants.push({
      id: 'variant-0',
      name: scene.name || 'Model',
      root,
      meshCount: collectMeshes(root).length,
      dims,
    });
    return variants;
  }

  children.forEach((child, index) => {
    const root = new THREE.Group();
    root.add(child.clone(true));
    const name = child.name || `Variant ${index + 1}`;
    const dims = normalizeVariantRoot(root);
    variants.push({
      id: `variant-${index}`,
      name,
      root,
      meshCount: collectMeshes(root).length,
      dims,
    });
  });
  return variants;
}

export async function loadModelPackGlb(packId, url) {
  if (!url) return null;
  const key = cacheKey(packId, url);
  if (cache.has(key)) return cache.get(key);

  const promise = new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const scene = gltf.scene || gltf.scenes?.[0];
        if (!scene) {
          reject(new Error('GLB has no scene'));
          return;
        }
        const variants = extractVariants(scene);
        const meta = variants.map((v) => ({ id: v.id, name: v.name, meshCount: v.meshCount }));
        const entry = { variants, meta, url };
        cache.set(key, entry);
        resolve(entry);
      },
      undefined,
      (err) => reject(err),
    );
  });

  cache.set(key, promise);
  try {
    return await promise;
  } catch (e) {
    cache.delete(key);
    throw e;
  }
}

export function invalidateModelPackCache(packId, url) {
  if (url) cache.delete(cacheKey(packId, url));
  else {
    for (const key of cache.keys()) {
      if (key.startsWith(`${packId}::`)) cache.delete(key);
    }
  }
}

export function cloneVariantForInstance(variant) {
  return variant.root.clone(true);
}

export function getInstancingMeshes(variant) {
  variant.root.updateMatrixWorld(true);
  const meshes = [];
  variant.root.traverse((node) => {
    if (!node.isMesh) return;
    meshes.push({
      geometry: node.geometry,
      material: node.material,
      localMatrix: node.matrixWorld.clone(),
    });
  });
  return meshes;
}

export async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
