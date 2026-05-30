# Agent Playbook

## Default working style

1. Confirm the **workflow step** (Heights → Textures → Water & Layers → 3D / Export).
2. Open only the files listed for that step in [`AGENTS.md`](../../AGENTS.md).
3. State assumptions in one short paragraph before editing.
4. Propose the patch, then implement.
5. Validate with the smallest check that fits the change (see below).

## Prompt contract (recommended)

Every implementation request should specify:

1. **Target paths** (or step name: heights, textures, water, 3d, export).
2. **Definition of done** (behavior or UI outcome).
3. **Output size** (e.g. “short summary only”).
4. **No unrelated exploration** unless Tier 2 is approved in [`token-budget-policy.md`](token-budget-policy.md).

## Source-of-truth rules

| Concern | Owner |
|---------|--------|
| Height math, smoothing, water bake | `backend/app/terrain.py` |
| Overlay / layer analysis | `backend/app/layers.py` |
| Mesh build & formats | `backend/app/mesh_export.py` |
| HTTP routes & ZIP export | `backend/app/main.py` |
| Step UI, samples, autosave, exports UX | `frontend/src/App.jsx` |
| Three.js scene, materials, sculpt/paint | `frontend/src/TerrainViewport.jsx` |
| API base URL & download helpers | `frontend/src/api.js` |
| Island preset defaults | `shared/island_presets.json` |
| Client project persistence | IndexedDB key `island-dreamforge-autosave-v7` in `App.jsx` |

## Validation (minimal)

```bash
# From repo root — full stack smoke
./mapmkr run

# Backend import only
cd backend && .venv/bin/python -c "from app.main import app"

# Frontend production build
cd frontend && npm run build
```

Use **one** of the above unless the change clearly needs more.

## Clean code rules for this repo

- Prefer extending existing functions in `terrain.py` / `TerrainViewport.jsx` over new parallel pipelines.
- Keep FastAPI handlers thin: parse form JSON, call domain module, return JSON/blob.
- Do not paste large base64 or PNG blobs into source files.
- If `App.jsx` grows further, split by **workflow step** (not by random helpers).

## When architecture changes

Update [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and the task table in [`AGENTS.md`](../../AGENTS.md) in the same change.
