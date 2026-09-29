from __future__ import annotations

import argparse
import json
import os
import socket
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from .pipeline import job_from_dict, process_job
from .stage_scaffold import DEFAULT_STAGE_PROVIDER_REGISTRY, SCAFFOLD_JOB_TYPES
from .pilot_rule_adapter import PilotPz002RuleAdapter
from .durable_ocr_layout import BoundedOcrLayoutAdapter
from .visual_proposal_adapter import VisualProposalAdapter
from .text_layer import InputDownloadError, process_document_text_layer


class WorkerControlError(RuntimeError):
    pass


DEFAULT_STAGE_PROVIDER_REGISTRY.register(PilotPz002RuleAdapter())
DEFAULT_STAGE_PROVIDER_REGISTRY.register(BoundedOcrLayoutAdapter())
DEFAULT_STAGE_PROVIDER_REGISTRY.register(VisualProposalAdapter())


class LeaseLostError(WorkerControlError):
    pass


class LeaseHeartbeat:
    def __init__(
        self,
        job_id: str,
        attempt: dict[str, object],
        interval_seconds: float = 20.0,
    ) -> None:
        if interval_seconds <= 0:
            raise ValueError("heartbeat interval must be positive")
        self.job_id = job_id
        self.attempt = attempt
        self.interval_seconds = interval_seconds
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._failure: Exception | None = None

    def start(self) -> None:
        if self._thread is not None:
            raise RuntimeError("heartbeat already started")
        self._thread = threading.Thread(
            target=self._run,
            name=f"lease-heartbeat-{self.job_id}",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join()

    def raise_if_failed(self) -> None:
        if self._failure is not None:
            raise self._failure

    def _run(self) -> None:
        while not self._stop.wait(self.interval_seconds):
            try:
                response = post_with_retry(self.job_id, "heartbeat", self.attempt)
                if response.get("status") != "LEASE_EXTENDED":
                    status = response.get("status", "UNKNOWN")
                    state = response.get("state", "UNKNOWN")
                    raise LeaseLostError(f"heartbeat lost lease: {status}/{state}")
            except Exception as error:
                self._failure = error
                self._stop.set()


def post_worker_command(job_id: str, command: str, payload: dict[str, object]) -> dict[str, object]:
    base_url = os.environ["INSPECTOR_API_INTERNAL_URL"].rstrip("/")
    token = os.environ["INTERNAL_WORKER_TOKEN"]
    request = urllib.request.Request(
        f"{base_url}/jobs/{job_id}/{command}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Worker-Token": token,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise WorkerControlError(f"worker API {command} returned {error.code}: {body[:500]}") from error
    except (urllib.error.URLError, TimeoutError, socket.timeout) as error:
        raise WorkerControlError(f"worker API {command} unavailable: {error}") from error


def post_with_retry(job_id: str, command: str, payload: dict[str, object]) -> dict[str, object]:
    last_error: WorkerControlError | None = None
    for delay in (0.0, 0.25, 1.0):
        if delay:
            time.sleep(delay)
        try:
            return post_worker_command(job_id, command, payload)
        except WorkerControlError as error:
            last_error = error
    raise last_error or WorkerControlError(f"worker API {command} failed")


def validate_envelope(payload: dict[str, object]) -> None:
    if payload.get("schema_version") != "1.0":
        raise ValueError("unsupported job envelope schema_version")
    if payload.get("event_type") != "job.ready" or payload.get("scope_type") != "ANALYSIS":
        raise ValueError("unsupported job envelope type")
    for field in ("event_id", "job_id", "job_type", "run_id", "input_manifest_hash"):
        if not isinstance(payload.get(field), str) or not payload[field]:
            raise ValueError(f"job envelope field {field} is required")


def worker_heartbeat_interval() -> float:
    try:
        interval = float(os.environ.get("WORKER_HEARTBEAT_SECONDS", "20"))
    except ValueError as error:
        raise WorkerControlError("WORKER_HEARTBEAT_SECONDS must be a positive number") from error
    if interval <= 0:
        raise WorkerControlError("WORKER_HEARTBEAT_SECONDS must be a positive number")
    return interval


def inventory_manifest(lease: dict[str, object], worker_id: str) -> dict[str, object]:
    inputs = lease.get("inputs")
    if not isinstance(inputs, dict):
        raise ValueError("inventory lease has no inputs")
    source_files = inputs.get("sourceFiles")
    if not isinstance(source_files, list) or not source_files:
        raise ValueError("inventory lease has no sourceFiles")
    stage_counts = {"PD": 0, "RD": 0, "ID": 0}
    for source in source_files:
        if not isinstance(source, dict):
            raise ValueError("inventory sourceFile must be an object")
        source_file_id = source.get("sourceFileId")
        sha256 = source.get("sha256")
        stages = source.get("stages")
        if not isinstance(source_file_id, str) or not source_file_id:
            raise ValueError("inventory sourceFileId is required")
        if not isinstance(sha256, str) or len(sha256) != 64:
            raise ValueError("inventory source sha256 is invalid")
        if not isinstance(stages, list) or not stages:
            raise ValueError("inventory source stages are required")
        unique_stages = set(stages)
        if not unique_stages.issubset(stage_counts):
            raise ValueError("inventory source contains an unknown stage")
        for stage in unique_stages:
            stage_counts[stage] += 1
    return {
        "disposition": "MANIFEST_INVENTORIED",
        "sourceCount": len(source_files),
        "stageCounts": stage_counts,
        "workerId": worker_id,
    }


def execute_durable_job(payload: dict[str, object]) -> dict[str, object]:
    validate_envelope(payload)
    job_id = str(payload["job_id"])
    job_type = str(payload["job_type"])
    worker_id = os.environ.get("WORKER_ID", f"worker-{os.getpid()}")
    heartbeat_interval = worker_heartbeat_interval()
    claim = post_with_retry(job_id, "claim", {
        "workerId": worker_id,
        "capabilities": [job_type],
    })
    if claim.get("status") != "ACQUIRED":
        return claim
    lease = claim.get("lease")
    if not isinstance(lease, dict):
        raise WorkerControlError("claim response has no lease")
    attempt = {
        "attemptId": lease["attemptId"],
        "fencingToken": lease["fencingToken"],
    }
    heartbeat = LeaseHeartbeat(
        job_id,
        attempt,
        heartbeat_interval,
    )
    heartbeat.start()
    try:
        if job_type == "ANALYSIS_INVENTORY":
            result = inventory_manifest(lease, worker_id)
        elif job_type == "DOCUMENT_TEXT_LAYER":
            result = process_document_text_layer(lease, attempt, worker_id)
        elif job_type in SCAFFOLD_JOB_TYPES:
            result = DEFAULT_STAGE_PROVIDER_REGISTRY.execute(job_type, lease, attempt)
        elif job_type == "ANALYSIS_SEAL_UNSUPPORTED":
            result = {
                "disposition": "UNSUPPORTED_COVERAGE_SEALED",
                "workerId": worker_id,
            }
        else:
            raise ValueError(f"unsupported durable job_type {job_type}")
    except InputDownloadError as error:
        heartbeat.stop()
        heartbeat.raise_if_failed()
        return post_with_retry(job_id, "fail", {
            **attempt,
            "errorCode": "TRANSIENT_STORAGE",
            "message": str(error)[:2000],
            "retryableHint": True,
        })
    except Exception as error:
        heartbeat.stop()
        heartbeat.raise_if_failed()
        return post_with_retry(job_id, "fail", {
            **attempt,
            "errorCode": "WORKER_EXECUTION_ERROR",
            "message": str(error)[:2000],
            "retryableHint": False,
        })
    heartbeat.stop()
    heartbeat.raise_if_failed()
    return post_with_retry(job_id, "complete", {**attempt, "result": result})


def process_file(path: str) -> None:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    print(json.dumps(process_job(job_from_dict(payload)), ensure_ascii=False, indent=2))


def consume_rabbitmq(queue: str) -> None:
    import pika

    connection = None
    channel = None
    last_error = None
    for _attempt in range(30):
        try:
            connection = pika.BlockingConnection(pika.URLParameters(os.environ["RABBITMQ_URL"]))
            channel = connection.channel()
            channel.queue_declare(queue=queue, passive=True)
            break
        except pika.exceptions.AMQPError as error:
            last_error = error
            if connection and connection.is_open:
                connection.close()
            time.sleep(2)
    if connection is None or channel is None or not channel.is_open:
        raise RuntimeError(f"RabbitMQ topology is unavailable: {last_error}")
    channel.basic_qos(prefetch_count=1)

    def on_message(ch, method, _properties, body) -> None:
        dispatch_delivery(connection, ch, method.delivery_tag, body)

    channel.basic_consume(queue=queue, on_message_callback=on_message)
    channel.start_consuming()


def dispatch_delivery(connection, channel, delivery_tag: int, body: bytes) -> threading.Thread:
    """Keep Pika's connection loop free to send heartbeats during long jobs.

    Pika channels are used only by the connection thread. The job thread posts
    its acknowledgement back to that thread after the durable API call ends.
    """

    def run() -> None:
        disposition = "ack"
        try:
            payload = json.loads(body)
            if not isinstance(payload, dict):
                raise ValueError("job envelope must be an object")
            result = execute_durable_job(payload)
            print(json.dumps(result, ensure_ascii=False), flush=True)
        except ValueError as error:
            print(json.dumps({"status": "FAILED", "error": str(error)}, ensure_ascii=False), flush=True)
            disposition = "reject"
        except WorkerControlError as error:
            print(json.dumps({"status": "CONTROL_PLANE_UNAVAILABLE", "error": str(error)}, ensure_ascii=False), flush=True)
            disposition = "retry"
        except Exception as error:
            print(json.dumps({"status": "WORKER_UNEXPECTED_ERROR", "error": str(error)}, ensure_ascii=False), flush=True)
            disposition = "retry"

        def settle() -> None:
            if not channel.is_open:
                return
            if disposition == "ack":
                channel.basic_ack(delivery_tag=delivery_tag)
            else:
                channel.basic_nack(delivery_tag=delivery_tag, requeue=disposition == "retry")

        try:
            connection.add_callback_threadsafe(settle)
        except Exception:
            # RabbitMQ will redeliver an unacknowledged message after the
            # connection closes; the durable API fences duplicate attempts.
            pass

    worker = threading.Thread(target=run, name=f"delivery-{delivery_tag}", daemon=True)
    worker.start()
    return worker


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspector AI document processing worker")
    parser.add_argument("--job", help="Process one JSON job and print the result")
    parser.add_argument("--queue", default="rules.evaluate", help="RabbitMQ queue")
    args = parser.parse_args()
    if args.job:
        process_file(args.job)
        return
    if "RABBITMQ_URL" not in os.environ:
        parser.error("RABBITMQ_URL is required when --job is not used")
    if "INSPECTOR_API_INTERNAL_URL" not in os.environ or "INTERNAL_WORKER_TOKEN" not in os.environ:
        parser.error("INSPECTOR_API_INTERNAL_URL and INTERNAL_WORKER_TOKEN are required")
    worker_heartbeat_interval()
    consume_rabbitmq(args.queue)


if __name__ == "__main__":
    main()
