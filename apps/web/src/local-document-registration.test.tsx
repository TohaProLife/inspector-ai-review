import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LocalDocumentFrame, LocalDocumentRegistrationPreview,
  LocalDocumentRegistrationReview } from "../../../packages/contracts/src/local-document-registration.js";
import { LocalDocumentRegistration, LocalDocumentRegistrationOutcome } from "./LocalDocumentRegistration";
import { createLocalRegistrationDraft, localRegistrationDraftIssues,
  localRegistrationFrameIdentity, savedLocalRegistrationMatches } from "./local-document-registration-state";
import { InspectorGeometryRegistration } from "./InspectorGeometryRegistration";
import { LocalRegistrationWorkspace } from "./LocalRegistrationWorkspace";

const source: LocalDocumentFrame = { sourceFileId: "PD-original", sourceSha256: "a".repeat(64),
  pdfPageNumber: 13, pageFrameSha256: "c".repeat(64), coordinateSpace: "CANONICAL_VISIBLE_NORMALIZED",
  visibleWidthPt: 1_000, visibleHeightPt: 500, rotate: 270, objectKey: "object-A", floorKey: "floor-1",
  phaseKey: "construction-A", revisionKey: "PD-v1" };
const target: LocalDocumentFrame = { ...source, sourceFileId: "RD-original", sourceSha256: "b".repeat(64), revisionKey: "RD-v2" };
function packet() {
  const value = createLocalRegistrationDraft(source, target);
  value.basis.evidenceRefs = ["PD:13:axes-А/1,Б/1,А/2,Б/2", "RD:13:same-axes"];
  value.anchors = [[0.1, 0.1], [0.8, 0.1], [0.1, 0.8], [0.8, 0.8]].map(([x, y], i) => ({
    id: `axis-${i}`, source: [x, y], target: [x, y], role: i < 3 ? "FIT" : "HOLDOUT",
    referenceKind: "DOCUMENT_AXIS", sourceLocator: `PD:13:axis-${i}`, targetLocator: `RD:13:axis-${i}` }));
  return value;
}
const preview: LocalDocumentRegistrationPreview = { status: "PREVIEW_ONLY", result: {
  schemaVersion: "local-document-registration-result-v1", status: "REGISTERED_RELATIVE", reasonCode: "REGISTERED_RELATIVE",
  sourceFrame: source, targetFrame: target, registrationSha256: "e".repeat(64), method: "SIMILARITY",
  forwardMatrix: [1, 0, 0, 0, 1, 0], inverseMatrix: [1, 0, 0, 0, 1, 0], scaleRange: [1, 1],
  fitResiduals: [0, 1, 2].map(i => ({ anchorId: `axis-${i}`, targetPoints: 0 })),
  holdoutResiduals: [{ anchorId: "axis-3", targetPoints: 0 }], maxResidualTargetPoints: 0,
  uncertaintyTargetPoints: 1, sourceDomain: [[0.1, 0.1], [0.8, 0.1], [0.8, 0.8], [0.1, 0.8]],
  targetDomain: [[0.1, 0.1], [0.8, 0.1], [0.8, 0.8], [0.1, 0.8]], metricScale: null, absoluteGeoreference: false } };
const review: LocalDocumentRegistrationReview = { reviewId: "review-1", actorId: "inspector-1",
  reviewedAt: "2026-10-17T18:00:00.000Z", registrationSha256: "e".repeat(64),
  result: preview.result as LocalDocumentRegistrationReview["result"] };

describe("local registration draft and immutable decisions", () => {
  it("requires fit and independent holdout, locators, matching scope and metric basis", () => {
    expect(localRegistrationDraftIssues(createLocalRegistrationDraft(source, target))).toContain("Нужна минимум одна контрольная опора вне расчёта");
    expect(localRegistrationDraftIssues(packet())).toEqual([]);
    const value = packet(); value.anchors[3].role = "FIT";
    expect(localRegistrationDraftIssues(value)).toContain("Нужна минимум одна контрольная опора вне расчёта");
    value.targetScale = { unit: "m", unitsPerVisiblePoint: 1, relativeUncertainty: 0.01, evidenceRef: "" };
    expect(localRegistrationDraftIssues(value)).toContain("Проверьте метрический масштаб, его погрешность и основание");
    value.targetFrame = { ...value.targetFrame, floorKey: "other-floor" };
    expect(localRegistrationDraftIssues(value)).toContain("Объект, этаж и этап строительства должны совпадать");
  });

  it("rejects repeated points, nonfinite policy and unsupported affine basis before request", () => {
    const value = packet(); value.anchors[3].target = value.anchors[0].target;
    value.maxResidualTargetPoints = Number.NaN; value.method = "AFFINE";
    expect(localRegistrationDraftIssues(value)).toEqual(expect.arrayContaining([
      "Опоры не должны повторяться", "Проверьте допуск, границы масштаба и искажения",
      "Аффинное преобразование требует основания искажения скана"]));
  });

  it("never upgrades calculation preview or stale review digest to saved decision", () => {
    expect(savedLocalRegistrationMatches(preview, null)).toBe(false);
    expect(savedLocalRegistrationMatches(preview, review)).toBe(true);
    expect(savedLocalRegistrationMatches(preview, { ...review, registrationSha256: "f".repeat(64) })).toBe(false);
    expect(savedLocalRegistrationMatches(preview, { ...review, actorId: "" })).toBe(false);
    expect(savedLocalRegistrationMatches(preview, { ...review, reviewedAt: "invalid" })).toBe(false);
    expect(localRegistrationFrameIdentity(source)).not.toBe(localRegistrationFrameIdentity({ ...source, rotate: 0 }));
  });
});

describe("local registration panel", () => {
  it("shows two SHA-bound original pages, fit/holdout controls and no manufactured result", () => {
    const html = renderToStaticMarkup(createElement(LocalDocumentRegistration, { sourceFrame: source, targetFrame: target,
      sourcePreviewUrl: "/source.png", targetPreviewUrl: "/target.png", initialPacket: packet() }));
    expect(html).toContain("PD-original"); expect(html).toContain("RD-original");
    expect(html).toContain("страница PDF 13"); expect(html).toContain("Контрольная, вне расчёта");
    expect(html).toContain("Контур проверяемого здания");
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html).toContain("Погрешность опор исходного листа");
    expect(html).not.toContain("Локальная привязка сохранена");
    expect(html).not.toContain("решение по опорам ещё не сохранено");
  });

  it("a draft from another immutable page is ignored", () => {
    const unrelated = packet(); unrelated.sourceFrame = { ...source, sourceSha256: "9".repeat(64) };
    const html = renderToStaticMarkup(createElement(LocalDocumentRegistration, { sourceFrame: source, targetFrame: target,
      sourcePreviewUrl: "/source.png", targetPreviewUrl: "/target.png", initialPacket: unrelated }));
    expect(html).toContain("Нужно минимум три опоры для расчёта");
    expect(html).not.toContain("PD:13:axis-0");
  });

  it("labels preview, metric abstention and authenticated saved review separately", () => {
    const draft = renderToStaticMarkup(createElement(LocalDocumentRegistrationOutcome, { preview, review: null }));
    expect(draft).toContain("Предварительный расчёт");
    expect(draft).toContain("Метрический масштаб не установлен");
    expect(draft).toContain("Абсолютная система координат не подтверждалась");
    expect(draft).not.toContain("Локальная привязка сохранена");
    const saved = renderToStaticMarkup(createElement(LocalDocumentRegistrationOutcome, { preview, review }));
    expect(saved).toContain("Локальная привязка сохранена"); expect(saved).toContain("inspector-1");
  });

  it("restores persisted decision only with the same immutable source and target frames", () => {
    const props = { sourceFrame: source, targetFrame: target, sourcePreviewUrl: "/source.png", targetPreviewUrl: "/target.png",
      initialPacket: packet(), initialReview: review };
    expect(renderToStaticMarkup(createElement(LocalDocumentRegistration, props))).toContain("Локальная привязка сохранена");
    const changed = { ...props, sourceFrame: { ...source, sourceSha256: "9".repeat(64) } };
    expect(renderToStaticMarkup(createElement(LocalDocumentRegistration, changed))).not.toContain("Локальная привязка сохранена");
    const workspace = renderToStaticMarkup(createElement(LocalRegistrationWorkspace, { objectId: "object-A", checkId: "CHK-1" }));
    expect(workspace).toContain("Локальная привязка двух исходных листов");
    expect(workspace).toContain("без внешней геодезической ведомости");
    expect(workspace).toContain("Загрузить сохранённое решение");
  });

  it("absolute registration description no longer blocks local drawing comparison", () => {
    const html = renderToStaticMarkup(createElement(InspectorGeometryRegistration, { objectId: "object-A", sourceFileId: "PD-original" }));
    expect(html).toContain("Абсолютная геопривязка");
    expect(html).toContain("можно использовать их собственные оси");
    expect(html).not.toContain("Для сопоставления положения нужен подписанный пакет");
  });
});
