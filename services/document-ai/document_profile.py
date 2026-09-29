from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any


class ProfileError(ValueError):
    pass


@dataclass(frozen=True)
class DocumentProfile:
    profile_id: str
    device: str
    scripts: tuple[str, ...]
    model_options: dict[str, Any]
    prediction_options: dict[str, Any]


def load_profile(path: Path) -> DocumentProfile:
    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ProfileError(f"cannot load document profile: {error}") from error
    if raw.get("schemaVersion") != "document-ai-profile-v1":
        raise ProfileError("unsupported document profile schema")
    profile_id = raw.get("profileId")
    device = raw.get("device")
    scripts = raw.get("scripts")
    model_options = raw.get("modelOptions")
    prediction_options = raw.get("predictionOptions")
    if not isinstance(profile_id, str) or not profile_id:
        raise ProfileError("profileId is required")
    if not isinstance(device, str) or not device:
        raise ProfileError("device is required")
    if not isinstance(scripts, list) or not scripts or any(item not in {"eslav", "latin"} for item in scripts):
        raise ProfileError("scripts must contain eslav and/or latin")
    if len(set(scripts)) != len(scripts):
        raise ProfileError("scripts must not contain duplicates")
    if not isinstance(model_options, dict):
        raise ProfileError("modelOptions must be an object")
    recognizers = model_options.get("textRecognitionModels")
    if not isinstance(recognizers, dict) or any(script not in recognizers for script in scripts):
        raise ProfileError("textRecognitionModels must cover every script")
    if not isinstance(prediction_options, dict):
        raise ProfileError("predictionOptions must be an object")
    return DocumentProfile(
        profile_id=profile_id,
        device=device,
        scripts=tuple(scripts),
        model_options=model_options,
        prediction_options=prediction_options,
    )


def pipeline_options(profile: DocumentProfile, script: str) -> dict[str, Any]:
    if script not in profile.scripts:
        raise ProfileError(f"script is not enabled by profile: {script}")
    options = dict(profile.model_options)
    recognizers = options.pop("textRecognitionModels")
    options["text_recognition_model_name"] = recognizers[script]
    options["device"] = profile.device
    return options
