"""Cumulative depth-band widths from shore (narrow shallow → wider deep)."""

from __future__ import annotations

from typing import Any, Dict, List

import numpy as np

NUM_WATER_BANDS = 6


def _smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / max(1e-6, edge1 - edge0), 0.0, 1.0)
    return (t * t * (3.0 - 2.0 * t)).astype(np.float32)


def band_widths_m(
    base_m: float,
    increase_m: float,
    count: int = NUM_WATER_BANDS,
    growth_power: float = 2.0,
) -> List[float]:
    """Band i width = base + increase * i^growth (power 2 = clearly wider deep bands)."""
    base = max(1.0, float(base_m))
    inc = max(0.0, float(increase_m))
    power = max(1.0, float(growth_power))
    return [base + inc * (i**power) for i in range(count)]


def band_edges_from_steps(
    base_m: float,
    increase_m: float,
    count: int = NUM_WATER_BANDS,
    growth_power: float = 2.0,
) -> List[float]:
    edges = [0.0]
    for w in band_widths_m(base_m, increase_m, count, growth_power):
        edges.append(edges[-1] + w)
    return edges


def band_edges_from_options(opts: Dict[str, Any]) -> List[float]:
    custom = opts.get("waterBandEdgesM")
    if isinstance(custom, (list, tuple)) and len(custom) >= 2:
        edges = [max(0.0, float(v)) for v in custom]
        edges.sort()
        for i in range(1, len(edges)):
            if edges[i] <= edges[i - 1]:
                edges[i] = edges[i - 1] + 1.0
        return edges

    base = _read_float(opts, "waterBandStepM", 12.0, minimum=1.0)
    inc = _read_float(opts, "waterBandStepIncreaseM", 8.0, minimum=0.0)
    power = _read_float(opts, "waterBandStepGrowthPower", 2.0, minimum=1.0)
    return band_edges_from_steps(base, inc, growth_power=power)


def _read_float(opts: Dict[str, Any], key: str, default: float, minimum: float | None = None) -> float:
    """Read a numeric export option; 0 is valid (do not treat as missing)."""
    ocean = opts.get("ocean") if isinstance(opts.get("ocean"), dict) else {}
    if key in opts and opts[key] is not None:
        value = float(opts[key])
    elif key in ocean and ocean[key] is not None:
        value = float(ocean[key])
    else:
        value = float(default)
    if minimum is not None:
        value = max(minimum, value)
    return value


def max_shore_distance_scale_m(opts: Dict[str, Any]) -> float:
    """Upper bound for encoding shore-distance maps (meters)."""
    edges = band_edges_from_options(opts or {})
    ocean_r = float(opts.get("oceanRadiusM", 0.0) or 0.0) if opts else 0.0
    band_reach = float(edges[-1]) if edges else 0.0
    return max(1.0, ocean_r, band_reach)


def distance_to_bathy01_bands(
    shore_distance_m: np.ndarray,
    water_mask: np.ndarray,
    band_edges_m: List[float],
) -> np.ndarray:
    """Map shore distance to 0..1; each palette band gets equal color range but its own meter width."""
    dist = np.asarray(shore_distance_m, dtype=np.float32)
    water = np.asarray(water_mask, dtype=bool)
    edges = band_edges_m
    n = max(1, len(edges) - 1)
    bathy = np.zeros(dist.shape, dtype=np.float32)
    for i in range(n):
        lo = float(edges[i])
        hi = float(edges[i + 1]) if i + 1 < len(edges) else float(edges[-1]) + 1e6
        mask = water & (dist >= lo) & (dist < hi)
        if not np.any(mask):
            continue
        local = (dist[mask] - lo) / max(1e-6, hi - lo)
        bathy[mask] = (i + local) / max(1, n - 1)
    bathy[water & (dist >= edges[-1])] = 1.0
    return np.clip(bathy, 0.0, 1.0).astype(np.float32)


def ocean_disc_rim_fade(
    radial_m: np.ndarray,
    ocean_radius_m: float,
    rim_fade_m: float,
) -> np.ndarray:
    """0 at ocean disc edge, 1 well inside — keeps foam/waves from stretching on the rim."""
    rim = max(8.0, float(rim_fade_m))
    ocean_r = float(ocean_radius_m)
    inner = max(0.0, ocean_r - rim)
    return (1.0 - _smoothstep(inner, ocean_r - max(4.0, rim * 0.08), radial_m)).astype(np.float32)
