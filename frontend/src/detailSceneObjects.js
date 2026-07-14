/**
 * Procedural 3D dressing: palms, rock scars, resort clusters, docks, landmarks.
 * Cheap instanced / low-poly meshes for the Details step.
 */

import * as THREE from 'three';
import { elevationMetersFromNormalized, getIslandHorizonScale } from './worldSettings.js';
import { RESORT_COLOR_PRESETS } from './detailSettings.js';
import { renderModelPacks } from './modelPackScene.js';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function smoothstep(a, b, x) { const t = clamp((x - a) / Math.max(1e-6, b - a), 0, 1); return t * t * (3 - 2 * t); }

function hashNoise(x, y, seed = 0) {
  const n = Math.sin((x * 127.1 + y * 311.7 + seed * 74.7)) * 43758.5453;
  return n - Math.floor(n);
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

function getWorldDims(rows, cols, settings = {}) {
  const width = Math.max(50, Number(settings?.widthM || 1480));
  const depth = Math.max(50, Number(settings?.depthM || (width * rows / Math.max(1, cols))));
  return { width, depth };
}

function gridToWorld(r, c, rows, cols, world) {
  const { width, depth } = getWorldDims(rows, cols, world);
  const x = (c / Math.max(1, cols - 1) - 0.5) * width;
  const z = (r / Math.max(1, rows - 1) - 0.5) * depth;
  return { x, z, width, depth };
}

function sampleMaskAt(mask, maskW, maskH, r, c, rows, cols) {
  if (!mask?.length) return 0;
  const tx = Math.min(maskW - 1, Math.max(0, Math.round((c / Math.max(1, cols - 1)) * (maskW - 1))));
  const ty = Math.min(maskH - 1, Math.max(0, Math.round((r / Math.max(1, rows - 1)) * (maskH - 1))));
  return mask[ty * maskW + tx] || 0;
}

function isBlockedByMasks(r, c, rows, cols, masks = {}) {
  const { waterMask, pathMask, structureMask, dockMask, beachMask, modelPackMask, riverMask } = masks;
  const texW = waterMask?.length ? Math.round(Math.sqrt(waterMask.length)) : cols;
  const texH = texW;
  if (sampleMaskAt(waterMask, texW, texH, r, c, rows, cols) > 48) return true;
  if (sampleMaskAt(riverMask, texW, texH, r, c, rows, cols) > 48) return true;
  if (sampleMaskAt(pathMask, texW, texH, r, c, rows, cols) > 48) return true;
  if (sampleMaskAt(structureMask, texW, texH, r, c, rows, cols) > 32) return true;
  if (sampleMaskAt(dockMask, texW, texH, r, c, rows, cols) > 32) return true;
  if (sampleMaskAt(modelPackMask, texW, texH, r, c, rows, cols) > 32) return true;
  if (beachMask === false) return false;
  return false;
}

function heightAt(heights, rows, cols, r, c) {
  const rr = clamp(Math.round(r), 0, rows - 1);
  const cc = clamp(Math.round(c), 0, cols - 1);
  return heights[rr * cols + cc] || 0;
}

function slopeAt(heights, rows, cols, r, c, maxH, world) {
  const worldMaxH = maxH * getIslandHorizonScale(world);
  const { width, depth } = getWorldDims(rows, cols, world);
  const cellX = width / Math.max(1, cols - 1);
  const cellZ = depth / Math.max(1, rows - 1);
  const h = (rr, cc) => heightAt(heights, rows, cols, rr, cc);
  const dx = Math.abs(h(r, c + 1) - h(r, c - 1)) * worldMaxH / Math.max(1, cellX * 2);
  const dz = Math.abs(h(r + 1, c) - h(r - 1, c)) * worldMaxH / Math.max(1, cellZ * 2);
  return Math.atan(Math.sqrt(dx * dx + dz * dz)) * 180 / Math.PI;
}

function terrainHeightAtWorld(heights, rows, cols, maxH, world, x, z) {
  const { width, depth } = getWorldDims(rows, cols, world);
  const u = clamp(x / width + 0.5, 0, 1);
  const v = clamp(z / depth + 0.5, 0, 1);
  const col = clamp(Math.round(u * (cols - 1)), 0, cols - 1);
  const row = clamp(Math.round(v * (rows - 1)), 0, rows - 1);
  return elevationMetersFromNormalized(heightAt(heights, rows, cols, row, col), maxH, world);
}

function makeLandDistanceField(rows, cols, heights, seaLevelM, maxH, world) {
  const worldMaxH = maxH * getIslandHorizonScale(world);
  const seaNorm = seaLevelM / Math.max(1, worldMaxH);
  const mapLand = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((heights[r * cols + c] || 0) > seaNorm + 0.004) mapLand[r * cols + c] = 1;
    }
  }
  const dist = new Float32Array(rows * cols);
  const inf = Math.max(rows, cols) * 4;
  for (let i = 0; i < dist.length; i++) dist[i] = mapLand[i] ? 0 : inf;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const p = y * cols + x;
      if (x > 0) dist[p] = Math.min(dist[p], dist[p - 1] + 1);
      if (y > 0) dist[p] = Math.min(dist[p], dist[p - cols] + 1);
    }
  }
  for (let y = rows - 1; y >= 0; y--) {
    for (let x = cols - 1; x >= 0; x--) {
      const p = y * cols + x;
      if (x < cols - 1) dist[p] = Math.min(dist[p], dist[p + 1] + 1);
      if (y < rows - 1) dist[p] = Math.min(dist[p], dist[p + cols] + 1);
    }
  }
  const { width, depth } = getWorldDims(rows, cols, world);
  const mppX = width / Math.max(1, cols - 1);
  const mppZ = depth / Math.max(1, rows - 1);
  const mpp = (mppX + mppZ) * 0.5;
  for (let i = 0; i < dist.length; i++) dist[i] *= mpp;
  return dist;
}

function renderBeachPalms(group, ctx) {
  const { heights, rows, cols, maxH, world, seaLevelM, detailSettings, masks, skybox } = ctx;
  const cfg = detailSettings?.beachPalms || {};
  if (cfg.enabled === false) return;

  const density = clamp(Number(cfg.density ?? 0.42), 0, 1);
  const maxCount = Math.max(10, Math.round(Number(cfg.maxCount ?? 120)));
  const minDist = Number(cfg.minDistanceToWaterM ?? 2);
  const maxDist = Number(cfg.maxDistanceToWaterM ?? 35);
  const scaleMin = Number(cfg.scaleMin ?? 4);
  const scaleMax = Number(cfg.scaleMax ?? 9);
  const seed = Math.round(Number(cfg.seed ?? 77));

  const shoreDist = makeLandDistanceField(rows, cols, heights, seaLevelM, maxH, world);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8b6b42, roughness: 0.92, metalness: 0 });
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x4a9a48,
    roughness: 0.88,
    metalness: 0,
    side: THREE.DoubleSide,
    envMap: skybox || null,
  });
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1, 6);
  const leafGeo = new THREE.PlaneGeometry(1, 1.4);
  const trunkMatrices = [];
  const leafMatrices = [];
  const dummy = new THREE.Object3D();
  let placed = 0;
  const spacing = Math.max(3, Math.round(14 - density * 8));

  for (let r = 2; r < rows - 2 && placed < maxCount; r += spacing) {
    for (let c = 2; c < cols - 2 && placed < maxCount; c += spacing) {
      const distM = shoreDist[r * cols + c];
      if (distM < minDist || distM > maxDist) continue;
      const slope = slopeAt(heights, rows, cols, r, c, maxH, world);
      if (slope > 22) continue;
      if (isBlockedByMasks(r, c, rows, cols, masks)) continue;
      const n = hashNoise(r, c, seed);
      if (n > density) continue;

      const { x, z } = gridToWorld(r, c, rows, cols, world);
      const y = elevationMetersFromNormalized(heightAt(heights, rows, cols, r, c), maxH, world);
      const scale = scaleMin + (1 - n) * (scaleMax - scaleMin);
      dummy.position.set(x, y + scale * 0.45, z);
      dummy.rotation.set(0, hashNoise(c, r, seed + 3) * Math.PI * 2, 0);
      dummy.scale.set(scale * 0.18, scale * 0.9, scale * 0.18);
      dummy.updateMatrix();
      trunkMatrices.push(dummy.matrix.clone());

      for (let li = 0; li < 2; li++) {
        dummy.position.set(x, y + scale * 0.95, z);
        dummy.rotation.set(li === 0 ? -0.55 : 0.55, hashNoise(r, c, seed + li) * Math.PI, 0);
        dummy.scale.set(scale * 0.55, scale * 0.7, 1);
        dummy.updateMatrix();
        leafMatrices.push(dummy.matrix.clone());
      }
      placed += 1;
    }
  }

  if (trunkMatrices.length) {
    const batch = new THREE.InstancedMesh(trunkGeo, trunkMat, trunkMatrices.length);
    trunkMatrices.forEach((m, i) => batch.setMatrixAt(i, m));
    batch.instanceMatrix.needsUpdate = true;
    batch.castShadow = true;
    group.add(batch);
  }
  if (leafMatrices.length) {
    const batch = new THREE.InstancedMesh(leafGeo, leafMat, leafMatrices.length);
    leafMatrices.forEach((m, i) => batch.setMatrixAt(i, m));
    batch.instanceMatrix.needsUpdate = true;
    batch.castShadow = true;
    group.add(batch);
  }
}

function renderRockCards(group, ctx) {
  const { heights, rows, cols, maxH, world, detailSettings } = ctx;
  const cfg = detailSettings?.rockScars || {};
  if (cfg.enabled === false) return;

  const slopeStart = Number(cfg.slopeStartDeg ?? 38);
  const slopeFull = Number(cfg.slopeFullDeg ?? 58);
  const minHm = Number(cfg.minHeightM ?? 40);
  const density = clamp(Number(cfg.density ?? 0.55), 0, 1);
  const seed = Math.round(Number(cfg.seed ?? 31));
  const warmth = clamp(Number(cfg.warmth ?? 0.72), 0, 1);
  const tan = new THREE.Color().setRGB(0.72 + warmth * 0.12, 0.58 + warmth * 0.08, 0.42);
  const mat = new THREE.MeshStandardMaterial({ color: tan, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  const geo = new THREE.PlaneGeometry(1, 1.6);
  const matrices = [];
  const dummy = new THREE.Object3D();
  const spacing = 5;
  let placed = 0;
  const maxCount = 280;

  for (let r = 3; r < rows - 3 && placed < maxCount; r += spacing) {
    for (let c = 3; c < cols - 3 && placed < maxCount; c += spacing) {
      const h = elevationMetersFromNormalized(heightAt(heights, rows, cols, r, c), maxH, world);
      if (h < minHm) continue;
      const slope = slopeAt(heights, rows, cols, r, c, maxH, world);
      if (slope < slopeStart) continue;
      const n = hashNoise(r * 1.3, c * 1.1, seed);
      const slopeFactor = smoothstep(slopeStart, slopeFull, slope);
      if (n > density * (0.55 + slopeFactor * 0.45)) continue;

      const { x, z } = gridToWorld(r, c, rows, cols, world);
      const y = h;
      const scale = 2.5 + n * 5 * slopeFactor;
      dummy.position.set(x, y + scale * 0.4, z);
      dummy.rotation.set(-0.3 - slopeFactor * 0.4, hashNoise(c, r, seed) * Math.PI * 2, 0);
      dummy.scale.set(scale * 0.5, scale, 1);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
      placed += 1;
    }
  }

  if (matrices.length) {
    const batch = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((m, i) => batch.setMatrixAt(i, m));
    batch.instanceMatrix.needsUpdate = true;
    batch.castShadow = false;
    group.add(batch);
  }
}

function resortColors(preset) {
  return RESORT_COLOR_PRESETS[preset] || RESORT_COLOR_PRESETS['resort-light'];
}

function renderResortBuildings(group, ctx) {
  const { heights, rows, cols, maxH, world, detailSettings, layers, masks, skybox } = ctx;
  const cfg = detailSettings?.resort || {};
  if (cfg.enabled === false) return;

  const perComp = Math.max(1, Math.round(Number(cfg.buildingsPerComponent ?? 4)));
  const sizeMin = Number(cfg.sizeMinM ?? 3);
  const sizeMax = Number(cfg.sizeMaxM ?? 8);
  const seed = Math.round(Number(cfg.seed ?? 19));
  const colors = resortColors(cfg.colorPreset);
  const wallMat = new THREE.MeshStandardMaterial({ color: colors.wall, roughness: 0.82, envMap: skybox || null });
  const roofMat = new THREE.MeshStandardMaterial({ color: colors.roof, roughness: 0.78 });

  for (const layer of layers || []) {
    if (layer.kind !== 'structure' || layer.enabled === false || !layer.analysis?.features) continue;
    for (const f of layer.analysis.features.slice(0, 80)) {
      const cx = Number(f.world?.[0] || 0);
      const cz = Number(f.world?.[2] || 0);
      const baseY = terrainHeightAtWorld(heights, rows, cols, maxH, world, cx, cz);
      for (let i = 0; i < perComp; i++) {
        const n = hashNoise(cx + i * 7, cz + i * 11, seed);
        const ang = n * Math.PI * 2;
        const rad = 6 + hashNoise(cx, cz, seed + i) * 18;
        const x = cx + Math.cos(ang) * rad;
        const z = cz + Math.sin(ang) * rad;
        const y = terrainHeightAtWorld(heights, rows, cols, maxH, world, x, z);
        const w = sizeMin + hashNoise(x, z, seed + i) * (sizeMax - sizeMin);
        const h = w * (0.55 + hashNoise(z, x, seed) * 0.35);
        const d = w * (0.7 + hashNoise(x + z, z, seed) * 0.3);
        const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.72, d), wallMat);
        wall.position.set(x, y + h * 0.36, z);
        wall.rotation.y = -ang;
        wall.castShadow = true;
        wall.receiveShadow = true;
        group.add(wall);
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.55, w * 0.58, h * 0.22, 4), roofMat);
        roof.position.set(x, y + h * 0.82, z);
        roof.rotation.y = -ang + Math.PI * 0.25;
        roof.castShadow = true;
        group.add(roof);
      }
    }
  }
}

function renderDocks(group, ctx) {
  const { heights, rows, cols, maxH, world, seaLevelM, detailSettings, layers } = ctx;
  const cfg = detailSettings?.docks || {};
  if (cfg.enabled === false) return;

  const plankW = Number(cfg.plankWidthM ?? 2.2);
  const plankL = Number(cfg.plankLengthM ?? 8);
  const plankH = Number(cfg.heightM ?? 1.2);
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x9a7b55, roughness: 0.9 });

  for (const layer of layers || []) {
    if (layer.kind !== 'dock' || layer.enabled === false) continue;
    const features = layer.analysis?.features || [];
    if (!features.length && layer.url) {
      const { width, depth } = getWorldDims(rows, cols, world);
      const pier = new THREE.Mesh(new THREE.BoxGeometry(plankW, plankH, plankL), woodMat);
      pier.position.set(0, seaLevelM + plankH * 0.5, depth * 0.22);
      pier.castShadow = true;
      group.add(pier);
      continue;
    }
    for (const f of features.slice(0, 40)) {
      const x = Number(f.world?.[0] || 0);
      const z = Number(f.world?.[2] || 0);
      const y = seaLevelM;
      const orient = -THREE.MathUtils.degToRad(Number(f.orientationDeg || layer.orientationDeg || 0));
      const pier = new THREE.Mesh(new THREE.BoxGeometry(plankW, plankH, plankL), woodMat);
      pier.position.set(x, y + plankH * 0.5, z);
      pier.rotation.y = orient;
      pier.castShadow = true;
      group.add(pier);
      const postGeo = new THREE.CylinderGeometry(0.25, 0.3, plankH * 1.8, 6);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(postGeo, woodMat);
        post.position.set(x + Math.cos(orient) * side * plankW * 0.35, y + plankH * 0.4, z + Math.sin(orient) * side * plankW * 0.35);
        group.add(post);
      }
    }
  }
}

function makeLandmarkMesh(type, scale, materials) {
  const s = Math.max(1, scale);
  const group = new THREE.Group();
  if (type === 'windmill') {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.8, s * 1.1, s * 6, 8), materials.marker);
    tower.position.y = s * 3;
    group.add(tower);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(s * 4, s * 0.25, s * 0.4), materials.accent);
    blade.position.y = s * 6.2;
    group.add(blade);
    const blade2 = blade.clone();
    blade2.rotation.y = Math.PI * 0.5;
    group.add(blade2);
  } else if (type === 'tower') {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(s * 1.2, s * 1.5, s * 10, 10), materials.marker);
    tower.position.y = s * 5;
    group.add(tower);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(s * 1.6, s * 2.5, 8), materials.accent);
    cap.position.y = s * 11;
    group.add(cap);
  } else if (type === 'flag') {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.15, s * 0.2, s * 5, 6), materials.marker);
    pole.position.y = s * 2.5;
    group.add(pole);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(s * 2, s * 0.8, s * 0.05), materials.accent);
    flag.position.set(s * 1.1, s * 4.5, 0);
    group.add(flag);
  } else if (type === 'shrine') {
    const base = new THREE.Mesh(new THREE.BoxGeometry(s * 2.5, s * 1.2, s * 2.5), materials.marker);
    base.position.y = s * 0.6;
    group.add(base);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(s * 2, s * 2, 4), materials.accent);
    roof.position.y = s * 2.5;
    roof.rotation.y = Math.PI * 0.25;
    group.add(roof);
  } else {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(s * 1.5, s * 4, 12), materials.marker);
    cone.position.y = s * 2;
    group.add(cone);
  }
  return group;
}

function renderLandmarks(group, ctx) {
  const { heights, rows, cols, maxH, world, detailSettings, layers, skybox } = ctx;
  const cfg = detailSettings?.landmarks || {};
  if (cfg.enabled === false) return;

  const scale = Number(cfg.scale ?? 1);
  const defaultType = cfg.defaultType || 'poi';
  const markerMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc8, roughness: 0.7, envMap: skybox || null });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xc45a3a, roughness: 0.65 });
  const materials = { marker: markerMat, accent: accentMat };

  for (const layer of layers || []) {
    if (layer.kind !== 'marker' || layer.enabled === false || !layer.analysis?.features) continue;
    for (const f of layer.analysis.features.slice(0, 60)) {
      const x = Number(f.world?.[0] || 0);
      const z = Number(f.world?.[2] || 0);
      const y = terrainHeightAtWorld(heights, rows, cols, maxH, world, x, z);
      const type = f.markerType || layer.markerType || defaultType;
      const mesh = makeLandmarkMesh(type, scale * (Number(f.radiusM || layer.radiusM || 4) * 0.35), materials);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      group.add(mesh);
    }
  }
}

/** Apply warm tan rock patches into terrain image (visual only). */
export function applyRockScarsToImageData(imgData, texW, texH, ctx) {
  const { heights, rows, cols, maxH, world, seaLevelM, detailSettings } = ctx;
  const cfg = detailSettings?.rockScars || {};
  if (cfg.enabled === false || !imgData?.data || !heights?.length) return imgData;

  const slopeStart = Number(cfg.slopeStartDeg ?? 38);
  const slopeFull = Number(cfg.slopeFullDeg ?? 58);
  const minHm = Number(cfg.minHeightM ?? 40);
  const density = clamp(Number(cfg.density ?? 0.55), 0, 1);
  const warmth = clamp(Number(cfg.warmth ?? 0.72), 0, 1);
  const seed = Math.round(Number(cfg.seed ?? 31));
  const data = imgData.data;
  const worldMaxH = maxH * getIslandHorizonScale(world);

  for (let ty = 0; ty < texH; ty++) {
    const r = Math.min(rows - 1, Math.round((ty / Math.max(1, texH - 1)) * (rows - 1)));
    for (let tx = 0; tx < texW; tx++) {
      const c = Math.min(cols - 1, Math.round((tx / Math.max(1, texW - 1)) * (cols - 1)));
      const hNorm = heightAt(heights, rows, cols, r, c);
      const hM = hNorm * worldMaxH;
      if (hM < minHm || hM < seaLevelM + 1) continue;
      const slope = slopeAt(heights, rows, cols, r, c, maxH, world);
      if (slope < slopeStart) continue;
      const n = hashNoise(tx * 0.08, ty * 0.08, seed);
      const slopeFactor = smoothstep(slopeStart, slopeFull, slope);
      if (n > density * (0.5 + slopeFactor * 0.5)) continue;
      const p = (ty * texW + tx) * 4;
      if (data[p + 3] < 8) continue;
      const t = slopeFactor * (0.35 + n * 0.45) * warmth;
      const tr = Math.round(198 + warmth * 28);
      const tg = Math.round(168 + warmth * 18);
      const tb = Math.round(118 + warmth * 12);
      data[p] = Math.round(data[p] * (1 - t) + tr * t);
      data[p + 1] = Math.round(data[p + 1] * (1 - t) + tg * t);
      data[p + 2] = Math.round(data[p + 2] * (1 - t) + tb * t);
    }
  }
  return imgData;
}

export function buildNoVegetationMasks(pathMask, waterMask, layers, texW, texH, rows, cols) {
  const structureMask = new Uint8Array(texW * texH);
  const dockMask = new Uint8Array(texW * texH);
  for (const layer of layers || []) {
    if (layer.enabled === false || !layer.analysis?.features) continue;
    if (layer.kind === 'structure' || layer.kind === 'dock') {
      const target = layer.kind === 'dock' ? dockMask : structureMask;
      for (const f of layer.analysis.features) {
        const cx = Number(f.centroidPx?.[0] ?? f.centroid?.[0] ?? cols * 0.5);
        const cy = Number(f.centroidPx?.[1] ?? f.centroid?.[1] ?? rows * 0.5);
        const rad = Math.max(4, Number(f.radiusPx ?? f.radiusM ?? 8) * 2);
        const tx = Math.round((cx / Math.max(1, cols - 1)) * (texW - 1));
        const ty = Math.round((cy / Math.max(1, rows - 1)) * (texH - 1));
        const r = Math.ceil(rad * texW / Math.max(1, cols));
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > r * r) continue;
            const x = tx + dx;
            const y = ty + dy;
            if (x < 0 || y < 0 || x >= texW || y >= texH) continue;
            target[y * texW + x] = 255;
          }
        }
      }
    }
  }
  return { pathMask, waterMask, structureMask, dockMask };
}

export async function renderDetailObjects(s, props, { onMetaUpdate } = {}) {
  if (!s.scene || !s.heights) return;
  if (s.detailGroup) {
    s.scene.remove(s.detailGroup);
    disposeGroup(s.detailGroup);
  }

  const group = new THREE.Group();
  group.name = 'Island detail dressing';

  const ctx = {
    heights: s.heights,
    rows: s.rows,
    cols: s.cols,
    maxH: Number(props.maxHeightM || 500),
    world: props.worldSettings || {},
    seaLevelM: Number(props.seaLevelM || 0),
    detailSettings: props.detailSettings || {},
    layers: props.layers || [],
    masks: {
      ...s.noVegetationMasks,
      riverMask: s.waterOverlayMaskGrid,
      modelPackMask: s.modelPackVegetationMask,
    },
    skybox: s.skybox,
  };

  renderBeachPalms(group, ctx);
  renderRockCards(group, ctx);
  renderResortBuildings(group, ctx);
  renderDocks(group, ctx);
  renderLandmarks(group, ctx);

  const { metaUpdates } = await renderModelPacks(group, props, s);
  if (metaUpdates && onMetaUpdate) onMetaUpdate(metaUpdates);

  s.detailGroup = group;
  if (group.children.length) s.scene.add(group);
}

export { isBlockedByMasks, sampleMaskAt, makeLandDistanceField };
