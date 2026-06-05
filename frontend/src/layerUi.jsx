import React from 'react';
import { Slider } from './studioUi.jsx';
import { MATERIALS } from './TerrainViewport.jsx';
import { getMetersPerPixel } from './worldSettings.js';
import { getWaterLayerSliderLimits } from './waterOverlaySettings.js';
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
  children,
}) {
  const mpp = getMetersPerPixel(worldSettings, mapSizePx);
  const isWater = layer.kind === 'water';
  const waterLimits = getWaterLayerSliderLimits(worldSettings);

  return (
    <div
      className={`layer-card ${active ? 'active' : ''} ${!layer.enabled ? 'disabled' : ''}`}
      onClick={() => onSelect(layer.id)}
    >
      <div className="layer-head">
        <input value={layer.name} onChange={(e) => onChange({ name: e.target.value })} onClick={(e) => e.stopPropagation()} />
        <span className="small muted">{layer.kind}</span>
      </div>
      <div className="layer-toolbar" onClick={(e) => e.stopPropagation()}>
        <label className="checkline mini">
          <input type="checkbox" checked={layer.enabled !== false} onChange={(e) => onChange({ enabled: e.target.checked })} />
          Visible
        </label>
        <button type="button" onClick={onClear}>Clear</button>
        <button type="button" className="danger" onClick={onDelete}>Delete</button>
      </div>
      <div className="layer-body" onClick={(e) => e.stopPropagation()}>
        <label className="file-small">
          Overlay image
          <input type="file" accept="image/*" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {layer.url && (
          <div className="thumb-wrap">
            <button
              type="button"
              className="thumb-x"
              onClick={(e) => { e.stopPropagation(); onChange({ file: null, url: '', analysis: null }); }}
              title="Remove overlay image"
            >
              ×
            </button>
            <img className="layer-thumb" src={layer.url} alt="" />
          </div>
        )}

        {isWater && (
          <>
            {mapSizePx?.width > 0 && (
              <p className="small muted">
                PNG aligned to {mapSizePx.width}×{mapSizePx.height}px
                {mpp > 0 ? ` · ~${mpp.toFixed(1)} m/px` : ''}. Paint mask strokes anywhere — color is set below, not from the image.
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
              value={layer.paintStrength ?? 0.92}
              min={0.2}
              max={1}
              step={0.02}
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
            <label className="checkline mini">
              <input
                type="checkbox"
                checked={layer.lakeFlattenEnabled !== false}
                onChange={(e) => onChange({ lakeFlattenEnabled: e.target.checked })}
              />
              Flatten lake beds on 3D mesh
            </label>
            {layer.lakeFlattenEnabled !== false && (
              <>
                <Slider
                  label="Lake flatten amount"
                  value={layer.lakeFlattenStrength ?? 0.55}
                  min={0.1}
                  max={1}
                  step={0.05}
                  onChange={(v) => onChange({ lakeFlattenStrength: v })}
                />
                <Slider
                  label="Lake shelf depth"
                  value={layer.lakeDepthM ?? 0.75}
                  min={0.1}
                  max={waterLimits.lakeDepthMax}
                  step={0.1}
                  suffix="m"
                  onChange={(v) => onChange({ lakeDepthM: v })}
                />
              </>
            )}
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
