from __future__ import annotations

from typing import Any, Dict, List, Tuple

import numpy as np

# Tropical aerial / Pokémon-style stepped ramp (sand → pale aqua → turquoise → reef → deep)
TROPICAL_RAMP = (
    (0.00, (241, 229, 178)),  # wet sand / pale shore
    (0.12, (189, 244, 231)),  # pale aqua
    (0.28, (83, 214, 210)),   # turquoise lagoon
    (0.48, (31, 182, 201)),   # cyan-blue reef edge
    (0.72, (8, 127, 176)),    # open ocean
    (1.00, (6, 43, 99)),      # deep ocean
)

# Default band edges in meters from shore (tight around island)
DEFAULT_BAND_EDGES_M = (0.0, 10.0, 24.0, 48.0, 78.0, 120.0, 185.0)


def smoothstep(a: float, b: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - a) / max(1e-6, b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def world_coordinates(rows: int, cols: int, options: Dict[str, Any]) -> Tuple[np.ndarray, np.ndarray, float]:
    if options.get("widthM", options.get("worldWidthM")) is None:
        pixel = float(options.get("pixelSizeM", 1.0) or 1.0)
        width_m = pixel * max(1, cols - 1)
        depth_m = pixel * max(1, rows - 1)
    else:
        width_m = float(options.get("widthM", options.get("worldWidthM", 9000)) or 9000)
        depth_m = float(options.get("depthM", options.get("worldDepthM", width_m)) or width_m)
    xs = np.linspace(-width_m / 2.0, width_m / 2.0, cols, dtype=np.float32)
    zs = np.linspace(-depth_m / 2.0, depth_m / 2.0, rows, dtype=np.float32)
    xx, zz = np.meshgrid(xs, zs)
    px = ((width_m / max(1, cols - 1)) + (depth_m / max(1, rows - 1))) * 0.5
    return xx, zz, max(1e-6, float(px))


def chamfer_distance_to_land(island_mask: np.ndarray, pixel_size_m: float, max_distance_m: float) -> np.ndarray:
    land = np.asarray(island_mask, dtype=bool)
    rows, cols = land.shape
    ortho = float(max(1e-6, pixel_size_m))
    diag = ortho * 1.41421356
    large = float(max_distance_m) + diag * (rows + cols + 2)
    dist = np.where(land, 0.0, large).astype(np.float32)

    for y in range(rows):
        for x in range(cols):
            best = dist[y, x]
            if x > 0:
                best = min(best, float(dist[y, x - 1]) + ortho)
            if y > 0:
                best = min(best, float(dist[y - 1, x]) + ortho)
                if x > 0:
                    best = min(best, float(dist[y - 1, x - 1]) + diag)
                if x + 1 < cols:
                    best = min(best, float(dist[y - 1, x + 1]) + diag)
            dist[y, x] = best

    for y in range(rows - 1, -1, -1):
        for x in range(cols - 1, -1, -1):
            best = dist[y, x]
            if x + 1 < cols:
                best = min(best, float(dist[y, x + 1]) + ortho)
            if y + 1 < rows:
                best = min(best, float(dist[y + 1, x]) + ortho)
                if x > 0:
                    best = min(best, float(dist[y + 1, x - 1]) + diag)
                if x + 1 < cols:
                    best = min(best, float(dist[y + 1, x + 1]) + diag)
            dist[y, x] = best
    return np.minimum(dist, max_distance_m).astype(np.float32)


def box_blur(values: np.ndarray, radius: int) -> np.ndarray:
    r = max(0, int(radius))
    if r == 0:
        return values.astype(np.float32, copy=True)
    padded = np.pad(values.astype(np.float32), ((r, r), (r, r)), mode="edge")
    out = np.zeros(values.shape, dtype=np.float32)
    area = float((r * 2 + 1) ** 2)
    for dy in range(r * 2 + 1):
        for dx in range(r * 2 + 1):
            out += padded[dy : dy + values.shape[0], dx : dx + values.shape[1]]
    return out / area


def value_noise(shape: Tuple[int, int], scale_px: float, seed: int) -> np.ndarray:
    rows, cols = shape
    step = max(2, int(scale_px))
    gy = rows // step + 3
    gx = cols // step + 3
    yy, xx = np.indices((gy, gx), dtype=np.float32)
    grid = np.sin((xx + seed * 13.17) * 12.9898 + (yy - seed * 7.91) * 78.233) * 43758.5453
    grid = (grid - np.floor(grid)).astype(np.float32)
    y = np.arange(rows, dtype=np.float32) / step
    x = np.arange(cols, dtype=np.float32) / step
    y0 = np.floor(y).astype(np.int32)
    x0 = np.floor(x).astype(np.int32)
    y1 = y0 + 1
    x1 = x0 + 1
    ty = (y - y0)[:, None]
    tx = (x - x0)[None, :]
    a = grid[y0[:, None], x0[None, :]]
    b = grid[y0[:, None], x1[None, :]]
    c = grid[y1[:, None], x0[None, :]]
    d = grid[y1[:, None], x1[None, :]]
    return ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty) * 2.0 - 1.0


def _band_edges_from_options(opts: Dict[str, Any]) -> List[float]:
    shallow = float(opts.get("shallowShelfM", opts.get("shoreShelfWidthM", 24.0)) or 24.0)
    mid = float(opts.get("midShelfM", opts.get("midWaterDistanceM", 70.0)) or 70.0)
    deep = float(opts.get("deepStartM", opts.get("deepWaterDistanceM", 150.0)) or 150.0)
    edges = [0.0, max(4.0, shallow * 0.35), shallow, mid, deep, deep + 80.0]
    custom = opts.get("waterBandEdgesM")
    if isinstance(custom, (list, tuple)) and len(custom) >= 2:
        edges = [float(v) for v in custom]
    edges = sorted(set(max(0.0, e) for e in edges))
    for i in range(1, len(edges)):
        if edges[i] <= edges[i - 1]:
            edges[i] = edges[i - 1] + 1.0
    return edges


def distance_to_bathymetry01(
    shore_distance_m: np.ndarray,
    water_mask: np.ndarray,
    band_edges_m: List[float],
) -> np.ndarray:
    """Map shore distance (meters) to 0..1 using discrete bands like map art."""
    dist = np.asarray(shore_distance_m, dtype=np.float32)
    water = np.asarray(water_mask, dtype=bool)
    edges = band_edges_m
    n = max(1, len(edges) - 1)
    bathy = np.zeros(dist.shape, dtype=np.float32)
    for i in range(n):
        lo = edges[i]
        hi = edges[i + 1] if i + 1 < len(edges) else edges[-1] + 1e6
        mask = water & (dist >= lo) & (dist < hi)
        bathy[mask] = i / max(1, n - 1)
    bathy[water & (dist >= edges[-1])] = 1.0
    return np.clip(bathy, 0.0, 1.0).astype(np.float32)


def discrete_band_colors(values: np.ndarray, ramp=TROPICAL_RAMP) -> np.ndarray:
    """Hard-step colors per bathymetry band (no smooth blending between stops)."""
    stops = [np.asarray(rgb, dtype=np.float32) for _, rgb in ramp]
    n = len(stops)
    idx = np.clip(np.rint(np.clip(values.astype(np.float32), 0.0, 1.0) * (n - 1)), 0, n - 1).astype(np.int32)
    return np.asarray(stops, dtype=np.uint8)[idx]


def color_ramp(values: np.ndarray, ramp=TROPICAL_RAMP) -> np.ndarray:
    return discrete_band_colors(values, ramp)


def generate_bathymetry(height: np.ndarray, island_mask: np.ndarray, options: Dict[str, Any] | None = None) -> Dict[str, np.ndarray]:
    opts = options or {}
    h = np.asarray(height, dtype=np.float32)
    land = np.asarray(island_mask, dtype=bool)
    rows, cols = h.shape
    xx, zz, pixel_m = world_coordinates(rows, cols, opts)

    sea = float(opts.get("seaLevelM", 0.0) or 0.0)
    radius = float(opts.get("oceanRadiusM", max(rows, cols) * pixel_m * 0.55) or 0.0)
    max_depth = float(opts.get("maxOceanDepthM", 180.0) or 180.0)
    smooth_px = min(int(opts.get("bathymetrySmoothPx", 1) or 1), 2)
    coastal_variation = float(opts.get("coastalVariationStrength", 0.18) or 0.18)
    reef_strength = float(opts.get("reefNoiseStrength", 0.05) or 0.05)
    foam_width = float(opts.get("foamWidthM", 10.0) or 10.0)
    foam_strength = float(opts.get("foamStrength", 0.22) or 0.22)
    seed = int(opts.get("seed", opts.get("materialSeed", 1337)) or 1337)
    band_edges = _band_edges_from_options(opts)

    radial = np.sqrt(xx * xx + zz * zz).astype(np.float32)
    ocean_disc = radial <= radius
    water_mask = ocean_disc & ~land
    max_dist = max(radius, band_edges[-1] + 40.0, pixel_m * 4.0)
    shore_distance = chamfer_distance_to_land(land, pixel_m, max_dist)

    gy, gx = np.gradient(h, pixel_m, pixel_m)
    slope01 = np.clip(np.sqrt(gx * gx + gy * gy), 0.0, 1.0)
    sandness = ((h <= sea + 28.0) & (slope01 < 0.28) & land).astype(np.float32)
    coast_sand = box_blur(sandness, max(1, int(band_edges[2] / pixel_m)))
    coast_slope = box_blur((slope01 * land).astype(np.float32), max(1, int(band_edges[2] / pixel_m)))
    coast_noise = box_blur(value_noise((rows, cols), max(8, min(rows, cols) * 0.12), seed + 11), 1)

    shelf_scale = 1.0 + 0.35 * coast_sand - 0.45 * coast_slope + coastal_variation * coast_noise * 0.25
    shelf_scale = np.clip(shelf_scale, 0.55, 1.35)
    effective_m = shore_distance / np.maximum(0.35, shelf_scale)

    bathy = distance_to_bathymetry01(effective_m, water_mask, band_edges)

    if smooth_px > 0:
        soft = box_blur(bathy, smooth_px)
        bathy = np.where(water_mask, soft, 0.0)
        bathy = distance_to_bathymetry01(effective_m, water_mask, band_edges)

    if reef_strength > 0:
        reef = box_blur(value_noise((rows, cols), max(6, min(rows, cols) * 0.06), seed + 29), 1)
        shallow_w = 1.0 - smoothstep(band_edges[2], band_edges[-2], effective_m)
        perturbed = effective_m + reef * reef_strength * shallow_w * band_edges[2] * 0.35
        bathy = distance_to_bathymetry01(perturbed, water_mask, band_edges)

    seafloor = sea - bathy * max_depth
    near = 1.0 - smoothstep(0.0, band_edges[2], effective_m)
    seafloor = np.where(water_mask, seafloor * (1.0 - near * 0.15) + (sea - 1.5) * (near * 0.15), sea)

    foam_noise = (value_noise((rows, cols), max(3, foam_width / pixel_m * 1.5), seed + 71) + 1.0) * 0.5
    foam_inner = max(pixel_m * 0.35, foam_width * 0.08)
    foam_outer = max(foam_width, pixel_m * 1.25)
    foam = (1.0 - smoothstep(foam_inner, foam_outer, shore_distance)) * water_mask
    foam = np.clip(foam * (0.7 + 0.3 * foam_noise) * foam_strength, 0.0, 1.0).astype(np.float32)

    wave = ((value_noise((rows, cols), max(5, min(rows, cols) * 0.04), seed + 101) + 1.0) * 0.5).astype(np.float32)
    water_color = color_ramp(bathy)
    water_color[~water_mask] = 0

    return _package_bathymetry_arrays(
        bathy, seafloor, water_mask, ocean_disc, shore_distance, foam, wave, water_color, band_edges, land, max_depth
    )


def _package_bathymetry_arrays(
    bathy,
    seafloor,
    water_mask,
    ocean_disc,
    shore_distance,
    foam,
    wave,
    water_color,
    band_edges,
    land,
    max_depth,
):
    return {
        "bathymetry01": bathy.astype(np.float32),
        "seafloor_height": seafloor.astype(np.float32),
        "water_depth_m": (bathy * max_depth * water_mask).astype(np.float32),
        "water_depth_norm": bathy.astype(np.float32),
        "shore_distance_m": shore_distance.astype(np.float32),
        "ocean_disc_mask": ocean_disc.astype(bool),
        "water_mask": water_mask.astype(bool),
        "foam_mask": foam,
        "wave_noise": wave,
        "water_color_rgb": water_color,
        "water_band_edges_m": np.asarray(band_edges, dtype=np.float32),
        "island_mask": land.astype(bool),
    }


def generate_water_disc_preview(options: Dict[str, Any] | None = None) -> Dict[str, np.ndarray]:
    """
    Shape-agnostic water editor preview: circular ocean disc with a central sphere.
    Bands deepen by distance from the sphere surface — no heightmap or island data.
    """
    opts = options or {}
    ocean_r = float(opts.get("oceanRadiusM", 850.0) or 850.0)
    sphere_r = float(opts.get("previewSphereRadiusM", opts.get("waterPreviewSphereRadiusM", 220.0)) or 220.0)
    sphere_r = min(max(8.0, sphere_r), max(8.0, ocean_r - 20.0))
    size = int(opts.get("waterPreviewSizePx", 512) or 512)
    size = int(np.clip(size, 128, 1024))
    pixel_m = (ocean_r * 2.0) / max(1, size - 1)
    smooth_px = min(int(opts.get("bathymetrySmoothPx", 1) or 1), 2)
    reef_strength = float(opts.get("reefNoiseStrength", 0.05) or 0.05)
    seed = int(opts.get("seed", opts.get("materialSeed", 1337)) or 1337)
    band_edges = _band_edges_from_options(opts)

    xs = np.linspace(-ocean_r, ocean_r, size, dtype=np.float32)
    zs = np.linspace(-ocean_r, ocean_r, size, dtype=np.float32)
    xx, zz = np.meshgrid(xs, zs)
    radial = np.sqrt(xx * xx + zz * zz).astype(np.float32)

    ocean_disc = radial <= ocean_r
    obstacle = radial <= sphere_r
    water_mask = ocean_disc & ~obstacle
    shore_distance = np.maximum(0.0, radial - sphere_r).astype(np.float32)
    pixel_m = (ocean_r * 2.0) / max(1, size - 1)

    coastal_variation = float(opts.get("coastalVariationStrength", 0.15) or 0.15)
    coast_noise = box_blur(value_noise((size, size), max(8, size * 0.12), seed + 11), 1)
    effective_distance = shore_distance * np.clip(
        1.0 + coastal_variation * coast_noise * 0.22, 0.55, 1.35
    )

    bathy = distance_to_bathymetry01(effective_distance, water_mask, band_edges)
    if smooth_px > 0:
        soft = box_blur(bathy, smooth_px)
        bathy = np.where(water_mask, soft, 0.0)
        bathy = distance_to_bathymetry01(effective_distance, water_mask, band_edges)

    if reef_strength > 0:
        reef = box_blur(value_noise((size, size), max(6, size * 0.06), seed + 29), 1)
        shallow_w = 1.0 - smoothstep(band_edges[2], band_edges[-2], effective_distance)
        perturbed = effective_distance + reef * reef_strength * shallow_w * band_edges[2] * 0.35
        bathy = distance_to_bathymetry01(perturbed, water_mask, band_edges)

    land = obstacle
    max_depth = float(opts.get("maxOceanDepthM", 180.0) or 180.0)
    sea = 0.0
    seafloor = np.where(water_mask, sea - bathy * max_depth, sea).astype(np.float32)

    foam_width = float(opts.get("foamWidthM", 12.0) or 12.0)
    foam_strength = float(opts.get("foamStrength", 0.2) or 0.2)
    foam_noise = (value_noise((size, size), max(3, foam_width / pixel_m * 1.5), seed + 71) + 1.0) * 0.5
    foam_inner = max(pixel_m * 0.35, foam_width * 0.12)
    foam_outer = max(foam_width, pixel_m * 1.25)
    foam = (1.0 - smoothstep(foam_inner, foam_outer, effective_distance)) * water_mask
    foam = np.clip(foam * (0.7 + 0.3 * foam_noise) * foam_strength, 0.0, 1.0).astype(np.float32)

    wave_strength = float(opts.get("waterNoiseStrength", 0.1) or 0.1)
    wave_scale = float(opts.get("waterNoiseScaleM", 85.0) or 85.0)
    wave = ((value_noise((size, size), max(5, wave_scale / pixel_m * 0.8), seed + 101) + 1.0) * 0.5).astype(np.float32)

    water_color = color_ramp(bathy).astype(np.float32)
    if wave_strength > 0:
        sparkle = value_noise((size, size), max(4, wave_scale / pixel_m * 0.4), seed + 203)
        water_color = np.clip(
            water_color + sparkle[..., None] * wave_strength * 55.0,
            0,
            255,
        )
    if np.any(foam > 0):
        foam_rgb = np.array([245.0, 252.0, 255.0], dtype=np.float32)
        water_color = water_color * (1.0 - foam[..., None]) + foam_rgb * foam[..., None]
    water_color = water_color.round().astype(np.uint8)
    water_color[~water_mask] = 0

    return _package_bathymetry_arrays(
        bathy, seafloor, water_mask, ocean_disc, effective_distance, foam, wave, water_color, band_edges, land, max_depth
    )
