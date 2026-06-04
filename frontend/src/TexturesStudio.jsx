import React from 'react';
import { DEFAULT_DIORAMA_LIGHTING } from './dioramaLighting.js';
import { MATERIAL_COLOR_DEFAULTS, MATERIAL_COLOR_LABELS } from './materialColors.js';
import { Slider } from './studioUi.jsx';
import TextureSwatchPreview from './TextureSwatchPreview.jsx';
import { MATERIALS } from './TerrainViewport.jsx';

export default function TexturesStudio({
  settings,
  setSettings,
  onOpen3D,
  canPreview,
  maxHeightM = 500,
  seaLevelM = 0,
}) {
  const patch = (next) => setSettings((prev) => ({ ...prev, ...next }));
  const patchLighting = (key, value) => setSettings((prev) => ({
    ...prev,
    dioramaLighting: { ...DEFAULT_DIORAMA_LIGHTING, ...(prev.dioramaLighting || {}), [key]: value },
  }));
  const patchMaterialColor = (id, hex) => setSettings((prev) => ({
    ...prev,
    materialColors: { ...MATERIAL_COLOR_DEFAULTS, ...(prev.materialColors || {}), [id]: hex },
  }));
  const sandCap = Math.max(8, Math.round(Number(maxHeightM || 500) * 0.35));
  const light = { ...DEFAULT_DIORAMA_LIGHTING, ...(settings.dioramaLighting || {}) };
  const matColors = { ...MATERIAL_COLOR_DEFAULTS, ...(settings.materialColors || {}) };

  return (
    <section className="texture-stage">
      <aside className="panel texture-controls">
        <h2>2 · Textures</h2>
        <p className="muted">
          Tune how sand, grass, forest, rock, and gravel read on the curved demo mount at the right.
          Orbit it to compare shore, flats, and ridge. Your island shape still comes from step 1 in full 3D.
        </p>

        <details open>
          <summary>Distance &amp; tiling (mid → far)</summary>
          <Slider label="Tile size (world)" value={settings.tilingM ?? 36} min={12} max={120} step={2} suffix="m" onChange={(v) => patch({ tilingM: v })} />
          <Slider label="Macro variation" value={settings.macroVariation ?? 0.48} min={0} max={1} step={0.01} onChange={(v) => patch({ macroVariation: v })} />
          <Slider label="Macro scale" value={settings.macroTilingM ?? 110} min={40} max={280} step={5} suffix="m" onChange={(v) => patch({ macroTilingM: v })} />
          <Slider label="Aerial softness" value={settings.aerialSoftness ?? 0.32} min={0} max={0.7} step={0.01} onChange={(v) => patch({ aerialSoftness: v })} />
          <Slider label="Far coarseness" value={settings.distantPixelBoost ?? 0.55} min={0} max={1.2} step={0.02} onChange={(v) => patch({ distantPixelBoost: v })} />
        </details>

        <details open>
          <summary>Diorama lighting</summary>
          <p className="small muted">
            Same lights for the demo mount and the island in step 5. Lower sun and env reflection if the island looks washed out or neon green.
          </p>
          <Slider label="Sun intensity" value={light.sunIntensity} min={0.2} max={3} step={0.05} onChange={(v) => patchLighting('sunIntensity', v)} />
          <Slider label="Exposure" value={light.exposure} min={0.6} max={2} step={0.02} onChange={(v) => patchLighting('exposure', v)} />
          <Slider label="Sky fill (hemisphere)" value={light.hemisphereIntensity} min={0} max={1.2} step={0.02} onChange={(v) => patchLighting('hemisphereIntensity', v)} />
          <Slider label="Env map reflection" value={light.envMapIntensity} min={0} max={1.5} step={0.02} onChange={(v) => patchLighting('envMapIntensity', v)} />
          <Slider label="Surface roughness" value={light.roughness} min={0.5} max={1} step={0.01} onChange={(v) => patchLighting('roughness', v)} />
          <div className="texture-color-grid">
            <label className="color-field">
              <span>Sun</span>
              <input type="color" value={light.sunColor} onChange={(e) => patchLighting('sunColor', e.target.value)} />
            </label>
            <label className="color-field">
              <span>Sky</span>
              <input type="color" value={light.hemisphereSky} onChange={(e) => patchLighting('hemisphereSky', e.target.value)} />
            </label>
            <label className="color-field">
              <span>Ground bounce</span>
              <input type="color" value={light.hemisphereGround} onChange={(e) => patchLighting('hemisphereGround', e.target.value)} />
            </label>
          </div>
        </details>

        <details open>
          <summary>Material colors</summary>
          <p className="small muted">
            Procedural palette for sand, grass, forest, rock, and gravel. The island also tints PNG swatches unless you enable procedural-only below.
          </p>
          <Slider
            label="Color override strength"
            value={Math.round((settings.materialColorStrength ?? 1) * 100)}
            min={0}
            max={100}
            step={1}
            suffix="%"
            onChange={(v) => patch({ materialColorStrength: v / 100 })}
          />
          <div className="texture-color-grid">
            {MATERIAL_COLOR_LABELS.map(({ id, label }) => (
              <label key={id} className="color-field">
                <span>{label}</span>
                <input
                  type="color"
                  value={matColors[id] || MATERIAL_COLOR_DEFAULTS[id]}
                  onChange={(e) => patchMaterialColor(id, e.target.value)}
                />
              </label>
            ))}
          </div>
          <label className="checkline">
            <input
              type="checkbox"
              checked={settings.proceduralColorsOnly === true}
              onChange={(e) => patch({ proceduralColorsOnly: e.target.checked })}
            />
            Procedural colors only on island (ignore bright PNG greens)
          </label>
        </details>

        <details open>
          <summary>Surface detail</summary>
          <Slider label="Paint block size" value={settings.pixelSize ?? 3} min={1} max={18} step={1} suffix="px" onChange={(v) => patch({ pixelSize: v })} />
          <Slider label="Fuzziness" value={settings.fuzziness ?? 0.16} min={0} max={1} step={0.01} onChange={(v) => patch({ fuzziness: v })} />
          <Slider label="Color variation" value={settings.variation ?? 0.18} min={0} max={1} step={0.01} onChange={(v) => patch({ variation: v })} />
          <Slider label="Material contrast" value={settings.materialContrast ?? 0.42} min={0} max={1} step={0.01} onChange={(v) => patch({ materialContrast: v })} />
          <Slider label="Normal strength" value={settings.normalStrength ?? 0.72} min={0} max={1.4} step={0.01} onChange={(v) => patch({ normalStrength: v })} />
          <Slider label="Foliage normal relief" value={settings.foliageNormalStrength ?? 0.78} min={0} max={1.4} step={0.01} onChange={(v) => patch({ foliageNormalStrength: v })} />
        </details>

        <details open>
          <summary>Shore &amp; sand (preview + 3D)</summary>
          <p className="small muted">
            Beach sand applies from sea level ({seaLevelM} m) up to the height below. The demo mount and full island use the same rule.
          </p>
          <Slider
            label="Sand up to height"
            value={settings.sandHeightM ?? 14}
            min={1}
            max={sandCap}
            step={1}
            suffix="m"
            onChange={(v) => patch({ sandHeightM: v })}
          />
          <Slider label="Wet sand strip width" value={settings.wetSandWidthM ?? 5} min={0} max={40} step={1} suffix="m" onChange={(v) => patch({ wetSandWidthM: v })} />
        </details>

        <details>
          <summary>Material rules</summary>
          <Slider label="Rock from slope" value={settings.rockSlopeStart ?? 68} min={8} max={85} step={1} suffix="°" onChange={(v) => patch({ rockSlopeStart: v })} />
          <Slider label="Rock blend" value={settings.rockSlopeBlend ?? 14} min={2} max={40} step={1} suffix="°" onChange={(v) => patch({ rockSlopeBlend: v })} />
          <Slider label="Rock detail" value={settings.rockFeatureScale ?? 0.55} min={0} max={1.4} step={0.01} onChange={(v) => patch({ rockFeatureScale: v })} />
          <Slider label="Gravel on slopes" value={settings.gravelAmount ?? 0.12} min={0} max={1} step={0.01} onChange={(v) => patch({ gravelAmount: v })} />
        </details>

        <details>
          <summary>Forest (texture blocks)</summary>
          <p className="small muted">Forest density paints canopy blocks on the terrain texture (same as the demo mount), not 3D cones unless clumps are enabled below.</p>
          <Slider label="Forest density" value={settings.treeDensity ?? 0.98} min={0} max={1} step={0.01} onChange={(v) => patch({ treeDensity: v })} />
          <Slider label="Canopy block size" value={settings.treePixelSize ?? 6} min={2} max={24} step={1} suffix="px" onChange={(v) => patch({ treePixelSize: v })} />
          <Slider label="Max slope for trees" value={settings.forestSlopeFade ?? 76} min={8} max={80} step={1} suffix="°" onChange={(v) => patch({ forestSlopeFade: v })} />
          <Slider label="Tree seed" value={settings.treeSeed ?? 42} min={1} max={9999} step={1} onChange={(v) => patch({ treeSeed: v })} />
          <label className="checkline">
            <input
              type="checkbox"
              checked={settings.showForestClumps === true}
              onChange={(e) => patch({ showForestClumps: e.target.checked })}
            />
            Show 3D forest clumps on the island (experimental)
          </label>
        </details>

        <details open>
          <summary>Model definition</summary>
          <Slider label="Texture resolution" value={settings.textureSize ?? 2048} min={512} max={8192} step={256} suffix="px" onChange={(v) => patch({ textureSize: v })} />
          <p className="small muted">
            One texture is stretched across the whole island, so higher values mean smaller texels (sharper sand, rock, and forest detail) when the camera gets close. 4096+ is noticeably heavier on GPU/memory.
          </p>
          <label className="checkline">
            <input
              type="checkbox"
              checked={settings.preservePaintedEdits !== false}
              onChange={(e) => patch({ preservePaintedEdits: e.target.checked })}
            />
            Preserve hand-painted edits when regenerating
          </label>
        </details>

        <div className="texture-material-chips">
          <span className="small muted">Paint materials (step 4)</span>
          <div className="chip-row">
            {MATERIALS.map((m) => (
              <span key={m.id} className="texture-chip">{m.label}</span>
            ))}
          </div>
        </div>

        <div className="actions">
          <button type="button" className="primary" onClick={onOpen3D} disabled={!canPreview}>
            Open 3D with these settings
          </button>
        </div>
        {!canPreview && (
          <p className="small muted">Generate a height map in step 1 first.</p>
        )}
      </aside>

      <main className="panel texture-preview-panel">
        <h2>Demo mount · 3D texture preview</h2>
        <TextureSwatchPreview settings={settings} maxHeightM={maxHeightM} seaLevelM={seaLevelM} />
      </main>
    </section>
  );
}
