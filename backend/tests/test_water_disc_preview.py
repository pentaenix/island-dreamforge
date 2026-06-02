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
                "shallowShelfM": 20,
                "midShelfM": 60,
                "deepStartM": 140,
                "bathymetrySmoothPx": 0,
                "reefNoiseStrength": 0,
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

        # Same distance from sphere edge → same band color (approximately)
        east = color[cy, cx + 30]
        west = color[cy, cx - 30]
        self.assertTrue(np.allclose(east, west, atol=2))

        self.assertEqual(int(np.count_nonzero(color[~mask])), 0)


if __name__ == "__main__":
    unittest.main()
