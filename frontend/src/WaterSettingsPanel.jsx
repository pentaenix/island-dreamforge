import React from 'react';
import { Slider } from './studioUi.jsx';
import { bandWidthsM, defaultBandEdgesM, ISLAND_WATER_HEX, NUM_WATER_BANDS } from './waterPalette.js';
import {
  getAutoOceanDiscRadiusM,
  getAutoWaterMapRadiusM,
  getOceanFootprintRadiusM,
  WATER_DISC_SLIDER_MAX_DIAMETER_M,
} from './worldSettings.js';

export default function WaterSettingsPanel({ settings, setSettings, autoOceanRadiusM, worldSettings, mapSizePx }) {
  const patch = (next) => setSettings((prev) => ({ ...prev, ...next }));
  const autoMode = settings.oceanRadiusAuto !== false;
  const autoRadiusM = Number(
    autoOceanRadiusM ?? getAutoOceanDiscRadiusM(worldSettings || {}, mapSizePx || {}),
  );
  const manualRadiusM = Math.max(50, Number(settings.oceanRadiusM) || autoRadiusM);
  const radiusM = autoMode ? autoRadiusM : manualRadiusM;
  const diameterM = radiusM * 2;
  const sliderDiameterM = autoMode ? autoRadiusM * 2 : manualRadiusM * 2;
  const maxModelR = Math.max(60, Math.round(radiusM * 0.48));
  const footprintRadiusM = getOceanFootprintRadiusM(worldSettings || {}, mapSizePx || {});

  const setDiscDiameter = (d) => {
    patch({
      oceanRadiusM: Math.max(50, d) / 2,
      oceanRadiusAuto: false,
    });
  };

  const mapAutoMode = settings.waterMapRadiusAuto !== false;
  const mapAutoRadiusM = Number(
    getAutoWaterMapRadiusM(worldSettings || {}, mapSizePx || {}, settings),
  );
  const mapManualRadiusM = Math.max(50, Number(settings.waterMapRadiusM) || mapAutoRadiusM);
  const mapSliderDiameterM = mapAutoMode ? mapAutoRadiusM * 2 : mapManualRadiusM * 2;

  const setMapDiameter = (d) => {
    patch({
      waterMapRadiusM: Math.max(50, d) / 2,
      waterMapRadiusAuto: false,
    });
  };

  const bandStepM = Number(settings.waterBandStepM ?? 12);
  const bandStepInc = Number(settings.waterBandStepIncreaseM ?? 16);
  const bandGrowthPower = Number(settings.waterBandStepGrowthPower ?? 2);
  const bandEdges = defaultBandEdgesM({
    ...settings,
    waterBandStepM: bandStepM,
    waterBandStepIncreaseM: bandStepInc,
    waterBandStepGrowthPower: bandGrowthPower,
  });
  const totalBandReachM = Math.round(bandEdges[bandEdges.length - 1] || 0);
  const bandWidths = bandWidthsM(bandStepM, bandStepInc, NUM_WATER_BANDS, bandGrowthPower);

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
      {autoMode ? (
        <p className="small muted">
          Auto diameter ~{Math.round(autoRadiusM * 2)} m (58% of island span). Drag the slider to set a custom size.
        </p>
      ) : (
        <p className="small muted">
          3D circle only · diameter {Math.round(diameterM)} m. Does not change the band texture — use Seafloor band reach below.
        </p>
      )}
      <Slider
        label="Disc diameter (3D)"
        value={sliderDiameterM}
        min={200}
        max={WATER_DISC_SLIDER_MAX_DIAMETER_M}
        step={50}
        suffix="m"
        onChange={setDiscDiameter}
      />

      <h3>Seafloor band reach</h3>
      <p className="small muted">
        Requests a full-size band map from the server (same scale as the island). The 3D plane updates when derived maps finish regenerating (~½ s after you move the slider).
      </p>
      <label className="checkline">
        <input
          type="checkbox"
          checked={mapAutoMode}
          onChange={(e) => patch({ waterMapRadiusAuto: e.target.checked })}
        />
        Auto band reach from island + deep-water settings
      </label>
      <Slider
        label="Band reach diameter"
        value={mapSliderDiameterM}
        min={200}
        max={WATER_DISC_SLIDER_MAX_DIAMETER_M}
        step={50}
        suffix="m"
        onChange={setMapDiameter}
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

      <h4>Depth palette</h4>
      <div className="water-palette-swatches" aria-label="Ocean depth colors shallow to deep">
        {ISLAND_WATER_HEX.map((hex) => (
          <span key={hex} className="water-swatch" style={{ background: hex }} title={hex} />
        ))}
      </div>
      <p className="small muted">Six depth bands from shore (#D8EFE8) to open ocean (#064864)</p>

      <h4>Depth bands (from shore)</h4>
      <p className="small muted">
        Each band width = shore step + increase × band² (outer bands grow much wider). Regenerate derived maps after changes.
      </p>
      <Slider
        label="First band width (shore)"
        value={bandStepM}
        min={4}
        max={200}
        step={1}
        suffix="m"
        onChange={(v) => patch({ waterBandStepM: v, waterBandUseLegacyBands: false })}
      />
      <Slider
        label="Step increase per band"
        value={bandStepInc}
        min={0}
        max={400}
        step={2}
        suffix="m"
        onChange={(v) => patch({ waterBandStepIncreaseM: v, waterBandUseLegacyBands: false })}
      />
      <p className="small muted">
        Band widths (m): {bandWidths.map((w) => Math.round(w)).join(' → ')} · total reach ~{totalBandReachM} m
      </p>
      <Slider
        label="Band transition smoothness"
        value={Math.round((settings.waterBandSmoothness ?? settings.waterColorSmoothness ?? 0.35) * 100)}
        min={0}
        max={100}
        step={1}
        suffix="%"
        onChange={(v) => patch({ waterBandSmoothness: v / 100, waterColorSmoothness: v / 100 })}
      />
      <Slider label="Edge soften" value={settings.bathymetrySmoothPx} min={0} max={4} step={1} suffix="px" onChange={(v) => patch({ bathymetrySmoothPx: v })} />

      <h4>Surface (foam & waves)</h4>
      <p className="small muted">Foam and wave sparkle sit on top of depth color — they do not change the palette bands.</p>
      <Slider label="Wave noise" value={settings.waterNoiseStrength ?? 0.1} min={0} max={0.35} step={0.01} onChange={(v) => patch({ waterNoiseStrength: v })} />
      <Slider label="Wave scale" value={settings.waterNoiseScaleM ?? 85} min={15} max={400} step={5} suffix="m" onChange={(v) => patch({ waterNoiseScaleM: v })} />
      <Slider label="Reef variation" value={settings.reefNoiseStrength ?? 0.08} min={0} max={0.35} step={0.01} onChange={(v) => patch({ reefNoiseStrength: v })} />
      <Slider label="Coastal variation" value={settings.coastalVariationStrength ?? 0.15} min={0} max={0.8} step={0.01} onChange={(v) => patch({ coastalVariationStrength: v })} />
      <Slider label="Foam width" value={settings.foamWidthM ?? 12} min={0} max={48} step={1} suffix="m" onChange={(v) => patch({ foamWidthM: v })} />
      <Slider label="Foam strength" value={settings.foamStrength ?? 0.2} min={0} max={0.6} step={0.01} onChange={(v) => patch({ foamStrength: v })} />
      <Slider
        label="Disc edge fade"
        value={settings.oceanFoamRimFadeM ?? 48}
        min={12}
        max={200}
        step={4}
        suffix="m"
        onChange={(v) => patch({ oceanFoamRimFadeM: v })}
      />
      <p className="small muted">Fades foam and waves near the ocean circle edge so they do not stretch on the rim.</p>

      <details>
        <summary>Legacy band distances</summary>
        <Slider label="Pale shore band" value={settings.shallowShelfM || settings.shoreShelfWidthM} min={4} max={80} step={1} suffix="m"         onChange={(v) => patch({ shallowShelfM: v, shoreShelfWidthM: v, waterBandUseLegacyBands: true })} />
        <Slider label="Turquoise shelf end" value={settings.midShelfM || settings.midWaterDistanceM} min={20} max={200} step={2} suffix="m" onChange={(v) => patch({ midShelfM: v, midWaterDistanceM: v, waterBandUseLegacyBands: true })} />
        <Slider label="Deep water start" value={settings.deepStartM || settings.deepWaterDistanceM} min={60} max={600} step={5} suffix="m" onChange={(v) => patch({ deepStartM: v, deepWaterDistanceM: v, waterBandUseLegacyBands: true })} />
        <p className="small muted">Clears step mode when adjusted. Re-enable step sliders above to use step + increase again.</p>
      </details>

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
