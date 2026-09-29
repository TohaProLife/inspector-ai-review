"""Optional, bounded local VLM hints for saved geometric proposals.

This module never changes proposal geometry, source coverage, or findings.
Provider failures become explicit per-proposal abstentions.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import socket
from pathlib import Path
from typing import Any
import urllib.error
import urllib.request
from urllib.parse import urlparse

import fitz


MODEL_ID = "inspector-qwen3vl4b-eval"
MODEL_WEIGHTS_SHA256 = "66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a"
MODEL_PROJECTOR_SHA256 = "30ba2c7dd3127a4561b6cba9d13d0f711c91bdb38742e2f56d73c8cb596bd06d"
SERVER_MODEL_ID = "inspector-qwen3-vl-8b-fp8"
SERVER_MODEL_REVISION = "9cdc6310a8cb770ce18efaf4e9935334512aee45"
# SHA-256 of services/model-store/locks/server.json. That lock pins every model file,
# including tokenizer/config and both weight shards, and is verified before vLLM starts.
SERVER_MODEL_LOCK_SHA256 = "e2586e16f45deee017935d4c60b550e48059fdc02cbc9c9114053f2f1fe4d879"
SERVER_MODEL_SHARDS = [
    {"filename": "model-00001-of-00002.safetensors", "sha256": "e2dea2e85e643ef7045c31a485a426631a1e0a84e463f8b2c7e9c6682a06eafd"},
    {"filename": "model-00002-of-00002.safetensors", "sha256": "3dc64ec934af27a7007d265014e907aff9e16658d409e5cd4cf79869bf2bd8c1"},
]
PROMPT = (
    "Ты видишь только локальный фрагмент инженерного чертежа вокруг геометрического кандидата. "
    "Ответь ровно одним словом: RADIATOR, если уверенно видишь условное обозначение радиатора; "
    "OTHER, если уверенно видишь иной объект; ABSTAIN, если не уверен или контекста мало. "
    "Не делай вывод о других областях, отсутствии элементов или нарушении проекта."
)
PROMPT_SHA256 = hashlib.sha256(PROMPT.encode("utf-8")).hexdigest()
METHOD_ID = "spread-two-saved-proposals-v1"
SERVER_METHOD_ID = "spread-two-saved-proposals-server-nonnegative-v1"
MAX_OBSERVATIONS = 2
CROP_MAX_EDGE_PX = 768
MAX_CROP_BYTES = 2 * 1024 * 1024
MAX_RESPONSE_BYTES = 16 * 1024
REQUEST_TIMEOUT_SECONDS = 90


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        raise VlmProviderError("MODEL_REDIRECT_REJECTED")


class VlmProviderError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def validate_local_url(value: str, profile_version: str = "v5") -> str:
    parsed = urlparse(value)
    allowed = ({("vlm", 8000)} if profile_version == "v6" else
               {("visual-vlm", 8080), ("127.0.0.1", 18086), ("localhost", 18086)})
    if profile_version not in {"v5", "v6"}:
        raise ValueError("unsupported visual VLM profile")
    if (parsed.scheme != "http" or (parsed.hostname, parsed.port) not in allowed
            or parsed.username or parsed.password or parsed.path != "/v1"
            or parsed.query or parsed.fragment):
        raise ValueError("visual VLM URL must be allowlisted local HTTP")
    return value.rstrip("/")


def selected_ordinals(count: int) -> list[int]:
    if count < 0:
        raise ValueError("proposal count cannot be negative")
    if count <= MAX_OBSERVATIONS:
        return list(range(count))
    return [((2 * index + 1) * count) // (2 * MAX_OBSERVATIONS)
            for index in range(MAX_OBSERVATIONS)]


def render_crop(path: Path, page_number: int, bbox: list[float]) -> bytes:
    if (len(bbox) != 4 or any(not isinstance(value, (int, float)) or not math.isfinite(value)
                              for value in bbox)
            or not (0 <= bbox[0] < bbox[2] <= 1 and 0 <= bbox[1] < bbox[3] <= 1)):
        raise ValueError("proposal bbox is invalid")
    with fitz.open(path) as document:
        if not 1 <= page_number <= len(document):
            raise ValueError("proposal page is outside source")
        page = document.load_page(page_number - 1)
        bounds = page.rect
        if bounds.width <= 0 or bounds.height <= 0:
            raise ValueError("proposal page geometry is invalid")
        width = min(1., max((bbox[2] - bbox[0]) * 4, 0.04))
        height = min(1., max((bbox[3] - bbox[1]) * 4, 0.04))
        if width * bounds.width < height * bounds.height:
            width = min(1., height * bounds.height / bounds.width)
        else:
            height = min(1., width * bounds.width / bounds.height)
        left = max(0., min(1. - width, (bbox[0] + bbox[2] - width) / 2))
        top = max(0., min(1. - height, (bbox[1] + bbox[3] - height) / 2))
        displayed = fitz.Rect(
            bounds.x0 + left * bounds.width, bounds.y0 + top * bounds.height,
            bounds.x0 + (left + width) * bounds.width,
            bounds.y0 + (top + height) * bounds.height,
        )
        scale = min(CROP_MAX_EDGE_PX / max(displayed.width, displayed.height), 600 / 72)
        if not 0 < scale < 100:
            raise ValueError("proposal crop scale is invalid")
        clip = displayed * page.derotation_matrix
        pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip, alpha=False)
        if (pixmap.width < 1 or pixmap.height < 1 or pixmap.width > CROP_MAX_EDGE_PX + 4
                or pixmap.height > CROP_MAX_EDGE_PX + 4
                or pixmap.width * pixmap.height > 600_000):
            raise ValueError("proposal crop pixel count exceeds limit")
        png = pixmap.tobytes("png")
        if len(png) > MAX_CROP_BYTES or not png.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("proposal crop PNG exceeds limit")
        return png


def _post_vlm(base_url: str, png: bytes, *, model_id: str = MODEL_ID,
              require_response_model: bool = False) -> tuple[str, str]:
    body = {
        "model": model_id, "temperature": 0, "max_tokens": 8,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {
                "url": "data:image/png;base64," + base64.b64encode(png).decode("ascii"),
            }},
        ]}],
    }
    payload = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        base_url + "/chat/completions", data=payload,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    with opener.open(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        if response.status != 200 or response.headers.get_content_type() != "application/json":
            raise VlmProviderError("MODEL_OUTPUT_INVALID")
        raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise VlmProviderError("MODEL_RESPONSE_TOO_LARGE")
    response_hash = hashlib.sha256(raw).hexdigest()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as error:
        raise VlmProviderError("MODEL_OUTPUT_INVALID") from error
    if require_response_model and (not isinstance(data, dict) or data.get("model") != model_id):
        raise VlmProviderError("MODEL_OUTPUT_INVALID")
    choices = data.get("choices") if isinstance(data, dict) else None
    if (not isinstance(choices, list) or len(choices) != 1 or not isinstance(choices[0], dict)
            or choices[0].get("finish_reason") != "stop"
            or not isinstance(choices[0].get("message"), dict)):
        raise VlmProviderError("MODEL_OUTPUT_INVALID")
    answer = choices[0]["message"].get("content")
    if not isinstance(answer, str) or answer.strip() not in {"RADIATOR", "OTHER", "ABSTAIN"}:
        raise VlmProviderError("MODEL_OUTPUT_INVALID")
    return answer.strip(), response_hash


def observe_proposals(path: Path, source: dict[str, Any], base_url: str | None,
                      profile_version: str = "v5") -> dict[str, Any]:
    if profile_version not in {"v5", "v6"}:
        raise ValueError("unsupported visual VLM profile")
    ordinals = selected_ordinals(len(source["proposals"]))
    endpoint = None
    if base_url:
        endpoint = validate_local_url(base_url, profile_version)
    observations = []
    for ordinal in ordinals:
        proposal = source["proposals"][ordinal]
        record: dict[str, Any] = {
            "proposalOrdinal": ordinal,
            "sourceSha256": source["sourceSha256"],
            "pageNumber": proposal["pageNumber"],
            "bboxNormalized": proposal["bboxNormalized"],
            "cropSha256": None,
            "modelId": SERVER_MODEL_ID if profile_version == "v6" else MODEL_ID,
            "promptSha256": PROMPT_SHA256,
            "decision": "ABSTAIN",
            "reasonCode": "ENDPOINT_NOT_CONFIGURED" if endpoint is None else "MODEL_OUTPUT_INVALID",
            "responseSha256": None,
        }
        if profile_version == "v6":
            record["modelRevision"] = SERVER_MODEL_REVISION
            record["modelLockSha256"] = SERVER_MODEL_LOCK_SHA256
        else:
            record["modelWeightsSha256"] = MODEL_WEIGHTS_SHA256
            record["modelProjectorSha256"] = MODEL_PROJECTOR_SHA256
        try:
            png = render_crop(path, proposal["pageNumber"], proposal["bboxNormalized"])
            record["cropSha256"] = hashlib.sha256(png).hexdigest()
        except (RuntimeError, ValueError, fitz.FileDataError):
            record["reasonCode"] = "CROP_RENDER_ERROR"
        else:
            if endpoint is not None:
                try:
                    if profile_version == "v6":
                        answer, response_hash = _post_vlm(
                            endpoint, png, model_id=SERVER_MODEL_ID, require_response_model=True,
                        )
                    else:
                        answer, response_hash = _post_vlm(endpoint, png)
                    record["responseSha256"] = response_hash
                    if profile_version == "v6" and answer == "OTHER":
                        record["decision"] = "ABSTAIN"
                        record["reasonCode"] = "MODEL_OTHER_UNTRUSTED"
                    else:
                        record["decision"] = {
                            "RADIATOR": "RADIATOR_HINT", "OTHER": "OTHER_HINT", "ABSTAIN": "ABSTAIN",
                        }[answer]
                        record["reasonCode"] = "MODEL_ABSTAIN" if answer == "ABSTAIN" else "MODEL_RESPONSE"
                except VlmProviderError as error:
                    record["reasonCode"] = error.code
                except urllib.error.HTTPError:
                    record["reasonCode"] = "MODEL_HTTP_ERROR"
                except (TimeoutError, socket.timeout):
                    record["reasonCode"] = "MODEL_TIMEOUT"
                except urllib.error.URLError:
                    record["reasonCode"] = "MODEL_UNAVAILABLE"
        observations.append(record)
    return {
        "schemaVersion": "visual-vlm-observations-v1",
        "methodId": SERVER_METHOD_ID if profile_version == "v6" else METHOD_ID,
        "eligibleProposalCount": len(source["proposals"]),
        "selectedOrdinals": ordinals,
        "omittedProposalCount": len(source["proposals"]) - len(ordinals),
        "observations": observations,
    }
