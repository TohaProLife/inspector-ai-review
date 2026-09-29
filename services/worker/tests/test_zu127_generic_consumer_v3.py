"""Dedicated ZU-127 v3 queue and durable fencing tests."""

from __future__ import annotations

import copy
import json
import sys
import unittest
from unittest.mock import MagicMock, patch

from inspector_worker.main import WorkerControlError
from inspector_worker.text_layer import InputDownloadError
from inspector_worker.zu127_generic_consumer_v3 import (
    SPECIALIST_QUEUE, claim_payload, dispatch_delivery, execute_durable_job,
    main, verify_runtime,
)


ENVELOPE = {
    "schema_version": "1.0", "event_id": "event-1", "event_type": "job.ready",
    "scope_type": "ANALYSIS", "job_id": "job-1", "job_type": "RULE_EVALUATION",
    "run_id": "run-1", "input_manifest_hash": "a" * 64,
    "release_id": "release-1",
}
LEASE = {
    "jobId": "job-1", "jobType": "RULE_EVALUATION", "runId": "run-1",
    "inputManifestHash": "a" * 64, "releaseId": "release-1",
    "attemptId": "attempt-1", "fencingToken": 7,
}
ABSTAIN = {
    "status": "ABSTAIN", "purpose": "REVIEW_ONLY", "findings": None,
    "parameterCoverage": None,
}


class Zu127GenericConsumerV3Tests(unittest.TestCase):
    def test_exact_dedicated_claim_and_preflight(self) -> None:
        self.assertEqual(SPECIALIST_QUEUE, "rules.evaluate.zu127.poppler-v3")
        self.assertEqual(claim_payload("worker-1"), {
            "workerId": "worker-1", "capabilities": ["RULE_EVALUATION"],
            "queueName": SPECIALIST_QUEUE,
        })
        with self.assertRaises(ValueError):
            claim_payload(" ")
        with patch("inspector_worker.zu127_generic_consumer_v3._version") as version:
            verify_runtime()
        self.assertEqual([entry.args[0] for entry in version.call_args_list],
                         ["pdftotext", "pdfinfo"])
        with patch.object(sys, "argv", ["zu127-v3", "--check"]), \
             patch("inspector_worker.zu127_generic_consumer_v3.verify_runtime"), \
             patch("inspector_worker.zu127_generic_consumer_v3.consume_rabbitmq") as consume:
            main()
        consume.assert_not_called()

    def test_fenced_result_completed_on_dedicated_queue(self) -> None:
        heartbeat = MagicMock()
        with patch("inspector_worker.zu127_generic_consumer_v3.worker_runtime.post_with_retry",
                   side_effect=[{"status": "ACQUIRED", "lease": copy.deepcopy(LEASE)},
                                {"status": "COMPLETED"}]) as post, \
             patch("inspector_worker.zu127_generic_consumer_v3.worker_runtime.LeaseHeartbeat",
                   return_value=heartbeat), \
             patch("inspector_worker.zu127_generic_consumer_v3."
                   "evaluate_fenced_zu127_generic_stage_v3",
                   return_value=ABSTAIN) as evaluate:
            self.assertEqual(execute_durable_job(copy.deepcopy(ENVELOPE))["status"],
                             "COMPLETED")
        self.assertEqual(post.call_args_list[0].args[0:2], ("job-1", "claim"))
        self.assertEqual(post.call_args_list[0].args[2]["queueName"], SPECIALIST_QUEUE)
        evaluate.assert_called_once_with(LEASE, {"attemptId": "attempt-1",
                                                 "fencingToken": 7})
        self.assertEqual(post.call_args_list[1].args[0:2], ("job-1", "complete"))
        self.assertEqual(post.call_args_list[1].args[2]["result"], ABSTAIN)
        heartbeat.start.assert_called_once_with()
        heartbeat.stop.assert_called_once_with()
        heartbeat.raise_if_failed.assert_called_once_with()

    def test_duplicate_delivery_never_evaluates_without_lease(self) -> None:
        with patch("inspector_worker.zu127_generic_consumer_v3.worker_runtime.post_with_retry",
                   return_value={"status": "NOT_READY"}) as post, \
             patch("inspector_worker.zu127_generic_consumer_v3."
                   "evaluate_fenced_zu127_generic_stage_v3") as evaluate:
            self.assertEqual(execute_durable_job(copy.deepcopy(ENVELOPE))["status"],
                             "NOT_READY")
        post.assert_called_once()
        evaluate.assert_not_called()

    def test_wrong_envelope_rejected_before_claim(self) -> None:
        for mutation in ("job_type", "release_id", "schema_version"):
            current = copy.deepcopy(ENVELOPE)
            current[mutation] = None if mutation == "release_id" else "wrong"
            with self.subTest(mutation=mutation), \
                 patch("inspector_worker.zu127_generic_consumer_v3.worker_runtime.post_with_retry") as post, \
                 self.assertRaises(ValueError):
                execute_durable_job(current)
            post.assert_not_called()

    def test_claim_lease_scope_mismatch_fails_without_evaluation(self) -> None:
        for mutation in ("runId", "inputManifestHash", "releaseId", "fencingToken"):
            lease = copy.deepcopy(LEASE)
            lease[mutation] = "wrong"
            with self.subTest(mutation=mutation), \
                 patch("inspector_worker.zu127_generic_consumer_v3.worker_runtime.LeaseHeartbeat"), \
                 patch("inspector_worker.zu127_generic_consumer_v3."
                       "evaluate_fenced_zu127_generic_stage_v3") as evaluate, \
                 patch("inspector_worker.zu127_generic_consumer_v3.worker_runtime.post_with_retry",
                       side_effect=[{"status": "ACQUIRED", "lease": lease},
                                    {"status": "FAILED"}]) as post:
                self.assertEqual(execute_durable_job(copy.deepcopy(ENVELOPE))["status"],
                                 "FAILED")
                evaluate.assert_not_called()
                self.assertEqual(post.call_args_list[1].args[1], "fail")
                self.assertEqual(post.call_args_list[1].args[2]["retryableHint"], False)

    def test_transient_download_fails_retryable_but_control_outage_requeues(self) -> None:
        for error, expected in ((InputDownloadError("storage timeout"), "RETRY_SCHEDULED"),
                                (WorkerControlError("API down"), "exception")):
            responses = [{"status": "ACQUIRED", "lease": copy.deepcopy(LEASE)}]
            if expected != "exception":
                responses.append({"status": expected})
            with self.subTest(expected=expected), \
                 patch("inspector_worker.zu127_generic_consumer_v3.worker_runtime.LeaseHeartbeat"), \
                 patch("inspector_worker.zu127_generic_consumer_v3."
                       "evaluate_fenced_zu127_generic_stage_v3", side_effect=error), \
                 patch("inspector_worker.zu127_generic_consumer_v3.worker_runtime.post_with_retry",
                       side_effect=responses) as post:
                if expected == "exception":
                    with self.assertRaises(WorkerControlError):
                        execute_durable_job(copy.deepcopy(ENVELOPE))
                    self.assertEqual(post.call_count, 1)
                else:
                    self.assertEqual(execute_durable_job(copy.deepcopy(ENVELOPE))["status"],
                                     expected)
                    self.assertEqual(post.call_args_list[1].args[1], "fail")
                    self.assertEqual(post.call_args_list[1].args[2]["retryableHint"], True)

    def test_positive_claim_from_stage_is_not_completed(self) -> None:
        with patch("inspector_worker.zu127_generic_consumer_v3.worker_runtime.LeaseHeartbeat"), \
             patch("inspector_worker.zu127_generic_consumer_v3."
                   "evaluate_fenced_zu127_generic_stage_v3",
                   return_value={**ABSTAIN, "findings": []}), \
             patch("inspector_worker.zu127_generic_consumer_v3.worker_runtime.post_with_retry",
                   side_effect=[{"status": "ACQUIRED", "lease": copy.deepcopy(LEASE)},
                                {"status": "FAILED"}]) as post:
            self.assertEqual(execute_durable_job(copy.deepcopy(ENVELOPE))["status"],
                             "FAILED")
        self.assertEqual(post.call_args_list[1].args[1], "fail")
        self.assertEqual(post.call_args_list[1].args[2]["retryableHint"], False)

    def test_unsettled_complete_requeues_delivery(self) -> None:
        with patch("inspector_worker.zu127_generic_consumer_v3.worker_runtime.LeaseHeartbeat"), \
             patch("inspector_worker.zu127_generic_consumer_v3."
                   "evaluate_fenced_zu127_generic_stage_v3", return_value=ABSTAIN), \
             patch("inspector_worker.zu127_generic_consumer_v3.worker_runtime.post_with_retry",
                   side_effect=[{"status": "ACQUIRED", "lease": copy.deepcopy(LEASE)},
                                {"status": "UNKNOWN"}]):
            with self.assertRaises(WorkerControlError):
                execute_durable_job(copy.deepcopy(ENVELOPE))

    def test_rabbit_settles_after_durable_response_only(self) -> None:
        connection = MagicMock()
        connection.add_callback_threadsafe.side_effect = lambda callback: callback()
        channel = MagicMock(is_open=True)
        method = {"status": "COMPLETED"}
        with patch("inspector_worker.zu127_generic_consumer_v3.execute_durable_job",
                   return_value=method):
            thread = dispatch_delivery(connection, channel, 17,
                                       json.dumps(ENVELOPE).encode())
            thread.join(timeout=2)
        self.assertFalse(thread.is_alive())
        channel.basic_ack.assert_called_once_with(delivery_tag=17)
        channel.basic_nack.assert_not_called()

        channel.reset_mock()
        with patch("inspector_worker.zu127_generic_consumer_v3.execute_durable_job",
                   side_effect=WorkerControlError("API down")):
            thread = dispatch_delivery(connection, channel, 18,
                                       json.dumps(ENVELOPE).encode())
            thread.join(timeout=2)
        channel.basic_nack.assert_called_once_with(delivery_tag=18, requeue=True)

        channel.reset_mock()
        thread = dispatch_delivery(connection, channel, 19, b"[]")
        thread.join(timeout=2)
        channel.basic_nack.assert_called_once_with(delivery_tag=19, requeue=False)


if __name__ == "__main__":
    unittest.main()
