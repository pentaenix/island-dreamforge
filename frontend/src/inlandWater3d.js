/**
 * Inland river/lake water surface — optional planar reflection inherited from ocean settings.
 */

import * as THREE from 'three';
import { isWaterReflectionEnabled } from './waterFoamReflection.js';

const InlandWaterShader = {
  uniforms: {
    tDiffuse: { value: null },
    textureMatrix: { value: new THREE.Matrix4() },
    riverMask: { value: null },
    waterColor: { value: new THREE.Color(0.28, 0.62, 0.82) },
    reflectionStrength: { value: 0.28 },
    tintStrength: { value: 0.22 },
    tintColor: { value: new THREE.Color(0.82, 0.94, 1.0) },
    surfaceAlpha: { value: 0.55 },
  },
  vertexShader: /* glsl */ `
    varying vec4 vReflectUv;
    varying vec2 vMaskUv;
    void main() {
      vMaskUv = uv;
      vReflectUv = textureMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D riverMask;
    uniform vec3 waterColor;
    uniform float reflectionStrength;
    uniform float tintStrength;
    uniform vec3 tintColor;
    uniform float surfaceAlpha;
    varying vec4 vReflectUv;
    varying vec2 vMaskUv;
    void main() {
      float wet = texture2D(riverMask, vMaskUv).r;
      if (wet < 0.06) discard;
      vec3 base = waterColor;
      vec3 col = base;
      if (reflectionStrength > 0.01) {
        vec2 uv = vReflectUv.xy / max(vReflectUv.w, 1e-5);
        vec3 refl = texture2D(tDiffuse, uv).rgb;
        refl = mix(refl, refl * tintColor, clamp(tintStrength, 0.0, 1.0));
        col = mix(base, refl, reflectionStrength * wet);
      }
      gl_FragColor = vec4(col, surfaceAlpha * wet);
    }
  `,
};

function attachInlandReflectionPass(scope, renderTarget, textureMatrix, camera) {
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

    textureMatrix.set(0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 1.0);
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

    const hideGroup = scope.parent?.userData?.isInlandWater ? scope.parent : null;
    const oceanGroup = scope.parent?.parent?.children?.find?.((c) => c.userData?.isOcean);
    const wasHidden = hideGroup ? hideGroup.visible : true;
    const oceanWasVisible = oceanGroup ? oceanGroup.visible : true;
    scope.visible = false;
    if (hideGroup) hideGroup.visible = false;
    if (oceanGroup) oceanGroup.visible = false;

    const currentRenderTarget = renderer.getRenderTarget();
    const currentXrEnabled = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(renderTarget);
    if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, camera);
    renderer.xr.enabled = currentXrEnabled;
    renderer.setRenderTarget(currentRenderTarget);

    if (hideGroup) hideGroup.visible = wasHidden;
    if (oceanGroup) oceanGroup.visible = oceanWasVisible;
    scope.visible = true;
  };
}

export function createInlandWaterSurface(mapWidthM, mapDepthM, riverMaskTexture, ocean = {}, useReflection = false) {
  if (!riverMaskTexture) return null;

  const group = new THREE.Group();
  group.name = 'inland-water-surface';
  group.userData.isInlandWater = true;

  const geometry = new THREE.PlaneGeometry(mapWidthM, mapDepthM, 1, 1);
  const strength = Number(ocean.waterReflectionStrength ?? 0.38) * 0.65;
  const reflectionActive = useReflection && isWaterReflectionEnabled(ocean);

  if (reflectionActive) {
    const camera = new THREE.PerspectiveCamera();
    const resolution = Math.max(256, Math.min(512, Math.round(Number(ocean.waterReflectionResolution ?? 512) * 0.75)));
    const renderTarget = new THREE.WebGLRenderTarget(resolution, resolution, {
      samples: 0,
      type: THREE.HalfFloatType,
    });
    const textureMatrix = new THREE.Matrix4();
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(InlandWaterShader.uniforms),
      vertexShader: InlandWaterShader.vertexShader,
      fragmentShader: InlandWaterShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    material.uniforms.tDiffuse.value = renderTarget.texture;
    material.uniforms.textureMatrix.value = textureMatrix;
    material.uniforms.riverMask.value = riverMaskTexture;
    material.uniforms.reflectionStrength.value = strength;
    material.uniforms.tintStrength.value = Number(ocean.waterReflectionTint ?? 0.22);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 4;
    mesh.name = 'inland-water-reflect';
    mesh.userData.isInlandWaterReflection = true;
    attachInlandReflectionPass(mesh, renderTarget, textureMatrix, camera);
    mesh.userData.disposeInlandWater = () => {
      renderTarget.dispose();
      riverMaskTexture?.dispose?.();
      material.dispose();
    };
    group.add(mesh);
  } else {
    const material = new THREE.MeshBasicMaterial({
      color: 0x52b8d6,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      alphaMap: riverMaskTexture,
      alphaTest: 0.08,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 4;
    mesh.name = 'inland-water-basic';
    mesh.userData.disposeInlandWater = () => {
      riverMaskTexture?.dispose?.();
      material.dispose();
    };
    group.add(mesh);
  }

  geometry.userData = { shared: true };
  return group;
}

export function disposeInlandWater(group) {
  if (!group) return;
  group.traverse((child) => {
    if (child.userData?.disposeInlandWater) child.userData.disposeInlandWater();
    else if (child.isMesh) {
      child.material?.dispose?.();
      if (!child.geometry?.userData?.shared) child.geometry?.dispose?.();
    }
  });
}
