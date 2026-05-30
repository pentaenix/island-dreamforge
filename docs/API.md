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
| POST | `/api/heightmap` | `map_image`, `samples`, `options`, optional `cleaned_map` | Height previews, 16-bit PNG stages, metadata |

**Domain logic:** `backend/app/terrain.py` (`generate_heightmap_from_colors`, `preprocess_map_for_height`, `quantize_dominant_colors`).

## Water (step 3)

| Method | Path | Key fields | Returns |
|--------|------|------------|---------|
| POST | `/api/bake-water` | height + water layer images, `mode`, `options` | Baked height preview / arrays |

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
| POST | `/api/export-project` | full project payload | ZIP archive |

**Domain logic:** `backend/app/mesh_export.py`, assembly in `main.py`.

## Shared image helpers

`backend/app/image_utils.py` — upload decode, data URLs, 16-bit height PNG, masks, resize-to-match.
