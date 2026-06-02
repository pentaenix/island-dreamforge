# HTTP API (Island Dreamforge backend)

Base URL: `http://localhost:8000` (override frontend with `VITE_API_URL`).

All POST bodies use `multipart/form-data` unless noted. JSON fields are **stringified JSON** in form fields.

## Health

| Method | Path | Response |
|--------|------|----------|
| GET | `/health` | `{ "status": "ok", "name": "Island Dreamforge API" }` |

## Heights (step 1)

| Method | Path | Key fields | Returns |
|--------|------|------------|---------|
| POST | `/api/analyze-colors` | `map_image`, `count` | Dominant colors, width, height |
| POST | `/api/preprocess-map` | `map_image`, `samples`, `options` | `cleanedPreview` data URL |
| POST | `/api/heightmap` | `map_image`, `samples`, `options`, optional `cleaned_map` | Height previews, 16-bit PNG stages, metadata; ZIP mode includes `manifest.json` |

**Domain logic:** `backend/app/terrain.py` (`generate_heightmap_from_colors`, `preprocess_map_for_height`, `quantize_dominant_colors`).

## Water (step 3)

| Method | Path | Key fields | Returns |
|--------|------|------------|---------|
| POST | `/api/bake-water` | height + water layer images, `mode`, `options` | Baked height preview / arrays; ZIP mode includes `manifest.json` |

**Domain logic:** `terrain.bake_water_layer` (non-destructive modes documented in README).

## Layers

| Method | Path | Key fields | Returns |
|--------|------|------------|---------|
| POST | `/api/analyze-layer` | overlay image, optional height, `options` | Component stats for structures/markers/water |

**Domain logic:** `backend/app/layers.py`.

## Export (step 4)

| Method | Path | Key fields | Returns |
|--------|------|------------|---------|
| POST | `/api/export-mesh` | height data, `format`, world dimensions | Binary mesh (`glb`, `obj`, `stl`, `ply`) |
| POST | `/api/export-project` | full project payload | ZIP archive with `manifest.json` |
| POST | `/api/island-derived-maps` | `heightmap`, `options` | Island mask, shoreline, shore distance, ocean disc, water depth, material previews |
| POST | `/api/export-web-island` | `heightmap`, `options` | Web portal ZIP (`manifest.json`, GLB scene, masks, material/depth textures, metadata) |
| POST | `/api/export-game-island` | `heightmap`, `options` | Game ZIP (`manifest.json`, quantized maps, chunked terrain/seafloor binaries, preview GLB) |

**Domain logic:** `backend/app/island_maps.py`, `backend/app/mesh_export.py`, `backend/app/island_export.py`; route handlers in `main.py` only parse form data and stream responses.

## Shared image helpers

`backend/app/image_utils.py` — upload decode, data URLs, 16-bit height PNG, masks, resize-to-match.
