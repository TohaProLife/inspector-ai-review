import { describe, expect, it } from "vitest";
import type { MatrixExecutionRead, MatrixObservation } from "@inspector-ai/contracts";
import { matrixFactSavedReason } from "./MatrixExecutionPanel";

const fact = { id: "f".repeat(64), sourceFileId: "FIL-PD", sourceSha256: "a".repeat(64), method: "TEXT_LAYER" } as MatrixObservation;
const row = { ruleId: "rule-A", expectedObservationId: fact.id, actualObservationId: null, reasonCode: "SOURCE_APPROVAL_UNRESOLVED" };
function data(rows: Array<Record<string, unknown>>, observations = [fact]): MatrixExecutionRead {
  return { execution: { observations, results: rows } } as unknown as MatrixExecutionRead;
}
describe("immutable saved reason for an explicitly selected fact/rule", () => {
  it("retains the one explicit saved reason without changing the result", () => {
    const input = data([row]); const before = JSON.stringify(input);
    expect(matrixFactSavedReason(input, fact, "rule-A")).toBe(row.reasonCode);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("does not infer a reason from the first rule or a direct fact opening", () => {
    expect(matrixFactSavedReason(data([row]), fact)).toBeNull();
    expect(matrixFactSavedReason(data([row]), fact, "other-rule")).toBeNull();
    expect(matrixFactSavedReason(null, fact, "rule-A")).toBeNull();
  });
  it("requires the selected fact to be explicitly referenced by the saved row", () => {
    expect(matrixFactSavedReason(data([{ ...row, expectedObservationId: "other" }]), fact, "rule-A")).toBeNull();
  });
  it("supports an actual-side reference and repeated identical saved reasons", () => {
    expect(matrixFactSavedReason(data([{ ...row, expectedObservationId: null, actualObservationId: fact.id }, row]), fact, "rule-A")).toBe(row.reasonCode);
  });
  it("keeps ambiguous saved reasons unselected", () => {
    expect(matrixFactSavedReason(data([row, { ...row, reasonCode: "ENTITY_SCOPE_UNVERIFIED" }]), fact, "rule-A")).toBeNull();
  });
  it("requires exact immutable observation source ID and SHA", () => {
    expect(matrixFactSavedReason(data([row], []), fact, "rule-A")).toBeNull();
    expect(matrixFactSavedReason(data([row], [{ ...fact, sourceFileId: "FIL-OTHER" }]), fact, "rule-A")).toBeNull();
    expect(matrixFactSavedReason(data([row], [{ ...fact, sourceSha256: "b".repeat(64) }]), fact, "rule-A")).toBeNull();
  });
  it("does not describe an unverified OCR candidate as a saved scalar observation", () => {
    expect(matrixFactSavedReason(data([row]), { ...fact, method: "OCR" } as unknown as Parameters<typeof matrixFactSavedReason>[1], "rule-A")).toBeNull();
  });
});
