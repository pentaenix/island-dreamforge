# Assets (agent reference)

Do **not** read binary image files into context. Use this map for paths and intent.

Repo root: `assets/` — served in dev at `/island-assets/` via `frontend/public/island-assets` symlink.

## Skybox (3D viewport)

Cubemap faces: `assets/skybox/sky_03_2k/sky_03_cubemap_2k/{px,nx,py,ny,pz,nz}.png`

## Surface PBR tiles (procedural terrain paint)

| Material | Color map |
|----------|-----------|
| grass / trees / forest | `assets/textures/green/grass_03_color_1k.png` |
| sand / wet sand | `assets/textures/sand/sand_04_color_1k.png` |
| rock | `assets/textures/cliff/cliff_rocks_01_color_1k.png` |
| gravel | `assets/textures/ground/ground_05_baseColor_1k.png` |

## Water (Three.js addon)

- Normal map: `frontend/public/waternormals.jpg` (from Three.js examples)
- Shader: `three/examples/jsm/objects/Water.js` — no UI sliders

## Example maps (git + runtime)

| Path | Role |
|------|------|
| `examples/input/base_map.png` | Default color height source |
| `examples/input/handmade_map_wip.png` | WIP handmade sample |
| `examples/input/structure_layer.png` | Structure overlay sample |
| `examples/input/water_layer.png` | Water overlay sample |
| `frontend/public/examples/*` | Same files served to the dev UI |

## Procedural material textures (bundled)

Under `frontend/src/assets/textures/` (imported by Vite):

- `water.png`, `forest.png`, `grass.png`, `rock.png`, `gravel.png`, `sand.png`, `wet_sand.png`, `dirt.png`

Referenced from `TerrainViewport.jsx` `textureUrls` / `MATERIALS`.

## Changing assets

- Replace PNGs in `frontend/src/assets/textures/` and keep filenames stable, **or** update `textureUrls` in `TerrainViewport.jsx`.
- New example maps: add under `examples/input/` and mirror to `frontend/public/examples/` if the UI should load them by URL.
