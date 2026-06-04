import React from 'react';
import { Slider } from './studioUi.jsx';
import { MATERIALS } from './TerrainViewport.jsx';

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
  children,
}) {
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
            <img className="layer-thumb" src={layer.analysis?.preview || layer.url} alt="" />
          </div>
        )}

        {layer.kind === 'water' && (
          <>
            <label>
              Water effect
              <select value={layer.mode || 'visual-only'} onChange={(e) => onChange({ mode: e.target.value })}>
                <option value="visual-only">Visual only — no terrain change</option>
                <option value="shallow-indent">Small indent for water bed</option>
                <option value="riverbed">Riverbed / stream groove</option>
                <option value="lake-flatten">Flatten calm lakes locally</option>
                <option value="ocean-shore">Ocean shoreline shelf</option>
              </select>
            </label>
            <Slider label="Indent depth" value={layer.carveDepthM ?? 1.5} min={0} max={12} step={0.1} suffix="m" onChange={(v) => onChange({ carveDepthM: v })} />
            <Slider label="Bank softness" value={layer.bankSmoothPx ?? 14} min={0} max={90} step={1} suffix="px" onChange={(v) => onChange({ bankSmoothPx: v })} />
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

        <div className="actions compact">
          <button type="button" onClick={onAnalyze}>Analyze layer</button>
          {layer.analysis && <button type="button" onClick={onExport}>Export JSON</button>}
        </div>
        {layer.analysis && (
          <p className="small muted">{layer.analysis.featureCount} feature(s).</p>
        )}
      </div>
    </div>
  );
}
