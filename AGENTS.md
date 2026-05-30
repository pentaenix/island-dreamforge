# Repository Guidance For Coding Agents

**Scope:** Work only inside `island-dreamforge/`. Do not scan sibling repos in the parent monorepo unless the user explicitly asks.

## First files to read (in order)

1. [`README.md`](README.md) — product behavior and run instructions
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — module map and workflow steps
3. [`docs/agents/token-budget-policy.md`](docs/agents/token-budget-policy.md) — **required** before any broad exploration
4. [`docs/agents/agent-playbook.md`](docs/agents/agent-playbook.md) — validation and source-of-truth table

Then open **only** the task path below. Use [`docs/API.md`](docs/API.md) for HTTP contracts.

## Task routing (minimal reads)

| Task | Read first | Avoid unless needed |
|------|------------|---------------------|
| **Heights / color sampling / preprocess** | `backend/app/terrain.py` (grep target function), `docs/API.md` | Full `App.jsx` |
| **Height UI / samples / options** | `frontend/src/App.jsx` (grep step/heights), `shared/island_presets.json` | `TerrainViewport.jsx` |
| **Procedural textures / materials / 3D look** | `frontend/src/TerrainViewport.jsx` (grep `MATERIALS`, shader, forest) | `terrain.py` |
| **Texture step UI** | `frontend/src/App.jsx` (grep textures/step 2) | Backend |
| **Water bake / sea level** | `backend/app/terrain.py` (`bake_water_layer`), README water section | Full viewport |
| **Layer / structure / marker analysis** | `backend/app/layers.py`, `docs/API.md` | `terrain.py` unless height-linked |
| **Mesh export formats** | `backend/app/mesh_export.py`, `docs/API.md` | Frontend |
| **Export / ZIP / download UX** | `frontend/src/App.jsx` (grep export), `backend/app/main.py` (export routes only) | `terrain.py` |
| **API / CORS / new endpoint** | `backend/app/main.py`, `docs/API.md` | `App.jsx` |
| **Runner / deps / ports** | `mapmkr`, `docker-compose.yml` | Source trees |
| **Styling / layout** | `frontend/src/styles.css`, grep in `App.jsx` | Backend |

## Architecture snapshot

- **Backend:** FastAPI on port 8000 — height pipeline (`terrain.py`), overlays (`layers.py`), meshes (`mesh_export.py`).
- **Frontend:** React + Vite + Three.js — `App.jsx` owns the 4-step wizard and IndexedDB autosave; `TerrainViewport.jsx` owns the 3D scene.
- **Run:** `./mapmkr run` from repo root.

## Working rules

- Tier 1 by default ([`token-budget-policy.md`](docs/agents/token-budget-policy.md)): no `node_modules`, `.venv`, `dist`, logs, or binary PNG reads.
- Water baking stays **non-destructive** unless the user requests otherwise (see README).
- Autosave key: `island-dreamforge-autosave-v7` — schema changes need a migration note in README.
- Prefer grep + partial reads on files &gt; 400 lines.

## Validation

See [`docs/agents/agent-playbook.md`](docs/agents/agent-playbook.md). Prefer `./mapmkr run` or targeted `npm run build` / backend import check.

## Changelog

Feature notes for releases: [`UPGRADE_NOTES.md`](UPGRADE_NOTES.md).
