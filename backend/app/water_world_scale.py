"""Scale water-related distances from resort reference to current island width."""

from __future__ import annotations

from typing import Any, Dict

REFERENCE_ISLAND_WIDTH_M = 1480.0


def island_horizon_scale(opts: Dict[str, Any] | None) -> float:
    opts = opts or {}
    explicit = opts.get("islandHeightScale", opts.get("islandHorizonScale"))
    if explicit is not None:
        return max(0.05, float(explicit))
    width_m = float(opts.get("widthM", opts.get("worldWidthM", REFERENCE_ISLAND_WIDTH_M)) or REFERENCE_ISLAND_WIDTH_M)
    return max(0.05, width_m / REFERENCE_ISLAND_WIDTH_M)


def scale_water_design_meters(value: float, opts: Dict[str, Any] | None) -> float:
    return float(value) * island_horizon_scale(opts)


def bank_smooth_px_from_options(opts: Dict[str, Any], height_shape: tuple[int, ...]) -> int:
    """Convert bank width in meters to heightmap pixels, or read px directly."""
    if opts.get("bankSmoothM") is None and opts.get("bankSmoothPx") is not None:
        return int(max(0, opts.get("bankSmoothPx", 14) or 14))
    bank_m = float(opts.get("bankSmoothM", 20.0) or 20.0)
    width_m = float(opts.get("widthM", opts.get("worldWidthM", REFERENCE_ISLAND_WIDTH_M)) or REFERENCE_ISLAND_WIDTH_M)
    cols = int(height_shape[1]) if len(height_shape) >= 2 else 1024
    mpp = width_m / max(1, cols - 1)
    return int(max(0, round(bank_m / max(1e-6, mpp))))
