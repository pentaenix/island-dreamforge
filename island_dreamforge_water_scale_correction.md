# Island Dreamforge — Water Scale Correction / No-More-Halo Plan

## Why this correction exists

The current tropical water attempt still looks wrong. It makes the island feel like a pebble because the shallow water occupies a huge visible area around the whole landmass. The circular ocean/seafloor boundary is also visible as a pale disc, which destroys the illusion of scale.

The goal is not to make the ocean brighter. The goal is to make the water **read as deep ocean with narrow, localized tropical shallows**.

This document supersedes the earlier water-band guidance where it conflicts.

---

## The current visible problem

The screenshot shows these failures:

1. **The island feels tiny**
   - The pale/cyan shallow region is larger than the island.
   - For a massive island, shallow water should usually be a narrow coastal shelf, not a giant lagoon around everything.

2. **The circular ocean disc is visible**
   - The export radius/disc is showing up as a visual circle.
   - That circle should never be visible in the water color.
   - The disc is an export/mesh clipping boundary, not an art feature.

3. **The center water is too pale**
   - Bays can be turquoise, but the huge interior water area should not become almost white.
   - Most water should quickly become blue unless a shallow lagoon/reef mask explicitly says otherwise.

4. **Smoothing is being used at the wrong scale**
   - Smoothing should remove pixel rings and jagged bands.
   - It should not inflate the shallow shelf until it becomes a giant soft blob.

5. **Ocean radius is incorrectly affecting the look**
   - Ocean radius should control exported seafloor/water extent.
   - Ocean radius should not create a visible radial color gradient or pale circular region.

---

## Non-negotiable visual rules

1. **No visible circle**
   - The ocean disc edge must not be visible in normal web preview.
   - Do not color water based on distance to disc center.
   - Do not create a pale alpha/falloff circle.
   - If clipping to a circular seafloor, hide the boundary below a large deep-blue ocean plane or fade only at the far outside edge where the camera usually cannot see it.

2. **Shallows are local to shore**
   - Water color is driven primarily by distance from coastline and seafloor depth.
   - Ocean radius must not make water pale.

3. **Massive-island default**
   - The default should make the island feel kilometers wide.
   - Shallow water should be small compared to island width.
   - Broad turquoise should happen only in bays, lagoons, reefs, or sandbar zones.

4. **Separate data from visual preview**
   - The C++ game export needs bathymetry/seafloor maps.
   - The web preview can render pretty water.
   - The circular export radius is valid data, but it should not appear as a visible white/cyan disc.

---

## Correct scale model

Use meters, not arbitrary pixels, for water controls.

Estimate:

```text
islandWidthM = worldSettings.widthM
metersPerPixel = islandWidthM / heightmapWidthPx
```

Then expose the water shelf as both meters and percentage of island width.

For a massive island:

```text
ultraShallowWidthM: 4–25 m
turquoiseShelfM: 30–120 m
reefShelfM: 80–260 m
deepBlueStartM: 350–1200 m
foamWidthM: 3–14 m
```

Scale sanity warnings:

```text
if turquoiseShelfM / islandWidthM > 0.025:
  warn "This will make the island feel small."

if reefShelfM / islandWidthM > 0.06:
  warn "This creates an atoll/lagoon look, not a massive island look."

if bathymetrySmoothM > turquoiseShelfM * 0.35:
  warn "Smoothing is too large and will inflate the shallow water."
```

Important: the sliders must be able to go much lower than the current implementation. If the user drags everything down, the shelf should actually become narrow.

---

## New default preset: Massive Tropical Island

Use this as the default for the project.

```json
{
  "preset": "massive_tropical_island",
  "oceanRadiusM": 9000,
  "maxOceanDepthM": 220,

  "ultraShallowWidthM": 10,
  "paleAquaWidthM": 28,
  "turquoiseShelfM": 75,
  "reefShelfM": 180,
  "deepBlueStartM": 700,

  "bathymetrySmoothM": 18,
  "bathymetryRelaxPasses": 2,
  "coastalVariationStrength": 0.22,
  "reefNoiseStrength": 0.08,

  "foamWidthM": 8,
  "foamStrength": 0.18,

  "reflectionStrength": 0.035,
  "waveStrength": 0.035
}
```

For a very large island, this gives a thin tropical edge, some turquoise in bays, and mostly blue ocean.

---

## Optional preset: Lagoon / Resort Island

This can exist as a separate preset, but it must not be the default.

```json
{
  "preset": "lagoon_resort_island",
  "oceanRadiusM": 6500,
  "maxOceanDepthM": 160,

  "ultraShallowWidthM": 18,
  "paleAquaWidthM": 55,
  "turquoiseShelfM": 170,
  "reefShelfM": 420,
  "deepBlueStartM": 1500,

  "bathymetrySmoothM": 28,
  "bathymetryRelaxPasses": 3,
  "coastalVariationStrength": 0.35,
  "reefNoiseStrength": 0.16,

  "foamWidthM": 14,
  "foamStrength": 0.24,

  "reflectionStrength": 0.04,
  "waveStrength": 0.04
}
```

---

## Replace the old bathymetry curve

The previous curve allowed too much pale water. Replace it with a compressed near-shore curve.

### Inputs

```python
d = effectiveDistanceToShoreM
```

### Smoothstep helper

```python
def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / max(edge1 - edge0, 1e-6), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)
```

### New depth model

```python
t0 = smoothstep(0.0, ultraShallowWidthM, d)
t1 = smoothstep(ultraShallowWidthM, paleAquaWidthM, d)
t2 = smoothstep(paleAquaWidthM, turquoiseShelfM, d)
t3 = smoothstep(turquoiseShelfM, reefShelfM, d)
t4 = smoothstep(reefShelfM, deepBlueStartM, d)

bathymetry01 = (
    0.04 * t0 +
    0.08 * t1 +
    0.18 * t2 +
    0.30 * t3 +
    0.40 * t4
)
bathymetry01 = np.clip(bathymetry01, 0.0, 1.0)
```

This means:
- sand/pale aqua is very close to land
- turquoise is local, not global
- deep blue begins much sooner
- no huge white shallow lake around the island

---

## Make bays wider, cliffs narrower

Broad turquoise should come from coast type, not from a giant global shelf.

### Coast shelf scale

```python
localShelfScale = 1.0
localShelfScale += 0.35 * sandinessNearCoast
localShelfScale += 0.25 * bayConcavityOrShelter
localShelfScale -= 0.45 * coastSlope01
localShelfScale += coastalVariationStrength * lowFrequencyNoise
localShelfScale = np.clip(localShelfScale, 0.55, 1.65)

effectiveDistanceToShoreM = shoreDistanceM / localShelfScale
```

### Practical fallback if bay detection is not implemented yet

Use only:

```text
sandinessNearCoast
coastSlope01
lowFrequencyNoise
```

That is enough for the first correction.

---

## Fix smoothing

Smoothing must be in meters and must be limited.

```python
bathymetrySmoothPx = bathymetrySmoothM / metersPerPixel
bathymetrySmoothPx = clamp(bathymetrySmoothPx, 0.5, 18.0)
```

Do not allow smoothing to become 46px for a huge island unless the user intentionally chooses a lagoon/atoll preset.

Recommended rule:

```python
maxSmoothM = max(4.0, turquoiseShelfM * 0.30)
bathymetrySmoothM = min(bathymetrySmoothM, maxSmoothM)
```

Post-relaxation should smooth the gradient but not expand it:

```python
for _ in range(relaxPasses):
    blurred = masked_gaussian(bathymetry01, waterMask, sigma=smoothPx * 0.35)
    bathymetry01[waterMask] = lerp(bathymetry01[waterMask], blurred[waterMask], 0.25)
```

Use masked blur. Do not let land pixels, ocean-disc edge pixels, or transparent outside-disc pixels bleed into water color.

---

## Hide the circular seafloor boundary

The seafloor can be circular for export, but the visual water should not reveal the disc.

Implement one of these:

### Option A — preferred for web preview

Render:
1. a large infinite-looking deep-blue ocean plane
2. the circular seafloor mesh below it
3. the bathymetry/depth color only where it differs from deep ocean

The deep ocean plane hides the circular edge.

### Option B — if using a single water mesh

At the disc edge:

```python
edgeFade = smoothstep(oceanRadiusM - edgeFadeWidthM, oceanRadiusM, distanceFromDiscCenterM)
finalWaterColor = lerp(depthColor, deepOceanColor, edgeFade)
alpha = 1.0
```

Do **not** fade to white, cyan, or transparency. Fade to deep ocean blue.

Good edgeFadeWidthM:

```text
300–1200 m
```

But the disc edge still should not be obvious from the normal camera.

---

## Correct color ramp for massive-island water

Use a darker ramp than before.

| Stop | Meaning | Hex |
|---:|---|---|
| 0.00 | wet sand visible through inches of water | `#E6D7A3` |
| 0.025 | pale aqua lip | `#BFEFE3` |
| 0.08 | shallow turquoise | `#62D9CF` |
| 0.18 | tropical cyan | `#28BFD0` |
| 0.35 | rich coastal blue | `#0E8FBD` |
| 0.58 | open ocean | `#0968A7` |
| 0.82 | deep ocean | `#074B8B` |
| 1.00 | far deep ocean | `#052D67` |

Key rule:

```text
The ramp reaches real blue by bathymetry01 ≈ 0.25–0.35.
Do not stay pale until 0.5.
```

---

## Foam correction

Foam must not outline the whole island as a thick white ring.

Use:

```python
foam = 1.0 - smoothstep(foamWidthM * 0.25, foamWidthM, shoreDistanceM)
foam *= waterMask
foam *= 0.6 + 0.4 * lowAmplitudeNoise
foam *= foamStrength
```

Defaults:

```text
foamWidthM: 6–10 m
foamStrength: 0.12–0.22
```

Foam should be barely visible from high altitude.

---

## Web renderer guidance

The water material should be mostly color/depth, not reflection.

```text
reflectionStrength: 0.02–0.06
specularStrength: 0.04–0.10
waveStrength: 0.02–0.05
```

From the high aerial view:
- shallow color should be visible only near shore and lagoons
- waves should be subtle surface texture
- ocean should become deep blue quickly
- no mirror look
- no huge white/cyan disc

---

## Export guidance

The circular seafloor export remains valuable.

Export:

```text
web/
  terrain.glb
  seafloor.glb
  water_plane_or_disc.glb
  textures/bathymetry.png
  textures/water_color.png
  textures/foam_mask.png
  textures/water_mask.png

game/
  terrain_height_16.png
  seafloor_height_16.png
  bathymetry_8.png
  shore_distance_8.png
  island_mask.png
  water_mask.png
  manifest.json
```

But remember:

```text
The game can use the seafloor and bathymetry data.
The web preview should hide the export circle visually.
```

---

## Acceptance criteria

This correction is complete when:

1. The ocean disc is not visible as a pale or cyan circle.
2. Dragging shelf sliders down makes the shallow shelf genuinely narrow.
3. With the massive island preset, the island looks kilometers wide, not like a pebble.
4. Most water is blue from aerial view.
5. Pale aqua appears only very close to shore or in intentionally shallow bays.
6. The seafloor still deepens with distance from land.
7. The circular seafloor radius remains customizable for export.
8. Water smoothing removes artifacts without bloating the shallow zone.
9. The web export and game export still include bathymetry/seafloor maps.

---

## Cursor prompt

```text
Read island_dreamforge_water_scale_correction.md before changing code.

The current water implementation is visually wrong. It creates a giant pale/cyan circular halo around the island, making the island look like a pebble. Fix the scale and remove the visible disc.

Important:
- Ocean radius is an export/mesh boundary only. It must not create a visible circular color gradient.
- Do not color water by distance to the disc center.
- Do not show the circular ocean/seafloor mask as a pale disc.
- Water color must be driven by distance to coastline / bathymetry depth, then smoothed.
- Shallow/pale water must be narrow for the default massive-island preset.
- Sliders must allow truly small values in meters.

Implement:
1. A new `massive_tropical_island` water preset with narrow near-shore shelves.
2. A darker water color ramp that reaches blue quickly.
3. A compressed bathymetry curve using:
   ultraShallowWidthM, paleAquaWidthM, turquoiseShelfM, reefShelfM, deepBlueStartM.
4. Smoothing in meters, clamped so it cannot inflate the shallow shelf.
5. A masked smoothing/relaxation pass that does not bleed land or disc-edge values into the water.
6. A rendering change so the circular ocean disc edge is hidden or faded to deep ocean blue, never white/cyan/transparent.
7. Scale warnings when shelf widths are too large relative to island width.

Keep the seafloor circular and customizable for export, but make the web preview look like an open ocean around a massive island.

Do not implement soar gameplay.
Do not replace the whole app.
Do not expand large monolith files unnecessarily; split new logic into focused modules/components.
Add tests for bathymetry scale behavior:
- massive preset shallow shelf stays narrow
- ocean radius does not change near-shore bathymetry colors
- disc edge fades to deep blue, not pale aqua
- lowering shelf sliders actually narrows the shallow zone
```
