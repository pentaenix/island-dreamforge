import struct
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.mesh_export import (  # noqa: E402
    coastline_skirt_mesh,
    height_to_mesh,
    land_mesh_from_mask,
    seafloor_mesh_from_maps,
    write_chunked_game_mesh,
)


class MeshExportTests(unittest.TestCase):
    def test_existing_height_to_mesh_still_builds_rectangular_mesh(self):
        height = np.array([[0, 1], [2, 3]], dtype=np.float32)
        mesh = height_to_mesh(height, {"meshResolution": 8, "widthM": 10, "depthM": 10, "addSkirt": False})

        self.assertEqual(len(mesh.vertices), 4)
        self.assertEqual(len(mesh.faces), 2)

    def test_land_mesh_only_includes_fully_land_cells(self):
        height = np.arange(16, dtype=np.float32).reshape(4, 4)
        mask = np.zeros((4, 4), dtype=bool)
        mask[:2, :2] = True

        mesh = land_mesh_from_mask(height, mask, {"widthM": 30, "depthM": 30}, None)

        self.assertEqual(len(mesh.faces), 2)
        self.assertEqual(len(mesh.vertices), 4)
        # All vertices should come from the top-left land block.
        self.assertLessEqual(float(np.max(mesh.vertices[:, 0])), -5.0)
        self.assertLessEqual(float(np.max(mesh.vertices[:, 2])), -5.0)

    def test_coastline_skirt_goes_below_sea_level(self):
        height = np.zeros((4, 4), dtype=np.float32)
        height[:2, :2] = 12
        mask = height > 1
        seafloor = np.full((4, 4), -30, dtype=np.float32)

        mesh = coastline_skirt_mesh(
            height,
            mask,
            seafloor,
            {"widthM": 40, "depthM": 40, "seaLevelM": 0, "coastlineSkirtDepthM": 10},
        )

        self.assertGreater(len(mesh.faces), 0)
        self.assertLessEqual(float(np.min(mesh.vertices[:, 1])), -30.0)
        self.assertGreaterEqual(float(np.max(mesh.vertices[:, 1])), 12.0)

    def test_seafloor_mesh_has_negative_y_and_valid_indices(self):
        seafloor = np.full((5, 5), -20, dtype=np.float32)
        yy, xx = np.indices((5, 5))
        disc = ((yy - 2) ** 2 + (xx - 2) ** 2) <= 4

        mesh = seafloor_mesh_from_maps(seafloor, disc, {"widthM": 50, "depthM": 50})

        self.assertGreater(len(mesh.faces), 0)
        self.assertLess(float(np.min(mesh.vertices[:, 1])), 0.0)
        self.assertLess(int(np.max(mesh.faces)), len(mesh.vertices))

    def test_chunked_game_mesh_is_deterministic_and_has_header(self):
        height = np.arange(25, dtype=np.float32).reshape(5, 5)
        mask = np.ones((5, 5), dtype=bool)
        mats = np.full((5, 5), 3, dtype=np.uint8)
        opts = {"widthM": 40, "depthM": 40, "chunkSize": 2, "gameProfileId": 2}

        first = write_chunked_game_mesh(height, mask, mats, opts)
        second = write_chunked_game_mesh(height, mask, mats, opts)

        self.assertEqual(first, second)
        magic, version, profile, chunk_count, _reserved = struct.unpack("<8sHHI16s", first[:32])
        self.assertEqual(magic, b"IDFMAP01")
        self.assertEqual(version, 1)
        self.assertEqual(profile, 2)
        self.assertEqual(chunk_count, 4)
        self.assertIn(b"\nJSON\n", first)


if __name__ == "__main__":
    unittest.main()
