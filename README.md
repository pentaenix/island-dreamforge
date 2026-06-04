# Island Dreamforge

Island Dreamforge is a local fantasy-map-to-terrain studio. It turns clean handmade color maps into smooth height maps, a procedural texture/material pass, optional water/structure/marker overlays, a polished 3D editor, and exportable game-ready assets.

## Documentation

| Doc | Purpose |
|-----|---------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Module map, workflow steps, extension points |
| [`docs/API.md`](docs/API.md) | Backend HTTP routes (read this instead of scanning `main.py`) |
| [`docs/ASSETS.md`](docs/ASSETS.md) | Image paths — agents should not load binary PNGs |
| [`AGENTS.md`](AGENTS.md) | Coding-agent entry: task routing and rules |
| [`docs/agents/token-budget-policy.md`](docs/agents/token-budget-policy.md) | Token usage protection — **read before repo-wide search** |
| [`docs/agents/agent-playbook.md`](docs/agents/agent-playbook.md) | Validation commands and source-of-truth table |
| [`UPGRADE_NOTES.md`](UPGRADE_NOTES.md) | Release / upgrade changelog |
| [`shared/viewport_config.json`](shared/viewport_config.json) | Cinematic preset: lighting, fog, ocean, forest density, cliff rules (edit, then refresh) |

For AI-assisted work: start with `AGENTS.md` and the token policy so each check uses fewer files and less context over time.

## Run locally

```bash
./mapmkr run
```

The runner checks for Python 3.10-3.13 and Node 18+, creates the backend virtual environment, installs missing dependencies, starts the FastAPI backend and Vite frontend, and prints the local URL.

## Workflow

1. **Heights** — color → height ladder, optional **flat-section masks** (any color on PNG; height comes from the color map), then generate the height map.
2. **Textures** — procedural art pass (resolution, tiling, forest blocks, rock slopes, etc.).
3. **Water** — ocean disc preview; optional water masks that bake shallow indents or local flattening into the height map.
4. **3D / Export** — viewport sculpt/paint; structure, marker, and texture overlays for preview and JSON export.

## Important behavior

- Water baking is non-destructive by design. The default water mode is **Visual water only**, and indent modes only make a shallow bed instead of carving holes to the bottom.
- Refreshing the page restores your current project from local IndexedDB autosave.
- The bottom-right **Reset project** button clears the local autosave and starts from zero.
- **Heights tab → Island world scale** sets land width/depth in meters (presets up to ~30 km), terrain mesh polygon density, and fixed-meter spacing/size for trees and future paths/buildings.
- Structures and markers snap to the final smoothed terrain in the 3D viewport.
- The 3D view hides sea-level terrain pixels so the island rises out of water instead of looking like a rectangular PNG.
- The water shader uses transparency, reflection/sparkle, depth darkening, shoreline foam, and horizon fade for a better default ocean without heavy frame-rate cost.
- Procedural materials include water, trees, rock, gravel, sand, and grass, with generated albedo and normal maps.

## Exports

- Height maps: PNG stages and final edited heightmap
- Meshes: GLB, OBJ, STL, PLY
- Texture: painted/procedural texture PNG
- Normal map: procedural normal PNG in full project export
- Water mask: PNG when a water layer is used
- Layer/marker/structure data: JSON
- Full project archive: ZIP

## Fixes in this build

- Added a real Step 2 for procedural texture/material design.
- Added material preview cards for water, trees, rock, gravel, sand, and grass.
- Added texture controls for pixel size, fuzziness, normal strength, rock steepness, tree density, gravel amount, sand/wet-sand bands, and transition behavior.
- Added transparent/darker-with-depth water controls with reflection and shoreline foam.
- Added a projected brush circle and a viewport HUD so terrain editing gives immediate feedback.
- Reworked the 3D toolbar into compact icon buttons with hover tooltips.
- Removed stale/unused old texture assumptions and updated default material IDs to the new material list.
- Verified Python backend imports and frontend production build.
