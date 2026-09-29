from __future__ import annotations

import math
import unittest

from inspector_worker.geometry_registration_v1 import validate_geometry_registration_v1


SOURCE_SHA = "a" * 64
RENDER_SHA = "b" * 64


def packet(*, raster: bool = False) -> dict:
    width, height = (800.0, 600.0) if raster else (1.0, 1.0)
    points = [(0.1, 0.1), (0.8, 0.1), (0.1, 0.8), (0.8, 0.8), (0.45, 0.55)]
    control = []
    for index, (nx, ny) in enumerate(points):
        x, y = nx * width, ny * height
        # 30-degree rotation, uniform scale, then translation; page y is down.
        project_x = 100 + 0.02 * (math.cos(math.pi / 6) * nx + math.sin(math.pi / 6) * ny)
        project_y = 200 + 0.02 * (math.sin(math.pi / 6) * nx - math.cos(math.pi / 6) * ny)
        control.append({"id": f"P{index}", "evidenceRef": f"manual-point-{index}",
                        "page": [x, y], "project": [project_x, project_y]})
    return {
        "schemaVersion": "geometry-registration-v1",
        "source": {"sourceSha256": SOURCE_SHA, "pdfPageNumber": 1},
        "pageFrame": {"coordinateSpace": "RASTER_PIXEL" if raster else "CANONICAL_VISIBLE_NORMALIZED",
                      "width": width, "height": height, "rotate": 90 if raster else 0,
                      "renderSha256": RENDER_SHA if raster else None},
        "targetFrame": {"kind": "LOCAL_2D", "frameId": "SYNTHETIC-SITE-GRID",
                        "unit": "m", "xAxis": "RIGHT", "yAxis": "UP",
                        "minScale": 0.00001 if raster else 0.01,
                        "maxScale": 0.001 if raster else 0.1},
        "controlPoints": control,
        "trainingPointIds": ["P0", "P1", "P2"],
        "maxHoldoutResidualProjectUnits": 1e-8,
        "queryPoints": [[0.4 * width, 0.4 * height]],
    }


class GeometryRegistrationV1Tests(unittest.TestCase):
    def test_rotated_normalized_frame_holdout_and_roundtrip(self) -> None:
        result = validate_geometry_registration_v1(packet(), expected_source_sha256=SOURCE_SHA)
        self.assertEqual(result["schemaVersion"], "geometry-registration-v1")
        self.assertEqual(result["status"], "REVIEW_ONLY")
        self.assertEqual(result["reasonCode"], "AUTHENTICATED_REGISTRATION_PENDING")
        self.assertEqual([item["id"] for item in result["holdouts"]], ["P3", "P4"])
        self.assertLess(result["maxHoldoutResidualProjectUnits"], 1e-12)
        self.assertLess(result["maxRoundtripPageUnits"], 1e-8)
        self.assertLess(result["determinant"], 0)
        self.assertAlmostEqual(result["queryPoints"][0]["project"][0],
                               100 + 0.02 * (math.cos(math.pi / 6) * 0.4
                                               + math.sin(math.pi / 6) * 0.4))
        self.assertAlmostEqual(result["queryPoints"][0]["project"][1],
                               200 + 0.02 * (math.sin(math.pi / 6) * 0.4
                                               - math.cos(math.pi / 6) * 0.4))
        self.assertEqual(result["facts"], [])

    def test_rotated_raster_frame_uses_pixel_scale_and_sha(self) -> None:
        result = validate_geometry_registration_v1(packet(raster=True),
                                                    expected_source_sha256=SOURCE_SHA,
                                                    expected_render_sha256=RENDER_SHA)
        self.assertEqual(result["pageFrame"]["rotate"], 90)
        self.assertEqual(result["pageFrame"]["renderSha256"], RENDER_SHA)
        self.assertLess(result["maxRoundtripPageUnits"], 1e-8)

    def test_holdout_tamper_rejected(self) -> None:
        data = packet()
        data["controlPoints"][3]["project"][0] += 0.001
        with self.assertRaisesRegex(ValueError, "holdout residual"):
            validate_geometry_registration_v1(data, expected_source_sha256=SOURCE_SHA)

    def test_source_render_and_point_identity_tamper_rejected(self) -> None:
        data = packet(raster=True)
        data["source"]["sourceSha256"] = "c" * 64
        with self.assertRaisesRegex(ValueError, "source SHA"):
            validate_geometry_registration_v1(data, expected_source_sha256=SOURCE_SHA)
        data = packet(raster=True)
        data["pageFrame"]["renderSha256"] = None
        with self.assertRaisesRegex(ValueError, "render SHA"):
            validate_geometry_registration_v1(data, expected_source_sha256=SOURCE_SHA,
                                              expected_render_sha256=RENDER_SHA)
        data = packet(raster=True)
        data["pageFrame"]["renderSha256"] = "c" * 64
        with self.assertRaisesRegex(ValueError, "render SHA"):
            validate_geometry_registration_v1(data, expected_source_sha256=SOURCE_SHA,
                                              expected_render_sha256=RENDER_SHA)
        data = packet()
        data["controlPoints"][3]["id"] = "P0"
        with self.assertRaisesRegex(ValueError, "duplicate control"):
            validate_geometry_registration_v1(data, expected_source_sha256=SOURCE_SHA)

    def test_degenerate_mirror_and_ambiguous_scale_rejected(self) -> None:
        data = packet()
        data["trainingPointIds"] = ["P0", "P1", "P4"]
        data["controlPoints"][4]["page"] = [0.45, 0.1]
        with self.assertRaisesRegex(ValueError, "degenerate"):
            validate_geometry_registration_v1(data, expected_source_sha256=SOURCE_SHA)
        data = packet()
        data["targetFrame"]["yAxis"] = "DOWN"
        with self.assertRaisesRegex(ValueError, "mirror"):
            validate_geometry_registration_v1(data, expected_source_sha256=SOURCE_SHA)
        data = packet()
        del data["targetFrame"]["unit"]
        with self.assertRaisesRegex(ValueError, "target frame fields"):
            validate_geometry_registration_v1(data, expected_source_sha256=SOURCE_SHA)
        data = packet()
        data["targetFrame"]["maxScale"] = 0.001
        with self.assertRaisesRegex(ValueError, "scale"):
            validate_geometry_registration_v1(data, expected_source_sha256=SOURCE_SHA)

    def test_outside_calibration_hull_and_page_rejected(self) -> None:
        data = packet()
        data["queryPoints"] = [[0.95, 0.95]]
        with self.assertRaisesRegex(ValueError, "calibration domain"):
            validate_geometry_registration_v1(data, expected_source_sha256=SOURCE_SHA)
        data = packet()
        data["controlPoints"][4]["page"] = [1.1, 0.55]
        with self.assertRaisesRegex(ValueError, "page frame"):
            validate_geometry_registration_v1(data, expected_source_sha256=SOURCE_SHA)

    def test_no_tolerance_or_unpinned_training_selection_rejected(self) -> None:
        data = packet()
        del data["maxHoldoutResidualProjectUnits"]
        with self.assertRaisesRegex(ValueError, "packet fields"):
            validate_geometry_registration_v1(data, expected_source_sha256=SOURCE_SHA)
        data = packet()
        del data["trainingPointIds"]
        with self.assertRaisesRegex(ValueError, "packet fields"):
            validate_geometry_registration_v1(data, expected_source_sha256=SOURCE_SHA)


if __name__ == "__main__":
    unittest.main()
