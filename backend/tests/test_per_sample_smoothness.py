import numpy as np

from app.terrain import HeightSample, _designed_band_blend_height


def test_low_smoothness_keeps_color_band_sharper():
    raw = np.array([[0.0, 0.0, 100.0, 100.0], [0.0, 0.0, 100.0, 100.0]], dtype=np.float32)
    label_map = np.array([[0, 0, 1, 1], [0, 0, 1, 1]], dtype=np.int32)
    opts = {"bandBlendStrength": 0.9, "bandTransitionPx": 4.0, "bandBlendPasses": 1}
    crisp = [
        HeightSample(hex="#000000", height=0.0, smoothness=0.0),
        HeightSample(hex="#ffffff", height=100.0, smoothness=0.0),
    ]
    soft = [
        HeightSample(hex="#000000", height=0.0, smoothness=1.0),
        HeightSample(hex="#ffffff", height=100.0, smoothness=1.0),
    ]
    out_crisp = _designed_band_blend_height(raw, label_map, crisp, opts, None)
    out_soft = _designed_band_blend_height(raw, label_map, soft, opts, None)
    assert out_crisp[0, 2] == 100.0
    assert out_soft[0, 2] < 100.0
