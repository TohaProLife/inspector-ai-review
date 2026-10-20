import {parseSteelComparisonScopeDecision} from "./matrix-steel-review.js";
import type {MatrixPreparationBudgetV13} from './postgres-matrix-preparation-budget-v13.js';
import type { PoolClient } from "pg";
import type { DocumentTextV3Artifact, DocumentTextV3AuditSourceRead } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { readDocumentTextV3Artifact } from "./document-text-v3.js";
import { validateDocumentTextV3AuditRelease } from "./document-text-v3-audit-release.js";

type Origin = Omit<DocumentTextV3AuditSourceRead, "pageStages" | "latestReviewHash">;
const SHA = /^[a-f0-9]{64}$/u;
/** Separate source-only reader. Never widens the v2 engineering origin loader. */
export async function loadDocumentTextV3AuditSource(client: PoolClient, objectId: string, checkId: string,
  sourceFileId: string, unconfiguredScaffold: unknown, budget?: MatrixPreparationBudgetV13): Promise<Origin | undefined> {
  if (budget !== undefined) await budget.runByCheck(checkId);
  const run = (await client.query(`SELECT run.id, run.inspection_id, run.release_id,
      manifest.sha256 AS manifest_hash, manifest.canonical_json AS manifest_json,
      release.content_json AS release_json, release.content_hash AS release_hash, release.byte_size AS release_bytes
    FROM analysis_runs run
    JOIN input_manifests manifest ON manifest.id=run.manifest_id AND manifest.inspection_id=run.inspection_id
    JOIN analysis_releases release ON release.release_id=run.release_id
    WHERE run.object_id=$1 AND run.api_id=$2 AND run.mode='NORMAL'
      AND run.run_state IN ('PARTIAL','SUCCEEDED') AND run.sealed_at IS NOT NULL`, [objectId, checkId])).rows;
  if (run.length !== 1) return undefined;
  const selected = run[0], release = selected.release_json;
  if (!release || !validateDocumentTextV3AuditRelease(release.textLayer)) return undefined;
  // Reconstruct the complete known unconfigured identity with its HISTORICAL text pins.
  // Shape/hash validity alone never converts an arbitrary configured release into an audit release.
  const { releaseId: _scaffoldId, ...base } = unconfiguredScaffold as Record<string, unknown>;
  const identity = { ...base, lifecycle: "DRAFT", purpose: "SOURCE_AUDIT_ONLY", textLayer: release.textLayer };
  const expectedId = `release:source-audit-v3:${sha256(canonicalJson(identity)).slice(0, 24)}`;
  const expectedRelease = canonicalJson({ ...identity, releaseId: expectedId });
  if (selected.release_id !== expectedId || canonicalJson(release) !== expectedRelease
    || selected.release_hash.trim() !== sha256(expectedRelease)
    || Number(selected.release_bytes) !== Buffer.byteLength(expectedRelease, "utf8")) return undefined;
  const manifestHash = selected.manifest_hash.trim();
  if (!SHA.test(manifestHash) || sha256(canonicalJson(selected.manifest_json)) !== manifestHash) return undefined;
  const sources = (await client.query(`SELECT source.id, source.api_id, source.object_id,
      object.api_id AS object_api_id, blob.object_id AS blob_object_id, blob.sha256 AS blob_sha256,
      blob.byte_size, blob.media_type, blob.scan_status, item.blob_sha256 AS input_sha256, item.inclusion_role,
      (SELECT array_agg(stage.stage ORDER BY stage.stage) FROM source_file_stages stage WHERE stage.source_file_id=source.id) AS stages,
      snapshot.decision_id, snapshot.decision_hash, review.id AS review_id, review.object_id AS review_object_id,
      review.source_file_id AS review_source_file_id, review.source_sha256 AS review_source_sha256,
      review.revision_status, review.approval_status, review.link_group_id, review.section_code,
      review.page_stages, review.basis_reference, review.actor_id, review.content_hash AS review_hash,
      review.matrix_scope, review.inventory_scope, review.call_inventory_scope, review.rail_inventory_scope, review.water_node_scope, review.lighting_technology_scope, review.steel_comparison_scope
    FROM analysis_runs run JOIN objects object ON object.id=run.object_id
    JOIN manifest_items item ON item.manifest_id=run.manifest_id
    JOIN source_files source ON source.id=item.source_file_id JOIN blobs blob ON blob.id=source.blob_id
    LEFT JOIN run_source_review_snapshots snapshot ON snapshot.run_id=run.id AND snapshot.source_file_id=source.id
    LEFT JOIN source_review_decisions review ON review.id=snapshot.decision_id
    WHERE run.id=$1 ORDER BY source.api_id`, [selected.id])).rows;
  if (sources.length < 1 || sources.length > 64) return undefined;
  const ids = new Set<string>(), manifestSources = [];
  for (const source of sources) {
    const hash = source.input_sha256.trim();
    if (ids.has(source.api_id) || source.object_id !== objectId || source.blob_object_id !== objectId
      || source.inclusion_role !== "SOURCE" || !SHA.test(hash) || source.blob_sha256.trim() !== hash
      || !Number.isSafeInteger(Number(source.byte_size)) || Number(source.byte_size) < 1
      || !Array.isArray(source.stages) || !source.stages.length || new Set(source.stages).size !== source.stages.length
      || source.stages.some((s: string) => !["PD", "RD", "ID"].includes(s))) return undefined;
    ids.add(source.api_id);
    let reviewHash: string | null = null;
    if (source.decision_id !== null || source.decision_hash !== null) {
      if (!source.review_id || source.review_id !== source.decision_id || source.review_object_id !== objectId
        || source.review_source_file_id !== source.id || source.review_source_sha256?.trim() !== hash
        || !source.revision_status || !source.approval_status || !source.page_stages
        || !source.basis_reference || !source.actor_id || !source.review_hash || !source.decision_hash) return undefined;
      try{if(source.steel_comparison_scope)parseSteelComparisonScopeDecision(source.steel_comparison_scope,{sourceFileId:source.api_id,sourceSha256:hash});}catch{return undefined;}
      reviewHash = sha256(canonicalJson({ objectApiId: source.object_api_id, sourceFileApiId: source.api_id,
        sourceSha256: hash, revisionStatus: source.revision_status, approvalStatus: source.approval_status,
        linkGroupId: source.link_group_id, ...(source.section_code ? { sectionCode: source.section_code } : {}),
        pageStages: source.page_stages, basis: { reference: source.basis_reference },
        ...Object.fromEntries([["matrixScope", source.matrix_scope], ["inventoryScope", source.inventory_scope],
          ["callInventoryScope", source.call_inventory_scope], ["railInventoryScope", source.rail_inventory_scope],
          ["waterNodeScope", source.water_node_scope], ["lightingTechnologyScope", source.lighting_technology_scope], ["steelComparisonScope",source.steel_comparison_scope]].filter(([, value]) => value)), actorId: source.actor_id }));
      if (source.review_hash.trim() !== reviewHash || source.decision_hash.trim() !== reviewHash) return undefined;
    }
    manifestSources.push({ sourceFileId: source.api_id, sha256: hash, stages: source.stages, sourceReviewHash: reviewHash });
  }
  if (canonicalJson(selected.manifest_json) !== canonicalJson({ inspectionId: selected.inspection_id, sources: manifestSources })) return undefined;
  const source = sources.find(item => item.api_id === sourceFileId);
  if (!source || source.media_type !== "application/pdf" || source.scan_status !== "CLEAN"
    || Number(source.byte_size) < 5 || Number(source.byte_size) > 64 * 1024 * 1024) return undefined;
  const artifacts = (await client.query(`SELECT text.*, job.run_id AS job_run_id, job.object_id AS job_object_id,
      job.job_type, job.state AS job_state, job.input_manifest_hash AS job_manifest_hash, job.release_id AS job_release_id
    FROM analysis_text_artifacts text JOIN analysis_jobs job ON job.id=text.job_id
    WHERE text.run_id=$1 AND text.source_file_id=$2 AND text.schema_version='document-text-v3'`, [selected.id, source.id])).rows;
  if (artifacts.length !== 1) return undefined;
  const stored = artifacts[0], artifact = stored.content_json as DocumentTextV3Artifact;
  const verified = readDocumentTextV3Artifact(artifact);
  const bytes = canonicalJson(artifact), hash = stored.content_hash.trim();
  if (verified.status !== "VALID" || !SHA.test(hash) || sha256(bytes) !== hash
    || Buffer.byteLength(bytes, "utf8") !== Number(stored.byte_size) || artifact.pageCount !== stored.page_count
    || artifact.locatedTextPageCount !== stored.text_page_count || artifact.sourceFileId !== sourceFileId
    || artifact.inputSha256 !== source.blob_sha256.trim() || stored.input_sha256.trim() !== artifact.inputSha256
    || artifact.extractorProfileHash !== release.textLayer.extractorProfileHash
    || canonicalJson(artifact.extractorProfile) !== canonicalJson(release.textLayer.extractorProfile)
    || stored.job_run_id !== selected.id || stored.job_object_id !== objectId || stored.job_type !== "DOCUMENT_TEXT_LAYER"
    || stored.job_state !== "SUCCEEDED" || stored.job_manifest_hash.trim() !== manifestHash
    || stored.job_release_id !== selected.release_id) return undefined;
  return { schemaVersion: "document-text-v3-source-read-v1", purpose: "SOURCE_AUDIT_ONLY", checkId, sourceFileId,
    sourceSha256: artifact.inputSha256, inputManifestHash: manifestHash, textStageContentHash: hash,
    textArtifactByteSha256: hash, textArtifactContentHash: verified.contentHash, extractorProfileHash: artifact.extractorProfileHash,
    stage: source.stages.length === 1 && ["PD", "RD"].includes(source.stages[0]) ? source.stages[0] : "UNRESOLVED",
    authorityStatus: "SOURCE_DECLARED_UNVERIFIED", renderedVisibility: "UNVERIFIED", calibratedProbability: null, textArtifact: artifact };
}
