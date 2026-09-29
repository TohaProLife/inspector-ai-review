import { describe, expect, it, vi } from "vitest";
import { createInspectionRepositoryFromEnv, RoutedInspectionRepository } from "../src/repository-factory.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { InspectorStore } from "../src/store.js";
import type { AuthenticatedActor } from "../src/identity.js";
import type { AuditedMutationCommand, JobAttemptInput,
  FactEntityLinkReviewInput, OcrRowTranscriptionReviewInput,
  VisualProposalReviewInput, ReviewCandidateDecisionInput } from "../src/repository.js";

describe("routed durable visual reads", () => {
  it("does not expose the public training seed from a running repository", async () => {
    const repository = await createInspectionRepositoryFromEnv({});
    expect(await repository.listObjects()).toEqual([]);
    expect(await repository.getObject("OBJ-TYUMENSKAYA-5-GOLD-SEED")).toBeUndefined();
  });

  it("forwards fenced OCR layout artifact reads to PostgreSQL", async () => {
    const expected = { kind: "success", artifact: { schemaVersion: "analysis-stage-result-v2" } };
    const normal = { getJobOcrLayoutArtifact: vi.fn().mockResolvedValue(expected) } as unknown as PostgresInspectionRepository;
    const routed = new RoutedInspectionRepository(await InspectorStore.create(), normal);
    const input = { attemptId: "attempt", fencingToken: 1 } as JobAttemptInput;
    expect(await routed.getJobOcrLayoutArtifact("job", input)).toBe(expected);
    expect(normal.getJobOcrLayoutArtifact).toHaveBeenCalledWith("job", input);
  });
  it("selects visual V5 only when explicitly configured", async () => {
    const create = vi.spyOn(PostgresInspectionRepository, "create").mockResolvedValue({} as PostgresInspectionRepository);
    try {
      await createInspectionRepositoryFromEnv({ DATABASE_URL: "postgres://unused", INSPECTOR_ANALYSIS_PROFILE: "PILOT_PZ002" });
      expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ visualProfile: "V4" }));
      await createInspectionRepositoryFromEnv({ DATABASE_URL: "postgres://unused", INSPECTOR_ANALYSIS_PROFILE: "PILOT_PZ002", INSPECTOR_VISUAL_PROFILE: "V5" });
      expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ visualProfile: "V5" }));
      await createInspectionRepositoryFromEnv({ DATABASE_URL: "postgres://unused", INSPECTOR_ANALYSIS_PROFILE: "PILOT_PZ002", INSPECTOR_VISUAL_PROFILE: "V6" });
      expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ visualProfile: "V6" }));
      await expect(createInspectionRepositoryFromEnv({ DATABASE_URL: "postgres://unused", INSPECTOR_VISUAL_PROFILE: "external" }))
        .rejects.toThrow("Unsupported INSPECTOR_VISUAL_PROFILE");
    } finally {
      create.mockRestore();
    }
  });
  it("forwards pilot rule reads for a NORMAL check to PostgreSQL", async () => {
    const expected = { checkId: "CHK-NORMAL", status: "READY", items: [{ parameterCode: "PZ-017" }] };
    const normal = {
      getPilotResults: vi.fn().mockResolvedValue(expected),
    } as unknown as PostgresInspectionRepository;
    const routed = new RoutedInspectionRepository(await InspectorStore.create(), normal);
    const actor = {} as AuthenticatedActor;
    expect(await routed.getPilotResults("CHK-NORMAL", actor)).toEqual(expected);
    expect(normal.getPilotResults).toHaveBeenCalledWith("CHK-NORMAL", actor);
  });

  it("forwards a NORMAL check to PostgreSQL", async () => {
    const normal = {
      getVisualProposals: vi.fn().mockResolvedValue({
        status: "PROPOSAL_ONLY_UNVERIFIED", sources: [],
      }),
    } as unknown as PostgresInspectionRepository;
    const routed = new RoutedInspectionRepository(await InspectorStore.create(), normal);
    const result = await routed.getVisualProposals("CHK-NORMAL");
    expect(result).toMatchObject({ status: "PROPOSAL_ONLY_UNVERIFIED" });
    expect(normal.getVisualProposals).toHaveBeenCalledWith("CHK-NORMAL", undefined);
  });

  it("forwards visual review reads and commands to PostgreSQL", async () => {
    const normal = {
      listVisualProposalReviews: vi.fn().mockResolvedValue({ items: [], canReview: false }),
      recordVisualProposalReviewCommand: vi.fn().mockResolvedValue({ kind: "not_found" }),
    } as unknown as PostgresInspectionRepository;
    const routed = new RoutedInspectionRepository(await InspectorStore.create(), normal);
    const actor = {} as AuthenticatedActor;
    const input = {} as VisualProposalReviewInput;
    const command = {} as AuditedMutationCommand;
    expect(await routed.listVisualProposalReviews("CHK-NORMAL", actor)).toEqual({ items: [], canReview: false });
    expect(normal.listVisualProposalReviews).toHaveBeenCalledWith("CHK-NORMAL", actor);
    expect(await routed.recordVisualProposalReviewCommand("CHK-NORMAL", input, command)).toEqual({ kind: "not_found" });
    expect(normal.recordVisualProposalReviewCommand).toHaveBeenCalledWith("CHK-NORMAL", input, command);
  });

  it("forwards review candidate decisions for a NORMAL check", async () => {
    const listed = { items: [], canReview: true };
    const saved = { kind: "success", value: { id: "decision" }, replayed: false };
    const normal = {
      listReviewCandidateDecisions: vi.fn().mockResolvedValue(listed),
      recordReviewCandidateDecisionCommand: vi.fn().mockResolvedValue(saved),
    } as unknown as PostgresInspectionRepository;
    const routed = new RoutedInspectionRepository(await InspectorStore.create(), normal);
    const actor = {} as AuthenticatedActor;
    const input = {} as ReviewCandidateDecisionInput;
    const command = {} as AuditedMutationCommand;
    expect(await routed.listReviewCandidateDecisions("CHK-NORMAL", actor)).toBe(listed);
    expect(normal.listReviewCandidateDecisions).toHaveBeenCalledWith("CHK-NORMAL", actor);
    expect(await routed.recordReviewCandidateDecisionCommand("CHK-NORMAL", input, command)).toBe(saved);
    expect(normal.recordReviewCandidateDecisionCommand).toHaveBeenCalledWith("CHK-NORMAL", input, command);
  });

  it("exposes OCR transcription reviews through the routed NORMAL repository", async () => {
    const listed = { items: [], canReview: true, ocrStageSha256: "a".repeat(64), candidates: [] };
    const saved = { kind: "success", value: { id: "review" }, replayed: false };
    const normal = {
      getOcrRowTranscriptionReviews: vi.fn().mockResolvedValue(listed),
      recordOcrRowTranscriptionReviewCommand: vi.fn().mockResolvedValue(saved),
    } as unknown as PostgresInspectionRepository;
    const routed = new RoutedInspectionRepository(await InspectorStore.create(), normal);
    const actor = {} as AuthenticatedActor;
    const input = {} as OcrRowTranscriptionReviewInput;
    const command = {} as AuditedMutationCommand;
    expect(await routed.getOcrRowTranscriptionReviews("CHK-NORMAL", actor)).toBe(listed);
    expect(normal.getOcrRowTranscriptionReviews).toHaveBeenCalledWith("CHK-NORMAL", actor);
    expect(await routed.recordOcrRowTranscriptionReviewCommand("CHK-NORMAL", input, command)).toBe(saved);
    expect(normal.recordOcrRowTranscriptionReviewCommand)
      .toHaveBeenCalledWith("CHK-NORMAL", input, command);
  });

  it("forwards fact-link reads and commands for NORMAL checks", async () => {
    const listed = { items: [], canReview: true, canRun: true };
    const saved = { kind: "success", value: { id: "link" }, replayed: false };
    const normal = {
      listFactEntityLinks: vi.fn().mockResolvedValue(listed),
      recordFactEntityLinkCommand: vi.fn().mockResolvedValue(saved),
    } as unknown as PostgresInspectionRepository;
    const routed = new RoutedInspectionRepository(await InspectorStore.create(), normal);
    const actor = {} as AuthenticatedActor;
    const input = {} as FactEntityLinkReviewInput;
    const command = {} as AuditedMutationCommand;
    expect(await routed.listFactEntityLinks("CHK-NORMAL", actor)).toBe(listed);
    expect(normal.listFactEntityLinks).toHaveBeenCalledWith("CHK-NORMAL", actor);
    expect(await routed.recordFactEntityLinkCommand("CHK-NORMAL", input, command)).toBe(saved);
    expect(normal.recordFactEntityLinkCommand).toHaveBeenCalledWith("CHK-NORMAL", input, command);
  });
});
