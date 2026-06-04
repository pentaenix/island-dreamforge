import unittest
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.bathymetry import generate_bathymetry
from app.island_maps import (
    MATERIAL_WATER,
    compute_distance_to_land,
    compute_shoreline_mask,
    derive_island_mask,
    generate_material_maps,
    generate_ocean_bathymetry,
    refine_island_mask_for_ocean,
)


class IslandMapTests(unittest.TestCase):
    def test_derive_island_mask_fills_holes_and_keeps_largest(self):
        height = np.zeros((9, 9), dtype=np.float32)
        height[2:7, 2:7] = 10.0
        height[4, 4] = 0.0
        height[0, 8] = 10.0

        mask = derive_island_mask(
            height,
            {
                "seaLevelM": 0,
                "landThresholdM": 0.25,
                "keepLargestIsland": True,
                "minIslandAreaPx": 2,
                "maskClosePasses": 0,
                "maskOpenPasses": 0,
            },
        )

        self.assertTrue(mask[4, 4], "small interior water hole should be filled")
        self.assertFalse(mask[0, 8], "tiny disconnected island should be removed")
        self.assertGreater(mask.sum(), 20)

    def test_shoreline_uses_8_neighbor_water_adjacency(self):
        mask = np.ones((3, 3), dtype=bool)
        shoreline = compute_shoreline_mask(mask)

        self.assertFalse(shoreline[1, 1])
        self.assertTrue(shoreline[0, 0])
        self.assertTrue(shoreline[2, 1])

    def test_distance_to_land_increases_away_from_land(self):
        mask = np.zeros((1, 6), dtype=bool)
        mask[0, 0] = True

        dist = compute_distance_to_land(mask, pixel_size_m=10.0, max_distance_m=100.0)

        self.assertEqual(float(dist[0, 0]), 0.0)
        self.assertAlmostEqual(float(dist[0, 1]), 10.0, places=4)
        self.assertAlmostEqual(float(dist[0, 4]), 40.0, places=4)
        self.assertGreater(float(dist[0, 5]), float(dist[0, 3]))

    def test_bathymetry_deepens_with_distance_from_land(self):
        height = np.zeros((9, 9), dtype=np.float32)
        island = np.zeros((9, 9), dtype=bool)
        island[4, 4] = True

        maps = generate_ocean_bathymetry(
            height,
            island,
            {
                "pixelSizeM": 10,
                "oceanRadiusM": 100,
                "maxOceanDepthM": 50,
                "shallowShelfM": 12,
                "midShelfM": 28,
                "deepStartM": 55,
                "bathymetrySmoothPx": 0,
                "depthCurveExponent": 1.0,
                "seafloorNoiseM": 0,
                "circularFalloffSoftnessM": 0,
            },
        )

        near = float(maps["water_depth_m"][4, 5])
        far = float(maps["water_depth_m"][0, 0])

        self.assertGreater(near, 0.0)
        self.assertGreater(far, near)
        self.assertLess(float(maps["seafloor_height"][0, 0]), 0.0)

    def test_refine_mask_opens_enclosed_lagoon(self):
        height = np.zeros((11, 11), dtype=np.float32)
        height[2:9, 2:4] = 20.0
        height[2:9, 7:9] = 20.0
        height[2:4, 2:9] = 20.0
        raw = derive_island_mask(height, {"seaLevelM": 0, "landThresholdM": 0.25, "maskClosePasses": 1})
        refined = refine_island_mask_for_ocean(height, raw, {"seaLevelM": 0, "landThresholdM": 0.25})
        self.assertFalse(refined[5, 5], "crescent bay center should not be land")
        bathy = generate_bathymetry(
            height,
            refined,
            {"seaLevelM": 0, "landThresholdM": 0.25, "widthM": 110, "depthM": 110, "oceanRadiusM": 80},
        )
        self.assertTrue(bathy["water_mask"][5, 5], "lagoon center uses height-based wet mask")
        self.assertGreater(int(np.sum(bathy["water_color_rgb"][5, 5])), 0)

    def test_bathymetry_ignores_morph_land_for_water_mask(self):
        height = np.zeros((9, 9), dtype=np.float32)
        height[2:7, 2:7] = 30.0
        height[4, 4] = 0.0
        morph_land = np.zeros((9, 9), dtype=bool)
        morph_land[2:7, 2:7] = True
        morph_land[4, 4] = True
        bathy = generate_bathymetry(
            height,
            morph_land,
            {"seaLevelM": 0, "landThresholdM": 0.25, "widthM": 90, "depthM": 90, "oceanRadiusM": 60},
        )
        self.assertFalse(morph_land[4, 4] and not bathy["water_mask"][4, 4])
        self.assertTrue(bathy["water_mask"][4, 4])

    def test_ocean_disc_respects_configured_radius(self):
        height = np.zeros((5, 5), dtype=np.float32)
        island = np.zeros((5, 5), dtype=bool)
        island[2, 2] = True

        maps = generate_ocean_bathymetry(
            height,
            island,
            {
                "pixelSizeM": 10,
                "oceanRadiusM": 12,
                "maxOceanDepthM": 30,
                "seafloorNoiseM": 0,
                "circularFalloffSoftnessM": 0,
            },
        )

        self.assertTrue(maps["ocean_disc_mask"][2, 2])
        self.assertTrue(maps["ocean_disc_mask"][2, 3])
        self.assertFalse(maps["ocean_disc_mask"][0, 0])

    def test_material_maps_have_expected_ids_and_splat_shape(self):
        height = np.array(
            [
                [0, 0, 0, 0, 0],
                [0, 4, 8, 4, 0],
                [0, 20, 90, 20, 0],
                [0, 4, 8, 4, 0],
                [0, 0, 0, 0, 0],
            ],
            dtype=np.float32,
        )
        island = height > 0.25
        bathy = generate_ocean_bathymetry(
            height,
            island,
            {"pixelSizeM": 10, "oceanRadiusM": 100, "seafloorNoiseM": 0},
        )

        maps = generate_material_maps(
            height,
            island,
            bathy["shore_distance_m"],
            {"pixelSizeM": 10, "maxHeightM": 100, "materialSeed": 7},
        )

        ids = maps["material_ids_u8"]
        splat = maps["material_splat_rgba"]

        self.assertEqual(ids.dtype, np.uint8)
        self.assertEqual(splat.dtype, np.uint8)
        self.assertEqual(splat.shape, (5, 5, 4))
        self.assertEqual(int(ids[0, 0]), MATERIAL_WATER)
        self.assertNotEqual(int(ids[2, 2]), MATERIAL_WATER)
        self.assertTrue(np.all(splat.sum(axis=-1) == 255))


if __name__ == "__main__":
    unittest.main()
