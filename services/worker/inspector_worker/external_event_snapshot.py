"""Bounded offline linkage of authenticated external-event *inputs*.

This module does not access registries, verify signatures by itself, or emit
findings. An independently configured authority_verifier must authenticate the
exact raw bytes and issuer; a self-declared VERIFIED flag is never sufficient.
Linked inputs remain review-only until object/source decisions are established.
"""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Callable


SCHEMA_VERSION = "external-event-snapshot-v1"
RESULT_SCHEMA = "external-event-chain-review-v1"
CODES = ("OOS-098", "OOS-099", "OOS-100", "OOS-101")
MAX_SNAPSHOTS = 24
MAX_SNAPSHOT_BYTES = 1024 * 1024
MAX_AGE = timedelta(hours=24)
REQUIRED = {
    "OOS-098": ("WORK_START", "OSIG_PERMIT"),
    "OOS-099": ("TRIP_CONTEXT", "RNIS_REGISTRATION", "RNIS_TELEMETRY"),
    "OOS-100": ("TRIP_CONTEXT", "KPTS_DEPARTURE"),
    "OOS-101": ("TRIP_CONTEXT", "WASTE_TRANSFER", "WASTE_ACCEPTANCE", "FACILITY_LICENSE"),
}
EXPECTED = {"WORK_START": ("WORK_LOG", "STARTED"),
            "OSIG_PERMIT": ("OSIG", "ACTIVE"),
            "TRIP_CONTEXT": ("DISPATCH", "SCHEDULED"),
            "RNIS_REGISTRATION": ("RNIS", "REGISTERED"),
            "RNIS_TELEMETRY": ("RNIS", "OBSERVED"),
            "KPTS_DEPARTURE": ("MOBILE_KPTS", "DEPARTED"),
            "WASTE_TRANSFER": ("TRANSFER", "TRANSFERRED"),
            "WASTE_ACCEPTANCE": ("ACCEPTANCE", "ACCEPTED"),
            "FACILITY_LICENSE": ("GROO", "VALID")}
AuthorityVerifier = Callable[[bytes, dict[str, Any]], bool]


def _timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed.astimezone(timezone.utc)


def _nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip()) and len(value) <= 256


def _unique_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                   separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _read_snapshot(raw: bytes, expected_sha: str, now: datetime,
                   verifier: AuthorityVerifier | None) -> tuple[str | None, str,
                                                                    dict[str, Any] | None]:
    """Return event kind, rejection class, and authenticated payload if usable."""
    if not isinstance(raw, bytes) or len(raw) > MAX_SNAPSHOT_BYTES or not raw:
        return None, "UNVERIFIED", None
    try:
        payload = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_pairs)
    except (ValueError, UnicodeDecodeError):
        return None, "UNVERIFIED", None
    if not isinstance(payload, dict) or not isinstance(payload.get("event"), dict):
        return None, "UNVERIFIED", None
    kind = payload["event"].get("kind")
    kind = kind if kind in EXPECTED else None
    if (not isinstance(expected_sha, str) or len(expected_sha) != 64
            or hashlib.sha256(raw).hexdigest() != expected_sha):
        return kind, "UNVERIFIED", None
    if payload.get("schemaVersion") != SCHEMA_VERSION or kind is None:
        return kind, "UNVERIFIED", None
    system, valid_status = EXPECTED[kind]
    if (payload.get("system") != system or not _nonempty(payload.get("systemVersion"))
            or payload["event"].get("status") != valid_status
            or not _nonempty(payload["event"].get("objectId"))):
        return kind, "UNVERIFIED", None
    captured = _timestamp(payload.get("capturedAt"))
    occurred = _timestamp(payload["event"].get("occurredAt"))
    if captured is None or occurred is None or occurred > captured:
        return kind, "UNVERIFIED", None
    if captured > now or now - captured > MAX_AGE:
        return kind, "EXPIRED", None
    authority = payload.get("authority")
    if not isinstance(authority, dict) or not _nonempty(authority.get("issuerId")):
        return kind, "UNVERIFIED", None
    if authority.get("mode") == "SIGNED":
        proof = authority.get("signature")
    elif authority.get("mode") == "TRUSTED_EXPORT":
        proof = authority.get("validationReceipt")
    else:
        return kind, "UNVERIFIED", None
    if not _nonempty(proof) or verifier is None:
        return kind, "UNVERIFIED", None
    try:
        authenticated = verifier(raw, payload) is True
    except Exception:  # An authority-verifier fault must fail closed.
        authenticated = False
    return (kind, "OK", payload) if authenticated else (kind, "UNVERIFIED", None)


def _required_ids(event: dict[str, Any], fields: tuple[str, ...],
                  scope: dict[str, str]) -> bool:
    return all(_nonempty(event.get(field)) and event[field] == scope[field]
               for field in fields)


def _interval(event: dict[str, Any], instant: datetime) -> str:
    start = _timestamp(event.get("validFrom"))
    end = _timestamp(event.get("validUntil"))
    if start is None or end is None or end <= start:
        return "UNVERIFIED"
    return "OK" if start <= instant <= end else "EXPIRED"


def _chain(code: str, entries: dict[str, dict[str, Any]],
           scope: dict[str, str]) -> str:
    events = {kind: entries[kind]["event"] for kind in REQUIRED[code]}
    if not all(event["objectId"] == scope["objectId"] for event in events.values()):
        return "PARTIAL_CHAIN"
    if code == "OOS-098":
        if not _nonempty(events["OSIG_PERMIT"].get("permitId")):
            return "PARTIAL_CHAIN"
        return _interval(events["OSIG_PERMIT"], _timestamp(events["WORK_START"]["occurredAt"]))

    trip = events["TRIP_CONTEXT"]
    if (not _required_ids(trip, ("tripId", "vehicleId"), scope)
            or not _nonempty(trip.get("routeId"))):
        return "PARTIAL_CHAIN"
    start, end = _timestamp(trip.get("startAt")), _timestamp(trip.get("endAt"))
    if start is None or end is None or end <= start:
        return "UNVERIFIED"
    if code == "OOS-099":
        registration, telemetry = events["RNIS_REGISTRATION"], events["RNIS_TELEMETRY"]
        if (not _required_ids(registration, ("vehicleId",), scope)
                or not _required_ids(telemetry, ("vehicleId", "tripId"), scope)
                or not _nonempty(registration.get("trackerId"))
                or registration["trackerId"] != telemetry.get("trackerId")
                or telemetry.get("routeId") != trip["routeId"]):
            return "PARTIAL_CHAIN"
        observed = _timestamp(telemetry["occurredAt"])
        if not start <= observed <= end:
            return "PARTIAL_CHAIN"
        return _interval(registration, observed)
    if code == "OOS-100":
        departure = events["KPTS_DEPARTURE"]
        if (not _required_ids(departure, ("vehicleId", "tripId"), scope)
                or departure.get("routeId") != trip["routeId"]
                or not _nonempty(departure.get("qrId"))):
            return "PARTIAL_CHAIN"
        return "OK" if start <= _timestamp(departure["occurredAt"]) <= end else "PARTIAL_CHAIN"

    transfer, acceptance, license_row = (events["WASTE_TRANSFER"],
                                         events["WASTE_ACCEPTANCE"], events["FACILITY_LICENSE"])
    for row in (transfer, acceptance):
        if (not _required_ids(row, ("tripId", "vehicleId", "batchId"), scope)
                or row.get("routeId") != trip["routeId"]
                or not _nonempty(row.get("recipientId"))
                or not _nonempty(row.get("wasteClass"))
                or type(row.get("massKg")) not in (int, float)
                or not math.isfinite(row["massKg"]) or row["massKg"] <= 0):
            return "PARTIAL_CHAIN"
    if (transfer["recipientId"] != acceptance["recipientId"]
            or transfer["wasteClass"] != acceptance["wasteClass"]
            or transfer["massKg"] != acceptance["massKg"]
            or not _nonempty(acceptance.get("facilityId"))
            or not _nonempty(acceptance.get("licenseId"))
            or any(license_row.get(key) != acceptance[key]
                   for key in ("recipientId", "facilityId", "licenseId", "wasteClass"))):
        return "PARTIAL_CHAIN"
    transfer_time, acceptance_time = (_timestamp(transfer["occurredAt"]),
                                      _timestamp(acceptance["occurredAt"]))
    if not start <= transfer_time <= acceptance_time <= end:
        return "PARTIAL_CHAIN"
    return _interval(license_row, acceptance_time)


def evaluate_external_event_chain(
    *, object_id: str, vehicle_id: str, trip_id: str, batch_id: str,
    evaluated_at: str, snapshots: list[tuple[bytes, str]],
    authority_verifier: AuthorityVerifier | None,
    fixture_only: bool = False,
) -> dict[str, Any]:
    """Check input linkage; never conclude compliance, violation, or coverage."""
    scope = {"objectId": object_id, "vehicleId": vehicle_id,
             "tripId": trip_id, "batchId": batch_id}
    if not all(_nonempty(value) for value in scope.values()):
        raise ValueError("external event scope IDs required")
    now = _timestamp(evaluated_at)
    if now is None:
        raise ValueError("external event evaluatedAt must have timezone")
    if not isinstance(snapshots, list) or len(snapshots) > MAX_SNAPSHOTS:
        raise ValueError("too many snapshots or invalid input")
    good: dict[str, dict[str, Any]] = {}
    bad: dict[str, str] = {}
    seen: set[str] = set()
    source_hashes: list[str] = []
    unknown_input = False
    for item in snapshots:
        if not isinstance(item, tuple) or len(item) != 2:
            raise ValueError("snapshot must be raw bytes and SHA-256")
        raw, sha = item
        if not isinstance(raw, bytes) or len(raw) > MAX_SNAPSHOT_BYTES:
            raise ValueError("snapshot raw bytes exceed bound or are invalid")
        kind, state, payload = _read_snapshot(raw, sha, now, authority_verifier)
        if isinstance(raw, bytes):
            # Even a rejected input retains its actual digest in review provenance.
            source_hashes.append(hashlib.sha256(raw).hexdigest())
            try:
                envelope = json.loads(raw)
                snapshot_id = envelope.get("snapshotId") if isinstance(envelope, dict) else None
            except (ValueError, UnicodeDecodeError):
                snapshot_id = None
            if snapshot_id is not None:
                if not _nonempty(snapshot_id):
                    raise ValueError("invalid snapshotId")
                if snapshot_id in seen:
                    raise ValueError("duplicate snapshotId")
                seen.add(snapshot_id)
        if kind is None:
            unknown_input = True
            continue
        if kind in good or kind in bad:
            # Conflicting registry versions need explicit resolution upstream.
            bad[kind] = "UNVERIFIED"
            good.pop(kind, None)
        elif state == "OK":
            if payload["event"]["objectId"] != object_id:
                bad[kind] = "UNVERIFIED"
            else:
                good[kind] = payload
        else:
            bad[kind] = state
    rows = []
    for code in CODES:
        required = REQUIRED[code]
        present = [kind for kind in required if kind in good]
        failed = [bad[kind] for kind in required if kind in bad]
        if unknown_input or "UNVERIFIED" in failed:
            state = "UNVERIFIED"
        elif "EXPIRED" in failed:
            state = "EXPIRED"
        elif not present:
            state = "NOT_PROVIDED"
        elif len(present) != len(required):
            state = "PARTIAL_CHAIN"
        else:
            state = _chain(code, good, scope)
            if state == "OK":
                state = "LINKED_INPUTS_REVIEW_ONLY"
        rows.append({"parameterCode": code, "status": "ABSTAIN",
                     "chainStatus": state, "fixtureOnly": fixture_only,
                     "linkedSnapshotIds": [good[kind]["snapshotId"] for kind in required]
                     if state == "LINKED_INPUTS_REVIEW_ONLY" else [],
                     "findingCount": None, "parameterCoverage": None})
    result = {"schemaVersion": RESULT_SCHEMA, "purpose": "REVIEW_ONLY",
              "objectId": object_id, "evaluatedAt": evaluated_at,
              "sourceSha256": sorted(source_hashes), "codeRows": rows,
              "findingCount": None, "parameterCoverage": None}
    result["contentHash"] = _digest(result)
    return result
