import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const textureUrls = {
  sand: new URL('./assets/textures/sand.png', import.meta.url).href,
  grass: new URL('./assets/textures/grass.png', import.meta.url).href,
  forest: new URL('./assets/textures/forest.png', import.meta.url).href,
  rock: new URL('./assets/textures/rock.png', import.meta.url).href,
  dirt: new URL('./assets/textures/dirt.png', import.meta.url).href,
  wet_sand: new URL('./assets/textures/wet_sand.png', import.meta.url).href,
};

export const MATERIALS = [
  { id: 'sand', label: 'Sand' },
  { id: 'wet_sand', label: 'Wet Sand' },
  { id: 'grass', label: 'Grass' },
  { id: 'forest', label: 'Forest' },
  { id: 'rock', label: 'Cliff Rock' },
  { id: 'dirt', label: 'Dirt Path' },
];

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve) => canvas.toBlob(resolve, type));
}

const TerrainViewport = forwardRef(function TerrainViewport({
  heightUrl,
  maxHeightM,
  tool,
  brush,
  selectedMaterial,
  waterSettings,
}, ref) {
  const mountRef = useRef(null);
  const stateRef = useRef({
    rows: 0,
    cols: 0,
    heights: null,
    geometry: null,
    mesh: null,
    renderer: null,
    camera: null,
    scene: null,
    controls: null,
    textureCanvas: null,
    textureContext: null,
    texture: null,
    patterns: {},
    isPainting: false,
    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2(),
    water: null,
    waterBase: null,
  });

  useImperativeHandle(ref, () => ({
    async getHeightmapBlob() {
      const s = stateRef.current;
      if (!s.heights) return null;
      const canvas = document.createElement('canvas');
      canvas.width = s.cols;
      canvas.height = s.rows;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(s.cols, s.rows);
      for (let i = 0; i < s.heights.length; i++) {
        const v = Math.round(clamp(s.heights[i], 0, 1) * 255);
        img.data[i * 4 + 0] = v;
        img.data[i * 4 + 1] = v;
        img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return await canvasToBlob(canvas);
    },
    async getTextureBlob() {
      const s = stateRef.current;
      if (!s.textureCanvas) return null;
      return await canvasToBlob(s.textureCanvas);
    },
    autoTexture() {
      const s = stateRef.current;
      if (s.heights && s.textureContext) paintAutoTexture(s);
    },
    resetCamera() {
      const s = stateRef.current;
      if (!s.camera || !s.controls) return;
      s.camera.position.set(720, 580, 950);
      s.controls.target.set(0, 120, 0);
      s.controls.update();
    },
  }));

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const mount = mountRef.current;
      if (!mount) return;
      mount.innerHTML = '';
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x86d7ff);
      scene.fog = new THREE.Fog(0x9edcff, 1800, 4200);

      const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / Math.max(1, mount.clientHeight), 0.5, 10000);
      camera.position.set(720, 580, 950);

      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.shadowMap.enabled = true;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      mount.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.target.set(0, 120, 0);
      controls.maxPolarAngle = Math.PI * 0.49;
      controls.update();

      const hemi = new THREE.HemisphereLight(0xf8ffff, 0x4b6540, 1.8);
      scene.add(hemi);
      const sun = new THREE.DirectionalLight(0xffffff, 2.4);
      sun.position.set(-700, 900, 500);
      sun.castShadow = true;
      sun.shadow.mapSize.width = 2048;
      sun.shadow.mapSize.height = 2048;
      scene.add(sun);

      const s = stateRef.current;
      Object.assign(s, { scene, camera, renderer, controls });

      for (const [key, url] of Object.entries(textureUrls)) {
        try {
          s.patterns[key] = await loadImage(url);
        } catch (e) {
          console.warn('Texture failed', key, e);
        }
      }

      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('resize', resize);

      function resize() {
        if (!mount || !renderer || !camera) return;
        camera.aspect = mount.clientWidth / Math.max(1, mount.clientHeight);
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight);
      }

      function animate(t) {
        if (cancelled) return;
        requestAnimationFrame(animate);
        controls.update();
        animateWater(s, t * 0.001);
        renderer.render(scene, camera);
      }
      animate(0);
    }
    boot();
    return () => {
      cancelled = true;
      const s = stateRef.current;
      if (s.renderer?.domElement) {
        s.renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        s.renderer.domElement.removeEventListener('pointermove', onPointerMove);
      }
      window.removeEventListener('pointerup', onPointerUp);
      if (s.renderer) s.renderer.dispose();
    };
  }, []);

  useEffect(() => {
    if (!heightUrl) return;
    rebuildTerrain(heightUrl);
  }, [heightUrl, maxHeightM]);

  useEffect(() => {
    const s = stateRef.current;
    if (s.water) {
      s.water.position.y = Number(waterSettings?.seaLevelM || 0);
      s.water.material.opacity = Number(waterSettings?.opacity || 0.62);
      s.water.material.color = new THREE.Color(waterSettings?.color || '#2db7d9');
      s.water.material.roughness = Number(waterSettings?.roughness || 0.12);
    }
  }, [waterSettings]);

  async function rebuildTerrain(src) {
    const s = stateRef.current;
    if (!s.scene) return;
    const img = await loadImage(src);
    const maxGrid = 260;
    const ratio = img.width / img.height;
    let cols = maxGrid;
    let rows = Math.max(16, Math.round(maxGrid / ratio));
    if (rows > maxGrid) { rows = maxGrid; cols = Math.max(16, Math.round(maxGrid * ratio)); }
    const c = document.createElement('canvas');
    c.width = cols;
    c.height = rows;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cols, rows);
    const data = ctx.getImageData(0, 0, cols, rows).data;
    const heights = new Float32Array(rows * cols);
    for (let i = 0; i < heights.length; i++) heights[i] = data[i * 4] / 255;

    if (s.mesh) {
      s.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
    }
    if (s.water) {
      s.scene.remove(s.water);
      s.water.geometry.dispose();
      s.water.material.dispose();
    }
    s.rows = rows; s.cols = cols; s.heights = heights;
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = 1024;
    textureCanvas.height = 1024;
    const textureContext = textureCanvas.getContext('2d');
    s.textureCanvas = textureCanvas;
    s.textureContext = textureContext;
    paintAutoTexture(s);
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    s.texture = texture;

    const geometry = makeGeometry(heights, rows, cols, Number(maxHeightM || 500));
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.82, metalness: 0.0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    s.geometry = geometry;
    s.mesh = mesh;
    s.scene.add(mesh);

    const water = makeWaterPlane(Number(waterSettings?.seaLevelM || 0), waterSettings);
    s.water = water;
    s.waterBase = Float32Array.from(water.geometry.attributes.position.array);
    s.scene.add(water);
  }

  function makeGeometry(heights, rows, cols, maxH) {
    const width = 1480;
    const depth = width * rows / cols;
    const vertices = new Float32Array(rows * cols * 3);
    const uvs = new Float32Array(rows * cols * 2);
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const i = r * cols + col;
        vertices[i * 3 + 0] = (col / (cols - 1) - 0.5) * width;
        vertices[i * 3 + 1] = heights[i] * maxH;
        vertices[i * 3 + 2] = (r / (rows - 1) - 0.5) * depth;
        uvs[i * 2 + 0] = col / (cols - 1);
        uvs[i * 2 + 1] = 1 - r / (rows - 1);
      }
    }
    const indices = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let col = 0; col < cols - 1; col++) {
        const a = r * cols + col;
        const b = a + 1;
        const c = (r + 1) * cols + col;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function paintAutoTexture(s) {
    const ctx = s.textureContext;
    const canvas = s.textureCanvas;
    if (!ctx || !canvas) return;
    const size = canvas.width;
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const r = Math.floor((y / size) * s.rows);
        const col = Math.floor((x / size) * s.cols);
        const h = s.heights?.[clamp(r, 0, s.rows - 1) * s.cols + clamp(col, 0, s.cols - 1)] || 0;
        let color;
        if (h < 0.035) color = [217, 196, 146];
        else if (h < 0.08) color = [126, 162, 78];
        else if (h > 0.72) color = [51, 91, 47];
        else color = [55, 127, 57];
        const p = (y * size + x) * 4;
        img.data[p] = color[0]; img.data[p + 1] = color[1]; img.data[p + 2] = color[2]; img.data[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Rocky streaks on steep-ish areas, very light by default.
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = '#827866';
    for (let i = 0; i < 280; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      ctx.fillRect(x, y, Math.random() * 18 + 4, 1);
    }
    ctx.globalAlpha = 1;
    if (s.texture) s.texture.needsUpdate = true;
  }

  function makeWaterPlane(seaLevel, settings = {}) {
    const geo = new THREE.PlaneGeometry(2600, 1900, 96, 96);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(settings?.color || '#2db7d9'),
      transparent: true,
      opacity: Number(settings?.opacity || 0.62),
      roughness: Number(settings?.roughness || 0.12),
      metalness: 0.0,
      transmission: 0.15,
      reflectivity: 0.75,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      side: THREE.DoubleSide,
    });
    const water = new THREE.Mesh(geo, mat);
    water.position.y = seaLevel;
    water.receiveShadow = true;
    return water;
  }

  function animateWater(s, time) {
    if (!s.water || !s.waterBase) return;
    const arr = s.water.geometry.attributes.position.array;
    const base = s.waterBase;
    const amp = Number(waterSettings?.waveHeight || 1.8);
    const speed = Number(waterSettings?.waveSpeed || 0.55);
    for (let i = 0; i < arr.length; i += 3) {
      const x = base[i];
      const z = base[i + 2];
      arr[i + 1] = base[i + 1] + Math.sin(x * 0.018 + time * speed * 2.5) * amp + Math.cos(z * 0.015 + time * speed * 1.7) * amp * 0.55;
    }
    s.water.geometry.attributes.position.needsUpdate = true;
    s.water.geometry.computeVertexNormals();
  }

  function canvasPosition(ev) {
    const s = stateRef.current;
    const rect = s.renderer.domElement.getBoundingClientRect();
    s.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    s.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function onPointerDown(ev) {
    const s = stateRef.current;
    if (!s.mesh || ev.button !== 0) return;
    s.isPainting = true;
    applyBrush(ev);
  }

  function onPointerMove(ev) {
    const s = stateRef.current;
    if (!s.isPainting) return;
    applyBrush(ev);
  }

  function onPointerUp() {
    stateRef.current.isPainting = false;
  }

  function applyBrush(ev) {
    const s = stateRef.current;
    if (!s.mesh || !s.camera || !s.renderer) return;
    canvasPosition(ev);
    s.raycaster.setFromCamera(s.pointer, s.camera);
    const hit = s.raycaster.intersectObject(s.mesh)[0];
    if (!hit?.uv) return;
    const u = clamp(hit.uv.x, 0, 1);
    const v = clamp(hit.uv.y, 0, 1);
    if (tool === 'paint') {
      paintTextureAt(s, u, v);
      return;
    }
    sculptAt(s, u, v);
  }

  function paintTextureAt(s, u, v) {
    const ctx = s.textureContext;
    const canvas = s.textureCanvas;
    const img = s.patterns[selectedMaterial || 'forest'];
    const radius = Number(brush?.size || 40);
    const opacity = Number(brush?.opacity || 0.85);
    const x = u * canvas.width;
    const y = (1 - v) * canvas.height;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();
    if (img) {
      const pattern = ctx.createPattern(img, 'repeat');
      ctx.fillStyle = pattern;
    } else {
      ctx.fillStyle = '#276c35';
    }
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
    s.texture.needsUpdate = true;
  }

  function sculptAt(s, u, v) {
    const rows = s.rows, cols = s.cols;
    const col = Math.round(u * (cols - 1));
    const r = Math.round((1 - v) * (rows - 1));
    const sizePx = Number(brush?.size || 28) / 1024 * Math.max(rows, cols);
    const strength = Number(brush?.strength || 0.45) * 0.018;
    const maxH = Number(maxHeightM || 500);
    const target = Number(brush?.flattenM || 10) / maxH;
    const radius = Math.max(1, sizePx);
    const r0 = Math.max(0, Math.floor(r - radius));
    const r1 = Math.min(rows - 1, Math.ceil(r + radius));
    const c0 = Math.max(0, Math.floor(col - radius));
    const c1 = Math.min(cols - 1, Math.ceil(col + radius));

    let average = 0, count = 0;
    if (tool === 'smooth') {
      for (let yy = r0; yy <= r1; yy++) for (let xx = c0; xx <= c1; xx++) {
        average += s.heights[yy * cols + xx]; count++;
      }
      average /= Math.max(1, count);
    }

    for (let yy = r0; yy <= r1; yy++) {
      for (let xx = c0; xx <= c1; xx++) {
        const dx = xx - col;
        const dy = yy - r;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius) continue;
        const falloff = Math.pow(1 - dist / radius, 1.8);
        const idx = yy * cols + xx;
        if (tool === 'raise') s.heights[idx] = clamp(s.heights[idx] + strength * falloff, 0, 1);
        if (tool === 'lower') s.heights[idx] = clamp(s.heights[idx] - strength * falloff, 0, 1);
        if (tool === 'flatten') s.heights[idx] = s.heights[idx] * (1 - falloff * 0.25) + target * falloff * 0.25;
        if (tool === 'smooth') s.heights[idx] = s.heights[idx] * (1 - falloff * 0.35) + average * falloff * 0.35;
      }
    }
    updateGeometryHeights(s);
  }

  function updateGeometryHeights(s) {
    const pos = s.geometry.attributes.position.array;
    const maxH = Number(maxHeightM || 500);
    for (let i = 0; i < s.heights.length; i++) pos[i * 3 + 1] = s.heights[i] * maxH;
    s.geometry.attributes.position.needsUpdate = true;
    s.geometry.computeVertexNormals();
  }

  return <div className="viewport" ref={mountRef} />;
});

export default TerrainViewport;
