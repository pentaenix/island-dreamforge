import React from 'react';
import { Slider } from './studioUi.jsx';

export default function WaterSettingsPanel({ settings, setSettings, autoOceanRadiusM }) {
  const patch = (next) => setSettings((prev) => ({ ...prev, ...next }));
  const autoMode = settings.oceanRadiusAuto !== false;
  const effectiveRadius = autoMode
    ? Number(autoOceanRadiusM || settings.oceanRadiusM || 850)
    : Number(settings.oceanRadiusM || 850);
  const radiusM = effectiveRadius;
  const diameterM = radiusM * 2;
  const maxModelR = Math.max(60, Math.round(radiusM * 0.48));

  const setDiameter = (d) => patch({
    oceanRadiusM: Math.max(50, d) / 2,
    oceanRadiusAuto: false,
  });

  return (
    <div className="water-settings-panel">
      <h3>Ocean disc</h3>
      <label className="checkline">
        <input
          type="checkbox"
          checked={autoMode}
          onChange={(e) => patch({ oceanRadiusAuto: e.target.checked })}
        />
        Auto-size ocean with island (Heights tab scale)
      </label>
      {autoMode && (
        <p className="small muted">
          Effective diameter ~{Math.round(diameterM)} m (follows island width/depth)
        </p>
      )}
      <Slider
        label="Disc diameter"
        value={diameterM}
        min={200}
        max={48000}
        step={50}
        suffix="m"
        onChange={setDiameter}
      />

      <h4>Preview model (stand-in island)</h4>
      <Slider
        label="Model radius"
        value={settings.previewSphereRadiusM ?? 220}
        min={40}
        max={maxModelR}
        step={10}
        suffix="m"
        onChange={(v) => patch({ previewSphereRadiusM: v })}
      />
      <p className="small muted">Larger model = easier to read water bands · not your real map shape</p>

      <h4>Color bands (from model edge)</h4>
      <Slider label="Pale shore band" value={settings.shallowShelfM || settings.shoreShelfWidthM} min={4} max={80} step={1} suffix="m" onChange={(v) => patch({ shallowShelfM: v, shoreShelfWidthM: v })} />
      <Slider label="Turquoise shelf end" value={settings.midShelfM || settings.midWaterDistanceM} min={20} max={200} step={2} suffix="m" onChange={(v) => patch({ midShelfM: v, midWaterDistanceM: v })} />
      <Slider label="Deep water start" value={settings.deepStartM || settings.deepWaterDistanceM} min={60} max={600} step={5} suffix="m" onChange={(v) => patch({ deepStartM: v, deepWaterDistanceM: v })} />
      <Slider label="Edge soften" value={settings.bathymetrySmoothPx} min={0} max={4} step={1} suffix="px" onChange={(v) => patch({ bathymetrySmoothPx: v })} />

      <h4>Water texture</h4>
      <Slider label="Wave noise" value={settings.waterNoiseStrength ?? 0.1} min={0} max={0.35} step={0.01} onChange={(v) => patch({ waterNoiseStrength: v })} />
      <Slider label="Wave scale" value={settings.waterNoiseScaleM ?? 85} min={15} max={400} step={5} suffix="m" onChange={(v) => patch({ waterNoiseScaleM: v })} />
      <Slider label="Reef variation" value={settings.reefNoiseStrength ?? 0.08} min={0} max={0.35} step={0.01} onChange={(v) => patch({ reefNoiseStrength: v })} />
      <Slider label="Coastal variation" value={settings.coastalVariationStrength ?? 0.15} min={0} max={0.8} step={0.01} onChange={(v) => patch({ coastalVariationStrength: v })} />
      <Slider label="Foam width" value={settings.foamWidthM ?? 12} min={0} max={48} step={1} suffix="m" onChange={(v) => patch({ foamWidthM: v })} />
      <Slider label="Foam strength" value={settings.foamStrength ?? 0.2} min={0} max={0.6} step={0.01} onChange={(v) => patch({ foamStrength: v })} />

      <details>
        <summary>Export-only</summary>
        <Slider label="Max ocean depth" value={settings.maxOceanDepthM} min={20} max={800} step={5} suffix="m" onChange={(v) => patch({ maxOceanDepthM: v })} />
        <Slider label="Depth curve" value={settings.depthCurveExponent} min={0.35} max={4} step={0.05} onChange={(v) => patch({ depthCurveExponent: v })} />
        <Slider label="Coast skirt depth" value={settings.coastlineSkirtDepthM} min={5} max={160} step={1} suffix="m" onChange={(v) => patch({ coastlineSkirtDepthM: v })} />
        <label className="checkline mini">
          <input
            type="checkbox"
            checked={!!settings.showSeafloorPreview}
            onChange={(e) => patch({ showSeafloorPreview: e.target.checked })}
          />
          Show 3D seafloor bowl in Stage 5 (debug)
        </label>
      </details>
    </div>
  );
}
