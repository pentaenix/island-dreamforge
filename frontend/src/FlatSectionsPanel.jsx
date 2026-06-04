import React, { useState } from 'react';
import { Slider } from './studioUi.jsx';

/**
 * Flat sections belong in step 1: height comes from the color map, then masks soften those areas.
 */
export default function FlatSectionsPanel({
  layers = [],
  applyFlatSections = true,
  showFlatMaskOnMap = true,
  onApplyFlatSectionsChange,
  onShowFlatMaskOnMapChange,
  onAdd,
  onUpdate,
  onDelete,
  onClear,
  onSetFile,
}) {
  const [open, setOpen] = useState(layers.length > 0);

  return (
    <div className="height-overlays-panel">
      <button
        type="button"
        className="collapsible-head samples-dock-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>Flat sections ({layers.length})</span>
        <span className="collapsible-chevron">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="height-overlays-body">
          <p className="small muted">
            Paint mesas and pads on a transparent PNG aligned with the base map. The mask draws on the color map at
            80% opacity so you can line it up. <b>Flatten strength</b> pulls heights toward your color ladder in that
            zone without a hard plane — leave room for buildings and paths later.
          </p>
          <label className="checkline">
            <input
              type="checkbox"
              checked={showFlatMaskOnMap}
              onChange={(e) => onShowFlatMaskOnMapChange?.(e.target.checked)}
            />
            Show flat mask on base map (80% visible)
          </label>
          <label className="checkline">
            <input
              type="checkbox"
              checked={applyFlatSections}
              onChange={(e) => onApplyFlatSectionsChange?.(e.target.checked)}
            />
            Apply flat sections when generating height map
          </label>
          <div className="actions compact">
            <button type="button" onClick={onAdd}>+ Flat section</button>
          </div>
          {!layers.length && (
            <div className="drop-hint small">Optional — skip if you do not need mesas, pads, or terraces.</div>
          )}
          {layers.map((layer) => (
            <div key={layer.id} className={`flat-section-card ${layer.enabled === false ? 'disabled' : ''}`}>
              <div className="flat-section-head">
                <input
                  value={layer.name}
                  onChange={(e) => onUpdate(layer.id, { name: e.target.value })}
                  aria-label="Layer name"
                />
                <label className="checkline mini">
                  <input
                    type="checkbox"
                    checked={layer.enabled !== false}
                    onChange={(e) => onUpdate(layer.id, { enabled: e.target.checked })}
                  />
                  On
                </label>
                <button type="button" className="danger" onClick={() => onDelete(layer.id)}>Delete</button>
              </div>
              <label className="file-small">
                Mask image (aligned with base map)
                <input type="file" accept="image/*" onChange={(e) => onSetFile(layer.id, e.target.files?.[0])} />
              </label>
              {layer.url && (
                <div className="thumb-wrap">
                  <button
                    type="button"
                    className="thumb-x"
                    onClick={() => onClear(layer.id)}
                    title="Remove mask image"
                  >
                    ×
                  </button>
                  <img className="layer-thumb" src={layer.url} alt="" />
                </div>
              )}
              <Slider
                label="Flatten strength"
                value={layer.flattenStrength ?? 0.72}
                min={0}
                max={1}
                step={0.02}
                onChange={(v) => onUpdate(layer.id, { flattenStrength: v })}
              />
              <p className="small muted flat-strength-hint">
                0 = normal slopes · 1 = hard flat. Try 0.55–0.8 for pads that will get buildings and paths.
              </p>
              <Slider
                label="Mask sensitivity"
                value={layer.maskThreshold ?? 8}
                min={1}
                max={40}
                step={1}
                onChange={(v) => onUpdate(layer.id, { maskThreshold: v })}
              />
              <Slider
                label="Edge blend"
                value={layer.edgeSoftPx ?? 6}
                min={0}
                max={40}
                step={1}
                suffix="px"
                onChange={(v) => onUpdate(layer.id, { edgeSoftPx: v })}
              />
              <label>
                Target height
                <select
                  value={layer.heightMode || 'median'}
                  onChange={(e) => onUpdate(layer.id, { heightMode: e.target.value })}
                >
                  <option value="median">Median from color map</option>
                  <option value="mean">Average from color map</option>
                </select>
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
