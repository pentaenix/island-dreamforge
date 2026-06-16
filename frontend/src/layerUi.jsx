import React from 'react';
import { Slider } from './studioUi.jsx';
import { MATERIALS } from './TerrainViewport.jsx';
import { getMetersPerPixel } from './worldSettings.js';
import { DEFAULT_WATER_PAINT_COLOR } from './riverTexturePaint.js';

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
        {layer.kind === 'marker' && (
          <>
            <label>Marker type<input value={layer.markerType || 'poi'} onChange={(e) => onChange({ markerType: e.target.value })} /></label>
            <label>Name prefix<input value={layer.namePrefix || 'Point'} onChange={(e) => onChange({ namePrefix: e.target.value })} /></label>
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
