import { readFileSync } from "node:fs";
import { verifyZu127WindowTablePopplerV2 } from "./apps/api/src/zu127-window-table-poppler-v2.js";

const publicSource = {
  file_id: "F0152", split: "TRAIN_PUBLIC", distribution_status: "INCLUDE",
  label_visibility: "PUBLIC_TRAIN", object_id: "OBJ-TYUMENSKAYA-5-GOLD-SEED",
  sha256: "99ec972d7dfe5039fca922e3120bd5e486f2a26518f78044d0850992c028e7af",
  size_bytes: 6_359_136, pdf_pages: 77, stage: "PD", section: "OTHER",
};
async function main(): Promise<void> {
  const originalPdfBytes = readFileSync("/input/F0152.pdf");
  const result = JSON.parse(readFileSync("/tmp/zu127-worker-result.json", "utf8"));
  const accepted = await verifyZu127WindowTablePopplerV2({
    originalPdfBytes, publicSource, result,
  });
  if (!accepted || result.codeRows?.[0]?.status !== "ABSTAIN"
    || result.codeRows[0].typedFact !== null || result.findings !== null
    || result.findingCount !== null || result.parameterCoverage !== null
    || result.typedFacts !== null) {
    throw new Error("ZU-127 independent full-page API verification failed");
  }
  console.log(JSON.stringify({
    result: "PASS", profileId: result.profileId,
    sourceFileId: result.sourceFileId, sourceSha256: result.sourceSha256,
    popplerVersion: result.pageReceipts[0].providerId.split("@")[1],
    pageWordCounts: result.pageReceipts.map((page: {wordCount: number}) => page.wordCount),
    proposalCount: result.codeRows[0].proposalCount,
    status: result.codeRows[0].status, findingCount: result.findingCount,
    contentHash: result.contentHash,
  }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
