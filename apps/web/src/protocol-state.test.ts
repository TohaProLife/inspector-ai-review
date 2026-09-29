import type { CheckRun, SessionUser } from "@inspector-ai/contracts";
import { describe, expect, it } from "vitest";
import { protocolFinalizationBlock, protocolRequiresGapAcknowledgement } from "./protocol-state";

const supervisor = { roles: ["SUPERVISOR"], capabilities: [] } as unknown as SessionUser;
const check = { mode: "NORMAL", status: "PARTIAL", completedAt: "2026-09-29T12:00:00Z", stats: { candidates: 0, unsupported: 0 } } as CheckRun;

describe("protocol readiness", () => {
  it.each(["PROCESSING", "VALIDATING", "UPLOADING", "DRAFT", "FAILED"] as const)("blocks %s even with no candidates", (status) => {
    expect(protocolFinalizationBlock({ ...check, status }, supervisor)).not.toBeNull();
  });
  it("waits for the API completion timestamp and remaining decisions", () => {
    expect(protocolFinalizationBlock({ ...check, completedAt: null }, supervisor)).not.toBeNull();
    expect(protocolFinalizationBlock({ ...check, stats: { ...check.stats, candidates: 1 } }, supervisor)).toContain("1 кандидатов");
  });
  it("uses API role or explicit FINALIZE capability without hiding read access", () => {
    expect(protocolFinalizationBlock(check, supervisor)).toBeNull();
    expect(protocolFinalizationBlock(check, { ...supervisor, roles: ["CURATOR"] })).toContain("нет права");
    expect(protocolFinalizationBlock(check, { ...supervisor, roles: ["CURATOR"], capabilities: ["FINALIZE"] })).toBeNull();
    expect(protocolFinalizationBlock(check, null)).toContain("нет права");
    expect(protocolFinalizationBlock({ ...check, mode: "DEMO_SEED" }, null)).toBeNull();
  });
  it("requires gap acknowledgement for partial rules even when all parameters have partial coverage", () => {
    expect(protocolRequiresGapAcknowledgement(check)).toBe(true);
    expect(protocolRequiresGapAcknowledgement({ ...check, status: "READY_TO_FINALIZE", stats: { ...check.stats, unsupported: 1 } })).toBe(true);
    expect(protocolRequiresGapAcknowledgement({ ...check, status: "READY_TO_FINALIZE" })).toBe(false);
    expect(protocolRequiresGapAcknowledgement({ ...check, mode: "DEMO_SEED" })).toBe(false);
  });
  it("keeps an already finalized protocol read-only", () => {
    expect(protocolFinalizationBlock({ ...check, status: "FINALIZED" }, supervisor)).toContain("уже зафиксирована");
  });
});
