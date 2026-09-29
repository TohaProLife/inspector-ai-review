"""Synthetic contract checks; fixtures are not public registry evidence."""

from __future__ import annotations

import copy
import hashlib
import json
from datetime import datetime, timedelta, timezone
import unittest

from inspector_worker.external_event_snapshot import evaluate_external_event_chain


NOW = datetime(2026, 9, 28, 12, 0, tzinfo=timezone.utc)
OBJECT = "fixture-object-1"
VEHICLE = "fixture-vehicle-1"
TRIP = "fixture-trip-1"
BATCH = "fixture-batch-1"


def iso(minutes: int = 0) -> str:
    return (NOW + timedelta(minutes=minutes)).isoformat().replace("+00:00", "Z")


def event(kind: str, status: str, **fields: object) -> dict:
    return {"kind": kind, "status": status, "objectId": OBJECT,
            "occurredAt": iso(-80), **fields}


def snapshots() -> list[tuple[bytes, str]]:
    rows = [
        event("WORK_START", "STARTED", occurredAt=iso(-70)),
        event("OSIG_PERMIT", "ACTIVE", permitId="permit-1",
              validFrom=iso(-120), validUntil=iso(120)),
        event("TRIP_CONTEXT", "SCHEDULED", vehicleId=VEHICLE, tripId=TRIP,
              routeId="route-1", startAt=iso(-60), endAt=iso(-20)),
        event("RNIS_REGISTRATION", "REGISTERED", vehicleId=VEHICLE,
              trackerId="tracker-1", validFrom=iso(-120), validUntil=iso(120)),
        event("RNIS_TELEMETRY", "OBSERVED", vehicleId=VEHICLE, tripId=TRIP,
              trackerId="tracker-1", routeId="route-1", occurredAt=iso(-40)),
        event("KPTS_DEPARTURE", "DEPARTED", vehicleId=VEHICLE, tripId=TRIP,
              routeId="route-1", qrId="qr-1", occurredAt=iso(-55)),
        event("WASTE_TRANSFER", "TRANSFERRED", vehicleId=VEHICLE, tripId=TRIP,
              batchId=BATCH, massKg=1000, wasteClass="IV", routeId="route-1",
              recipientId="recipient-1", occurredAt=iso(-50)),
        event("WASTE_ACCEPTANCE", "ACCEPTED", vehicleId=VEHICLE, tripId=TRIP,
              batchId=BATCH, massKg=1000, wasteClass="IV", routeId="route-1",
              recipientId="recipient-1", facilityId="facility-1",
              licenseId="license-1", occurredAt=iso(-30)),
        event("FACILITY_LICENSE", "VALID", recipientId="recipient-1",
              facilityId="facility-1", licenseId="license-1",
              wasteClass="IV", validFrom=iso(-120), validUntil=iso(120)),
    ]
    systems = ["WORK_LOG", "OSIG", "DISPATCH", "RNIS", "RNIS", "MOBILE_KPTS",
               "TRANSFER", "ACCEPTANCE", "GROO"]
    result = []
    for index, (row, system) in enumerate(zip(rows, systems, strict=True)):
        payload = {"schemaVersion": "external-event-snapshot-v1",
                   "snapshotId": f"fixture-snapshot-{index}", "system": system,
                   "systemVersion": "fixture-export-1", "capturedAt": iso(-5),
                   "authority": {"mode": "SIGNED", "issuerId": "fixture-issuer",
                                 "signature": "fixture-signature"}, "event": row}
        raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        result.append((raw, hashlib.sha256(raw).hexdigest()))
    return result


def trusted_fixture_only(raw: bytes, payload: dict) -> bool:
    return payload["authority"]["signature"] == "fixture-signature"


def evaluate(rows: list[tuple[bytes, str]], *, verifier=trusted_fixture_only) -> dict:
    return evaluate_external_event_chain(
        object_id=OBJECT, vehicle_id=VEHICLE, trip_id=TRIP, batch_id=BATCH,
        evaluated_at=iso(), snapshots=rows, authority_verifier=verifier,
        fixture_only=True)


def statuses(result: dict) -> dict[str, str]:
    return {row["parameterCode"]: row["chainStatus"] for row in result["codeRows"]}


def change(rows: list[tuple[bytes, str]], index: int, **fields: object) -> list[tuple[bytes, str]]:
    updated = copy.deepcopy(rows)
    payload = json.loads(updated[index][0])
    payload["event"].update(fields)
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    updated[index] = raw, hashlib.sha256(raw).hexdigest()
    return updated


def check_synthetic_linkage_is_review_only_and_not_coverage() -> None:
    result = evaluate(snapshots())
    assert set(statuses(result).values()) == {"LINKED_INPUTS_REVIEW_ONLY"}
    assert result["purpose"] == "REVIEW_ONLY"
    assert result["findingCount"] is None
    assert result["parameterCoverage"] is None
    assert all(row["status"] == "ABSTAIN" for row in result["codeRows"])
    assert all(row["fixtureOnly"] is True for row in result["codeRows"])


def check_tampered_source_bytes_rejected_even_if_metadata_unchanged() -> None:
    rows = snapshots()
    raw, digest = rows[1]
    rows[1] = raw.replace(b"permit-1", b"permit-2"), digest
    assert statuses(evaluate(rows))["OOS-098"] == "UNVERIFIED"


def check_authority_missing_or_rejected_fails_closed() -> None:
    assert set(statuses(evaluate(snapshots(), verifier=None)).values()) == {"UNVERIFIED"}
    assert set(statuses(evaluate(snapshots(), verifier=lambda raw, payload: False)).values()) == {"UNVERIFIED"}


def check_cross_object_trip_and_vehicle_cannot_link() -> None:
    rows = change(snapshots(), 1, objectId="other-object")
    assert statuses(evaluate(rows))["OOS-098"] == "UNVERIFIED"
    rows = change(snapshots(), 4, tripId="other-trip")
    assert statuses(evaluate(rows))["OOS-099"] == "PARTIAL_CHAIN"
    rows = change(snapshots(), 5, vehicleId="other-vehicle")
    assert statuses(evaluate(rows))["OOS-100"] == "PARTIAL_CHAIN"


def check_stale_snapshot_and_expired_license_fail_closed() -> None:
    rows = snapshots()
    payload = json.loads(rows[7][0])
    payload["capturedAt"] = iso(-1500)
    payload["event"]["occurredAt"] = iso(-1600)
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    rows[7] = raw, hashlib.sha256(raw).hexdigest()
    assert statuses(evaluate(rows))["OOS-101"] == "EXPIRED"
    rows = change(snapshots(), 8, validUntil=iso(-31))
    assert statuses(evaluate(rows))["OOS-101"] == "EXPIRED"


def check_missing_segments_and_unknown_status_abstain() -> None:
    rows = snapshots()
    assert statuses(evaluate(rows[:2]))["OOS-099"] == "NOT_PROVIDED"
    assert statuses(evaluate(rows[:7] + rows[8:]))["OOS-101"] == "PARTIAL_CHAIN"
    rows = change(snapshots(), 5, status="UNKNOWN")
    assert statuses(evaluate(rows))["OOS-100"] == "UNVERIFIED"


def check_wrong_time_and_route_fail_closed() -> None:
    rows = change(snapshots(), 4, occurredAt=iso(-5))
    assert statuses(evaluate(rows))["OOS-099"] == "PARTIAL_CHAIN"
    rows = change(snapshots(), 6, routeId="other-route")
    assert statuses(evaluate(rows))["OOS-101"] == "PARTIAL_CHAIN"
    rows = change(snapshots(), 6, massKg=float("inf"))
    assert statuses(evaluate(rows))["OOS-101"] == "PARTIAL_CHAIN"


def check_bounds_reject_oversized_and_duplicate_sources() -> None:
    rows = snapshots()
    with unittest.TestCase().assertRaisesRegex(ValueError, "duplicate snapshotId"):
        evaluate(rows + [rows[0]])
    with unittest.TestCase().assertRaisesRegex(ValueError, "too many snapshots"):
        evaluate(rows * 3)
    with unittest.TestCase().assertRaisesRegex(ValueError, "exceed bound"):
        evaluate(rows + [(b"x" * (1024 * 1024 + 1), "0" * 64)])


def check_unrecognized_source_does_not_disappear_from_chain() -> None:
    rows = snapshots()
    payload = json.loads(rows[0][0])
    payload["snapshotId"] = "fixture-unknown-snapshot"
    payload["event"]["kind"] = "UNRECOGNIZED"
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    rows.append((raw, hashlib.sha256(raw).hexdigest()))
    assert set(statuses(evaluate(rows)).values()) == {"UNVERIFIED"}


class ExternalEventSnapshotTests(unittest.TestCase):
    def test_synthetic_linkage_is_review_only_and_not_coverage(self) -> None:
        check_synthetic_linkage_is_review_only_and_not_coverage()

    def test_tampered_source_bytes_rejected_even_if_metadata_unchanged(self) -> None:
        check_tampered_source_bytes_rejected_even_if_metadata_unchanged()

    def test_authority_missing_or_rejected_fails_closed(self) -> None:
        check_authority_missing_or_rejected_fails_closed()

    def test_cross_object_trip_and_vehicle_cannot_link(self) -> None:
        check_cross_object_trip_and_vehicle_cannot_link()

    def test_stale_snapshot_and_expired_license_fail_closed(self) -> None:
        check_stale_snapshot_and_expired_license_fail_closed()

    def test_missing_segments_and_unknown_status_abstain(self) -> None:
        check_missing_segments_and_unknown_status_abstain()

    def test_wrong_time_and_route_fail_closed(self) -> None:
        check_wrong_time_and_route_fail_closed()

    def test_bounds_reject_oversized_and_duplicate_sources(self) -> None:
        check_bounds_reject_oversized_and_duplicate_sources()

    def test_unrecognized_source_does_not_disappear_from_chain(self) -> None:
        check_unrecognized_source_does_not_disappear_from_chain()
