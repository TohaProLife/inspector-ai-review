import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { AuthenticatedActor, IdentityService } from "../src/identity.js";
import type { InspectionRepository } from "../src/repository.js";
import type { ObjectStorage } from "../src/storage.js";
import { InspectorStore } from "../src/store.js";

describe("scoped PDF crop preview route", () => {
  let app: FastifyInstance;
  let pdf: Buffer;
  let reads: number;

  beforeEach(async () => {
    pdf = await readFile(new URL("./fixtures/rotated.pdf", import.meta.url));
    reads = 0;
    const digest = createHash("sha256").update(pdf).digest("hex");
    const actor: AuthenticatedActor = {
      sessionId: "session", userId: "reviewer", displayName: "Reviewer",
      organizationId: "org", roles: ["INSPECTOR"], capabilities: ["READ"],
      csrfHash: "", expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const identity: IdentityService = {
      login: async () => undefined,
      resolveSession: async (token) => token === "valid" ? actor : undefined,
      verifyCsrf: () => false,
      revokeSession: async () => {},
      close: async () => {},
    };
    const memory = await InspectorStore.create();
    const repository = new Proxy(memory, {
      get(target, property) {
        if (property === "getSourceFileContent") return async (objectId: string, sourceFileId: string, currentActor: AuthenticatedActor) =>
          objectId === "OBJ-allowed" && ["FIL-allowed", "FIL-bad-hash"].includes(sourceFileId)
            && currentActor.userId === actor.userId
            ? { name: "rotated.pdf", storageKey: "rotated", byteSize: pdf.byteLength,
              sha256: sourceFileId === "FIL-allowed" ? digest : "0".repeat(64), mediaType: "application/pdf" }
            : undefined;
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as InspectionRepository;
    const storage: ObjectStorage = {
      putFile: async () => {},
      getFile: async () => { reads += 1; return { body: Readable.from(pdf), size: pdf.byteLength }; },
    };
    app = await buildApp({ repository, identityService: identity, storage });
  });

  afterEach(async () => { await app.close(); });

  it("keeps source scope and authentication for full pages and crops", async () => {
    const base = "/api/objects/OBJ-allowed/files/FIL-allowed/pages/1/preview";
    const anonymous = await app.inject({ method: "GET", url: `${base}?crop=0.72,0.06,0.76,0.10` });
    expect(anonymous.statusCode).toBe(401);
    const foreign = await app.inject({ method: "GET", url: "/api/objects/OBJ-foreign/files/FIL-allowed/pages/1/preview?crop=0.72,0.06,0.76,0.10", headers: { cookie: "inspector_session=valid" } });
    expect(foreign.statusCode).toBe(404);
    expect(reads).toBe(0);

    const full = await app.inject({ method: "GET", url: base, headers: { cookie: "inspector_session=valid" } });
    expect(full.statusCode).toBe(200);
    expect(full.headers["content-type"]).toBe("image/png");
    const cropped = await app.inject({ method: "GET", url: `${base}?crop=0.72,0.06,0.76,0.10`, headers: { cookie: "inspector_session=valid" } });
    expect(cropped.statusCode).toBe(200);
    expect(cropped.headers["cache-control"]).toBe("private, no-store");
    expect(cropped.headers["content-type"]).toBe("image/png");
    expect(cropped.rawPayload.readUInt32BE(16)).toBeLessThan(full.rawPayload.readUInt32BE(16));
    expect(reads).toBe(2);
  });

  it("rejects an invalid crop before storage and a mismatched source SHA before rendering", async () => {
    const headers = { cookie: "inspector_session=valid" };
    const invalid = await app.inject({ method: "GET", url: "/api/objects/OBJ-allowed/files/FIL-allowed/pages/1/preview?crop=1,0,0,1", headers });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toBe("INVALID_CROP");
    expect(reads).toBe(0);

    const badHash = await app.inject({ method: "GET", url: "/api/objects/OBJ-allowed/files/FIL-bad-hash/pages/1/preview?crop=0.72,0.06,0.76,0.10", headers });
    expect(badHash.statusCode).toBe(422);
    expect(badHash.json().error).toBe("SOURCE_INTEGRITY_ERROR");
  });
});
