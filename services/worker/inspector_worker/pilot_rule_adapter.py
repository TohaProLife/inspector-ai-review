"""Release-gated durable PZ-002 rule adapter."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .durable_pz002 import execute_durable_pz002
from .durable_pz017 import execute_durable_pz017
from .durable_ocr_artifact import download_ocr_layout_artifact
from .durable_ocr_layout import (PROFILE_HASH_V4, PROFILE_HASH_V5, PROFILE_HASH_V6,
                                 PROFILE_ID_V4, PROFILE_ID_V5, PROFILE_ID_V6)
from .durable_text import download_text_artifact
from .ocr_heat_rows import extract_ocr_heat_rows
from .ocr_table_rows import (PROFILE_ID_V2 as OCR_TABLE_ROWS_EXTRACTION_PROFILE_V2,
                             SCHEMA_VERSION_V2 as OCR_TABLE_ROWS_SCHEMA_V2,
                             PROFILE_ID_V3 as OCR_TABLE_ROWS_EXTRACTION_PROFILE_V3,
                             SCHEMA_VERSION_V3 as OCR_TABLE_ROWS_SCHEMA_V3,
                             extract_ocr_table_rows)
from .fact_family_pack import load_fact_family_pack
from .fact_family_pipeline import execute_durable_fact_family
from .candidate_family_rules import load_candidate_family_pack
from .numeric_family_candidates import load_numeric_family_labels
from .class_family_candidates import load_class_family_labels
from .presence_family_candidates import load_presence_family_labels
from .run_candidate_family_preview import execute_durable_candidate_family_preview
from .durable_candidate_family_observations import execute_durable_candidate_family_observations
from .durable_candidate_family_ocr_observations import execute_durable_candidate_family_ocr_observations
from .unresolved_family_run_review import execute_durable_unresolved_family_run_review
from .unresolved_family_ocr_review import evaluate_unresolved_family_ocr_review
from .site_tep_area_run_review import execute_durable_site_tep_area_run_review
from .site_gp_context_run_review import execute_durable_site_gp_context_run_review
from .site_gp_table_row_proposals import execute_durable_site_gp_table_row_proposals
from .layer_assembly_proposals import execute_durable_layer_assembly_proposals
from .kr065_opening_proposals import execute_durable_kr065_opening_proposals
from .equipment_spec_review import execute_durable_equipment_spec_review
from .material_class_review import execute_durable_material_class_review
from .unresolved_config_review import (
    CODES as UNRESOLVED_CONFIG_CODES, CONFIG_SHA256 as UNRESOLVED_CONFIG_SHA256,
    PROFILE_ID as UNRESOLVED_CONFIG_EXTRACTION_PROFILE,
    SCHEMA_VERSION as UNRESOLVED_CONFIG_SCHEMA_VERSION,
    execute_durable_unresolved_config_review,
)
from .unresolved_config_review_v2 import (
    V2_CODES as UNRESOLVED_CONFIG_V2_CODES,
    V2_CONFIG_SHA256 as UNRESOLVED_CONFIG_V2_SHA256,
    V2_PROFILE_ID as UNRESOLVED_CONFIG_V2_EXTRACTION_PROFILE,
    V2_SCHEMA_VERSION as UNRESOLVED_CONFIG_V2_SCHEMA_VERSION,
    execute_durable_unresolved_config_review_v2,
)
from .unresolved_config_review_v3 import (
    NETWORK_CODES as UNRESOLVED_CONFIG_V3_CODES,
    V3_CONFIG_SHA256 as UNRESOLVED_CONFIG_V3_SHA256,
    V3_PROFILE_ID as UNRESOLVED_CONFIG_V3_EXTRACTION_PROFILE,
    V3_SCHEMA_VERSION as UNRESOLVED_CONFIG_V3_SCHEMA_VERSION,
    execute_durable_unresolved_config_review_v3,
)


CANDIDATE_OCR_OBSERVATIONS_PROFILE = "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1"
OCR_TABLE_ROWS_PROFILE = "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v1"
OCR_TABLE_ROWS_PROFILE_V2 = "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v2"
OCR_TABLE_ROWS_PROFILE_V3 = "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v3"
UNRESOLVED_REVIEW_PROFILE = OCR_TABLE_ROWS_PROFILE_V3 + "-unresolved-review-v1"
UNRESOLVED_OCR_REVIEW_PROFILE = "typed-pz002-pz017-ocr-v6-unresolved-family-review-v1"
SITE_TEP_AREA_REVIEW_PROFILE = "typed-pz002-pz017-site-tep-area-review-v1"
SITE_GP_CONTEXT_REVIEW_PROFILE = "typed-pz002-pz017-site-gp-context-review-v1"
SITE_GP_TABLE_ROW_REVIEW_PROFILE = "typed-pz002-pz017-site-gp-table-row-review-v1"
LAYER_ASSEMBLY_REVIEW_PROFILE = "typed-pz002-pz017-layer-assembly-review-v1"
KR065_OPENING_REVIEW_PROFILE = "typed-pz002-pz017-kr065-opening-review-v1"
EQUIPMENT_SPEC_REVIEW_PROFILE = "typed-pz002-pz017-equipment-spec-review-v1"
MATERIAL_CLASS_REVIEW_PROFILE = "typed-pz002-pz017-material-class-review-v1"
UNRESOLVED_CONFIG_REVIEW_PROFILE = "typed-pz002-pz017-unresolved-config-review-v1"
UNRESOLVED_CONFIG_REVIEW_PROFILE_V2 = "typed-pz002-pz017-unresolved-config-review-v2"
UNRESOLVED_CONFIG_REVIEW_PROFILE_V3 = "typed-pz002-pz017-unresolved-config-review-v3"
OCR_TABLE_ROWS_PROFILES = {OCR_TABLE_ROWS_PROFILE, OCR_TABLE_ROWS_PROFILE_V2,
                           OCR_TABLE_ROWS_PROFILE_V3, UNRESOLVED_REVIEW_PROFILE}
OCR_HEAT_PROFILES = {"typed-pz002-pz017-ocr-heat-v1",
                     "typed-pz002-pz017-ocr-heat-fact-family-v1",
                     "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1",
                     "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1",
                     CANDIDATE_OCR_OBSERVATIONS_PROFILE, *OCR_TABLE_ROWS_PROFILES}
HEAT_PROFILES = {"typed-pz002-pz017-v1", UNRESOLVED_OCR_REVIEW_PROFILE,
                 SITE_TEP_AREA_REVIEW_PROFILE, SITE_GP_CONTEXT_REVIEW_PROFILE,
                 SITE_GP_TABLE_ROW_REVIEW_PROFILE, EQUIPMENT_SPEC_REVIEW_PROFILE,
                 LAYER_ASSEMBLY_REVIEW_PROFILE,
                 KR065_OPENING_REVIEW_PROFILE,
                 MATERIAL_CLASS_REVIEW_PROFILE,
                 UNRESOLVED_CONFIG_REVIEW_PROFILE,
                 UNRESOLVED_CONFIG_REVIEW_PROFILE_V2,
                 UNRESOLVED_CONFIG_REVIEW_PROFILE_V3,
                 *OCR_HEAT_PROFILES}
FACT_FAMILY_PROFILE = "typed-pz002-pz017-ocr-heat-fact-family-v1"
CANDIDATE_PREVIEW_PROFILE = "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1"
CANDIDATE_OBSERVATIONS_PROFILE = "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1"
CANDIDATE_PREVIEW_PROFILES = {CANDIDATE_PREVIEW_PROFILE, CANDIDATE_OBSERVATIONS_PROFILE,
                              CANDIDATE_OCR_OBSERVATIONS_PROFILE, *OCR_TABLE_ROWS_PROFILES}
FACT_FAMILY_PROFILES = {FACT_FAMILY_PROFILE, *CANDIDATE_PREVIEW_PROFILES}


class PilotPz002RuleAdapter:
    job_type = "RULE_EVALUATION"
    provider_kind = "RULE_ENGINE"

    def execute(self, lease: dict[str, Any], attempt: dict[str, Any]) -> dict[str, Any]:
        release = lease.get("release")
        if not isinstance(release, dict) or release.get("lifecycle") != "DRAFT":
            raise ValueError("PZ-002 adapter requires a DRAFT pilot release")
        slot = release.get("providerSlot")
        rules = release.get("rules")
        profile = slot.get("profileId") if isinstance(slot, dict) else None
        if (not isinstance(slot, dict) or slot.get("stageJobType") != self.job_type
                or slot.get("providerKind") != self.provider_kind
                or slot.get("status") != "CONFIGURED"
                or profile not in {"typed-pz002-v1", *HEAT_PROFILES}
                or not isinstance(rules, dict) or rules.get("executionStatus") != "PILOT"
                or not isinstance(rules.get("definitions"), dict)):
            raise ValueError("PZ-002 release has no configured typed rule definitions")
        definitions = rules["definitions"]
        navigation = definitions.get("navigation")
        numeric = definitions.get("numeric")
        if not isinstance(navigation, dict) or not isinstance(numeric, dict):
            raise ValueError("PZ-002 release rule definitions are invalid")
        if profile in HEAT_PROFILES and definitions.get("heat") != {
            "ruleId": "pilot-pz-017-heat", "version": "1", "parameterCode": "PZ-017",
            "extractionProfile": "pz-017-heat-components-v1",
        }:
            raise ValueError("PZ-017 release rule definition is invalid")
        if profile in OCR_HEAT_PROFILES and definitions.get("ocrHeatRows") != {
            "ruleId": "pilot-pz-017-ocr-heat-review", "version": "1",
            "parameterCode": "PZ-017", "extractionProfile": "conservative-ocr-heat-rows-v1",
            "disposition": "REVIEW_AID_ONLY",
        }:
            raise ValueError("OCR heat review release rule definition is invalid")
        if profile not in OCR_HEAT_PROFILES and "ocrHeatRows" in definitions:
            raise ValueError("OCR heat review cannot run under an older release")
        if profile in FACT_FAMILY_PROFILES:
            pack = load_fact_family_pack()
            expected_fact_family = {
                "ruleId": "pilot-fact-family-review", "version": "1",
                "extractionProfile": "fact-family-pilot-v1",
                "packSha256": pack["packSha256"],
                "disposition": "REVIEW_AID_ONLY",
                "rules": pack["rules"],
            }
            if definitions.get("factFamily") != expected_fact_family:
                raise ValueError("fact family release rule definition is invalid")
        elif "factFamily" in definitions:
            raise ValueError("fact family review cannot run under an older release")
        if profile in CANDIDATE_PREVIEW_PROFILES:
            candidate_pack = load_candidate_family_pack()
            numeric_labels = load_numeric_family_labels()
            classes = load_class_family_labels()
            presence = load_presence_family_labels()
            if definitions.get("candidateFamilyPreview") != {
                    "ruleId": "pilot-candidate-family-preview", "version": "1",
                    "extractionProfile": "candidate-family-preview-v1",
                    "candidateRulePackSha256": candidate_pack["packSha256"],
                    "numericLabelPackSha256": numeric_labels["labelPackSha256"],
                    "classLabelPackSha256": classes["labelPackSha256"],
                    "presenceLabelPackSha256": presence["labelPackSha256"],
                    "codeCount": 47, "disposition": "REVIEW_AID_ONLY"}:
                raise ValueError("candidate preview release definition is invalid")
        elif "candidateFamilyPreview" in definitions:
            raise ValueError("candidate preview cannot run under an older release")
        if profile in {CANDIDATE_OBSERVATIONS_PROFILE, CANDIDATE_OCR_OBSERVATIONS_PROFILE,
                       *OCR_TABLE_ROWS_PROFILES}:
            if definitions.get("candidateFamilyObservations") != {
                    "ruleId": "pilot-candidate-family-observations", "version": "1",
                    "extractionProfile": "candidate-family-observations-v1",
                    "candidateRulePackSha256": candidate_pack["packSha256"],
                    "numericLabelPackSha256": numeric_labels["labelPackSha256"],
                    "classLabelPackSha256": classes["labelPackSha256"],
                    "presenceLabelPackSha256": presence["labelPackSha256"],
                    "codeCount": 47, "disposition": "REVIEW_AID_ONLY"}:
                raise ValueError("candidate observations release definition is invalid")
        elif "candidateFamilyObservations" in definitions:
            raise ValueError("candidate observations cannot run under an older release")
        if profile in {CANDIDATE_OCR_OBSERVATIONS_PROFILE, *OCR_TABLE_ROWS_PROFILES}:
            if definitions.get("candidateFamilyOcrObservations") != {
                    "ruleId": "pilot-candidate-family-ocr-observations", "version": "1",
                    "extractionProfile": "candidate-family-ocr-observations-v1",
                    "candidateRulePackSha256": candidate_pack["packSha256"],
                    "numericLabelPackSha256": numeric_labels["labelPackSha256"],
                    "classLabelPackSha256": classes["labelPackSha256"],
                    "presenceLabelPackSha256": presence["labelPackSha256"],
                    "codeCount": 47, "disposition": "REVIEW_AID_ONLY"}:
                raise ValueError("candidate OCR observations release definition is invalid")
        elif "candidateFamilyOcrObservations" in definitions:
            raise ValueError("candidate OCR observations cannot run under an older release")
        if profile in OCR_TABLE_ROWS_PROFILES:
            table_version = ("3" if profile in {OCR_TABLE_ROWS_PROFILE_V3,
                                               UNRESOLVED_REVIEW_PROFILE} else
                             "2" if profile == OCR_TABLE_ROWS_PROFILE_V2 else "1")
            if definitions.get("ocrTableRows") != {
                    "ruleId": "pilot-ocr-table-rows-review",
                    "version": table_version,
                    "extractionProfile": f"conservative-ocr-table-rows-v{table_version}",
                    "disposition": "REVIEW_AID_ONLY"}:
                raise ValueError("OCR table rows release rule definition is invalid")
        elif "ocrTableRows" in definitions:
            raise ValueError("OCR table rows cannot run under an older release")
        if profile == UNRESOLVED_REVIEW_PROFILE:
            if definitions.get("unresolvedFamilyReview") != {
                    "ruleId": "pilot-unresolved-family-text-review", "version": "1",
                    "extractionProfile": "unresolved-family-text-review-v1",
                    "codeCount": 3, "disposition": "REVIEW_AID_ONLY"}:
                raise ValueError("unresolved family release rule definition is invalid")
        elif "unresolvedFamilyReview" in definitions:
            raise ValueError("unresolved family review cannot run under an older release")
        if profile == UNRESOLVED_OCR_REVIEW_PROFILE:
            if definitions.get("unresolvedFamilyOcrReview") != {
                    "ruleId": "pilot-unresolved-family-ocr-review", "version": "1",
                    "extractionProfile": "unresolved-family-ocr-review-v1",
                    "codeCount": 3, "disposition": "REVIEW_AID_ONLY"}:
                raise ValueError("unresolved family OCR release rule definition is invalid")
        elif "unresolvedFamilyOcrReview" in definitions:
            raise ValueError("unresolved family OCR review cannot run under an older release")
        if profile == SITE_TEP_AREA_REVIEW_PROFILE:
            if definitions.get("siteTepAreaReview") != {
                    "ruleId": "pilot-site-tep-area-review", "version": "1",
                    "extractionProfile": "site-tep-area-text-review-v1",
                    "codeCount": 3, "disposition": "REVIEW_AID_ONLY"}:
                raise ValueError("site TEP area review release rule definition is invalid")
        elif "siteTepAreaReview" in definitions:
            raise ValueError("site TEP area review cannot run under an older release")
        if profile == SITE_GP_CONTEXT_REVIEW_PROFILE:
            if definitions.get("siteGpContextReview") != {
                    "ruleId": "pilot-site-gp-context-review", "version": "1",
                    "extractionProfile": "site-gp-context-text-review-v1",
                    "codeCount": 5, "disposition": "REVIEW_AID_ONLY"}:
                raise ValueError("site GP context review release rule definition is invalid")
        elif "siteGpContextReview" in definitions:
            raise ValueError("site GP context review cannot run under an older release")
        if profile == SITE_GP_TABLE_ROW_REVIEW_PROFILE:
            if definitions.get("siteGpTableRowReview") != {
                    "ruleId": "pilot-site-gp-table-row-review", "version": "1",
                    "extractionProfile": "site-gp-table-row-review-v1",
                    "codeCount": 2, "disposition": "REVIEW_AID_ONLY"}:
                raise ValueError("site GP table row release rule definition is invalid")
        elif "siteGpTableRowReview" in definitions:
            raise ValueError("site GP table row review cannot run under an older release")
        if profile == LAYER_ASSEMBLY_REVIEW_PROFILE:
            if definitions.get("layerAssemblyReview") != {
                    "ruleId": "pilot-layer-assembly-review-v1", "version": "1",
                    "extractionProfile": "layer-assembly-review-v1",
                    "codeCount": 3, "disposition": "REVIEW_AID_ONLY"}:
                raise ValueError("layer assembly release rule definition is invalid")
            if slot.get("adapterVersion") != "20":
                raise ValueError("layer assembly release adapter version is invalid")
        elif "layerAssemblyReview" in definitions:
            raise ValueError("layer assembly review cannot run under an older release")
        if profile == KR065_OPENING_REVIEW_PROFILE:
            if definitions.get("kr065OpeningReview") != {
                    "ruleId": "pilot-kr065-opening-review-v1", "version": "1",
                    "extractionProfile": "kr065-opening-review-v1",
                    "codeCount": 1, "disposition": "REVIEW_AID_ONLY"}:
                raise ValueError("KR-065 opening release rule definition is invalid")
            if slot.get("adapterVersion") != "21":
                raise ValueError("KR-065 opening release adapter version is invalid")
        elif "kr065OpeningReview" in definitions:
            raise ValueError("KR-065 opening review cannot run under an older release")
        if profile == EQUIPMENT_SPEC_REVIEW_PROFILE:
            if definitions.get("equipmentSpecReview") != {
                    "ruleId": "pilot-equipment-spec-review", "version": "1",
                    "extractionProfile": "equipment-spec-text-navigation-v1",
                    "codeCount": 3, "disposition": "REVIEW_AID_ONLY"}:
                raise ValueError("equipment spec release rule definition is invalid")
        elif "equipmentSpecReview" in definitions:
            raise ValueError("equipment spec review cannot run under an older release")
        if profile == MATERIAL_CLASS_REVIEW_PROFILE:
            if definitions.get("materialClassReview") != {
                    "ruleId": "pilot-material-class-review", "version": "1",
                    "extractionProfile": "material-class-text-navigation-v1",
                    "codeCount": 3, "disposition": "REVIEW_AID_ONLY"}:
                raise ValueError("material class release rule definition is invalid")
        elif "materialClassReview" in definitions:
            raise ValueError("material class review cannot run under an older release")
        if profile == UNRESOLVED_CONFIG_REVIEW_PROFILE:
            if definitions.get("unresolvedConfigReview") != {
                    "ruleId": "pilot-unresolved-config-review", "version": "1",
                    "extractionProfile": UNRESOLVED_CONFIG_EXTRACTION_PROFILE,
                    "configSha256": UNRESOLVED_CONFIG_SHA256,
                    "codeCount": len(UNRESOLVED_CONFIG_CODES),
                    "disposition": "REVIEW_AID_ONLY"}:
                raise ValueError("unresolved config release rule definition is invalid")
        elif "unresolvedConfigReview" in definitions:
            raise ValueError("unresolved config review cannot run under an older release")
        if profile == UNRESOLVED_CONFIG_REVIEW_PROFILE_V2:
            if definitions.get("unresolvedConfigReviewV2") != {
                    "ruleId": "pilot-unresolved-config-review-v2", "version": "1",
                    "extractionProfile": UNRESOLVED_CONFIG_V2_EXTRACTION_PROFILE,
                    "configSha256": UNRESOLVED_CONFIG_V2_SHA256,
                    "codeCount": len(UNRESOLVED_CONFIG_V2_CODES),
                    "disposition": "REVIEW_AID_ONLY"}:
                raise ValueError("unresolved config v2 release rule definition is invalid")
        elif "unresolvedConfigReviewV2" in definitions:
            raise ValueError("unresolved config v2 cannot run under an older release")
        if profile == UNRESOLVED_CONFIG_REVIEW_PROFILE_V3:
            if definitions.get("unresolvedConfigReviewV3") != {
                    "ruleId": "pilot-unresolved-config-review-v3", "version": "1",
                    "extractionProfile": UNRESOLVED_CONFIG_V3_EXTRACTION_PROFILE,
                    "configSha256": UNRESOLVED_CONFIG_V3_SHA256,
                    "codeCount": len(UNRESOLVED_CONFIG_V3_CODES),
                    "disposition": "REVIEW_AID_ONLY"}:
                raise ValueError("unresolved config v3 release rule definition is invalid")
        elif "unresolvedConfigReviewV3" in definitions:
            raise ValueError("unresolved config v3 cannot run under an older release")
        canonical = json.dumps(definitions, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        config_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        if slot.get("configHash") != config_hash:
            raise ValueError("PZ-002 rule definitions do not match immutable release hash")
        manifest_hash = lease.get("inputManifestHash")
        if not isinstance(manifest_hash, str) or re.fullmatch(r"[a-f0-9]{64}", manifest_hash) is None:
            raise ValueError("PZ-002 lease has no immutable manifest hash")
        analysis = execute_durable_pz002(lease, attempt, navigation, numeric)
        if analysis.get("selectedManifestHash") != manifest_hash:
            raise ValueError("PZ-002 analysis manifest hash mismatch")
        evaluation = analysis.get("evaluation")
        if (isinstance(evaluation, dict) and evaluation.get("machineStatus") == "CANDIDATE"
                and any(isinstance(item, dict) and item.get("evidenceKind") == "OCR"
                        for item in evaluation.get("evidence", []))):
            # The server has an independent verifier only for committed text
            # blocks. Preserve OCR evidence, but never submit it as a finding.
            analysis = {**analysis, "evaluation": {
                **evaluation, "machineStatus": "CLARIFICATION_REQUIRED",
                "reasonCode": "OCR_CANDIDATE_REQUIRES_INDEPENDENT_REVIEW",
                "evidenceFingerprint": None,
            }}
        result = {
            "schemaVersion": "analysis-stage-result-v2",
            "jobType": self.job_type,
            "inputManifestHash": manifest_hash,
            "disposition": "RULES_EVALUATED",
            "providerKind": self.provider_kind,
            "providerProfileId": slot["profileId"],
            "providerConfigHash": config_hash,
            "outputCount": 9 if profile == UNRESOLVED_REVIEW_PROFILE else
                           8 if profile in OCR_TABLE_ROWS_PROFILES else
                           7 if profile == CANDIDATE_OCR_OBSERVATIONS_PROFILE else
                           6 if profile == CANDIDATE_OBSERVATIONS_PROFILE else
                           5 if profile == CANDIDATE_PREVIEW_PROFILE else
                           4 if profile == FACT_FAMILY_PROFILE else
                           3 if (profile in OCR_HEAT_PROFILES
                                 or profile in {UNRESOLVED_OCR_REVIEW_PROFILE,
                                                SITE_TEP_AREA_REVIEW_PROFILE,
                                                SITE_GP_CONTEXT_REVIEW_PROFILE,
                                                SITE_GP_TABLE_ROW_REVIEW_PROFILE,
                                                LAYER_ASSEMBLY_REVIEW_PROFILE,
                                                KR065_OPENING_REVIEW_PROFILE,
                                                EQUIPMENT_SPEC_REVIEW_PROFILE,
                                                MATERIAL_CLASS_REVIEW_PROFILE,
                                                UNRESOLVED_CONFIG_REVIEW_PROFILE,
                                                UNRESOLVED_CONFIG_REVIEW_PROFILE_V2,
                                                UNRESOLVED_CONFIG_REVIEW_PROFILE_V3}) else
                           2 if profile == "typed-pz002-pz017-v1" else 1,
            "analysis": analysis,
        }
        if profile in HEAT_PROFILES:
            result["heatLoad"] = execute_durable_pz017(lease, attempt)
            if result["heatLoad"].get("selectedManifestHash") != manifest_hash:
                raise ValueError("PZ-017 analysis manifest hash mismatch")
        if profile == UNRESOLVED_OCR_REVIEW_PROFILE:
            inputs = lease.get("inputs")
            if (not isinstance(inputs, dict) or not isinstance(inputs.get("sourceFiles"), list)
                    or not isinstance(inputs.get("sourceDecisions"), dict)):
                raise ValueError("unresolved family OCR review requires immutable sources and decisions")
            ocr_slot = release.get("ocrLayoutSlot")
            if (not isinstance(ocr_slot, dict) or ocr_slot.get("profileId") != PROFILE_ID_V6
                    or ocr_slot.get("configHash") != PROFILE_HASH_V6):
                raise ValueError("unresolved family OCR review requires immutable OCR v6 release selection")
            ocr_stage = download_ocr_layout_artifact(lease, attempt)
            if (ocr_stage.get("provider_profile_id") != PROFILE_ID_V6
                    or ocr_stage.get("provider_config_hash") != PROFILE_HASH_V6):
                raise ValueError("unresolved family OCR review requires committed OCR v6 stage")
            sources = inputs["sourceFiles"]
            texts = [download_text_artifact(lease, source, attempt) for source in sources
                     if isinstance(source, dict) and source.get("mediaType") == "application/pdf"]
            result["unresolvedFamilyOcrReview"] = evaluate_unresolved_family_ocr_review(
                lease.get("objectId"), manifest_hash,
                [{"objectId": lease.get("objectId"), **source} if isinstance(source, dict)
                 else source for source in sources], inputs["sourceDecisions"], texts,
                ocr_stage["content_json"], stage_sha256=ocr_stage["content_hash"])
            review = result["unresolvedFamilyOcrReview"]
            if (review.get("inputManifestHash") != manifest_hash
                    or len(review.get("codeRows", [])) != 3
                    or any(row.get("status") != "ABSTAIN" for row in review["codeRows"])
                    or review.get("findingCount") is not None
                    or review.get("parameterCoverage") is not None):
                raise ValueError("unresolved family OCR review-only output invalid")
        if profile in OCR_HEAT_PROFILES:
            inputs = lease.get("inputs")
            if (not isinstance(inputs, dict)
                    or not isinstance(inputs.get("sourceDecisions"), dict)
                    or not isinstance(inputs.get("sourceFiles"), list)):
                raise ValueError("OCR heat review requires immutable source manifest and decisions")
            ocr_stage = download_ocr_layout_artifact(lease, attempt)
            if profile in OCR_TABLE_ROWS_PROFILES:
                stage_profile = ocr_stage["content_json"].get("providerProfileId")
                pinned_hash = {PROFILE_ID_V4: PROFILE_HASH_V4,
                               PROFILE_ID_V5: PROFILE_HASH_V5}.get(stage_profile)
                ocr_slot = release.get("ocrLayoutSlot")
                if (pinned_hash is None or not isinstance(ocr_slot, dict)
                        or ocr_slot.get("profileId") != stage_profile
                        or ocr_slot.get("configHash") != pinned_hash):
                    raise ValueError("OCR table rows require immutable bounded OCR v4/v5 release selection")
            if ocr_stage["content_json"].get("providerProfileId") == PROFILE_ID_V5:
                ocr_slot = release.get("ocrLayoutSlot")
                if (not isinstance(ocr_slot, dict)
                        or ocr_slot.get("profileId") != PROFILE_ID_V5
                        or ocr_slot.get("configHash") != PROFILE_HASH_V5):
                    raise ValueError("bounded OCR v5 stage is outside immutable release selection")
            result["ocrHeatRows"] = extract_ocr_heat_rows(
                ocr_stage["content_json"], inputs["sourceDecisions"], inputs["sourceFiles"])
            if result["ocrHeatRows"].get("inputManifestHash") != manifest_hash:
                raise ValueError("OCR heat review manifest hash mismatch")
        if profile in FACT_FAMILY_PROFILES:
            result["factFamily"] = execute_durable_fact_family(lease, attempt)
            if result["factFamily"].get("inputManifestHash") != manifest_hash:
                raise ValueError("fact family review manifest hash mismatch")
        if profile == CANDIDATE_PREVIEW_PROFILE:
            result["candidateFamilyPreview"] = execute_durable_candidate_family_preview(lease, attempt)
            if result["candidateFamilyPreview"].get("inputManifestHash") != manifest_hash:
                raise ValueError("candidate preview manifest hash mismatch")
        if profile == CANDIDATE_OBSERVATIONS_PROFILE:
            review_aids = execute_durable_candidate_family_observations(lease, attempt)
            if (review_aids["candidateFamilyPreview"].get("inputManifestHash") != manifest_hash
                    or review_aids["candidateFamilyObservations"].get("inputManifestHash") != manifest_hash
                    or review_aids["reviewCandidates"].get("inputManifestHash") != manifest_hash):
                raise ValueError("candidate observations manifest hash mismatch")
            result.update(review_aids)
        if profile in {CANDIDATE_OCR_OBSERVATIONS_PROFILE, *OCR_TABLE_ROWS_PROFILES}:
            review_aids = execute_durable_candidate_family_ocr_observations(
                lease, attempt, ocr_stage["content_json"])
            if any(review_aids[key].get("inputManifestHash") != manifest_hash for key in (
                    "candidateFamilyPreview", "candidateFamilyObservations",
                    "candidateFamilyOcrObservations", "reviewCandidates")):
                raise ValueError("candidate OCR observations manifest hash mismatch")
            result.update(review_aids)
        if profile in OCR_TABLE_ROWS_PROFILES:
            stage_sha256 = ocr_stage.get("content_hash")
            if not isinstance(stage_sha256, str) or re.fullmatch(r"[a-f0-9]{64}", stage_sha256) is None:
                raise ValueError("OCR table rows require committed stage SHA-256")
            extraction_options = ({"profile_id": OCR_TABLE_ROWS_EXTRACTION_PROFILE_V3}
                                  if profile in {OCR_TABLE_ROWS_PROFILE_V3, UNRESOLVED_REVIEW_PROFILE} else
                                  {"profile_id": OCR_TABLE_ROWS_EXTRACTION_PROFILE_V2}
                                  if profile == OCR_TABLE_ROWS_PROFILE_V2 else {})
            result["ocrTableRows"] = extract_ocr_table_rows(
                ocr_stage["content_json"], stage_sha256=stage_sha256, **extraction_options)
            if result["ocrTableRows"].get("inputManifestHash") != manifest_hash:
                raise ValueError("OCR table rows manifest hash mismatch")
            if profile == OCR_TABLE_ROWS_PROFILE_V2 and (
                    result["ocrTableRows"].get("schemaVersion") != OCR_TABLE_ROWS_SCHEMA_V2
                    or result["ocrTableRows"].get("profileId") != OCR_TABLE_ROWS_EXTRACTION_PROFILE_V2
                    or result["ocrTableRows"].get("findingCount") != 0):
                raise ValueError("OCR table rows v2 extraction profile mismatch")
            if profile in {OCR_TABLE_ROWS_PROFILE_V3, UNRESOLVED_REVIEW_PROFILE} and (
                    result["ocrTableRows"].get("schemaVersion") != OCR_TABLE_ROWS_SCHEMA_V3
                    or result["ocrTableRows"].get("profileId") != OCR_TABLE_ROWS_EXTRACTION_PROFILE_V3
                    or result["ocrTableRows"].get("findingCount") != 0):
                raise ValueError("OCR table rows v3 extraction profile mismatch")
        if profile == UNRESOLVED_REVIEW_PROFILE:
            result["unresolvedFamilyReview"] = execute_durable_unresolved_family_run_review(
                lease, attempt)
            if result["unresolvedFamilyReview"].get("inputManifestHash") != manifest_hash:
                raise ValueError("unresolved family review manifest hash mismatch")
        if profile == SITE_TEP_AREA_REVIEW_PROFILE:
            result["siteTepAreaReview"] = execute_durable_site_tep_area_run_review(
                lease, attempt)
            review = result["siteTepAreaReview"]
            if (review.get("schemaVersion") != "site-tep-area-run-review-v1"
                    or review.get("profileId") != "site-tep-area-text-review-v1"
                    or review.get("purpose") != "REVIEW_ONLY"
                    or review.get("inputManifestHash") != manifest_hash
                    or [row.get("parameterCode") for row in review.get("codeRows", [])]
                    != ["PZ-001", "SPZU-026", "SPZU-027"]
                    or any(row.get("status") != "ABSTAIN" for row in review["codeRows"])
                    or review.get("findingCount") is not None
                    or review.get("parameterCoverage") is not None):
                raise ValueError("site TEP area review-only output invalid")
        if profile == SITE_GP_CONTEXT_REVIEW_PROFILE:
            result["siteGpContextReview"] = execute_durable_site_gp_context_run_review(
                lease, attempt)
            review = result["siteGpContextReview"]
            if (review.get("schemaVersion") != "site-gp-context-run-review-v1"
                    or review.get("profileId") != "site-gp-context-text-review-v1"
                    or review.get("purpose") != "REVIEW_ONLY"
                    or review.get("inputManifestHash") != manifest_hash
                    or [row.get("parameterCode") for row in review.get("codeRows", [])]
                    != ["SPZU-029", "SPZU-032", "SPZU-033", "SPZU-035", "SPZU-036"]
                    or any(row.get("status") != "ABSTAIN" for row in review["codeRows"])
                    or review.get("findingCount") is not None
                    or review.get("parameterCoverage") is not None):
                raise ValueError("site GP context review-only output invalid")
        if profile == SITE_GP_TABLE_ROW_REVIEW_PROFILE:
            result["siteGpTableRowReview"] = execute_durable_site_gp_table_row_proposals(
                lease, attempt)
            review = result["siteGpTableRowReview"]
            rows = review.get("codeRows", [])
            if (review.get("schemaVersion") != "site-gp-table-row-proposals-v1"
                    or review.get("profileId") != "site-gp-table-row-review-v1"
                    or review.get("purpose") != "REVIEW_ONLY"
                    or review.get("inputManifestHash") != manifest_hash
                    or [row.get("parameterCode") for row in rows]
                    != ["SPZU-029", "SPZU-032"]
                    or any(row.get("status") != "ABSTAIN" for row in rows)
                    or review.get("findingCount") is not None
                    or review.get("parameterCoverage") is not None
                    or any(not isinstance(row.get("proposals"), list) for row in rows)
                    or any(proposal.get("rowAssociationStatus") != "UNVERIFIED"
                           or proposal.get("reasonCodes") != ["ROW_ASSOCIATION_UNVERIFIED"]
                           or "value" in proposal or "rawValue" in proposal
                           or (row["parameterCode"] == "SPZU-029" and
                               (proposal.get("rawQuantity") is not None
                                or proposal.get("quantityStatus") != "UNKNOWN"))
                           for row in rows for proposal in row["proposals"])):
                raise ValueError("site GP table row review-only output invalid")
        if profile == LAYER_ASSEMBLY_REVIEW_PROFILE:
            result["layerAssemblyReview"] = execute_durable_layer_assembly_proposals(
                lease, attempt)
            review = result["layerAssemblyReview"]
            rows = review.get("codeRows", [])
            if (review.get("schemaVersion") != "layer-assembly-proposals-v1"
                    or review.get("profileId") != "layer-assembly-review-v1"
                    or review.get("purpose") != "REVIEW_ONLY"
                    or review.get("inputManifestHash") != manifest_hash
                    or [row.get("parameterCode") for row in rows]
                    != ["SPZU-032", "AR-044", "ZU-125"]
                    or any(row.get("status") != "ABSTAIN"
                           or row.get("absenceConclusion") != "NOT_AVAILABLE"
                           or not isinstance(row.get("proposals"), list)
                           for row in rows)
                    or review.get("findingCount") is not None
                    or review.get("parameterCoverage") is not None
                    or rows[0].get("proposals") != []
                    or "EXISTING_SITE_GP_TABLE_ROW_REVIEW" not in rows[0].get("reasonCodes", [])
                    or any(proposal.get("rowAssociationStatus") != "UNVERIFIED"
                           or proposal.get("typeAssociationStatus") != "UNVERIFIED"
                           or proposal.get("zoneAssociationStatus") != "UNVERIFIED"
                           or proposal.get("rawThickness") is not None
                           or proposal.get("rawQuantity") is not None
                           or "value" in proposal or "rawValue" in proposal
                           for row in rows for proposal in row["proposals"])):
                raise ValueError("layer assembly review-only output invalid")
        if profile == KR065_OPENING_REVIEW_PROFILE:
            result["kr065OpeningReview"] = execute_durable_kr065_opening_proposals(
                lease, attempt)
            review = result["kr065OpeningReview"]
            rows = review.get("codeRows", [])
            if (review.get("schemaVersion") != "kr065-opening-proposals-v1"
                    or review.get("profileId") != "kr065-opening-review-v1"
                    or review.get("purpose") != "REVIEW_ONLY"
                    or review.get("inputManifestHash") != manifest_hash
                    or [row.get("parameterCode") for row in rows] != ["KR-065"]
                    or rows[0].get("status") != "ABSTAIN"
                    or rows[0].get("absenceConclusion") != "NOT_AVAILABLE"
                    or not isinstance(rows[0].get("proposals"), list)
                    or review.get("findingCount") is not None
                    or review.get("parameterCoverage") is not None
                    or any(proposal.get("drawingContourAssociation") != "UNVERIFIED"
                           or proposal.get("detailAssociation") != "UNVERIFIED"
                           or proposal.get("sameElementAssociation") != "UNVERIFIED"
                           or proposal.get("reinforcementStatus") != "NOT_ESTABLISHED"
                           or proposal.get("unauthorizedFillStatus") != "NOT_ESTABLISHED"
                           or proposal.get("rawAxes") is not None
                           or proposal.get("rawLevel") is not None
                           or "value" in proposal or "finding" in proposal
                           for proposal in rows[0]["proposals"])):
                raise ValueError("KR-065 opening review-only output invalid")
        if profile == EQUIPMENT_SPEC_REVIEW_PROFILE:
            result["equipmentSpecReview"] = execute_durable_equipment_spec_review(
                lease, attempt)
            review = result["equipmentSpecReview"]
            rows = review.get("codeRows", [])
            if (review.get("schemaVersion") != "equipment-spec-run-review-v1"
                    or review.get("profileId") != "equipment-spec-text-navigation-v1"
                    or review.get("purpose") != "REVIEW_ONLY"
                    or review.get("inputManifestHash") != manifest_hash
                    or [row.get("parameterCode") for row in rows]
                    != ["IOS4-077", "IOS4-079", "PPM-112"]
                    or any(row.get("status") != "ABSTAIN" for row in rows)
                    or review.get("findingCount") is not None
                    or review.get("parameterCoverage") is not None
                    or any(not isinstance(row.get("leads"), list) for row in rows)
                    or any(lead.get("rowAssociationStatus") != "UNVERIFIED"
                           or lead.get("systemAssignmentStatus") != "UNVERIFIED"
                           or "value" in lead or "rawValue" in lead or "quantity" in lead
                           for row in rows for lead in row["leads"])):
                raise ValueError("equipment spec review-only output invalid")
        if profile == MATERIAL_CLASS_REVIEW_PROFILE:
            result["materialClassReview"] = execute_durable_material_class_review(
                lease, attempt)
            review = result["materialClassReview"]
            rows = review.get("codeRows", [])
            if (review.get("schemaVersion") != "material-class-run-review-v1"
                    or review.get("profileId") != "material-class-text-navigation-v1"
                    or review.get("purpose") != "REVIEW_ONLY"
                    or review.get("inputManifestHash") != manifest_hash
                    or [row.get("parameterCode") for row in rows]
                    != ["KR-056", "KR-057", "KR-066"]
                    or any(row.get("status") != "ABSTAIN" for row in rows)
                    or review.get("findingCount") is not None
                    or review.get("parameterCoverage") is not None
                    or any(not isinstance(row.get("leads"), list) for row in rows)
                    or any(lead.get("elementAssociationStatus") != "UNVERIFIED"
                           or lead.get("crossFileMatchStatus") != "UNVERIFIED"
                           or (row["parameterCode"] == "KR-066" and
                               lead.get("actualProtectionStatus") != "NOT_ESTABLISHED")
                           or "value" in lead or "rawValue" in lead
                           or "elementId" in lead or "materialGrade" in lead
                           for row in rows for lead in row["leads"])):
                raise ValueError("material class review-only output invalid")
        if profile == UNRESOLVED_CONFIG_REVIEW_PROFILE:
            result["unresolvedConfigReview"] = execute_durable_unresolved_config_review(
                lease, attempt)
            review = result["unresolvedConfigReview"]
            rows = review.get("codeRows", [])
            if (review.get("schemaVersion") != UNRESOLVED_CONFIG_SCHEMA_VERSION
                    or review.get("profileId") != UNRESOLVED_CONFIG_EXTRACTION_PROFILE
                    or review.get("configSha256") != UNRESOLVED_CONFIG_SHA256
                    or review.get("purpose") != "REVIEW_ONLY"
                    or review.get("inputManifestHash") != manifest_hash
                    or [row.get("parameterCode") for row in rows]
                    != list(UNRESOLVED_CONFIG_CODES)
                    or any(row.get("status") != "ABSTAIN" for row in rows)
                    or review.get("findingCount") is not None
                    or review.get("parameterCoverage") is not None
                    or any(not isinstance(row.get("leads"), list) for row in rows)
                    or any(lead.get("locatorType") != "TEXT_LINE_BBOX_ONLY"
                           or lead.get("elementAssociationStatus") != "UNVERIFIED"
                           or "value" in lead or "rawValue" in lead
                           or "elementId" in lead or "finding" in lead
                           for row in rows for lead in row["leads"])):
                raise ValueError("unresolved config review-only output invalid")
        if profile == UNRESOLVED_CONFIG_REVIEW_PROFILE_V2:
            result["unresolvedConfigReviewV2"] = execute_durable_unresolved_config_review_v2(
                lease, attempt)
            review = result["unresolvedConfigReviewV2"]
            rows = review.get("codeRows", [])
            if (review.get("schemaVersion") != UNRESOLVED_CONFIG_V2_SCHEMA_VERSION
                    or review.get("profileId") != UNRESOLVED_CONFIG_V2_EXTRACTION_PROFILE
                    or review.get("configSha256") != UNRESOLVED_CONFIG_V2_SHA256
                    or review.get("purpose") != "REVIEW_ONLY"
                    or review.get("inputManifestHash") != manifest_hash
                    or [row.get("parameterCode") for row in rows]
                    != list(UNRESOLVED_CONFIG_V2_CODES)
                    or any(row.get("status") != "ABSTAIN" for row in rows)
                    or review.get("findingCount") is not None
                    or review.get("parameterCoverage") is not None
                    or any(not isinstance(row.get("leads"), list) or
                           row.get("absenceConclusion") != "NOT_AVAILABLE" for row in rows)
                    or any(lead.get("locatorType") != "TEXT_LINE_BBOX_ONLY"
                           or lead.get("elementAssociationStatus") != "UNVERIFIED"
                           or "value" in lead or "rawValue" in lead
                           or "elementId" in lead or "finding" in lead
                           for row in rows for lead in row["leads"])):
                raise ValueError("unresolved config v2 review-only output invalid")
        if profile == UNRESOLVED_CONFIG_REVIEW_PROFILE_V3:
            result["unresolvedConfigReviewV3"] = execute_durable_unresolved_config_review_v3(
                lease, attempt)
            review = result["unresolvedConfigReviewV3"]
            rows = review.get("codeRows", [])
            if (review.get("schemaVersion") != UNRESOLVED_CONFIG_V3_SCHEMA_VERSION
                    or review.get("profileId") != UNRESOLVED_CONFIG_V3_EXTRACTION_PROFILE
                    or review.get("configSha256") != UNRESOLVED_CONFIG_V3_SHA256
                    or review.get("purpose") != "REVIEW_ONLY"
                    or review.get("inputManifestHash") != manifest_hash
                    or [row.get("parameterCode") for row in rows]
                    != list(UNRESOLVED_CONFIG_V3_CODES)
                    or any(row.get("status") != "ABSTAIN" for row in rows)
                    or review.get("findingCount") is not None
                    or review.get("parameterCoverage") is not None
                    or any(not isinstance(row.get("leads"), list) or
                           row.get("absenceConclusion") != "NOT_AVAILABLE" for row in rows)
                    or any(lead.get("locatorType") != "TEXT_LINE_BBOX_ONLY"
                           or lead.get("elementAssociationStatus") != "UNVERIFIED"
                           or "value" in lead or "rawValue" in lead
                           or "elementId" in lead or "finding" in lead
                           for row in rows for lead in row["leads"])):
                raise ValueError("unresolved config v3 review-only output invalid")
        if len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > 6 * 1024 * 1024:
            raise ValueError("pilot rule stage result exceeds 6 MiB")
        return result
