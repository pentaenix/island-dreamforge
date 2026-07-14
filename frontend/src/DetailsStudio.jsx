import React from 'react';
import { SceneLayerCard } from './layerUi.jsx';
import { Slider, CollapsibleSection } from './studioUi.jsx';
import {
  DEFAULT_DETAIL_SETTINGS,
  PATH_COLOR_PRESETS,
  pokemonResortDressingPreset,
} from './detailSettings.js';
import ModelPackPanel from './ModelPackPanel.jsx';

function DetailSection({ title, enabled, onToggle, children }) {
  return (
    <CollapsibleSection title={title} defaultOpen>
      <label className="checkline mini">
        <input type="checkbox" checked={enabled !== false} onChange={(e) => onToggle(e.target.checked)} />
        Enabled
      </label>
      {children}
    </CollapsibleSection>
  );
}

export default function DetailsStudio({
  detailSettings,
  setDetailSettings,
  layers,
  activeLayer,
  onSelectLayer,
  onUpdateLayer,
  onLayerFile,
  onAnalyzeLayer,
  onExportLayer,
  onDeleteLayer,
  onClearLayer,
  onAddLayer,
  onAddHilltopWindmill,
  worldSettings,
  mapSizePx,
  derivedMaps,
  onOpen3D,
  onRegenerateTrees,
  onRefreshPaths,
  canPreview,
}) {
  const patch = (section, key, value) => {
    setDetailSettings((prev) => ({
      ...prev,
      [section]: { ...(prev[section] || DEFAULT_DETAIL_SETTINGS[section]), [key]: value },
    }));
  };

  const overlayLayers = layers.filter((l) => !['flat', 'water'].includes(l.kind));
  const pathLayers = layers.filter((l) => l.kind === 'path');
  const sceneLayers = layers.filter((l) => ['structure', 'marker', 'dock', 'texture', 'path'].includes(l.kind));

  return (
    <section className="details-stage stage3">
      <aside className="panel tools details-controls">
        <h2>4 · Details</h2>
        <p className="muted">
          Visual dressing only — paths, procedural accents, resort pockets, docks, landmarks, and uploaded GLB model packs.
          Does not change height generation or terrain shape.
        </p>

        <div className="actions compact">
          <button type="button" className="primary" onClick={() => setDetailSettings(pokemonResortDressingPreset())}>
            Pokémon resort dressing preset
          </button>
          <button type="button" className="primary" onClick={onOpen3D} disabled={!canPreview}>
            Open 3D preview →
          </button>
        </div>

        <h3>Add overlay layers</h3>
        <div className="tool-grid">
          <button type="button" onClick={() => onAddLayer('path')}>+ Path mask</button>
          <button type="button" onClick={() => onAddLayer('structure')}>+ Structure / resort</button>
          <button type="button" onClick={() => onAddLayer('dock')}>+ Dock</button>
          <button type="button" onClick={() => onAddLayer('marker')}>+ Landmark</button>
          <button type="button" onClick={() => onAddLayer('texture')}>+ Texture mask</button>
        </div>
        <div className="actions compact">
          <button type="button" onClick={onAddHilltopWindmill}>Hilltop windmill marker</button>
          <button type="button" onClick={onRefreshPaths} disabled={!pathLayers.some((l) => l.url)}>
            Refresh path paint
          </button>
          <button type="button" onClick={onRegenerateTrees}>Regenerate forest clumps</button>
        </div>

        <ModelPackPanel
          modelPacks={detailSettings.modelPacks}
          setModelPacks={(updater) => {
            setDetailSettings((prev) => {
              const nextPacks = typeof updater === 'function' ? updater(prev.modelPacks || []) : updater;
              return { ...prev, modelPacks: nextPacks };
            });
          }}
          layers={layers}
        />

        <DetailSection
          title="Paths"
          enabled={detailSettings.paths?.enabled}
          onToggle={(v) => patch('paths', 'enabled', v)}
        >
          <label>
            Path color
            <select
              value={detailSettings.paths?.colorPreset || 'sand'}
              onChange={(e) => patch('paths', 'colorPreset', e.target.value)}
            >
              {Object.keys(PATH_COLOR_PRESETS).map((k) => (
                <option key={k} value={k}>{k.replace('_', ' ')}</option>
              ))}
            </select>
          </label>
          <Slider label="Mask sensitivity" value={detailSettings.paths?.maskThreshold ?? 8} min={1} max={64} step={1} onChange={(v) => patch('paths', 'maskThreshold', v)} />
          <Slider label="Edge softness" value={detailSettings.paths?.edgeSoftness ?? 0.55} min={0} max={1} step={0.01} onChange={(v) => patch('paths', 'edgeSoftness', v)} />
          <Slider label="Vegetation clear radius" value={detailSettings.paths?.vegetationClearRadiusM ?? 4} min={0} max={20} step={0.5} suffix="m" onChange={(v) => patch('paths', 'vegetationClearRadiusM', v)} />
        </DetailSection>

        <DetailSection
          title="Beach palms"
          enabled={detailSettings.beachPalms?.enabled}
          onToggle={(v) => patch('beachPalms', 'enabled', v)}
        >
          <Slider label="Density" value={detailSettings.beachPalms?.density ?? 0.42} min={0} max={1} step={0.01} onChange={(v) => patch('beachPalms', 'density', v)} />
          <Slider label="Max count" value={detailSettings.beachPalms?.maxCount ?? 120} min={10} max={400} step={5} onChange={(v) => patch('beachPalms', 'maxCount', v)} />
          <Slider label="Min distance to water" value={detailSettings.beachPalms?.minDistanceToWaterM ?? 2} min={0} max={30} step={0.5} suffix="m" onChange={(v) => patch('beachPalms', 'minDistanceToWaterM', v)} />
          <Slider label="Max distance to water" value={detailSettings.beachPalms?.maxDistanceToWaterM ?? 35} min={5} max={80} step={1} suffix="m" onChange={(v) => patch('beachPalms', 'maxDistanceToWaterM', v)} />
          <Slider label="Scale min" value={detailSettings.beachPalms?.scaleMin ?? 4} min={2} max={12} step={0.5} suffix="m" onChange={(v) => patch('beachPalms', 'scaleMin', v)} />
          <Slider label="Scale max" value={detailSettings.beachPalms?.scaleMax ?? 9} min={3} max={18} step={0.5} suffix="m" onChange={(v) => patch('beachPalms', 'scaleMax', v)} />
        </DetailSection>

        <DetailSection
          title="Rock scars"
          enabled={detailSettings.rockScars?.enabled}
          onToggle={(v) => patch('rockScars', 'enabled', v)}
        >
          <Slider label="Slope start" value={detailSettings.rockScars?.slopeStartDeg ?? 38} min={15} max={70} step={1} suffix="°" onChange={(v) => patch('rockScars', 'slopeStartDeg', v)} />
          <Slider label="Slope full" value={detailSettings.rockScars?.slopeFullDeg ?? 58} min={25} max={85} step={1} suffix="°" onChange={(v) => patch('rockScars', 'slopeFullDeg', v)} />
          <Slider label="Min height" value={detailSettings.rockScars?.minHeightM ?? 40} min={0} max={300} step={2} suffix="m" onChange={(v) => patch('rockScars', 'minHeightM', v)} />
          <Slider label="Density / noise" value={detailSettings.rockScars?.density ?? 0.55} min={0} max={1} step={0.01} onChange={(v) => patch('rockScars', 'density', v)} />
          <Slider label="Warmth" value={detailSettings.rockScars?.warmth ?? 0.72} min={0} max={1} step={0.01} onChange={(v) => patch('rockScars', 'warmth', v)} />
        </DetailSection>

        <DetailSection
          title="Resort buildings"
          enabled={detailSettings.resort?.enabled}
          onToggle={(v) => patch('resort', 'enabled', v)}
        >
          <Slider label="Buildings per structure mask" value={detailSettings.resort?.buildingsPerComponent ?? 4} min={1} max={12} step={1} onChange={(v) => patch('resort', 'buildingsPerComponent', v)} />
          <Slider label="Size min" value={detailSettings.resort?.sizeMinM ?? 3} min={1} max={20} step={0.5} suffix="m" onChange={(v) => patch('resort', 'sizeMinM', v)} />
          <Slider label="Size max" value={detailSettings.resort?.sizeMaxM ?? 8} min={2} max={30} step={0.5} suffix="m" onChange={(v) => patch('resort', 'sizeMaxM', v)} />
          <label>
            Color preset
            <select value={detailSettings.resort?.colorPreset || 'resort-light'} onChange={(e) => patch('resort', 'colorPreset', e.target.value)}>
              <option value="resort-light">resort-light</option>
              <option value="roof-red">roof-red</option>
              <option value="neutral">neutral</option>
            </select>
          </label>
          <label className="checkline mini">
            <input type="checkbox" checked={detailSettings.resort?.flattenGround !== false} onChange={(e) => patch('resort', 'flattenGround', e.target.checked)} />
            Flatten ground under buildings
          </label>
        </DetailSection>

        <DetailSection
          title="Docks"
          enabled={detailSettings.docks?.enabled}
          onToggle={(v) => patch('docks', 'enabled', v)}
        >
          <Slider label="Plank width" value={detailSettings.docks?.plankWidthM ?? 2.2} min={1} max={8} step={0.2} suffix="m" onChange={(v) => patch('docks', 'plankWidthM', v)} />
          <Slider label="Pier length" value={detailSettings.docks?.plankLengthM ?? 8} min={3} max={30} step={0.5} suffix="m" onChange={(v) => patch('docks', 'plankLengthM', v)} />
        </DetailSection>

        <DetailSection
          title="Canopy variation"
          enabled={detailSettings.canopy?.enabled}
          onToggle={(v) => patch('canopy', 'enabled', v)}
        >
          <Slider label="Canopy density" value={detailSettings.canopy?.canopyDensity ?? 0.88} min={0} max={1} step={0.01} onChange={(v) => patch('canopy', 'canopyDensity', v)} />
          <Slider label="Max clumps" value={detailSettings.canopy?.canopyMaxCount ?? 4200} min={100} max={9000} step={50} onChange={(v) => patch('canopy', 'canopyMaxCount', v)} />
          <Slider label="Scale min" value={detailSettings.canopy?.canopyScaleMin ?? 4} min={2} max={14} step={0.5} suffix="m" onChange={(v) => patch('canopy', 'canopyScaleMin', v)} />
          <Slider label="Scale max" value={detailSettings.canopy?.canopyScaleMax ?? 16} min={4} max={24} step={0.5} suffix="m" onChange={(v) => patch('canopy', 'canopyScaleMax', v)} />
          <Slider label="Color variation" value={detailSettings.canopy?.colorVariation ?? 0.35} min={0} max={1} step={0.01} onChange={(v) => patch('canopy', 'colorVariation', v)} />
          <label className="checkline mini">
            <input type="checkbox" checked={detailSettings.canopy?.accentClumps !== false} onChange={(e) => patch('canopy', 'accentClumps', e.target.checked)} />
            Accent clumps
          </label>
        </DetailSection>

        <h3>Scene overlays</h3>
        <p className="small muted">PNG masks for paths, structures, docks, landmarks, and texture hints.</p>
        <div className="layer-list compact-list">
          {sceneLayers.map((layer) => (
            <SceneLayerCard
              key={layer.id}
              layer={layer}
              active={activeLayer?.id === layer.id}
              onSelect={onSelectLayer}
              onChange={(patchLayer) => onUpdateLayer(layer.id, patchLayer)}
              onFile={(file) => onLayerFile(layer.id, file)}
              onAnalyze={() => onAnalyzeLayer(layer)}
              onExport={() => onExportLayer(layer)}
              onDelete={() => onDeleteLayer(layer.id)}
              onClear={() => onClearLayer(layer.id)}
              worldSettings={worldSettings}
              mapSizePx={mapSizePx}
            />
          ))}
        </div>
        {activeLayer?.analysis && !['water', 'flat'].includes(activeLayer.kind) && (
          <pre className="json-preview">{JSON.stringify({ summary: activeLayer.analysis.summary, firstFeatures: activeLayer.analysis.features?.slice(0, 4) }, null, 2)}</pre>
        )}
      </aside>

      <div className="panel details-preview-panel">
        <h3>3D preview</h3>
        <p className="small muted">
          Step 4 is for dressing controls only — no live 3D engine here (keeps the UI responsive with large GLB packs).
          Open <b>Step 5 · 3D / Export</b> to see paths, model packs, and forest clumps on the island.
        </p>
        <div className="actions compact">
          <button type="button" className="primary" onClick={onOpen3D} disabled={!canPreview}>
            Open 3D preview →
          </button>
          <button type="button" onClick={onRegenerateTrees} disabled={!canPreview}>
            Refresh 3D dressing
          </button>
        </div>
        {derivedMaps?.materialIds && (
          <figure className="details-map-thumb">
            <img src={derivedMaps.materialIds} alt="Material preview" />
            <figcaption className="small muted">Derived material map (step 1)</figcaption>
          </figure>
        )}
        <details className="details-help">
          <summary>Tips</summary>
          <ul className="small muted">
            <li>Path masks are grayscale PNGs aligned to your map — white strokes become sandy trails.</li>
            <li>Analyze structure/dock/marker layers after uploading so 3D objects snap to mask regions.</li>
            <li>Model packs use one generic placement evaluator — upload any GLB, pick a mode, tune rules per pack.</li>
            <li>Forest clumps avoid rivers, paths, structures, docks, and model-pack clear zones.</li>
            <li>Material paint tools live in step 5 · 3D / Export.</li>
          </ul>
        </details>
      </div>
    </section>
  );
}
