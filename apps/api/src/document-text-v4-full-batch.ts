import type { DocumentTextV4FullAuditPageBatchRead, DocumentTextV4FullAuditSourceRead } from "@inspector-ai/contracts";
import { readDocumentTextV4FullArtifact } from "./document-text-v4.js";

/** Selection only after complete immutable origin authentication. Never an admitted partial artifact. */
export function documentTextV4FullPageBatch(source: DocumentTextV4FullAuditSourceRead, input: {
  startPage: number; pageLimit: number; expectedArtifactContentHash?: string;
}): DocumentTextV4FullAuditPageBatchRead | undefined {
  if (!Number.isSafeInteger(input.startPage) || input.startPage < 1
    || !Number.isSafeInteger(input.pageLimit) || input.pageLimit < 1 || input.pageLimit > 128
    || input.startPage > source.textArtifact.pageCount
    || (input.startPage !== 1 && input.expectedArtifactContentHash === undefined)
    || (input.expectedArtifactContentHash !== undefined && input.expectedArtifactContentHash !== source.textArtifactContentHash)) return undefined;
  const verified = readDocumentTextV4FullArtifact(source.textArtifact);
  if (verified.status !== "VALID" || verified.contentHash !== source.textArtifactContentHash) return undefined;
  const { textArtifact, ...origin } = source;
  const end = Math.min(textArtifact.pageCount, input.startPage - 1 + input.pageLimit);
  return { ...origin, schemaVersion: "document-text-v4-full-source-page-batch-v1",
    wholeArtifactPageCount: textArtifact.pageCount, startPage: input.startPage, pageLimit: input.pageLimit,
    nextPage: end < textArtifact.pageCount ? end + 1 : null,
    pages: textArtifact.pages.slice(input.startPage - 1, end) };
}
