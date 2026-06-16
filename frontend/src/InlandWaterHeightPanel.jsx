import React, { useMemo } from 'react';
import { Slider } from './studioUi.jsx';
import { inlandWaterProcessOptionsFromLayers } from './inlandWaterHeightProcess.js';
import { getWaterLayerSliderLimits } from './waterOverlaySettings.js';

/**
 * Step 3 sidebar — inland water height shaping (lakes, river carve, sand banks).
 * embedded=true: flat sidebar section without panel border or preview images.
 */
export default function InlandWaterHeightPanel({
  layers = [],
  worldSettings = {},
  mapSizePx = {},
  maxHeightM = 500,
  applied = false,
  busy = false,
  pipelinePreview = null,
  onProcPatch,
  onMaskSmoothChange,
  embedded = false,
}) {
  const waterLayers = useMemo(
    () => (layers || []).filter((l) => l.kind === 'water' && l.enabled !== false && l.url),
    [layers],
  );
  const limits = getWaterLayerSliderLimits(worldSettings);
  const procOptions = useMemo(
    () => inlandWaterProcessOptionsFromLayers(waterLayers, worldSettings, mapSizePx, maxHeightM) || {},
    [waterLayers, worldSettings, mapSizePx, maxHeightM],
  );

  const patchOption = (key, value) => {
    onProcPatch?.(key, value);
    if (key === 'riverMaskSmoothPx') onMaskSmoothChange?.(value);
  };

  if (!waterLayers.length) {
    if (!embedded) return null;
    return (
      <div className="sidebar-section inland-water-section">
        <h3>Inland shaping</h3>
        <p className="small muted">Add a water overlay above to flatten lakes, carve rivers, and paint sand banks. Applies automatically on Step 4.</p>
      </div>
    );
  }

  const summary = pipelinePreview?.summary;
  const Tag = embedded ? 'div' : 'section';
  const rootClass = embedded
    ? 'sidebar-section inland-water-section'
    : 'inland-water-panel panel';

  return (
    <Tag className={rootClass}>
      <h3>Inland shaping</h3>
      <p className="small muted">
        Lakes flatten, rivers carve into terrain, optional sand on banks. Step 4 picks this up automatically.
      </p>
      {busy && <p className="small muted">Processing…</p>}

      <div className="inland-water-sliders">
        <Slider
          label="River carve depth"
          value={procOptions.riverCarveDepthM ?? 1.5}
          min={0}
          max={limits.carveDepthMax}
          step={0.1}
          suffix="m"
          onChange={(v) => patchOption('riverCarveDepthM', v)}
        />
        <Slider
          label="River channel strength"
          value={procOptions.riverChannelStrength ?? 0.65}
          min={0.2}
          max={1}
          step={0.05}
          onChange={(v) => patchOption('riverChannelStrength', v)}
        />
        <Slider
          label="River mask smooth"
          value={procOptions.riverMaskSmoothPx ?? 3}
          min={0}
          max={16}
          step={1}
          suffix="px"
          onChange={(v) => patchOption('riverMaskSmoothPx', v)}
        />
        <Slider
          label="River slim"
          value={procOptions.riverSlimPx ?? 0}
          min={0}
          max={12}
          step={1}
          suffix="px"
          onChange={(v) => patchOption('riverSlimPx', v)}
        />
        <Slider
          label="Sand banks"
          value={procOptions.sandBankAmount ?? 0}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => patchOption('sandBankAmount', v)}
        />
        <p className="small muted inland-water-hint">
          Sand around rivers and lakes on the 3D texture. Zero is off; low values add a thin strip, higher values widen the beach band.
        </p>
        <Slider
          label="Lake flatten"
          value={procOptions.lakeFlattenStrength ?? 1}
          min={0.1}
          max={2.5}
          step={0.05}
          onChange={(v) => patchOption('lakeFlattenStrength', v)}
        />
        <Slider
          label="Lake shelf depth"
          value={procOptions.lakeDepthM ?? 0.75}
          min={0.1}
          max={limits.lakeDepthMax}
          step={0.1}
          suffix="m"
          onChange={(v) => patchOption('lakeDepthM', v)}
        />
        <Slider
          label="Waterfall carve"
          value={procOptions.waterfallCarveStrength ?? 0.75}
          min={0.2}
          max={1}
          step={0.05}
          onChange={(v) => patchOption('waterfallCarveStrength', v)}
        />
      </div>

      {summary && (
        <p className="small muted inland-water-summary">
          {summary.lakes} lake(s) · {summary.rivers} river(s) · {summary.waterfalls} waterfall(s)
          {summary.changedPixels > 0 ? ` · ${summary.changedPixels} cells` : ''}
          {applied ? ' · live on Step 4' : busy ? ' · updating…' : ''}
        </p>
      )}

      {!embedded && pipelinePreview && (
        <div className="compare inland-water-compare">
          <div>
            <h4>Processed height</h4>
            {pipelinePreview.processedPreviewUrl ? (
              <img src={pipelinePreview.processedPreviewUrl} alt="Processed height" />
            ) : (
              <div className="drop-hint">Waiting for preview</div>
            )}
          </div>
        </div>
      )}
    </Tag>
  );
}
