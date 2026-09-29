#!/usr/bin/env python3
"""Read a durable public visual scan through the authenticated API."""

from __future__ import annotations

import argparse
import http.cookiejar
import json
from pathlib import Path
import re
from urllib.parse import quote
import urllib.request


VISUAL_VERSIONS = {f"visual-proposal-analysis-v{number}" for number in range(1, 7)}
_COVER_HEADING = re.compile(r"^(?:РАБОЧАЯ|ПРОЕКТНАЯ)\s+ДОКУМЕНТАЦИЯ(?:\n|$)", re.I)
_HEATING = re.compile(r"\bотоплени[еяию]\b", re.I)
_VENTILATION = re.compile(r"\bвентиляци[яиюе]\b", re.I)


def validate_document_context(context: object, page_count: int) -> str:
    if (not isinstance(context, dict) or set(context) != {
        "schemaVersion", "methodId", "status", "reasonCode", "inspectedPages",
    } or context["schemaVersion"] != "document-context-v1"
            or context["methodId"] != "first-two-pdf-cover-text-pages-v1"
            or not isinstance(context["inspectedPages"], list)
            or len(context["inspectedPages"]) != min(2, page_count)):
        raise RuntimeError("visual artifact document context is invalid")
    domains: set[str] = set()
    for number, page in enumerate(context["inspectedPages"], 1):
        if (not isinstance(page, dict) or set(page) != {"pageNumber", "textSha256", "titleWindow"}
                or page["pageNumber"] != number or not isinstance(page["textSha256"], str)
                or not re.fullmatch(r"[a-f0-9]{64}", page["textSha256"])):
            raise RuntimeError("visual artifact document context provenance is invalid")
        title = page["titleWindow"]
        if title is not None:
            if (not isinstance(title, str) or not 1 <= len(title) <= 500
                    or not _COVER_HEADING.match(title)):
                raise RuntimeError("visual artifact document title evidence is invalid")
            if _HEATING.search(title):
                domains.add("HEATING")
            if _VENTILATION.search(title):
                domains.add("VENTILATION")
    expected_status = next(iter(domains)) if len(domains) == 1 else "UNKNOWN"
    expected_reason = ("TITLE_KEYWORD_MATCH" if len(domains) == 1
                       else "TITLE_CONFLICT" if domains else "NO_TITLE_KEYWORD_MATCH")
    if context["status"] != expected_status or context["reasonCode"] != expected_reason:
        raise RuntimeError("visual artifact document context status is inconsistent")
    return expected_status


def validate_vlm_observations(value: object, source: dict, version: str) -> list[dict]:
    v6 = version == "visual-proposal-analysis-v6"
    proposals = source["proposals"]
    count = len(proposals)
    selected = list(range(count)) if count <= 2 else [((2 * i + 1) * count) // 4 for i in range(2)]
    if (not isinstance(value, dict) or set(value) != {
        "schemaVersion", "methodId", "eligibleProposalCount", "selectedOrdinals",
        "omittedProposalCount", "observations",
    } or value["schemaVersion"] != "visual-vlm-observations-v1"
            or value["methodId"] != ("spread-two-saved-proposals-server-nonnegative-v1" if v6
                                     else "spread-two-saved-proposals-v1")
            or value["eligibleProposalCount"] != count
            or value["selectedOrdinals"] != selected
            or value["omittedProposalCount"] != count - len(selected)
            or not isinstance(value["observations"], list)
            or len(value["observations"]) != len(selected)):
        raise RuntimeError("visual artifact VLM selection or truncation is invalid")
    for ordinal, observation in zip(selected, value["observations"]):
        proposal = proposals[ordinal]
        if (not isinstance(observation, dict) or set(observation) != {
            "proposalOrdinal", "sourceSha256", "pageNumber", "bboxNormalized",
            "cropSha256", "modelId", "promptSha256", "decision", "reasonCode", "responseSha256",
            *(("modelRevision", "modelLockSha256") if v6 else
              ("modelWeightsSha256", "modelProjectorSha256")),
        } or observation["proposalOrdinal"] != ordinal
                or observation["sourceSha256"] != source["sourceSha256"]
                or observation["pageNumber"] != proposal["pageNumber"]
                or observation["bboxNormalized"] != proposal["bboxNormalized"]
                or observation["modelId"] != ("inspector-qwen3-vl-8b-fp8" if v6 else "inspector-qwen3vl4b-eval")
                or (v6 and (observation["modelRevision"] != "9cdc6310a8cb770ce18efaf4e9935334512aee45"
                            or observation["modelLockSha256"] != "e2586e16f45deee017935d4c60b550e48059fdc02cbc9c9114053f2f1fe4d879"))
                or (not v6 and (observation["modelWeightsSha256"] != "66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a"
                                or observation["modelProjectorSha256"] != "30ba2c7dd3127a4561b6cba9d13d0f711c91bdb38742e2f56d73c8cb596bd06d"))
                or observation["promptSha256"] != "34a372ca6f4032b74ff51c11dd7adfe14df31b266ca356a5a2ec15b1d56c9611"):
            raise RuntimeError("visual artifact VLM observation provenance is invalid")
        crop = observation["cropSha256"]
        response = observation["responseSha256"]
        valid_hash = lambda item: isinstance(item, str) and re.fullmatch(r"[a-f0-9]{64}", item)
        reason = observation["reasonCode"]
        decision = observation["decision"]
        if reason == "MODEL_RESPONSE":
            valid = valid_hash(crop) and valid_hash(response) and decision in (
                {"RADIATOR_HINT"} if v6 else {"RADIATOR_HINT", "OTHER_HINT"})
        elif reason == "MODEL_ABSTAIN":
            valid = valid_hash(crop) and valid_hash(response) and decision == "ABSTAIN"
        elif reason == "MODEL_OTHER_UNTRUSTED" and v6:
            valid = valid_hash(crop) and valid_hash(response) and decision == "ABSTAIN"
        elif reason == "CROP_RENDER_ERROR":
            valid = crop is None and response is None and decision == "ABSTAIN"
        elif reason in {"ENDPOINT_NOT_CONFIGURED", "MODEL_HTTP_ERROR", "MODEL_TIMEOUT",
                        "MODEL_UNAVAILABLE", "MODEL_REDIRECT_REJECTED", "MODEL_OUTPUT_INVALID",
                        "MODEL_RESPONSE_TOO_LARGE"}:
            valid = valid_hash(crop) and response is None and decision == "ABSTAIN"
        else:
            valid = False
        if not valid:
            raise RuntimeError("visual artifact VLM observation outcome is invalid")
    return value["observations"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:18081")
    parser.add_argument("--credentials-file", type=Path, required=True)
    parser.add_argument("--check-id", required=True)
    parser.add_argument("--public-manifest", type=Path, required=True)
    parser.add_argument("--public-source-id", required=True)
    parser.add_argument("--expected-proposals", type=int, required=True)
    parser.add_argument("--expected-pages", type=int, required=True)
    parser.add_argument("--expected-status", choices=(
        "SCANNED", "SKIPPED_PAGE_LIMIT", "PARTIALLY_SCANNED_PAGE_LIMIT",
    ), default="SCANNED")
    parser.add_argument("--object-id")
    parser.add_argument("--preview-page", type=int)
    parser.add_argument("--preview-crop", action="store_true")
    parser.add_argument("--expected-context", choices=("HEATING", "VENTILATION", "UNKNOWN"))
    parser.add_argument("--expected-vlm-observations", type=int)
    parser.add_argument("--expected-visual-version", choices=sorted(VISUAL_VERSIONS))
    parser.add_argument("--require-vlm-response", action="store_true",
                        help="Fail if every selected VLM observation is a provider failure or endpoint abstention")
    parser.add_argument("--artifact-output", type=Path,
                        help="Save the authenticated immutable visual response for offline evaluation")
    args = parser.parse_args()
    if args.expected_proposals < 0 or args.expected_pages < 1:
        parser.error("expected counts are invalid")
    if args.expected_status == "SKIPPED_PAGE_LIMIT" and args.expected_proposals != 0:
        parser.error("skipped source cannot have retained proposals")
    if bool(args.object_id) != bool(args.preview_page):
        parser.error("--object-id and --preview-page must be used together")
    if args.preview_crop and not args.preview_page:
        parser.error("--preview-crop requires --preview-page")

    matches = []
    for line in args.public_manifest.read_text(encoding="utf-8").splitlines():
        if line.strip():
            entry = json.loads(line)
            if entry.get("file_id") == args.public_source_id:
                matches.append(entry)
    if len(matches) != 1:
        parser.error("public source id is missing or duplicated")
    manifest = matches[0]
    if (manifest.get("split") != "TRAIN_PUBLIC"
            or manifest.get("distribution_status") != "INCLUDE"
            or manifest.get("label_visibility") != "PUBLIC_TRAIN"):
        parser.error("source is not included TRAIN_PUBLIC")

    credentials = dict(line.split("=", 1) for line in args.credentials_file.read_text().splitlines() if "=" in line)
    if not credentials.get("login") or not credentials.get("password"):
        parser.error("credentials file needs login and password")
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    base = args.base_url.rstrip("/")

    def get(path: str) -> dict:
        with opener.open(f"{base}/api{path}", timeout=30) as response:
            return json.load(response)

    login = urllib.request.Request(
        f"{base}/api/auth/login",
        data=json.dumps({"login": credentials["login"], "password": credentials["password"]}).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with opener.open(login, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError("login failed")

    artifact = get(f"/checks/{args.check_id}/visual-proposals")
    version = artifact.get("schemaVersion")
    if version not in VISUAL_VERSIONS \
            or artifact.get("status") != "PROPOSAL_ONLY_UNVERIFIED":
        raise RuntimeError("visual artifact status is invalid")
    if args.expected_visual_version and version != args.expected_visual_version:
        raise RuntimeError("visual artifact version differs from expected")
    if version == "visual-proposal-analysis-v6":
        profile = artifact.get("profile")
        if (not isinstance(profile, dict)
                or profile.get("schemaVersion") != "visual-proposal-profile-v6"
                or profile.get("vlmMethodId") != "spread-two-saved-proposals-server-nonnegative-v1"
                or profile.get("vlmModelId") != "inspector-qwen3-vl-8b-fp8"
                or profile.get("vlmModelRevision") != "9cdc6310a8cb770ce18efaf4e9935334512aee45"
                or profile.get("vlmModelLockSha256") != "e2586e16f45deee017935d4c60b550e48059fdc02cbc9c9114053f2f1fe4d879"
                or profile.get("vlmModelShards") != [
                    {"filename": "model-00001-of-00002.safetensors", "sha256": "e2dea2e85e643ef7045c31a485a426631a1e0a84e463f8b2c7e9c6682a06eafd"},
                    {"filename": "model-00002-of-00002.safetensors", "sha256": "3dc64ec934af27a7007d265014e907aff9e16658d409e5cd4cf79869bf2bd8c1"},
                ]):
            raise RuntimeError("visual V6 profile does not match the pinned H100 model lock")
    if args.expected_status == "PARTIALLY_SCANNED_PAGE_LIMIT" \
            and version == "visual-proposal-analysis-v1":
        raise RuntimeError("partial scan requires v2, v3, v4, v5 or v6 artifact")
    if not isinstance(artifact.get("sources"), list):
        raise RuntimeError("visual artifact has no source list")
    sources = [source for source in artifact["sources"] if source.get("sourceSha256") == manifest["sha256"]]
    if len(sources) != 1:
        raise RuntimeError("visual artifact does not identify exactly one public source")
    source = sources[0]
    page_limit = 1024 if version in {"visual-proposal-analysis-v3", "visual-proposal-analysis-v4", "visual-proposal-analysis-v5", "visual-proposal-analysis-v6"} else 64
    expected_scanned = (args.expected_pages if args.expected_status == "SCANNED"
                        else page_limit if args.expected_status == "PARTIALLY_SCANNED_PAGE_LIMIT" else 0)
    if (source.get("pageCount") != args.expected_pages
            or source.get("scannedPageCount") != expected_scanned
            or source.get("status") != args.expected_status
            or len(source.get("proposals", [])) != args.expected_proposals):
        raise RuntimeError("visual artifact page or proposal counts differ")
    if version != "visual-proposal-analysis-v1":
        middle_count = page_limit - 16
        pages = (list(range(1, args.expected_pages + 1)) if args.expected_pages <= page_limit
                 else list(range(1, 9)) + [
                     9 + ((2 * index + 1) * (args.expected_pages - 16)) // (2 * middle_count)
                     for index in range(middle_count)
                 ] + list(range(args.expected_pages - 7, args.expected_pages + 1)))
        if (source.get("scannedPageNumbers") != pages
                or source.get("skippedPageCount") != args.expected_pages - len(pages)
                or any(proposal.get("pageNumber") not in pages for proposal in source["proposals"])):
            raise RuntimeError("scan scope or proposal page is invalid")
    if any(proposal.get("status") != "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED"
           for proposal in source["proposals"]):
        raise RuntimeError("visual artifact contains a classified proposal")
    context_status = None
    if version in {"visual-proposal-analysis-v4", "visual-proposal-analysis-v5", "visual-proposal-analysis-v6"}:
        context_status = validate_document_context(source.get("documentContext"), source["pageCount"])
    elif "documentContext" in source:
        raise RuntimeError("legacy visual artifact unexpectedly has document context")
    if args.expected_context and context_status != args.expected_context:
        raise RuntimeError("visual artifact document context differs from expected")
    observations = validate_vlm_observations(source.get("vlm"), source, version) \
        if version in {"visual-proposal-analysis-v5", "visual-proposal-analysis-v6"} else []
    if version not in {"visual-proposal-analysis-v5", "visual-proposal-analysis-v6"} and "vlm" in source:
        raise RuntimeError("legacy visual artifact unexpectedly has VLM observations")
    if args.expected_vlm_observations is not None and len(observations) != args.expected_vlm_observations:
        raise RuntimeError("visual artifact VLM observation count differs from expected")
    if args.require_vlm_response and not any(item["reasonCode"] in {
        "MODEL_RESPONSE", "MODEL_ABSTAIN", "MODEL_OTHER_UNTRUSTED",
    } for item in observations):
        raise RuntimeError("no selected proposal has a VLM response")
    if "findings" in artifact or "coverage" in artifact:
        raise RuntimeError("visual artifact contains a verdict field")
    preview_bytes = None
    preview_crop_bytes = None
    if args.preview_page:
        if args.preview_page < 1 or args.preview_page > args.expected_pages:
            parser.error("preview page is outside expected page count")
        path = (f"/objects/{quote(args.object_id, safe='')}/files/"
                f"{quote(source['sourceFileId'], safe='')}/pages/{args.preview_page}/preview")
        with opener.open(f"{base}/api{path}", timeout=120) as response:
            body = response.read()
            if (response.status != 200 or response.headers.get_content_type() != "image/png"
                    or not body.startswith(b"\x89PNG\r\n\x1a\n")):
                raise RuntimeError("verified PDF preview is not a PNG")
            preview_bytes = len(body)
        if args.preview_crop:
            candidates = [proposal for proposal in source["proposals"]
                          if proposal.get("pageNumber") == args.preview_page]
            if not candidates:
                raise RuntimeError("preview page has no geometric proposal to crop")
            bbox = candidates[0].get("bboxNormalized")
            if (not isinstance(bbox, list) or len(bbox) != 4
                    or any(not isinstance(value, (int, float)) or not 0 <= value <= 1 for value in bbox)):
                raise RuntimeError("proposal has invalid crop geometry")
            query = ",".join(f"{value:.6f}" for value in bbox)
            with opener.open(f"{base}/api{path}?crop={query}", timeout=120) as response:
                body = response.read()
                if (response.status != 200 or response.headers.get_content_type() != "image/png"
                        or not body.startswith(b"\x89PNG\r\n\x1a\n")):
                    raise RuntimeError("verified PDF crop is not a PNG")
                preview_crop_bytes = len(body)
    findings = get(f"/checks/{args.check_id}/findings")
    if not isinstance(findings.get("items"), list):
        raise RuntimeError("findings response is invalid")
    if args.artifact_output:
        args.artifact_output.parent.mkdir(parents=True, exist_ok=True)
        with args.artifact_output.open("x", encoding="utf-8") as stream:
            json.dump(artifact, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
    print(json.dumps({
        "checkId": args.check_id,
        "artifactId": artifact["artifactId"],
        "contentHash": artifact["contentHash"],
        "publicSourceId": args.public_source_id,
        "sourceFileId": source["sourceFileId"],
        "pageCount": source["pageCount"],
        "scannedPageCount": source["scannedPageCount"],
        "proposalCount": len(source["proposals"]),
        "findingCount": len(findings["items"]),
        "status": artifact["status"],
        "documentContextStatus": context_status,
        "vlmObservationCount": len(observations),
        "vlmReasonCodes": [item["reasonCode"] for item in observations],
        "previewBytes": preview_bytes,
        "previewCropBytes": preview_crop_bytes,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
