# Token Budget Policy

Island Dreamforge is a **small** repo (~3.3k lines of app source). Most tasks should stay in **Tier 1** and never load the whole tree.

## Two-tier workflow (default)

### Tier 1 (default)

- Read [`AGENTS.md`](../../AGENTS.md) and [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) only when boundaries are unclear.
- Open **task-specific files** from the routing table in `AGENTS.md` (usually 1–3 files).
- Use **grep** for symbols; use **Read with offset/limit** on large files (`App.jsx`, `TerrainViewport.jsx`, `terrain.py`).
- Prefer [`docs/API.md`](../API.md) over scanning `backend/app/main.py` for endpoint shapes.
- **Never** read: `frontend/node_modules/`, `backend/.venv/`, `frontend/dist/`, `.mapmkr/`, PNG/WebP binaries, or lockfiles.
- Return **findings first**, then a short summary. No broad repo scans.

### Tier 2 (explicit escalation)

Use only when Tier 1 is insufficient:

- Cross-cutting refactors (e.g. splitting `App.jsx` or changing project autosave schema).
- New API surface that touches height + mesh + export together.
- Regressions with unknown cause after targeted reads.

Escalation must name which extra paths you need and why.

## File size guardrails

| File | ~Lines | Rule |
|------|--------|------|
| `frontend/src/App.jsx` | 1080 | Grep first; read one step/section at a time |
| `frontend/src/TerrainViewport.jsx` | 755 | 3D/textures only; avoid full-file read |
| `backend/app/terrain.py` | 720 | Height pipeline only; grep function names |
| `backend/app/main.py` | 290 | Use `docs/API.md` for routes |
| Everything else | &lt;250 | Safe to read whole file when in scope |

## Practical prompt patterns

- “Review only `backend/app/terrain.py` and `docs/API.md` — findings first.”
- “Fix water bake — do not open `App.jsx` unless the UI contract changes.”
- “Propose a patch plan before reading `TerrainViewport.jsx`.”

## Maintenance

When you add a module or API route, update **one** of: `docs/API.md`, `docs/ARCHITECTURE.md`, or the `AGENTS.md` task table. That keeps the next agent’s first pass smaller.
