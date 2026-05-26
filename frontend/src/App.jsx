import React, { useMemo, useRef, useState } from 'react';
import TerrainViewport, { MATERIALS } from './TerrainViewport.jsx';
import { API_URL, dataUrlToBlob, downloadBlob, postForm } from './api.js';

const starterSamples = [
  { label: 'Sea / mask black', hex: '#000000', height: 0, tolerance: 24, weight: 1 },
  { label: 'Beach / pale sand', hex: '#dfd994', height: 8, tolerance: 38, weight: 1.25 },
  { label: 'Low grass', hex: '#b9c96f', height: 55, tolerance: 42, weight: 1.2 },
  { label: 'Hill green', hex: '#8cad56', height: 130, tolerance: 42, weight: 1.25 },
  { label: 'Mountain green', hex: '#6d9949', height: 280, tolerance: 46, weight: 1.35 },
  { label: 'High mountain dark', hex: '#4f7f39', height: 430, tolerance: 55, weight: 1.4 },
  { label: 'Summit', hex: '#375f2f', height: 500, tolerance: 55, weight: 1.55 },
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

function MapPicker({ imageUrl, structureUrl, onPick }) {
  const canvasRef = useRef(null);
  React.useEffect(() => {
    if (!imageUrl) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = new Image();
    img.onload = () => {
      const maxW = 980;
      const scale = Math.min(1, maxW / img.width);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (structureUrl) {
        const s = new Image();
        s.onload = () => {
          ctx.globalAlpha = 0.65;
          ctx.drawImage(s, 0, 0, canvas.width, canvas.height);
          ctx.globalAlpha = 1;
        };
        s.src = structureUrl;
      }
    };
    img.src = imageUrl;
  }, [imageUrl, structureUrl]);

  function click(ev) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.floor((ev.clientY - rect.top) * (canvas.height / rect.height));
    const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
    onPick(hexFromRgb(data[0], data[1], data[2]), { x, y });
  }

  if (!imageUrl) return <div className="drop-hint">Upload your illustrated map or load the included island example.</div>;
  return <canvas className="map-canvas" ref={canvasRef} onClick={click} title="Click any color to sample it" />;
}

function Swatch({ color, onClick }) {
  return <button className="swatch" style={{ background: color }} onClick={onClick} title={color} />;
}

function App() {
  const viewportRef = useRef(null);
  const [stage, setStage] = useState(1);
  const [mapFile, setMapFile] = useState(null);
  const [mapUrl, setMapUrl] = useState('');
  const [waterFile, setWaterFile] = useState(null);
  const [waterUrl, setWaterUrl] = useState('');
  const [structureFile, setStructureFile] = useState(null);
  const [structureUrl, setStructureUrl] = useState('');
  const [samples, setSamples] = useState(starterSamples);
  const [picked, setPicked] = useState('#8cad56');
  const [newHeight, setNewHeight] = useState(100);
  const [dominant, setDominant] = useState([]);
  const [heightmap16, setHeightmap16] = useState('');
  const [heightPreview, setHeightPreview] = useState('');
  const [bakedHeightmap16, setBakedHeightmap16] = useState('');
  const [bakedPreview, setBakedPreview] = useState('');
  const [waterMask, setWaterMask] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [tool, setTool] = useState('smooth');
  const [selectedMaterial, setSelectedMaterial] = useState('forest');
  const [brush, setBrush] = useState({ size: 46, strength: 0.48, opacity: 0.85, flattenM: 8 });
  const [options, setOptions] = useState({
    maxHeightM: 500,
    smoothingSigma: 2.4,
    roundPeaks: 0.58,
    roundPeakRadius: 8,
    cliffStrength: 0.22,
    colorPower: 2.15,
    terraceCount: 0,
    terraceStrength: 0,
    detailPreserve: 0.18,
  });
  const [waterOptions, setWaterOptions] = useState({
    maxHeightM: 500,
    mode: 'carve',
    seaLevelM: 0,
    riverDepthM: 3,
    lakeDepthM: 1,
    carveDepthM: 4,
    bankSmoothPx: 12,
    maskThreshold: 8,
  });
  const [waterSettings, setWaterSettings] = useState({
    seaLevelM: 0,
    color: '#2db7d9',
    opacity: 0.62,
    roughness: 0.12,
    waveHeight: 1.8,
    waveSpeed: 0.55,
  });
  const finalPreview = bakedPreview || heightPreview;
  const finalHeight = bakedHeightmap16 || heightmap16;

  const recipe = useMemo(() => ({
    app: 'Island Dreamforge',
    maxHeightM: options.maxHeightM,
    samples,
    stage1Options: options,
    waterOptions,
    waterSettings,
    notes: 'Generated from user-picked map colors and reversible water masks.',
  }), [samples, options, waterOptions, waterSettings]);

  async function handleFile(file, setterFile, setterUrl) {
    if (!file) return;
    setterFile(file);
    setterUrl(await fileToDataUrl(file));
  }

  async function loadExample() {
    setBusy('Loading included island layers...'); setError('');
    try {
      const mf = await urlToFile('/examples/base_map.png', 'base_map.png');
      const wf = await urlToFile('/examples/water_layer.png', 'water_layer.png');
      const sf = await urlToFile('/examples/structure_layer.png', 'structure_layer.png');
      await handleFile(mf, setMapFile, setMapUrl);
      await handleFile(wf, setWaterFile, setWaterUrl);
      await handleFile(sf, setStructureFile, setStructureUrl);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function analyzeColors() {
    if (!mapFile) return setError('Upload a base map first.');
    setBusy('Finding dominant map colors...'); setError('');
    try {
      const form = new FormData();
      form.append('map_image', mapFile);
      form.append('count', 14);
      const data = await postForm('/api/analyze-colors', form);
      setDominant(data.colors || []);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  function addSample(hex = picked) {
    setSamples(prev => [...prev, { label: `Sample ${prev.length + 1}`, hex, height: Number(newHeight), tolerance: 36, weight: 1 }]);
  }

  function updateSample(i, patch) {
    setSamples(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  }

  async function generateHeightmap(responseFormat = 'json') {
    if (!mapFile) return setError('Upload a base map first.');
    if (!samples.length) return setError('Add at least one picked color and height.');
    setBusy(responseFormat === 'zip' ? 'Exporting Stage 1 maps...' : 'Generating height map...'); setError('');
    try {
      const form = new FormData();
      form.append('map_image', mapFile);
      form.append('samples', JSON.stringify(samples));
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
        setStage(2);
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function bakeWater(responseFormat = 'json') {
    const source = bakedHeightmap16 || heightmap16;
    if (!source) return setError('Generate Stage 1 height map first.');
    if (!waterFile) return setError('Upload a water layer first.');
    setBusy(responseFormat === 'zip' ? 'Exporting Stage 2 maps...' : 'Baking reversible water layer...'); setError('');
    try {
      const form = new FormData();
      form.append('heightmap', dataUrlToBlob(source), 'heightmap.png');
      form.append('water_map', waterFile);
      form.append('options', JSON.stringify({ ...waterOptions, maxHeightM: options.maxHeightM }));
      form.append('response_format', responseFormat);
      if (responseFormat === 'zip') {
        const blob = await postForm('/api/bake-water', form, true);
        downloadBlob(blob, 'island_water_stage2.zip');
      } else {
        const data = await postForm('/api/bake-water', form);
        setBakedHeightmap16(data.heightmap16);
        setBakedPreview(data.preview8);
        setWaterMask(data.waterMask);
        setStage(3);
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function exportMesh(fmt = 'glb') {
    setBusy(`Exporting ${fmt.toUpperCase()} mesh...`); setError('');
    try {
      const editHeightBlob = await viewportRef.current?.getHeightmapBlob();
      const textureBlob = await viewportRef.current?.getTextureBlob();
      const heightBlob = editHeightBlob || dataUrlToBlob(finalHeight);
      const form = new FormData();
      form.append('heightmap', heightBlob, 'edited_heightmap.png');
      if (textureBlob) form.append('texture', textureBlob, 'painted_texture.png');
      form.append('fmt', fmt);
      form.append('options', JSON.stringify({ maxHeightM: options.maxHeightM, widthM: 1480, meshResolution: 512, addSkirt: true }));
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
      const form = new FormData();
      form.append('heightmap', editHeightBlob || dataUrlToBlob(finalHeight), 'final_heightmap.png');
      if (textureBlob) form.append('texture', textureBlob, 'painted_texture.png');
      if (waterMask) form.append('water_mask', dataUrlToBlob(waterMask), 'water_mask.png');
      form.append('recipe', JSON.stringify(recipe));
      form.append('options', JSON.stringify({ maxHeightM: options.maxHeightM, widthM: 1480, meshResolution: 512, addSkirt: true }));
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
          <p className="eyebrow">Fantasy Map → Game Terrain</p>
          <h1>Island Dreamforge</h1>
          <p className="lede">Pick terrain colors, assign real heights, bake water masks, sculpt in 3D, paint materials, and export maps or models.</p>
        </div>
        <div className="api-pill">Backend: <span>{API_URL}</span></div>
      </header>

      <nav className="stage-tabs">
        {[1,2,3].map(n => <button key={n} className={stage === n ? 'active' : ''} onClick={() => setStage(n)}>Stage {n}</button>)}
        <button onClick={loadExample}>Load included island layers</button>
      </nav>

      {busy && <div className="banner busy">{busy}</div>}
      {error && <div className="banner error">{error}</div>}

      {stage === 1 && <section className="grid two">
        <div className="panel tall">
          <h2>1 · Teach the app your map heights</h2>
          <p className="muted">Click colors on the map, type the meter height, and add samples. The backend interpolates those colors into a 16-bit height map.</p>
          <div className="upload-row">
            <label>Base map<input type="file" accept="image/*" onChange={e => handleFile(e.target.files[0], setMapFile, setMapUrl)} /></label>
            <label>Structure/flat-protect layer<input type="file" accept="image/*" onChange={e => handleFile(e.target.files[0], setStructureFile, setStructureUrl)} /></label>
          </div>
          <MapPicker imageUrl={mapUrl} structureUrl={structureUrl} onPick={(hex) => { setPicked(hex); }} />
          <div className="picker-row">
            <div className="picked" style={{ background: picked }} />
            <input value={picked} onChange={e => setPicked(e.target.value)} />
            <label>Height m<input type="number" value={newHeight} onChange={e => setNewHeight(e.target.value)} /></label>
            <button onClick={() => addSample()}>Add picked color</button>
            <button onClick={analyzeColors}>Suggest dominant colors</button>
          </div>
          {!!dominant.length && <div className="dominant-row">{dominant.map(c => <Swatch key={c.hex} color={c.hex} onClick={() => { setPicked(c.hex); addSample(c.hex); }} />)}</div>}
        </div>

        <div className="panel">
          <h3>Height samples</h3>
          <div className="sample-list">
            {samples.map((s, i) => <div className="sample" key={`${s.hex}-${i}`}>
              <input className="sample-color" type="color" value={s.hex} onChange={e => updateSample(i, { hex: e.target.value })} />
              <input className="sample-label" value={s.label} onChange={e => updateSample(i, { label: e.target.value })} />
              <label>m<input type="number" value={s.height} onChange={e => updateSample(i, { height: Number(e.target.value) })} /></label>
              <label>tol<input type="number" value={s.tolerance} onChange={e => updateSample(i, { tolerance: Number(e.target.value) })} /></label>
              <button onClick={() => setSamples(prev => prev.filter((_, idx) => idx !== i))}>×</button>
            </div>)}
          </div>

          <h3>Island shaping</h3>
          <Slider label="Max elevation" value={options.maxHeightM} min={50} max={1200} step={10} suffix="m" onChange={v => { setOptions({ ...options, maxHeightM: v }); setWaterOptions({ ...waterOptions, maxHeightM: v }); }} />
          <Slider label="Smooth broad forms" value={options.smoothingSigma} min={0} max={8} step={0.1} onChange={v => setOptions({ ...options, smoothingSigma: v })} />
          <Slider label="Round high peaks" value={options.roundPeaks} min={0} max={1} step={0.01} onChange={v => setOptions({ ...options, roundPeaks: v })} />
          <Slider label="Peak rounding radius" value={options.roundPeakRadius} min={1} max={24} step={1} onChange={v => setOptions({ ...options, roundPeakRadius: v })} />
          <Slider label="Steepen cliff walls" value={options.cliffStrength} min={0} max={1.4} step={0.01} onChange={v => setOptions({ ...options, cliffStrength: v })} />
          <Slider label="Preserve map detail" value={options.detailPreserve} min={0} max={1} step={0.01} onChange={v => setOptions({ ...options, detailPreserve: v })} />
          <div className="actions">
            <button className="primary" onClick={() => generateHeightmap()}>Generate height map</button>
            <button onClick={() => generateHeightmap('zip')}>Export Stage 1 ZIP</button>
          </div>
          {heightPreview && <img className="preview-img" src={heightPreview} alt="Height preview" />}
        </div>
      </section>}

      {stage === 2 && <section className="grid two">
        <div className="panel tall">
          <h2>2 · Add reversible water masks</h2>
          <p className="muted">Upload waterways/ocean/lakes as a separate painted layer. It can carve, flatten, or remain paint-only, and the original height map stays available.</p>
          <label className="file-large">Water layer<input type="file" accept="image/*" onChange={e => handleFile(e.target.files[0], setWaterFile, setWaterUrl)} /></label>
          <div className="compare">
            <div><h4>Current height</h4>{heightPreview && <img src={heightPreview} />}</div>
            <div><h4>Water layer</h4>{waterUrl ? <img src={waterUrl} /> : <div className="drop-hint">Upload water layer</div>}</div>
            <div><h4>Baked result</h4>{bakedPreview ? <img src={bakedPreview} /> : <div className="drop-hint">Bake to preview</div>}</div>
          </div>
        </div>
        <div className="panel">
          <h3>Water bake settings</h3>
          <label>Mode<select value={waterOptions.mode} onChange={e => setWaterOptions({ ...waterOptions, mode: e.target.value })}>
            <option value="carve">Carve into terrain</option>
            <option value="flatten">Flatten water bodies</option>
            <option value="paint-only">Paint-only reversible layer</option>
          </select></label>
          <Slider label="Sea level" value={waterOptions.seaLevelM} min={0} max={80} step={1} suffix="m" onChange={v => { setWaterOptions({ ...waterOptions, seaLevelM: v }); setWaterSettings({ ...waterSettings, seaLevelM: v }); }} />
          <Slider label="River / stream cut" value={waterOptions.carveDepthM} min={0} max={40} step={1} suffix="m" onChange={v => setWaterOptions({ ...waterOptions, carveDepthM: v })} />
          <Slider label="Bank smoothing" value={waterOptions.bankSmoothPx} min={0} max={80} step={1} suffix="px" onChange={v => setWaterOptions({ ...waterOptions, bankSmoothPx: v })} />
          <Slider label="Mask threshold" value={waterOptions.maskThreshold} min={1} max={80} step={1} onChange={v => setWaterOptions({ ...waterOptions, maskThreshold: v })} />
          <div className="actions">
            <button className="primary" onClick={() => bakeWater()}>Bake water layer</button>
            <button onClick={() => { setBakedHeightmap16(''); setBakedPreview(''); setWaterMask(''); }}>Revert bake</button>
            <button onClick={() => bakeWater('zip')}>Export Stage 2 ZIP</button>
          </div>
          <h3>3D water appearance</h3>
          <label>Water color<input type="color" value={waterSettings.color} onChange={e => setWaterSettings({ ...waterSettings, color: e.target.value })} /></label>
          <Slider label="Opacity" value={waterSettings.opacity} min={0.1} max={1} step={0.01} onChange={v => setWaterSettings({ ...waterSettings, opacity: v })} />
          <Slider label="Wave height" value={waterSettings.waveHeight} min={0} max={8} step={0.1} suffix="m" onChange={v => setWaterSettings({ ...waterSettings, waveHeight: v })} />
          <Slider label="Wave speed" value={waterSettings.waveSpeed} min={0} max={2} step={0.01} onChange={v => setWaterSettings({ ...waterSettings, waveSpeed: v })} />
        </div>
      </section>}

      {stage === 3 && <section className="stage3">
        <aside className="panel tools">
          <h2>3 · Sculpt, paint, view, export</h2>
          <div className="tool-grid">
            {['raise','lower','smooth','flatten','paint'].map(t => <button key={t} className={tool === t ? 'active' : ''} onClick={() => setTool(t)}>{t}</button>)}
          </div>
          <Slider label="Brush size" value={brush.size} min={4} max={180} step={1} suffix="px" onChange={v => setBrush({ ...brush, size: v })} />
          <Slider label="Brush strength" value={brush.strength} min={0.02} max={1} step={0.01} onChange={v => setBrush({ ...brush, strength: v })} />
          <Slider label="Paint opacity" value={brush.opacity} min={0.05} max={1} step={0.01} onChange={v => setBrush({ ...brush, opacity: v })} />
          <Slider label="Flatten height" value={brush.flattenM} min={0} max={options.maxHeightM} step={1} suffix="m" onChange={v => setBrush({ ...brush, flattenM: v })} />
          <h3>Paint material</h3>
          <div className="material-list">
            {MATERIALS.map(m => <button key={m.id} className={selectedMaterial === m.id ? 'active' : ''} onClick={() => { setSelectedMaterial(m.id); setTool('paint'); }}>{m.label}</button>)}
          </div>
          <button onClick={() => viewportRef.current?.autoTexture()}>Auto texture by height</button>
          <button onClick={() => viewportRef.current?.resetCamera()}>Reset camera</button>
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
        </aside>
        <div className="viewer-wrap">
          {finalPreview ? <TerrainViewport ref={viewportRef} heightUrl={finalPreview} maxHeightM={options.maxHeightM} tool={tool} brush={brush} selectedMaterial={selectedMaterial} waterSettings={waterSettings} /> : <div className="drop-hint big">Generate Stage 1 first, then the 3D viewport appears here.</div>}
        </div>
      </section>}
    </div>
  );
}

function Slider({ label, value, min, max, step, suffix = '', onChange }) {
  return <label className="slider"><span>{label}<b>{value}{suffix}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} /></label>;
}

export default App;
