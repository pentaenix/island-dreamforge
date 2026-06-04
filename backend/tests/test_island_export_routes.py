import io
import json
import sys
import unittest
import zipfile
import asyncio
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.image_utils import array_to_16bit_png  # noqa: E402
from app.main import export_game_island, export_web_island, island_derived_maps  # noqa: E402


class _Upload:
    def __init__(self, data: bytes):
        self._data = data

    async def read(self) -> bytes:
        return self._data


def _height_png_bytes() -> bytes:
    height = np.zeros((9, 9), dtype=np.float32)
    yy, xx = np.indices(height.shape)
    dist = np.sqrt((yy - 4) ** 2 + (xx - 4) ** 2)
    island = dist <= 3.0
    height[island] = np.clip((3.2 - dist[island]) * 28.0, 2.0, 90.0)
    img = array_to_16bit_png(height, 120.0)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _options() -> str:
    return json.dumps(
        {
            "maxHeightM": 120,
            "widthM": 90,
            "depthM": 90,
            "verticalScale": 1,
            "seaLevelM": 0,
            "oceanRadiusM": 80,
            "maxOceanDepthM": 30,
            "waterBandStepM": 10,
            "waterBandStepIncreaseM": 5,
            "depthCurveExponent": 1.2,
            "seafloorNoiseM": 0,
            "circularFalloffSoftnessM": 0,
            "chunkSize": 4,
        }
    )


class IslandExportRouteTests(unittest.TestCase):
    async def _response_bytes(self, response) -> bytes:
        chunks = []
        async for chunk in response.body_iterator:
            chunks.append(chunk)
        return b"".join(chunks)

    def _assert_manifest_file_coverage(self, manifest, names):
        self.assertEqual(manifest["format"], "island-dreamforge-export")
        self.assertEqual(manifest["schemaVersion"], 1)
        self.assertEqual(manifest["units"], "meters")
        self.assertIn("world", manifest)
        self.assertIn("ocean", manifest)
        self.assertIn("detail", manifest)
        self.assertIn("materials", manifest)
        self.assertIn("coordinateSystem", manifest)
        for path in manifest["files"].values():
            self.assertIn(path, names)

    def test_island_derived_maps_route_returns_previews(self):
        body = asyncio.run(island_derived_maps(_Upload(_height_png_bytes()), _options()))

        self.assertEqual(body["width"], 9)
        self.assertEqual(body["height"], 9)
        bands = body["metadata"]["bandsMap"]
        self.assertIn("footprintCols", bands)
        self.assertIn("footprintRows", bands)
        self.assertIn("metersPerPixelX", bands)
        self.assertEqual(bands["footprintCols"], 9)
        self.assertEqual(bands["footprintRows"], 9)
        self.assertAlmostEqual(body["bandsPlaneWidthM"], bands["planeWidthM"], places=1)
        for key in ["islandMask", "shorelineMask", "oceanDiscMask", "shoreDistance", "waterDepth", "materialIds", "materialSplat"]:
            self.assertTrue(body[key].startswith("data:image/png;base64,"))
        self.assertGreater(body["metadata"]["stats"]["landPixels"], 0)
        self.assertGreater(body["metadata"]["stats"]["maxWaterDepthM"], 0)

    def test_web_export_route_contains_required_files(self):
        response = asyncio.run(export_web_island(_Upload(_height_png_bytes()), _options()))
        content = asyncio.run(self._response_bytes(response))

        self.assertEqual(response.media_type, "application/zip")
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            names = set(zf.namelist())
            self.assertIn("manifest.json", names)
            self.assertIn("scene/island_web.glb", names)
            self.assertIn("textures/material_splat.png", names)
            self.assertIn("textures/water_depth.png", names)
            self.assertIn("masks/island_mask.png", names)
            self.assertIn("masks/shore_distance.png", names)
            manifest = json.loads(zf.read("manifest.json"))
            self.assertEqual(manifest["profile"], "web")
            self.assertEqual(manifest["files"]["scene"], "scene/island_web.glb")
            self.assertEqual(manifest["package"], "web_export")
            self.assertIn("shorelineMask", manifest["files"])
            self.assertIn("oceanDiscMask", manifest["files"])
            self._assert_manifest_file_coverage(manifest, names)

    def test_game_export_route_contains_required_files(self):
        response = asyncio.run(export_game_island(_Upload(_height_png_bytes()), _options()))
        content = asyncio.run(self._response_bytes(response))

        self.assertEqual(response.media_type, "application/zip")
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            names = set(zf.namelist())
            expected = {
                "manifest.json",
                "game/world.json",
                "game/height_u16.png",
                "game/collision_height_u16.png",
                "game/material_ids_u8.png",
                "game/water_depth_u8.png",
                "game/island_mask_u8.png",
                "game/shore_distance_u16.png",
                "game/terrain_lod0.bin",
                "game/terrain_lod1.bin",
                "game/terrain_lod2.bin",
                "game/seafloor_lod0.bin",
                "game/seafloor_lod1.bin",
                "game/coastline_skirt.bin",
                "preview/island_game_preview.glb",
            }
            self.assertTrue(expected.issubset(names))
            self.assertTrue(zf.read("game/terrain_lod0.bin").startswith(b"IDFMAP01"))
            manifest = json.loads(zf.read("manifest.json"))
            self.assertEqual(manifest["profile"], "game")
            self.assertEqual(manifest["package"], "game_export")
            self.assertIn("binaryFormats", manifest)
            self.assertEqual(manifest["files"]["structures"], "game/structure_instances.json")
            self.assertEqual(manifest["files"]["world"], "game/world.json")
            self._assert_manifest_file_coverage(manifest, names)


if __name__ == "__main__":
    unittest.main()
