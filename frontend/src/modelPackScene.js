/**
 * Render placed GLB model pack instances in the Three.js scene.
 */

import * as THREE from 'three';
import { elevationMetersFromNormalized } from './worldSettings.js';
import {
  cloneVariantForInstance,
  getInstancingMeshes,
  loadModelPackGlb,
} from './modelPackLoader.js';
import {
  buildModelPackVegetationMask,
  computeCoastDistanceM,
  placeAllModelPacks,
} from './modelPackPlacement.js';
import { normalizeModelPacks } from './modelPackSettings.js';
import { getPackGlbObjectUrl, packHasGlbBlob } from './modelPackBlobStore.js';
import { buildPathOverlayMaskForLayer } from './pathTexturePaint.js';

const MULTI_MESH_CAP = 180;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function terrainHeightAt(heights, rows, cols, maxH, world, x, z) {
  const width = Math.max(50, Number(world?.widthM || 1480));
  const depth = Math.max(50, Number(world?.depthM || (width * rows / Math.max(1, cols))));
  const u = clamp(x / width + 0.5, 0, 1);
  const v = clamp(z / depth + 0.5, 0, 1);
  const col = clamp(Math.round(u * (cols - 1)), 0, cols - 1);
  const row = clamp(Math.round(v * (rows - 1)), 0, rows - 1);
  return elevationMetersFromNormalized(heights[row * cols + col] || 0, maxH, world);
}

function applyInstanceTransform(obj, inst, heights, rows, cols, maxH, world) {
  const [x, , z] = inst.position;
  const y = terrainHeightAt(heights, rows, cols, maxH, world, x, z);
  const [sx, sy, sz] = inst.scale;
  const [, rotY] = inst.rotation;
  obj.position.set(x, y, z);
  obj.rotation.set(0, rotY, 0);
  obj.scale.set(sx, sy, sz);
  if (inst.rules?.alignToNormal) {
    obj.rotation.x = -0.15;
  }
}

function disposeGroup(group) {
  if (!group) return;
  group.traverse((obj) => {
    obj.geometry?.dispose?.();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
      else obj.material.dispose?.();
    }
  });
}

async function loadPacks(packs) {
  const loadedById = {};
  const metaUpdates = {};
  for (const pack of packs) {
    const url = getPackGlbObjectUrl(pack.id);
    if (!url) continue;
    try {
      const entry = await loadModelPackGlb(pack.id, url);
      loadedById[pack.id] = entry;
      metaUpdates[pack.id] = entry.meta;
    } catch (err) {
      console.warn(`[model packs] Failed to load ${pack.name}`, err);
    }
  }
  return { loadedById, metaUpdates };
}

function renderInstancesToGroup(group, instances, loadedById, ctx) {
  const { heights, rows, cols, maxH, world } = ctx;
  const byVariant = new Map();

  for (const inst of instances) {
    const loaded = loadedById[inst.packId];
    const variant = loaded?.variants?.find((v) => v.id === inst.variantId) || loaded?.variants?.[0];
    if (!variant) continue;
    const key = `${inst.packId}::${variant.id}`;
    if (!byVariant.has(key)) byVariant.set(key, { variant, list: [] });
    byVariant.get(key).list.push(inst);
  }

  for (const { variant, list } of byVariant.values()) {
    const meshParts = getInstancingMeshes(variant);
    const isSimple = meshParts.length === 1;

    if (isSimple && list.length > 0) {
      const part = meshParts[0];
      const batch = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      const dummy = new THREE.Object3D();
      list.forEach((inst, i) => {
        applyInstanceTransform(dummy, inst, heights, rows, cols, maxH, world);
        dummy.updateMatrix();
        batch.setMatrixAt(i, dummy.matrix);
      });
      batch.instanceMatrix.needsUpdate = true;
      batch.castShadow = true;
      batch.receiveShadow = true;
      group.add(batch);
      continue;
    }

    const cap = Math.min(list.length, MULTI_MESH_CAP);
    for (let i = 0; i < cap; i++) {
      const inst = list[i];
      const clone = cloneVariantForInstance(variant);
      applyInstanceTransform(clone, inst, heights, rows, cols, maxH, world);
      clone.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      group.add(clone);
    }
  }
}

export async function renderModelPacks(group, props, state) {
  const packs = normalizeModelPacks(props.detailSettings?.modelPacks || []);
  if (!packs.some((p) => p.enabled !== false && (p.hasGlb || packHasGlbBlob(p.id)))) {
    state.placementManifest = [];
    state.modelPackVegetationMask = null;
    return { metaUpdates: {} };
  }

  const { loadedById, metaUpdates } = await loadPacks(packs.filter((p) => p.enabled !== false));
  const texW = state.textureCanvas?.width || state.cols || 1;
  const texH = state.textureCanvas?.height || state.rows || 1;

  const detailMasksByLayer = {};
  for (const pack of packs) {
    if (pack.enabled === false) continue;
    const layerId = pack.placement?.maskLayerId;
    if (!layerId || detailMasksByLayer[layerId]) continue;
    const layer = (props.layers || []).find((l) => l.id === layerId);
    if (layer?.url) {
      detailMasksByLayer[layerId] = await buildPathOverlayMaskForLayer(layer, texW, texH, {}, 8);
    }
  }

  const ctx = {
    heights: state.heights,
    rows: state.rows,
    cols: state.cols,
    maxH: Number(props.maxHeightM || 500),
    world: props.worldSettings || {},
    seaLevelM: Number(props.seaLevelM || 0),
    layers: props.layers || [],
    materialPreview: state.materialPreview,
    masks: {
      texW,
      texH,
      waterMask: state.noVegetationMasks?.waterMask || state.waterOverlayMaskGrid,
      pathMask: state.noVegetationMasks?.pathMask || state.pathOverlayMaskGrid,
      riverMask: state.waterOverlayMaskGrid,
      structureMask: state.noVegetationMasks?.structureMask,
      dockMask: state.noVegetationMasks?.dockMask,
      detailMask: state.detailMaskGrid,
    },
    coastDist: state.coastDistanceField || computeCoastDistanceM(
      state.heights,
      state.rows,
      state.cols,
      Number(props.seaLevelM || 0),
      Number(props.maxHeightM || 500),
      props.worldSettings || {},
    ),
  };
  if (!state.coastDistanceField && ctx.coastDist) state.coastDistanceField = ctx.coastDist;

  const { instances, manifest } = placeAllModelPacks(
    packs.filter((p) => p.enabled !== false),
    loadedById,
    { ...ctx, detailMasksByLayer },
  );

  renderInstancesToGroup(group, instances, loadedById, ctx);
  state.placementManifest = manifest;
  state.modelPackVegetationMask = buildModelPackVegetationMask(
    manifest,
    texW,
    texH,
    state.rows,
    state.cols,
    props.worldSettings || {},
  );

  return { metaUpdates };
}

export { disposeGroup as disposeModelPackGroup };
