import React from 'react';
import { Slider } from './studioUi.jsx';
import { MATERIALS } from './TerrainViewport.jsx';
import { getMetersPerPixel } from './worldSettings.js';
import { DEFAULT_WATER_PAINT_COLOR } from './riverTexturePaint.js';
import { PATH_COLOR_PRESETS } from './detailSettings.js';

/** Shared overlay card for water / structure / marker / texture (not flat sections). */
export function SceneLayerCard({
  layer,
  active,
  onSelect,
  onChange,
  onFile,
  onAnalyze,
  onExport,
  onDelete,
  onClear,
  worldSettings = {},
  mapSizePx = {},
  variant = 'card',
  children,
}) {
  const mpp = getMetersPerPixel(worldSettings, mapSizePx);
  const isWater = layer.kind === 'water';
  const flat = variant === 'section';

  return (
    <div
      className={
        flat
          ? `water-layer-section ${active ? 'active' : ''} ${!layer.enabled ? 'disabled' : ''}`
          : `layer-card ${active ? 'active' : ''} ${!layer.enabled ? 'disabled' : ''}`
      }
      onClick={() => onSelect(layer.id)}
    >
      <div className={flat ? 'water-layer-head' : 'layer-head'}>
        <input value={layer.name} onChange={(e) => onChange({ name: e.target.value })} onClick={(e) => e.stopPropagation()} />
        <span className="small muted">{layer.kind}</span>
      </div>
      <div className={flat ? 'water-layer-toolbar' : 'layer-toolbar'} onClick={(e) => e.stopPropagation()}>
        <label className="checkline mini">
          <input type="checkbox" checked={layer.enabled !== false} onChange={(e) => onChange({ enabled: e.target.checked })} />
          Visible
        </label>
        <button type="button" onClick={onClear}>Clear</button>
        <button type="button" className="danger" onClick={onDelete}>Delete</button>
      </div>
      <div className={flat ? 'water-layer-body' : 'layer-body'} onClick={(e) => e.stopPropagation()}>
        <label className="file-small">
          Overlay image
          <input type="file" accept="image/*" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {layer.url && (
          <div className="thumb-wrap compact-thumb">
            <button
              type="button"
              className="thumb-x"
              onClick={(e) => { e.stopPropagation(); onChange({ file: null, url: '', analysis: null }); }}
              title="Remove overlay image"
            >
              ×
            </button>
            <img className={flat ? 'water-layer-thumb' : 'layer-thumb'} src={layer.url} alt="" />
          </div>
        )}

        {isWater && (
          <>
            {mapSizePx?.width > 0 && !flat && (
              <p className="small muted">
                PNG aligned to {mapSizePx.width}×{mapSizePx.height}px
                {mpp > 0 ? ` · ~${mpp.toFixed(1)} m/px` : ''}. Mask only — shape rivers in Inland shaping below.
              </p>
            )}
            <label className="color-field">
              Water color
              <input
                type="color"
                value={layer.paintColor || DEFAULT_WATER_PAINT_COLOR}
                onChange={(e) => onChange({ paintColor: e.target.value })}
              />
            </label>
            <Slider
              label="Paint strength"
              value={layer.paintStrength ?? 1}
              min={0.3}
              max={1.5}
              step={0.05}
              onChange={(v) => onChange({ paintStrength: v })}
            />
            <Slider
              label="Mask sensitivity"
              value={layer.maskThreshold ?? 8}
              min={1}
              max={64}
              step={1}
              onChange={(v) => onChange({ maskThreshold: v })}
            />
          </>
        )}
        {layer.kind === 'structure' && (
          <>
            <label>
              Shape
              <select value={layer.shape || 'box'} onChange={(e) => onChange({ shape: e.target.value })}>
                <option value="box">Box footprint</option>
                <option value="cylinder">Cylinder footprint</option>
                <option value="sphere">Sphere islands</option>
              </select>
            </label>
            <Slider label="Object height" value={layer.objectHeightM ?? 8} min={1} max={120} step={1} suffix="m" onChange={(v) => onChange({ objectHeightM: v })} />
          </>
        )}
        {layer.kind === 'path' && (
          <>
            {mapSizePx?.width > 0 && (
              <p className="small muted">
                PNG aligned to {mapSizePx.width}×{mapSizePx.height}px
                {mpp > 0 ? ` · ~${mpp.toFixed(1)} m/px` : ''}. White strokes paint sandy/dirt paths.
              </p>
            )}
            <label>
              Path color
              <select value={layer.colorPreset || 'sand'} onChange={(e) => onChange({ colorPreset: e.target.value })}>
                {Object.keys(PATH_COLOR_PRESETS).map((k) => (
                  <option key={k} value={k}>{k.replace('_', ' ')}</option>
                ))}
              </select>
            </label>
            <Slider label="Mask sensitivity" value={layer.maskThreshold ?? 8} min={1} max={64} step={1} onChange={(v) => onChange({ maskThreshold: v })} />
            <Slider label="Edge softness" value={layer.edgeSoftness ?? 0.55} min={0} max={1} step={0.01} onChange={(v) => onChange({ edgeSoftness: v })} />
          </>
        )}
        {layer.kind === 'marker' && (
          <>
            <label>
              Landmark type
              <select value={layer.markerType || 'poi'} onChange={(e) => onChange({ markerType: e.target.value })}>
                <option value="poi">POI cone</option>
                <option value="windmill">Windmill</option>
                <option value="tower">Tower</option>
                <option value="flag">Flag</option>
                <option value="shrine">Shrine</option>
              </select>
            </label>
            <label>Name prefix<input value={layer.namePrefix || 'Point'} onChange={(e) => onChange({ namePrefix: e.target.value })} /></label>
            <Slider label="Marker scale" value={layer.radiusM ?? 4} min={2} max={20} step={0.5} suffix="m" onChange={(v) => onChange({ radiusM: v })} />
          </>
        )}
        {layer.kind === 'dock' && (
          <>
            <p className="small muted">Place dock mask near shoreline; analyze to align pier planks.</p>
            <Slider label="Pier length" value={layer.plankLengthM ?? 8} min={3} max={30} step={0.5} suffix="m" onChange={(v) => onChange({ plankLengthM: v })} />
            <Slider label="Orientation" value={layer.orientationDeg ?? 0} min={-180} max={180} step={5} suffix="°" onChange={(v) => onChange({ orientationDeg: v })} />
          </>
        )}
        {layer.kind === 'texture' && (
          <>
            <label>
              Material
              <select value={layer.material || 'trees'} onChange={(e) => onChange({ material: e.target.value })}>
                {MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <Slider label="Noise" value={layer.noise ?? 0.35} min={0} max={1} step={0.01} onChange={(v) => onChange({ noise: v })} />
          </>
        )}

        {children}

        {!isWater && (
          <div className="actions compact">
            <button type="button" onClick={onAnalyze}>Analyze layer</button>
            {layer.analysis && <button type="button" onClick={onExport}>Export JSON</button>}
          </div>
        )}
        {!isWater && layer.analysis && (
          <p className="small muted">{layer.analysis.featureCount} feature(s).</p>
        )}
      </div>
    </div>
  );
}
