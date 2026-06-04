import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.bathymetry import generate_bathymetry  # noqa: E402
from app.water_palette import ISLAND_WATER_HEX, _hex_to_rgb, interpolate_water_ramp  # noqa: E402


class BathymetryTests(unittest.TestCase):
    def _height(self):
        yy, xx = np.indices((33, 33))
        d = np.sqrt((yy - 16) ** 2 + (xx - 16) ** 2)
        height = np.zeros((33, 33), dtype=np.float32)
        height[d <= 7] = (7 - d[d <= 7]) * 12 + 2
        return height

    def test_bathymetry_continuous_depth_field(self):
        height = self._height()
        island = height > 0
        data = generate_bathymetry(
            height,
            island,
            {
                "widthM": 330,
                "depthM": 330,
                "oceanRadiusM": 220,
                "maxOceanDepthM": 80,
                "shallowShelfM": 24,
                "midShelfM": 70,
                "deepStartM": 150,
                "bathymetrySmoothPx": 0,
                "reefNoiseStrength": 0,
                "coastalVariationStrength": 0,
                "waterBandSmoothness": 0.35,
            },
        )

        bathy = data["bathymetry01"]
        shore = data["shore_distance_m"]
        self.assertEqual(bathy.shape, height.shape)
        self.assertLess(float(shore[data["water_mask"]].min()), 30.0)
        unique = np.unique(np.round(bathy[data["water_mask"]], 3))
        self.assertGreaterEqual(len(unique), 8)
        self.assertTrue(np.all(data["seafloor_height"][data["water_mask"]] <= 0))

    def test_island_palette_colors(self):
        shallow = np.array(_hex_to_rgb(ISLAND_WATER_HEX[0]), dtype=np.uint8)
        deep = np.array(_hex_to_rgb(ISLAND_WATER_HEX[-1]), dtype=np.uint8)
        self.assertTrue(np.allclose(interpolate_water_ramp(np.array([[0.0]]), 0.0)[0, 0], shallow))
        self.assertTrue(np.allclose(interpolate_water_ramp(np.array([[1.0]]), 0.0)[0, 0], deep))

    def test_water_color_and_foam_maps_are_export_ready(self):
        height = self._height()
        data = generate_bathymetry(height, height > 0, {"widthM": 330, "depthM": 330, "oceanRadiusM": 220})

        self.assertEqual(data["water_color_rgb"].shape, (33, 33, 3))
        self.assertEqual(data["water_color_rgb"].dtype, np.uint8)
        self.assertGreater(np.count_nonzero(data["foam_mask"]), 0)
        self.assertGreater(np.count_nonzero(data["water_mask"]), 0)
        self.assertTrue(np.all(data["water_color_rgb"][~data["water_mask"]] == 0))


if __name__ == "__main__":
    unittest.main()
