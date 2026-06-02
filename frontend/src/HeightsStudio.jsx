import React, { useEffect, useMemo, useState } from 'react';
import HeightProfileChart from './HeightProfileChart.jsx';
import HeightsMapViewport from './HeightsMapViewport.jsx';
import {
  CollapsibleSection,
  HelpModal,
  Slider,
  Swatch,
  WorkflowSteps,
} from './studioUi.jsx';
import WorldScalePanel from './WorldScalePanel.jsx';

// ── Shared tune controls ─────────────────────────────────────────────────────
// Used both in the side rail and in the full-screen fine-tune modal.
// `live` = true → sliders call onChange immediately (no commit-on-release delay).
function TuneControls({
  options,
  setOptions,
  worldSettings,
  setWorldSettings,
  derivedDepthM,
  mapSizePx,
  metersPerPixel,
  similarRadius,
  setSimilarRadius,
  advancedOpen,
  setAdvancedOpen,
  live = false,
}) {
  const S = (extra) => live ? extra : { ...extra, commitOnRelease: true };
  return (
    <>
      <div className="quick-tune-strip">
        <Slider {...S({
          label: 'Transition distance',
          value: options.bandTransitionPx, min: 0, max: 40, step: 1, suffix: 'px',
          onChange: (v) => setOptions({ ...options, bandTransitionPx: v }),
        })} />
        <Slider {...S({
          label: 'Smooth slope',
          value: options.bandBlendStrength, min: 0, max: 1, step: 0.01,
          onChange: (v) => setOptions({ ...options, bandBlendStrength: v }),
        })} />
        <Slider {...S({
          label: 'Height ceiling (clamp)',
          value: options.maxHeightM, min: 50, max: 1600, step: 10, suffix: 'm',
          onChange: (v) => setOptions({ ...options, maxHeightM: v }),
        })} />
        <Slider {...S({
          label: 'Profile magnify (within max+100m)',
          value: Math.max(1, worldSettings.verticalExaggeration ?? 1),
          min: 1, max: 3, step: 0.05,
          onChange: (v) => setWorldSettings((p) => ({ ...p, verticalExaggeration: Math.max(1, v) })),
        })} />
      </div>

      <CollapsibleSection title="Shape & slopes" defaultOpen>
        <Slider {...S({ label: 'Peak roundness', value: options.roundPeaks, min: 0, max: 1, step: 0.01, onChange: (v) => setOptions({ ...options, roundPeaks: v }) })} />
        <Slider {...S({ label: 'Cliff firmness', value: options.cliffStrength, min: 0, max: 1.4, step: 0.01, onChange: (v) => setOptions({ ...options, cliffStrength: v }) })} />
        <Slider {...S({ label: 'Spike protection', value: options.spikeRemovalStrength, min: 0, max: 1, step: 0.01, onChange: (v) => setOptions({ ...options, spikeRemovalStrength: v }) })} />
        <Slider {...S({ label: 'Max slope / pixel', value: options.slopeLimitMPerPx, min: 10, max: 180, step: 1, suffix: 'm', onChange: (v) => setOptions({ ...options, slopeLimitMPerPx: v }) })} />
        <label className="checkline">
          <input type="checkbox" checked={options.exactColorMode} onChange={(e) => setOptions({ ...options, exactColorMode: e.target.checked })} />
          Pixel-perfect exact colors
        </label>
        {!options.exactColorMode && (
          <Slider {...S({ label: 'Similar-color radius', value: similarRadius, min: 1, max: 80, step: 1, onChange: setSimilarRadius })} />
        )}
      </CollapsibleSection>

    </>
  );
}

// ── Fine-tune modal ───────────────────────────────────────────────────────────
function FineTuneModal({
  open,
  onClose,
  profileProps,
  options,
  setOptions,
  worldSettings,
  setWorldSettings,
  derivedDepthM,
  mapSizePx,
  metersPerPixel,
  similarRadius,
  setSimilarRadius,
  advancedOpen,
  setAdvancedOpen,
  onGenerateHeightmap,
}) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fine-tune-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Elevation fine-tune">
      <div className="fine-tune-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fine-tune-modal-header">
          <div>
            <h3>Elevation fine-tune</h3>
            <p className="small muted" style={{ margin: '2px 0 0' }}>
              Sliders update the cyan preview in real-time · drag handles to set color heights
            </p>
          </div>
          <div className="fine-tune-modal-actions">
            <button type="button" className="primary" onClick={() => { onGenerateHeightmap(); onClose(); }}>
              Generate height map
            </button>
            <button type="button" className="fine-tune-close" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>
        <div className="fine-tune-modal-body">
          <div className="fine-tune-chart-col">
            <HeightProfileChart large hideChrome={false} {...profileProps} />
          </div>
          <div className="fine-tune-controls-col">
            <WorldScalePanel
              worldSettings={worldSettings}
              setWorldSettings={setWorldSettings}
              mapSizePx={mapSizePx}
              derivedDepthM={derivedDepthM}
            />
            <TuneControls
              live
              options={options}
              setOptions={setOptions}
              worldSettings={worldSettings}
              setWorldSettings={setWorldSettings}
              derivedDepthM={derivedDepthM}
              mapSizePx={mapSizePx}
              metersPerPixel={metersPerPixel}
              similarRadius={similarRadius}
              setSimilarRadius={setSimilarRadius}
              advancedOpen={advancedOpen}
              setAdvancedOpen={setAdvancedOpen}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Side rail (tune controls with commit-on-release for the non-modal view) ───
function HeightsTuneRail({
  options, setOptions,
  worldSettings, setWorldSettings,
  derivedDepthM, mapSizePx, metersPerPixel,
  similarRadius, setSimilarRadius,
  advancedOpen, setAdvancedOpen,
  analyzeCount, setAnalyzeCount,
  onAnalyzeColors, onPreviewCleanMap,
}) {
  return (
    <aside className="heights-tune-rail" aria-label="Terrain tuning controls">
      <div className="tune-rail-head">
        <h3>Live tune</h3>
        <p className="small muted" style={{ margin: '2px 0 10px' }}>Sliders update preview on release.</p>
      </div>
      <WorldScalePanel
        worldSettings={worldSettings}
        setWorldSettings={setWorldSettings}
        mapSizePx={mapSizePx}
        derivedDepthM={derivedDepthM}
      />
      <TuneControls
        live={false}
        options={options} setOptions={setOptions}
        worldSettings={worldSettings} setWorldSettings={setWorldSettings}
        derivedDepthM={derivedDepthM} mapSizePx={mapSizePx} metersPerPixel={metersPerPixel}
        similarRadius={similarRadius} setSimilarRadius={setSimilarRadius}
        advancedOpen={advancedOpen} setAdvancedOpen={setAdvancedOpen}
      />

      <CollapsibleSection title="Map cleanup tools" defaultOpen={false}>
        <div className="actions compact">
          <button type="button" onClick={onAnalyzeColors}>Suggest colors</button>
          <label>
            How many
            <input type="number" min="2" max="64" value={analyzeCount} onChange={(e) => setAnalyzeCount(Number(e.target.value))} />
          </label>
          <button type="button" onClick={onPreviewCleanMap}>Preview cleanup</button>
        </div>
        <button type="button" className="linkish" onClick={() => setAdvancedOpen((v) => !v)}>
          {advancedOpen ? 'Hide advanced cleanup' : 'Advanced cleanup sliders'}
        </button>
        {advancedOpen && (
          <div className="advanced-box">
            <label className="checkline">
              <input type="checkbox" checked={options.preprocessEnabled} onChange={(e) => setOptions({ ...options, preprocessEnabled: e.target.checked })} />
              Preprocess before height generation
            </label>
            <Slider commitOnRelease label="Average similar colors" value={options.sampleAverageStrength} min={0} max={1} step={0.01} onChange={(v) => setOptions({ ...options, sampleAverageStrength: v })} />
            <Slider commitOnRelease label="Reduce color groups" value={options.paletteColorCount} min={0} max={96} step={1} onChange={(v) => setOptions({ ...options, paletteColorCount: v })} />
            <Slider commitOnRelease label="Ignore / heal lines" value={options.ignoreLineStrength} min={0} max={1} step={0.01} onChange={(v) => setOptions({ ...options, ignoreLineStrength: v })} />
            <Slider commitOnRelease label="Paper/noise blur" value={options.paperNoiseBlur} min={0} max={3} step={0.1} onChange={(v) => setOptions({ ...options, paperNoiseBlur: v })} />
            <Slider commitOnRelease label="Broad smoothing" value={options.smoothingSigma} min={0} max={8} step={0.1} onChange={(v) => setOptions({ ...options, smoothingSigma: v })} />
            <Slider commitOnRelease label="Curve smoothing" value={options.curveSmoothStrength} min={0} max={1} step={0.01} onChange={(v) => setOptions({ ...options, curveSmoothStrength: v })} />
          </div>
        )}
      </CollapsibleSection>

    </aside>
  );
}

// ── Main studio page ──────────────────────────────────────────────────────────
export default function HeightsStudio(props) {
  const {
    mapUrl, mapVersion,
    samples, setSamples,
    picked, setPicked,
    newHeight, setNewHeight,
    similarRadius, setSimilarRadius,
    options, setOptions,
    worldSettings, setWorldSettings,
    derivedDepthM, mapSizePx, metersPerPixel,
    heightPreview, heightOutOfDate, heightGenerating, canGenerateHeightmap,
    onEnsureHeightmap,
    dominant, cleanedPreview,
    analyzeCount, setAnalyzeCount,
    advancedOpen, setAdvancedOpen,
    waterOnlyStarter, islandColorLadder,
    onBaseMap, onAddHeightPoint, onUpdateSample,
    onAnalyzeColors, onPreviewCleanMap, onGenerateHeightmap,
  } = props;

  const [profileAxis, setProfileAxis] = useState('width');
  const [helpOpen, setHelpOpen] = useState(false);
  const [samplesCollapsed, setSamplesCollapsed] = useState(false);
  const [fineTuneOpen, setFineTuneOpen] = useState(false);

  const workflowSteps = useMemo(() => [
    { id: 'map', index: '1', label: 'Load map', done: !!mapUrl },
    { id: 'colors', index: '2', label: 'Color heights', done: samples.length >= 2 },
    { id: 'tune', index: '3', label: 'Tune & generate', done: !!heightPreview },
  ], [mapUrl, samples.length, heightPreview]);

  const profileProps = {
    axis: profileAxis,
    onAxisChange: setProfileAxis,
    mapUrl,
    heightPreviewUrl: heightPreview,
    samples,
    options,
    worldSettings: { ...worldSettings, depthM: derivedDepthM },
    mapSizePx,
    seaLevelM: options.seaLevelM ?? 0,
    similarRadius,
    onUpdateSample,
    onSelectSample: setPicked,
    onExpand: () => setFineTuneOpen(true),
  };

  return (
    <section className="heights-studio heights-studio-unified">
      <header className="heights-desk-header">
        <div className="heights-desk-title">
          <p className="eyebrow">Step 1 · Heights</p>
          <h2 className="studio-page-heading">Tuning desk</h2>
          <p className="studio-page-lede compact">
            Use the main viewport to switch between your color map and the baked height map. Opening the height view generates it automatically when needed.
          </p>
        </div>
        <WorkflowSteps steps={workflowSteps} />
        <div className="heights-desk-actions">
          <button
            type="button"
            className="primary"
            onClick={() => onGenerateHeightmap()}
            disabled={!canGenerateHeightmap || heightGenerating}
          >
            {heightPreview && !heightOutOfDate ? 'Regenerate height map' : 'Generate height map'}
          </button>
          <button type="button" onClick={() => onGenerateHeightmap('zip')} disabled={!canGenerateHeightmap}>Export ZIP</button>
          <button type="button" className="search-help-trigger" onClick={() => setHelpOpen(true)} aria-label="Help">?</button>
        </div>
      </header>

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} title="Heights tuning desk">
        <ul className="studio-help-list">
          <li><strong>Main viewport</strong> — Color map (pick colors), Height map (baked terrain), or Split. Switching to Height auto-generates if the map is missing or out of date.</li>
          <li><strong>Cyan line (profile)</strong> — smooth terrain preview with slopes. Drag handles or adjust sliders to update it.</li>
          <li><strong>Green dashed (profile)</strong> — cross-section of the last baked height map.</li>
          <li><strong>Handles</strong> — drag a colored dot on the left Y-axis to change that color's target height. Release to apply.</li>
          <li><strong>⛶ Fine-tune button</strong> — opens a full-screen view with real-time sliders and a large chart.</li>
        </ul>
      </HelpModal>

      <FineTuneModal
        open={fineTuneOpen}
        onClose={() => setFineTuneOpen(false)}
        profileProps={{ ...profileProps, onExpand: undefined }}
        options={options} setOptions={setOptions}
        worldSettings={worldSettings} setWorldSettings={setWorldSettings}
        derivedDepthM={derivedDepthM} mapSizePx={mapSizePx} metersPerPixel={metersPerPixel}
        similarRadius={similarRadius} setSimilarRadius={setSimilarRadius}
        advancedOpen={advancedOpen} setAdvancedOpen={setAdvancedOpen}
        onGenerateHeightmap={onGenerateHeightmap}
      />

      <div className="heights-unified-layout">
        <div className="heights-workbench">
          <div className="heights-map-toolbar">
            <label className="file-inline">
              Base map
              <input type="file" accept="image/*" onChange={(e) => onBaseMap(e.target.files[0])} />
            </label>
          </div>

          <HeightsMapViewport
            mapUrl={mapUrl}
            mapVersion={mapVersion}
            heightPreview={heightPreview}
            heightOutOfDate={heightOutOfDate}
            heightGenerating={heightGenerating}
            canGenerate={canGenerateHeightmap}
            samples={samples}
            options={options}
            similarRadius={similarRadius}
            picked={picked}
            onPick={(hex) => setPicked(hex)}
            onEnsureHeightmap={onEnsureHeightmap}
          />

          <div className="heights-profile-row">
            <HeightProfileChart large {...profileProps} />
          </div>

          <div className="heights-samples-dock">
            <button
              type="button"
              className="collapsible-head samples-dock-head"
              onClick={() => setSamplesCollapsed((v) => !v)}
              aria-expanded={!samplesCollapsed}
            >
              <span>Color height points ({samples.length})</span>
              <span className="collapsible-chevron">{samplesCollapsed ? '+' : '−'}</span>
            </button>
            {!samplesCollapsed && (
              <>
                <div className="heights-palette-presets">
                  <span className="small muted">Presets</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSamples(waterOnlyStarter);
                      setPicked(waterOnlyStarter[0].hex);
                      setNewHeight(0);
                    }}
                  >
                    Water-only
                  </button>
                  <button type="button" onClick={() => setSamples(islandColorLadder)}>Color ladder</button>
                </div>
                <div className="picker-row compact">
                  <div className="picked" style={{ background: picked }} />
                  <input value={picked} onChange={(e) => setPicked(e.target.value)} aria-label="Selected color" />
                  <label>m <input type="number" value={newHeight} onChange={(e) => setNewHeight(e.target.value)} /></label>
                  <button type="button" className="primary" onClick={onAddHeightPoint}>Add / update</button>
                </div>
                <div className="sample-list simple">
                  {samples.map((s, i) => (
                    <div className="sample-simple" key={`${s.hex}_${i}`}>
                      <input className="sample-color" type="color" value={s.hex} onChange={(e) => onUpdateSample(i, { hex: e.target.value })} />
                      <code>{s.hex}</code>
                      <label><input type="number" value={s.height} onChange={(e) => onUpdateSample(i, { height: Number(e.target.value) })} /></label>
                      <span className="muted">m</span>
                      <button type="button" onClick={() => setSamples((prev) => prev.filter((_, idx) => idx !== i))}>×</button>
                    </div>
                  ))}
                </div>
                {!!dominant.length && (
                  <div className="dominant-row">
                    {dominant.map((c) => <Swatch key={c.hex} color={c.hex} onClick={() => setPicked(c.hex)} />)}
                  </div>
                )}
                {cleanedPreview && (
                  <div className="clean-preview compact">
                    <img src={cleanedPreview} alt="Cleaned map" />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <HeightsTuneRail
          options={options} setOptions={setOptions}
          worldSettings={worldSettings} setWorldSettings={setWorldSettings}
          derivedDepthM={derivedDepthM} mapSizePx={mapSizePx} metersPerPixel={metersPerPixel}
          similarRadius={similarRadius} setSimilarRadius={setSimilarRadius}
          advancedOpen={advancedOpen} setAdvancedOpen={setAdvancedOpen}
          analyzeCount={analyzeCount} setAnalyzeCount={setAnalyzeCount}
          onAnalyzeColors={onAnalyzeColors} onPreviewCleanMap={onPreviewCleanMap}
        />
      </div>
    </section>
  );
}
