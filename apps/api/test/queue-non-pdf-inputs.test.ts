import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { materializeImmutableSourceInputsV13 } from "../src/matrix-immutable-source-inputs-v13.js";
import { assembleConcreteWallScalarInputV13 } from "../src/matrix-scalar-input-assembly-v13.js";
import { terminalClaimInputError } from "../src/claim-input-failure.js";
import { InventoryLoaderIntegrityError } from "../src/matrix-inventory-loader.js";
import type { ImmutableSourceQueryV13Capture, ImmutableSourceQueryV13Row } from "../src/postgres-immutable-source-query-v13.js";

const formats = ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/xml", "image/vnd.dwg"];
function capture(mediaTypes: string[]) {
  const context = { runId: randomUUID(), objectId: randomUUID(), releaseId: "release:controlled-v13" };
  const inspectionId = randomUUID(), textJobId = randomUUID();
  const rows: ImmutableSourceQueryV13Row[] = mediaTypes.map((mediaType, index) => {
    const id = `FIL-${index}`, digest = sha256(id), pdf = mediaType === "application/pdf";
    const artifact = pdf ? { schemaVersion: "document-text-v2", sourceFileId: id, inputSha256: digest,
      pageCount: 1, pages: [{ pageNumber: 1 }] } : null;
    return { source_internal_id: randomUUID(), source_file_id: id, source_object_id: context.objectId,
      object_api_id: "OBJ-CONTROLLED", blob_object_id: context.objectId, source_sha256: digest,
      blob_sha256: digest, blob_byte_size: "50", blob_media_type: mediaType, blob_scan_status: "CLEAN",
      storage_key: `controlled/${id}`, inclusion_role: "SOURCE", snapshot_decision_id: null, snapshot_hash: null,
      review_id: null, review_object_id: null, review_source_file_id: null, review_source_sha256: null,
      revision_status: null, approval_status: null, link_group_id: null, section_code: null,
      page_stages: null, basis_reference: null, actor_id: null, review_content_hash: null,
      matrix_scope: null, inventory_scope: null, call_inventory_scope: null, rail_inventory_scope: null,
      water_node_scope: null, lighting_technology_scope: null, steel_comparison_scope: null,
      text_job_id: textJobId, text_job_run_id: context.runId, text_job_object_id: context.objectId,
      text_job_type: "DOCUMENT_TEXT_LAYER", text_job_state: "SUCCEEDED", text_job_manifest_hash: "",
      text_job_release_id: context.releaseId, run_release_id: context.releaseId,
      text_artifact: artifact, text_hash: artifact ? sha256(canonicalJson(artifact)) : null,
      text_byte_size: artifact ? Buffer.byteLength(canonicalJson(artifact)) : null,
      text_input_sha256: pdf ? digest : null, text_page_count: pdf ? 1 : null,
      text_schema_version: pdf ? "document-text-v2" : null };
  });
  const manifest = { inspectionId, sources: rows.map(row => ({ sourceFileId: row.source_file_id,
    sha256: row.source_sha256, stages: ["PD"], sourceReviewHash: null })) };
  const manifestHash = sha256(canonicalJson(manifest));
  const sources = rows.map(row => ({ sourceFileId: row.source_file_id, inputSha256: row.source_sha256,
    status: row.blob_media_type === "application/pdf" ? "TEXT_EXTRACTED" : "SKIPPED_UNSUPPORTED_FORMAT",
    reason: "This frozen release extracts PDF text only" }));
  for (const row of rows) { row.text_job_manifest_hash = manifestHash;
    row.text_job_result = { disposition: "DOCUMENT_TEXT_LAYER_COMPLETED", sources }; }
  return { context, capture: { scope: { inspection_id: inspectionId, object_id: context.objectId,
    manifest_hash: manifestHash, manifest_json: manifest }, rows } as ImmutableSourceQueryV13Capture };
}
describe("all-source immutable V13 inputs", () => {
  it.each(formats)("retains a verified skipped %s without PDF facts or storage references", mediaType => {
    const fixture = capture([mediaType]);
    const base = materializeImmutableSourceInputsV13(fixture.capture, fixture.context);
    expect(base.sourceFiles).toMatchObject([{ mediaType, pageCount: 0, stages: ["PD"] }]);
    expect(base.textArtifacts).toEqual([]); expect(Object.keys(base.pdfStorageRefs)).toEqual([]);
    expect(() => assembleConcreteWallScalarInputV13(base, { ...fixture.context,
      inputManifestHash: fixture.capture.scope.manifest_hash }, { schemaVersion: "matrix-concrete-wall-origin-contexts-v1", records: [] },
    { "FIL-0": "/authorized/input" })).not.toThrow();
  });
  it("keeps mixed manifest order while associating PDF artifacts by source identity", () => {
    const fixture = capture([formats[0]!, "application/pdf", formats[1]!, formats[2]!]);
    const base = materializeImmutableSourceInputsV13(fixture.capture, fixture.context);
    expect(base.sourceFiles).toHaveLength(4); expect(base.textArtifacts.map(x => x.sourceFileId)).toEqual(["FIL-1"]);
    expect(Object.keys(base.pdfStorageRefs)).toEqual(["FIL-1"]);
    const paths = Object.fromEntries(base.sourceFiles.map(s => [s.sourceFileId, `/authorized/${s.sourceFileId}`]));
    expect(() => assembleConcreteWallScalarInputV13(base, { ...fixture.context,
      inputManifestHash: fixture.capture.scope.manifest_hash }, { schemaVersion: "matrix-concrete-wall-origin-contexts-v1", records: [] }, paths)).not.toThrow();
  });
  it("accepts four-byte skipped XML without changing its true size, retaining the PDF minimum", () => {
    const fixture = capture(["application/xml"]);
    fixture.capture.rows[0]!.blob_byte_size = 4;
    const base = materializeImmutableSourceInputsV13(fixture.capture, fixture.context);
    expect(base.sourceFiles[0]!.byteSize).toBe(4);
    const context = { ...fixture.context, inputManifestHash: fixture.capture.scope.manifest_hash };
    const origins = { schemaVersion: "matrix-concrete-wall-origin-contexts-v1", records: [] };
    const paths = { "FIL-0": "/authorized/input" };
    expect(() => assembleConcreteWallScalarInputV13(base, context, origins, paths)).not.toThrow();
    for (const size of [0, -1, 1.5]) {
      base.sourceFiles[0]!.byteSize = size;
      expect(() => assembleConcreteWallScalarInputV13(base, context, origins, paths)).toThrow();
    }
    base.sourceFiles[0]!.byteSize = 4; base.sourceFiles[0]!.mediaType = "application/pdf";
    base.sourceFiles[0]!.pageCount = 1; base.metadata.sources[0]!.pageCount = 1;
    base.textArtifacts.push({ sourceFileId: "FIL-0", contentSha256: "a".repeat(64), artifact: {} });
    expect(() => assembleConcreteWallScalarInputV13(base, context, origins, paths)).toThrow();
  });
  it.each(["sha", "status", "job", "manifest", "pdf-smuggling"])("fails closed on a tampered skipped source: %s", mutation => {
    const fixture = capture([formats[1]!]), row = fixture.capture.rows[0]!;
    if (mutation === "sha") row.blob_sha256 = "0".repeat(64);
    if (mutation === "status") (row.text_job_result!.sources as Array<Record<string, unknown>>)[0]!.status = "TEXT_EXTRACTED";
    if (mutation === "job") row.text_job_manifest_hash = "0".repeat(64);
    if (mutation === "manifest") fixture.capture.scope.manifest_hash = "0".repeat(64);
    if (mutation === "pdf-smuggling") row.text_artifact = { pageCount: 1 };
    expect(() => materializeImmutableSourceInputsV13(fixture.capture, fixture.context)).toThrow();
  });
  it("only classifies deterministic typed input errors, preserving transient retries", () => {
    expect(terminalClaimInputError(new InventoryLoaderIntegrityError("INVENTORY_INPUT_INTEGRITY"))).toBe("INVENTORY_INPUT_INTEGRITY");
    expect(terminalClaimInputError(new InventoryLoaderIntegrityError("INVENTORY_INPUT_CHANGED"))).toBeUndefined();
    expect(terminalClaimInputError(new Error("connection unavailable"))).toBeUndefined();
  });
});
