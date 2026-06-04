import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.distance_field import euclidean_distance_pixels, euclidean_distance_to_land  # noqa: E402


class DistanceFieldTests(unittest.TestCase):
    def test_point_source_is_radially_symmetric(self):
        """Chamfer DT shows N/E/S/W seams; Euclidean should not."""
        rows, cols = 121, 121
        land = np.zeros((rows, cols), dtype=bool)
        cy, cx = 60, 60
        land[cy, cx] = True
        dist = euclidean_distance_pixels(land)
        radius_px = 40
        samples = []
        for dy, dx in ((radius_px, 0), (0, radius_px), (-radius_px, 0), (0, -radius_px)):
            samples.append(float(dist[cy + dy, cx + dx]))
        spread = max(samples) - min(samples)
        self.assertLess(spread, 0.15, f"cardinal distances diverged: {samples}")

    def test_ring_distance_matches_hypot(self):
        land = np.zeros((51, 51), dtype=bool)
        land[25, 25] = True
        dist_m = euclidean_distance_to_land(land, pixel_size_m=2.0, max_distance_m=500.0)
        self.assertAlmostEqual(float(dist_m[25, 35]), 20.0, places=1)
        self.assertAlmostEqual(float(dist_m[35, 25]), 20.0, places=1)

    def test_land_pixels_are_zero(self):
        land = np.zeros((20, 20), dtype=bool)
        land[5:15, 5:15] = True
        dist = euclidean_distance_to_land(land, 1.0, 100.0)
        self.assertTrue(np.all(dist[land] == 0.0))
        self.assertGreater(float(dist[~land].max()), 0.0)


if __name__ == "__main__":
    unittest.main()
