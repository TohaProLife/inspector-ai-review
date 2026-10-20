import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MatrixExecutionRead } from "@inspector-ai/contracts";
import { MatrixRuleCandidates } from "./MatrixExecutionPanel";
import manual from "../../../fixtures/machine-confidence-v2/manual-ui-cases.json";

function fixture(presentation: MatrixExecutionRead["presentation"][number],
  qualified = true, failed = false): MatrixExecutionRead {
  return { checkId: "CHK-CONFIDENCE-V2", contentHash: "b".repeat(64), submission: null,
    execution: { schemaVersion: "matrix-execution-v1", objectId: "OBJ-CONFIDENCE-V2",
      inputManifestHash: "c".repeat(64), registryHash: "d".repeat(64), observations: [],
      metadata: [], coverage: [], results: [{ ruleId: "matrix-pz-002-building_total_area",
        ruleVersion: "1", parameterCode: "PZ-002", entityKey: "building-A", comparisonVariant: "PD_RD",
        executionStatus: failed ? "FAILED" : "SUCCEEDED", machineStatus: "CANDIDATE",
        reasonCode: "CATALOG_TRIGGER_MATCHED", expectedObservationId: null, actualObservationId: null,
        expectedValue: "100", actualValue: "103", delta: "3", qualified }] },
    presentation: [presentation] };
}
const render = (data: MatrixExecutionRead) => renderToStaticMarkup(createElement(MatrixRuleCandidates,
  { data, onSelect: () => {} }));

describe("versioned machine confidence presentation (manual payloads, no classifier oracle)", () => {
  for (const item of manual.cases) it(item.id, () => {
    const html = render(fixture(item.presentation as MatrixExecutionRead["presentation"][number],
      item.qualified, item.failed));
    expect(html).toContain(item.expected.label);
    for (const expected of item.expected.contains) expect(html).toContain(expected);
    expect(html.includes("Машинное предупреждение")).toBe(item.expected.warning);
    expect(html.includes("Технический сбой не является низкой уверенностью.")).toBe(item.expected.technicalFailure);
    expect(html).not.toContain("CONFIRMED");
    expect(html).not.toContain("Нет нарушений");
    expect(html).not.toContain("NaN%");
    expect(html).not.toContain("Infinity%");
    expect(html).not.toContain("150.00%");
  });

  it("native invalid confidence values never render a calibrated warning or invalid numeric certainty", () => {
    const item = manual.cases.find(value => value.id === "v2-one")!;
    for (const calibratedProbability of [Number.NaN, Infinity, -Infinity, -0.1, 1.01]) {
      const presentation = { ...item.presentation, confidence: { ...item.presentation.confidence,
        calibratedProbability } } as MatrixExecutionRead["presentation"][number];
      const html = render(fixture(presentation));
      expect(html).toContain("PZ-002 · Кандидат");
      expect(html).toContain("Уверенность не измерена");
      expect(html).not.toContain("Калиброванная уверенность");
      expect(html).not.toContain("Вероятность:");
    }
  });

  it("missing presentation remains an unmeasured candidate", () => {
    const data = fixture(manual.cases[0].presentation as MatrixExecutionRead["presentation"][number]);
    data.presentation = [];
    const html = render(data);
    expect(html).toContain("PZ-002 · Кандидат");
    expect(html).toContain("Уверенность не измерена");
    expect(html).not.toContain("Машинное предупреждение");
  });

  it("historical confidence test and both classifier source files remain byte exact", () => {
    for (const [path, expected] of [
      ["./matrix-rule-candidates.test.tsx", "072321f731e028ef074d3a41315416928f7eeb18d472e191d22ae52a95e57042"],
      ["../../../packages/contracts/src/machine-confidence.ts", "5aec2863be23a3eb69b9b0cf5d5cf4aa4c59c075116af4d715ffc0820423a398"],
      ["../../../packages/contracts/src/machine-confidence-v2.ts", "f3436ef404d494849e3a64affde3c6cf4e86e4336228b3dd7071eef1c0cc70d0"],
    ]) expect(createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex")).toBe(expected);
  });
});
