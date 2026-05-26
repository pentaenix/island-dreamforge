from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

import numpy as np
from PIL import Image

from .image_utils import hex_to_rgb, pil_to_rgb_array, rgb_to_hex


@dataclass
class HeightSample:
    hex: str
    height: float
    tolerance: float = 35.0
    weight: float = 1.0
    label: str = ""


def parse_samples(raw_samples: List[Dict[str, Any]]) -> List[HeightSample]:
    samples: List[HeightSample] = []
    for item in raw_samples:
        if "hex" not in item or "height" not in item:
            continue
        samples.append(
            HeightSample(
                hex=str(item["hex"]),
                height=float(item["height"]),
                tolerance=float(item.get("tolerance", 35)),
                weight=float(item.get("weight", 1.0)),
                label=str(item.get("label", "")),
            )
        )
    if not samples:
        raise ValueError("At least one color-height sample is required.")
    return samples


def quantize_dominant_colors(image: Image.Image, count: int = 12) -> List[Dict[str, Any]]:
    """Return dominant colors using PIL adaptive palette. Designed for map color clustering."""
    max_side = 700
    im = image.convert("RGB")
    scale = min(1.0, max_side / max(im.size))
    if scale < 1.0:
        im = im.resize((int(im.width * scale), int(im.height * scale)), Image.Resampling.BILINEAR)
    pal = im.quantize(colors=max(2, min(256, count)), method=Image.Quantize.MEDIANCUT)
    palette = pal.getpalette() or []
    hist = pal.histogram()
    total = float(sum(hist) or 1)
    colors: List[Dict[str, Any]] = []
    for idx, freq in sorted(enumerate(hist), key=lambda x: x[1], reverse=True)[:count]:
        rgb = palette[idx * 3 : idx * 3 + 3]
        if len(rgb) < 3:
            continue
        colors.append({"hex": rgb_to_hex(rgb), "rgb": rgb, "percent": round((freq / total) * 100, 2)})
    return colors


def _gaussian_filter(array: np.ndarray, sigma: float) -> np.ndarray:
    """Small scipy-free separable Gaussian blur for float terrain arrays."""
    sigma = float(sigma or 0.0)
    arr = array.astype(np.float32, copy=False)
    if sigma <= 0:
        return arr.copy()
    radius = int(max(1, round(sigma * 3.0)))
    x = np.arange(-radius, radius + 1, dtype=np.float32)
    kernel = np.exp(-(x * x) / (2.0 * sigma * sigma)).astype(np.float32)
    kernel /= np.maximum(kernel.sum(), 1e-6)

    padded = np.pad(arr, ((0, 0), (radius, radius)), mode="edge")
    tmp = np.zeros_like(arr, dtype=np.float32)
    for i, weight in enumerate(kernel):
        tmp += float(weight) * padded[:, i : i + arr.shape[1]]

    padded = np.pad(tmp, ((radius, radius), (0, 0)), mode="edge")
    out = np.zeros_like(arr, dtype=np.float32)
    for i, weight in enumerate(kernel):
        out += float(weight) * padded[i : i + arr.shape[0], :]
    return out


def _dilate_mask(mask: np.ndarray) -> np.ndarray:
    """8-neighbour binary dilation using only numpy."""
    m = mask.astype(bool)
    p = np.pad(m, 1, mode="constant", constant_values=False)
    return (
        p[1:-1, 1:-1]
        | p[:-2, 1:-1]
        | p[2:, 1:-1]
        | p[1:-1, :-2]
        | p[1:-1, 2:]
        | p[:-2, :-2]
        | p[:-2, 2:]
        | p[2:, :-2]
        | p[2:, 2:]
    )


def _soft_mask_from_dilation(mask: np.ndarray, radius_px: int) -> np.ndarray:
    """Return a 0..1 falloff mask around a binary mask.

    Values are 1 inside the original mask, then fade out over radius_px pixels.
    This replaces scipy.ndimage.distance_transform_edt for the app's bank/beach
    blending without requiring SciPy/OpenBLAS.
    """
    radius_px = int(max(0, radius_px))
    base = mask.astype(bool)
    weight = np.zeros(base.shape, dtype=np.float32)
    if not np.any(base):
        return weight
    weight[base] = 1.0
    if radius_px <= 0:
        return weight
    current = base.copy()
    for i in range(1, radius_px + 1):
        dilated = _dilate_mask(current)
        ring = dilated & ~current
        if not np.any(ring):
            break
        t = 1.0 - (i / float(radius_px + 1))
        weight[ring] = np.maximum(weight[ring], t)
        current = dilated
    # Smoothstep easing for natural-looking shores and riverbanks.
    return weight * weight * (3.0 - 2.0 * weight)


def generate_heightmap_from_colors(
    image: Image.Image,
    samples: List[HeightSample],
    max_height_m: float,
    options: Dict[str, Any] | None = None,
) -> np.ndarray:
    """Generate a meter heightmap by interpolating picked map colors.

    Method:
    - Assign each pixel a nearest/weighted color height in RGB space.
    - Pixels inside tolerance are strongly locked to matching sample height.
    - Pixels outside all tolerances use inverse-distance interpolation, preventing holes.
    - Optional smoothing, peak rounding, cliff-strength detail, and terrace bands are applied afterward.
    """
    options = options or {}
    rgb = pil_to_rgb_array(image)
    h, w, _ = rgb.shape
    sample_rgb = np.array([hex_to_rgb(s.hex) for s in samples], dtype=np.float32)
    sample_heights = np.array([s.height for s in samples], dtype=np.float32)
    tolerances = np.array([max(1.0, s.tolerance) for s in samples], dtype=np.float32)
    weights = np.array([max(0.001, s.weight) for s in samples], dtype=np.float32)

    flat = rgb.reshape((-1, 3))
    total = flat.shape[0]
    height_flat = np.empty(total, dtype=np.float32)

    # Chunking keeps memory stable on large illustrated maps.
    chunk_size = int(options.get("chunkPixels", 250_000) or 250_000)
    exponent = float(options.get("colorPower", 2.0))
    lock_power = float(options.get("sampleLockPower", 0.55))

    for start in range(0, total, chunk_size):
        end = min(total, start + chunk_size)
        chunk = flat[start:end]
        d = np.linalg.norm(chunk[:, None, :] - sample_rgb[None, :, :], axis=2)
        nearest_idx = np.argmin(d, axis=1)
        nearest_d = d[np.arange(d.shape[0]), nearest_idx]
        nearest_tol = tolerances[nearest_idx]

        inv = weights[None, :] / np.power(np.maximum(d, 1e-3), exponent)
        idw_height = (inv @ sample_heights) / np.maximum(inv.sum(axis=1), 1e-6)
        nearest_height = sample_heights[nearest_idx]

        lock_strength = np.clip(1.0 - nearest_d / nearest_tol, 0.0, 1.0)
        lock_strength = np.power(lock_strength, lock_power)
        height_flat[start:end] = idw_height * (1.0 - lock_strength) + nearest_height * lock_strength

    height = height_flat.reshape((h, w)).astype(np.float32)
    height = np.clip(height, 0.0, float(max_height_m))

    terrace_count = int(options.get("terraceCount", 0) or 0)
    terrace_strength = float(options.get("terraceStrength", 0.0) or 0.0)
    if terrace_count > 1 and terrace_strength > 0:
        step = float(max_height_m) / float(terrace_count - 1)
        terraced = np.round(height / step) * step
        height = height * (1.0 - terrace_strength) + terraced * terrace_strength

    sigma = float(options.get("smoothingSigma", 1.5) or 0.0)
    if sigma > 0:
        smoothed = _gaussian_filter(height, sigma=sigma)
        preserve = float(options.get("detailPreserve", 0.25) or 0.0)
        height = smoothed * (1.0 - preserve) + height * preserve

    round_strength = float(options.get("roundPeaks", 0.45) or 0.0)
    if round_strength > 0:
        threshold = float(options.get("roundPeakThreshold", 0.72)) * float(max_height_m)
        cap_mask = np.clip((height - threshold) / max(1e-3, float(max_height_m) - threshold), 0.0, 1.0)
        cap_mask = _gaussian_filter(cap_mask, sigma=max(1.0, sigma * 2.0 + 1.0))
        broad = _gaussian_filter(height, sigma=float(options.get("roundPeakRadius", 7.0)))
        height = height * (1.0 - cap_mask * round_strength) + broad * (cap_mask * round_strength)
        height = np.minimum(height, float(max_height_m))

    cliff_strength = float(options.get("cliffStrength", 0.0) or 0.0)
    if cliff_strength > 0:
        low = _gaussian_filter(height, sigma=float(options.get("cliffRadius", 5.0)))
        detail = height - low
        height = low + detail * (1.0 + cliff_strength)
        height = _gaussian_filter(height, sigma=float(options.get("postCliffSmooth", 0.6)))

    height = np.nan_to_num(height, nan=0.0, posinf=float(max_height_m), neginf=0.0)
    return np.clip(height, 0.0, float(max_height_m)).astype(np.float32)


def flatten_beaches_from_island_mask(height: np.ndarray, island_mask: np.ndarray, max_beach_height: float = 12.0, width_px: int = 18) -> np.ndarray:
    """Flatten a coastal shelf inside island_mask. Useful after coastline/water import."""
    if not np.any(island_mask):
        return height
    # Coast pixels are inside the island but adjacent to the outside.
    island = island_mask.astype(bool)
    eroded = island & ~_soft_mask_from_dilation(~island, 1).astype(bool)
    coast = island & ~eroded
    beach_weight = _soft_mask_from_dilation(coast, width_px) * island.astype(np.float32)
    beach_target = np.minimum(height, max_beach_height)
    return height * (1.0 - beach_weight) + beach_target * beach_weight


def bake_water_layer(
    height: np.ndarray,
    water_mask: np.ndarray,
    max_height_m: float,
    options: Dict[str, Any] | None = None,
) -> Tuple[np.ndarray, Dict[str, Any]]:
    """Reversibly bake water cuts/flattening into a heightmap.

    The caller should preserve the original height map. This function returns a baked array plus metadata.
    """
    options = options or {}
    baked = height.astype(np.float32).copy()
    water_mask = water_mask.astype(bool)
    if water_mask.shape != baked.shape:
        raise ValueError("Water mask size must match heightmap size")

    sea_level = float(options.get("seaLevelM", 0.0))
    river_depth = float(options.get("riverDepthM", 3.0))
    lake_depth = float(options.get("lakeDepthM", 1.0))
    carve_depth = float(options.get("carveDepthM", river_depth))
    bank_width = int(options.get("bankSmoothPx", 10))
    mode = str(options.get("mode", "carve"))

    target = baked.copy()
    if mode == "paint-only":
        metadata = {"mode": mode, "changedPixels": 0, "seaLevelM": sea_level, "reversible": True}
        return baked, metadata

    if mode == "flatten":
        target[water_mask] = sea_level - lake_depth
    else:
        target[water_mask] = np.minimum(target[water_mask], sea_level - carve_depth)

    if bank_width > 0:
        blend_zone = _soft_mask_from_dilation(water_mask, bank_width)
        baked = baked * (1.0 - blend_zone) + target * blend_zone
    else:
        baked[water_mask] = target[water_mask]

    baked = np.clip(baked, 0.0, float(max_height_m)).astype(np.float32)
    metadata = {
        "mode": mode,
        "changedPixels": int(np.count_nonzero(water_mask)),
        "seaLevelM": sea_level,
        "riverDepthM": river_depth,
        "lakeDepthM": lake_depth,
        "bankSmoothPx": bank_width,
        "reversible": True,
        "note": "Water was baked using a reversible mask/falloff layer; keep the original heightmap to undo.",
    }
    return baked, metadata
