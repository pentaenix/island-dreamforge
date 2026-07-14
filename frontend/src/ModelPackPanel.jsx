import React, { useRef } from 'react';
import { Slider, CollapsibleSection } from './studioUi.jsx';
import { useDebouncedCallback } from './useDebouncedCallback.js';
import {
  createEmptyModelPack,
  DEFAULT_PACK_PLACEMENT,
  MATERIAL_IDS,
  PLACEMENT_MODES,
} from './modelPackSettings.js';
import { invalidateModelPackCache } from './modelPackLoader.js';
import { revokePackGlb, storePackGlbFile } from './modelPackBlobStore.js';

const MATERIAL_OPTIONS = Object.keys(MATERIAL_IDS);

function TagInput({ tags, onChange }) {
  const [draft, setDraft] = React.useState('');
  return (
    <div className="tag-input">
      <div className="tag-list">
        {(tags || []).map((t) => (
          <span key={t} className="tag-chip">
            {t}
            <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>×</button>
          </span>
        ))}
      </div>
      <input
        type="text"
        placeholder="Add tag, Enter"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            e.preventDefault();
            const next = draft.trim().toLowerCase().replace(/\s+/g, '-');
            if (!tags.includes(next)) onChange([...tags, next]);
            setDraft('');
          }
        }}
      />
    </div>
  );
}

function PackCard({
  pack,
  index,
  layers,
  onImmediateChange,
  onDebouncedChange,
  onRemove,
}) {
  const fileRef = useRef(null);
  const placement = { ...DEFAULT_PACK_PLACEMENT, ...(pack.placement || {}) };

  const patchPlacement = (key, value) => {
    onDebouncedChange({
      placement: { ...placement, [key]: value },
    });
  };

  const toggleMaterial = (listKey, mat) => {
    const list = placement[listKey] || [];
    const next = list.includes(mat) ? list.filter((m) => m !== mat) : [...list, mat];
    patchPlacement(listKey, next);
  };

  const maskLayers = (layers || []).filter((l) => ['texture', 'path', 'structure', 'marker'].includes(l.kind));

  return (
    <CollapsibleSection title={`${pack.name || 'Pack'} ${pack.enabled === false ? '(off)' : ''}`} defaultOpen={index === 0}>
      <label className="checkline mini">
        <input
          type="checkbox"
          checked={pack.enabled !== false}
          onChange={(e) => onImmediateChange({ enabled: e.target.checked })}
        />
        Enabled
      </label>
      <label>
        Pack name
        <input
          type="text"
          value={pack.name || ''}
          onChange={(e) => onImmediateChange({ name: e.target.value })}
        />
      </label>
      <label>Tags</label>
      <TagInput
        tags={pack.tags || []}
        onChange={(tags) => onImmediateChange({ tags })}
      />

      <div className="actions compact">
        <button type="button" onClick={() => fileRef.current?.click()}>Upload GLB</button>
        {pack.hasGlb && <span className="small muted">{pack.glbFileName || 'uploaded.glb'}</span>}
        <input
          ref={fileRef}
          type="file"
          accept=".glb,model/gltf-binary"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            invalidateModelPackCache(pack.id);
            await storePackGlbFile(pack.id, file);
            onImmediateChange({ glbFileName: file.name, hasGlb: true, variantMeta: [] });
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="danger"
          onClick={() => {
            revokePackGlb(pack.id);
            invalidateModelPackCache(pack.id);
            onRemove();
          }}
        >
          Remove pack
        </button>
      </div>

      {pack.variantMeta?.length > 0 && (
        <p className="small muted">
          {pack.variantMeta.length} variant{pack.variantMeta.length === 1 ? '' : 's'}:
          {' '}
          {pack.variantMeta.map((v) => v.name).join(', ')}
        </p>
      )}

      <label>
        Placement mode
        <select
          value={placement.mode || 'scatter-on-land'}
          onChange={(e) => patchPlacement('mode', e.target.value)}
        >
          {PLACEMENT_MODES.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </label>

      {(placement.mode === 'scatter-on-mask') && (
        <label>
          Mask layer
          <select
            value={placement.maskLayerId || ''}
            onChange={(e) => patchPlacement('maskLayerId', e.target.value || null)}
          >
            <option value="">— pick layer —</option>
            {maskLayers.map((l) => (
              <option key={l.id} value={l.id}>{l.name || l.kind}</option>
            ))}
          </select>
        </label>
      )}

      {(placement.mode === 'manual-marker-based') && (
        <label>
          Marker layer
          <select
            value={placement.markerLayerId || ''}
            onChange={(e) => patchPlacement('markerLayerId', e.target.value || null)}
          >
            <option value="">— first marker layer —</option>
            {(layers || []).filter((l) => l.kind === 'marker').map((l) => (
              <option key={l.id} value={l.id}>{l.name || 'marker'}</option>
            ))}
          </select>
        </label>
      )}

      <Slider label="Density" value={placement.density ?? 0.35} min={0} max={1} step={0.01} onChange={(v) => patchPlacement('density', v)} />
      <Slider label="Max count" value={placement.maxCount ?? 120} min={1} max={400} step={5} onChange={(v) => patchPlacement('maxCount', v)} />
      <Slider label="Seed" value={placement.seed ?? 42} min={0} max={9999} step={1} onChange={(v) => patchPlacement('seed', v)} />
      <Slider label="Scale min" value={placement.scaleMin ?? 1} min={0.2} max={30} step={0.2} suffix="m" onChange={(v) => patchPlacement('scaleMin', v)} />
      <Slider label="Scale max" value={placement.scaleMax ?? 3} min={0.5} max={40} step={0.2} suffix="m" onChange={(v) => patchPlacement('scaleMax', v)} />
      <Slider label="Slope min" value={placement.slopeMinDeg ?? 0} min={0} max={80} step={1} suffix="°" onChange={(v) => patchPlacement('slopeMinDeg', v)} />
      <Slider label="Slope max" value={placement.slopeMaxDeg ?? 35} min={0} max={85} step={1} suffix="°" onChange={(v) => patchPlacement('slopeMaxDeg', v)} />
      <Slider label="Height min" value={placement.heightMinM ?? 0} min={0} max={500} step={2} suffix="m" onChange={(v) => patchPlacement('heightMinM', v)} />
      <Slider label="Height max" value={placement.heightMaxM ?? 800} min={5} max={2000} step={5} suffix="m" onChange={(v) => patchPlacement('heightMaxM', v)} />
      <Slider label="Coast dist min" value={placement.coastDistanceMinM ?? 0} min={0} max={120} step={1} suffix="m" onChange={(v) => patchPlacement('coastDistanceMinM', v)} />
      <Slider label="Coast dist max" value={placement.coastDistanceMaxM ?? 500} min={1} max={600} step={1} suffix="m" onChange={(v) => patchPlacement('coastDistanceMaxM', v)} />
      <Slider label="Jitter" value={placement.jitterM ?? 1.2} min={0} max={12} step={0.2} suffix="m" onChange={(v) => patchPlacement('jitterM', v)} />
      <Slider label="Cluster radius" value={placement.clusterRadiusM ?? 0} min={0} max={25} step={0.5} suffix="m" onChange={(v) => patchPlacement('clusterRadiusM', v)} />
      <Slider label="Noise scale" value={placement.noiseScaleM ?? 14} min={2} max={80} step={1} suffix="m" onChange={(v) => patchPlacement('noiseScaleM', v)} />
      <Slider label="Noise threshold" value={placement.noiseThreshold ?? 0.45} min={0} max={1} step={0.01} onChange={(v) => patchPlacement('noiseThreshold', v)} />
      <Slider label="Clear vegetation radius" value={placement.clearVegetationRadiusM ?? 2.5} min={0} max={25} step={0.5} suffix="m" onChange={(v) => patchPlacement('clearVegetationRadiusM', v)} />

      <fieldset className="mini-fieldset">
        <legend className="small">Allowed materials (empty = any)</legend>
        <div className="check-grid">
          {MATERIAL_OPTIONS.map((m) => (
            <label key={m} className="checkline mini">
              <input
                type="checkbox"
                checked={(placement.allowedMaterials || []).includes(m)}
                onChange={() => toggleMaterial('allowedMaterials', m)}
              />
              {m}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mini-fieldset">
        <legend className="small">Avoid materials</legend>
        <div className="check-grid">
          {MATERIAL_OPTIONS.map((m) => (
            <label key={m} className="checkline mini">
              <input
                type="checkbox"
                checked={(placement.avoidMaterials || []).includes(m)}
                onChange={() => toggleMaterial('avoidMaterials', m)}
              />
              {m}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="check-grid">
        {[
          ['randomRotation', 'Random rotation', true],
          ['snapToGround', 'Snap to ground', true],
          ['alignToNormal', 'Align to normal', false],
          ['avoidWater', 'Avoid water', true],
          ['avoidRivers', 'Avoid rivers', true],
          ['avoidPaths', 'Avoid paths', true],
          ['avoidStructures', 'Avoid structures', true],
          ['avoidDocks', 'Avoid docks', true],
          ['avoidOtherModelPacks', 'Avoid other packs', true],
        ].map(([key, label, defaultOn]) => (
          <label key={key} className="checkline mini">
            <input
              type="checkbox"
              checked={defaultOn ? placement[key] !== false : placement[key] === true}
              onChange={(e) => patchPlacement(key, e.target.checked)}
            />
            {label}
          </label>
        ))}
      </div>
    </CollapsibleSection>
  );
}

export default function ModelPackPanel({ modelPacks, setModelPacks, layers }) {
  const packs = modelPacks || [];
  const pendingPatches = useRef(new Map());

  const flushPending = useDebouncedCallback(() => {
    if (!pendingPatches.current.size) return;
    setModelPacks((prev) => {
      const list = [...(prev || [])];
      for (const [packId, patch] of pendingPatches.current.entries()) {
        const idx = list.findIndex((p) => p.id === packId);
        if (idx < 0) continue;
        list[idx] = { ...list[idx], ...patch };
      }
      pendingPatches.current.clear();
      return list;
    });
  }, 450);

  const patchPack = (index, patch, immediate = false) => {
    const pack = packs[index];
    if (!pack) return;
    if (immediate) {
      setModelPacks((prev) => {
        const list = [...(prev || [])];
        list[index] = { ...list[index], ...patch };
        return list;
      });
      return;
    }
    pendingPatches.current.set(pack.id, {
      ...pendingPatches.current.get(pack.id),
      ...patch,
    });
    flushPending();
  };

  return (
    <section className="model-pack-panel">
      <h3>Model packs</h3>
      <p className="small muted">
        Upload any GLB pack, tag it, and scatter with generic placement rules. Preview updates in step 5 after sliders settle (~½s).
      </p>
      <div className="actions compact">
        <button
          type="button"
          className="primary"
          onClick={() => {
            setModelPacks((prev) => [...(prev || []), createEmptyModelPack()]);
          }}
        >
          + Add GLB pack
        </button>
      </div>
      {packs.map((pack, index) => (
        <PackCard
          key={pack.id}
          pack={pack}
          index={index}
          layers={layers}
          onImmediateChange={(patch) => patchPack(index, patch, true)}
          onDebouncedChange={(patch) => patchPack(index, patch, false)}
          onRemove={() => setModelPacks((prev) => (prev || []).filter((_, i) => i !== index))}
        />
      ))}
      {!packs.length && <p className="small muted">No model packs yet — add a GLB to dress the island.</p>}
    </section>
  );
}
