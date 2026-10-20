import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MatrixFactScopeTarget, MatrixObservation, SourceFileSummary } from "@inspector-ai/contracts";
import { initialSourceReviewSelection } from "./SourceReviewScreen";
import { MatrixFactScopeEditor, matrixFactScopeRules } from "./MatrixFactScopeEditor";

const file = { id: "FIL-PD", name: "project.pdf", sha256: "a".repeat(64), stages: ["PD"], pageCount: 1,
  size: 1000, registeredAt: "2026-10-18T00:00:00Z", review: null } as SourceFileSummary;
const fact: MatrixObservation = { id: "b".repeat(64), sourceFileId: file.id, sourceSha256: file.sha256,
  stage: "PD", pageNumber: 1, blockId: "0:0", bbox: { x: .1, y: .1, width: .4, height: .1 },
  rawText: "Класс энергетической эффективности А", attribute: "ENERGY_EFFICIENCY_CLASS", value: "А", unit: "energy_class", entityKey: null,
  method: "TEXT_LAYER", extractorVersion: "matrix-text-facts-v1", parameterCodes: ["PZ-021", "ZU-124"] };
const target: MatrixFactScopeTarget = { checkId: "CHK-ORIGIN", executionContentHash: "c".repeat(64),
  observationId: fact.id, evidenceHash: "d".repeat(64), textArtifactHash: "e".repeat(64) };

describe("explicit source and rule navigation", () => {
  it("selects only the requested exact file revision; no fallback on stale, missing, duplicate or malformed address", () => {
    const other = { ...file, id: "FIL-OTHER" };
    const before = JSON.stringify([file, other]);
    expect(initialSourceReviewSelection([other, file], file)).toBe(file.id);
    expect(initialSourceReviewSelection([other, file], { ...file, sha256: "0".repeat(64) })).toBeNull();
    expect(initialSourceReviewSelection([other], file)).toBeNull();
    expect(initialSourceReviewSelection([file, { ...file }], file)).toBeNull();
    expect(initialSourceReviewSelection([file], { ...file, sha256: "bad" })).toBeNull();
    expect(initialSourceReviewSelection([], file)).toBeNull();
    expect(initialSourceReviewSelection([other, file])).toBe(other.id);
    expect(JSON.stringify([file, other])).toBe(before);
  });
  it("preselects an available rule without inventing identity, authority or checked conditions", () => {
    const rules = matrixFactScopeRules(fact);
    expect(rules.length).toBeGreaterThan(1);
    const preferred = rules.at(-1)!;
    const before = JSON.stringify({ fact, target });
    const html = renderToStaticMarkup(createElement(MatrixFactScopeEditor, { fact, target,
      preferredRuleId: preferred.ruleId, onChange: () => { throw Error("Rendering must not save a draft"); } }));
    expect(html).toContain(`value="${preferred.ruleId}" selected=""`);
    expect(html).not.toContain("checked=\"\"");
    expect(JSON.stringify({ fact, target })).toBe(before);
  });
  it("ignores a preferred rule outside the exact fact attribute/unit/parameter domain", () => {
    const html = renderToStaticMarkup(createElement(MatrixFactScopeEditor, { fact, target,
      preferredRuleId: "matrix-pz-009-declared_project_zero_absolute_elevation", onChange: () => {} }));
    expect(html).toContain(`value="${matrixFactScopeRules(fact)[0].ruleId}" selected=""`);
    expect(html).not.toContain('value="matrix-pz-009-declared_project_zero_absolute_elevation"');
    expect(html).not.toContain("checked=\"\"");
  });
});
