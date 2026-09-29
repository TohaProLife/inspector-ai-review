#!/usr/bin/env python3
"""Probe local VLM on automatically selected TRAIN_PUBLIC room crops."""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import time
import urllib.request
from urllib.parse import urlparse

from PIL import Image


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def local_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise argparse.ArgumentTypeError("model endpoint must use local HTTP loopback")
    return value.rstrip("/")


def is_visual_flag(value: object) -> bool:
    return type(value) is bool or value == "uncertain"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--localization-report", type=Path, required=True)
    parser.add_argument("--case-id", required=True)
    parser.add_argument("--model-url", type=local_url, default="http://127.0.0.1:18086")
    parser.add_argument("--model", default="inspector-qwen3vl4b-eval")
    parser.add_argument("--input-profile", choices=("focus", "room-only"), default="focus")
    parser.add_argument("--hint-profile", choices=("with-text", "visual-only"), default="with-text")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--max-image-edge", type=int, default=768)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if not 256 <= args.max_image_edge <= 1024:
        parser.error("max-image-edge must be 256..1024")

    localization = json.loads(args.localization_report.read_text(encoding="utf-8"))
    if localization.get("schemaVersion") != "public-room-localization-probe-v1":
        parser.error("localization report schema is invalid")
    cases = [item for item in localization.get("cases", []) if item.get("caseId") == args.case_id]
    if len(cases) != 1:
        parser.error("case not found exactly once")
    case = cases[0]
    manifest_rows = [json.loads(line) for line in args.manifest.read_text(encoding="utf-8").splitlines() if line.strip()]
    manifest = {item["file_id"]: item for item in manifest_rows}
    room = case["room"]
    if not isinstance(room, str) or not room.isdigit():
        parser.error("invalid room")
    results = []
    for stage in ("PD", "RD"):
        eligible = [item for item in case["candidates"] if item["stage"] == stage and item["status"] == "COARSE_CROP"]
        if not eligible:
            results.append({"stage": stage, "status": "NO_CROP"})
            continue
        item = min(eligible, key=lambda value: value["rank"])
        source = manifest.get(item["fileId"])
        expected_stage = "PD" if stage == "PD" else "RD_ID_MIXED"
        if (not source or source.get("split") != "TRAIN_PUBLIC"
                or source.get("distribution_status") != "INCLUDE"
                or source.get("stage") != expected_stage
                or source.get("object_id") != case.get("objectId")
                or source.get("sha256") != item["sourceSha256"]
                or not 1 <= item["sourcePage"] <= source["pdf_pages"]):
            parser.error(f"unverified public source: {stage}")
        if args.input_profile == "room-only" and not item.get("roomRectangle"):
            results.append({"stage": stage, "status": "ROOM_RECTANGLE_UNRESOLVED",
                            "fileId": item["fileId"], "sourcePage": item["sourcePage"]})
            continue
        selected_image = item["roomRectangle"] if args.input_profile == "room-only" else item["crop"]
        image_path = Path(selected_image["image"])
        if not image_path.is_file() or digest(image_path) != selected_image["sha256"]:
            parser.error(f"crop SHA-256 mismatch: {stage}")
        if args.input_profile == "room-only" and selected_image["parentCropSha256"] != item["crop"]["sha256"]:
            parser.error(f"room rectangle parent hash mismatch: {stage}")
        with Image.open(image_path) as original:
            image = original.convert("RGB")
        original_size = image.size
        image.thumbnail((args.max_image_edge, args.max_image_edge), Image.Resampling.LANCZOS)
        encoded = io.BytesIO()
        image.save(encoded, format="PNG")
        image_bytes = encoded.getvalue()
        input_sha256 = hashlib.sha256(image_bytes).hexdigest()
        input_path = args.report.with_name(f"{args.report.stem}-{stage}-input.png")
        input_path.parent.mkdir(parents=True, exist_ok=True)
        input_path.write_bytes(image_bytes)
        # FREE-HEATING-001 is the only subject in this bounded probe. Its code
        # identifies heating without exposing public expected/actual values.
        group = item["locator"].get("roomGroupExact", room)
        room_hint = (f"Текстовый слой PDF рядом с целью содержит «{group}». Подтверди подпись на изображении. "
                     if args.hint_profile == "with-text" else
                     "Прочитай подпись комнаты на изображении; текстовый слой тебе не передан. ")
        prompt = (
            f"Это фрагмент чертежа {stage}. Цель — помещение {room}. "
            f"{room_hint}"
            "Подпись с несколькими номерами относится к каждому из них; верни её полностью. "
            "Смотри только внутри видимых границ цели. Соседние комнаты исключи. "
            "Найди вложенный красно-синий контур из нескольких витков; две прямые магистральные линии контуром не считай. "
            "Ответ только JSON с четырьмя полями: roomVisible (true, false или строка \"uncertain\"), "
            "roomLabelExact (строка или null), nestedRedBlueLoop (true, false или строка \"uncertain\"), "
            "visualReason (одно короткое предложение). "
            "Не делай вывода об остальных листах."
        )
        body = {"model": args.model, "temperature": 0, "max_tokens": 220,
                "messages": [{"role": "user", "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64," +
                     base64.b64encode(image_bytes).decode("ascii")}},
                ]}]}
        request = urllib.request.Request(
            args.model_url + "/v1/chat/completions",
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST",
        )
        started = time.monotonic()
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            output = json.load(response)
        answer = output["choices"][0]["message"].get("content") or ""
        try:
            parsed = json.loads(answer)
        except json.JSONDecodeError:
            parsed = None
        issues: list[str] = []
        if not isinstance(parsed, dict):
            issues.append("INVALID_JSON")
        else:
            if set(parsed) != {"roomVisible", "roomLabelExact", "nestedRedBlueLoop", "visualReason"}:
                issues.append("INVALID_KEYS")
            if not is_visual_flag(parsed.get("roomVisible")):
                issues.append("INVALID_ROOM_VISIBLE")
            if not is_visual_flag(parsed.get("nestedRedBlueLoop")):
                issues.append("INVALID_FLOOR_LOOP")
            label = parsed.get("roomLabelExact")
            if parsed.get("roomVisible") is True and (not isinstance(label, str) or
                    re.sub(r"\s+", "", group) not in re.sub(r"\s+", "", label)):
                issues.append("ROOM_LABEL_NOT_EXACT")
            if not isinstance(parsed.get("visualReason"), str):
                issues.append("INVALID_REASON")
            if (args.input_profile == "room-only"
                    and type(parsed.get("nestedRedBlueLoop")) is bool
                    and parsed["nestedRedBlueLoop"] != item["roomRectangle"]["colorLoopProbe"]["candidate"]):
                issues.append("VISUAL_PATTERN_DISAGREEMENT")
        if output["choices"][0]["finish_reason"] != "stop":
            issues.append("INCOMPLETE_GENERATION")
        results.append({
            "stage": stage, "status": "MODEL_OUTPUT_INVALID" if issues else "OBSERVATION_ONLY",
            "validationIssues": issues, "selectedRank": item["rank"],
            "fileId": item["fileId"], "sourcePage": item["sourcePage"],
            "roomGroupFromTextLayer": group,
            "sourceSha256": item["sourceSha256"], "cropSha256": item["crop"]["sha256"],
            "modelCropSha256": selected_image["sha256"], "inputProfile": args.input_profile,
            "hintProfile": args.hint_profile,
            "pdfBoxPt": selected_image["pdfBoxPt"],
            "independentColorLoopProbe": selected_image.get("colorLoopProbe"),
            "modelInputSha256": input_sha256, "modelInputPath": str(input_path),
            "originalSizePx": original_size, "modelInputSizePx": image.size,
            "prompt": prompt, "seconds": round(time.monotonic() - started, 2),
            "answer": parsed, "rawAnswer": answer, "finishReason": output["choices"][0]["finish_reason"],
        })
    report = {"schemaVersion": "public-auto-room-vision-probe-v5", "domainDecision": "NOT_ACCEPTED_PROBE_ONLY",
              "caseId": args.case_id, "room": room, "localizationSha256": digest(args.localization_report),
              "model": args.model, "results": results}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(args.report), "results": [
        {"stage": item["stage"], "page": item.get("sourcePage"), "rank": item.get("selectedRank"),
         "seconds": item.get("seconds"), "answer": item.get("answer")} for item in results
    ]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
