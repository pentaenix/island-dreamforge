/**
 * Circular planar reflection disc (viewport only — not exported).
 * Sits just above the foam layer; matches the ocean circle silhouette.
 */

import * as THREE from 'three';

const OceanReflectionShader = {
  name: 'OceanReflectionShader',
  uniforms: {
    tDiffuse: { value: null },
    textureMatrix: { value: new THREE.Matrix4() },
    wetMask: { value: null },
    wetMaskEnabled: { value: 0 },
    reflectionStrength: { value: 0.38 },
    distortionStrength: { value: 0.2 },
    distortionScale: { value: 85 },
    tintColor: { value: new THREE.Color(0.82, 0.94, 1.0) },
    tintStrength: { value: 0.22 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vReflectUv;
    varying vec2 vDiscUv;
    varying vec3 vWorldPos;

    void main() {
      vDiscUv = uv;
      vReflectUv = textureMatrix * vec4(position, 1.0);
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D wetMask;
    uniform float wetMaskEnabled;
    uniform float reflectionStrength;
    uniform float distortionStrength;
    uniform float distortionScale;
    uniform vec3 tintColor;
    uniform float tintStrength;
    varying vec4 vReflectUv;
    varying vec2 vDiscUv;
    varying vec3 vWorldPos;

    void main() {
      float wet = 1.0;
      if (wetMaskEnabled > 0.5) {
        wet = texture2D(wetMask, vDiscUv).r;
        if (wet < 0.04) discard;
      }

      vec2 uv = vReflectUv.xy / max(vReflectUv.w, 1e-5);
      float d = distortionStrength;
      if (d > 0.001) {
        float s = max(8.0, distortionScale);
        uv.x += sin(vWorldPos.x / s * 6.283 + vWorldPos.z / s * 3.17) * d * 0.014;
        uv.y += cos(vWorldPos.z / s * 5.77 + vWorldPos.x / s * 2.41) * d * 0.014;
      }
      vec3 refl = texture2D(tDiffuse, uv).rgb;
      refl = mix(refl, refl * tintColor, clamp(tintStrength, 0.0, 1.0));
      float alpha = reflectionStrength * 0.72 * wet;
      if (alpha < 0.01) discard;
      gl_FragColor = vec4(refl * reflectionStrength, alpha);
    }
  `,
};

function reflectionOptionsFromOcean(ocean = {}) {
  return {
    strength: Math.max(0, Math.min(1, Number(ocean.waterReflectionStrength ?? 0.38))),
    distortion: Math.max(0, Math.min(1, Number(ocean.waterReflectionDistortion ?? 0.2))),
    distortionScale: Math.max(8, Number(ocean.waterReflectionDistortionScale ?? ocean.waterNoiseScaleM ?? 85)),
    tintStrength: Math.max(0, Math.min(1, Number(ocean.waterReflectionTint ?? 0.22))),
    resolution: Math.max(256, Math.min(1024, Math.round(Number(ocean.waterReflectionResolution ?? 512)))),
  };
}

function attachReflectionRenderPass(scope, renderTarget, textureMatrix, camera) {
  const reflectorPlane = new THREE.Plane();
  const normal = new THREE.Vector3();
  const reflectorWorldPosition = new THREE.Vector3();
  const cameraWorldPosition = new THREE.Vector3();
  const rotationMatrix = new THREE.Matrix4();
  const lookAtPosition = new THREE.Vector3(0, 0, -1);
  const clipPlane = new THREE.Vector4();
  const view = new THREE.Vector3();
  const target = new THREE.Vector3();
  const q = new THREE.Vector4();
  const clipBias = 0.003;

  scope.onBeforeRender = function onBeforeRender(renderer, scene, activeCamera) {
    reflectorWorldPosition.setFromMatrixPosition(scope.matrixWorld);
    cameraWorldPosition.setFromMatrixPosition(activeCamera.matrixWorld);
    rotationMatrix.extractRotation(scope.matrixWorld);

    normal.set(0, 0, 1);
    normal.applyMatrix4(rotationMatrix);
    view.subVectors(reflectorWorldPosition, cameraWorldPosition);
    if (view.dot(normal) > 0) return;

    view.reflect(normal).negate();
    view.add(reflectorWorldPosition);
    rotationMatrix.extractRotation(activeCamera.matrixWorld);
    lookAtPosition.set(0, 0, -1);
    lookAtPosition.applyMatrix4(rotationMatrix);
    lookAtPosition.add(cameraWorldPosition);
    target.subVectors(reflectorWorldPosition, lookAtPosition);
    target.reflect(normal).negate();
    target.add(reflectorWorldPosition);

    camera.position.copy(view);
    camera.up.set(0, 1, 0);
    camera.up.applyMatrix4(rotationMatrix);
    camera.up.reflect(normal);
    camera.lookAt(target);
    camera.far = activeCamera.far;
    camera.updateMatrixWorld();
    camera.projectionMatrix.copy(activeCamera.projectionMatrix);

    textureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0,
    );
    textureMatrix.multiply(camera.projectionMatrix);
    textureMatrix.multiply(camera.matrixWorldInverse);
    textureMatrix.multiply(scope.matrixWorld);

    reflectorPlane.setFromNormalAndCoplanarPoint(normal, reflectorWorldPosition);
    reflectorPlane.applyMatrix4(camera.matrixWorldInverse);
    clipPlane.set(reflectorPlane.normal.x, reflectorPlane.normal.y, reflectorPlane.normal.z, reflectorPlane.constant);
    const projectionMatrix = camera.projectionMatrix;
    q.x = (Math.sign(clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
    q.y = (Math.sign(clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
    q.z = -1.0;
    q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];
    clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));
    projectionMatrix.elements[2] = clipPlane.x;
    projectionMatrix.elements[6] = clipPlane.y;
    projectionMatrix.elements[10] = clipPlane.z + 1.0 - clipBias;
    projectionMatrix.elements[14] = clipPlane.w;

    const oceanGroup = scope.parent?.userData?.isOcean ? scope.parent : null;
    const oceanWasVisible = oceanGroup ? oceanGroup.visible : true;
    scope.visible = false;
    if (oceanGroup) oceanGroup.visible = false;

    const currentRenderTarget = renderer.getRenderTarget();
    const currentXrEnabled = renderer.xr.enabled;
    const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(renderTarget);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, camera);
    renderer.xr.enabled = currentXrEnabled;
    renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;
    renderer.setRenderTarget(currentRenderTarget);

    const viewport = activeCamera.viewport;
    if (viewport !== undefined) renderer.state.viewport(viewport);

    if (oceanGroup) oceanGroup.visible = oceanWasVisible;
    scope.visible = true;
  };
}

/**
 * Circular reflection-only disc — duplicate of the deep ocean circle, no albedo.
 */
export function createOceanReflectionDiscMesh(discRadius, ocean = {}, wetMaskTexture = null) {
  const opts = reflectionOptionsFromOcean(ocean);
  const geometry = new THREE.CircleGeometry(Math.max(50, discRadius), 128);
  const scope = new THREE.Mesh(geometry);
  scope.name = 'ocean-reflection-disc';
  scope.userData.isOceanReflection = true;

  const camera = new THREE.PerspectiveCamera();
  const renderTarget = new THREE.WebGLRenderTarget(opts.resolution, opts.resolution, {
    samples: 0,
    type: THREE.HalfFloatType,
  });
  const textureMatrix = new THREE.Matrix4();

  const material = new THREE.ShaderMaterial({
    name: 'OceanReflectionShader',
    uniforms: THREE.UniformsUtils.clone(OceanReflectionShader.uniforms),
    vertexShader: OceanReflectionShader.vertexShader,
    fragmentShader: OceanReflectionShader.fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -5,
  });
  material.uniforms.tDiffuse.value = renderTarget.texture;
  material.uniforms.textureMatrix.value = textureMatrix;
  material.uniforms.wetMask.value = wetMaskTexture;
  material.uniforms.wetMaskEnabled.value = wetMaskTexture ? 1 : 0;
  material.uniforms.reflectionStrength.value = opts.strength;
  material.uniforms.distortionStrength.value = opts.distortion;
  material.uniforms.distortionScale.value = opts.distortionScale;
  material.uniforms.tintStrength.value = opts.tintStrength;

  scope.material = material;
  attachReflectionRenderPass(scope, renderTarget, textureMatrix, camera);

  scope.userData.disposeReflection = () => {
    renderTarget.dispose();
    wetMaskTexture?.dispose?.();
    material.dispose();
  };

  return scope;
}

export function isWaterReflectionEnabled(ocean = {}) {
  return ocean.waterReflectionEnabled === true;
}

export function updateOceanReflectionUniforms(mesh, ocean = {}) {
  if (!mesh?.userData?.isOceanReflection || !mesh.material?.uniforms) return;
  const opts = reflectionOptionsFromOcean(ocean);
  const u = mesh.material.uniforms;
  u.reflectionStrength.value = opts.strength;
  u.distortionStrength.value = opts.distortion;
  u.distortionScale.value = opts.distortionScale;
  u.tintStrength.value = opts.tintStrength;
}

// Back-compat alias used by TerrainViewport
export const updateFoamReflectionUniforms = updateOceanReflectionUniforms;
