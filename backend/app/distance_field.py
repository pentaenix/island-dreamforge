"""Euclidean distance to land — scipy-free Felzenszwalb EDT (replaces chamfer)."""

from __future__ import annotations

import numpy as np


def _edt_1d_squared(f: np.ndarray) -> np.ndarray:
    """1D squared Euclidean distance transform (Felzenszwalb & Huttenlocher)."""
    n = int(f.size)
    out = np.empty(n, dtype=np.float64)
    v = np.zeros(n, dtype=np.int32)
    z = np.zeros(n + 1, dtype=np.float64)
    k = 0
    v[0] = 0
    z[0] = -np.inf
    z[1] = np.inf
    for q in range(1, n):
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2.0 * q - 2.0 * v[k])
        while s <= z[k]:
            k -= 1
            s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2.0 * q - 2.0 * v[k])
        k += 1
        v[k] = q
        z[k] = s
        z[k + 1] = np.inf
    k = 0
    for q in range(n):
        while z[k + 1] < q:
            k += 1
        out[q] = (q - v[k]) ** 2 + f[v[k]]
    return out


def euclidean_distance_pixels(land_mask: np.ndarray) -> np.ndarray:
    """
    Per-pixel Euclidean distance (in grid units) to the nearest land pixel.

    ``land_mask`` True = land (distance 0). Water pixels get distance >= 1.
    """
    land = np.asarray(land_mask, dtype=bool)
    rows, cols = land.shape
    if not np.any(land):
        return np.full((rows, cols), np.sqrt(rows * rows + cols * cols), dtype=np.float32)
    if np.all(land):
        return np.zeros((rows, cols), dtype=np.float32)

    big = float(rows * rows + cols * cols + 1)
    f = np.where(land, 0.0, big).astype(np.float64)

    g = np.empty_like(f)
    for r in range(rows):
        g[r, :] = _edt_1d_squared(f[r, :])

    h = np.empty_like(g)
    for c in range(cols):
        h[:, c] = _edt_1d_squared(g[:, c])

    return np.sqrt(np.maximum(h, 0.0)).astype(np.float32)


def euclidean_distance_to_land(
    land_mask: np.ndarray,
    pixel_size_m: float,
    max_distance_m: float,
) -> np.ndarray:
    """Meters from each cell to nearest land, capped at ``max_distance_m``."""
    px = float(max(1e-6, pixel_size_m))
    max_d = float(max(0.0, max_distance_m))
    dist_px = euclidean_distance_pixels(land_mask)
    dist_m = dist_px * px
    land = np.asarray(land_mask, dtype=bool)
    dist_m[land] = 0.0
    return np.minimum(dist_m, max_d).astype(np.float32)


def chamfer_distance_to_land(
    land_mask: np.ndarray,
    pixel_size_m: float,
    max_distance_m: float,
) -> np.ndarray:
    """Deprecated alias — use :func:`euclidean_distance_to_land` (kept for imports)."""
    return euclidean_distance_to_land(land_mask, pixel_size_m, max_distance_m)
