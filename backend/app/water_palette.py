"""Shared ocean depth palette for bathymetry and exports."""

from __future__ import annotations

from typing import Sequence, Tuple

import numpy as np

# Shallow (shore) → deep (open ocean)
ISLAND_WATER_HEX = (
    "#D8EFE8",
    "#7ED0D5",
    "#2DA8C1",
    "#117FA2",
    "#0A6283",
    "#064864",
)


def _hex_to_rgb(hex_color: str) -> Tuple[int, int, int]:
    v = str(hex_color).lstrip("#")
    return int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)


ISLAND_WATER_RAMP: Tuple[Tuple[float, Tuple[int, int, int]], ...] = tuple(
    (i / max(1, len(ISLAND_WATER_HEX) - 1), _hex_to_rgb(h)) for i, h in enumerate(ISLAND_WATER_HEX)
)

TROPICAL_RAMP = ISLAND_WATER_RAMP


def _smoothstep01(t: np.ndarray) -> np.ndarray:
    x = np.clip(t.astype(np.float32), 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def interpolate_water_ramp(values01: np.ndarray, smoothness: float = 0.0) -> np.ndarray:
    """Map 0..1 depth index to RGB. smoothness 0 = posterized steps, 1 = smooth blends."""
    v = np.clip(np.asarray(values01, dtype=np.float32), 0.0, 1.0)
    s = float(np.clip(smoothness, 0.0, 1.0))
    ramp = ISLAND_WATER_RAMP
    n = len(ramp)
    stops = np.array([rgb for _, rgb in ramp], dtype=np.float32)
    positions = np.array([pos for pos, _ in ramp], dtype=np.float32)
    shape = v.shape
    flat = v.reshape(-1)

    if s <= 0.02:
        idx = np.clip(np.rint(flat * (n - 1)), 0, n - 1).astype(np.int32)
        rgb = stops[idx].astype(np.uint8)
        return rgb.reshape(*shape, 3)

    flat_out = np.zeros((flat.size, 3), dtype=np.float32)
    for i in range(n - 1):
        t0, t1 = float(positions[i]), float(positions[i + 1])
        c0, c1 = stops[i], stops[i + 1]
        if i < n - 2:
            mask = (flat >= t0) & (flat < t1)
        else:
            mask = (flat >= t0) & (flat <= t1)
        if not np.any(mask):
            continue
        local = (flat[mask] - t0) / max(1e-6, t1 - t0)
        soft = _smoothstep01(local)
        hard = (local >= 0.5).astype(np.float32)
        blend = hard * (1.0 - s) + soft * s
        flat_out[mask] = c0 * (1.0 - blend[:, None]) + c1 * blend[:, None]

    return flat_out.astype(np.uint8).reshape(*shape, 3)


def color_ramp(values: np.ndarray, ramp: Sequence = ISLAND_WATER_RAMP, smoothness: float = 0.0) -> np.ndarray:
    del ramp  # palette is fixed
    return interpolate_water_ramp(values, smoothness=smoothness)
