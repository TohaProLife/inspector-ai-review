import { z } from "zod";

const label = (limit: number) => z.string().min(1).max(limit).refine(value => value === value.trim()
  && !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value), "Explicit one-line Unicode text required");
const number = z.number().finite().min(-1e12).max(1e12);
const positive = number.positive();
const pagePoint = z.tuple([number.min(0).max(1), number.min(0).max(1)]);
const sha = z.string().length(64).regex(/^[a-f0-9]{64}$/u);
export const documentCoordinatePageFrameSchema = z.object({
  sourceFileId: label(200), sourceSha256: sha, pdfPageNumber: z.number().int().min(1).max(10_000),
  pageFrameSha256: sha, coordinateSpace: z.literal("CANONICAL_VISIBLE_NORMALIZED"),
  visibleWidthPt: positive.max(1_000_000), visibleHeightPt: positive.max(1_000_000),
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]), geometryPrecisionPt: positive,
}).strict();
export const documentCoordinatePreviewInputSchema = z.object({
  schemaVersion: z.literal("document-coordinate-preview-v1"), checkId: label(120),
  sourceFrame: documentCoordinatePageFrameSchema,
  target: z.object({ label: label(128), unit: z.enum(["m", "mm", "cm", "ft", "in"]),
    yAxis: z.enum(["UP", "DOWN"]), minScale: positive, maxScale: positive, maxHoldoutResidual: positive,
  }).strict().refine(value => value.minScale < value.maxScale, "Explicit ordered scale bounds required"),
  points: z.array(z.object({ id: label(128), page: pagePoint, printed: z.tuple([number, number]),
    role: z.enum(["FIT", "HOLDOUT"]), reference: label(128),
  }).strict()).min(4).max(32), queryPoints: z.array(pagePoint).max(128),
}).strict();
export type DocumentCoordinatePageFrame = z.infer<typeof documentCoordinatePageFrameSchema>;
export type DocumentCoordinatePreviewInput = z.infer<typeof documentCoordinatePreviewInputSchema>;
export type DocumentCoordinateControl = DocumentCoordinatePreviewInput["points"][number];
export interface DocumentCoordinateResidual { id: string; predicted: [number, number]; residualProjectUnits: number }
export interface DocumentCoordinateCalibration {
  forwardMatrix: [number, number, number, number, number, number];
  inverseMatrix: [number, number, number, number, number, number];
  fitResiduals: DocumentCoordinateResidual[]; holdoutResiduals: DocumentCoordinateResidual[];
  maxHoldoutResidual: number; declaredTolerance: number; maxRoundtripPageUnits: number;
  scaleRangeProjectUnitsPerNormalizedPageUnit: [number, number]; supportedDomain: Array<[number, number]>;
  queryPoints: Array<{page: [number, number]; project: [number, number]}>;
}
export interface DocumentCoordinatePreviewRead {
  schemaVersion: "document-coordinate-preview-read-v1"; status: "PREVIEW_ONLY";
  sourceFrame: DocumentCoordinatePageFrame; inputSha256: string;
  coordinateAuthority: "USER_DECLARED_UNVERIFIED"; absoluteGeoreference: false;
  physicalPositionValidated: false; calibratedProbability: null; facts: [];
  result: {status: "CALCULATED"; calibration: DocumentCoordinateCalibration}
    | {status: "ABSTAIN"; reasonCode: "PAGE_FRAME_MISMATCH" | "REGISTRATION_POLICY_REJECTED"};
}

/** Canonical bytes of this validated preview DTO. Code-unit order is locale independent.
 * Node callers must native-preflight host objects before invoking public schemas. */
export function documentCoordinateCanonicalInput(input: DocumentCoordinatePreviewInput): string {
  const parsed = documentCoordinatePreviewInputSchema.parse(input);
  function encode(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${encode((value as Record<string, unknown>)[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }
  return encode(parsed);
}
/** Browser and Node WebCrypto use identical canonical UTF-8 request bytes. */
export async function documentCoordinateInputSha256(input: DocumentCoordinatePreviewInput): Promise<string> {
  const bytes = new TextEncoder().encode(documentCoordinateCanonicalInput(input));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
