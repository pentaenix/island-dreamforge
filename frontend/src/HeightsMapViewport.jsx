import React, { useCallback, useEffect, useRef, useState } from 'react';
import MapPicker from './MapPicker.jsx';
import { buildDraftHeightField } from './heightProfile.js';
import { Segmented } from './studioUi.jsx';

function fieldToPreviewDataUrl(field, maxHeightM) {
  if (!field?.heights) return '';
  const { heights, rows, cols } = field;
  const ceiling = Math.max(1, Number(maxHeightM || 500));
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(cols, rows);
  for (let i = 0; i < heights.length; i++) {
    const v = Math.round((Math.min(heights[i], ceiling) / ceiling) * 255);
    const p = i * 4;
    img.data[p] = v;
    img.data[p + 1] = v;
    img.data[p + 2] = v;
    img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

export default function HeightsMapViewport({
  mapUrl,
  mapVersion,
  heightPreview,
  heightOutOfDate,
  heightGenerating,
  samples,
  options,
  similarRadius,
  picked,
  onPick,
  onEnsureHeightmap,
  canGenerate,
}) {
  const [viewMode, setViewMode] = useState('color');
  const [showColorMatch, setShowColorMatch] = useState(true);
  const [draftPreviewUrl, setDraftPreviewUrl] = useState('');
  const [draftLoading, setDraftLoading] = useState(false);
  const autoGenRef = useRef(false);
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  const needsBackendHeight = !heightPreview || heightOutOfDate;
  const showDraft = viewMode !== 'color' && needsBackendHeight;

  useEffect(() => {
    if (!showDraft || !mapUrl || !samples?.length) {
      setDraftPreviewUrl('');
      return undefined;
    }
    let cancelled = false;
    setDraftLoading(true);
    buildDraftHeightField(mapUrl, samples, { ...options, similarRadius })
      .then((field) => {
        if (cancelled) return;
        setDraftPreviewUrl(field ? fieldToPreviewDataUrl(field, options.maxHeightM) : '');
      })
      .catch(() => { if (!cancelled) setDraftPreviewUrl(''); })
      .finally(() => { if (!cancelled) setDraftLoading(false); });
    return () => { cancelled = true; };
  }, [showDraft, mapUrl, samples, options, similarRadius]);

  const tryAutoGenerate = useCallback(async () => {
    if (viewModeRef.current === 'color') return;
    if (!canGenerate || !needsBackendHeight) return;
    if (autoGenRef.current || heightGenerating) return;
    autoGenRef.current = true;
    try {
      await onEnsureHeightmap?.();
    } finally {
      autoGenRef.current = false;
    }
  }, [canGenerate, needsBackendHeight, heightGenerating, onEnsureHeightmap]);

  const handleViewMode = (mode) => {
    setViewMode(mode);
  };

  // Auto-bake only when entering Height or Split from Color (not on every tune slider).
  const prevViewRef = useRef('color');
  useEffect(() => {
    const prev = prevViewRef.current;
    prevViewRef.current = viewMode;
    if (viewMode === 'color') return;
    if (prev !== 'color') return;
    if (!needsBackendHeight) return;
    tryAutoGenerate();
  }, [viewMode, needsBackendHeight, tryAutoGenerate]);

  const statusLabel = (() => {
    if (heightGenerating) return 'Generating height map…';
    if (!heightPreview) return 'No baked height map yet';
    if (heightOutOfDate) return 'Height map out of date — regenerate or re-open this view';
    return 'Height map ready';
  })();

  const displayHeightUrl = heightPreview && !heightOutOfDate
    ? heightPreview
    : (draftPreviewUrl || '');

  const heightCaption = heightPreview && !heightOutOfDate
    ? 'Baked height map (used in later steps)'
    : 'Draft preview from color bands — switch here to bake the real map';

  function renderHeightPane({ compact = false } = {}) {
    if (!mapUrl) {
      return <div className="drop-hint big">Upload a base map to preview heights.</div>;
    }
    if (heightGenerating && !displayHeightUrl) {
      return (
        <div className="heights-viewport-placeholder">
          <div className="heights-viewport-spinner" aria-hidden />
          <p>Generating smooth height map…</p>
        </div>
      );
    }
    if (!displayHeightUrl) {
      return (
        <div className="heights-viewport-placeholder">
          {draftLoading ? <p>Building draft preview…</p> : <p>Add color heights, then open this view to generate.</p>}
        </div>
      );
    }
    return (
      <figure className={`heights-height-figure${compact ? ' compact' : ''}`}>
        <img
          className="heights-height-img"
          src={displayHeightUrl}
          alt="Terrain height map"
        />
        <figcaption className="small muted">
          {heightCaption}
          {heightOutOfDate && !heightGenerating ? ' · settings changed' : ''}
        </figcaption>
      </figure>
    );
  }

  return (
    <div className="heights-map-viewport">
      <div className="heights-viewport-chrome">
        <Segmented
          ariaLabel="Map viewport mode"
          value={viewMode}
          options={[
            { id: 'color', label: 'Color map', title: 'Pick colors on the handmade map' },
            { id: 'height', label: 'Height map', title: 'View baked terrain heights (auto-generates if needed)' },
            { id: 'split', label: 'Split', title: 'Color map and height map side by side' },
          ]}
          onChange={handleViewMode}
        />
        <span
          className={`heights-height-status${heightPreview && !heightOutOfDate ? ' ready' : ''}${heightOutOfDate ? ' stale' : ''}`}
          title={statusLabel}
        >
          {statusLabel}
        </span>
        {viewMode === 'color' && (
          <label className="checkline mini heights-match-toggle">
            <input
              type="checkbox"
              checked={showColorMatch}
              onChange={(e) => setShowColorMatch(e.target.checked)}
            />
            Show color match
          </label>
        )}
      </div>

      <div className={`heights-viewport-body mode-${viewMode}`}>
        {viewMode === 'color' && (
          <MapPicker
            imageUrl={mapUrl}
            mapVersion={mapVersion}
            picked={picked}
            pixelPerfect={options.exactColorMode}
            similarRadius={similarRadius}
            showMatch={showColorMatch}
            onPick={onPick}
          />
        )}
        {viewMode === 'height' && renderHeightPane()}
        {viewMode === 'split' && (
          <div className="heights-split-panes">
            <div className="heights-split-pane">
              <h4 className="heights-split-label">Color map</h4>
              <MapPicker
                imageUrl={mapUrl}
                mapVersion={mapVersion}
                picked={picked}
                pixelPerfect={options.exactColorMode}
                similarRadius={similarRadius}
                showMatch={showColorMatch}
                onPick={onPick}
              />
            </div>
            <div className="heights-split-pane">
              <h4 className="heights-split-label">Height map</h4>
              {renderHeightPane({ compact: true })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
