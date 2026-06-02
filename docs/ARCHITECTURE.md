# Island Dreamforge — Architecture

Local **fantasy map → terrain studio**: color map → height field → procedural materials → optional layers → Three.js editor → game-ready exports.

## Runtime layout

```text
island-dreamforge/
  mapmkr                 # ./mapmkr run | setup | doctor | build | clean
  backend/app/           # FastAPI + NumPy/Pillow/trimesh
  frontend/src/          # React 18 + Vite + Three.js
  shared/island_presets.json
  examples/input/        # Sample PNGs (reference only; agents: do not read binaries)
```

| Process | Port (default) | Role |
|---------|----------------|------|
| Vite dev server | 5173 | UI, proxies API in dev |
| Uvicorn (FastAPI) | 8000 | Height, layers, mesh, ZIP export |

Frontend API client: `frontend/src/api.js` (`API_URL`, `postForm`, `downloadBlob`).

## Four-step workflow (UI)

Orchestrated in `frontend/src/App.jsx` (large monolith — split by step when extending):

1. **Heights** — upload map, color samples → meters; backend builds heightmap.
2. **Textures** — procedural material pass settings (resolution, materials, normals).
3. **Water & layers** — optional water/structure/marker/texture overlays; layer analysis API.
4. **3D / export** — `TerrainViewport.jsx` (orbit, sculpt, paint, forest clumps, water + seafloor preview); mesh/ZIP export profiles.

**Persistence:** browser IndexedDB autosave (`island-dreamforge-autosave-v7`). **Reset project** clears it.

## Backend modules

| Module | Responsibility |
|--------|----------------|
| `main.py` | Routes, CORS, multipart parsing, ZIP export wiring |
| `terrain.py` | Color quantization, preprocess, height generation, smoothing, water bake |
| `island_maps.py` | Derived island mask, shoreline, shore distance, bathymetry, material maps |
| `layers.py` | Connected components on overlay layers (structures, markers, water hints) |
| `mesh_export.py` | Height grid → trimesh, land/coast/seafloor meshes, chunked game mesh binary, GLB/OBJ/STL/PLY bytes |
| `island_export.py` | Derived-map API payloads, web/game ZIP assembly, export manifests |
| `image_utils.py` | PIL I/O, previews, 16-bit height PNG, masks |

See [`docs/API.md`](API.md) for route list without opening `main.py`.

## Frontend modules

| Module | ~Lines | Responsibility |
|--------|--------|----------------|
| `App.jsx` | 1080 | Steps UI, state, autosave, API calls, export triggers |
| `TerrainViewport.jsx` | 755 | Three.js scene, materials, water/seafloor preview, trees, brush tools |
| `ExportProfilePanel.jsx` | — | Step 4 ocean/detail controls and web/game export buttons |
| `api.js` | 32 | Fetch helpers |
| `main.jsx` | 6 | React mount |
| `styles.css` | — | Layout and step chrome |

**Materials** exported from `TerrainViewport.jsx` as `MATERIALS` (water, forest, rock, gravel, sand, grass, etc.).

## World scale

`DEFAULT_WORLD_SETTINGS` in `App.jsx`: island width/depth in meters, aspect lock, vertical exaggeration. Mesh export and camera framing use these values (see `UPGRADE_NOTES.md` for cinematic v2 changes).

## Presets

`shared/island_presets.json` — named tuning bundles (`pokemon_resort_soft_cliffs`, `volcanic_island`, `gentle_resort_island`) merged into height options in the UI.

## Docker

`docker-compose.yml` plus `backend/Dockerfile` and `frontend/Dockerfile` for containerized runs. Local dev is normally `./mapmkr run`.

## Extension guidance

- **New height option:** `terrain.py` + form field in App step 1 + document in README if user-visible.
- **New material:** `TerrainViewport.jsx` `MATERIALS` + texture asset under `frontend/src/assets/textures/` + procedural weights in viewport.
- **New export format:** `mesh_export.py` + route in `main.py` + button in App step 4.
- **New overlay type:** `layers.py` + analyze route + App layer UI.

Keep handlers thin; keep math in `terrain.py` / viewport generators.

## Agent docs

- [`AGENTS.md`](../AGENTS.md) — entry and task routing
- [`docs/agents/token-budget-policy.md`](agents/token-budget-policy.md) — token rules
- [`docs/agents/agent-playbook.md`](agents/agent-playbook.md) — working style and validation
