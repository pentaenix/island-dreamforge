import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  applyDioramaLighting,
  createDioramaLighting,
  dioramaLightingFromSettings,
} from './dioramaLighting.js';
import {
  DEMO_MOUNT_WORLD,
  buildDemoMountGeometry,
  buildSyntheticMountField,
  imageDataToCanvasTexture,
  paintDemoMountTextures,
} from './proceduralTerrainTexture.js';
import { textureNormsFromSettings } from './textureNorms.js';

const MOUNT_GRID = 80;
const TEX_SIZE = 640;

const VIEW_PRESETS = {
  overview: { pos: [320, 185, 380], target: [0, 55, 0], label: 'Overview' },
  shore: { pos: [200, 28, 130], target: [120, 12, 45], label: 'Shore' },
  flats: { pos: [-130, 55, 160], target: [-45, 38, 55], label: 'Flats' },
  ridge: { pos: [-95, 125, 140], target: [0, 115, 0], label: 'Ridge' },
};

function disposeTexture(tex) {
  if (tex) tex.dispose();
}

function applyView(controls, camera, key) {
  const view = VIEW_PRESETS[key] || VIEW_PRESETS.overview;
  camera.position.set(...view.pos);
  controls.target.set(...view.target);
  controls.update();
}

export default function TextureMountPreview({ settings, maxHeightM, seaLevelM }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const applyTexturesRef = useRef(null);
  const activeViewRef = useRef('overview');
  const mountField = useMemo(() => buildSyntheticMountField(MOUNT_GRID, MOUNT_GRID), []);
  const world = useMemo(
    () => ({ maxHeightM: maxHeightM ?? settings?.maxHeightM ?? DEMO_MOUNT_WORLD.maxHeightM, seaLevelM: seaLevelM ?? settings?.seaLevelM ?? 0 }),
    [maxHeightM, seaLevelM, settings?.maxHeightM, settings?.seaLevelM],
  );
  const settingsKey = useMemo(() => JSON.stringify({ settings, world }), [settings, world]);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return undefined;

    let cancelled = false;
    const norms = textureNormsFromSettings(settings ?? {}, world);
    const seaY = norms.seaNorm * norms.maxHeightM;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87bfe8);
    scene.fog = new THREE.Fog(0x9ecae8, 280, 920);

    const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = Number(dioramaLightingFromSettings(settings || {}).exposure ?? 1.12);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 40;
    controls.maxDistance = 520;
    applyView(controls, camera, activeViewRef.current);

    const dioramaLights = createDioramaLighting(scene, dioramaLightingFromSettings(settings || {}));

    const water = new THREE.Mesh(
      new THREE.CircleGeometry(320, 72),
      new THREE.MeshStandardMaterial({
        color: 0x0d5a82,
        roughness: 0.12,
        metalness: 0.08,
        transparent: true,
        opacity: 0.9,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = seaY - 0.4;
    water.receiveShadow = true;
    scene.add(water);

    let landMesh = null;

    const applyTextures = (settingsNext) => {
      if (cancelled) return;
      const L = dioramaLightingFromSettings(settingsNext || {});
      const painted = paintDemoMountTextures(settingsNext, mountField, TEX_SIZE, world);
      const nextAlbedo = imageDataToCanvasTexture(painted.color, { color: true });
      const nextNormal = imageDataToCanvasTexture(painted.normal, { color: false });

      if (landMesh) {
        disposeTexture(landMesh.material.map);
        disposeTexture(landMesh.material.normalMap);
        landMesh.material.map = nextAlbedo;
        landMesh.material.normalMap = nextNormal;
        landMesh.material.transparent = true;
        landMesh.material.alphaTest = 0.35;
        landMesh.material.normalScale.set(L.normalScale, L.normalScale);
        landMesh.material.roughness = L.roughness;
        landMesh.material.needsUpdate = true;
      } else {
        const geometry = buildDemoMountGeometry(mountField);
        landMesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            map: nextAlbedo,
            normalMap: nextNormal,
            normalScale: new THREE.Vector2(L.normalScale, L.normalScale),
            roughness: L.roughness,
            metalness: 0.02,
            envMapIntensity: 0,
            transparent: true,
            alphaTest: 0.35,
            depthWrite: true,
            side: THREE.DoubleSide,
          }),
        );
        landMesh.castShadow = true;
        landMesh.receiveShadow = true;
        scene.add(landMesh);
      }
    };

    applyTexturesRef.current = applyTextures;
    applyTextures(settings || {});
    sceneRef.current = { controls, camera, renderer, scene, dioramaLights, landMesh: () => landMesh };

    if (landMesh) {
      const box = new THREE.Box3().setFromObject(landMesh);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z) * 0.55;
      camera.position.set(center.x + radius * 1.1, center.y + radius * 0.85, center.z + radius * 1.15);
      controls.target.copy(center);
      controls.update();
    }

    const resize = () => {
      const w = el.clientWidth;
      const h = Math.max(1, el.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let frameId = 0;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelled = true;
      applyTexturesRef.current = null;
      cancelAnimationFrame(frameId);
      ro.disconnect();
      if (landMesh) {
        disposeTexture(landMesh.material.map);
        disposeTexture(landMesh.material.normalMap);
        landMesh.geometry.dispose();
        landMesh.material.dispose();
      }
      water.geometry.dispose();
      water.material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, [mountField]);

  useEffect(() => {
    const timer = setTimeout(() => {
      applyTexturesRef.current?.(settings || {});
      const sc = sceneRef.current;
      if (sc?.dioramaLights) {
        const L = dioramaLightingFromSettings(settings || {});
        applyDioramaLighting(sc.dioramaLights, L, {
          renderer: sc.renderer,
          scene: sc.scene,
          material: sc.landMesh?.()?.material,
        });
        if (sc.renderer) sc.renderer.toneMappingExposure = Number(L.exposure ?? 1.12);
      }
    }, 48);
    return () => clearTimeout(timer);
  }, [settingsKey, settings]);

  const setView = (key) => {
    activeViewRef.current = key;
    const s = sceneRef.current;
    if (s?.controls && s?.camera) applyView(s.controls, s.camera, key);
  };

  return (
    <div className="texture-mount-preview">
      <div className="texture-mount-canvas-wrap" ref={mountRef} aria-label="3D demo mount texture preview" />
      <div className="texture-mount-toolbar">
        {Object.entries(VIEW_PRESETS).map(([key, view]) => (
          <button
            key={key}
            type="button"
            className="texture-mount-view-btn"
            onClick={() => setView(key)}
          >
            {view.label}
          </button>
        ))}
      </div>
      <ul className="texture-mount-legend small muted">
        <li><b>Shore</b> — wet sand and beach band at the water line</li>
        <li><b>Flats</b> — grass tiling on gentle, low-relief ground</li>
        <li><b>Ridge</b> — forest blocks, rock from slope, gravel pockets</li>
      </ul>
      <p className="texture-mount-caption small muted">
        Drag to orbit · curved demo mount, not your island heightmap
      </p>
    </div>
  );
}
