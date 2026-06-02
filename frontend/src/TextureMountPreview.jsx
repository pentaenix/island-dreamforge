import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  DEMO_MOUNT_WORLD,
  buildDemoMountGeometry,
  buildSyntheticMountField,
  imageDataToCanvasTexture,
  paintDemoMountTextures,
} from './proceduralTerrainTexture.js';

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

export default function TextureMountPreview({ settings }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const applyTexturesRef = useRef(null);
  const activeViewRef = useRef('overview');
  const mountField = useMemo(() => buildSyntheticMountField(MOUNT_GRID, MOUNT_GRID), []);
  const settingsKey = useMemo(() => JSON.stringify(settings ?? {}), [settings]);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return undefined;

    let cancelled = false;
    const { maxHeightM } = DEMO_MOUNT_WORLD;
    const seaY = mountField.seaNorm * maxHeightM;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87bfe8);
    scene.fog = new THREE.Fog(0x9ecae8, 280, 920);

    const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
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

    scene.add(new THREE.HemisphereLight(0xd8f0ff, 0x4a5c42, 0.55));
    const sun = new THREE.DirectionalLight(0xfff4e8, 1.15);
    sun.position.set(180, 320, 120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 40;
    sun.shadow.camera.far = 700;
    sun.shadow.camera.left = -220;
    sun.shadow.camera.right = 220;
    sun.shadow.camera.top = 220;
    sun.shadow.camera.bottom = -220;
    scene.add(sun);

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
      const painted = paintDemoMountTextures(settingsNext, mountField, TEX_SIZE);
      const nextAlbedo = imageDataToCanvasTexture(painted.color, { color: true });
      const nextNormal = imageDataToCanvasTexture(painted.normal, { color: false });

      if (landMesh) {
        disposeTexture(landMesh.material.map);
        disposeTexture(landMesh.material.normalMap);
        landMesh.material.map = nextAlbedo;
        landMesh.material.normalMap = nextNormal;
        landMesh.material.transparent = true;
        landMesh.material.alphaTest = 0.35;
        landMesh.material.needsUpdate = true;
      } else {
        const geometry = buildDemoMountGeometry(mountField);
        landMesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            map: nextAlbedo,
            normalMap: nextNormal,
            normalScale: new THREE.Vector2(0.85, 0.85),
            roughness: 0.88,
            metalness: 0.02,
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

    sceneRef.current = { controls, camera, renderer };

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
