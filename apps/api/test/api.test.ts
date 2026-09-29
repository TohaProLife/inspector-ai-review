import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { InspectorStore } from "../src/store.js";

describe("inspection API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("loads all 132 parameters from the supplied reference dataset", async () => {
    const response = await app.inject({ method: "GET", url: "/api/parameters" });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(132);
  });

  it("exposes public training findings as AI candidates, not human decisions", async () => {
    const objects = await app.inject({ method: "GET", url: "/api/objects" });
    const checkId = objects.json().items[0].activeCheckId;
    const response = await app.inject({ method: "GET", url: `/api/checks/${checkId}/findings` });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(10);
    expect(response.json().items.every((item: { status: string }) => item.status === "CANDIDATE")).toBe(true);
    expect(response.json().items.every((item: { confidence: number | null }) => item.confidence === null)).toBe(true);
  });

  it("exposes an explicit 132-row unsupported coverage ledger", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/checks/CHK-TYUMENSKAYA-5-001/coverage",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(132);
    expect(response.json().items.every((item: { executionStatus: string }) => item.executionStatus === "UNSUPPORTED")).toBe(true);
  });

  it("requires a reason before an inspector can confirm a finding", async () => {
    const rejected = await app.inject({
      method: "POST",
      url: "/api/findings/FND-0001/decision",
      payload: { type: "CONFIRM", reason: "нет" },
    });
    expect(rejected.statusCode).toBe(400);

    const accepted = await app.inject({
      method: "POST",
      url: "/api/findings/FND-0001/decision",
      payload: { type: "CONFIRM", reason: "Несоответствие подтверждено по двум листам" },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().status).toBe("CONFIRMED_VIOLATION");
    expect(accepted.json().decision.author).toBe("Демо-инспектор");
  });

  it("exports the stored protocol snapshot instead of rebuilding it from mutable findings", async () => {
    const before = await app.inject({
      method: "GET",
      url: "/api/protocols/PRT-TYUMENSKAYA-5-V1/export",
    });
    expect(before.statusCode).toBe(200);
    expect(before.json().findings[0]).toMatchObject({ status: "CANDIDATE", decision: null });

    await app.inject({
      method: "POST",
      url: "/api/findings/FND-0001/decision",
      payload: {
        type: "CONFIRM",
        reason: "Это решение не должно переписать старый snapshot",
        author: "Подменённый клиентом actor",
      },
    });

    const after = await app.inject({
      method: "GET",
      url: "/api/protocols/PRT-TYUMENSKAYA-5-V1/export",
    });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toEqual(before.json());
  });

  it("does not finalize a check while candidates remain", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/checks/CHK-TYUMENSKAYA-5-001/finalize",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("PENDING_DECISIONS");
  });

  it("exports a submission-schema payload only after all decisions", async () => {
    for (let index = 1; index <= 10; index += 1) {
      await app.inject({
        method: "POST",
        url: `/api/findings/FND-${String(index).padStart(4, "0")}/decision`,
        payload: {
          type: index === 1 ? "CONFIRM" : "REJECT",
          reason: "Проверено инспектором по приложенным страницам",
        },
      });
    }

    const response = await app.inject({
      method: "GET",
      url: "/api/checks/CHK-TYUMENSKAYA-5-001/submission",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().object_id).toBe("OBJ-TYUMENSKAYA-5-GOLD-SEED");
    expect(response.json().checks).toHaveLength(10);
    expect(response.json().checks[0]).toMatchObject({
      parameter_code: "IOS4-079",
      violation_label: "VIOLATION_PRESENT",
      protocol_status: "CRITICAL",
    });
    expect(response.json().checks[0].evidence[0]).toEqual({
      stage: "PD",
      file_id: "F0171",
      pdf_page_number: 104,
    });
  });

  it("keeps the demo seed out of a normal analysis and blocks false completion", async () => {
    const store = await InspectorStore.create();
    store.decideFinding("FND-0001", {
      type: "CONFIRM",
      reason: "Подтверждено инспектором на учебном объекте",
      author: "Тест",
    });
    const object = store.createObject({ name: "Новый объект", address: "г. Москва, тестовый адрес" });
    store.registerIngestedFiles(object.id, [
      {
        id: "FIL-TEST",
        name: "project.pdf",
        size: 100,
        stage: "PD",
        mimeType: "application/pdf",
        sha256: "a".repeat(64),
        scanStatus: "CLEAN",
        status: "STORED",
      },
    ]);
    const check = store.startCheck(object.id)!;
    store.completeCheck(check.id);

    expect(store.getCheck(check.id)).toMatchObject({
      mode: "NORMAL",
      status: "PARTIAL",
      progress: 100,
      stats: { total: 132, unsupported: 132, candidates: 0, negativeVerified: 0 },
    });
    expect(store.getFindings(check.id)).toEqual([]);
    expect(store.getCoverage(check.id)).toHaveLength(132);
    expect(store.finalize(check.id)).toBe("INCOMPLETE_ANALYSIS");
    expect(store.getSubmission(check.id)).toBe("INCOMPLETE_ANALYSIS");
    expect(store.getProtocols(check.id)).toEqual([]);
  });
});
