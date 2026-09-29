import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

describe("web API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("unwraps collection responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ id: "OBJ-1" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const objects = await api.listObjects();

    expect(objects).toEqual([{ id: "OBJ-1" }]);
    expect(fetchMock).toHaveBeenCalledWith("/api/objects", expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("unwraps the parameter coverage ledger", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ parameterCode: "PZ-001", executionStatus: "UNSUPPORTED" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const coverage = await api.getCoverage("CHK-1");

    expect(coverage).toEqual([{ parameterCode: "PZ-001", executionStatus: "UNSUPPORTED" }]);
    expect(fetchMock).toHaveBeenCalledWith("/api/checks/CHK-1/coverage", expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("shows the API message for rejected actions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Сначала обработайте всех кандидатов" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(api.finalize("CHK-1")).rejects.toThrow("Сначала обработайте всех кандидатов");
  });

  it("sends the CSRF cookie on normal JSON mutations", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/checks/CHK-1" && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({
          id: "CHK-1",
          mode: "NORMAL",
          stats: { unsupported: 1 },
          decisionSetHash: "a".repeat(64),
          gapsHash: "b".repeat(64),
        }), {
          status: 200,
          headers: { "Content-Type": "application/json", ETag: '"inspection-4"' },
        });
      }
      return new Response(JSON.stringify({ id: "RESOURCE-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", { cookie: "theme=light; inspector_csrf=csrf-token" });

    await api.createObject({ name: "Объект", address: "г. Москва" });
    await api.startCheck("OBJ-1");
    await api.finalize("CHK-1", "Допустим выпуск неполного протокола для пилотной проверки");

    for (const [, init] of [fetchMock.mock.calls[0], fetchMock.mock.calls[1], fetchMock.mock.calls[3]] as Array<[string, RequestInit]>) {
      expect((init.headers as Headers).get("X-CSRF-Token")).toBe("csrf-token");
    }
    for (const [, init] of [fetchMock.mock.calls[0], fetchMock.mock.calls[1], fetchMock.mock.calls[3]] as Array<[string, RequestInit]>) {
      expect((init.headers as Headers).get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect((fetchMock.mock.calls[2][1].headers as Headers).has("Idempotency-Key")).toBe(false);
    expect((fetchMock.mock.calls[3][1].headers as Headers).get("If-Match")).toBe('"inspection-4"');
    expect(JSON.parse(fetchMock.mock.calls[3][1].body as string)).toEqual({
      runId: "CHK-1",
      decisionSetHash: "a".repeat(64),
      acknowledgedGapsHash: "b".repeat(64),
      acknowledgementReason: "Допустим выпуск неполного протокола для пилотной проверки",
    });
  });

  it("sends the current inspection version when revoking a protocol", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/checks/CHK-1" && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ id: "CHK-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json", ETag: '"inspection-8"' },
        });
      }
      return new Response(JSON.stringify({ id: "REV-1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", { cookie: "inspector_csrf=csrf-token" });

    await api.revokeProtocol(
      "CHK-1",
      "PRT-1",
      "PROTOCOL_CONTENT_ERROR",
      "В финальном протоколе неверно указано значение параметра",
    );

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(fetchMock.mock.calls[1][0]).toBe("/api/protocols/PRT-1/revoke");
    expect(init.method).toBe("POST");
    expect((init.headers as Headers).get("If-Match")).toBe('"inspection-8"');
    expect((init.headers as Headers).get("X-CSRF-Token")).toBe("csrf-token");
    expect((init.headers as Headers).get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(init.body as string)).toEqual({
      reasonCode: "PROTOCOL_CONTENT_ERROR",
      comment: "В финальном протоколе неверно указано значение параметра",
    });
  });

  it("acknowledges a PARTIAL run even when every parameter has partial rather than unsupported coverage", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "CHK-PARTIAL", mode: "NORMAL", status: "PARTIAL", stats: { unsupported: 0 },
        decisionSetHash: "a".repeat(64), gapsHash: "b".repeat(64),
      }), { headers: { "Content-Type": "application/json", ETag: '"inspection-2"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "PRT-PARTIAL" }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await api.finalize("CHK-PARTIAL", "Результаты частичных правил проверены инспектором");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      runId: "CHK-PARTIAL", decisionSetHash: "a".repeat(64), acknowledgedGapsHash: "b".repeat(64),
      acknowledgementReason: "Результаты частичных правил проверены инспектором",
    });
  });

  it("sends selected documents as multipart without overriding the browser boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "UPL-1", files: [] }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", { cookie: "inspector_csrf=csrf-token" });
    const file = new File(["%PDF-1.7\n%%EOF\n"], "project.pdf", { type: "application/pdf" });

    await api.uploadFiles("OBJ-1", "PD", [file]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Headers).has("Content-Type")).toBe(false);
    expect((init.headers as Headers).get("X-CSRF-Token")).toBe("csrf-token");
    expect((init.headers as Headers).get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(fetchMock).toHaveBeenCalledWith("/api/objects/OBJ-1/files?stage=PD", expect.any(Object));
  });
});
