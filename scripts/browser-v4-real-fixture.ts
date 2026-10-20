/** Read-only fixture for browser acceptance of the real F0201 V4 artifact.
 * This constructs a scoped in-memory source origin; it proves no database seal,
 * lease, approval, engineering finding or GPU/provider execution.
 *
 * Import from a Node/tsx harness:
 *   const fixture = await createBrowserV4RealFixture({
 *     artifactPath: "output/local-work-20261020/full-source-v14-v1/F0201-document-text-v4.json",
 *     files, objectId: "OBJ-PAIR-QA", checkId: "CHK-V4-REAL-QA", actor,
 *   });
 *   // Repository override: getDocumentTextV4FullSource: fixture.readSource
 *   // Serve the production API route, which calls documentTextV4FullPageBatch.
 *
 * Standalone receipt (input JSON supplies files/objectId/checkId/actor):
 *   node --import tsx scripts/browser-v4-real-fixture.ts --artifact PATH --input INPUT.json --output RECEIPT.json
 * The receipt excludes actor/session credentials and the large source artifact.
 */
import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CheckRun, DocumentTextV4FullAuditSourceRead, SourceFileSummary } from "@inspector-ai/contracts";
import type { AuthenticatedActor } from "../apps/api/src/identity.js";
import type { ScopedReadResult } from "../apps/api/src/repository.js";
import { canonicalJson, sha256 } from "../apps/api/src/canonical-json.js";
import { readDocumentTextV4FullArtifact } from "../apps/api/src/document-text-v4.js";

export const REAL_F0201_V4 = Object.freeze({
  sourceFileId: "F0201", pages: 676, sourceBytes: 43033348,
  sourceSha256: "0c398d7bca356455568413a6fc3b14044b7e538a902251b80e2a5574d80184fd",
  artifactBytes: 10773329,
  artifactByteSha256: "64d86a69aeafcd5c8f27ffbd2ad44060d165b68b387318905392027fbb548aa9",
  artifactContentHash: "9b85b768ebe2ac23134416e914bc2caac6a1c0ec0e9a7e14ffa9f20769c61d83",
});
export interface BrowserV4RealFixtureInput {
  artifactPath: string;
  files: SourceFileSummary[];
  objectId: string;
  checkId: string;
  actor: AuthenticatedActor;
}
const id = /^[A-Za-z0-9_-]{1,200}$(?![\s\S])/u;
const hash = /^[a-f0-9]{64}$(?![\s\S])/u;
const fold = (value: string) => value.replace(/\s+/gu, " ").trim().toLocaleLowerCase("ru-RU");
function canonicalArtifact(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalArtifact).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalArtifact((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export async function createBrowserV4RealFixture(input: BrowserV4RealFixtureInput) {
  if (!id.test(input.objectId) || !id.test(input.checkId)
    || !input.actor || ![input.actor.sessionId, input.actor.userId, input.actor.organizationId].every(value => typeof value === "string" && value.length > 0)
    || !Array.isArray(input.files) || input.files.length < 1 || input.files.length > 64) throw Error("Invalid scoped browser fixture identity");
  const files = structuredClone(input.files), seen = new Set<string>();
  for (const file of files) {
    if (!id.test(file.id) || !hash.test(file.sha256) || seen.has(file.id) || file.review !== null
      || !Array.isArray(file.stages) || file.stages.length < 1 || file.stages.length > 3
      || file.stages.some(stage => !["PD", "RD", "ID"].includes(stage)) || new Set(file.stages).size !== file.stages.length)
      throw Error("Fixture requires unique sources and no authenticated source reviews");
    seen.add(file.id);
  }
  const file = files.find(value => value.id === REAL_F0201_V4.sourceFileId);
  if (!file || file.sha256 !== REAL_F0201_V4.sourceSha256 || file.pageCount !== REAL_F0201_V4.pages
    || file.size !== REAL_F0201_V4.sourceBytes || !file.stages.includes("RD") || !file.stages.includes("ID"))
    throw Error("F0201 original source identity differs from the verified real source");
  if ((await stat(input.artifactPath)).size !== REAL_F0201_V4.artifactBytes) throw Error("F0201 canonical artifact byte size changed");
  const bytes = await readFile(input.artifactPath);
  if (sha256(bytes) !== REAL_F0201_V4.artifactByteSha256) throw Error("F0201 canonical artifact byte SHA changed");
  const artifact = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as DocumentTextV4FullAuditSourceRead["textArtifact"];
  const verified = readDocumentTextV4FullArtifact(artifact);
  if (verified.status !== "VALID" || verified.contentHash !== REAL_F0201_V4.artifactContentHash
    || artifact.sourceFileId !== file.id || artifact.inputSha256 !== file.sha256 || artifact.pageCount !== REAL_F0201_V4.pages
    || !bytes.equals(Buffer.from(canonicalArtifact(artifact), "utf8"))) throw Error("F0201 full canonical artifact validation failed");

  // A fixture manifest with real source declarations; no claim that this was stored or sealed in PostgreSQL.
  const manifest = { inspectionId: `browser-fixture-${input.checkId}`, sources: files.map(value => ({
    sourceFileId: value.id, sha256: value.sha256, stages: [...value.stages].sort(), sourceReviewHash: null,
  })).sort((a, b) => a.sourceFileId < b.sourceFileId ? -1 : a.sourceFileId > b.sourceFileId ? 1 : 0) };
  const sourceRead: DocumentTextV4FullAuditSourceRead = {
    schemaVersion: "document-text-v4-full-source-read-v1", purpose: "SOURCE_AUDIT_ONLY",
    sourceAuditProfileVersion: "SOURCE_AUDIT_V4_FULL_SOURCE_V1", resourcePolicyVersion: "document-text-v4-full-source-bounds-v1",
    checkId: input.checkId, sourceFileId: file.id, sourceSha256: file.sha256, inputManifestHash: sha256(canonicalJson(manifest)),
    textStageContentHash: REAL_F0201_V4.artifactByteSha256, textArtifactByteSha256: REAL_F0201_V4.artifactByteSha256,
    textArtifactContentHash: verified.contentHash, extractorProfileHash: artifact.extractorProfileHash,
    stage: "UNRESOLVED", pageStages: {}, latestReviewHash: null, authorityStatus: "SOURCE_DECLARED_UNVERIFIED",
    renderedVisibility: "UNVERIFIED", calibratedProbability: null, textArtifact: artifact,
  };
  const timestamp = new Date().toISOString();
  const check: CheckRun = {
    id: input.checkId, objectId: input.objectId, status: "PARTIAL", progress: 100, currentStage: "SOURCE_AUDIT_ONLY",
    startedAt: timestamp, completedAt: timestamp, mode: "NORMAL", modelVersion: null, rulesVersion: "browser-source-audit-only-v4-fixture",
    purpose: "SOURCE_AUDIT_ONLY", sourceAuditProfileVersion: "SOURCE_AUDIT_V4_FULL_SOURCE_V1",
    stats: { total: 0, unsupported: 0, candidates: 0, confirmed: 0, negativeVerified: 0, notComparable: 0, clarification: 0, suspicion: 0 },
  };
  const allRows = artifact.pages.flatMap(page => [...page.locatedLines, ...page.unlocatedLines].map(row => fold(row.rawText)));
  let selected: { pageNumber: number; rawText: string; sourcePath: number[]; bboxMilliPoints: [number, number, number, number] } | undefined;
  for (const page of artifact.pages.slice(-32).toReversed()) {
    for (const row of page.locatedLines) {
      const query = row.rawText.trim(), needle = fold(query);
      if ([...query].length < 20 || [...query].length > 200 || !/[\p{L}]/u.test(query)) continue;
      if (allRows.reduce((count, text) => count + Number(text.includes(needle)), 0) !== 1) continue;
      selected = { pageNumber: page.pageNumber, rawText: row.rawText, sourcePath: [...row.sourcePath], bboxMilliPoints: [...row.bboxMilliPoints] };
      break;
    }
    if (selected) break;
  }
  if (!selected || selected.pageNumber <= 512) throw Error("No globally unique located late-page query");
  const scope = { sessionId: input.actor.sessionId, userId: input.actor.userId, organizationId: input.actor.organizationId };
  function readSource(checkId: string, sourceFileId: string, actor?: AuthenticatedActor): ScopedReadResult<DocumentTextV4FullAuditSourceRead> {
    if (!actor) return "AUTH_REQUIRED";
    return actor.sessionId === scope.sessionId && actor.userId === scope.userId && actor.organizationId === scope.organizationId
      && checkId === check.id && sourceFileId === sourceRead.sourceFileId ? sourceRead : undefined;
  }
  return { check, sourceRead, lateQuery: selected.rawText.trim(), latePage: selected.pageNumber, lateLine: selected, manifest, readSource };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== "--artifact" || args[2] !== "--input" || args[4] !== "--output")
    throw Error("Usage: node --import tsx scripts/browser-v4-real-fixture.ts --artifact PATH --input INPUT.json --output RECEIPT.json");
  const input = JSON.parse(await readFile(args[3], "utf8")) as Omit<BrowserV4RealFixtureInput, "artifactPath">;
  const fixture = await createBrowserV4RealFixture({ ...input, artifactPath: args[1] });
  const { textArtifact: _artifact, ...origin } = fixture.sourceRead;
  await writeFile(args[5], JSON.stringify({ boundary: "scoped in-memory browser fixture; no database seal or execution claim",
    check: fixture.check, sourceReadOrigin: origin, manifest: fixture.manifest, lateQuery: fixture.lateQuery,
    latePage: fixture.latePage, lateLine: fixture.lateLine }, null, 2) + "\n", { flag: "wx" });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(error => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
}
