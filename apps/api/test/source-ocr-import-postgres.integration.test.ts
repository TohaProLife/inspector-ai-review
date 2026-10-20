import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SourceOcrImportRecord, SourceOcrReviewInput, SourceOcrReviewRecord } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { LocalObjectStorage } from "../src/storage.js";
// @ts-expect-error Opt-in JS fixture has no declaration file.
import { seedSourceOcrFixture } from "../../../scripts/smoke-source-ocr-app.mjs";
const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
(adminUrl ? describe : describe.skip)("Source OCR derivative import: actual PG/HTTP/native gaps", { timeout: 180000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedSourceOcrFixture>>, record: SourceOcrImportRecord, review: SourceOcrReviewRecord;
  let baseline: unknown;
  const key = randomUUID();
  const route = () => `/api/checks/${fixture.checkId}/sources/${fixture.files[0].id}/source-ocr-imports`;
  const listRoute = () => `/api/checks/${fixture.checkId}/source-ocr-imports`;
  const post = (payload = fixture.bundle, commandKey = key, headers = fixture.headers) => fixture.app.inject({ method: "POST", url: route(), headers: { ...headers, "idempotency-key": commandKey }, payload });
  const input = (): SourceOcrReviewInput => ({ schemaVersion: "source-ocr-review-command-v1", importId: record.id, importContentHash: record.contentHash,
    pageNumber: 2, ordinal: 0, lineHash: record.derived.pages[0].lines[0].lineHash, decision: "CONFIRMED", basis: "Сверено с изображением исходной страницы2", expectedReviewHash: null });
  const reviewPost = (payload: unknown = input(), commandKey = randomUUID(), headers = fixture.headers) => fixture.app.inject({ method: "POST", url: `/api/checks/${fixture.checkId}/source-ocr-reviews`, headers: { ...headers, "idempotency-key": commandKey }, payload });
  async function domain() {
    const rows = (await fixture.db.query(`SELECT (SELECT count(*)::int FROM rule_results) AS rules,
      (SELECT count(*)::int FROM source_review_decisions) AS sources,(SELECT count(*)::int FROM inspection_protocol_versions) AS protocols,
      (SELECT string_agg(content_hash,',' ORDER BY id) FROM analysis_text_artifacts) AS text,
      (SELECT string_agg(content_hash,',' ORDER BY release_id) FROM analysis_releases) AS releases,
      (SELECT count(*)::int FROM analysis_jobs) AS jobs`)).rows;
    return { rows, coverage: await fixture.repo.getCoverage(fixture.checkId, fixture.actor) };
  }
  beforeAll(async () => { fixture = await seedSourceOcrFixture(adminUrl, { seal: false }); });
  afterAll(async () => { await fixture?.close(); });

  it("authenticates before existence, requires CSRF/key and refuses unsealed parent", async () => {
    expect((await fixture.app.inject(route())).statusCode).toBe(404); // No GET import-by-source endpoint.
    expect((await fixture.app.inject(listRoute())).statusCode).toBe(401);
    expect((await fixture.app.inject({ method: "POST", url: route(), payload: fixture.bundle })).statusCode).toBe(401);
    expect((await post(fixture.bundle, key, { cookie: fixture.headers.cookie })).statusCode).toBe(403);
    expect((await fixture.app.inject({ method: "POST", url: route(), headers: fixture.headers, payload: fixture.bundle })).statusCode).toBe(428);
    expect((await post()).statusCode).toBe(409);
    expect((await fixture.app.inject({ url: listRoute(), headers: fixture.headers })).json()).toMatchObject({ canImport: false, availability: "SEALED_SOURCE_AUDIT_V4_REQUIRED", items: [] });
  });
  it("preserves actual native gaps and stores all authored OCR lines with UNRESOLVED empty page", async () => {
    await fixture.finish(); baseline = await domain();
    expect(fixture.results.sources[0].artifact.pages.map((page: { quality: { disposition: string } }) => page.quality.disposition))
      .toEqual(["TEXT_LAYER_CANDIDATE", "OCR_REQUIRED", "OCR_REQUIRED"]);
    const response = await post(); expect(response.statusCode, response.body).toBe(201); record = response.json();
    expect(response.headers["idempotency-replayed"]).toBe("false");
    expect(record).toMatchObject({ sourceFileId: fixture.files[0].id, bindings: { originalBytesVerified: true }, derived: {
      status: "IMPORTED_OCR_UNVERIFIED", p: null, factEligible: false, coverageDelta: 0, renderDerivationVerified: false, providerExecutionVerified: false } });
    expect(record.derived.pages.map(page => page.status)).toEqual(["TEXT_CANDIDATE", "UNRESOLVED"]);
    expect(record.derived.pages[0].lines.map(line => line.text)).toEqual(fixture.manualExpectation.textCandidates);
    expect(record.derived.pages[1].lines).toEqual([]);
    expect(record.derived.pages[0].rawResponseJson).toBe(fixture.bundle.pages[0].rawResponseJson);
    expect(record.derived.pages[0].rawResponseSha256).toBe(sha256(fixture.bundle.pages[0].rawResponseJson));
    const { contentHash, ...body } = record; expect(sha256(canonicalJson(body))).toBe(contentHash);
    expect(await domain()).toEqual(baseline);
  });
  it("replays immutable winner after reconnect and refuses changed key, foreign source, gaps and original tamper", async () => {
    const replay = await post(); expect(replay.statusCode, replay.body).toBe(201); expect(replay.json()).toEqual(record);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    const conflict = await post({ ...fixture.bundle, sourceSha256: "a".repeat(64) }); expect(conflict.statusCode).toBe(409);
    for (const payload of [{ ...fixture.bundle, sourceSha256: "a".repeat(64) }, { ...fixture.bundle, pages: fixture.bundle.pages.slice(0, 1) },
      { ...fixture.bundle, pages: [{ ...fixture.bundle.pages[0], pdfWidthMilliPoints: 1 }, fixture.bundle.pages[1]] }]) {
      const response = await post(payload, randomUUID()); expect([409, 422]).toContain(response.statusCode);
    }
    const foreign = await fixture.app.inject({ method: "POST", url: route().replace(fixture.files[0].id, fixture.files[2].id), headers: { ...fixture.headers, "idempotency-key": randomUUID() }, payload: fixture.bundle });
    expect(foreign.statusCode).toBe(409);
    const source = path.join(fixture.directory, "PD.pdf"), original = await readFile(source);
    try {
      await writeFile(source, Buffer.concat([original.subarray(0, original.length - 1), Buffer.from("X")]));
      expect((await post(fixture.bundle, randomUUID())).statusCode).toBe(503);
    } finally { await writeFile(source, original); }
    const cold = await PostgresInspectionRepository.create({ connectionString: fixture.connectionString, organizationSlug: fixture.organizationSlug,
      parameters: fixture.parameters, analysisProfile: "MATRIX_V1", storage: new LocalObjectStorage(fixture.directory) });
    try { expect(await cold.getSourceOcrImports(fixture.checkId, fixture.actor)).toMatchObject({ items: [record], reviews: [] }); } finally { await cold.close(); }
    expect(await domain()).toEqual(baseline);
  });
  it("requires review permission, exact line/hash and previous decision; records only human transcription", async () => {
    await fixture.db.query("UPDATE object_memberships SET permission_set=ARRAY['READ','RUN']::text[] WHERE user_id=$1", [fixture.actor.userId]);
    expect((await reviewPost()).statusCode).toBe(403);
    await fixture.db.query("UPDATE object_memberships SET permission_set=ARRAY['READ','RUN','REVIEW_DECIDE']::text[] WHERE user_id=$1", [fixture.actor.userId]);
    expect((await reviewPost({ ...input(), lineHash: "b".repeat(64) })).statusCode).toBe(409);
    expect((await reviewPost({ ...input(), pageNumber: 3 })).statusCode).toBe(409);
    for (const basis of ["abc\u0000", "abc\ud800"]) expect((await reviewPost({ ...input(), basis })).statusCode).toBe(400);
    const source = path.join(fixture.directory, "PD.pdf"), original = await readFile(source);
    try {
      await writeFile(source, Buffer.concat([original.subarray(0, original.length - 1), Buffer.from("X")]));
      expect((await reviewPost()).statusCode).toBe(503);
    } finally { await writeFile(source, original); }
    const reviewKey = randomUUID(), response = await reviewPost(input(), reviewKey); expect(response.statusCode, response.body).toBe(201); review = response.json();
    expect(review).toMatchObject({ humanTranscriptionOnly: true, p: null, factEligible: false, coverageDelta: 0, decision: "CONFIRMED" });
    const replay = await reviewPost(input(), reviewKey); expect(replay.json()).toEqual(review); expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect((await reviewPost()).statusCode).toBe(409);
    const changed = await reviewPost({ ...input(), expectedReviewHash: review.contentHash, decision: "REJECTED", basis: "Повторная сверка: нужна проверка символов" });
    expect(changed.statusCode, changed.body).toBe(201); expect(changed.json().expectedReviewHash).toBe(review.contentHash);
    const workspace = await fixture.app.inject({ url: listRoute(), headers: fixture.headers });
    expect(workspace.json().reviews).toHaveLength(2); expect(workspace.json().items).toEqual([record]);
    expect(await domain()).toEqual(baseline);
  });
  it("refuses a fresh import when RUN permission is revoked while the command waits for history", async () => {
    const runId = (await fixture.db.query("SELECT id FROM analysis_runs WHERE api_id=$1", [fixture.checkId])).rows[0].id;
    const lock = await fixture.db.connect();
    let pending: ReturnType<typeof post> | undefined;
    try {
      await lock.query("SELECT pg_advisory_lock(hashtext($1))", [`source-ocr-history:${runId}`]);
      pending = post(fixture.bundle, randomUUID());
      const deadline = Date.now() + 10000;
      let waiting = false;
      while (Date.now() < deadline) {
        waiting = (await fixture.db.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())) AS waiting")).rows[0].waiting;
        if (waiting) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting, "command must be waiting for the held history lock").toBe(true);
      await fixture.db.query("UPDATE object_memberships SET permission_set=ARRAY['READ','REVIEW_DECIDE']::text[] WHERE user_id=$1", [fixture.actor.userId]);
      await lock.query("SELECT pg_advisory_unlock(hashtext($1))", [`source-ocr-history:${runId}`]);
      const response = await pending;
      expect(response.statusCode, response.body).toBe(403);
      expect((await fixture.db.query("SELECT count(*)::int AS count FROM source_ocr_imports")).rows[0].count).toBe(1);
    } finally {
      await lock.query("SELECT pg_advisory_unlock_all()"); lock.release();
      await pending;
      await fixture.db.query("UPDATE object_memberships SET permission_set=ARRAY['READ','RUN','REVIEW_DECIDE']::text[] WHERE user_id=$1", [fixture.actor.userId]);
    }
    expect(await domain()).toEqual(baseline);
  });
  it("append-only SQL rejects identity substitution even with recomputed outer SHA, and read refuses inner corruption", async () => {
    for (const table of ["source_ocr_imports", "source_ocr_reviews"]) {
      await expect(fixture.db.query(`UPDATE ${table} SET content_hash=content_hash`)).rejects.toMatchObject({ code: "55000" });
      await expect(fixture.db.query(`DELETE FROM ${table}`)).rejects.toMatchObject({ code: "55000" });
    }
    const { contentHash: _hash, ...body } = record;
    const tampered = { ...body, id: randomUUID(), bindings: { ...body.bindings, sourceSha256: "c".repeat(64) } };
    const json = canonicalJson(tampered);
    await expect(fixture.db.query(`INSERT INTO source_ocr_imports SELECT $1,organization_id,object_id,run_id,source_file_id,policy_version,
      $2,$3,$4,($4::text)::jsonb,actor_user_id,created_at FROM source_ocr_imports WHERE id=$5`,
      [tampered.id, "d".repeat(64), sha256(json), json, record.id])).rejects.toMatchObject({ code: "23514" });
    await fixture.db.query("ALTER TABLE source_ocr_imports DISABLE TRIGGER source_ocr_imports_immutable");
    try {
      const changed = { ...body, derived: { ...body.derived, contentHash: "f".repeat(64) } }, text = canonicalJson(changed);
      await fixture.db.query("UPDATE source_ocr_imports SET content_text=$1,content_json=($1::text)::jsonb,content_hash=$2 WHERE id=$3", [text, sha256(text), record.id]);
      expect((await fixture.app.inject({ url: listRoute(), headers: fixture.headers })).statusCode).toBe(409);
    } finally {
      const text = canonicalJson(body); await fixture.db.query("UPDATE source_ocr_imports SET content_text=$1,content_json=($1::text)::jsonb,content_hash=$2 WHERE id=$3", [text, record.contentHash, record.id]);
      await fixture.db.query("ALTER TABLE source_ocr_imports ENABLE TRIGGER source_ocr_imports_immutable");
    }
  });
  it("rejects foreign/revoked users and keeps the sealed parent, releases, engineering results unchanged", async () => {
    const headers = { ...fixture.headers, cookie: `inspector_session=${fixture.foreignToken}; inspector_csrf=native-qa-csrf` };
    expect((await fixture.app.inject({ url: listRoute(), headers })).statusCode).toBe(404);
    await fixture.db.query("UPDATE object_memberships SET revoked_at=now() WHERE user_id=$1", [fixture.actor.userId]);
    expect((await fixture.app.inject({ url: listRoute(), headers: fixture.headers })).statusCode).toBe(404);
    expect((await post(fixture.bundle, randomUUID())).statusCode).toBe(404);
    expect((await reviewPost()).statusCode).toBe(404);
    await fixture.db.query("UPDATE object_memberships SET revoked_at=NULL WHERE user_id=$1", [fixture.actor.userId]);
    expect(await domain()).toEqual(baseline);
  });
});
