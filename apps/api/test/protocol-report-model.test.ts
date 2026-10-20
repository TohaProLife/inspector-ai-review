import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { buildProtocolReport, protocolReportLimits } from "../src/protocol-report-model.js";
import { reportFixture } from "./protocol-report-fixture.js";

function report(snapshot = reportFixture(), canonical = true) {
  const json = canonicalJson(snapshot); return buildProtocolReport(snapshot, json, sha256(json), canonical);
}
describe("frozen protocol presentation", () => {
  it("follows seven Appendix 2 sections and preserves provenance without claiming completeness", () => {
    const doc = report();
    expect(doc.sections.slice(0, 7).map(item => item.id)).toEqual(["documents", "statistics", "missing-id", "critical", "significant", "candidates", "resolution"]);
    expect(doc.sections.find(item => item.id === "documents")!.tables![0].rows.every(row => row[2] === "Реестр не сохранён")).toBe(true);
    expect(doc.notices.join(" ")).toContain("ИД отсутствует");
    expect(doc.notices.join(" ")).toContain("ПРОВЕРКА НЕПОЛНАЯ");
    expect(JSON.stringify(doc.sections.find(item => item.id === "evidence"))).toContain("b".repeat(64));
    expect(JSON.stringify(doc.sections.find(item => item.id === "missing-id"))).toContain("MISSING_ID");
    expect(JSON.stringify(doc)).toContain("Тестовый выпуск при явно указанной неполноте");
  });
  it("separates human confirmations, 80% candidates, source hints and rejected decisions", () => {
    const doc = report();
    const critical = doc.sections.find(item => item.id === "critical")!.tables![0].rows;
    expect(critical).toHaveLength(1); expect(critical[0][1]).toContain("Тестовая площадь");
    const candidates = JSON.stringify(doc.sections.find(item => item.id === "candidates"));
    expect(candidates).toContain("Кандидат ровно 80%"); expect(candidates).toContain("SOURCE-PENDING");
    expect(candidates).toContain("Уверенность не установлена"); expect(candidates).not.toContain("SOURCE-REJECTED");
    expect(JSON.stringify(doc.sections.find(item => item.id === "review"))).toContain("Исходные элементы различаются");
    expect(doc.snapshotJson).toBe(canonicalJson(reportFixture()));
  });
  it("keeps historical/demo limitations explicit rather than filling from current data", () => {
    const snapshot = reportFixture(); delete snapshot.scope; delete snapshot.sources; delete snapshot.coverage;
    const doc = report(snapshot, false);
    expect(doc.metadata.find(item => item.label === "Объект")!.value).toBe("Не сохранён в снимке");
    expect(doc.notices.join(" ")).toContain("УЧЕБНЫЙ / ИСТОРИЧЕСКИЙ");
    expect(doc.notices.join(" ")).toContain("Электронная подпись не сформирована");
    expect(JSON.stringify(doc.sections.find(item => item.id === "documents"))).not.toContain("Есть файлы");
  });
  it("fails explicitly on malformed, unknown review or oversized snapshots", () => {
    expect(() => report({ ...reportFixture(), schemaVersion: "wrong" } as never)).toThrow("не соответствует");
    expect(() => report({ ...reportFixture(), candidateReview: { artifact: {}, decisions: [] } })).toThrow("неизвестный формат");
    const snapshot = reportFixture(); const json = " ".repeat(protocolReportLimits.snapshotBytes + 1);
    expect(() => buildProtocolReport(snapshot, json, sha256(json), true)).toThrow("8 MiB");
  });
});
