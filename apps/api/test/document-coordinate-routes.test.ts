import Fastify from "fastify";
import { Readable } from "node:stream";
import { afterEach, expect, it } from "vitest";
import { registerDocumentCoordinateRoutes } from "../src/document-coordinate-routes.js";
import { LocalRegistrationError } from "../src/postgres-local-registration.js";
import { localRegistrationPdf } from "./local-registration-fixture.js";
import { sha256 } from "../src/canonical-json.js";
import type { AuthenticatedActor } from "../src/identity.js";

const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
async function fixture() {
  const app = Fastify(); apps.push(app);
  const pdf = localRegistrationPdf("coordinate-preview", 270), digest = sha256(pdf);
  let activeCheck = "CHK-current", storedBytes = pdf, onRead = () => {}; const sourceCalls: string[] = [];
  const actor = { userId: "reader", organizationId: "org" } as AuthenticatedActor;
  registerDocumentCoordinateRoutes(app, {
    requireActor: async (request, reply) => { if (request.headers.cookie !== "reader") { reply.status(401).send({ error: "AUTH_REQUIRED", message: "session required" }); return; } return actor; },
    verifyCsrf: (request, reply) => { if (request.headers["x-csrf-token"] === "csrf") return true;
      reply.status(403).send({ error: "CSRF_REQUIRED", message: "csrf required" }); return false; },
    service: { coordinateSourceReference: async (objectId, sourceFileId, checkId) => {
      sourceCalls.push(`${objectId}:${sourceFileId}:${checkId}`);
      if (objectId !== "OBJ-selected" || sourceFileId !== "FIL-selected") throw new LocalRegistrationError(404, "NOT_FOUND", "source not available");
      if (checkId !== activeCheck) throw new LocalRegistrationError(409, "CHECK_CHANGED", "check changed");
      return { name: "original.pdf", storageKey: "source.pdf", byteSize: pdf.length, sha256: digest, mediaType: "application/pdf" };
    } },
    storage: { putFile: async () => { throw Error("write forbidden"); }, getFile: async () => {
      onRead(); return { body: Readable.from([storedBytes]), size: storedBytes.length, contentType: "application/pdf" };
    } },
  });
  const base = "/api/objects/OBJ-selected/files/FIL-selected/pages/1/document-coordinate-frame?checkId=CHK-current";
  const headers = { cookie: "reader", "x-csrf-token": "csrf" };
  async function input() {
    const response = await app.inject({ method: "GET", url: base, headers }); expect(response.statusCode, response.body).toBe(200);
    return { schemaVersion: "document-coordinate-preview-v1", checkId: "CHK-current", sourceFrame: response.json(),
      target: { label: "Analyst local coordinates", unit: "m", yAxis: "UP", minScale: 90, maxScale: 110, maxHoldoutResidual: .01 },
      points: [[.1,.1], [.8,.1], [.1,.8], [.8,.8]].map(([x,y], i) => ({ id: `P${i}`, page: [x,y], printed: [100*x, 100*(1-y)],
        role: i < 3 ? "FIT" : "HOLDOUT", reference: `manually associated original point ${i}` })), queryPoints: [] };
  }
  return { app, base, headers, input, sourceCalls, setActive: (v: string) => { activeCheck = v; },
    changeDuringRead: () => { onRead = () => { activeCheck = "CHK-next"; }; },
    corrupt: () => { storedBytes = localRegistrationPdf("tampered", 270); } };
}
it("authenticates before any original read; POST preview requires CSRF and no command key", async () => {
  const f = await fixture();
  expect((await f.app.inject({ method: "GET", url: f.base })).statusCode).toBe(401); expect(f.sourceCalls).toHaveLength(0);
  const input = await f.input(); const count = f.sourceCalls.length;
  const url = "/api/objects/OBJ-selected/document-coordinates/preview";
  expect((await f.app.inject({ method: "POST", url, headers: { cookie: "reader" }, payload: input })).statusCode).toBe(403);
  expect(f.sourceCalls).toHaveLength(count);
  const response = await f.app.inject({ method: "POST", url, headers: f.headers, payload: input });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.json()).toMatchObject({ status: "PREVIEW_ONLY", coordinateAuthority: "USER_DECLARED_UNVERIFIED",
    absoluteGeoreference: false, physicalPositionValidated: false, calibratedProbability: null, facts: [], result: { status: "CALCULATED" } });
  expect(response.json().sourceFrame).toMatchObject({ rotate: 270, visibleWidthPt: 140, visibleHeightPt: 160, geometryPrecisionPt: .01 });
  expect(response.json().sourceFrame).not.toHaveProperty("floorKey");
  const again = await f.app.inject({ method: "POST", url, headers: f.headers, payload: input }); expect(again.body).toBe(response.body);
});
it("rejects foreign sources/objects/current check and storage SHA mismatch", async () => {
  const f = await fixture(); const input = await f.input();
  for (const path of [f.base.replace("OBJ-selected", "OBJ-foreign"), f.base.replace("FIL-selected", "FIL-foreign")])
    expect((await f.app.inject({ method: "GET", url: path, headers: f.headers })).statusCode).toBe(404);
  f.setActive("CHK-next");
  expect((await f.app.inject({ method: "GET", url: f.base, headers: f.headers })).statusCode).toBe(409);
  expect((await f.app.inject({ method: "POST", url: "/api/objects/OBJ-selected/document-coordinates/preview", headers: f.headers, payload: input })).statusCode).toBe(409);
  f.setActive("CHK-current"); f.corrupt();
  expect((await f.app.inject({ method: "GET", url: f.base, headers: f.headers })).statusCode).toBe(503);
});
it("preserves mismatched canonical frame as abstention, rejects extra fields, caps request size", async () => {
  const f = await fixture(); const input = await f.input(); const url = "/api/objects/OBJ-selected/document-coordinates/preview";
  input.sourceFrame.rotate = 90;
  const result = await f.app.inject({ method: "POST", url, headers: f.headers, payload: input });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json()).toMatchObject({ status: "PREVIEW_ONLY", result: { status: "ABSTAIN", reasonCode: "PAGE_FRAME_MISMATCH" } });
  expect((await f.app.inject({ method: "POST", url, headers: f.headers, payload: { ...input, trusted: true } })).statusCode).toBe(400);
  expect((await f.app.inject({ method: "POST", url, headers: f.headers, payload: { ...input, extra: "x".repeat(140_000) } })).statusCode).toBe(413);
});
it("rechecks active manifest after reading original bytes rather than returning a stale frame", async () => {
  const f = await fixture(); f.changeDuringRead();
  const response = await f.app.inject({ method: "GET", url: f.base, headers: f.headers });
  expect(response.statusCode, response.body).toBe(409);
  expect(response.json().error).toBe("CHECK_CHANGED"); expect(f.sourceCalls).toHaveLength(2);
});
