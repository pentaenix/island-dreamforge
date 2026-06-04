from __future__ import annotations

from collections import deque
from typing import Any, Dict, Iterable, List, Tuple

import numpy as np

from .bathymetry import generate_bathymetry
from .distance_field import euclidean_distance_to_land


MATERIAL_WATER = 0
MATERIAL_WET_SAND = 1
MATERIAL_SAND = 2
MATERIAL_GRASS = 3
MATERIAL_FOREST = 4
MATERIAL_ROCK = 5
MATERIAL_GRAVEL = 6
MATERIAL_DIRT = 7


def _bool_option(options: Dict[str, Any], key: str, default: bool) -> bool:
    value = options.get(key, default)
    if isinstance(value, str):
        return value.lower() not in {"0", "false", "no", "off"}
    return bool(value)


def _shift_bool(mask: np.ndarray, dy: int, dx: int, fill: bool = False) -> np.ndarray:
    rows, cols = mask.shape
    out = np.full((rows, cols), fill, dtype=bool)

    src_y0 = max(0, -dy)
    src_y1 = rows - max(0, dy)
    dst_y0 = max(0, dy)
    dst_y1 = rows - max(0, -dy)

    src_x0 = max(0, -dx)
    src_x1 = cols - max(0, dx)
    dst_x0 = max(0, dx)
    dst_x1 = cols - max(0, -dx)

    if src_y0 < src_y1 and src_x0 < src_x1:
        out[dst_y0:dst_y1, dst_x0:dst_x1] = mask[src_y0:src_y1, src_x0:src_x1]
    return out


def _dilate(mask: np.ndarray) -> np.ndarray:
    out = np.zeros(mask.shape, dtype=bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            out |= _shift_bool(mask, dy, dx, fill=False)
    return out


def _erode(mask: np.ndarray) -> np.ndarray:
    out = np.ones(mask.shape, dtype=bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            out &= _shift_bool(mask, dy, dx, fill=False)
    return out


def _open(mask: np.ndarray, passes: int) -> np.ndarray:
    out = mask.astype(bool, copy=True)
    for _ in range(max(0, int(passes))):
        out = _dilate(_erode(out))
    return out


def _close(mask: np.ndarray, passes: int) -> np.ndarray:
    out = mask.astype(bool, copy=True)
    for _ in range(max(0, int(passes))):
        out = _erode(_dilate(out))
    return out


def _iter_neighbors(y: int, x: int, rows: int, cols: int) -> Iterable[Tuple[int, int]]:
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0:
                continue
            yy, xx = y + dy, x + dx
            if 0 <= yy < rows and 0 <= xx < cols:
                yield yy, xx


def _connected_components(mask: np.ndarray) -> List[List[Tuple[int, int]]]:
    rows, cols = mask.shape
    seen = np.zeros((rows, cols), dtype=bool)
    comps: List[List[Tuple[int, int]]] = []

    for y in range(rows):
        for x in range(cols):
            if not mask[y, x] or seen[y, x]:
                continue
            comp: List[Tuple[int, int]] = []
            q: deque[Tuple[int, int]] = deque([(y, x)])
            seen[y, x] = True
            while q:
                cy, cx = q.popleft()
                comp.append((cy, cx))
                for ny, nx in _iter_neighbors(cy, cx, rows, cols):
                    if mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            comps.append(comp)
    return comps


def _filter_components(mask: np.ndarray, min_area: int, keep_largest: bool) -> np.ndarray:
    comps = _connected_components(mask)
    if not comps:
        return np.zeros(mask.shape, dtype=bool)

    if keep_largest:
        largest = max(comps, key=len)
        out = np.zeros(mask.shape, dtype=bool)
        for y, x in largest:
            out[y, x] = True
        return out

    out = np.zeros(mask.shape, dtype=bool)
    for comp in comps:
        if len(comp) >= min_area:
            for y, x in comp:
                out[y, x] = True
    return out


def _fill_small_holes(mask: np.ndarray, max_area: int) -> np.ndarray:
    water = ~mask
    rows, cols = mask.shape
    out = mask.copy()
    for comp in _connected_components(water):
        touches_edge = any(y == 0 or x == 0 or y == rows - 1 or x == cols - 1 for y, x in comp)
        if not touches_edge and len(comp) <= max_area:
            for y, x in comp:
                out[y, x] = True
    return out


def _flood_exterior(passable: np.ndarray) -> np.ndarray:
    """Pixels reachable from the map border through passable cells."""
    grid = np.asarray(passable, dtype=bool)
    rows, cols = grid.shape
    exterior = np.zeros((rows, cols), dtype=bool)
    q: deque[Tuple[int, int]] = deque()
    for y in range(rows):
        for x in range(cols):
            if not grid[y, x]:
                continue
            if y == 0 or y == rows - 1 or x == 0 or x == cols - 1:
                exterior[y, x] = True
                q.append((y, x))
    while q:
        cy, cx = q.popleft()
        for ny, nx in _iter_neighbors(cy, cx, rows, cols):
            if grid[ny, nx] and not exterior[ny, nx]:
                exterior[ny, nx] = True
                q.append((ny, nx))
    return exterior


def refine_island_mask_for_ocean(
    height: np.ndarray,
    island_mask: np.ndarray,
    options: Dict[str, Any] | None = None,
) -> np.ndarray:
    """
    Punch subsea and enclosed-lagoon areas out of the land mask so bathymetry/water
    are not inverted (black bays under a circular ocean plane).
    """
    opts = options or {}
    h = np.asarray(height, dtype=np.float32)
    land = np.asarray(island_mask, dtype=bool)
    sea = float(opts.get("seaLevelM", 0.0) or 0.0)
    threshold = float(opts.get("landThresholdM", sea + 0.25) or (sea + 0.25))
    subsea = h <= threshold

    land = land & (~subsea)

    # Open-water pockets inside the island ring (crescent bay)
    exterior_water = _flood_exterior(~land)
    lagoon = (~land) & (~exterior_water)
    land[lagoon] = False

    # Enclosed subsea cavities wrongly filled as land by morphology
    exterior_sea = _flood_exterior((~land) | subsea)
    enclosed_subsea = (~exterior_sea) & subsea
    land[enclosed_subsea] = False

    return land.astype(bool)


def derive_island_mask(height: np.ndarray, options: Dict[str, Any] | None = None) -> np.ndarray:
    """Return a cleaned boolean mask of land pixels from a meter height field."""
    opts = options or {}
    h = np.asarray(height, dtype=np.float32)
    sea = float(opts.get("seaLevelM", 0.0) or 0.0)
    threshold = float(opts.get("landThresholdM", sea + 0.25) or (sea + 0.25))
    min_area = int(opts.get("minIslandAreaPx", 16) or 16)
    keep_largest = _bool_option(opts, "keepLargestIsland", False)

    mask = h > threshold
    mask = _close(mask, int(opts.get("maskClosePasses", 1) or 0))
    mask = _open(mask, int(opts.get("maskOpenPasses", 0) or 0))
    mask = _fill_small_holes(mask, min_area)
    mask = _filter_components(mask, min_area, keep_largest)
    return mask.astype(bool)


def compute_shoreline_mask(island_mask: np.ndarray) -> np.ndarray:
    """Land pixels with at least one 8-neighbor water/out-of-bounds pixel."""
    land = np.asarray(island_mask, dtype=bool)
    neighbor_land = np.ones(land.shape, dtype=bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0:
                continue
            neighbor_land &= _shift_bool(land, dy, dx, fill=False)
    return land & ~neighbor_land


def compute_distance_to_land(
    island_mask: np.ndarray,
    pixel_size_m: float,
    max_distance_m: float,
) -> np.ndarray:
    """Euclidean distance from every cell to nearest land, in meters."""
    return euclidean_distance_to_land(island_mask, pixel_size_m, max_distance_m)


def _world_coordinates(rows: int, cols: int, options: Dict[str, Any]) -> Tuple[np.ndarray, np.ndarray, float]:
    pixel = float(options.get("pixelSizeM", 1.0) or 1.0)
    width = options.get("worldWidthM", options.get("widthM"))
    depth = options.get("worldDepthM", options.get("depthM"))

    if width is not None and depth is not None:
        width_m = float(width)
        depth_m = float(depth)
        xs = np.linspace(-width_m / 2.0, width_m / 2.0, cols, dtype=np.float32)
        zs = np.linspace(-depth_m / 2.0, depth_m / 2.0, rows, dtype=np.float32)
        px_x = width_m / max(1, cols - 1)
        px_z = depth_m / max(1, rows - 1)
        pixel = float((px_x + px_z) * 0.5)
    else:
        xs = (np.arange(cols, dtype=np.float32) - (cols - 1) * 0.5) * pixel
        zs = (np.arange(rows, dtype=np.float32) - (rows - 1) * 0.5) * pixel

    xx, zz = np.meshgrid(xs, zs)
    return xx, zz, max(1e-6, pixel)


def _smoothstep(t: np.ndarray) -> np.ndarray:
    tt = np.clip(t, 0.0, 1.0)
    return tt * tt * (3.0 - 2.0 * tt)


def _deterministic_noise(shape: Tuple[int, int], seed: int) -> np.ndarray:
    y, x = np.indices(shape, dtype=np.float32)
    value = np.sin((x + seed * 17.0) * 12.9898 + (y - seed * 31.0) * 78.233) * 43758.5453
    return ((value - np.floor(value)) * 2.0 - 1.0).astype(np.float32)


def generate_ocean_bathymetry(
    height: np.ndarray,
    island_mask: np.ndarray,
    options: Dict[str, Any] | None = None,
) -> Dict[str, np.ndarray]:
    """Create seafloor height and water-depth maps that deepen away from land."""
    return generate_bathymetry(height, island_mask, options or {})


def _slope_norm(height: np.ndarray, pixel_size_m: float) -> np.ndarray:
    gy, gx = np.gradient(height.astype(np.float32), max(1e-6, pixel_size_m), max(1e-6, pixel_size_m))
    slope = np.sqrt(gx * gx + gy * gy)
    return np.clip(slope / 1.0, 0.0, 1.0).astype(np.float32)


def generate_material_maps(
    height: np.ndarray,
    island_mask: np.ndarray,
    shore_distance_m: np.ndarray,
    options: Dict[str, Any] | None = None,
) -> Dict[str, np.ndarray]:
    """Generate deterministic material ID and RGBA splat maps."""
    opts = options or {}
    h = np.asarray(height, dtype=np.float32)
    land = np.asarray(island_mask, dtype=bool)
    rows, cols = h.shape
    _, _, pixel_size = _world_coordinates(rows, cols, opts)

    sea = float(opts.get("seaLevelM", 0.0) or 0.0)
    max_height = max(1.0, float(opts.get("maxHeightM", float(np.max(h)) if h.size else 500.0) or 500.0))
    beach_width = float(opts.get("beachWidthM", 80.0) or 80.0)
    wet_width = float(opts.get("wetSandWidthM", 12.0) or 12.0)
    slope = _slope_norm(h, pixel_size)
    inland_distance = compute_distance_to_land(~land, pixel_size, max(beach_width * 2.0, pixel_size))

    low = h <= sea + float(opts.get("sandMaxHeightM", 36.0) or 36.0)
    near_beach = inland_distance <= beach_width
    wet = inland_distance <= wet_width

    gravel_slope = float(opts.get("gravelSlopeThreshold", 0.34) or 0.34)
    rock_slope = float(opts.get("rockSlopeThreshold", 0.58) or 0.58)
    rock_height = float(opts.get("rockHeightM", max_height * 0.68) or (max_height * 0.68))

    material = np.full((rows, cols), MATERIAL_WATER, dtype=np.uint8)
    material[land] = MATERIAL_GRASS
    material[land & near_beach & low] = MATERIAL_SAND
    material[land & wet & (h <= sea + 8.0)] = MATERIAL_WET_SAND
    material[land & ((slope > gravel_slope) | (h > rock_height * 0.82))] = MATERIAL_GRAVEL
    material[land & ((slope > rock_slope) | (h > rock_height))] = MATERIAL_ROCK

    seed = int(opts.get("materialSeed", opts.get("seed", 1337)) or 1337)
    forest_density = float(np.clip(opts.get("forestDensity", 0.26), 0.0, 1.0))
    noise = (_deterministic_noise((rows, cols), seed + 53) + 1.0) * 0.5
    forest_band = (h > sea + float(opts.get("forestMinHeightM", 24.0) or 24.0)) & (h < rock_height * 0.88)
    forest = land & forest_band & (material == MATERIAL_GRASS) & (slope < gravel_slope) & (noise > (1.0 - forest_density))
    material[forest] = MATERIAL_FOREST

    # RGBA channels are: sand/wet, grass/forest, rock/gravel, water/seafloor.
    splat = np.zeros((rows, cols, 4), dtype=np.float32)
    sand_w = np.where(np.isin(material, [MATERIAL_WET_SAND, MATERIAL_SAND]), 1.0, 0.0)
    grass_w = np.where(np.isin(material, [MATERIAL_GRASS, MATERIAL_FOREST]), 1.0, 0.0)
    rock_w = np.where(np.isin(material, [MATERIAL_ROCK, MATERIAL_GRAVEL]), 1.0, 0.0)
    water_w = np.where(material == MATERIAL_WATER, 1.0, 0.0)
    splat[..., 0] = sand_w
    splat[..., 1] = grass_w
    splat[..., 2] = rock_w
    splat[..., 3] = water_w

    # Softly bias beaches by water distance so web shaders can blend shore edges.
    shore = np.asarray(shore_distance_m, dtype=np.float32)
    shallow_water = (~land) & (shore <= beach_width)
    if np.any(shallow_water):
        t = np.clip(1.0 - shore / max(1.0, beach_width), 0.0, 1.0)
        splat[..., 0] = np.where(shallow_water, np.maximum(splat[..., 0], t * 0.45), splat[..., 0])
        splat[..., 3] = np.where(shallow_water, np.maximum(splat[..., 3], 0.55), splat[..., 3])

    denom = np.maximum(np.sum(splat, axis=-1, keepdims=True), 1e-6)
    splat_u8 = np.clip((splat / denom) * 255.0, 0.0, 255.0).round().astype(np.uint8)

    return {
        "material_ids_u8": material,
        "material_splat_rgba": splat_u8,
        "slope_norm": slope,
    }
