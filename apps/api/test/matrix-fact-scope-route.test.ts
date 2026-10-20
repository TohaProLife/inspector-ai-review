import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { MatrixFactScope, MatrixFactTargetsRead, SourceReviewInput } from "@inspector-ai/contracts";
import { buildApp } from "../src/app.js";
import type { AuthenticatedActor, IdentityService } from "../src/identity.js";
import type { InspectionRepository } from "../src/repository.js";

const digest = (character: string) => character.repeat(64);
const actor: AuthenticatedActor = {
  sessionId: randomUUID(), userId: randomUUID(), organizationId: randomUUID(),
  displayName: "Fact reviewer", roles: ["INSPECTOR"], capabilities: ["SOURCE_REVIEW"],
  csrfHash: digest("a"), expiresAt: "2030-01-01T00:00:00Z",
};
const target = {
  checkId: "CHK-origin", executionContentHash: digest("b"), observationId: digest("c"),
  evidenceHash: digest("d"), textArtifactHash: digest("e"),
};
const scope: MatrixFactScope = {
  schemaVersion: "matrix-fact-scopes-v1", bindings: [{
    ruleId: "matrix-pz-002-building_total_area", ruleVersion: "1", parameterCode: "PZ-002",
    entityKey: "building-east", reference: "Проверена строка площади восточного здания",
    target,
    contexts: { BUILDING_SCOPE: { reference: "Заголовок относится к восточному зданию" } },
    tableContextReview: { fragmentsHash: digest("f"), reference: "Заголовок и строка проверены вместе на двух листах" },
  }],
};
const input: SourceReviewInput = {
  sourceSha256: digest("a"), revisionStatus: "CURRENT", approvalStatus: "APPROVED",
  linkGroupId: "project-building", sectionCode: "PZ", pageStages: {},
  basis: { reference: "Исходная проектная документация проверена" },
  expectedReviewHash: null, matrixScope: scope,
};
const targets: MatrixFactTargetsRead = {
  checkId: target.checkId, executionContentHash: target.executionContentHash,
  items: [{ sourceFileId: "FIL-PD", target, fragmentsHash: digest("f") }],
};
const url = "/api/objects/OBJ-1/files/FIL-PD/source-review";
const readUrl = "/api/checks/CHK-origin/matrix-fact-targets";
const headers = {
  cookie: "inspector_session=session; inspector_csrf=csrf",
  "x-csrf-token": "csrf", "idempotency-key": "fact-scope-review-001",
};

describe("per-fact source review HTTP boundary", () => {
  let app: FastifyInstance;
  let currentActor: AuthenticatedActor;
  const read = vi.fn();
  const record = vi.fn();
  const permission = vi.fn();

  beforeEach(async () => {
    currentActor = { ...actor };
    read.mockReset().mockResolvedValue(targets);
    permission.mockReset().mockResolvedValue(true);
    record.mockReset().mockImplementation(async (_objectId, _sourceFileId, review: SourceReviewInput) => ({
      kind: "success", replayed: false,
      value: { ...review, id: randomUUID(), objectId: "OBJ-1", sourceFileId: "FIL-PD",
        actorId: actor.userId, contentHash: digest("1"), createdAt: "2026-10-17T10:00:00Z" },
    }));
    const identity: IdentityService = {
      login: async () => undefined,
      resolveSession: async token => token === "session" ? currentActor : undefined,
      verifyCsrf: (_actor, token) => token === "csrf",
      revokeSession: async () => undefined,
      close: async () => undefined,
    };
    app = await buildApp({ repository: {
      getMatrixFactTargets: read, recordSourceReviewCommand: record, hasObjectPermission: permission,
    } as unknown as InspectionRepository, identityService: identity });
  });

  afterEach(async () => { await app.close(); });

  it("authenticates target reads and retains exact immutable origin hashes", async () => {
    expect((await app.inject({ method: "GET", url: readUrl })).statusCode).toBe(401);
    expect(read).not.toHaveBeenCalled();
    const response = await app.inject({ method: "GET", url: readUrl, headers: { cookie: headers.cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toEqual(targets);
    expect(read).toHaveBeenCalledWith(target.checkId, actor);
    for (const inaccessible of [undefined, "AUTH_REQUIRED"]) {
      read.mockResolvedValueOnce(inaccessible);
      expect((await app.inject({ method: "GET", url: readUrl,
        headers: { cookie: headers.cookie } })).statusCode).toBe(404);
    }
  });

  it("does not strip v2 bindings, contexts, table review, target or null CAS precondition", async () => {
    const response = await app.inject({ method: "POST", url, headers, payload: input });
    expect(response.statusCode, response.body).toBe(201);
    expect(record).toHaveBeenCalledWith("OBJ-1", "FIL-PD", input,
      expect.objectContaining({ actor, idempotencyKey: headers["idempotency-key"] }));
    expect(response.json().matrixScope).toEqual(scope);
    expect(response.json().actorId).toBe(actor.userId);

    const updated = { ...input, expectedReviewHash: digest("2") };
    await app.inject({ method: "POST", url, headers, payload: updated });
    expect(record.mock.calls[1][2]).toEqual(updated);
  });

  it("preserves typed rule context details instead of silently removing their fields", async () => {
    const typed = structuredClone(input);
    const binding = (typed.matrixScope as MatrixFactScope).bindings[0];
    binding.contexts = {
      NORM_APPLICABILITY: { reference: "Норма применима к указанному компоненту",
        applicable: true, parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA",
        threshold: "1", canonicalUnit: "m2", componentRole: "SLAB", componentKey: "slab-2",
        zoneKey: "zone-east", operatingModeKey: "winter", measurementBasisKey: "approved-project" },
      TECHNICAL_CONDITIONS_LIMIT: { reference: "Числовой предел сверён с техническими условиями", limitValue: "25.5" },
      APPROVED_CHANGE_CHECKED: { reference: "Изменение проверено по журналу согласования", approvedChangePresent: false },
      THERMAL_REDUCTION_CONFIRMED: { reference: "Снижение подтверждено расчётом теплотехники", reductionConfirmed: true },
      DRAWING_SECTION_VERIFIED: { reference: "Раздел проверен по штампу исходного листа", drawingSection: "PZ" },
    };
    const response = await app.inject({ method: "POST", url, headers, payload: typed });
    expect(response.statusCode, response.body).toBe(201);
    expect(record.mock.calls[0][2]).toEqual(typed);
    expect(response.json().matrixScope).toEqual(typed.matrixScope);
  });

  it("requires session, CSRF, source-review capability, object permission and idempotency", async () => {
    expect((await app.inject({ method: "POST", url, payload: input })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url, headers: { cookie: headers.cookie }, payload: input })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url,
      headers: { cookie: headers.cookie, "x-csrf-token": "csrf" }, payload: input })).statusCode).toBe(428);
    currentActor = { ...actor, capabilities: [] };
    expect((await app.inject({ method: "POST", url, headers, payload: input })).statusCode).toBe(403);
    currentActor = { ...actor };
    permission.mockResolvedValueOnce(false);
    expect((await app.inject({ method: "POST", url, headers, payload: input })).statusCode).toBe(403);
    expect(record).not.toHaveBeenCalled();
  });

  it.each(["duplicate", "entity-conflict", "rule-completeness", "parameter-completeness", "bad-target"])(
    "rejects %s before a command reaches storage", async variant => {
      const invalid = structuredClone(input);
      const factScope = invalid.matrixScope as MatrixFactScope;
      const binding = factScope.bindings[0];
      if (variant === "duplicate") factScope.bindings.push(structuredClone(binding));
      if (variant === "entity-conflict") factScope.bindings.push({ ...structuredClone(binding),
        ruleId: "another-rule", entityKey: "another-building" });
      if (variant === "rule-completeness") binding.contexts[`RULE_SCOPE_COMPLETE:${binding.ruleId}`] = {
        reference: "Неподдерживаемое утверждение полноты правила" };
      if (variant === "parameter-completeness") binding.contexts["PARAMETER_SCOPE_COMPLETE:PZ-002"] = {
        reference: "Неподдерживаемое утверждение полноты параметра" };
      if (variant === "bad-target") binding.target.textArtifactHash = "invalid";
      const response = await app.inject({ method: "POST", url, headers, payload: invalid });
      expect(response.statusCode, response.body).toBe(400);
      expect(record).not.toHaveBeenCalled();
    },
  );

  it("maps stale origin/CAS and replay outcomes without claiming a new decision", async () => {
    for (const code of ["SOURCE_REVIEW_STALE", "MATRIX_FACT_TARGET_MISMATCH", "MATRIX_FACT_RULE_MISMATCH"]) {
      record.mockResolvedValueOnce({ kind: "invalid_state", code, message: "Review no longer matches original" });
      const response = await app.inject({ method: "POST", url, headers, payload: input });
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe(code);
    }
    record.mockResolvedValueOnce({ kind: "success", replayed: true, value: {
      ...input, id: "existing-review", objectId: "OBJ-1", sourceFileId: "FIL-PD",
      actorId: actor.userId, contentHash: digest("1"), createdAt: "2026-10-17T10:00:00Z",
    } });
    const replay = await app.inject({ method: "POST", url, headers, payload: input });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.json().id).toBe("existing-review");
  });

  it("keeps the legacy source-scope body compatible", async () => {
    const { expectedReviewHash: _expected, ...legacy } = input;
    legacy.matrixScope = { entityKey: "legacy-building", reference: "Проверена идентичность целого документа",
      contexts: { BUILDING_SCOPE: { reference: "Документ относится к одному зданию" } } };
    const response = await app.inject({ method: "POST", url, headers, payload: legacy });
    expect(response.statusCode, response.body).toBe(201);
    expect(record.mock.calls[0][2]).toEqual(legacy);
    expect(response.json().matrixScope).toEqual(legacy.matrixScope);
  });
});
