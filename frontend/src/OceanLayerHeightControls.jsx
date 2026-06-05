import React from 'react';
import { Slider } from './studioUi.jsx';
import { OCEAN_DEEP_Y_M } from './waterLayers3d.js';

function layerValue(settings, key, fallback) {
  const v = settings?.[key];
  return Number.isFinite(Number(v)) ? Number(v) : fallback;
}

export default function OceanLayerHeightControls({ settings, setSettings, onHeightsChange }) {
  const patch = (next) => {
    setSettings((prev) => {
      const merged = { ...prev, ...next };
      onHeightsChange?.(merged);
      return merged;
    });
  };

  return (
    <>
      <h4>Layer heights (3D stack)</h4>
      <p className="small muted">
        Absolute local height (m). No clamping — 0 is allowed (may z-fight). Deep disc fixed at {OCEAN_DEEP_Y_M} m.
      </p>
      <Slider
        label="Bands layer"
        value={layerValue(settings, 'oceanBandsOffsetM', 0.1)}
        min={0}
        max={3}
        step={0.01}
        suffix="m"
        onChange={(v) => patch({ oceanBandsOffsetM: v })}
      />
      <Slider
        label="Reflection layer"
        value={layerValue(settings, 'oceanReflectionOffsetM', 0.12)}
        min={0}
        max={3}
        step={0.01}
        suffix="m"
        onChange={(v) => patch({ oceanReflectionOffsetM: v })}
      />
      <Slider
        label="Foam layer"
        value={layerValue(settings, 'oceanFoamOffsetM', 0.14)}
        min={0}
        max={3}
        step={0.01}
        suffix="m"
        onChange={(v) => patch({ oceanFoamOffsetM: v })}
      />
    </>
  );
}
