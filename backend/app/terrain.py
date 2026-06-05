from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

import numpy as np
from PIL import Image

from .image_utils import hex_to_rgb, pil_to_rgb_array, rgb_to_hex
from .water_world_scale import bank_smooth_px_from_options


@dataclass
class HeightSample:
    hex: str
    height: float
    tolerance: float = 35.0
    weight: float = 1.0
    label: str = ""
    """0–1 scale for band smoothing; None = use global sliders at full strength."""
    smoothness: float | None = None


def parse_samples(raw_samples: List[Dict[str, Any]]) -> List[HeightSample]:
    samples: List[HeightSample] = []
    for item in raw_samples:
        if "hex" not in item or "height" not in item:
            continue
        smooth = item.get("smoothness")
        samples.append(
            HeightSample(
                hex=str(item["hex"]),
                height=float(item["height"]),
                tolerance=float(item.get("tolerance", 35)),
                weight=float(item.get("weight", 1.0)),
                label=str(item.get("label", "")),
                smoothness=None if smooth is None else float(np.clip(smooth, 0.0, 1.0)),
            )
        )
    if not samples:
        raise ValueError("At least one color-height sample is required.")
    return samples


def _classify_color(rgb: List[int]) -> str:
    """Friendly terrain guess for exact map colors.

    This never invents colors; it only helps order suggested height levels.
    """
    r, g, b = [float(v) for v in rgb]
    maxc = max(r, g, b)
    minc = min(r, g, b)
    sat = maxc - minc
    # Blue/cyan/blue-gray map fills are water. This catches handmade pale water like #bed0d8.
    if b >= g - 8 and b - r >= 12 and sat >= 12:
        return "water"
    # Pale yellow / cream / tan fills are beach or low land.
    if r >= 175 and g >= 160 and b <= g + 22 and (r - b) >= 18:
        return "sand"
    if g >= r + 10 and g >= b + 8:
        return "green"
    if maxc < 70:
        return "ink"
    return "land"


def _terrain_sort_score(rgb: List[int]) -> float:
    r, g, b = [float(v) for v in rgb]
    role = _classify_color(rgb)
    lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
    green_strength = max(0.0, (g - max(r, b)) / 255.0)
    if role == "water":
        return -1000.0
    if role == "sand":
        return 10.0 + (1.0 - lum) * 8.0
    if role == "green":
        # Darker, more saturated greens are usually higher on stylized terrain maps.
        return 40.0 + (1.0 - lum) * 80.0 + green_strength * 30.0
    if role == "ink":
        # Keep ink/labels/lines at the end so it is obvious and not mistaken for water.
        return 10000.0 + (1.0 - lum)
    return 25.0 + (1.0 - lum) * 45.0


def quantize_dominant_colors(image: Image.Image, count: int = 12) -> List[Dict[str, Any]]:
    """Return exact dominant source colors, sorted as likely height levels.

    Earlier versions used palette quantization, which can invent colors that are not
    actually in a clean hand-made map. This version picks exact pixels from the image
    and then suggests a simple water-to-peak height ladder. Anti-aliased/compressed maps
    may still have many exact colors, so the user-facing count only limits how many
    existing colors are proposed.
    """
    count = max(2, min(256, int(count or 12)))
    im = image.convert("RGB")
    max_pixels = 2_400_000
    if im.width * im.height > max_pixels:
        scale = (max_pixels / float(im.width * im.height)) ** 0.5
        im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.Resampling.NEAREST)
    arr = np.asarray(im, dtype=np.uint8).reshape((-1, 3))
    unique, freq = np.unique(arr, axis=0, return_counts=True)
    total = float(freq.sum() or 1)
    # Do not let tiny label/anti-alias flecks dominate the suggestions. Keep top exact colors only.
    order_by_count = np.argsort(freq)[::-1]
    chosen = order_by_count[: min(count, len(order_by_count))]
    items: List[Dict[str, Any]] = []
    for idx in chosen:
        rgb = [int(v) for v in unique[idx].tolist()]
        role = _classify_color(rgb)
        items.append({
            "hex": rgb_to_hex(rgb),
            "rgb": rgb,
            "percent": round((float(freq[idx]) / total) * 100.0, 3),
            "role": role,
            "sortScore": round(_terrain_sort_score(rgb), 4),
        })

    items.sort(key=lambda c: (c["sortScore"], -c["percent"]))
    land = [c for c in items if c.get("role") != "water"]
    water = [c for c in items if c.get("role") == "water"]
    ordered = water[:1] + land + water[1:]
    # Suggested heights are intentionally simple; the user can type exact meters after.
    land_count = max(1, len([c for c in ordered if c.get("role") != "water"]))
    land_i = 0
    for c in ordered:
        if c.get("role") == "water" and land_i == 0:
            c["suggestedHeight"] = 0
        elif c.get("role") == "water":
            c["suggestedHeight"] = 0
        else:
            t = land_i / max(1, land_count - 1)
            # Ease-in gives more resolution to beaches/low slopes and still reaches the peak.
            h = 6.0 + (t ** 1.35) * 494.0
            if c.get("role") == "sand":
                h = min(h, 32.0 + land_i * 6.0)
            c["suggestedHeight"] = int(round(h))
            land_i += 1
    return [{k: v for k, v in c.items() if k != "sortScore"} for c in ordered]

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




def _gaussian_filter_color(rgb: np.ndarray, sigma: float) -> np.ndarray:
    """Blur an RGB array channel-by-channel while staying SciPy-free."""
    sigma = float(sigma or 0.0)
    arr = rgb.astype(np.float32, copy=False)
    if sigma <= 0:
        return arr.copy()
    out = np.empty_like(arr, dtype=np.float32)
    for channel in range(3):
        out[..., channel] = _gaussian_filter(arr[..., channel], sigma)
    return out


def _shift_edge(array: np.ndarray, dy: int, dx: int) -> np.ndarray:
    """Shift an array with edge padding instead of wrapping."""
    h, w = array.shape[:2]
    py0, py1 = max(0, dy), max(0, -dy)
    px0, px1 = max(0, dx), max(0, -dx)
    padded = np.pad(array, ((py0, py1), (px0, px1)) + ((0, 0),) * (array.ndim - 2), mode="edge")
    y0 = py1
    x0 = px1
    return padded[y0 : y0 + h, x0 : x0 + w]


def _grow_mask(mask: np.ndarray, pixels: int) -> np.ndarray:
    current = mask.astype(bool)
    for _ in range(int(max(0, pixels))):
        current = _dilate_mask(current)
    return current


def _detect_ink_line_mask(rgb: np.ndarray, options: Dict[str, Any]) -> np.ndarray:
    """Detect map artifacts that should not become terrain: roads, contour ink, labels, coast outlines.

    The mask intentionally targets thin/high-contrast ink colors rather than broad green/sand fills.
    Users can tune the thresholds from the cleanup panel.
    """
    arr = rgb.astype(np.float32, copy=False)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    maxc = np.maximum.reduce([r, g, b])
    minc = np.minimum.reduce([r, g, b])
    sat = maxc - minc

    dark_threshold = float(options.get("lineDarkThreshold", 58.0) or 58.0)
    sat_threshold = float(options.get("lineSaturationThreshold", 52.0) or 52.0)
    red_threshold = float(options.get("redLineThreshold", 34.0) or 34.0)
    blue_threshold = float(options.get("blueLineThreshold", 34.0) or 34.0)

    dark_ink = lum < dark_threshold
    red_ink = (r - np.maximum(g, b)) > red_threshold
    blue_ink = (b - np.maximum(r, g)) > blue_threshold

    # High local contrast catches fold shadows and anti-aliased contour/text edges without needing OCR.
    soft_lum = _gaussian_filter(lum, sigma=1.2)
    contrast = np.abs(lum - soft_lum)
    contrast_ink = (contrast > float(options.get("lineContrastThreshold", 18.0) or 18.0)) & (sat > sat_threshold)

    mask = dark_ink | red_ink | blue_ink | contrast_ink
    grow = int(options.get("lineMaskGrowPx", 1) or 0)
    if grow > 0:
        mask = _grow_mask(mask, grow)
    return mask


def _inpaint_rgb(rgb: np.ndarray, mask: np.ndarray, radius: float, strength: float) -> np.ndarray:
    """Replace masked line/artifact pixels with nearby unmasked average colors."""
    strength = float(np.clip(strength, 0.0, 1.0))
    if strength <= 0 or not np.any(mask):
        return rgb.astype(np.float32, copy=True)
    sigma = max(0.75, float(radius or 3.0))
    valid = (~mask).astype(np.float32)
    denom = np.maximum(_gaussian_filter(valid, sigma=sigma), 1e-5)
    out = rgb.astype(np.float32, copy=True)
    fill = np.empty_like(out, dtype=np.float32)
    for channel in range(3):
        fill[..., channel] = _gaussian_filter(out[..., channel] * valid, sigma=sigma) / denom
    out[mask] = out[mask] * (1.0 - strength) + fill[mask] * strength
    return np.clip(out, 0.0, 255.0)


def preprocess_map_for_height(
    image: Image.Image,
    samples: List[HeightSample],
    options: Dict[str, Any] | None = None,
) -> Image.Image:
    """Clean an illustrated map before color-to-height conversion.

    This is the image-editor style pass requested for noisy maps: it can average similar
    colors into cleaner regions, reduce palette noise, remove line art/roads/text, and
    smooth paper grain before any height interpolation happens.
    """
    options = options or {}
    rgb = pil_to_rgb_array(image)

    if not bool(options.get("preprocessEnabled", True)):
        return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), mode="RGB")

    # 1) Remove roads/contours/labels/ink before they become accidental cliffs or spikes.
    line_strength = float(options.get("ignoreLineStrength", 0.78) or 0.0)
    if line_strength > 0:
        line_mask = _detect_ink_line_mask(rgb, options)
        rgb = _inpaint_rgb(rgb, line_mask, float(options.get("lineInpaintRadius", 3.5) or 3.5), line_strength)

    # 2) Calm paper texture, compression grain and soft fold noise.
    paper_blur = float(options.get("paperNoiseBlur", 0.65) or 0.0)
    if paper_blur > 0:
        blurred = _gaussian_filter_color(rgb, sigma=paper_blur)
        strength = float(options.get("paperNoiseStrength", 0.55) or 0.55)
        rgb = rgb * (1.0 - strength) + blurred * strength

    # 3) Optional global palette compression: reduce hundreds of anti-aliased pixels into fewer fills.
    palette_count = int(options.get("paletteColorCount", 0) or 0)
    palette_strength = float(options.get("paletteReductionStrength", 0.0) or 0.0)
    if palette_count >= 2 and palette_strength > 0:
        tmp = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), mode="RGB")
        # PIL quantization gives a small, dependency-free color-reduction pass.
        q = tmp.quantize(colors=max(2, min(256, palette_count)), method=Image.Quantize.MEDIANCUT).convert("RGB")
        q_arr = np.asarray(q, dtype=np.float32)
        rgb = rgb * (1.0 - palette_strength) + q_arr * palette_strength

    # 4) For every picked height color, collapse nearby colors to that region's average.
    #    This is what makes "all similar water" or "all similar green" become one clean input band.
    average_strength = float(options.get("sampleAverageStrength", 0.72) or 0.0)
    if average_strength > 0 and samples:
        tolerance_scale = float(options.get("sampleAverageToleranceScale", 1.25) or 1.25)
        smooth_edges = float(options.get("sampleAverageEdgeSoftness", 8.0) or 8.0)
        for s in samples:
            center = np.array(hex_to_rgb(s.hex), dtype=np.float32)
            tol = max(1.0, float(s.tolerance) * tolerance_scale)
            dist = np.linalg.norm(rgb - center[None, None, :], axis=2)
            mask = dist <= tol
            if not np.any(mask):
                continue
            avg = rgb[mask].mean(axis=0)
            if smooth_edges > 0:
                weight = np.clip(1.0 - (dist / max(tol, 1.0)), 0.0, 1.0)
                weight = np.power(weight, 0.55)
                weight = _gaussian_filter(weight.astype(np.float32), sigma=max(0.1, smooth_edges * 0.1))
                weight *= average_strength
                rgb = rgb * (1.0 - weight[..., None]) + avg[None, None, :] * weight[..., None]
            else:
                rgb[mask] = rgb[mask] * (1.0 - average_strength) + avg * average_strength

    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), mode="RGB")


def _median_filter3x3(array: np.ndarray) -> np.ndarray:
    shifts = []
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            shifts.append(_shift_edge(array, dy, dx))
    return np.median(np.stack(shifts, axis=0), axis=0).astype(np.float32)


def _despike_height(height: np.ndarray, threshold_m: float, strength: float, passes: int) -> np.ndarray:
    out = height.astype(np.float32, copy=True)
    strength = float(np.clip(strength, 0.0, 1.0))
    if strength <= 0 or passes <= 0:
        return out
    threshold_m = float(max(0.0, threshold_m))
    for _ in range(int(passes)):
        median = _median_filter3x3(out)
        diff = out - median
        mask = np.abs(diff) > threshold_m
        if not np.any(mask):
            break
        out[mask] = out[mask] * (1.0 - strength) + median[mask] * strength
    return out


def _slope_limit_height(height: np.ndarray, max_delta_m: float, strength: float, iterations: int) -> np.ndarray:
    """Soft clamp impossible one-pixel height jumps while still allowing broad cliff walls."""
    out = height.astype(np.float32, copy=True)
    strength = float(np.clip(strength, 0.0, 1.0))
    if strength <= 0 or max_delta_m <= 0 or iterations <= 0:
        return out
    neighbours = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]
    for _ in range(int(iterations)):
        lower = np.full_like(out, -1e9, dtype=np.float32)
        upper = np.full_like(out, 1e9, dtype=np.float32)
        for dy, dx in neighbours:
            n = _shift_edge(out, dy, dx)
            lower = np.maximum(lower, n - max_delta_m)
            upper = np.minimum(upper, n + max_delta_m)
        clipped = np.minimum(np.maximum(out, lower), upper)
        out = out * (1.0 - strength) + clipped * strength
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



def _combine_flat_masks(masks: List[np.ndarray]) -> np.ndarray | None:
    if not masks:
        return None
    shape = masks[0].shape
    combined = np.zeros(shape, dtype=bool)
    for mask in masks:
        if mask.shape != shape:
            raise ValueError("All flat section masks must match the map size")
        combined |= mask.astype(bool)
    return combined if np.any(combined) else None


def _label_connected_components(mask: np.ndarray) -> np.ndarray:
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    current = 0
    for r in range(h):
        for c in range(w):
            if not mask[r, c] or labels[r, c]:
                continue
            current += 1
            stack = [(r, c)]
            labels[r, c] = current
            while stack:
                rr, cc = stack.pop()
                for dr, dc in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                    nr, nc = rr + dr, cc + dc
                    if 0 <= nr < h and 0 <= nc < w and mask[nr, nc] and labels[nr, nc] == 0:
                        labels[nr, nc] = current
                        stack.append((nr, nc))
    return labels


def _build_frozen_flat_heights(
    raw: np.ndarray,
    mask: np.ndarray,
    *,
    sea_level_m: float,
    height_mode: str = "median",
) -> Tuple[np.ndarray, Dict[str, Any]]:
    """Plateau heights from the color-map field only (before band smoothing)."""
    frozen = raw.astype(np.float32).copy()
    mask = mask.astype(bool)
    effective = mask & (raw > sea_level_m + 0.12)
    skipped_water = int(np.count_nonzero(mask & ~effective))
    if not np.any(effective):
        return frozen, {
            "changedPixels": 0,
            "skippedWaterPixels": skipped_water,
            "regions": 0,
            "note": "Flat mask had no land pixels above sea level.",
        }

    labels = _label_connected_components(effective)
    mode = str(height_mode or "median").lower()
    regions: List[Dict[str, Any]] = []
    for label_id in range(1, int(labels.max()) + 1):
        region = labels == label_id
        vals = raw[region]
        level = float(np.mean(vals)) if mode == "mean" else float(np.median(vals))
        frozen[region] = level
        regions.append({"region": label_id, "targetHeightM": round(level, 4), "pixels": int(np.count_nonzero(region))})

    return frozen, {
        "changedPixels": int(np.count_nonzero(effective)),
        "skippedWaterPixels": skipped_water,
        "regions": len(regions),
        "heightMode": mode,
        "regionTargets": regions[:32],
    }


def _prepare_flat_protection(
    raw: np.ndarray,
    flat_masks: List[np.ndarray] | None,
    flat_layer_options: List[Dict[str, Any]] | None,
    options: Dict[str, Any],
) -> Dict[str, Any] | None:
    combined = _combine_flat_masks(flat_masks or [])
    if combined is None:
        return None
    sea_level = float(options.get("seaLevelM", 0.0) or 0.0)
    opts_list = flat_layer_options or []
    height_mode = "median"
    edge_soft_px = 0
    strength_map = np.zeros(raw.shape, dtype=np.float32)
    for i, mask in enumerate(flat_masks or []):
        per = opts_list[i] if i < len(opts_list) else {}
        if i == 0:
            height_mode = str(per.get("heightMode", "median") or "median")
        edge_soft_px = max(edge_soft_px, int(per.get("edgeSoftPx", 0) or 0))
        strength = float(per.get("flattenStrength", per.get("flatStrength", 0.72)) or 0.72)
        strength = float(np.clip(strength, 0.0, 1.0))
        m = mask.astype(bool)
        strength_map[m] = np.maximum(strength_map[m], strength)
    frozen, meta = _build_frozen_flat_heights(
        raw, combined, sea_level_m=sea_level, height_mode=height_mode,
    )
    meta["flattenStrengthMax"] = round(float(strength_map.max()), 4) if np.any(combined) else 0.0
    return {
        "mask": combined,
        "effective": combined & (raw > sea_level + 0.12),
        "frozen": frozen,
        "edgeSoftPx": edge_soft_px,
        "strengthMap": strength_map,
        "meta": meta,
    }


def _blend_flat_protection(
    height: np.ndarray,
    frozen: np.ndarray,
    full_mask: np.ndarray,
    strength_map: np.ndarray | None,
    default_strength: float = 1.0,
) -> np.ndarray:
    """Pull terrain toward plateau/raw frozen heights without forcing a hard plane."""
    out = height.astype(np.float32).copy()
    if not np.any(full_mask):
        return out
    if strength_map is not None:
        s = np.clip(strength_map[full_mask], 0.0, 1.0)
        out[full_mask] = out[full_mask] * (1.0 - s) + frozen[full_mask] * s
    else:
        s = float(np.clip(default_strength, 0.0, 1.0))
        out[full_mask] = out[full_mask] * (1.0 - s) + frozen[full_mask] * s
    return out


def _sample_smoothness_scale(sample: HeightSample) -> float:
    raw = sample.smoothness
    if raw is None:
        return 1.0
    return float(np.clip(raw, 0.0, 1.0))


def _designed_band_blend_height(
    raw: np.ndarray,
    label_map: np.ndarray,
    samples: List[HeightSample],
    options: Dict[str, Any],
    flat_protection: Dict[str, Any] | None,
) -> np.ndarray:
    """Blend color-band heights toward smoothed ramps; per-sample smoothness scales the effect."""
    global_blend = float(options.get("bandBlendStrength", 0.82) or 0.0)
    global_sigma = float(options.get("bandTransitionPx", 10.0) or 0.0)
    passes = int(options.get("bandBlendPasses", 1) or 1)
    if global_blend <= 0 or global_sigma <= 0:
        return _restore_flat_protection(raw.astype(np.float32).copy(), flat_protection)

    height = raw.astype(np.float32).copy()
    for pass_i in range(max(1, passes)):
        sigma = max(1.0, global_sigma * (0.55 ** pass_i) if pass_i else global_sigma)
        blend_scale = global_blend * (0.35 if pass_i else 1.0)
        broad = _gaussian_filter(height, sigma=sigma)
        for idx, sample in enumerate(samples):
            mask = label_map == idx
            if not np.any(mask):
                continue
            blend = blend_scale * _sample_smoothness_scale(sample)
            if blend <= 0:
                continue
            height[mask] = height[mask] * (1.0 - blend) + broad[mask] * blend
        height = _restore_flat_protection(height, flat_protection)
    return height


def _restore_flat_protection(height: np.ndarray, protection: Dict[str, Any] | None) -> np.ndarray:
    if not protection:
        return height
    frozen = protection["frozen"]
    full_mask = protection.get("mask", protection["effective"]).astype(bool)
    edge_soft_px = int(protection.get("edgeSoftPx", 0) or 0)
    strength_map = protection.get("strengthMap")
    height = height.astype(np.float32)
    out = _blend_flat_protection(height, frozen, full_mask, strength_map)
    if edge_soft_px <= 0:
        return out
    # Feather outward from the mask border; taper blend by local flatten strength.
    outer_influence = np.clip(_soft_mask_from_dilation(full_mask, edge_soft_px), 0.0, 1.0).astype(np.float32)
    transition = (~full_mask) & (outer_influence > 0.01)
    if np.any(transition):
        t = outer_influence[transition]
        if strength_map is not None:
            edge_strength = np.clip(strength_map[transition], 0.0, 1.0)
            t = t * edge_strength
        out[transition] = height[transition] * (1.0 - t) + frozen[transition] * t
    return out


def _initial_designed_band_height(
    image: Image.Image,
    samples: List[HeightSample],
    max_height_m: float,
    options: Dict[str, Any],
    flat_masks: List[np.ndarray] | None = None,
    flat_layer_options: List[Dict[str, Any]] | None = None,
) -> Tuple[np.ndarray, Dict[str, Any]]:
    """Create a terrain base from clean handmade color bands.

    The user-facing idea is simple: click a color, type only its height. Internally,
    every map pixel chooses the closest height color, then the stepped color regions
    are relaxed into smooth slopes. Wide color bands become gentle ramps; tight bands
    become steep but still controlled mountain walls.
    """
    clean_image = preprocess_map_for_height(image, samples, options) if bool(options.get("preprocessEnabled", False)) else image.convert("RGB")
    rgb_u8 = np.asarray(clean_image.convert("RGB"), dtype=np.uint8)
    rgb = rgb_u8.astype(np.float32)
    h, w, _ = rgb.shape
    sample_rgb_u8 = np.array([hex_to_rgb(s.hex) for s in samples], dtype=np.uint8)
    sample_rgb = sample_rgb_u8.astype(np.float32)
    sample_heights = np.array([s.height for s in samples], dtype=np.float32)
    tolerances = np.array([max(0.0, s.tolerance) for s in samples], dtype=np.float32)
    weights = np.array([max(0.001, s.weight) for s in samples], dtype=np.float32)
    sea_level = float(options.get("seaLevelM", 0.0) or 0.0)

    flat = rgb.reshape((-1, 3))
    flat_u8 = rgb_u8.reshape((-1, 3))
    total = flat.shape[0]
    height_flat = np.empty(total, dtype=np.float32)
    matched_flat = np.zeros(total, dtype=bool)
    nearest_flat = np.zeros(total, dtype=np.int32)
    exact_mode = bool(options.get("exactColorMode", True))
    unknown_mode = str(options.get("unknownColorMode", "nearest")).lower()
    exponent = float(options.get("colorPower", 2.0) or 2.0)
    chunk_size = int(options.get("chunkPixels", 250_000) or 250_000)

    for start in range(0, total, chunk_size):
        end = min(total, start + chunk_size)
        chunk = flat[start:end]
        d = np.linalg.norm(chunk[:, None, :] - sample_rgb[None, :, :], axis=2)
        nearest_idx = np.argmin(d, axis=1)
        nearest_flat[start:end] = nearest_idx.astype(np.int32)
        nearest_d = d[np.arange(d.shape[0]), nearest_idx]
        if exact_mode:
            eq = np.all(flat_u8[start:end, None, :] == sample_rgb_u8[None, :, :], axis=2)
            has_match = np.any(eq, axis=1)
            exact_idx = np.argmax(eq, axis=1)
            matched_flat[start:end] = has_match
            # Unknown anti-aliased colors should not become holes. Nearest keeps handmade maps predictable;
            # IDW is available when users want softer interpretation of blended pixels.
            if unknown_mode == "idw":
                inv = weights[None, :] / np.power(np.maximum(d, 1e-3), exponent)
                unknown_height = (inv @ sample_heights) / np.maximum(inv.sum(axis=1), 1e-6)
            else:
                unknown_height = sample_heights[nearest_idx]
            height_flat[start:end] = np.where(has_match, sample_heights[exact_idx], unknown_height)
        else:
            nearest_tol = np.maximum(tolerances[nearest_idx], 1.0)
            lock = np.clip(1.0 - nearest_d / nearest_tol, 0.0, 1.0)
            matched_flat[start:end] = lock > 0.001
            inv = weights[None, :] / np.power(np.maximum(d, 1e-3), exponent)
            idw = (inv @ sample_heights) / np.maximum(inv.sum(axis=1), 1e-6)
            nearest_height = sample_heights[nearest_idx]
            power = float(options.get("sampleLockPower", 1.0) or 1.0)
            lock = np.power(lock, power)
            height_flat[start:end] = idw * (1.0 - lock) + nearest_height * lock

    raw = height_flat.reshape((h, w)).astype(np.float32)
    raw = np.clip(raw, 0.0, float(max_height_m))
    label_map = nearest_flat.reshape((h, w))
    matched = matched_flat.reshape((h, w))

    # Pixel-perfect colors often include tiny accidental dots. This guard turns tiny color islands into
    # nearby terrain before smoothing so they do not become spike needles.
    flat_protection = _prepare_flat_protection(raw, flat_masks, flat_layer_options, options)

    if bool(options.get("cleanTinyRegions", True)) and flat_protection is None:
        passes = int(options.get("tinyRegionPasses", 2) or 2)
        raw = _despike_height(raw, threshold_m=float(options.get("tinyRegionHeightDeltaM", 18.0) or 18.0), strength=0.85, passes=passes)
        flat_protection = _prepare_flat_protection(raw, flat_masks, flat_layer_options, options)

    band_blend = float(options.get("bandBlendStrength", 0.82) or 0.0)
    band_sigma = float(options.get("bandTransitionPx", 10.0) or 0.0)
    if band_blend > 0 and band_sigma > 0:
        height = _designed_band_blend_height(raw, label_map, samples, options, flat_protection)
    else:
        height = _restore_flat_protection(raw.copy(), flat_protection)

    # Keep water as a flat control plane; do not force sea level through protected flat mesas.
    if bool(options.get("protectWaterLevel", True)):
        water_sample_mask = np.zeros((h, w), dtype=bool)
        for idx, sample in enumerate(samples):
            if sample.height <= sea_level + float(options.get("waterHeightToleranceM", 0.5) or 0.5):
                water_sample_mask |= label_map == idx
        if flat_protection is not None:
            # Do not flatten masked mesas to sea level; water-colored pixels inside the mask keep raw heights.
            water_sample_mask &= ~flat_protection["mask"]
        height[water_sample_mask] = sea_level

    metadata = {
        "matchedPixels": int(np.count_nonzero(matched)),
        "totalPixels": int(total),
        "exactColorMode": exact_mode,
        "bandBlendStrength": band_blend,
        "bandTransitionPx": band_sigma,
        "flatProtection": flat_protection["meta"] if flat_protection else None,
        "flatProtectionBundle": flat_protection,
    }
    return np.clip(height, 0.0, float(max_height_m)).astype(np.float32), metadata

def generate_heightmap_from_colors(
    image: Image.Image,
    samples: List[HeightSample],
    max_height_m: float,
    options: Dict[str, Any] | None = None,
    flat_masks: List[np.ndarray] | None = None,
    flat_layer_options: List[Dict[str, Any]] | None = None,
) -> np.ndarray:
    """Generate a meter heightmap by interpolating picked map colors.

    Flat-section masks (optional) are applied between the raw color-map heights and smoothing:
    each masked region becomes a level plateau at the height its colors already imply, then
    band blending and other filters run only outside those interiors (with optional edge feather).
    """
    options = options or {}
    flat_bundle: Dict[str, Any] | None = None
    if bool(options.get("designedBandMode", True)):
        height, band_meta = _initial_designed_band_height(
            image, samples, max_height_m, options, flat_masks, flat_layer_options,
        )
        flat_bundle = band_meta.get("flatProtectionBundle")
    else:
        clean_image = preprocess_map_for_height(image, samples, options)
        rgb = pil_to_rgb_array(clean_image)
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
        flat_bundle = _prepare_flat_protection(height, flat_masks, flat_layer_options, options)
        height = _restore_flat_protection(height, flat_bundle)

    def _guard(h: np.ndarray) -> np.ndarray:
        return _restore_flat_protection(h, flat_bundle)

    terrace_count = int(options.get("terraceCount", 0) or 0)
    terrace_strength = float(options.get("terraceStrength", 0.0) or 0.0)
    if terrace_count > 1 and terrace_strength > 0:
        step = float(max_height_m) / float(terrace_count - 1)
        terraced = np.round(height / step) * step
        height = _guard(height * (1.0 - terrace_strength) + terraced * terrace_strength)

    sigma = float(options.get("smoothingSigma", 1.5) or 0.0)
    if sigma > 0:
        smoothed = _gaussian_filter(height, sigma=sigma)
        preserve = float(options.get("detailPreserve", 0.25) or 0.0)
        height = _guard(smoothed * (1.0 - preserve) + height * preserve)

    round_strength = float(options.get("roundPeaks", 0.45) or 0.0)
    if round_strength > 0:
        threshold = float(options.get("roundPeakThreshold", 0.72)) * float(max_height_m)
        cap_mask = np.clip((height - threshold) / max(1e-3, float(max_height_m) - threshold), 0.0, 1.0)
        cap_mask = _gaussian_filter(cap_mask, sigma=max(1.0, sigma * 2.0 + 1.0))
        broad = _gaussian_filter(height, sigma=float(options.get("roundPeakRadius", 7.0)))
        height = _guard(height * (1.0 - cap_mask * round_strength) + broad * (cap_mask * round_strength))
        height = np.minimum(height, float(max_height_m))

    cliff_strength = float(options.get("cliffStrength", 0.0) or 0.0)
    if cliff_strength > 0:
        low = _gaussian_filter(height, sigma=float(options.get("cliffRadius", 5.0)))
        detail = height - low
        height = _guard(low + detail * (1.0 + cliff_strength))
        height = _guard(_gaussian_filter(height, sigma=float(options.get("postCliffSmooth", 0.6))))

    curve_strength = float(options.get("curveSmoothStrength", 0.28) or 0.0)
    if curve_strength > 0:
        curve_radius = float(options.get("curveSmoothRadius", max(2.0, sigma * 2.5 + 1.0)) or 4.0)
        broad_curve = _gaussian_filter(height, sigma=curve_radius)
        height = _guard(height * (1.0 - curve_strength) + broad_curve * curve_strength)

    spike_strength = float(options.get("spikeRemovalStrength", 0.70) or 0.0)
    if spike_strength > 0 and flat_bundle is None:
        height = _despike_height(
            height,
            threshold_m=float(options.get("spikeThresholdM", 32.0) or 32.0),
            strength=spike_strength,
            passes=int(options.get("spikeRemovalPasses", 3) or 3),
        )
        height = _guard(height)

    slope_strength = float(options.get("slopeLimitStrength", 0.45) or 0.0)
    if slope_strength > 0:
        height = _guard(
            _slope_limit_height(
                height,
                max_delta_m=float(options.get("slopeLimitMPerPx", 75.0) or 75.0),
                strength=slope_strength,
                iterations=int(options.get("slopeLimitIterations", 2) or 2),
            )
        )

    height = np.nan_to_num(height, nan=0.0, posinf=float(max_height_m), neginf=0.0)
    return _guard(np.clip(height, 0.0, float(max_height_m)).astype(np.float32))


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


def apply_flat_section_mask(
    raw: np.ndarray,
    mask: np.ndarray,
    *,
    max_height_m: float,
    edge_soft_px: int = 0,
    height_mode: str = "median",
    sea_level_m: float = 0.0,
) -> Tuple[np.ndarray, Dict[str, Any]]:
    """Build plateau heights from raw color-map field (legacy helper / tests)."""
    frozen, meta = _build_frozen_flat_heights(
        raw, mask, sea_level_m=sea_level_m, height_mode=height_mode,
    )
    protection = {
        "mask": mask.astype(bool),
        "frozen": frozen,
        "effective": mask.astype(bool) & (raw > sea_level_m + 0.12),
        "edgeSoftPx": edge_soft_px,
        "strengthMap": np.full(raw.shape, 1.0, dtype=np.float32),
        "meta": meta,
    }
    baked = _restore_flat_protection(raw, protection)
    baked = np.clip(baked, 0.0, float(max_height_m)).astype(np.float32)
    meta["modifiedTerrain"] = bool(meta.get("changedPixels", 0) > 0)
    return baked, meta


def apply_flat_section_layers(
    raw: np.ndarray,
    layer_masks: List[np.ndarray],
    *,
    max_height_m: float,
    layer_options: List[Dict[str, Any]] | None = None,
    sea_level_m: float = 0.0,
) -> Tuple[np.ndarray, List[Dict[str, Any]]]:
    """Legacy: build flat plateaus from raw heights before smoothing."""
    opts = {"seaLevelM": sea_level_m}
    protection = _prepare_flat_protection(raw, layer_masks, layer_options, opts)
    baked = _restore_flat_protection(raw, protection)
    baked = np.clip(baked, 0.0, float(max_height_m)).astype(np.float32)
    meta_list = [protection["meta"]] if protection else []
    return baked, meta_list


def bake_water_layer(
    height: np.ndarray,
    water_mask: np.ndarray,
    max_height_m: float,
    options: Dict[str, Any] | None = None,
) -> Tuple[np.ndarray, Dict[str, Any]]:
    """Apply an optional, reversible water-bed effect without destroying terrain.

    Water is a layer, not a height command. The default mode is visual-only and returns
    the original terrain. Indent/river/lake modes only make shallow local changes. They
    never push painted water pixels down to the bottom of the map.
    """
    options = options or {}
    original = height.astype(np.float32)
    baked = original.copy()
    water_mask = water_mask.astype(bool)
    if water_mask.shape != baked.shape:
        raise ValueError("Water mask size must match heightmap size")

    sea_level = float(options.get("seaLevelM", 0.0) or 0.0)
    river_depth = max(0.0, float(options.get("riverDepthM", options.get("carveDepthM", 1.5)) or 1.5))
    lake_depth = max(0.0, float(options.get("lakeDepthM", 0.75) or 0.75))
    carve_depth = max(0.0, float(options.get("carveDepthM", river_depth) or river_depth))
    bank_width = bank_smooth_px_from_options(options, baked.shape)
    mode = str(options.get("mode", "visual-only") or "visual-only").lower()
    changed_pixels = int(np.count_nonzero(water_mask))

    if not np.any(water_mask) or mode in {"visual-only", "paint-only", "none"}:
        metadata = {
            "mode": mode,
            "changedPixels": 0 if not np.any(water_mask) else changed_pixels,
            "modifiedTerrain": False,
            "seaLevelM": sea_level,
            "reversible": True,
            "note": "Water kept as a separate visual layer; no terrain was lowered.",
        }
        return baked, metadata

    influence = _soft_mask_from_dilation(water_mask, bank_width)
    # Keep the strongest effect inside the water pixels and fade banks outside.
    influence = np.clip(influence, 0.0, 1.0).astype(np.float32)

    if mode in {"shallow-indent", "indent", "riverbed", "carve"}:
        # Shallow relative lowering. This cannot create holes because it lowers from
        # the existing terrain surface and clamps to sea level for near-water areas.
        depth = river_depth if mode in {"riverbed", "carve"} else carve_depth
        depth = min(depth, 18.0)
        target = np.maximum(0.0, original - depth)
        baked = original * (1.0 - influence) + target * influence
    elif mode in {"lake-flatten", "flatten"}:
        vals = original[water_mask]
        local_level = float(np.median(vals)) if vals.size else sea_level
        target_level = max(0.0, local_level - lake_depth)
        target = original.copy()
        # Only lower terrain that pokes above the desired water bed. Never raise or
        # crater land to zero.
        target[water_mask] = np.minimum(original[water_mask], target_level)
        baked = original * (1.0 - influence) + target * influence
    elif mode in {"ocean-shore", "shoreline"}:
        # A soft shore shelf for coastlines. It makes beach-adjacent water slightly
        # shallow, but never excavates mountains or inland rivers to zero.
        shelf_depth = min(max(carve_depth, 0.25), 6.0)
        target = original.copy()
        near_sea = original <= sea_level + max(8.0, shelf_depth * 3.0)
        affected = water_mask & near_sea
        target[affected] = np.maximum(0.0, np.minimum(original[affected], sea_level + 0.35) - shelf_depth * 0.35)
        local_influence = influence * _soft_mask_from_dilation(affected, bank_width)
        baked = original * (1.0 - local_influence) + target * local_influence
    else:
        metadata = {
            "mode": mode,
            "changedPixels": changed_pixels,
            "modifiedTerrain": False,
            "seaLevelM": sea_level,
            "reversible": True,
            "warning": f"Unknown water mode '{mode}', terrain left unchanged.",
        }
        return baked, metadata

    baked = np.clip(baked, 0.0, float(max_height_m)).astype(np.float32)
    lowered = np.maximum(0.0, original - baked)
    metadata = {
        "mode": mode,
        "changedPixels": changed_pixels,
        "modifiedTerrain": bool(float(lowered.max(initial=0.0)) > 1e-5),
        "seaLevelM": sea_level,
        "riverDepthM": river_depth,
        "lakeDepthM": lake_depth,
        "indentDepthM": carve_depth,
        "maxActualLoweringM": round(float(lowered.max(initial=0.0)), 4),
        "meanActualLoweringM": round(float(lowered[water_mask].mean()) if np.any(water_mask) else 0.0, 4),
        "bankSmoothPx": bank_width,
        "reversible": True,
        "note": "Water was applied as a shallow non-destructive layer effect. Keep the original heightmap to undo.",
    }
    return baked, metadata
