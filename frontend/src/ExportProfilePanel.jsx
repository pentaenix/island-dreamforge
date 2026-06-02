import React from 'react';
import { Slider } from './studioUi.jsx';

const DETAIL_OPTIONS = [
  ['preview_low', 'Preview Low'],
  ['preview_medium', 'Preview Medium'],
  ['preview_high', 'Preview High'],
  ['web_export_high', 'Web Export High'],
  ['game_export_low', 'Game Export Low'],
  ['game_export_medium', 'Game Export Medium'],
  ['game_export_high', 'Game Export High'],
];

export default function ExportProfilePanel({
  settings,
  setSettings,
  canExport,
  derivedMaps,
  onRefreshDerivedMaps,
  onExportWeb,
  onExportGame,
}) {
  const patch = (next) => setSettings((prev) => ({ ...prev, ...next }));
  const stats = derivedMaps?.metadata?.stats;

  return (
    <section className="export-profile-panel">
      <header>
        <div>
          <h3>Export Profiles</h3>
          <p className="small muted">Generate real island data: masks, shoreline distance, seafloor, material maps, and web/game packages. Tune ocean colors in Stage 3 · Water.</p>
        </div>
      </header>

      <div className="export-profile-grid">
        <div>
          <h4>Detail</h4>
          <label>
            Preview detail
            <select value={settings.previewDetail} onChange={(e) => patch({ previewDetail: e.target.value })}>
              {DETAIL_OPTIONS.slice(0, 3).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label>
            Web export detail
            <select value={settings.webDetail} onChange={(e) => patch({ webDetail: e.target.value })}>
              {DETAIL_OPTIONS.filter(([id]) => id.startsWith('preview') || id.startsWith('web')).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label>
            Game export detail
            <select value={settings.gameDetail} onChange={(e) => patch({ gameDetail: e.target.value })}>
              {DETAIL_OPTIONS.filter(([id]) => id.startsWith('game')).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <Slider label="Game chunk size" value={settings.chunkSize} min={8} max={64} step={8} onChange={(v) => patch({ chunkSize: v })} />

          {stats && (
            <div className="export-stats small">
              <span>Land pixels <b>{stats.landPixels}</b></span>
              <span>Ocean pixels <b>{stats.oceanPixels}</b></span>
              <span>Max depth <b>{stats.maxWaterDepthM}m</b></span>
            </div>
          )}
        </div>
      </div>

      {derivedMaps && (
        <div className="derived-map-strip">
          <figure><img src={derivedMaps.islandMask} alt="Island mask" /><figcaption>Island mask</figcaption></figure>
          <figure><img src={derivedMaps.waterDepth} alt="Water depth" /><figcaption>Water depth</figcaption></figure>
          <figure><img src={derivedMaps.materialIds} alt="Material IDs" /><figcaption>Materials</figcaption></figure>
        </div>
      )}

      <div className="actions compact">
        <button type="button" onClick={onRefreshDerivedMaps} disabled={!canExport}>Refresh derived maps</button>
        <button type="button" className="primary" onClick={onExportWeb} disabled={!canExport}>Export Web Portal Package</button>
        <button type="button" className="primary" onClick={onExportGame} disabled={!canExport}>Export Game Package</button>
      </div>
    </section>
  );
}
