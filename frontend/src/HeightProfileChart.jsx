/**
 * Orthographic elevation profile chart with draggable color handles.
 *
 * Lines:
 *  - Cyan solid  — smooth terrain preview (slopes/angles match what will be generated).
 *  - Green dashed — last baked height map (frozen until you hit Generate).
 *
 * Handles (colored dots on the left Y axis) show each color's assigned height.
 * The smooth preview will slope between those target heights; peaks may sit slightly
 * below the handle level when blending spreads the terrain—that IS the expected look.
 *
 * The tuneOpts effect re-runs the smooth computation with a 30 ms debounce so that
 * dragging sliders gives near-real-time feedback without stalling the UI thread.
 *
 * Handle drags only move the colored dot until release; then the cyan profile and
 * palette height update together (no heavy smooth pass while dragging).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applySamplesToBase,
  buildDraftBaseField,
  decodeHeightPreview,
  extractOrthographicProfile,
  profileSpanM,
  profileYRange,
  PROFILE_Y_HEADROOM_M,
  smoothDraftField,
} from './heightProfile.js';
import {
  designMetersFromWorld,
  getIslandHorizonScale,
  getWorldMaxHeightM,
} from './worldSettings.js';
import { Segmented } from './studioUi.jsx';

const PAD = { l: 54, r: 18, t: 20, b: 34 };
const HANDLE_R = 8;
const HANDLE_HIT_PX = 20;
function hexToRgb(hex) {
  const v = String(hex || '').replace('#', '').trim();
  if (v.length !== 6) return '128,128,128';
  return `${parseInt(v.slice(0, 2), 16)},${parseInt(v.slice(2, 4), 16)},${parseInt(v.slice(4, 6), 16)}`;
}

function ViewSchematic({ axis }) {
  const wide = axis === 'width';
  return (
    <svg className="ortho-schematic" viewBox="0 0 120 72" aria-hidden="true">
      <rect x="18" y="14" width="84" height="44" rx="6" fill="rgba(100,217,255,.08)" stroke="rgba(100,217,255,.35)" strokeWidth="1.5" />
      {wide ? (
        <>
          <line x1="22" y1="56" x2="98" y2="56" stroke="rgba(100,217,255,.85)" strokeWidth="2" strokeDasharray="3 3" />
          <line x1="60" y1="62" x2="60" y2="18" stroke="rgba(154,240,141,.9)" strokeWidth="2" />
          <path d="M60 14l-5 10h10Z" fill="rgba(154,240,141,.9)" />
          <text x="60" y="8" textAnchor="middle" className="ortho-schematic-label">View from short side</text>
        </>
      ) : (
        <>
          <line x1="24" y1="18" x2="24" y2="54" stroke="rgba(100,217,255,.85)" strokeWidth="2" strokeDasharray="3 3" />
          <line x1="14" y1="36" x2="106" y2="36" stroke="rgba(154,240,141,.9)" strokeWidth="2" />
          <path d="M110 36l-10-5v10Z" fill="rgba(154,240,141,.9)" />
          <text x="60" y="8" textAnchor="middle" className="ortho-schematic-label">View from long side</text>
        </>
      )}
      <text x="60" y="68" textAnchor="middle" className="ortho-schematic-foot">
        {wide ? 'Profile along long edge' : 'Profile along short edge'}
      </text>
    </svg>
  );
}

function strokeLine(ctx, points, toX, toY, { stroke, lineWidth = 2, dashed = false }) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(toX(points[0].t), toY(points[0].meters));
  for (let i = 1; i < points.length; i++) ctx.lineTo(toX(points[i].t), toY(points[i].meters));
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  if (dashed) ctx.setLineDash([7, 4]);
  ctx.stroke();
  if (dashed) ctx.setLineDash([]);
}

function fillArea(ctx, points, toX, toY, yBase, fillStyle) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(toX(points[0].t), toY(points[0].meters));
  for (let i = 1; i < points.length; i++) ctx.lineTo(toX(points[i].t), toY(points[i].meters));
  ctx.lineTo(toX(points[points.length - 1].t), yBase);
  ctx.lineTo(toX(points[0].t), yBase);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

export default function HeightProfileChart({
  mapUrl,
  heightPreviewUrl,
  samples = [],
  options = {},
  worldSettings = {},
  mapSizePx = {},
  seaLevelM = 0,
  similarRadius = 12,
  axis: axisProp,
  onAxisChange,
  onUpdateSample,
  onSelectSample,
  onExpand,         // () => void — shows the fine-tune modal
  large = false,
  hideChrome = false,
}) {
  const canvasRef = useRef(null);
  const baseRef = useRef(null);
  const samplesRef = useRef(samples);
  const tuneOptsRef = useRef(null);
  const plotMetricsRef = useRef(null);
  const dragHexRef = useRef(null);
  const dragIndexRef = useRef(null);
  const dragLiveHeightRef = useRef(null);
  const smoothTimerRef = useRef(null);

  const [axisInternal, setAxisInternal] = useState('width');
  const axis = axisProp ?? axisInternal;
  const setAxis = onAxisChange ?? setAxisInternal;

  const [previewField, setPreviewField] = useState(null);
  const [generatedField, setGeneratedField] = useState(null);
  const [baseLoading, setBaseLoading] = useState(false);
  const [hoverIndex, setHoverIndex] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragLiveDesignM, setDragLiveDesignM] = useState(null);

  const maxHeightM = Number(options.maxHeightM || 500);
  const elevationScale = getIslandHorizonScale(worldSettings);
  const worldMaxHeightM = getWorldMaxHeightM(maxHeightM, worldSettings);
  // Magnify only (≥1): chart Y range stays tied to max height + headroom, never squashed wider.
  const profileScale = Math.max(1, Number(worldSettings.verticalExaggeration ?? 1));
  const { yMin, yMax, yTop } = profileYRange(worldMaxHeightM, seaLevelM, profileScale);
  const spanM = profileSpanM(axis, worldSettings, mapSizePx);
  const axisLabel = axis === 'width' ? 'Width profile' : 'Depth profile';
  const canDrag = !!onUpdateSample && samples.length > 0;

  useEffect(() => { samplesRef.current = samples; }, [samples]);

  const sampleHexKey = useMemo(() => samples.map((s) => s.hex).join('|'), [samples]);
  const sampleHeightKey = useMemo(() => samples.map((s) => `${s.hex}:${s.height}`).join('|'), [samples]);

  const matchOpts = useMemo(
    () => ({ exactColorMode: options.exactColorMode, similarRadius }),
    [options.exactColorMode, similarRadius],
  );

  // All tuning options that affect the smooth computation.
  const sampleSmoothKey = useMemo(
    () => samples.map((s) => `${s.hex}:${s.smoothness ?? ''}`).join('|'),
    [samples],
  );

  const tuneOpts = useMemo(
    () => ({ ...options, similarRadius, samples }),
    [options, similarRadius, samples],
  );

  // ── Smooth (debounced) ──────────────────────────────────────────────────
  // Shows realistic terrain angles/slopes as they will actually be generated.
  const scheduleSmooth = useCallback(() => {
    if (smoothTimerRef.current) clearTimeout(smoothTimerRef.current);
    smoothTimerRef.current = setTimeout(() => {
      const base = baseRef.current;
      if (!base) return;
      setPreviewField(smoothDraftField(base, tuneOptsRef.current));
    }, 30);
  }, []);

  // Re-smooth when tune sliders change (debounced so dragging is smooth).
  useEffect(() => {
    tuneOptsRef.current = tuneOpts;
    scheduleSmooth();
  }, [tuneOpts, scheduleSmooth]);

  // Full preview refresh (re-run color matching + smooth).
  const refreshPreview = useCallback((nextSamples) => {
    const base = baseRef.current;
    if (!base) return;
    applySamplesToBase(base, nextSamples ?? samplesRef.current, matchOpts);
    if (smoothTimerRef.current) clearTimeout(smoothTimerRef.current);
    setPreviewField(smoothDraftField(base, tuneOptsRef.current ?? tuneOpts));
  }, [matchOpts, tuneOpts]);

  // ── Generated (frozen) ──────────────────────────────────────────────────
  useEffect(() => {
    if (!heightPreviewUrl) { setGeneratedField(null); return; }
    let cancelled = false;
    decodeHeightPreview(heightPreviewUrl, maxHeightM)
      .then((f) => { if (!cancelled) setGeneratedField(f); })
      .catch(() => { if (!cancelled) setGeneratedField(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heightPreviewUrl]);

  // ── Base field (rebuild when map / color set changes) ───────────────────
  useEffect(() => {
    if (!mapUrl || !samples.length) {
      baseRef.current = null;
      setPreviewField(null);
      return;
    }
    let cancelled = false;
    setBaseLoading(true);
    baseRef.current = null;
    setPreviewField(null);
    buildDraftBaseField(mapUrl, samples, matchOpts)
      .then((base) => {
        if (cancelled) return;
        baseRef.current = base;
        applySamplesToBase(base, samples, matchOpts);
        setPreviewField(smoothDraftField(base, tuneOptsRef.current ?? tuneOpts));
      })
      .catch(() => { if (!cancelled) { baseRef.current = null; setPreviewField(null); } })
      .finally(() => { if (!cancelled) setBaseLoading(false); });
    return () => { cancelled = true; };
  }, [mapUrl, sampleHexKey, options.exactColorMode, similarRadius, matchOpts]);

  // Re-smooth when sample heights change.
  useEffect(() => {
    if (!baseRef.current) return;
    applySamplesToBase(baseRef.current, samples, matchOpts);
    scheduleSmooth();
  }, [sampleHeightKey, sampleSmoothKey, matchOpts, samples, scheduleSmooth]);

  const scaleProfilePoints = useCallback(
    (pts) => pts.map((p) => ({ ...p, meters: p.meters * elevationScale })),
    [elevationScale],
  );

  const previewPoints = useMemo(
    () => scaleProfilePoints(previewField ? extractOrthographicProfile(previewField, axis) : []),
    [previewField, axis, scaleProfilePoints],
  );
  const generatedPoints = useMemo(
    () => scaleProfilePoints(heightPreviewUrl && generatedField ? extractOrthographicProfile(generatedField, axis) : []),
    [generatedField, axis, heightPreviewUrl, scaleProfilePoints],
  );

  // Handle Y positions in world meters (chart axis); design meters stay in samples / palette.
  const sampleBands = useMemo(
    () => samples.map((s, index) => {
      const designM = dragIndex === index && dragLiveDesignM != null
        ? dragLiveDesignM
        : (Number(s.height) || 0);
      return {
        index,
        hex: s.hex,
        designM,
        height: designM * elevationScale,
      };
    }),
    [samples, dragIndex, dragLiveDesignM, elevationScale],
  );

  const canvasW = large ? 1280 : 700;
  const canvasH = large ? 900 : 360;
  const hasGenerated = generatedPoints.length > 1;
  const hasPreview = previewPoints.length > 1;
  const activeIndex = dragIndex ?? hoverIndex;

  // ── Canvas draw ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const plotW = w - PAD.l - PAD.r;
    const plotH = h - PAD.t - PAD.b;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#040d15';
    ctx.fillRect(0, 0, w, h);

    const toX = (t) => PAD.l + t * plotW;
    const toY = (m) => Math.max(PAD.t, PAD.t + plotH - ((m - yMin) / Math.max(1, yMax - yMin)) * plotH);
    const metersFromY = (py) => Math.max(yMin, yMin + (1 - (py - PAD.t) / Math.max(1, plotH)) * (yMax - yMin));

    plotMetricsRef.current = {
      w, h, yMin, yMax, metersFromY,
      bands: sampleBands.map((s) => ({ ...s, y: toY(s.height) })),
    };

    const yBasePx = toY(yMin);

    // ── Grid ──
    const gridSteps = 6;
    ctx.lineWidth = 1;
    for (let i = 0; i <= gridSteps; i++) {
      const m = yMin + ((yMax - yMin) * i) / gridSteps;
      const y = toY(m);
      ctx.strokeStyle = i === 0 ? 'rgba(100,217,255,0.18)' : 'rgba(100,217,255,0.07)';
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + plotW, y); ctx.stroke();
    }

    // ── Y-axis labels ──
    ctx.fillStyle = '#6a96aa';
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= gridSteps; i++) {
      const m = yMin + ((yMax - yMin) * i) / gridSteps;
      ctx.fillText(`${Math.round(m)}m`, PAD.l - 6, toY(m) + 4);
    }

    // ── Sea level line ──
    if (seaLevelM >= yMin) {
      const seaY = toY(seaLevelM);
      ctx.strokeStyle = 'rgba(100,217,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(PAD.l, seaY); ctx.lineTo(PAD.l + plotW, seaY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(100,217,255,0.7)';
      ctx.font = '10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`Sea ${seaLevelM}m`, PAD.l + 4, seaY - 4);
    }

    // ── Height ceiling (always on scale: 0 … max + headroom) ──
    const ceilY = toY(worldMaxHeightM);
    ctx.strokeStyle = 'rgba(255,175,90,0.5)';
    ctx.lineWidth = 1.25;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(PAD.l, ceilY); ctx.lineTo(PAD.l + plotW, ceilY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,195,120,0.8)';
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Max ${Math.round(worldMaxHeightM)}m`, PAD.l + 4, ceilY - 4);

    if (yTop > worldMaxHeightM + 2) {
      ctx.fillStyle = 'rgba(106,150,170,0.65)';
      ctx.textAlign = 'right';
      ctx.fillText(`+${PROFILE_Y_HEADROOM_M}m headroom`, PAD.l + plotW - 4, PAD.t + 12);
    }

    // ── Color handle reference lines (behind profiles) ──
    const sortedBands = [...(plotMetricsRef.current?.bands ?? [])].sort((a, b) => a.height - b.height);
    sortedBands.forEach((s) => {
      if (!canDrag) return;
      const y = s.y;
      const isActive = activeIndex === s.index;
      ctx.strokeStyle = `rgba(${hexToRgb(s.hex)},${isActive ? 0.7 : 0.28})`;
      ctx.lineWidth = isActive ? 1.5 : 1;
      ctx.setLineDash([3, 6]);
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + plotW, y); ctx.stroke();
      ctx.setLineDash([]);
    });

    // ── Generated profile (green dashed, frozen) ──
    if (hasGenerated) {
      fillArea(ctx, generatedPoints, toX, toY, yBasePx, 'rgba(154,240,141,0.055)');
      strokeLine(ctx, generatedPoints, toX, toY, {
        stroke: 'rgba(154,240,141,0.88)', lineWidth: 2, dashed: true,
      });
    }

    // ── Preview profile (cyan smooth — shows real terrain angles) ──
    if (hasPreview) {
      fillArea(ctx, previewPoints, toX, toY, yBasePx,
        hasGenerated ? 'rgba(100,217,255,0.07)' : 'rgba(100,217,255,0.11)');
      strokeLine(ctx, previewPoints, toX, toY, { stroke: '#64d9ff', lineWidth: 2.5 });
    } else if (!baseLoading) {
      ctx.fillStyle = '#4a7288';
      ctx.textAlign = 'center';
      ctx.font = '13px Inter, system-ui, sans-serif';
      ctx.fillText(mapUrl ? 'Add color–height points to see preview' : 'Upload a base map', w / 2, h / 2);
    }

    // ── Color handles (on top) ──
    sortedBands.forEach((s) => {
      if (!canDrag) return;
      const y = s.y;
      const isActive = activeIndex === s.index;
      const r = isActive ? HANDLE_R + 3 : HANDLE_R;
      if (isActive) { ctx.shadowColor = s.hex; ctx.shadowBlur = 14; }
      ctx.beginPath();
      ctx.arc(PAD.l - 2, y, r, 0, Math.PI * 2);
      ctx.fillStyle = s.hex;
      ctx.fill();
      ctx.strokeStyle = isActive ? '#fff' : 'rgba(255,255,255,0.65)';
      ctx.lineWidth = isActive ? 2.5 : 1.5;
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (isActive) {
        const label = `${Math.round(s.height)} m`;
        ctx.font = 'bold 12px Inter, system-ui, sans-serif';
        const tw = ctx.measureText(label).width;
        const lx = PAD.l + 10;
        const ly = Math.max(PAD.t + 14, y - 10);
        ctx.fillStyle = 'rgba(4,13,21,0.82)';
        ctx.beginPath();
        ctx.roundRect(lx - 5, ly - 14, tw + 10, 20, 5);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.fillText(label, lx, ly);
      }
    });

    // ── X axis labels ──
    ctx.fillStyle = '#4a7288';
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.fillText('0', PAD.l, h - 9);
    ctx.textAlign = 'right'; ctx.fillText(`${Math.round(spanM)} m`, PAD.l + plotW, h - 9);
    ctx.textAlign = 'center'; ctx.fillText(axisLabel, PAD.l + plotW / 2, h - 9);
  }, [
    previewPoints, generatedPoints, sampleBands,
    worldMaxHeightM, seaLevelM, spanM, axisLabel, mapUrl,
    hasPreview, hasGenerated, baseLoading, canDrag,
    activeIndex, profileScale, yMin, yMax, yTop, elevationScale, sampleBands,
  ]);

  // ── Pointer handling ─────────────────────────────────────────────────────
  const canvasCoords = useCallback((ev) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) * (c.width / r.width),
      y: (ev.clientY - r.top) * (c.height / r.height),
    };
  }, []);

  const findBand = useCallback((py, px) => {
    const m = plotMetricsRef.current;
    if (!m?.bands?.length) return null;
    if (px < PAD.l - 32 || px > m.w - PAD.r) return null;
    let best = null, bestD = HANDLE_HIT_PX + 1;
    for (const b of m.bands) {
      const d = Math.abs(py - b.y);
      if (d < bestD) { bestD = d; best = b.index; }
    }
    return bestD <= HANDLE_HIT_PX ? best : null;
  }, []);

  /** Move handle only — cyan profile + palette update on release (avoids lag). */
  const previewDragAtY = useCallback((py) => {
    const m = plotMetricsRef.current;
    if (!m || dragIndexRef.current == null) return;
    const worldH = Math.max(0, Math.min(worldMaxHeightM, m.metersFromY(py)));
    const designH = Math.max(0, Math.min(maxHeightM, Math.round(designMetersFromWorld(worldH, worldSettings))));
    dragLiveHeightRef.current = designH;
    setDragLiveDesignM(designH);
  }, [worldMaxHeightM, maxHeightM, worldSettings]);

  const commitDrag = useCallback(() => {
    const hex = dragHexRef.current;
    const height = dragLiveHeightRef.current;
    if (!hex || height == null) return;
    const idx = samplesRef.current.findIndex((s) => s.hex.toLowerCase() === hex.toLowerCase());
    if (idx < 0) return;
    const prev = Number(samplesRef.current[idx]?.height) || 0;
    const next = samplesRef.current.map((s, i) => (i === idx ? { ...s, height } : s));
    samplesRef.current = next;
    refreshPreview(next);
    if (height !== prev) onUpdateSample?.(idx, { height });
  }, [refreshPreview, onUpdateSample]);

  const onPointerDown = useCallback((ev) => {
    if (!canDrag) return;
    const { x, y } = canvasCoords(ev);
    const idx = findBand(y, x);
    if (idx == null) return;
    dragHexRef.current = samplesRef.current[idx]?.hex ?? null;
    dragIndexRef.current = idx;
    setDragIndex(idx);
    setDragLiveDesignM(Number(samplesRef.current[idx]?.height) || 0);
    onSelectSample?.(dragHexRef.current);
    previewDragAtY(y);
    canvasRef.current?.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  }, [canDrag, canvasCoords, findBand, onSelectSample, previewDragAtY]);

  const onPointerMove = useCallback((ev) => {
    const { x, y } = canvasCoords(ev);
    if (dragHexRef.current) { previewDragAtY(y); return; }
    setHoverIndex(findBand(y, x));
  }, [canvasCoords, findBand, previewDragAtY]);

  const endDrag = useCallback((ev) => {
    if (!dragHexRef.current) return;
    commitDrag();
    dragHexRef.current = null;
    dragIndexRef.current = null;
    dragLiveHeightRef.current = null;
    setDragIndex(null);
    setDragLiveDesignM(null);
    if (ev?.pointerId != null && canvasRef.current?.hasPointerCapture(ev.pointerId)) {
      canvasRef.current.releasePointerCapture(ev.pointerId);
    }
  }, [commitDrag]);

  useEffect(() => {
    const fin = (ev) => { if (dragHexRef.current) endDrag(ev); };
    window.addEventListener('pointerup', fin);
    window.addEventListener('pointercancel', fin);
    return () => { window.removeEventListener('pointerup', fin); window.removeEventListener('pointercancel', fin); };
  }, [endDrag]);

  // ── Status pill ──────────────────────────────────────────────────────────
  const statusLabel = baseLoading
    ? 'Loading map…'
    : dragIndex != null
      ? `${dragLiveDesignM != null ? `${Math.round(dragLiveDesignM)} m` : '…'} — release to update profile & palette`
      : hasGenerated && hasPreview
        ? 'Cyan = smooth preview · Green = last generated'
        : hasPreview ? 'Cyan smooth preview' : 'Waiting for samples';

  const canvasClass = [
    'height-profile-canvas',
    canDrag ? 'is-interactive' : '',
    dragIndex != null || hoverIndex != null ? 'is-hover-handle' : '',
    dragIndex != null ? 'is-dragging' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={`height-profile-panel ${large ? 'is-large' : ''}`}>
      {!hideChrome && (
        <div className="height-profile-head">
          <div className="height-profile-head-main">
            <h4>Elevation profile</h4>
            <span className={`profile-source-pill ${hasGenerated ? 'generated' : 'draft'}`}>
              {statusLabel}
            </span>
          </div>
          <div className="height-profile-head-right">
            <Segmented
              ariaLabel="Profile axis"
              value={axis}
              onChange={setAxis}
              options={[{ id: 'width', label: 'Long edge' }, { id: 'depth', label: 'Short edge' }]}
            />
            {onExpand && (
              <button
                type="button"
                className="profile-expand-btn"
                onClick={onExpand}
                title="Open fine-tune view"
                aria-label="Expand elevation chart for fine-tuning"
              >
                ⛶ Fine-tune
              </button>
            )}
          </div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={canvasClass}
        width={canvasW}
        height={canvasH}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => { if (!dragHexRef.current) setHoverIndex(null); }}
        role="img"
        aria-label="Elevation profile. Drag handles to set color heights."
      />
      {!hideChrome && (
        <div className="profile-legend-bar">
          <span className="profile-legend-item">
            <i className="profile-legend-swatch cyan" /> Smooth preview (cyan)
          </span>
          {hasGenerated && (
            <span className="profile-legend-item">
              <i className="profile-legend-swatch green" /> Last generated (green)
            </span>
          )}
          {canDrag && (
            <span className="profile-legend-item">
              <i className="profile-legend-swatch handle-dot" /> Handles = target heights
            </span>
          )}
          <span className="profile-legend-item muted">
            Y: 0–{Math.round(yTop)}m{profileScale > 1 ? ` (${profileScale.toFixed(2)}× magnify)` : ''}
          </span>
          <ViewSchematic axis={axis} />
        </div>
      )}
    </div>
  );
}
