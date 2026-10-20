from __future__ import annotations

import copy
import unittest

from inspector_worker.concrete_wall_transport_v13 import validate_concrete_wall_window_v13


class NonPdfTransportV13Tests(unittest.TestCase):
    def window(self, media_type: str, byte_size: int) -> dict:
        return {
            "objectId": "11111111-1111-4111-8111-111111111111",
            "runId": "22222222-2222-4222-8222-222222222222",
            "inputManifestHash": "a" * 64,
            "releaseId": "release:controlled-v13",
            "inputs": {
                "sourceFiles": [{"sourceFileId": "FIL-XML", "sha256": "b" * 64,
                                 "stages": ["PD"], "sectionCode": None, "byteSize": byte_size,
                                 "mediaType": media_type, "downloadPath": "/authorized/original"}],
                "sourceDecisions": {},
                "concreteWallOriginsV1": {"schemaVersion": "matrix-concrete-wall-origin-contexts-v1", "records": []},
            },
        }

    def test_four_byte_xml_keeps_real_source_identity_and_size(self) -> None:
        window = self.window("application/xml", 4)
        before = copy.deepcopy(window)
        validate_concrete_wall_window_v13(window)
        self.assertEqual(window, before)

    def test_pdf_retains_five_byte_minimum_and_all_sources_reject_invalid_sizes(self) -> None:
        for media_type, size in [("application/pdf", 4), ("application/xml", 0),
                                 ("application/xml", -1), ("application/xml", 1.5),
                                 ("application/xml", True)]:
            with self.subTest(media_type=media_type, size=size):
                with self.assertRaises((TypeError, ValueError)):
                    validate_concrete_wall_window_v13(self.window(media_type, size))
        validate_concrete_wall_window_v13(self.window("application/pdf", 5))


if __name__ == "__main__":
    unittest.main()
