import numpy as np

from app.terrain import (
    _blend_flat_protection,
    _build_frozen_flat_heights,
    _prepare_flat_protection,
    _restore_flat_protection,
    apply_flat_section_mask,
)


def test_frozen_heights_use_raw_color_map_not_smoothed_bottom():
    raw = np.array([[4.0, 6.0], [80.0, 90.0]], dtype=np.float32)
    smoothed = np.array([[0.0, 2.0], [5.0, 6.0]], dtype=np.float32)
    mask = np.array([[True, True], [False, False]], dtype=bool)
    frozen, meta = _build_frozen_flat_heights(raw, mask, sea_level_m=0.0, height_mode="median")
    assert meta["regions"] == 1
    assert frozen[0, 0] == 5.0
    assert frozen[0, 1] == 5.0
    protection = {
        "frozen": frozen,
        "effective": mask,
        "edgeSoftPx": 0,
        "meta": meta,
    }
    out = _restore_flat_protection(smoothed, protection)
    assert out[0, 0] == 5.0
    assert out[0, 1] == 5.0
    assert out[1, 1] == 6.0


def test_flat_mask_skips_sea_level_pixels():
    raw = np.array([[0.0, 50.0], [60.0, 70.0]], dtype=np.float32)
    mask = np.array([[True, True], [True, True]], dtype=bool)
    frozen, meta = _build_frozen_flat_heights(raw, mask, sea_level_m=0.0)
    assert meta["skippedWaterPixels"] >= 1
    assert frozen[0, 0] == 0.0
    assert frozen[0, 1] == 60.0
    assert frozen[1, 1] == 60.0


def test_apply_flat_section_mask_from_raw():
    raw = np.array([[4.0, 6.0], [20.0, 30.0]], dtype=np.float32)
    mask = np.array([[True, True], [False, False]], dtype=bool)
    out, meta = apply_flat_section_mask(raw, mask, max_height_m=500.0)
    assert out[0, 0] == 5.0
    assert out[0, 1] == 5.0
    assert out[1, 1] == 30.0


def test_flat_mask_interior_not_forced_to_sea_level():
    raw = np.array(
        [[0.0, 40.0, 40.0], [40.0, 40.0, 40.0], [0.0, 40.0, 40.0]],
        dtype=np.float32,
    )
    mask = np.array(
        [[True, True, True], [True, True, True], [True, True, True]],
        dtype=bool,
    )
    bundle = _prepare_flat_protection(raw, [mask], [{"flattenStrength": 1.0}], {"seaLevelM": 0.0})
    smoothed = np.zeros_like(raw)
    restored = _restore_flat_protection(smoothed, bundle)
    assert restored[0, 0] == 0.0
    assert restored[1, 1] == 40.0


def test_flatten_strength_softens_without_hard_plane():
    raw = np.array([[40.0, 50.0], [50.0, 50.0]], dtype=np.float32)
    mask = np.array([[True, True], [False, False]], dtype=bool)
    bundle = _prepare_flat_protection(raw, [mask], [{"flattenStrength": 0.5}], {"seaLevelM": 0.0})
    smoothed = np.array([[20.0, 20.0], [50.0, 50.0]], dtype=np.float32)
    out = _restore_flat_protection(smoothed, bundle)
    assert out[0, 0] == 32.5
    assert out[0, 1] == 32.5
    assert out[1, 0] == 50.0


def test_blend_flat_protection_respects_zero_strength():
    height = np.array([[20.0, 40.0]], dtype=np.float32)
    frozen = np.array([[5.0, 5.0]], dtype=np.float32)
    mask = np.array([[True, True]], dtype=bool)
    strength = np.array([[0.0, 1.0]], dtype=np.float32)
    out = _blend_flat_protection(height, frozen, mask, strength)
    assert out[0, 0] == 20.0
    assert out[0, 1] == 5.0


def test_prepare_flat_protection_bundle():
    raw = np.array([[40.0, 40.0], [5.0, 80.0]], dtype=np.float32)
    mask = np.array([[True, True], [False, True]], dtype=bool)
    bundle = _prepare_flat_protection(raw, [mask], [{"flattenStrength": 1.0}], {"seaLevelM": 0.0})
    assert bundle is not None
    assert bundle["frozen"][0, 0] == 40.0
