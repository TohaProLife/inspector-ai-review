/** Printed coordinates support a numerical draft; no independent geodetic authority. */
import { isProxy } from "node:util/types";
import { documentCoordinateCanonicalInput, documentCoordinatePageFrameSchema, documentCoordinatePreviewInputSchema,
  type DocumentCoordinateCalibration, type DocumentCoordinatePageFrame, type DocumentCoordinatePreviewInput,
  type DocumentCoordinatePreviewRead, type DocumentCoordinateResidual } from "@inspector-ai/contracts";
import { sha256 } from "./canonical-json.js";
import { computeGeometryRegistrationV1 } from "./geometry-registration-v1.js";

export class DocumentCoordinateInputError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "INPUT_LIMIT") { super("Недопустимые исходные данные координатного черновика"); }
}
function reject(limit = false): never { throw new DocumentCoordinateInputError(limit ? "INPUT_LIMIT" : "INVALID_INPUT"); }
/** Descriptor-first finite JSON gate. Never invoke getters, proxies or custom serializers. */
function native(input: unknown): void {
  let nodes = 0, bytes = 0; const parents = new Set<object>();
  function visit(value: unknown, depth: number): void {
    if (++nodes > 10_000 || depth > 16) reject(true);
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "number") { if (!Number.isFinite(value) || Math.abs(value) > 1e12) reject(); return; }
    if (typeof value === "string") {
      if (value.length > 128 * 1024) reject(true);
      for (const point of value) { const code = point.codePointAt(0)!; if (code >= 0xd800 && code <= 0xdfff) reject(); }
      bytes += Buffer.byteLength(value, "utf8"); if (bytes > 128 * 1024) reject(true); return;
    }
    if (!value || typeof value !== "object" || isProxy(value) || parents.has(value)) reject();
    const array = Array.isArray(value);
    if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) reject();
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== "string")) reject();
    let names: string[];
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0) reject();
      if (length > 256) reject(true);
      if (keys.length !== length + 1) reject();
      names = Array.from({ length }, (_, i) => String(i));
    } else { if (keys.length > 64) reject(true); names = keys as string[]; }
    parents.add(value);
    for (const name of names) {
      const descriptor = descriptors[name];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) reject();
      if (!array) visit(name, depth + 1);
      visit(descriptor.value, depth + 1);
    }
    parents.delete(value);
  }
  visit(input, 0);
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > 128 * 1024) reject(true);
}
export function parseDocumentCoordinateInput(raw: unknown): DocumentCoordinatePreviewInput {
  native(raw); const parsed = documentCoordinatePreviewInputSchema.safeParse(raw);
  if (!parsed.success) reject(); return parsed.data;
}
export function previewDocumentCoordinates(raw: unknown, actualFrame: DocumentCoordinatePageFrame): DocumentCoordinatePreviewRead {
  const input = parseDocumentCoordinateInput(raw);
  native(actualFrame); const frame = documentCoordinatePageFrameSchema.parse(actualFrame);
  const base = { schemaVersion: "document-coordinate-preview-read-v1" as const, status: "PREVIEW_ONLY" as const,
    sourceFrame: frame, inputSha256: sha256(documentCoordinateCanonicalInput(input)),
    coordinateAuthority: "USER_DECLARED_UNVERIFIED" as const, absoluteGeoreference: false as const,
    physicalPositionValidated: false as const, calibratedProbability: null, facts: [] as [] };
  if (Object.keys(frame).some(key => frame[key as keyof typeof frame] !== input.sourceFrame[key as keyof typeof frame])) {
    return { ...base, result: { status: "ABSTAIN", reasonCode: "PAGE_FRAME_MISMATCH" } };
  }
  const computed = computeGeometryRegistrationV1({ schemaVersion: "geometry-registration-v1",
    source: { sourceSha256: frame.sourceSha256, pdfPageNumber: frame.pdfPageNumber },
    pageFrame: { coordinateSpace: "CANONICAL_VISIBLE_NORMALIZED", width: 1, height: 1, rotate: frame.rotate, renderSha256: null },
    targetFrame: { kind: "LOCAL_2D", frameId: input.target.label, unit: input.target.unit,
      xAxis: "RIGHT", yAxis: input.target.yAxis, minScale: input.target.minScale, maxScale: input.target.maxScale },
    controlPoints: input.points.map(point => ({ id: point.id, evidenceRef: point.reference, page: point.page, project: point.printed })),
    trainingPointIds: input.points.filter(point => point.role === "FIT").map(point => point.id),
    maxHoldoutResidualProjectUnits: input.target.maxHoldoutResidual, queryPoints: input.queryPoints });
  if (!computed) return { ...base, result: { status: "ABSTAIN", reasonCode: "REGISTRATION_POLICY_REJECTED" } };
  const forward = computed.forwardMatrix as DocumentCoordinateCalibration["forwardMatrix"];
  const residuals = (role: "FIT" | "HOLDOUT"): DocumentCoordinateResidual[] => input.points.filter(point => point.role === role).map(point => {
    const [x, y] = point.page;
    const predicted: [number, number] = [forward[0] * x + forward[1] * y + forward[2], forward[3] * x + forward[4] * y + forward[5]];
    return { id: point.id, predicted, residualProjectUnits: Math.hypot(predicted[0] - point.printed[0], predicted[1] - point.printed[1]) };
  });
  return { ...base, result: { status: "CALCULATED", calibration: {
    forwardMatrix: forward, inverseMatrix: computed.inverseMatrix as DocumentCoordinateCalibration["inverseMatrix"],
    fitResiduals: residuals("FIT"), holdoutResiduals: residuals("HOLDOUT"),
    maxHoldoutResidual: computed.maxHoldoutResidualProjectUnits as number, declaredTolerance: input.target.maxHoldoutResidual,
    maxRoundtripPageUnits: computed.maxRoundtripPageUnits as number,
    scaleRangeProjectUnitsPerNormalizedPageUnit: computed.scaleRangeProjectUnitsPerPageUnit as [number, number],
    supportedDomain: computed.calibrationDomainPage as Array<[number, number]>,
    queryPoints: computed.queryPoints as DocumentCoordinateCalibration["queryPoints"],
  } } };
}
