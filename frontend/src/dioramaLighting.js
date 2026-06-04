/**
 * Shared 3D diorama lighting — texture mount preview + island viewport.
 * Tuned closer to the texture-step demo (softer than the old island defaults).
 */

import * as THREE from 'three';

export const DEFAULT_DIORAMA_LIGHTING = {
  sunIntensity: 1.15,
  sunColor: '#fff4e8',
  hemisphereSky: '#d8f0ff',
  hemisphereGround: '#4a5c42',
  hemisphereIntensity: 0.55,
  ambientColor: '#8eb8d8',
  ambientIntensity: 0.08,
  fillColor: '#c8e4ff',
  fillIntensity: 0.08,
  rimColor: '#ffe8c8',
  rimIntensity: 0.06,
  exposure: 1.12,
  envMapIntensity: 0.32,
  roughness: 0.88,
  normalScale: 0.85,
  fogEnabled: true,
  fogColor: '#9ecae8',
  fogDensity: 0.00002,
};

function hexColor(hex, fallback) {
  try {
    return new THREE.Color(hex || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

function sunDirection() {
  return new THREE.Vector3(0.48, 0.82, 0.38).normalize();
}

/**
 * Create lights for a scene. Returns handles for live updates.
 */
export function createDioramaLighting(scene, config = {}) {
  const L = { ...DEFAULT_DIORAMA_LIGHTING, ...config };
  const sunDir = sunDirection();

  const ambient = new THREE.AmbientLight(
    hexColor(L.ambientColor, '#8eb8d8'),
    Number(L.ambientIntensity ?? 0.08),
  );
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(
    hexColor(L.hemisphereSky, '#d8f0ff'),
    hexColor(L.hemisphereGround, '#4a5c42'),
    Number(L.hemisphereIntensity ?? 0.55),
  );
  hemi.position.set(0, 400, 0);
  scene.add(hemi);

  const fill = new THREE.DirectionalLight(hexColor(L.fillColor, '#c8e4ff'), Number(L.fillIntensity ?? 0.08));
  fill.position.set(-sunDir.x * 900, sunDir.y * 600, -sunDir.z * 900);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(hexColor(L.rimColor, '#ffe8c8'), Number(L.rimIntensity ?? 0.06));
  rim.position.set(sunDir.x * 700, sunDir.y * 500, sunDir.z * 700);
  scene.add(rim);

  const sun = new THREE.DirectionalLight(hexColor(L.sunColor, '#fff4e8'), Number(L.sunIntensity ?? 1.15));
  sun.position.copy(sunDir).multiplyScalar(2400);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.00022;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;
  const cam = sun.shadow.camera;
  cam.near = 40;
  cam.far = 4200;
  cam.left = cam.bottom = -1400;
  cam.right = cam.top = 1400;
  cam.updateProjectionMatrix();
  scene.add(sun);

  return { ambient, hemi, fill, rim, sun, config: L, sunDir };
}

/** Push slider / color changes to existing lights + renderer + land material. */
export function applyDioramaLighting(lights, config = {}, targets = {}) {
  if (!lights) return;
  const L = { ...lights.config, ...config };
  lights.config = L;

  lights.ambient.color.copy(hexColor(L.ambientColor, '#8eb8d8'));
  lights.ambient.intensity = Number(L.ambientIntensity ?? 0.08);

  lights.hemi.color.copy(hexColor(L.hemisphereSky, '#d8f0ff'));
  lights.hemi.groundColor.copy(hexColor(L.hemisphereGround, '#4a5c42'));
  lights.hemi.intensity = Number(L.hemisphereIntensity ?? 0.55);

  lights.fill.color.copy(hexColor(L.fillColor, '#c8e4ff'));
  lights.fill.intensity = Number(L.fillIntensity ?? 0.08);

  lights.rim.color.copy(hexColor(L.rimColor, '#ffe8c8'));
  lights.rim.intensity = Number(L.rimIntensity ?? 0.06);

  lights.sun.color.copy(hexColor(L.sunColor, '#fff4e8'));
  lights.sun.intensity = Number(L.sunIntensity ?? 1.15);

  if (targets.renderer) {
    targets.renderer.toneMappingExposure = Number(L.exposure ?? 1.12);
  }

  const envI = Number(L.envMapIntensity ?? 0.32);
  const rough = Number(L.roughness ?? 0.88);
  const nScale = Number(L.normalScale ?? 0.85);
  const mats = targets.materials || (targets.material ? [targets.material] : []);
  for (const mat of mats) {
    if (!mat) continue;
    if ('envMapIntensity' in mat) mat.envMapIntensity = envI;
    if ('roughness' in mat) mat.roughness = rough;
    if (mat.normalScale) mat.normalScale.set(nScale, nScale);
    mat.needsUpdate = true;
  }

  if (targets.scene) {
    if (L.fogEnabled === false) {
      targets.scene.fog = null;
    } else {
      const color = hexColor(L.fogColor, '#9ecae8');
      const density = Number(L.fogDensity ?? 0.00002);
      if (targets.scene.fog?.isFogExp2) {
        targets.scene.fog.color.copy(color);
        targets.scene.fog.density = density;
      } else {
        targets.scene.fog = new THREE.FogExp2(color, density);
      }
    }
  }
}

export function dioramaLightingFromSettings(textureSettings = {}) {
  return { ...DEFAULT_DIORAMA_LIGHTING, ...(textureSettings.dioramaLighting || {}) };
}
