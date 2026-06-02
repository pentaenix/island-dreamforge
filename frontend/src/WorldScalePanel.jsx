import React, { useMemo } from 'react';
import { Segmented, Slider } from './studioUi.jsx';
import {
  DEFAULT_WORLD_SETTINGS,
  ISLAND_SIZE_PRESETS,
  TERRAIN_MESH_PRESETS,
  clampMeshResolution,
  estimateTerrainPolygons,
  getDerivedDepthM,
  getIslandFootprintKm2,
  getMetersPerPixel,
} from './worldSettings.js';

function activePresetId(worldSettings) {
  const w = Number(worldSettings.widthM);
  const hit = ISLAND_SIZE_PRESETS.find((p) => Math.abs(p.widthM - w) < w * 0.02);
  return hit?.id || 'custom';
}

function activeMeshPresetId(worldSettings) {
  const r = clampMeshResolution(worldSettings.terrainMeshResolution);
  const hit = TERRAIN_MESH_PRESETS.find((p) => Math.abs(p.resolution - r) <= r * 0.06);
  return hit?.id || 'custom';
}

export default function WorldScalePanel({
  worldSettings,
  setWorldSettings,
  mapSizePx,
  derivedDepthM,
}) {
  const preset = activePresetId(worldSettings);
  const meshPreset = activeMeshPresetId(worldSettings);
  const metersPerPixel = getMetersPerPixel(worldSettings, mapSizePx);
  const footprintKm2 = getIslandFootprintKm2(worldSettings, mapSizePx);
  const poly = useMemo(
    () => estimateTerrainPolygons(worldSettings, mapSizePx),
    [worldSettings, mapSizePx],
  );

  const applyPreset = (id) => {
    const p = ISLAND_SIZE_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setWorldSettings((prev) => ({
      ...prev,
      widthM: p.widthM,
      depthM: prev.lockAspect !== false && mapSizePx.width && mapSizePx.height
        ? Math.round(p.widthM * mapSizePx.height / mapSizePx.width)
        : prev.depthM,
    }));
  };

  const applyMeshPreset = (id) => {
    const p = TERRAIN_MESH_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setWorldSettings((prev) => ({ ...prev, terrainMeshResolution: p.resolution }));
  };

  return (
    <div className="world-scale-box" aria-label="Island world scale">
      <h4>Island world scale</h4>
      <p className="small muted world-scale-lede">
        Sets real-world land footprint and scales terrain elevation with island width (author heights at resort scale; massive islands get proportionally taller peaks). The ocean disc auto-grows to match unless you override it in Water. Trees and future paths/buildings keep fixed meter sizes.
      </p>

      <div className="world-scale-section">
        <span className="world-scale-label">Size preset</span>
        <Segmented
          ariaLabel="Island size preset"
          value={preset}
          options={[
            ...ISLAND_SIZE_PRESETS.map((p) => ({ id: p.id, label: p.label, title: p.hint })),
            { id: 'custom', label: 'Custom', title: 'Manual width' },
          ]}
          onChange={(id) => { if (id !== 'custom') applyPreset(id); }}
        />
      </div>

      <div className="world-scale-grid">
        <label>
          Island width (m)
          <input
            type="number"
            min="100"
            max="50000"
            step="50"
            value={worldSettings.widthM}
            onChange={(e) => {
              const widthM = Math.max(100, Number(e.target.value) || 100);
              setWorldSettings((p) => ({
                ...p,
                widthM,
                depthM: p.lockAspect !== false && mapSizePx.width && mapSizePx.height
                  ? Math.round(widthM * mapSizePx.height / mapSizePx.width)
                  : p.depthM,
              }));
            }}
          />
        </label>
        <label>
          Island depth (m)
          <input
            type="number"
            min="100"
            max="50000"
            step="50"
            disabled={worldSettings.lockAspect !== false && !!mapSizePx.width}
            value={derivedDepthM ?? getDerivedDepthM(worldSettings, mapSizePx)}
            onChange={(e) => setWorldSettings((p) => ({ ...p, depthM: Math.max(100, Number(e.target.value) || 100) }))}
          />
        </label>
      </div>

      <label className="checkline">
        <input
          type="checkbox"
          checked={worldSettings.lockAspect !== false}
          onChange={(e) => setWorldSettings((p) => ({
            ...p,
            lockAspect: e.target.checked,
            depthM: e.target.checked && mapSizePx.width && mapSizePx.height
              ? Math.round(p.widthM * mapSizePx.height / mapSizePx.width)
              : p.depthM,
          }))}
        />
        Lock depth to map aspect ratio
      </label>

      <p className="world-scale-stats small muted">
        {mapSizePx.width ? `${mapSizePx.width} × ${mapSizePx.height}px` : 'Load a map to see pixel scale'}
        {metersPerPixel ? ` · ${metersPerPixel.toFixed(2)} m/px` : ''}
        {footprintKm2 > 0 ? ` · ~${footprintKm2.toFixed(2)} km² land` : ''}
      </p>

      <div className="world-scale-divider" />

      <h4 className="world-scale-subhead">Terrain polygons</h4>
      <p className="small muted">
        How finely the 3D land mesh is tessellated (independent of map PNG resolution). Higher = smoother cliffs, heavier preview.
      </p>

      <div className="world-scale-section">
        <span className="world-scale-label">Mesh preset</span>
        <Segmented
          ariaLabel="Terrain mesh preset"
          value={meshPreset}
          options={[
            ...TERRAIN_MESH_PRESETS.map((p) => ({ id: p.id, label: p.label, title: `${p.resolution} px grid` })),
            { id: 'custom', label: 'Custom', title: 'Slider below' },
          ]}
          onChange={(id) => { if (id !== 'custom') applyMeshPreset(id); }}
        />
      </div>

      <Slider
        label="Mesh grid resolution"
        value={clampMeshResolution(worldSettings.terrainMeshResolution)}
        min={64}
        max={1024}
        step={64}
        suffix="px"
        onChange={(v) => setWorldSettings((p) => ({ ...p, terrainMeshResolution: clampMeshResolution(v) }))}
      />
      <p className="world-scale-stats small muted">
        ~{poly.rows} × {poly.cols} grid · up to ~{(poly.quads / 1000).toFixed(0)}k tris (land)
      </p>

      <div className="world-scale-divider" />

      <h4 className="world-scale-subhead">Features (fixed real-world scale)</h4>
      <Slider
        label="Tree / path spacing"
        value={worldSettings.featureSpacingM ?? DEFAULT_WORLD_SETTINGS.featureSpacingM}
        min={8}
        max={80}
        step={1}
        suffix="m"
        onChange={(v) => setWorldSettings((p) => ({ ...p, featureSpacingM: v }))}
      />
      <Slider
        label="Feature size (trees, future builds)"
        value={worldSettings.featureScale ?? 1}
        min={0.5}
        max={2}
        step={0.05}
        onChange={(v) => setWorldSettings((p) => ({ ...p, featureScale: v }))}
      />
    </div>
  );
}
