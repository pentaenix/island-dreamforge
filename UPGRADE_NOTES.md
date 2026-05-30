# Island Dreamforge – cinematic terrain upgrade v2

This build focuses on moving the 3D preview closer to the target island render you shared while preserving the existing four-step workflow.

## Added

### Real-world scale
- Island width in meters
- Island depth in meters
- Aspect-ratio lock from the uploaded map
- Vertical exaggeration
- Meters-per-pixel readout
- Exported meshes now use the configured world dimensions

### Better 3D presentation
- Camera reset adapts to the island's configured size
- Terrain mesh uses width/depth settings instead of a fixed hard-coded footprint
- Improved sky, fog, fill light, sunlight, exposure, and default framing

### Water visual pass
- World-scale-aware ocean radius
- Transparent stylized water with stronger shallow/deep color behavior
- Better wave/sparkle/shoreline foam behavior
- Water no longer feels as much like a small square plane

### Forest-from-a-distance pass
- Lightweight procedural canopy clumps are scattered over forest-friendly areas
- Clumps respect forest density and slope fade
- Designed to read as trees from afar without expensive hero foliage

## Validated
- Frontend production build succeeded with Vite
- Backend import check passed

Run fresh:

```bash
./mapmkr clean
./mapmkr run
```

Agent / contributor context: see [`AGENTS.md`](AGENTS.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
