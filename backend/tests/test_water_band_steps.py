import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.water_band_steps import band_edges_from_options, band_edges_from_steps, band_widths_m  # noqa: E402


class WaterBandStepsTests(unittest.TestCase):
    def test_cumulative_band_edges_grow(self):
        edges = band_edges_from_steps(12, 8, growth_power=2.0)
        self.assertEqual(len(edges), 7)
        widths = [edges[i + 1] - edges[i] for i in range(6)]
        self.assertEqual(widths[0], 12)
        self.assertEqual(widths[1], 12 + 8)
        self.assertGreater(widths[-1], widths[0] * 3)

    def test_options_prefers_step_mode(self):
        edges = band_edges_from_options({"waterBandStepM": 10, "waterBandStepIncreaseM": 5})
        self.assertEqual(edges[1] - edges[0], 10)
        self.assertEqual(edges[2] - edges[1], 15)


if __name__ == "__main__":
    unittest.main()
