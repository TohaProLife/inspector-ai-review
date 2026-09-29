from __future__ import annotations

import unittest
from pathlib import Path
from queue import Empty, Queue
from threading import Event
from threading import get_ident
from unittest.mock import patch

from inspector_worker.catalog import load_parameter_catalog
from inspector_worker.main import LeaseHeartbeat, LeaseLostError, dispatch_delivery, execute_durable_job, validate_envelope
from inspector_worker.models import DocumentRecord, ParameterRule
from inspector_worker.pipeline import compare_values, evaluate_completeness
from inspector_worker.stage_scaffold import (
    SCAFFOLD_JOB_TYPES,
    StageProviderRegistry,
    build_unconfigured_stage_result,
)
from inspector_worker.text_layer import InputDownloadError, qualify_page_text


class PipelineTests(unittest.TestCase):
    def test_long_delivery_keeps_connection_thread_free_and_acks_on_it(self) -> None:
        callbacks: Queue = Queue()
        started = Event()
        release = Event()
        consumer_thread = get_ident()

        class Connection:
            def add_callback_threadsafe(self, callback) -> None:
                callbacks.put(callback)

        class Channel:
            is_open = True
            ack_thread: int | None = None

            def basic_ack(self, *, delivery_tag: int) -> None:
                self.ack_thread = get_ident()
                self.delivery_tag = delivery_tag

        def work(_payload) -> dict[str, str]:
            started.set()
            release.wait(timeout=2)
            return {"status": "COMPLETED"}

        channel = Channel()
        with patch("inspector_worker.main.execute_durable_job", side_effect=work):
            worker = dispatch_delivery(Connection(), channel, 7, b'{"job_id":"job-1"}')
            self.assertTrue(started.wait(timeout=1))
            with self.assertRaises(Empty):
                callbacks.get_nowait()
            release.set()
            worker.join(timeout=2)
        self.assertFalse(worker.is_alive())
        callbacks.get(timeout=1)()
        self.assertEqual(channel.ack_thread, consumer_thread)
        self.assertEqual(channel.delivery_tag, 7)

    def test_provider_neutral_stage_contracts_never_fabricate_outputs(self) -> None:
        expected = {
            "DOCUMENT_RENDER": ("PROVIDER_NOT_CONFIGURED", "RENDERER_PROFILE_NOT_SELECTED", "RENDERER"),
            "DOCUMENT_OCR_LAYOUT": (
                "PROVIDER_NOT_CONFIGURED",
                "OCR_LAYOUT_PROFILE_NOT_SELECTED",
                "OCR_LAYOUT",
            ),
            "DOCUMENT_METADATA": (
                "PROVIDER_NOT_CONFIGURED",
                "METADATA_PROFILE_NOT_SELECTED",
                "METADATA_EXTRACTOR",
            ),
            "DOCUMENT_LINKING": ("POLICY_NOT_CONFIGURED", "LINKING_POLICY_NOT_SELECTED", "LINKING_POLICY"),
            "ENTITY_EXTRACTION": (
                "PROVIDER_NOT_CONFIGURED",
                "ENTITY_EXTRACTION_PROFILE_NOT_SELECTED",
                "ENTITY_EXTRACTION_MODEL",
            ),
            "RULE_EVALUATION": ("UNSUPPORTED_RULESET", "EXECUTABLE_RULES_NOT_CONFIGURED", "RULE_ENGINE"),
            "EVIDENCE_VALIDATION": ("NO_MACHINE_RESULTS", "RULE_RESULTS_UNAVAILABLE", "EVIDENCE_VALIDATOR"),
        }

        self.assertEqual(set(SCAFFOLD_JOB_TYPES), set(expected))
        for job_type, (disposition, reason_code, provider_kind) in expected.items():
            with self.subTest(job_type=job_type):
                result = build_unconfigured_stage_result(job_type, "a" * 64)
                self.assertEqual(result, {
                    "schemaVersion": "analysis-stage-result-v1",
                    "jobType": job_type,
                    "inputManifestHash": "a" * 64,
                    "disposition": disposition,
                    "reasonCode": reason_code,
                    "providerKind": provider_kind,
                    "providerProfileId": None,
                    "providerConfigHash": None,
                    "outputCount": 0,
                })

    def test_provider_neutral_stage_contract_rejects_unknown_stage(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported scaffold job_type"):
            build_unconfigured_stage_result("UNKNOWN_STAGE", "a" * 64)

    def test_provider_neutral_stage_contract_requires_manifest_hash(self) -> None:
        with self.assertRaisesRegex(ValueError, "inputManifestHash"):
            build_unconfigured_stage_result("DOCUMENT_RENDER", "not-a-hash")

    def test_provider_registry_rejects_adapter_for_wrong_slot(self) -> None:
        class WrongAdapter:
            job_type = "DOCUMENT_OCR_LAYOUT"
            provider_kind = "EXTERNAL_CHAT_API"

            def execute(
                self,
                _lease: dict[str, object],
                _attempt: dict[str, object],
            ) -> dict[str, object]:
                return {}

        with self.assertRaisesRegex(ValueError, "does not match OCR_LAYOUT"):
            StageProviderRegistry().register(WrongAdapter())

    def test_provider_registry_rejects_unsafe_or_unavailable_release_configuration(self) -> None:
        registry = StageProviderRegistry()
        base_lease = {"inputManifestHash": "a" * 64}
        with self.assertRaisesRegex(ValueError, "disable external network"):
            registry.execute("DOCUMENT_RENDER", {
                **base_lease,
                "release": {"externalNetworkAllowed": True, "providerSlot": None},
            }, {})
        with self.assertRaisesRegex(ValueError, "configured provider adapter.*unavailable"):
            registry.execute("DOCUMENT_RENDER", {
                **base_lease,
                "release": {
                    "externalNetworkAllowed": False,
                    "providerSlot": {
                        "providerKind": "RENDERER",
                        "status": "CONFIGURED",
                    },
                },
            }, {})

    def test_durable_worker_commits_provider_neutral_stage_contract(self) -> None:
        envelope = {
            "schema_version": "1.0",
            "event_id": "event-render",
            "event_type": "job.ready",
            "run_id": "run-1",
            "job_id": "job-render",
            "job_type": "DOCUMENT_RENDER",
            "scope_type": "ANALYSIS",
            "input_manifest_hash": "a" * 64,
        }
        responses = [
            {
                "status": "ACQUIRED",
                "lease": {
                    "attemptId": "attempt-render",
                    "fencingToken": 2,
                    "inputManifestHash": "a" * 64,
                },
            },
            {"status": "COMPLETED", "replayed": False},
        ]
        with patch("inspector_worker.main.post_with_retry", side_effect=responses) as post:
            result = execute_durable_job(envelope)

        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(post.call_args_list[1].args[2]["result"], {
            "schemaVersion": "analysis-stage-result-v1",
            "jobType": "DOCUMENT_RENDER",
            "inputManifestHash": "a" * 64,
            "disposition": "PROVIDER_NOT_CONFIGURED",
            "reasonCode": "RENDERER_PROFILE_NOT_SELECTED",
            "providerKind": "RENDERER",
            "providerProfileId": None,
            "providerConfigHash": None,
            "outputCount": 0,
        })

    def test_empty_text_layer_requires_ocr(self) -> None:
        quality = qualify_page_text([])

        self.assertEqual(quality["disposition"], "OCR_REQUIRED")
        self.assertEqual(quality["reasonCodes"], ["EMPTY_TEXT_LAYER"])
        self.assertEqual(quality["metrics"], {
            "blockCount": 0,
            "nonWhitespaceCharacterCount": 0,
            "alphanumericCharacterCount": 0,
            "replacementCharacterCount": 0,
            "disallowedControlCharacterCount": 0,
        })

    def test_clean_text_layer_remains_candidate_until_render_qualification(self) -> None:
        quality = qualify_page_text(["Раздел КР-1", "Высота 12,5 м"])

        self.assertEqual(quality["disposition"], "TEXT_LAYER_CANDIDATE")
        self.assertEqual(quality["reasonCodes"], [])
        self.assertGreater(quality["metrics"]["alphanumericCharacterCount"], 0)

    def test_decoding_anomaly_requires_ocr(self) -> None:
        quality = qualify_page_text(["План \ufffd\x01"])

        self.assertEqual(quality["disposition"], "OCR_REQUIRED")
        self.assertEqual(quality["reasonCodes"], ["TEXT_DECODING_ANOMALY"])
        self.assertEqual(quality["metrics"]["replacementCharacterCount"], 1)
        self.assertEqual(quality["metrics"]["disallowedControlCharacterCount"], 1)

    def test_pdfminer_cid_placeholder_requires_ocr_in_current_policy(self) -> None:
        text = "Раздел 10. (cid:584)(cid:603)щ(cid:607)"
        current = qualify_page_text([text])
        legacy = qualify_page_text([text], policy_version="text-layer-quality-v1")
        self.assertEqual(current["disposition"], "OCR_REQUIRED")
        self.assertEqual(current["reasonCodes"], ["TEXT_DECODING_ANOMALY"])
        self.assertEqual(legacy["disposition"], "TEXT_LAYER_CANDIDATE")

    def test_symbol_only_text_layer_requires_ocr(self) -> None:
        quality = qualify_page_text(["— • / №"])

        self.assertEqual(quality["disposition"], "OCR_REQUIRED")
        self.assertEqual(quality["reasonCodes"], ["NO_ALPHANUMERIC_TEXT"])

    def test_supplied_catalog_has_exactly_132_unique_parameters(self) -> None:
        root = Path(__file__).resolve().parents[3]
        path = root / "datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/parameter_catalog_132.jsonl"
        catalog = load_parameter_catalog(path)
        self.assertEqual(len(catalog), 132)
        self.assertEqual(len({row["parameter_code"] for row in catalog}), 132)

    def test_missing_document_never_becomes_violation(self) -> None:
        completeness = evaluate_completeness(
            (DocumentRecord(file_id="PD-1", stage="PD", sha256="abc", page_count=10),)
        )
        result = compare_values(
            ParameterRule(
                parameter_code="TEST-001",
                required_stages=("PD", "RD"),
                expected_value="Есть",
                actual_value="Нет",
            ),
            completeness,
        )
        self.assertEqual(result.status, "NOT_COMPARABLE")
        self.assertIn("Нарушение не создаётся", result.rationale)

    def test_equal_normalized_values_are_negative_verified(self) -> None:
        completeness = evaluate_completeness(
            (
                DocumentRecord(file_id="PD-1", stage="PD", sha256="a"),
                DocumentRecord(file_id="RD-1", stage="RD", sha256="b"),
            )
        )
        result = compare_values(
            ParameterRule(
                parameter_code="TEST-002",
                required_stages=("PD", "RD"),
                expected_value="  Предусмотрено  ",
                actual_value="предусмотрено",
            ),
            completeness,
        )
        self.assertEqual(result.status, "NEGATIVE_VERIFIED")

    def test_different_values_are_only_an_ai_candidate(self) -> None:
        completeness = evaluate_completeness(
            (
                DocumentRecord(file_id="PD-1", stage="PD", sha256="a"),
                DocumentRecord(file_id="RD-1", stage="RD", sha256="b"),
            )
        )
        result = compare_values(
            ParameterRule(
                parameter_code="TEST-003",
                required_stages=("PD", "RD"),
                expected_value="Предусмотрено",
                actual_value="Отсутствует",
            ),
            completeness,
        )
        self.assertEqual(result.status, "CANDIDATE")

    def test_rejects_unknown_durable_envelope_version(self) -> None:
        with self.assertRaisesRegex(ValueError, "schema_version"):
            validate_envelope({"schema_version": "2.0"})

    def test_durable_worker_reuses_claim_attempt_for_complete(self) -> None:
        envelope = {
            "schema_version": "1.0",
            "event_id": "event-1",
            "event_type": "job.ready",
            "organization_id": "org-1",
            "object_id": "object-1",
            "inspection_id": "inspection-1",
            "run_id": "run-1",
            "job_id": "job-1",
            "job_type": "ANALYSIS_SEAL_UNSUPPORTED",
            "scope_type": "ANALYSIS",
            "input_manifest_hash": "a" * 64,
            "semantic_key": "b" * 64,
            "release_id": "rules:test",
        }
        responses = [
            {
                "status": "ACQUIRED",
                "lease": {"attemptId": "attempt-1", "fencingToken": 7},
            },
            {"status": "COMPLETED", "replayed": False},
        ]
        with patch("inspector_worker.main.post_with_retry", side_effect=responses) as post:
            result = execute_durable_job(envelope)

        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(post.call_args_list[1].args[0:2], ("job-1", "complete"))
        self.assertEqual(post.call_args_list[1].args[2]["attemptId"], "attempt-1")
        self.assertEqual(post.call_args_list[1].args[2]["fencingToken"], 7)

    def test_inventory_job_counts_immutable_manifest_refs(self) -> None:
        envelope = {
            "schema_version": "1.0",
            "event_id": "event-inventory",
            "event_type": "job.ready",
            "run_id": "run-1",
            "job_id": "job-inventory",
            "job_type": "ANALYSIS_INVENTORY",
            "scope_type": "ANALYSIS",
            "input_manifest_hash": "a" * 64,
        }
        responses = [
            {
                "status": "ACQUIRED",
                "lease": {
                    "attemptId": "attempt-inventory",
                    "fencingToken": 1,
                    "inputs": {
                        "sourceFiles": [
                            {"sourceFileId": "FILE-1", "sha256": "b" * 64, "stages": ["PD", "RD"]},
                            {"sourceFileId": "FILE-2", "sha256": "c" * 64, "stages": ["ID"]},
                        ]
                    },
                },
            },
            {"status": "COMPLETED", "replayed": False},
        ]
        with patch("inspector_worker.main.post_with_retry", side_effect=responses) as post:
            result = execute_durable_job(envelope)

        self.assertEqual(result["status"], "COMPLETED")
        completion = post.call_args_list[1].args[2]["result"]
        self.assertEqual(completion["disposition"], "MANIFEST_INVENTORIED")
        self.assertEqual(completion["sourceCount"], 2)
        self.assertEqual(completion["stageCounts"], {"PD": 1, "RD": 1, "ID": 1})

    def test_document_text_job_completes_with_fenced_artifacts(self) -> None:
        envelope = {
            "schema_version": "1.0",
            "event_id": "event-text",
            "event_type": "job.ready",
            "run_id": "run-1",
            "job_id": "job-text",
            "job_type": "DOCUMENT_TEXT_LAYER",
            "scope_type": "ANALYSIS",
            "input_manifest_hash": "a" * 64,
        }
        lease = {
            "attemptId": "attempt-text",
            "fencingToken": 4,
            "inputs": {"sourceFiles": [{"sourceFileId": "FILE-1"}]},
        }
        extracted = {
            "disposition": "DOCUMENT_TEXT_LAYER_COMPLETED",
            "sources": [{"sourceFileId": "FILE-1", "status": "EXTRACTED"}],
        }
        with (
            patch("inspector_worker.main.post_with_retry", side_effect=[
                {"status": "ACQUIRED", "lease": lease},
                {"status": "COMPLETED", "replayed": False},
            ]) as post,
            patch("inspector_worker.main.process_document_text_layer", return_value=extracted) as process,
        ):
            result = execute_durable_job(envelope)

        self.assertEqual(result["status"], "COMPLETED")
        process.assert_called_once_with(
            lease,
            {"attemptId": "attempt-text", "fencingToken": 4},
            process.call_args.args[2],
        )
        self.assertEqual(post.call_args_list[1].args[2]["result"], extracted)

    def test_document_input_failure_uses_server_retry_policy(self) -> None:
        envelope = {
            "schema_version": "1.0",
            "event_id": "event-text-failure",
            "event_type": "job.ready",
            "run_id": "run-1",
            "job_id": "job-text",
            "job_type": "DOCUMENT_TEXT_LAYER",
            "scope_type": "ANALYSIS",
            "input_manifest_hash": "a" * 64,
        }
        with (
            patch("inspector_worker.main.post_with_retry", side_effect=[
                {"status": "ACQUIRED", "lease": {"attemptId": "attempt-text", "fencingToken": 4}},
                {"status": "RETRY_SCHEDULED"},
            ]) as post,
            patch(
                "inspector_worker.main.process_document_text_layer",
                side_effect=InputDownloadError("temporary storage failure"),
            ),
        ):
            result = execute_durable_job(envelope)

        self.assertEqual(result["status"], "RETRY_SCHEDULED")
        failure = post.call_args_list[1].args[2]
        self.assertEqual(failure["errorCode"], "TRANSIENT_STORAGE")
        self.assertTrue(failure["retryableHint"])

    def test_heartbeat_loop_extends_current_attempt(self) -> None:
        called = Event()

        def extend(_job_id: str, _command: str, _payload: dict[str, object]) -> dict[str, object]:
            called.set()
            return {"status": "LEASE_EXTENDED", "leaseUntil": "2026-09-18T10:00:00Z"}

        with patch("inspector_worker.main.post_with_retry", side_effect=extend) as post:
            heartbeat = LeaseHeartbeat(
                "job-1",
                {"attemptId": "attempt-1", "fencingToken": 7},
                interval_seconds=0.001,
            )
            heartbeat.start()
            self.assertTrue(called.wait(timeout=1))
            heartbeat.stop()
            heartbeat.raise_if_failed()

        self.assertEqual(post.call_args_list[0].args[0:2], ("job-1", "heartbeat"))
        self.assertEqual(post.call_args_list[0].args[2]["fencingToken"], 7)

    def test_heartbeat_stops_work_after_server_cancellation(self) -> None:
        called = Event()

        def cancel(_job_id: str, _command: str, _payload: dict[str, object]) -> dict[str, object]:
            called.set()
            return {"status": "ALREADY_TERMINAL", "state": "CANCELLED"}

        with patch("inspector_worker.main.post_with_retry", side_effect=cancel):
            heartbeat = LeaseHeartbeat(
                "job-1",
                {"attemptId": "attempt-1", "fencingToken": 7},
                interval_seconds=0.001,
            )
            heartbeat.start()
            self.assertTrue(called.wait(timeout=1))
            heartbeat.stop()
            with self.assertRaisesRegex(LeaseLostError, "CANCELLED"):
                heartbeat.raise_if_failed()


if __name__ == "__main__":
    unittest.main()
