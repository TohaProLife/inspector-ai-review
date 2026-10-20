import { constants } from "node:fs";
import { open, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createPublicKey, verify } from "node:crypto";
import { join } from "node:path";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { computeGeometryRegistrationV1, verifyGeometryRegistrationV1, type TrustedGeometryRegistrationV1 } from "./geometry-registration-v1.js";
import { z } from "zod";

const label = z.string().trim().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const envelopeSchema = z.object({
  schemaVersion: z.literal("signed-geometry-control-source-v1"),
  keyId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  payload: z.object({ registrationId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    organizationId: label, objectId: label, sourceFileId: label, sourceSha256: hash,
    independentSource: z.object({ file: z.string().regex(/^[a-zA-Z0-9_-]{1,100}\.(?:json|pdf|csv)$/),
      sha256: hash, authority: label, reference: z.string().trim().min(8).max(1000),
      approvedBy: label, approvedAt: z.iso.datetime() }).strict(),
    packet: z.record(z.string(), z.unknown()),
  }).strict(),
}).strict();

/** Operator-owned read-only directory; no route accepts or writes trusted points. */
async function boundedFile(root: string, name: string, limit: number): Promise<Buffer> {
  const file = await open(join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > limit) throw new Error("trusted geometry file exceeds bounds");
    const bytes = await file.readFile();
    if (bytes.length !== metadata.size) throw new Error("trusted geometry file changed during read");
    return bytes;
  } finally { await file.close(); }
}
export async function loadTrustedGeometryRegistration(input: {
  directory: string; registrationId: string; organizationId: string; objectId: string;
  sourceFileId: string; sourceSha256: string; sourceBytes: Buffer;
}) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(input.registrationId)) throw new Error("invalid registration ID");
  const raw = await boundedFile(input.directory, `${input.registrationId}.json`, 256 * 1024);
  const envelope = envelopeSchema.parse(JSON.parse(raw.toString("utf8")));
  const { payload } = envelope;
  if (payload.registrationId !== input.registrationId || payload.organizationId !== input.organizationId
    || payload.objectId !== input.objectId || payload.sourceFileId !== input.sourceFileId
    || payload.sourceSha256 !== input.sourceSha256 || payload.independentSource.sha256 === input.sourceSha256)
    throw new Error("trusted geometry scope mismatch");
  const keyBytes = await boundedFile(input.directory, `${envelope.keyId}.pub.pem`, 16 * 1024);
  const key = createPublicKey(keyBytes);
  if (key.asymmetricKeyType !== "ed25519" || !verify(null, Buffer.from(canonicalJson(payload)), key, Buffer.from(envelope.signature, "base64")))
    throw new Error("trusted geometry signature mismatch");
  const independent = await boundedFile(input.directory, payload.independentSource.file, 64 * 1024 * 1024);
  if (sha256(independent) !== payload.independentSource.sha256) throw new Error("independent control source SHA mismatch");
  // v1 runtime supports canonical normalized frames. Raster registration remains
  // closed until independently pinned render bytes can be obtained for its profile.
  const frame = payload.packet.pageFrame as Record<string, unknown> | undefined;
  if (frame?.coordinateSpace !== "CANONICAL_VISIBLE_NORMALIZED") throw new Error("independent raster frame unavailable");
  const page = (payload.packet.source as Record<string, unknown> | undefined)?.pdfPageNumber;
  if (!Number.isSafeInteger(page) || Number(page) < 1 || Number(page) > 10000) throw new Error("invalid PDF page");
  const directory = await mkdtemp(join(tmpdir(), "inspector-geometry-"));
  try {
    const path = join(directory, "source.pdf");
    await writeFile(path, input.sourceBytes, { mode: 0o600 });
    const info = await promisify(execFile)("pdfinfo", ["-f", String(page), "-l", String(page), path],
      { timeout: 15000, maxBuffer: 128 * 1024, env: { ...process.env, LC_ALL: "C" } });
    const count = /^Pages:\s+(\d+)/m.exec(info.stdout);
    const rotation = new RegExp(`^Page\\s+${page}\\s+rot:\\s*(0|90|180|270)\\s*$`, "m").exec(info.stdout);
    if (!count || Number(page) > Number(count[1]) || !rotation || Number(rotation[1]) !== frame.rotate)
      throw new Error("PDF page/frame mismatch");
  } finally { await rm(directory, { recursive: true, force: true }); }
  const result = computeGeometryRegistrationV1(payload.packet);
  const { schemaVersion: _, ...trusted } = payload.packet;
  if (!result || !verifyGeometryRegistrationV1({ packet: payload.packet, result,
    sourceBytes: input.sourceBytes, expectedSourceSha256: input.sourceSha256,
    trusted: trusted as unknown as TrustedGeometryRegistrationV1 })) throw new Error("trusted geometry numerical verification failed");
  return { schemaVersion: "trusted-geometry-registration-read-v1", status: "REVIEW_ONLY",
    registrationId: input.registrationId, signedPackageSha256: sha256(raw),
    independentSource: payload.independentSource, sourceSha256: input.sourceSha256,
    result, findings: [], coverage: null };
}
