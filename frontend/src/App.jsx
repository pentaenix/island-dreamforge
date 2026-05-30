import React, { useMemo, useRef, useState } from 'react';
import TerrainViewport, { MATERIALS } from './TerrainViewport.jsx';
import HeightsStudio from './HeightsStudio.jsx';
import { Slider } from './studioUi.jsx';
import { API_URL, dataUrlToBlob, downloadBlob, postForm } from './api.js';

const waterOnlyStarter = [
  { hex: '#b7d3dc', height: 0, tolerance: 0, weight: 1, role: 'water' },
];

const islandColorLadder = [
  { hex: '#b7d3dc', height: 0, tolerance: 0, weight: 1, role: 'water' },
  { hex: '#efe6bd', height: 6, tolerance: 0, weight: 1 },
  { hex: '#ddd68f', height: 22, tolerance: 0, weight: 1 },
  { hex: '#c6d071', height: 70, tolerance: 0, weight: 1 },
  { hex: '#9eb867', height: 145, tolerance: 0, weight: 1 },
  { hex: '#6fa45d', height: 260, tolerance: 0, weight: 1 },
  { hex: '#3d8745', height: 395, tolerance: 0, weight: 1 },
  { hex: '#2f743d', height: 500, tolerance: 0, weight: 1 },
];

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function urlToFile(url, name, type = 'image/png') {
  const blob = await fetch(url).then(r => r.blob());
  return new File([blob], name, { type });
}

function hexFromRgb(r, g, b) {
  return '#' + [r, g, b].map(v => Number(v).toString(16).padStart(2, '0')).join('');
}

function rgbFromHex(hex) {
  const v = String(hex || '').replace('#', '').trim();
  if (v.length !== 6) return [0, 0, 0];
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}


const PROJECT_STORE = 'island-dreamforge-autosave-v7';

const DEFAULT_WORLD_SETTINGS = {
  widthM: 1480,
  depthM: 1086,
  lockAspect: true,
  verticalExaggeration: 1.0,
};

const DEFAULT_OPTIONS = {
  maxHeightM: 500,
  designedBandMode: true,
  exactColorMode: true,
  unknownColorMode: 'nearest',
  protectWaterLevel: true,
  seaLevelM: 0,
  bandBlendStrength: 0.86,
  bandTransitionPx: 11,
  bandBlendPasses: 2,
  cleanTinyRegions: true,
  tinyRegionPasses: 2,
  smoothingSigma: 1.1,
  roundPeaks: 0.64,
  roundPeakRadius: 11,
  cliffStrength: 0.12,
  colorPower: 1.75,
  sampleLockPower: 1.0,
  terraceCount: 0,
  terraceStrength: 0,
  detailPreserve: 0.08,
  curveSmoothStrength: 0.22,
  curveSmoothRadius: 5,
  spikeRemovalStrength: 0.78,
  spikeThresholdM: 24,
  spikeRemovalPasses: 3,
  slopeLimitStrength: 0.5,
  slopeLimitMPerPx: 62,
  slopeLimitIterations: 3,
  preprocessEnabled: false,
  sampleAverageStrength: 0.0,
  sampleAverageToleranceScale: 1.1,
  paletteColorCount: 0,
  paletteReductionStrength: 0,
  paperNoiseBlur: 0,
  paperNoiseStrength: 0,
  ignoreLineStrength: 0,
  lineInpaintRadius: 3.5,
};

/** 3D ocean uses Three.js Water with fixed tuning — no viewport sliders. */
const DEFAULT_WATER_SETTINGS = { enabled: true, seaLevelM: 0 };

const DEFAULT_TEXTURE_SETTINGS = {
  textureSize: 2048,
  pixelSize: 2,
  fuzziness: 0.18,
  normalStrength: 0.82,
  materialContrast: 0.38,
  variation: 0.22,
  treeDensity: 0.88,
  treeCountMax: 3600,
  treeSpacing: 3,
  treeSeed: 42,
  treeMinHeightM: 2,
  treePixelSize: 4,
  forestSlopeFade: 48,
  rockSlopeStart: 50,
  rockSlopeBlend: 14,
  rockFeatureScale: 0.55,
  gravelAmount: 0.12,
  sandHeightM: 14,
  wetSandWidthM: 5,
  preservePaintedEdits: true,
};

const MATERIAL_TOOLTIPS = {
  trees: 'Paints forest canopy zones using the grass PBR tile.',
  rock: 'Paints steep rocky cliff material.',
  gravel: 'Paints pebble/gravel transition zones.',
  sand: 'Paints beach sand.',
  grass: 'Paints lowland grass.',
};


const TOOL_DEFS = [
  { id: 'move', icon: '✥', label: 'Move', tip: 'Move/orbit the camera. No editing happens.' },
  { id: 'select', icon: '⌖', label: 'Select', tip: 'Select structures, markers, or inspect without sculpting.' },
  { id: 'raise', icon: '▲', label: 'Raise', tip: 'Raise terrain under the brush.' },
  { id: 'lower', icon: '▼', label: 'Lower', tip: 'Lower terrain under the brush.' },
  { id: 'smooth', icon: '≈', label: 'Smooth', tip: 'Soften terrain under the brush.' },
  { id: 'flatten', icon: '▰', label: 'Flatten', tip: 'Blend terrain toward the chosen flatten height.' },
  { id: 'paint', icon: '◌', label: 'Paint', tip: 'Paint the selected material texture without changing height.' },
];

const DEFAULT_BRUSH = { size: 46, strength: 0.48, opacity: 0.85, flattenM: 8, edgeSoftness: 0.72, noise: 0.18 };

function openProjectDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('IslandDreamforgeLocalProject', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openProjectDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openProjectDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key) {
  const db = await openProjectDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function fileFromDataUrl(dataUrl, name = 'restored-image.png') {
  if (!dataUrl) return null;
  const blob = dataUrlToBlob(dataUrl);
  return new File([blob], name, { type: blob.type || 'image/png' });
}

async function sampleCornerHexFromFile(file) {
  if (!file) return '#b7d3dc';
  const src = await fileToDataUrl(file);
  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(24, img.width);
  canvas.height = Math.min(24, img.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 32) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  return hexFromRgb(Math.round(r / Math.max(1, n)), Math.round(g / Math.max(1, n)), Math.round(b / Math.max(1, n)));
}

function newLayer(kind) {
  const base = {
    id: `${kind}_${Date.now()}_${Math.round(Math.random() * 9999)}`,
    name: kind === 'water' ? 'Water overlay' : kind === 'structure' ? 'Structure overlay' : kind === 'marker' ? 'Marker / POI overlay' : 'Texture/noise overlay',
    kind,
    enabled: true,
    file: null,
    url: '',
    analysis: null,
  };
  if (kind === 'water') return { ...base, mode: 'visual-only', carveDepthM: 1.5, lakeDepthM: 0.75, bankSmoothPx: 14, waterfallDropM: 18, fastRiverGrade: 0.25, maskThreshold: 8 };
  if (kind === 'structure') return { ...base, shape: 'box', objectHeightM: 8, flattenGround: true, snapToGround: true, maskThreshold: 8 };
  if (kind === 'marker') return { ...base, markerType: 'poi', namePrefix: 'Point', radiusM: 4, maskThreshold: 8 };
  return { ...base, material: 'trees', noise: 0.35, edgeSoftness: 0.65, maskThreshold: 8 };
}

function LayerCard({ layer, active, onSelect, onChange, onFile, onAnalyze, onExport, onDelete, onClear }) {
  return (
    <div className={`layer-card ${active ? 'active' : ''} ${!layer.enabled ? 'disabled' : ''}`} onClick={() => onSelect(layer.id)}>
      <div className="layer-head">
        <input value={layer.name} onChange={e => onChange({ name: e.target.value })} onClick={e => e.stopPropagation()} />
        <select value={layer.kind} onChange={e => onChange({ kind: e.target.value, analysis: null })} onClick={e => e.stopPropagation()}>
          <option value="water">Water</option>
          <option value="structure">Structure</option>
          <option value="marker">Marker / POI</option>
          <option value="texture">Texture / Noise</option>
        </select>
      </div>
      <div className="layer-toolbar" onClick={e => e.stopPropagation()}>
        <label className="checkline mini"><input type="checkbox" checked={layer.enabled !== false} onChange={e => onChange({ enabled: e.target.checked })} /> Visible</label>
        <button onClick={onClear}>Clear</button>
        <button className="danger" onClick={onDelete}>Delete</button>
      </div>
      <div className="layer-body">
        <label className="file-small">Overlay image<input type="file" accept="image/*" onClick={e => e.stopPropagation()} onChange={e => onFile(e.target.files[0])} /></label>
        {layer.url && <div className="thumb-wrap">
          <button className="thumb-x" onClick={(e) => { e.stopPropagation(); onChange({ file: null, url: '', analysis: null }); }} title="Remove this overlay image">×</button>
          <img className="layer-thumb" src={layer.analysis?.preview || layer.url} alt={layer.name} />
        </div>}

        {layer.kind === 'water' && <>
          <label>Water effect<select value={layer.mode || 'visual-only'} onChange={e => onChange({ mode: e.target.value })}>
            <option value="visual-only">Visual water only — no terrain change</option>
            <option value="shallow-indent">Small indent for water bed</option>
            <option value="riverbed">Riverbed / stream groove</option>
            <option value="lake-flatten">Flatten calm lakes locally</option>
            <option value="ocean-shore">Ocean shoreline shelf</option>
          </select></label>
          <Slider label="Indent depth" value={layer.carveDepthM ?? 1.5} min={0} max={12} step={0.1} suffix="m" onChange={v => onChange({ carveDepthM: v })} />
          <Slider label="Bank softness" value={layer.bankSmoothPx ?? 14} min={0} max={90} step={1} suffix="px" onChange={v => onChange({ bankSmoothPx: v })} />
          <Slider label="Waterfall drop" value={layer.waterfallDropM ?? 18} min={1} max={120} step={1} suffix="m" onChange={v => onChange({ waterfallDropM: v })} />
        </>}
        {layer.kind === 'structure' && <>
          <label>Shape<select value={layer.shape || 'box'} onChange={e => onChange({ shape: e.target.value })}>
            <option value="box">Box from painted footprint</option>
            <option value="cylinder">Cylinder from painted footprint</option>
            <option value="sphere">Sphere at painted islands</option>
          </select></label>
          <Slider label="Object height" value={layer.objectHeightM ?? 8} min={1} max={120} step={1} suffix="m" onChange={v => onChange({ objectHeightM: v })} />
          <label className="checkline"><input type="checkbox" checked={!!layer.flattenGround} onChange={e => onChange({ flattenGround: e.target.checked })} /> Flatten ground under objects</label>
          <label className="checkline"><input type="checkbox" checked={layer.snapToGround !== false} onChange={e => onChange({ snapToGround: e.target.checked })} /> Snap to final smoothed terrain</label>
        </>}
        {layer.kind === 'marker' && <>
          <label>Marker type<input value={layer.markerType || 'poi'} onChange={e => onChange({ markerType: e.target.value })} /></label>
          <label>Name prefix<input value={layer.namePrefix || 'Point'} onChange={e => onChange({ namePrefix: e.target.value })} /></label>
        </>}
        {layer.kind === 'texture' && <>
          <label>Material<select value={layer.material || 'trees'} onChange={e => onChange({ material: e.target.value })}>{MATERIALS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
          <Slider label="Noise" value={layer.noise ?? 0.35} min={0} max={1} step={0.01} onChange={v => onChange({ noise: v })} />
          <Slider label="Soft transition" value={layer.edgeSoftness ?? 0.65} min={0} max={1} step={0.01} onChange={v => onChange({ edgeSoftness: v })} />
        </>}
        <div className="actions compact">
          <button onClick={(e) => { e.stopPropagation(); onAnalyze(); }}>Analyze layer</button>
          {layer.analysis && <button onClick={(e) => { e.stopPropagation(); onExport(); }}>Export JSON</button>}
        </div>
        {layer.analysis && <p className="small muted">{layer.analysis.featureCount} feature(s). {layer.analysis.summary?.waterfalls ? `${layer.analysis.summary.waterfalls} waterfall candidate(s).` : ''}</p>}
      </div>
    </div>
  );
}


function TexturePreviewTile({ id, label, settings }) {
  const seed = id.length * 17;
  const px = Math.max(2, Number(settings.pixelSize || 4));
  const fuzzy = Number(settings.fuzziness || 0.5);
  const style = {
    '--px': `${px}px`,
    '--fuzz': fuzzy,
  };
  return <div className={`material-tile material-${id}`} style={style} title={`${label} preview`}>
    <div className="tile-noise" style={{ backgroundPosition: `${seed}px ${seed * 2}px` }} />
    <span>{label}</span>
  </div>;
}

function TextureStudio({ settings, setSettings, onOpen3D, canPreview }) {
  const update = patch => setSettings({ ...settings, ...patch });
  return <section className="texture-stage">
    <aside className="panel texture-controls">
      <h2>2 · Procedural textures</h2>
      <p className="muted">Generate the island’s art pass before water and final 3D editing. These settings control fuzzy pixel texture, trees, rocks, gravel, sand, normals, and material transitions.</p>
      <div className="material-board">
        {MATERIALS.map(m => <TexturePreviewTile key={m.id} id={m.id} label={m.label} settings={settings} />)}
      </div>
      <div className="actions">
        <button className="primary" onClick={onOpen3D} disabled={!canPreview}>Open 3D preview with these textures</button>
      </div>
      {!canPreview && <p className="small muted">Generate the height map first, then the 3D preview can render these materials.</p>}
    </aside>

    <main className="panel texture-rules">
      <h3>Texture quality and style</h3>
      <Slider label="Texture resolution" value={settings.textureSize} min={512} max={2048} step={256} suffix="px" onChange={v => update({ textureSize: v })} />
      <Slider label="Pixel size" value={settings.pixelSize} min={1} max={18} step={1} suffix="px" onChange={v => update({ pixelSize: v })} />
      <Slider label="Fuzziness" value={settings.fuzziness} min={0} max={1} step={0.01} onChange={v => update({ fuzziness: v })} />
      <Slider label="Normal/bump strength" value={settings.normalStrength} min={0} max={1.4} step={0.01} onChange={v => update({ normalStrength: v })} />
      <Slider label="Color variation" value={settings.variation} min={0} max={1} step={0.01} onChange={v => update({ variation: v })} />
      <Slider label="Material contrast" value={settings.materialContrast} min={0} max={1} step={0.01} onChange={v => update({ materialContrast: v })} />

      <h3>Terrain-to-material rules</h3>
      <Slider label="Rock starts at steepness" value={settings.rockSlopeStart} min={8} max={80} step={1} suffix="°" onChange={v => update({ rockSlopeStart: v })} />
      <Slider label="Rock blend width" value={settings.rockSlopeBlend} min={2} max={40} step={1} suffix="°" onChange={v => update({ rockSlopeBlend: v })} />
      <Slider label="Rock feature strength" value={settings.rockFeatureScale} min={0} max={1.4} step={0.01} onChange={v => update({ rockFeatureScale: v })} />
      <h3>Forest clumps (3D)</h3>
      <Slider label="Spawn density" value={settings.treeDensity} min={0} max={1} step={0.01} onChange={v => update({ treeDensity: v })} />
      <Slider label="Max tree count" value={settings.treeCountMax} min={100} max={4000} step={50} onChange={v => update({ treeCountMax: v })} />
      <Slider label="Grid spacing" value={settings.treeSpacing} min={3} max={24} step={1} suffix="cells" onChange={v => update({ treeSpacing: v })} />
      <Slider label="Min terrain height" value={settings.treeMinHeightM} min={0} max={80} step={1} suffix="m" onChange={v => update({ treeMinHeightM: v })} />
      <Slider label="Max slope" value={settings.forestSlopeFade} min={8} max={80} step={1} suffix="°" onChange={v => update({ forestSlopeFade: v })} />
      <Slider label="Random seed" value={settings.treeSeed} min={1} max={9999} step={1} onChange={v => update({ treeSeed: v })} />
      <Slider label="Canopy texture pixel size" value={settings.treePixelSize} min={2} max={24} step={1} suffix="px" onChange={v => update({ treePixelSize: v })} />
      <Slider label="Gravel in transition zones" value={settings.gravelAmount} min={0} max={1} step={0.01} onChange={v => update({ gravelAmount: v })} />
      <Slider label="Sand height band" value={settings.sandHeightM} min={1} max={120} step={1} suffix="m" onChange={v => update({ sandHeightM: v })} />
      <Slider label="Wet sand width" value={settings.wetSandWidthM} min={0} max={40} step={1} suffix="m" onChange={v => update({ wetSandWidthM: v })} />
      <label className="checkline"><input type="checkbox" checked={!!settings.preservePaintedEdits} onChange={e => update({ preservePaintedEdits: e.target.checked })} /> Preserve hand-painted edits when regenerating</label>
    </main>
  </section>;
}

export default function App() {
  const viewportRef = useRef(null);
  const [stage, setStage] = useState(1);
  const [mapFile, setMapFile] = useState(null);
  const [mapUrl, setMapUrl] = useState('');
  const [mapVersion, setMapVersion] = useState(0);
  const restoreDoneRef = useRef(false);
  const [samples, setSamples] = useState(waterOnlyStarter);
  const [picked, setPicked] = useState('#b7d3dc');
  const [newHeight, setNewHeight] = useState(0);
  const [dominant, setDominant] = useState([]);
  const [cleanedPreview, setCleanedPreview] = useState('');
  const [heightmap16, setHeightmap16] = useState('');
  const [heightPreview, setHeightPreview] = useState('');
  const [bakedHeightmap16, setBakedHeightmap16] = useState('');
  const [bakedPreview, setBakedPreview] = useState('');
  const [waterMask, setWaterMask] = useState('');
  const [layers, setLayers] = useState([]);
  const [activeLayerId, setActiveLayerId] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [tool, setTool] = useState('move');
  const [selectedMaterial, setSelectedMaterial] = useState('trees');
  const [brush, setBrush] = useState(DEFAULT_BRUSH);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [waterSettings, setWaterSettings] = useState(DEFAULT_WATER_SETTINGS);
  const [textureSettings, setTextureSettings] = useState(DEFAULT_TEXTURE_SETTINGS);
  const [similarRadius, setSimilarRadius] = useState(18);
  const [analyzeCount, setAnalyzeCount] = useState(12);
  const [worldSettings, setWorldSettings] = useState(DEFAULT_WORLD_SETTINGS);
  const [mapSizePx, setMapSizePx] = useState({ width: 0, height: 0 });

  const finalPreview = bakedPreview || heightPreview;
  const finalHeight = bakedHeightmap16 || heightmap16;
  const activeLayer = layers.find(l => l.id === activeLayerId) || layers[0] || null;
  const derivedDepthM = (() => {
    if (worldSettings.lockAspect && mapSizePx.width && mapSizePx.height) return Math.round(worldSettings.widthM * mapSizePx.height / mapSizePx.width);
    return Number(worldSettings.depthM || 0);
  })();
  const metersPerPixel = mapSizePx.width ? (Number(worldSettings.widthM || 0) / Math.max(1, mapSizePx.width)) : 0;

  const recipe = useMemo(() => ({
    app: 'Island Dreamforge',
    philosophy: 'Pixel-perfect color bands, automatic slopes, reversible overlays, and game-ready exports.',
    maxHeightM: options.maxHeightM,
    samples,
    stage1Options: options,
    waterSettings,
    textureSettings,
    worldSettings,
    layers: layers.map(({ file, url, ...l }) => l),
  }), [samples, options, waterSettings, textureSettings, worldSettings, layers]);


  React.useEffect(() => {
    let alive = true;
    async function restoreProject() {
      try {
        const saved = await idbGet(PROJECT_STORE);
        if (!alive) return;
        if (saved?.version >= 6) {
          setStage(saved.stage || 1);
          setMapUrl(saved.mapUrl || '');
          setMapFile(saved.mapUrl ? fileFromDataUrl(saved.mapUrl, saved.mapFileName || 'restored_map.png') : null);
          setSamples(saved.samples?.length ? saved.samples : waterOnlyStarter);
          setPicked(saved.picked || saved.samples?.[0]?.hex || '#b7d3dc');
          setNewHeight(saved.newHeight ?? 0);
          setDominant(saved.dominant || []);
          setCleanedPreview(saved.cleanedPreview || '');
          setHeightmap16(saved.heightmap16 || '');
          setHeightPreview(saved.heightPreview || '');
          setBakedHeightmap16(saved.bakedHeightmap16 || '');
          setBakedPreview(saved.bakedPreview || '');
          setWaterMask(saved.waterMask || '');
          setOptions({ ...DEFAULT_OPTIONS, ...(saved.options || {}) });
          setWaterSettings({ ...DEFAULT_WATER_SETTINGS, ...(saved.waterSettings || {}) });
          setTextureSettings({ ...DEFAULT_TEXTURE_SETTINGS, ...(saved.textureSettings || {}) });
          {
            const restoredWorld = { ...DEFAULT_WORLD_SETTINGS, ...(saved.worldSettings || {}) };
            restoredWorld.verticalExaggeration = Math.max(1, Number(restoredWorld.verticalExaggeration) || 1);
            setWorldSettings(restoredWorld);
          }
          setMapSizePx(saved.mapSizePx || { width: 0, height: 0 });
          setTool(saved.tool || 'move');
          setSelectedMaterial(saved.selectedMaterial || 'trees');
          setBrush({ ...DEFAULT_BRUSH, ...(saved.brush || {}) });
          const restoredLayers = (saved.layers || []).map((l) => ({
            ...l,
            file: l.url ? fileFromDataUrl(l.url, `${l.kind || 'layer'}_overlay.png`) : null,
          }));
          setLayers(restoredLayers);
          setActiveLayerId(saved.activeLayerId || restoredLayers[0]?.id || null);
          setMapVersion(v => v + 1);
        }
      } catch (e) {
        console.warn('Autosave restore failed', e);
      } finally {
        restoreDoneRef.current = true;
      }
    }
    restoreProject();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!restoreDoneRef.current) return;
    const timer = setTimeout(() => {
      const cleanLayers = layers.map(({ file, ...l }) => l);
      idbSet(PROJECT_STORE, {
        version: 7,
        savedAt: new Date().toISOString(),
        stage,
        mapUrl,
        mapFileName: mapFile?.name || 'map.png',
        samples,
        picked,
        newHeight,
        dominant,
        cleanedPreview,
        heightmap16,
        heightPreview,
        bakedHeightmap16,
        bakedPreview,
        waterMask,
        layers: cleanLayers,
        activeLayerId,
        options,
        waterSettings,
        textureSettings,
        worldSettings,
        mapSizePx,
        tool,
        selectedMaterial,
        brush,
      }).catch(e => console.warn('Autosave failed', e));
    }, 600);
    return () => clearTimeout(timer);
  }, [stage, mapUrl, samples, picked, newHeight, dominant, cleanedPreview, heightmap16, heightPreview, bakedHeightmap16, bakedPreview, waterMask, layers, activeLayerId, options, waterSettings, textureSettings, worldSettings, mapSizePx, tool, selectedMaterial, brush, mapFile]);

  async function handleFile(file, setterFile, setterUrl) {
    if (!file) return;
    setterFile(file);
    setterUrl(await fileToDataUrl(file));
  }

  async function handleBaseMap(file) {
    if (!file) return;
    setBusy('Loading base map…'); setError('');
    try {
      const url = await fileToDataUrl(file);
      const waterHex = await sampleCornerHexFromFile(file);
      setMapFile(file);
      setMapUrl(url);
      setMapVersion(v => v + 1);
      try {
        const imageDims = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve({ width: image.naturalWidth || image.width || 0, height: image.naturalHeight || image.height || 0 });
          image.onerror = reject;
          image.src = url;
        });
        setMapSizePx(imageDims);
        setWorldSettings(prev => prev.lockAspect && imageDims.width && imageDims.height ? { ...prev, depthM: Math.round(prev.widthM * imageDims.height / imageDims.width) } : prev);
      } catch {}
      setPicked(waterHex);
      setNewHeight(0);
      setSamples(prev => {
        const onlyStarter = !prev.length || (prev.length === 1 && Number(prev[0].height) === 0);
        if (onlyStarter) return [{ hex: waterHex, height: 0, tolerance: 0, weight: 1, role: 'water' }];
        return prev;
      });
      setHeightmap16(''); setHeightPreview(''); setBakedHeightmap16(''); setBakedPreview(''); setWaterMask('');
      setCleanedPreview('');
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(''); }
  }

  async function resetProject() {
    await idbDelete(PROJECT_STORE).catch(() => {});
    setStage(1);
    setMapFile(null); setMapUrl(''); setMapVersion(v => v + 1);
    setSamples(waterOnlyStarter); setPicked('#b7d3dc'); setNewHeight(0);
    setDominant([]); setCleanedPreview('');
    setHeightmap16(''); setHeightPreview(''); setBakedHeightmap16(''); setBakedPreview(''); setWaterMask('');
    setLayers([]); setActiveLayerId(null);
    setOptions({ ...DEFAULT_OPTIONS });
    setWaterSettings({ ...DEFAULT_WATER_SETTINGS });
    setTextureSettings({ ...DEFAULT_TEXTURE_SETTINGS });
    setWorldSettings({ ...DEFAULT_WORLD_SETTINGS });
    setMapSizePx({ width: 0, height: 0 });
    setBrush({ ...DEFAULT_BRUSH });
    setSimilarRadius(18);
    setAnalyzeCount(12);
    setAdvancedOpen(false);
    setTool('move'); setSelectedMaterial('trees');
    setError(''); setBusy('');
  }

  async function loadExample() {
    setBusy('Loading included island layers...'); setError('');
    try {
      const mf = await urlToFile('/examples/base_map.png', 'base_map.png');
      await handleBaseMap(mf);
      const wf = await urlToFile('/examples/water_layer.png', 'water_layer.png');
      const sf = await urlToFile('/examples/structure_layer.png', 'structure_layer.png');
      const waterUrl = await fileToDataUrl(wf);
      const structureUrl = await fileToDataUrl(sf);
      const water = { ...newLayer('water'), file: wf, url: waterUrl, name: 'Example water overlay' };
      const structure = { ...newLayer('structure'), file: sf, url: structureUrl, name: 'Example structures', shape: 'box', objectHeightM: 8 };
      setLayers([water, structure, newLayer('marker'), newLayer('texture')]);
      setActiveLayerId(water.id);
      setSamples(islandColorLadder);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  function addHeightPoint(hex = picked) {
    setSamples(prev => {
      const existing = prev.findIndex(s => s.hex.toLowerCase() === hex.toLowerCase());
      const next = { hex, height: Number(newHeight), tolerance: options.exactColorMode ? 0 : Number(similarRadius), weight: 1 };
      if (existing >= 0) return prev.map((s, i) => i === existing ? { ...s, ...next } : s);
      return [...prev, next].sort((a, b) => Number(a.height) - Number(b.height));
    });
  }

  function updateSample(i, patch) {
    setSamples((prev) => prev.map((s, idx) => (
      idx === i ? { ...s, ...patch, tolerance: options.exactColorMode ? 0 : Number(similarRadius) } : s
    )));
  }

  async function analyzeColors() {
    if (!mapFile) return setError('Upload a base map first.');
    setBusy('Finding clean map colors...'); setError('');
    try {
      const form = new FormData();
      form.append('map_image', mapFile);
      form.append('count', analyzeCount);
      const data = await postForm('/api/analyze-colors', form);
      const colors = data.colors || [];
      setDominant(colors);
      if (colors.length) {
        const nextSamples = colors
          .slice()
          .sort((a, b) => Number(a.suggestedHeight ?? 0) - Number(b.suggestedHeight ?? 0))
          .map(c => ({ hex: c.hex, height: Number(c.suggestedHeight ?? 0), tolerance: 0, weight: 1, role: c.role || '' }));
        setSamples(nextSamples);
        setPicked(nextSamples[0]?.hex || picked);
        setNewHeight(nextSamples[0]?.height ?? 0);
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function previewCleanMap() {
    if (!mapFile) return setError('Upload a base map first.');
    setBusy('Previewing color cleanup...'); setError('');
    try {
      const form = new FormData();
      form.append('map_image', mapFile);
      form.append('samples', JSON.stringify(samples));
      form.append('options', JSON.stringify(options));
      const data = await postForm('/api/preprocess-map', form);
      setCleanedPreview(data.cleanedPreview);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function generateHeightmap(responseFormat = 'json') {
    if (!mapFile) return setError('Upload a base map first.');
    if (!samples.length) return setError('Add at least the water color at 0 m.');
    if (Math.max(...samples.map(s => Number(s.height || 0))) <= Number(options.seaLevelM || 0) + 0.5) {
      return setError('The current height setup only contains water/sea-level colors, so the result would be a flat black height map. Add at least one land color with a height above 0 m, or use Suggest colors.');
    }
    setBusy(responseFormat === 'zip' ? 'Exporting Stage 1 maps...' : 'Generating smooth band height map...'); setError('');
    try {
      const form = new FormData();
      const fixedSamples = samples.map(s => ({ ...s, tolerance: options.exactColorMode ? 0 : Number(similarRadius) }));
      form.append('map_image', mapFile);
      form.append('samples', JSON.stringify(fixedSamples));
      form.append('options', JSON.stringify(options));
      form.append('response_format', responseFormat);
      if (responseFormat === 'zip') {
        const blob = await postForm('/api/heightmap', form, true);
        downloadBlob(blob, 'island_heightmap_stage1.zip');
      } else {
        const data = await postForm('/api/heightmap', form);
        setHeightmap16(data.heightmap16);
        setHeightPreview(data.preview8);
        setBakedHeightmap16(''); setBakedPreview('');
        if (data.warning) setError(data.warning);
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  function addLayer(kind) {
    const l = newLayer(kind);
    setLayers(prev => [...prev, l]);
    setActiveLayerId(l.id);
  }

  function updateLayer(id, patch) {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  }

  function deleteLayer(id) {
    setLayers(prev => prev.filter(l => l.id !== id));
    if (activeLayerId === id) setActiveLayerId(null);
  }

  function clearLayer(id) {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, file: null, url: '', analysis: null } : l));
    if (activeLayerId === id) { setBakedHeightmap16(''); setBakedPreview(''); setWaterMask(''); }
  }

  async function setLayerFile(id, file) {
    if (!file) return;
    const url = await fileToDataUrl(file);
    updateLayer(id, { file, url, analysis: null });
  }

  async function analyzeLayer(layer) {
    if (!layer?.file) return setError('Upload an overlay image for this layer first.');
    setBusy(`Analyzing ${layer.name}...`); setError('');
    try {
      const form = new FormData();
      form.append('layer_image', layer.file);
      if (finalHeight) form.append('heightmap', dataUrlToBlob(finalHeight), 'heightmap.png');
      form.append('kind', layer.kind);
      form.append('options', JSON.stringify({ ...layer, maxHeightM: options.maxHeightM, terrainWidthM: 1480 }));
      const data = await postForm('/api/analyze-layer', form);
      updateLayer(layer.id, { analysis: data });
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function bakeWaterLayer(layer, responseFormat = 'json') {
    const source = bakedHeightmap16 || heightmap16;
    if (!source) return setError('Generate Stage 1 height map first.');
    if (!layer?.file) return setError('Upload or select a water layer first.');
    setBusy(responseFormat === 'zip' ? 'Exporting water stage...' : 'Baking reversible water layer...'); setError('');
    try {
      const form = new FormData();
      form.append('heightmap', dataUrlToBlob(source), 'heightmap.png');
      form.append('water_map', layer.file);
      form.append('options', JSON.stringify({ maxHeightM: options.maxHeightM, mode: layer.mode || 'visual-only', seaLevelM: options.seaLevelM || 0, carveDepthM: layer.carveDepthM ?? 1.5, riverDepthM: layer.carveDepthM ?? 1.5, lakeDepthM: layer.lakeDepthM ?? 0.75, bankSmoothPx: layer.bankSmoothPx ?? 14, maskThreshold: layer.maskThreshold ?? 8 }));
      form.append('response_format', responseFormat);
      if (responseFormat === 'zip') {
        const blob = await postForm('/api/bake-water', form, true);
        downloadBlob(blob, 'island_water_stage2.zip');
      } else {
        const data = await postForm('/api/bake-water', form);
        setBakedHeightmap16(data.heightmap16);
        setBakedPreview(data.preview8);
        setWaterMask(data.waterMask);
        setWaterSettings(prev => ({ ...prev, seaLevelM: options.seaLevelM || 0 }));
        setStage(3);
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  function exportLayerJson(layer) {
    if (!layer?.analysis) return;
    const blob = new Blob([JSON.stringify({ layer: { ...layer, file: undefined, url: undefined }, analysis: layer.analysis }, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${layer.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_features.json`);
  }

  async function exportMesh(fmt = 'glb') {
    if (!finalHeight) return setError('Generate a heightmap first.');
    setBusy(`Exporting ${fmt.toUpperCase()} mesh...`); setError('');
    try {
      const editHeightBlob = await viewportRef.current?.getHeightmapBlob();
      const textureBlob = await viewportRef.current?.getTextureBlob();
      const normalBlob = await viewportRef.current?.getNormalBlob?.();
      const form = new FormData();
      form.append('heightmap', editHeightBlob || dataUrlToBlob(finalHeight), 'edited_heightmap.png');
      if (textureBlob) form.append('texture', textureBlob, 'painted_texture.png');
      form.append('fmt', fmt);
      form.append('options', JSON.stringify({ maxHeightM: options.maxHeightM, widthM: Number(worldSettings.widthM || 1480), depthM: Number(derivedDepthM || worldSettings.depthM || 1086), verticalScale: Number(worldSettings.verticalExaggeration || 1), meshResolution: 512, addSkirt: true }));
      const blob = await postForm('/api/export-mesh', form, true);
      downloadBlob(blob, `island_terrain.${fmt}`);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function exportProject() {
    if (!finalHeight) return setError('Generate a heightmap first.');
    setBusy('Exporting full project archive...'); setError('');
    try {
      const editHeightBlob = await viewportRef.current?.getHeightmapBlob();
      const textureBlob = await viewportRef.current?.getTextureBlob();
      const normalBlob = await viewportRef.current?.getNormalBlob?.();
      const form = new FormData();
      form.append('heightmap', editHeightBlob || dataUrlToBlob(finalHeight), 'final_heightmap.png');
      if (textureBlob) form.append('texture', textureBlob, 'painted_texture.png');
      if (normalBlob) form.append('normal_map', normalBlob, 'normal_map.png');
      if (waterMask) form.append('water_mask', dataUrlToBlob(waterMask), 'water_mask.png');
      form.append('recipe', JSON.stringify(recipe));
      form.append('options', JSON.stringify({ maxHeightM: options.maxHeightM, widthM: Number(worldSettings.widthM || 1480), depthM: Number(derivedDepthM || worldSettings.depthM || 1086), verticalScale: Number(worldSettings.verticalExaggeration || 1), meshResolution: 512, addSkirt: true }));
      const blob = await postForm('/api/export-project', form, true);
      downloadBlob(blob, 'island_dreamforge_project.zip');
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  function downloadDataUrl(dataUrl, name) {
    if (!dataUrl) return;
    downloadBlob(dataUrlToBlob(dataUrl), name);
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Fantasy Map → Game Terrain Studio</p>
          <h1>Island Dreamforge</h1>
          <p className="lede">Pixel-perfect color heights, smooth automatic terrain bands, reversible water, structure overlays, marker exports, texture layers, and 3D sculpting.</p>
        </div>
        <div className="api-pill">Backend: <span>{API_URL}</span></div>
      </header>

      <nav className="stage-tabs">
        <button className={stage === 1 ? 'active' : ''} onClick={() => setStage(1)}>1 · Heights</button>
        <button className={stage === 2 ? 'active' : ''} onClick={() => setStage(2)}>2 · Textures</button>
        <button className={stage === 3 ? 'active' : ''} onClick={() => setStage(3)}>3 · Water & Layers</button>
        <button className={stage === 4 ? 'active' : ''} onClick={() => setStage(4)}>4 · 3D / Export</button>
        <button onClick={loadExample}>Load included island layers</button>
      </nav>

      {busy && <div className="banner busy">{busy}</div>}
      {error && <div className="banner error">{error}</div>}
      <button className="reset-project" onClick={() => { if (confirm('Reset Island Dreamforge and clear local autosave?')) resetProject(); }}>Reset project</button>

      {stage === 1 && (
        <HeightsStudio
          mapUrl={mapUrl}
          mapVersion={mapVersion}
          samples={samples}
          setSamples={setSamples}
          picked={picked}
          setPicked={setPicked}
          newHeight={newHeight}
          setNewHeight={setNewHeight}
          similarRadius={similarRadius}
          setSimilarRadius={setSimilarRadius}
          options={options}
          setOptions={setOptions}
          worldSettings={worldSettings}
          setWorldSettings={setWorldSettings}
          derivedDepthM={derivedDepthM}
          mapSizePx={mapSizePx}
          metersPerPixel={metersPerPixel}
          heightPreview={heightPreview}
          dominant={dominant}
          cleanedPreview={cleanedPreview}
          analyzeCount={analyzeCount}
          setAnalyzeCount={setAnalyzeCount}
          advancedOpen={advancedOpen}
          setAdvancedOpen={setAdvancedOpen}
          waterOnlyStarter={waterOnlyStarter}
          islandColorLadder={islandColorLadder}
          onBaseMap={handleBaseMap}
          onAddHeightPoint={() => addHeightPoint()}
          onUpdateSample={updateSample}
          onAnalyzeColors={analyzeColors}
          onPreviewCleanMap={previewCleanMap}
          onGenerateHeightmap={generateHeightmap}
        />
      )}

      {stage === 2 && <TextureStudio settings={textureSettings} setSettings={setTextureSettings} onOpen3D={() => setStage(4)} canPreview={!!finalPreview} />}

      {stage === 3 && <section className="layer-stage">
        <aside className="panel layer-sidebar">
          <h2>3 · Water & overlay layers</h2>
          <p className="muted">Layers are optional and non-destructive. You can have no water layer at all, add one later, or remove its image with the × on the thumbnail.</p>
          <div className="tool-grid">
            <button onClick={() => addLayer('water')}>+ Water</button>
            <button onClick={() => addLayer('structure')}>+ Structure</button>
            <button onClick={() => addLayer('marker')}>+ Marker</button>
            <button onClick={() => addLayer('texture')}>+ Texture</button>
          </div>
          <div className="layer-list">
            {!layers.length && <div className="drop-hint">No overlay layers yet. Add water, structures, markers, or textures when you need them.</div>}
            {layers.map(layer => <LayerCard
              key={layer.id}
              layer={layer}
              active={activeLayer?.id === layer.id}
              onSelect={setActiveLayerId}
              onChange={patch => updateLayer(layer.id, patch)}
              onFile={file => setLayerFile(layer.id, file)}
              onAnalyze={() => analyzeLayer(layer)}
              onExport={() => exportLayerJson(layer)}
              onDelete={() => deleteLayer(layer.id)}
              onClear={() => clearLayer(layer.id)}
            />)}
          </div>
        </aside>
        <main className="panel tall">
          <h2>Water, structures, markers, and layer preview</h2>
          <div className="compare layer-compare">
            <div><h4>Height</h4>{heightPreview ? <img src={heightPreview} /> : <div className="drop-hint">Generate Stage 1 first</div>}</div>
            <div><h4>Active layer</h4>{activeLayer?.url ? <img src={activeLayer.analysis?.preview || activeLayer.url} /> : <div className="drop-hint">Upload layer image</div>}</div>
            <div><h4>Baked water</h4>{bakedPreview ? <img src={bakedPreview} /> : <div className="drop-hint">Bake a water layer to preview</div>}</div>
          </div>
          {activeLayer?.analysis && <pre className="json-preview">{JSON.stringify({ summary: activeLayer.analysis.summary, firstFeatures: activeLayer.analysis.features?.slice(0, 8) }, null, 2)}</pre>}
          <div className="actions">
            {activeLayer?.kind === 'water' && <>
              <button className="primary" onClick={() => bakeWaterLayer(activeLayer)}>Bake selected water layer</button>
              <button onClick={() => bakeWaterLayer(activeLayer, 'zip')}>Export Stage 3 ZIP</button>
              <button onClick={() => { setBakedHeightmap16(''); setBakedPreview(''); setWaterMask(''); }}>Revert water bake</button>
            </>}
            <button onClick={() => setStage(4)}>Open 3D viewport</button>
          </div>
          <p className="small muted">Ocean appearance is configured in <code>shared/viewport_config.json</code>. Sea level is set in Step 1 options.</p>
        </main>
      </section>}

      {stage === 4 && <section className="stage3">
        <aside className="panel tools">
          <h2>4 · Sculpt, paint, view, export</h2>
          <div className="icon-toolbar" aria-label="Terrain tools">
            {TOOL_DEFS.map(t => <button key={t.id} className={tool === t.id ? 'active' : ''} onClick={() => setTool(t.id)} title={`${t.label}: ${t.tip}`} aria-label={t.label}><span>{t.icon}</span><small>{t.label}</small></button>)}
          </div>
          <div className="active-tool-note"><b>{TOOL_DEFS.find(t => t.id === tool)?.label || 'Move'}</b> · {TOOL_DEFS.find(t => t.id === tool)?.tip || 'Move/orbit the camera.'}</div>
          <Slider label="Brush size" value={brush.size} min={4} max={220} step={1} suffix="px" onChange={v => setBrush({ ...brush, size: v })} />
          <Slider label="Brush strength" value={brush.strength} min={0.02} max={1} step={0.01} onChange={v => setBrush({ ...brush, strength: v })} />
          <Slider label="Paint opacity" value={brush.opacity} min={0.05} max={1} step={0.01} onChange={v => setBrush({ ...brush, opacity: v })} />
          <Slider label="Paint edge softness" value={brush.edgeSoftness} min={0} max={1} step={0.01} onChange={v => setBrush({ ...brush, edgeSoftness: v })} />
          <Slider label="Paint noise" value={brush.noise} min={0} max={1} step={0.01} onChange={v => setBrush({ ...brush, noise: v })} />
          <Slider label="Flatten height" value={brush.flattenM} min={0} max={options.maxHeightM} step={1} suffix="m" onChange={v => setBrush({ ...brush, flattenM: v })} />
          <h3>Procedural texture step</h3>
          <p className="small muted">Generate a fuzzy artist-style base texture from height and slope, then paint over it safely.</p>
          <h3>Paint material</h3>
          <div className="material-list">{MATERIALS.map(m => <button key={m.id} title={MATERIAL_TOOLTIPS[m.id] || m.label} className={selectedMaterial === m.id ? 'active' : ''} onClick={() => { setSelectedMaterial(m.id); setTool('paint'); }}>{m.label}</button>)}</div>
          <button className="primary" onClick={() => viewportRef.current?.autoTexture()}>Regenerate terrain texture</button>
          <button onClick={() => viewportRef.current?.regenerateTrees()}>Regenerate forest clumps</button>
          <button onClick={() => viewportRef.current?.resetCamera()}>Reset camera</button>
          <p className="small muted">Ocean tuning: edit <code>shared/viewport_config.json</code> (water section). Paint applies to land only, not the water plane.</p>
          <h3>Exports</h3>
          <div className="tool-grid">
            <button onClick={() => exportMesh('glb')}>GLB</button>
            <button onClick={() => exportMesh('obj')}>OBJ</button>
            <button onClick={() => exportMesh('stl')}>STL</button>
            <button onClick={() => exportMesh('ply')}>PLY</button>
          </div>
          <button className="primary" onClick={exportProject}>Export full project ZIP</button>
          <button onClick={() => downloadDataUrl(finalHeight, 'final_heightmap.png')}>Download final heightmap</button>
          {waterMask && <button onClick={() => downloadDataUrl(waterMask, 'water_mask.png')}>Download water mask</button>}
          <button onClick={() => downloadBlob(new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' }), 'island_dreamforge_recipe.json')}>Export recipe JSON</button>
        </aside>
        <div className="viewer-wrap">
          {finalPreview ? <TerrainViewport ref={viewportRef} heightUrl={finalPreview} maxHeightM={options.maxHeightM} seaLevelM={options.seaLevelM ?? waterSettings.seaLevelM ?? 0} tool={tool} brush={brush} selectedMaterial={selectedMaterial} textureSettings={textureSettings} layers={layers} worldSettings={{ ...worldSettings, depthM: derivedDepthM }} /> : <div className="drop-hint big">Generate Stage 1 first, then the 3D viewport appears here.</div>}
        </div>
      </section>}
    </div>
  );
}
