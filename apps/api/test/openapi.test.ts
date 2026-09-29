import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  apiOperationContracts,
  apiSchemas,
  type ApiOperationId,
} from "../src/api-contract.js";
import { buildApp } from "../src/app.js";
import { openApiDocument } from "../src/openapi.js";

type OpenApiOperation = {
  operationId: string;
  parameters: Array<{ name: string; in: string; required: boolean }>;
  requestBody?: unknown;
  responses: Record<string, unknown>;
};

function documentedOperation(id: ApiOperationId): OpenApiOperation {
  const contract = apiOperationContracts.find((candidate) => candidate.id === id);
  if (!contract) throw new Error(`Missing contract ${id}`);
  const path = openApiDocument.paths[contract.openApiPath] as Record<string, OpenApiOperation>;
  return path[contract.method];
}

function collectRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRefs(item, refs));
    return refs;
  }
  if (!value || typeof value !== "object") return refs;
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string") refs.push(child);
    else collectRefs(child, refs);
  }
  return refs;
}

describe("canonical legacy API contract", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("serves the same complete document that is bound to the route schemas", async () => {
    const response = await app.inject({ method: "GET", url: "/api/openapi.json" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(openApiDocument);
    expect(Object.keys(openApiDocument.components.schemas)).toHaveLength(Object.keys(apiSchemas).length);

    for (const contract of apiOperationContracts) {
      const operation = documentedOperation(contract.id);
      expect(operation.operationId).toBe(contract.id);
      expect(Object.keys(operation.responses).length).toBeGreaterThan(0);
      if ("bodySchema" in contract || "multipartBody" in contract) expect(operation.requestBody).toBeDefined();

      const pathTokens = [...contract.openApiPath.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
      for (const token of pathTokens) {
        expect(operation.parameters).toContainEqual(
          expect.objectContaining({ name: token, in: "path", required: true }),
        );
      }
    }
  });

  it("keeps every schema reference resolvable inside the published document", () => {
    const refs = collectRefs(openApiDocument);
    expect(refs.length).toBeGreaterThan(0);

    for (const schemaRef of refs) {
      expect(schemaRef).toMatch(/^#\/components\/schemas\/[A-Za-z]+$/);
      const schemaName = schemaRef.slice("#/components/schemas/".length);
      expect(apiSchemas).toHaveProperty(schemaName);
    }
  });

  it("publishes optional v3 OCR label continuation without changing v1/v2 requirements", () => {
    expect(apiSchemas.OcrTableRowsRead.properties.profileId.enum).toEqual([
      "conservative-ocr-table-rows-v1", "conservative-ocr-table-rows-v2",
      "conservative-ocr-table-rows-v3",
    ]);
    expect(apiSchemas.OcrTableProposalRead.required).not.toContain("labelContinuationEvidence");
    expect(apiSchemas.OcrTableProposalRead.properties.labelContinuationEvidence).toEqual({
      type: "array", maxItems: 1,
      items: { $ref: "#/components/schemas/OcrTableEvidenceRead" },
    });
    expect(apiSchemas.OcrRowTranscriptionProvenance.required)
      .not.toContain("labelContinuationEvidence");
    expect(apiSchemas.OcrRowTranscriptionProvenance.properties.labelContinuationEvidence).toEqual(
      apiSchemas.OcrTableProposalRead.properties.labelContinuationEvidence,
    );
    expect(apiSchemas.OcrTableEvidenceRead.properties.role.enum)
      .toContain("rowLabelContinuation");
    expect(apiSchemas.OcrTableAbstentionRead.properties.reasonCode.enum)
      .toContain("ROW_LABEL_CONTINUATION_AMBIGUOUS");
  });

  it("publishes v6 OCR review counters and reason codes without requiring them for older profiles", () => {
    const schema = apiSchemas.OcrLayoutRead;
    expect(schema.properties.schemaVersion.enum).toContain("bounded-ocr-layout-analysis-v6");
    expect(schema.properties.providerProfileId.enum).toContain("local-bounded-ocr-layout-v6");
    expect(schema.properties.processedPageCount.maximum).toBe(4);
    expect(schema.required).not.toContain("reviewEligiblePageCount");
    expect(schema.required).not.toContain("stageUnresolvedPageCount");
    expect(schema.properties.reviewEligiblePageCount).toEqual({ type: "integer", minimum: 0 });
    expect(schema.properties.stageUnresolvedPageCount).toEqual({ type: "integer", minimum: 0 });
    const source = schema.properties.sources.items;
    expect(source.required).not.toContain("selectionReasonCodes");
    expect(source.properties.pages.maxItems).toBe(4);
    expect(source.properties.selectionReasonCodes.items.enum).toContain("PAGE_STAGE_UNRESOLVED");
    const artifact = documentedOperation("downloadJobOcrLayoutArtifact");
    const headers = (artifact.responses["200"] as {
      headers: Record<string, { schema: { enum?: string[] } }>;
    }).headers;
    expect(headers["X-Artifact-Schema-Version"].schema.enum)
      .toContain("bounded-ocr-layout-analysis-v6");
    expect(headers["X-Provider-Profile-Id"].schema.enum)
      .toContain("local-bounded-ocr-layout-v6");
  });

  it("documents every status returned by representative real requests", async () => {
    const cases: Array<{
      operationId: ApiOperationId;
      method: "GET" | "POST";
      url: string;
      payload?: Record<string, unknown>;
    }> = [
      { operationId: "getHealth", method: "GET", url: "/api/health" },
      { operationId: "getOpenApi", method: "GET", url: "/api/openapi.json" },
      {
        operationId: "login",
        method: "POST",
        url: "/api/auth/login",
        payload: { login: "inspector", password: "Password-For-Contract-Only" },
      },
      { operationId: "getSession", method: "GET", url: "/api/auth/session" },
      { operationId: "logout", method: "POST", url: "/api/auth/logout" },
      { operationId: "listObjects", method: "GET", url: "/api/objects" },
      { operationId: "createObject", method: "POST", url: "/api/objects", payload: { name: "x" } },
      { operationId: "getObject", method: "GET", url: "/api/objects/missing" },
      {
        operationId: "uploadObjectFiles",
        method: "POST",
        url: "/api/objects/OBJ-TYUMENSKAYA-5-GOLD-SEED/files?stage=PD",
      },
      { operationId: "getUpload", method: "GET", url: "/api/uploads/missing" },
      {
        operationId: "startCheck",
        method: "POST",
        url: "/api/objects/OBJ-TYUMENSKAYA-5-GOLD-SEED/checks",
      },
      { operationId: "getCheck", method: "GET", url: "/api/checks/CHK-TYUMENSKAYA-5-001" },
      {
        operationId: "listCheckFindings",
        method: "GET",
        url: "/api/checks/CHK-TYUMENSKAYA-5-001/findings",
      },
      {
        operationId: "getCheckCoverage",
        method: "GET",
        url: "/api/checks/CHK-TYUMENSKAYA-5-001/coverage",
      },
      { operationId: "getFinding", method: "GET", url: "/api/findings/FND-0001" },
      {
        operationId: "decideFinding",
        method: "POST",
        url: "/api/findings/FND-0001/decision",
        payload: { type: "CONFIRM", reason: "нет" },
      },
      { operationId: "reprocessCheck", method: "POST", url: "/api/checks/missing/reprocess" },
      {
        operationId: "finalizeCheck",
        method: "POST",
        url: "/api/checks/CHK-TYUMENSKAYA-5-001/finalize",
      },
      {
        operationId: "listCheckProtocols",
        method: "GET",
        url: "/api/checks/CHK-TYUMENSKAYA-5-001/protocols",
      },
      {
        operationId: "revokeProtocol",
        method: "POST",
        url: "/api/protocols/PRT-TYUMENSKAYA-5-V1/revoke",
        payload: {
          reasonCode: "PROTOCOL_CONTENT_ERROR",
          comment: "Исправление содержания финального протокола",
        },
      },
      {
        operationId: "getCheckSubmission",
        method: "GET",
        url: "/api/checks/CHK-TYUMENSKAYA-5-001/submission",
      },
      {
        operationId: "exportProtocol",
        method: "GET",
        url: "/api/protocols/PRT-TYUMENSKAYA-5-V1/export",
      },
      {
        operationId: "downloadCanonicalProtocolArtifact",
        method: "GET",
        url: "/api/protocols/PRT-TYUMENSKAYA-5-V1/artifacts/canonical-json",
      },
      { operationId: "listParameters", method: "GET", url: "/api/parameters" },
    ];

    for (const testCase of cases) {
      const response = await app.inject({
        method: testCase.method,
        url: testCase.url,
        payload: testCase.payload,
      });
      const operation = documentedOperation(testCase.operationId);
      expect(operation.responses, `${testCase.operationId} returned undocumented ${response.statusCode}`).toHaveProperty(
        String(response.statusCode),
      );
      expect(response.headers["content-type"]).toContain("application/json");
    }
  });
});
