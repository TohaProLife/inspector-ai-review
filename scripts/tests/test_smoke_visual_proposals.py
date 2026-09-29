from __future__ import annotations

from pathlib import Path
import runpy
import unittest


MODULE = runpy.run_path(str(Path(__file__).resolve().parents[1] / "smoke-visual-proposals.py"))
validate_document_context = MODULE["validate_document_context"]
validate_vlm_observations = MODULE["validate_vlm_observations"]


class VisualProposalSmokeContractTests(unittest.TestCase):
    def context(self, title: str | None, *, status: str, reason: str) -> dict:
        return {
            "schemaVersion": "document-context-v1",
            "methodId": "first-two-pdf-cover-text-pages-v1",
            "status": status,
            "reasonCode": reason,
            "inspectedPages": [
                {"pageNumber": 1, "textSha256": "a" * 64, "titleWindow": title},
                {"pageNumber": 2, "textSha256": "b" * 64, "titleWindow": None},
            ],
        }

    def test_old_and_new_artifact_versions_remain_distinct(self) -> None:
        self.assertEqual(MODULE["VISUAL_VERSIONS"], {
            "visual-proposal-analysis-v1", "visual-proposal-analysis-v2",
            "visual-proposal-analysis-v3", "visual-proposal-analysis-v4",
            "visual-proposal-analysis-v5", "visual-proposal-analysis-v6",
        })

    def test_v5_selection_and_provenance_are_exact(self) -> None:
        source = {
            "sourceSha256": "a" * 64,
            "proposals": [{"pageNumber": i + 1, "bboxNormalized": [0.1, 0.2, 0.3, 0.4]}
                          for i in range(5)],
        }
        def observation(ordinal: int) -> dict:
            return {
                "proposalOrdinal": ordinal, "sourceSha256": source["sourceSha256"],
                "pageNumber": ordinal + 1, "bboxNormalized": [0.1, 0.2, 0.3, 0.4],
                "cropSha256": "b" * 64, "modelId": "inspector-qwen3vl4b-eval",
                "modelWeightsSha256": "66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a",
                "modelProjectorSha256": "30ba2c7dd3127a4561b6cba9d13d0f711c91bdb38742e2f56d73c8cb596bd06d",
                "promptSha256": "34a372ca6f4032b74ff51c11dd7adfe14df31b266ca356a5a2ec15b1d56c9611",
                "decision": "ABSTAIN", "reasonCode": "MODEL_ABSTAIN", "responseSha256": "c" * 64,
            }
        value = {
            "schemaVersion": "visual-vlm-observations-v1",
            "methodId": "spread-two-saved-proposals-v1",
            "eligibleProposalCount": 5, "selectedOrdinals": [1, 3],
            "omittedProposalCount": 3,
            "observations": [observation(1), observation(3)],
        }
        self.assertEqual(len(validate_vlm_observations(value, source, "visual-proposal-analysis-v5")), 2)
        value["observations"][0]["decision"] = "RADIATOR_HINT"
        with self.assertRaisesRegex(RuntimeError, "outcome"):
            validate_vlm_observations(value, source, "visual-proposal-analysis-v5")
        value["observations"][0]["decision"] = "ABSTAIN"
        value["selectedOrdinals"] = [0, 3]
        with self.assertRaisesRegex(RuntimeError, "selection"):
            validate_vlm_observations(value, source, "visual-proposal-analysis-v5")

    def test_v6_rejects_untrusted_negative_answer(self) -> None:
        source = {"sourceSha256": "a" * 64, "proposals": [
            {"pageNumber": 1, "bboxNormalized": [0.1, 0.2, 0.3, 0.4]},
        ]}
        observation = {
            "proposalOrdinal": 0, "sourceSha256": source["sourceSha256"],
            "pageNumber": 1, "bboxNormalized": [0.1, 0.2, 0.3, 0.4],
            "cropSha256": "b" * 64, "modelId": "inspector-qwen3-vl-8b-fp8",
            "modelRevision": "9cdc6310a8cb770ce18efaf4e9935334512aee45",
            "modelLockSha256": "e2586e16f45deee017935d4c60b550e48059fdc02cbc9c9114053f2f1fe4d879",
            "promptSha256": "34a372ca6f4032b74ff51c11dd7adfe14df31b266ca356a5a2ec15b1d56c9611",
            "decision": "ABSTAIN", "reasonCode": "MODEL_OTHER_UNTRUSTED",
            "responseSha256": "c" * 64,
        }
        value = {
            "schemaVersion": "visual-vlm-observations-v1",
            "methodId": "spread-two-saved-proposals-server-nonnegative-v1",
            "eligibleProposalCount": 1, "selectedOrdinals": [0],
            "omittedProposalCount": 0, "observations": [observation],
        }
        self.assertEqual(len(validate_vlm_observations(value, source, "visual-proposal-analysis-v6")), 1)
        observation["decision"] = "OTHER_HINT"
        observation["reasonCode"] = "MODEL_RESPONSE"
        with self.assertRaisesRegex(RuntimeError, "outcome"):
            validate_vlm_observations(value, source, "visual-proposal-analysis-v6")

    def test_ventilation_title_and_unknown_corrupt_cover(self) -> None:
        context = self.context("РАБОЧАЯ ДОКУМЕНТАЦИЯ\nСистема общеобменной вентиляции",
                               status="VENTILATION", reason="TITLE_KEYWORD_MATCH")
        self.assertEqual(validate_document_context(context, 676), "VENTILATION")
        unknown = self.context(None, status="UNKNOWN", reason="NO_TITLE_KEYWORD_MATCH")
        self.assertEqual(validate_document_context(unknown, 614), "UNKNOWN")

    def test_mixed_title_abstains_and_forged_status_fails(self) -> None:
        context = self.context("РАБОЧАЯ ДОКУМЕНТАЦИЯ\nОтопление и вентиляция",
                               status="UNKNOWN", reason="TITLE_CONFLICT")
        self.assertEqual(validate_document_context(context, 2), "UNKNOWN")
        context["status"] = "HEATING"
        with self.assertRaisesRegex(RuntimeError, "inconsistent"):
            validate_document_context(context, 2)

    def test_missing_or_extra_provenance_fails(self) -> None:
        context = self.context("РАБОЧАЯ ДОКУМЕНТАЦИЯ\nОтопление",
                               status="HEATING", reason="TITLE_KEYWORD_MATCH")
        context["inspectedPages"].pop()
        with self.assertRaisesRegex(RuntimeError, "invalid"):
            validate_document_context(context, 2)
        context["inspectedPages"].append({
            "pageNumber": 2, "textSha256": "b" * 64, "titleWindow": "Отопление",
        })
        with self.assertRaisesRegex(RuntimeError, "title evidence"):
            validate_document_context(context, 2)


if __name__ == "__main__":
    unittest.main()
