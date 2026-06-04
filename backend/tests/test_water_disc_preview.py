import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.bathymetry import generate_water_disc_preview  # noqa: E402


class WaterDiscPreviewTests(unittest.TestCase):
    def test_preview_is_radial_not_island_shaped(self):
        data = generate_water_disc_preview(
            {
                "oceanRadiusM": 400,
                "previewSphereRadiusM": 80,
                "waterDiscPreviewSpanM": 900,
                "waterBandStepM": 10,
                "waterBandStepIncreaseM": 6,
                "bathymetrySmoothPx": 0,
                "reefNoiseStrength": 0,
                "coastalVariationStrength": 0,
                "waterPreviewSizePx": 256,
            }
        )
        color = data["water_color_rgb"]
        mask = data["water_mask"]
        rows, cols = mask.shape
        cy, cx = rows // 2, cols // 2

        self.assertFalse(mask[cy, cx], "center inside sphere is not water")
        self.assertTrue(mask[cy, cx + 40], "water exists east of sphere")
        self.assertTrue(mask[cy, cx - 40], "water exists west of sphere")
        self.assertTrue(mask[cy + 40, cx], "water exists south of sphere")
        self.assertTrue(mask[cy - 40, cx], "water exists north of sphere")

        # Mirrored pixels share shore distance → same depth color
        east_col = min(cols - 1, cx + 30)
        west_col = cols - 1 - east_col
        east = color[cy, east_col]
        west = color[cy, west_col]
        self.assertTrue(np.allclose(east, west, atol=3))

        self.assertEqual(int(np.count_nonzero(color[~mask])), 0)

    def test_larger_ocean_radius_fills_more_of_fixed_preview_frame(self):
        opts = {
            "previewSphereRadiusM": 80,
            "waterDiscPreviewSpanM": 10000,
            "bathymetrySmoothPx": 0,
            "reefNoiseStrength": 0,
            "coastalVariationStrength": 0,
            "waterPreviewSizePx": 256,
            "widthM": 1480,
            "depthM": 1086,
        }
        small = generate_water_disc_preview({**opts, "oceanRadiusM": 250})
        large = generate_water_disc_preview({**opts, "oceanRadiusM": 4000})
        small_area = int(np.count_nonzero(small["ocean_disc_mask"]))
        large_area = int(np.count_nonzero(large["ocean_disc_mask"]))
        self.assertGreater(large_area, small_area * 4)


if __name__ == "__main__":
    unittest.main()
