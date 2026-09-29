import { canonicalJson, sha256 } from "./canonical-json.js";
import { verifyGeometryPageFrameV2AgainstRawPage,
  type GeometryPageFrameV2Input } from "./geometry-page-frame-v2.js";

type Json = Record<string, unknown>;
type Point = [number, number];
const SHA = /^[0-9a-f]{64}$/u;
const record = (value: unknown): value is Json => value !== null
  && typeof value === "object" && !Array.isArray(value);
const exact = (value: Json, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const hash = (value: unknown): value is string => typeof value === "string" && SHA.test(value);
const label = (value: unknown): value is string => typeof value === "string"
  && value.length >= 1 && value.length <= 128 && value.trim() === value;
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value)
  && typeof value === "number" && value >= 1 && value <= 10_000;
const point = (value: unknown): value is Point => Array.isArray(value) && value.length === 2
  && value.every((item) => typeof item === "number" && Number.isFinite(item)
    && Math.abs(item) <= 1e12);

export interface GeometryControlPointReviewV1Input {
  frame: GeometryPageFrameV2Input;
  reviewArtifact: { content_json: unknown; content_hash: string };
  /** Supplied by an independent authentication boundary, never by reviewArtifact. */
  authenticatedActorId: string | null;
}

export interface GeometryControlPointReviewV1Result {
  schemaVersion: "geometry-control-point-review-v1";
  status: "UNVERIFIED" | "REJECTED" | "CONFIRMED_REVIEW_ONLY";
  reasonCode: string;
  frameContentHash: string | null;
  reviewContentHash: string | null;
  reviewedTargetFrame: Json | null;
  reviewedControlPoints: Json[] | null;
  decision: Json | null;
  findings: [];
  coverage: null;
}

function result(reasonCode: string, status: GeometryControlPointReviewV1Result["status"] = "UNVERIFIED",
  frameContentHash: string | null = null, reviewContentHash: string | null = null,
  decision: Json | null = null, reviewedTargetFrame: Json | null = null,
  reviewedControlPoints: Json[] | null = null): GeometryControlPointReviewV1Result {
  return { schemaVersion: "geometry-control-point-review-v1", status, reasonCode,
    frameContentHash, reviewContentHash,
    reviewedTargetFrame: reviewedTargetFrame === null ? null : structuredClone(reviewedTargetFrame),
    reviewedControlPoints: reviewedControlPoints === null ? null : structuredClone(reviewedControlPoints),
    decision: decision === null ? null : structuredClone(decision), findings: [], coverage: null };
}

function utcTimestamp(value: unknown): value is string {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value)) return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  const precision = value.includes(".") ? value.split(".")[1].length - 1 : 0;
  return precision <= 3 && new Date(time).toISOString() === (precision === 0
    ? value.replace("Z", ".000Z") : value.replace(/\.(\d+)Z$/u,
      (_match, fraction: string) => `.${fraction.padEnd(3, "0")}Z`));
}

function evidence(value: unknown): value is Json {
  return record(value) && exact(value, ["sourceSha256", "pdfPageNumber", "locator"])
    && hash(value.sourceSha256) && positiveInteger(value.pdfPageNumber)
    && label(value.locator);
}

function targetFrame(value: unknown): value is Json {
  if (!record(value) || !exact(value, ["kind", "frameId", "unit", "xAxis", "yAxis",
    "minScale", "maxScale", "crsMetadata", "frameEvidence"])
    || !["LOCAL_2D", "PROJECTED_CRS"].includes(value.kind as string)
    || !label(value.frameId) || !["m", "mm", "cm", "ft", "in"].includes(value.unit as string)
    || value.xAxis !== "RIGHT" || !["UP", "DOWN"].includes(value.yAxis as string)
    || typeof value.minScale !== "number" || !Number.isFinite(value.minScale)
    || value.minScale <= 0 || typeof value.maxScale !== "number"
    || !Number.isFinite(value.maxScale) || value.maxScale <= value.minScale
    || !evidence(value.frameEvidence)) return false;
  if (value.kind === "LOCAL_2D") return value.crsMetadata === null;
  const crs = value.crsMetadata;
  return record(crs) && exact(crs, ["authority", "code", "definitionSha256",
    "horizontalDatum", "coordinateEpoch"])
    && label(crs.authority) && label(crs.code) && hash(crs.definitionSha256)
    && label(crs.horizontalDatum)
    && (crs.coordinateEpoch === null || (typeof crs.coordinateEpoch === "number"
      && Number.isFinite(crs.coordinateEpoch) && crs.coordinateEpoch >= 1800
      && crs.coordinateEpoch <= 2200));
}

function controlPoints(value: unknown, width: number, height: number): value is Json[] {
  if (!Array.isArray(value) || value.length < 4 || value.length > 32) return false;
  const ids = new Set<string>();
  const pages = new Set<string>();
  const projects = new Set<string>();
  for (const item of value) {
    if (!record(item) || !exact(item, ["id", "evidenceRef", "page", "project",
      "pageEvidence", "projectEvidence"]) || !label(item.id) || !label(item.evidenceRef)
      || !point(item.page) || !point(item.project)
      || !evidence(item.pageEvidence) || !evidence(item.projectEvidence)
      || item.page[0] < 0 || item.page[0] > width
      || item.page[1] < 0 || item.page[1] > height) return false;
    const id = item.id as string;
    const pageKey = canonicalJson(item.page);
    const projectKey = canonicalJson(item.project);
    if (ids.has(id) || pages.has(pageKey) || projects.has(projectKey)) return false;
    ids.add(id); pages.add(pageKey); projects.add(projectKey);
  }
  return true;
}

/**
 * Pure human-review shape and page provenance gate. A matching actor ID is only
 * meaningful when caller authenticated it independently. This never validates
 * real-world CRS or survey coordinates, and never emits a subject finding.
 */
export async function reviewGeometryControlPointsV1(
  input: GeometryControlPointReviewV1Input,
): Promise<GeometryControlPointReviewV1Result> {
  try {
    if (!record(input) || !record(input.frame)
      || !await verifyGeometryPageFrameV2AgainstRawPage(input.frame))
      return result("FRAME_UNVERIFIED");
    const frame = input.frame.artifact.content_json as Json;
    const frameSource = frame.source as Json;
    const frameRender = frame.render as Json;
    const frameHash = input.frame.artifact.content_hash;
    const artifact = input.reviewArtifact;
    if (!record(artifact) || !exact(artifact, ["content_json", "content_hash"])
      || !hash(artifact.content_hash) || !record(artifact.content_json)
      || Buffer.byteLength(canonicalJson(artifact.content_json), "utf8") > 64 * 1024
      || sha256(canonicalJson(artifact.content_json)) !== artifact.content_hash)
      return result("REVIEW_ARTIFACT_UNVERIFIED", "UNVERIFIED", frameHash);
    const review = artifact.content_json;
    if (!exact(review, ["schemaVersion", "frameContentHash", "source", "render",
      "decision", "targetFrame", "controlPoints"])
      || review.schemaVersion !== "geometry-control-point-review-v1"
      || review.frameContentHash !== frameHash
      || !record(review.source) || !exact(review.source,
        ["sourceFileId", "sourceSha256", "pdfPageNumber"])
      || review.source.sourceFileId !== frameSource.sourceFileId
      || review.source.sourceSha256 !== frameSource.sourceSha256
      || review.source.pdfPageNumber !== frameSource.pdfPageNumber
      || !record(review.render) || !exact(review.render,
        ["rendererProfileId", "renderSha256", "widthPx", "heightPx"])
      || review.render.rendererProfileId !== frameRender.rendererProfileId
      || review.render.renderSha256 !== frameRender.renderSha256
      || review.render.widthPx !== frameRender.widthPx
      || review.render.heightPx !== frameRender.heightPx)
      return result("FRAME_BINDING_MISMATCH", "UNVERIFIED", frameHash, artifact.content_hash);
    if (review.decision === null)
      return result("HUMAN_DECISION_MISSING", "UNVERIFIED", frameHash, artifact.content_hash);
    const decision = review.decision;
    if (!record(decision) || !exact(decision,
      ["action", "decisionId", "actorId", "decidedAt", "reason"])
      || !["REJECT", "CONFIRM"].includes(decision.action as string)
      || !label(decision.decisionId) || !label(decision.actorId)
      || !utcTimestamp(decision.decidedAt)
      || !label(decision.reason)
      || !label(input.authenticatedActorId)
      || decision.actorId !== input.authenticatedActorId)
      return result("HUMAN_DECISION_UNVERIFIED", "UNVERIFIED", frameHash, artifact.content_hash);
    if (decision.action === "REJECT") return result("HUMAN_REJECTED", "REJECTED",
      frameHash, artifact.content_hash, decision);
    if (!targetFrame(review.targetFrame) || !controlPoints(review.controlPoints,
      frameRender.widthPx as number, frameRender.heightPx as number))
      return result("CONTROL_POINT_METADATA_INCOMPLETE", "UNVERIFIED",
        frameHash, artifact.content_hash, decision);
    const target = review.targetFrame;
    const controls = review.controlPoints;
    if ((target.frameEvidence as Json).sourceSha256 !== frameSource.sourceSha256
      || (target.frameEvidence as Json).pdfPageNumber !== frameSource.pdfPageNumber
      || controls.some((item) => (item.pageEvidence as Json).sourceSha256 !== frameSource.sourceSha256
        || (item.pageEvidence as Json).pdfPageNumber !== frameSource.pdfPageNumber))
      return result("PAGE_EVIDENCE_MISMATCH", "UNVERIFIED",
        frameHash, artifact.content_hash, decision);
    return result("HUMAN_REVIEW_CONFIRMED_REGISTRATION_PENDING", "CONFIRMED_REVIEW_ONLY",
      frameHash, artifact.content_hash, decision, target, controls);
  } catch {
    return result("REVIEW_UNVERIFIED");
  }
}
