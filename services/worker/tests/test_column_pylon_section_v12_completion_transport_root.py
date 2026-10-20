"""Finite worker transport/control expectations; no semantic validator mocks claimed."""
import copy
import json
import os
import unittest
from unittest.mock import patch

from inspector_worker import main

ATTEMPT = {"attemptId": "attempt-test", "fencingToken": 7}
PROFILE = "matrix-text-facts-column-pylon-section-v12"
COMMAND = "complete-column-pylon-section-v12"


def lease():
    return {
        **ATTEMPT,
        "release": {
            "providerSlot": {"profileId": PROFILE, "adapterVersion": "12"},
            "rules": {
                "executionStatus": "PILOT",
                "matrixDefinitions": {"columnPylonSectionExecution": {
                    "schemaVersion": "matrix-column-pylon-section-comparisons-v1",
                    "durableWrapperVersion": "matrix-column-pylon-section-durable-v12",
                }},
            },
        },
    }


def envelope(kind):
    return {"schema_version": "1.0", "event_id": "event", "event_type": "job.ready",
            "scope_type": "ANALYSIS", "job_id": "job", "job_type": kind,
            "run_id": "run", "input_manifest_hash": "a" * 64}


class Response:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def read(self, *_):
        return b'{"status":"COMPLETED"}'


class ColumnPylonCompletionTransportTests(unittest.TestCase):
    def test_existing_complete_url_and_bytes_with_explicit_fixed_sixty_seconds(self):
        payload = {**ATTEMPT, "result": {"raw": "КР 🚧", "bbox": [0.25, 0.5]}}
        with patch.dict(os.environ, {"INSPECTOR_API_INTERNAL_URL": "http://unit/api/internal/v1",
                                     "INTERNAL_WORKER_TOKEN": "unit-only"}), \
                patch.object(main.urllib.request, "urlopen", return_value=Response()) as opened:
            self.assertEqual(main.post_worker_command("job", COMMAND, payload), {"status": "COMPLETED"})
            request = opened.call_args.args[0]
            self.assertEqual(request.full_url, "http://unit/api/internal/v1/jobs/job/complete")
            self.assertEqual(request.data, json.dumps(payload).encode("utf-8"))
            self.assertEqual(request.get_header("X-worker-token"), "unit-only")
            self.assertEqual(opened.call_args.kwargs, {"timeout": 60})
            main.post_worker_command("job", "complete", payload)
            self.assertEqual(opened.call_args.kwargs, {"timeout": 15})

    def exercise(self, current, kind, heartbeat_status="LEASE_EXTENDED", background_failed=False):
        calls = []

        def post(job, command, payload):
            calls.append((job, command, copy.deepcopy(payload)))
            if command == "claim":
                return {"status": "ACQUIRED", "lease": current}
            return {"status": heartbeat_status if command == "heartbeat" else "COMPLETED"}

        with patch.object(main, "post_with_retry", side_effect=post), \
                patch.object(main, "LeaseHeartbeat") as background, \
                patch.object(main.DEFAULT_STAGE_PROVIDER_REGISTRY, "execute", return_value={"sentinel": "stage"}), \
                patch.object(main, "inventory_manifest", return_value={"sentinel": "inventory"}):
            if background_failed:
                background.return_value.raise_if_failed.side_effect = main.LeaseLostError("background lost lease")
            try:
                value = main.execute_durable_job(envelope(kind))
            except main.LeaseLostError:
                value = "LEASE_LOST"
            background.return_value.stop.assert_called_once()
        return value, calls

    def test_current_claim_v12_rule_and_seal_refresh_before_bounded_completion(self):
        for kind in ("RULE_EVALUATION", "ANALYSIS_SEAL_UNSUPPORTED"):
            with self.subTest(kind=kind):
                current = lease()
                if kind == "ANALYSIS_SEAL_UNSUPPORTED":
                    current["release"]["providerSlot"] = None
                before = copy.deepcopy(current)
                value, calls = self.exercise(current, kind)
                self.assertEqual(value, {"status": "COMPLETED"})
                self.assertEqual([x[1] for x in calls], ["claim", "heartbeat", COMMAND])
                self.assertEqual(calls[1][2], ATTEMPT)
                result = {"disposition": "UNSUPPORTED_COVERAGE_SEALED", "workerId": os.environ.get("WORKER_ID", f"worker-{os.getpid()}")} if kind == "ANALYSIS_SEAL_UNSUPPORTED" else {"sentinel": "stage"}
                self.assertEqual(calls[2][2], {**ATTEMPT, "result": result})
                self.assertEqual(current, before)

    def test_old_or_missing_markers_and_other_jobs_keep_existing_control_path(self):
        cases = []
        for path, value in [
            (("release", "providerSlot", "profileId"), "matrix-text-facts-steel-comparison-v11"),
            (("release", "providerSlot", "adapterVersion"), "11"),
            (("release", "rules", "executionStatus"), "UNCONFIGURED"),
            (("release", "rules", "matrixDefinitions", "columnPylonSectionExecution", "schemaVersion"), "old"),
            (("release", "rules", "matrixDefinitions", "columnPylonSectionExecution", "durableWrapperVersion"), "old"),
        ]:
            current = lease()
            node = current
            for key in path[:-1]:
                node = node[key]
            node[path[-1]] = value
            cases.append((current, "RULE_EVALUATION"))
        cases.extend([({**ATTEMPT}, "RULE_EVALUATION"), ({**ATTEMPT}, "ANALYSIS_SEAL_UNSUPPORTED"),
                      (lease(), "ENTITY_EXTRACTION"), (lease(), "EVIDENCE_VALIDATION"),
                      (lease(), "ANALYSIS_INVENTORY")])
        for current, kind in cases:
            with self.subTest(kind=kind, current=current):
                value, calls = self.exercise(current, kind)
                self.assertEqual(value, {"status": "COMPLETED"})
                self.assertEqual([x[1] for x in calls], ["claim", "complete"])

    def test_lost_final_or_background_lease_never_posts_completion(self):
        for status in ("STALE_ATTEMPT", "ALREADY_TERMINAL", "UNKNOWN"):
            with self.subTest(status=status):
                value, calls = self.exercise(lease(), "RULE_EVALUATION", status)
                self.assertEqual(value, "LEASE_LOST")
                self.assertEqual([x[1] for x in calls], ["claim", "heartbeat"])
        value, calls = self.exercise(lease(), "RULE_EVALUATION", background_failed=True)
        self.assertEqual(value, "LEASE_LOST")
        self.assertEqual([x[1] for x in calls], ["claim"])

    def test_alias_uses_existing_finite_retry_schedule(self):
        with patch.object(main, "post_worker_command", side_effect=[main.WorkerControlError("one"), main.WorkerControlError("two"), {"status": "COMPLETED"}]) as post, patch.object(main.time, "sleep") as sleep:
            payload = {**ATTEMPT, "result": {}}
            self.assertEqual(main.post_with_retry("job", COMMAND, payload), {"status": "COMPLETED"})
            self.assertEqual(post.call_count, 3)
            self.assertEqual([c.args for c in sleep.call_args_list], [(0.25,), (1.0,)])
            self.assertTrue(all(c.args == ("job", COMMAND, payload) for c in post.call_args_list))


if __name__ == "__main__":
    unittest.main()
