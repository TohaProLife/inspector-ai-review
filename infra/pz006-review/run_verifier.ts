import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sha256 } from "./apps/api/src/canonical-json.js";
import { pythonHash, type TrustedPageWords } from "./apps/api/src/trusted-page-words.js";
import { verifyPz006BuildingLevelsAgainstOriginalPdf } from "./apps/api/src/pz006-building-levels-proposals.js";

const source = {
  file_id: "F0101", object_id: "OBJ-NOVOSLOBODSKAYA",
  split: "TRAIN_PUBLIC", distribution_status: "INCLUDE", label_visibility: "PUBLIC_TRAIN",
  stage: "PD", section: "OTHER", pdf_pages: 13, size_bytes: 891_618,
  sha256: "01db90e015c39a9502b99969ce04f27825265203bc8728da6141d7b6d2b1ef54",
};
type WorkerPacket = {
  result: { status: string; typedFact: unknown; findingCount: unknown;
    parameterCoverage: unknown; proposalCount: number; contentHash: string };
  page: Omit<TrustedPageWords, "providerId" | "sourceSha256" | "inspectionSha256">;
};

async function main(): Promise<void> {
  const originalPdfBytes = readFileSync("/input/F0101.pdf");
  assert.equal(originalPdfBytes.length, source.size_bytes);
  assert.equal(sha256(originalPdfBytes), source.sha256);
  const packet = JSON.parse(readFileSync("/tmp/pz006-worker-result.json", "utf8")) as WorkerPacket;
  // Review-only adapter: word order is worker supplied. Poppler must independently
  // prove all words and boxes; this adapter cannot authenticate PyMuPDF indices.
  const body = { providerId: "api-independent-pdf-words-v1" as const,
    sourceSha256: source.sha256, ...packet.page };
  const trustedPage: TrustedPageWords = { ...body, inspectionSha256: pythonHash(body) };
  const input = { originalPdfBytes, publicSource: source,
    trustedPage, result: packet.result };
  const verified = await verifyPz006BuildingLevelsAgainstOriginalPdf(input);
  assert.equal(verified.verified, true);
  assert.equal(verified.reason, "VERIFIED_REVIEW_ONLY");
  assert.equal(verified.wordBijection?.reason, "FULL_UNIQUE_WORD_BIJECTION_MATCH");
  assert.deepEqual([verified.wordBijection?.workerWordCount,
    verified.wordBijection?.independentWordCount], [322, 322]);
  assert.equal(packet.result.proposalCount, 7);
  assert.equal(packet.result.status, "ABSTAIN");
  assert.equal(packet.result.typedFact, null);
  assert.equal(packet.result.findingCount, null);
  assert.equal(packet.result.parameterCoverage, null);

  const wrongBytes = Buffer.from(originalPdfBytes);
  wrongBytes[0] ^= 1;
  const wrong = await verifyPz006BuildingLevelsAgainstOriginalPdf({
    ...input, originalPdfBytes: wrongBytes,
  });
  assert.equal(wrong.verified, false);
  assert.equal(wrong.reason, "INDEPENDENT_WORDS_UNAVAILABLE");
  const alteredWords = structuredClone(trustedPage.words);
  alteredWords[0].bboxMilliPointsTopLeft[0] += 101;
  const alteredBody = { ...body, words: alteredWords };
  const alteredPage: TrustedPageWords = { ...alteredBody,
    inspectionSha256: pythonHash(alteredBody) };
  const altered = await verifyPz006BuildingLevelsAgainstOriginalPdf({
    ...input, trustedPage: alteredPage,
  });
  assert.equal(altered.verified, false);
  assert.equal(altered.reason, "FULL_WORD_BIJECTION_FAILED");
  console.log(JSON.stringify({ result: "PASS", sourceFileId: source.file_id,
    sourceSha256: source.sha256, popplerVersion: "25.12.0",
    workerWordCount: verified.wordBijection?.workerWordCount,
    independentWordCount: verified.wordBijection?.independentWordCount,
    proposalCount: packet.result.proposalCount, status: packet.result.status,
    findingCount: packet.result.findingCount,
    contentHash: packet.result.contentHash, wrongInputRejected: true,
    alteredWordBoxRejected: true }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
