import type { LocalDocumentAnchor, LocalDocumentFrame, LocalDocumentRegistrationPacket,
  LocalDocumentRegistrationPreview, LocalDocumentRegistrationReview } from "../../../packages/contracts/src/local-document-registration.js";

export const localRegistrationFrameIdentity = (frame: LocalDocumentFrame): string => JSON.stringify([
  frame.sourceFileId, frame.sourceSha256, frame.pdfPageNumber, frame.pageFrameSha256, frame.coordinateSpace,
  frame.visibleWidthPt, frame.visibleHeightPt, frame.rotate, frame.objectKey, frame.floorKey, frame.phaseKey, frame.revisionKey]);

export function createLocalRegistrationDraft(sourceFrame: LocalDocumentFrame,
  targetFrame: LocalDocumentFrame): LocalDocumentRegistrationPacket {
  return { schemaVersion: "local-document-registration-v1", sourceFrame, targetFrame,
    method: "SIMILARITY", basis: { kind: "DOCUMENT_AXES", evidenceRefs: [] }, anchors: [],
    minScale: 0.01, maxScale: 100, maxAnisotropy: 1.05, maxResidualTargetPoints: 1,
    sourceLocalizationUncertaintyPt: 0.5, targetLocalizationUncertaintyPt: 0.5, targetScale: null };
}

export function localRegistrationDraftIssues(packet: LocalDocumentRegistrationPacket): string[] {
  const issues: string[] = [];
  if (packet.sourceFrame.objectKey !== packet.targetFrame.objectKey
    || packet.sourceFrame.floorKey !== packet.targetFrame.floorKey
    || packet.sourceFrame.phaseKey !== packet.targetFrame.phaseKey) issues.push("Объект, этаж и этап строительства должны совпадать");
  if (packet.anchors.filter((anchor) => anchor.role === "FIT").length < 3) issues.push("Нужно минимум три опоры для расчёта");
  if (!packet.anchors.some((anchor) => anchor.role === "HOLDOUT")) issues.push("Нужна минимум одна контрольная опора вне расчёта");
  if (!packet.basis.evidenceRefs.some((ref) => ref.trim().length > 0)) issues.push("Укажите основание выбора опор");
  if (packet.method === "AFFINE" && packet.basis.kind !== "SCAN_DISTORTION") issues.push("Аффинное преобразование требует основания искажения скана");
  const coordinate = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
  if (packet.anchors.some((anchor) => !anchor.source.every(coordinate) || !anchor.target.every(coordinate))) issues.push("Координаты опор должны быть от 0 до 1");
  if (packet.anchors.some((anchor) => !anchor.sourceLocator.trim() || !anchor.targetLocator.trim())) issues.push("Укажите обозначения опор на обоих листах");
  const duplicates = (select: (anchor: LocalDocumentAnchor) => unknown) =>
    new Set(packet.anchors.map((anchor) => JSON.stringify(select(anchor)))).size !== packet.anchors.length;
  if (duplicates((anchor) => anchor.source) || duplicates((anchor) => anchor.target)) issues.push("Опоры не должны повторяться");
  const positive = (value: number) => Number.isFinite(value) && value > 0;
  if (!positive(packet.minScale) || !positive(packet.maxScale) || packet.minScale >= packet.maxScale
    || !positive(packet.maxAnisotropy) || packet.maxAnisotropy < 1 || packet.maxAnisotropy > 2
    || !positive(packet.maxResidualTargetPoints)) issues.push("Проверьте допуск, границы масштаба и искажения");
  if ([packet.sourceLocalizationUncertaintyPt, packet.targetLocalizationUncertaintyPt]
    .some((value) => !Number.isFinite(value) || value < 0)) issues.push("Укажите неотрицательную погрешность постановки опор");
  if (packet.targetScale && (!positive(packet.targetScale.unitsPerVisiblePoint)
    || !Number.isFinite(packet.targetScale.relativeUncertainty) || packet.targetScale.relativeUncertainty < 0
    || packet.targetScale.relativeUncertainty >= 1 || !packet.targetScale.evidenceRef.trim())) issues.push("Проверьте метрический масштаб, его погрешность и основание");
  return issues;
}

/** A preview or a stale receipt cannot be displayed as an authenticated saved decision. */
export function savedLocalRegistrationMatches(preview: LocalDocumentRegistrationPreview | null,
  review: LocalDocumentRegistrationReview | null): boolean {
  return !!preview && preview.result.status === "REGISTERED_RELATIVE" && !!review
    && review.reviewId.trim().length > 0 && review.actorId.trim().length > 0
    && Number.isFinite(Date.parse(review.reviewedAt)) && /^[a-f0-9]{64}$/u.test(review.registrationSha256)
    && review.registrationSha256 === preview.result.registrationSha256
    && review.result.registrationSha256 === review.registrationSha256;
}
