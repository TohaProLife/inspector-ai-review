"""Dedicated, opt-in ZU-127 v3 durable queue consumer.

This consumer has no public-file identity constants and never subscribes to
``rules.evaluate``. The API must route an immutable v3 release to its dedicated
queue and independently replay the result before accepting completion.
"""

from __future__ import annotations

import argparse
import json
import os
import threading
import time
from typing import Any

from . import main as worker_runtime
from .poppler_page_evidence import _version
from .text_layer import InputDownloadError
from .zu127_generic_stage_v3 import evaluate_fenced_zu127_generic_stage_v3


SPECIALIST_QUEUE = "rules.evaluate.zu127.poppler-v3"
SPECIALIST_JOB_TYPE = "RULE_EVALUATION"


def claim_payload(worker_id: str) -> dict[str, object]:
    if not isinstance(worker_id, str) or not worker_id.strip():
        raise ValueError("ZU-127 v3 worker identity required")
    return {"workerId": worker_id, "capabilities": [SPECIALIST_JOB_TYPE],
            "queueName": SPECIALIST_QUEUE}


def verify_runtime() -> None:
    """Refuse a different Poppler build before subscribing to RabbitMQ."""
    _version("pdftotext")
    _version("pdfinfo")


def _check_claim_scope(envelope: dict[str, Any], lease: dict[str, Any]) -> None:
    if (lease.get("jobId") != envelope["job_id"]
            or lease.get("jobType") != SPECIALIST_JOB_TYPE
            or lease.get("runId") != envelope["run_id"]
            or lease.get("inputManifestHash") != envelope["input_manifest_hash"]
            or lease.get("releaseId") != envelope.get("release_id")
            or not isinstance(lease.get("attemptId"), str)
            or not lease["attemptId"]
            or type(lease.get("fencingToken")) is not int
            or lease["fencingToken"] < 1):
        raise ValueError("ZU-127 v3 queue envelope and fenced lease disagree")


def _settled_response(response: dict[str, Any], allowed: set[str]) -> dict[str, Any]:
    if response.get("status") not in allowed:
        raise worker_runtime.WorkerControlError("ZU-127 v3 durable command not settled")
    return response


def execute_durable_job(envelope: dict[str, Any]) -> dict[str, Any]:
    """Claim exact queue, run fenced stage, then commit through durable API."""
    worker_runtime.validate_envelope(envelope)
    if envelope.get("job_type") != SPECIALIST_JOB_TYPE or not envelope.get("release_id"):
        raise ValueError("ZU-127 v3 requires RULE_EVALUATION release envelope")
    job_id = envelope["job_id"]
    worker_id = os.environ.get("WORKER_ID", f"zu127-v3-{os.getpid()}")
    claim = worker_runtime.post_with_retry(job_id, "claim", claim_payload(worker_id))
    if claim.get("status") != "ACQUIRED":
        return _settled_response(claim, {"ALREADY_TERMINAL", "NOT_READY", "CAPABILITY_MISMATCH"})
    lease = claim.get("lease")
    if not isinstance(lease, dict):
        raise worker_runtime.WorkerControlError("ZU-127 v3 claim returned no lease")
    attempt = {"attemptId": lease.get("attemptId"),
               "fencingToken": lease.get("fencingToken")}
    heartbeat = worker_runtime.LeaseHeartbeat(
        job_id, attempt, worker_runtime.worker_heartbeat_interval())
    heartbeat.start()
    try:
        _check_claim_scope(envelope, lease)
        result = evaluate_fenced_zu127_generic_stage_v3(lease, attempt)
        if (result.get("status") != "ABSTAIN"
                or result.get("purpose") != "REVIEW_ONLY"
                or result.get("findings") is not None
                or result.get("parameterCoverage") is not None):
            raise ValueError("ZU-127 v3 stage cannot assert findings or coverage")
    except InputDownloadError as error:
        heartbeat.stop()
        heartbeat.raise_if_failed()
        response = worker_runtime.post_with_retry(job_id, "fail", {
            **attempt, "errorCode": "TRANSIENT_STORAGE",
            "message": str(error)[:2000], "retryableHint": True,
        })
        return _settled_response(response, {"RETRY_SCHEDULED", "FAILED", "ALREADY_TERMINAL"})
    except worker_runtime.WorkerControlError:
        heartbeat.stop()
        heartbeat.raise_if_failed()
        raise
    except Exception as error:
        heartbeat.stop()
        heartbeat.raise_if_failed()
        response = worker_runtime.post_with_retry(job_id, "fail", {
            **attempt, "errorCode": "WORKER_EXECUTION_ERROR",
            "message": str(error)[:2000], "retryableHint": False,
        })
        return _settled_response(response, {"FAILED", "ALREADY_TERMINAL"})
    heartbeat.stop()
    heartbeat.raise_if_failed()
    response = worker_runtime.post_with_retry(job_id, "complete", {
        **attempt, "result": result,
    })
    return _settled_response(response, {"COMPLETED", "ALREADY_TERMINAL"})


def dispatch_delivery(connection: Any, channel: Any, delivery_tag: int,
                      body: bytes) -> threading.Thread:
    """Run work off Pika's connection thread; settle delivery on that thread."""
    def run() -> None:
        disposition = "ack"
        try:
            envelope = json.loads(body)
            if not isinstance(envelope, dict):
                raise ValueError("ZU-127 v3 queue envelope must be an object")
            response = execute_durable_job(envelope)
            print(json.dumps({"status": response["status"]}), flush=True)
        except ValueError:
            disposition = "reject"
        except Exception:
            disposition = "retry"

        def settle() -> None:
            if not channel.is_open:
                return
            if disposition == "ack":
                channel.basic_ack(delivery_tag=delivery_tag)
            else:
                channel.basic_nack(delivery_tag=delivery_tag,
                                   requeue=disposition == "retry")

        try:
            connection.add_callback_threadsafe(settle)
        except Exception:
            # Unacknowledged delivery will return after connection loss.
            pass

    thread = threading.Thread(target=run, name=f"zu127-v3-{delivery_tag}",
                              daemon=True)
    thread.start()
    return thread


def consume_rabbitmq() -> None:
    import pika

    connection = None
    channel = None
    last_error = None
    for _attempt in range(30):
        try:
            connection = pika.BlockingConnection(
                pika.URLParameters(os.environ["RABBITMQ_URL"]))
            channel = connection.channel()
            channel.queue_declare(queue=SPECIALIST_QUEUE, passive=True)
            break
        except pika.exceptions.AMQPError as error:
            last_error = error
            if connection and connection.is_open:
                connection.close()
            time.sleep(2)
    if connection is None or channel is None or not channel.is_open:
        raise RuntimeError(f"ZU-127 v3 queue unavailable: {last_error}")
    channel.basic_qos(prefetch_count=1)

    def on_message(ch: Any, method: Any, _properties: Any, body: bytes) -> None:
        dispatch_delivery(connection, ch, method.delivery_tag, body)

    channel.basic_consume(queue=SPECIALIST_QUEUE, on_message_callback=on_message)
    channel.start_consuming()


def main() -> None:
    parser = argparse.ArgumentParser(description="Dedicated ZU-127 v3 review consumer")
    parser.add_argument("--check", action="store_true", help="Pinned Poppler preflight only")
    args = parser.parse_args()
    verify_runtime()
    if args.check:
        return
    for name in ("RABBITMQ_URL", "INSPECTOR_API_INTERNAL_URL", "INTERNAL_WORKER_TOKEN"):
        if not os.environ.get(name):
            parser.error(f"{name} is required")
    worker_runtime.worker_heartbeat_interval()
    consume_rabbitmq()


if __name__ == "__main__":
    main()
