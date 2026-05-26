# Island Dreamforge

A local full-stack web app for converting illustrated island maps into editable height maps, reversible water-baked terrain, paintable 3D islands, and exported game/art assets.

The app is designed around a three-stage workflow:

1. **Height from colors** — upload a map, click colors with the picker, assign real meter heights, then generate a grayscale/16-bit height map.
2. **Water bake** — upload a water/river/lake layer and non-destructively carve, flatten, or overlay it on top of the height map.
3. **3D sculpt/paint/export** — orbit a 3D terrain view, use Zoo Tycoon-style raise/lower/smooth/flatten/paint brushes, tune tropical water, and export meshes/maps.

## What is included

- React/Vite frontend.
- FastAPI backend.
- Three.js 3D viewport with orbit controls, lighting, animated water plane, sculpt brushes, and terrain painting.
- Backend image processing for color-sampled height maps.
- Reversible water baking.
- Mesh export: **GLB, OBJ, STL, PLY**.
- Project ZIP export with maps, recipes, and model files.
- Built-in terrain textures: sand, wet sand, grass, forest, cliff rock, dirt.
- Included example layers from the current island setup:
  - `examples/input/base_map.png`
  - `examples/input/water_layer.png`
  - `examples/input/structure_layer.png`

## Quick start

From the project root, run:

```bash
./mapmkr run
```

That one command checks for Python/Node, creates the backend virtual environment, installs missing Python and npm dependencies, picks free local ports, starts the FastAPI backend and Vite frontend, and prints the local URL to open.

Useful commands:

```bash
./mapmkr run      # install missing app deps and run backend + frontend
./mapmkr setup    # install/update deps only
./mapmkr doctor   # install deps, build frontend, check backend imports
./mapmkr build    # build frontend and check backend imports
./mapmkr clean    # remove local dependency/build folders
```

Optional custom ports:

```bash
BACKEND_PORT=8000 FRONTEND_PORT=5173 ./mapmkr run
```

The app requires Python 3.10–3.13 and Node 18+. `./mapmkr run` prefers Python 3.12 automatically when it is available, recreates an old/bad virtual environment when needed, installs the app dependencies automatically, and asks you to install Python or Node only if either system tool is missing.

### Manual fallback

Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Frontend, in a second terminal:

```bash
cd frontend
npm install
VITE_API_URL=http://localhost:8000 npm run dev
```


## Troubleshooting fixed in this build

- The backend no longer depends on SciPy, so Apple Silicon Macs do **not** need OpenBLAS or a Fortran toolchain just to run the app.
- `./mapmkr` avoids Python 3.14 by default because many binary wheels are not consistently available for it yet; it will prefer Python 3.12/3.13/3.11/3.10.
- The frontend no longer ships a lockfile tied to a private package registry. `./mapmkr` writes a local `.npmrc` that uses `https://registry.npmjs.org/` unless you override it with `MAPMKR_NPM_REGISTRY`.
- If an old `package-lock.json` points at a private/internal registry, `./mapmkr` removes and regenerates it.

## Recommended island settings for the provided map

For the Pokémon Concierge-style resort island reference, start with:

- Max elevation: **500 m**
- Smooth broad forms: **2.0–3.2**
- Round high peaks: **0.5–0.75**
- Peak rounding radius: **7–12**
- Steepen cliff walls: **0.15–0.45**
- Preserve detail: **0.1–0.3**
- Water mode: **carve**
- River cut: **3–6 m**
- Bank smoothing: **10–20 px**

## Exported assets

### Stage 1 ZIP

- `heightmap_16bit.png`
- `heightmap_preview_8bit.png`
- `height_recipe.json`

### Stage 2 ZIP

- `heightmap_water_baked_16bit.png`
- `heightmap_water_baked_preview_8bit.png`
- `water_mask.png`
- `water_bake_recipe.json`

### Full project ZIP

- `maps/final_heightmap_16bit.png`
- `maps/painted_texture.png`
- `maps/water_mask.png`
- `models/island_terrain.glb`
- `models/island_terrain.obj`
- `models/island_terrain.stl`
- `project_recipe.json`
- `export_options.json`

## Notes

- The Stage 1 backend creates a true 16-bit PNG height map.
- Browser-based sculpt edits are exported back as an image and can be used for mesh export. For final production, keep the Stage 1/2 16-bit maps as archival sources.
- The water bake is reversible by design: the app keeps the original height map and only applies water as a derived layer.
- The structure layer is supported visually and preserved in the project workflow so it can be used as a flat/protect mask in future tool passes.

## Backend API endpoints

- `GET /health`
- `POST /api/analyze-colors`
- `POST /api/heightmap`
- `POST /api/bake-water`
- `POST /api/export-mesh`
- `POST /api/export-project`
