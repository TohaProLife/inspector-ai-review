import type { InspectorEvidence, SourceFileSummary } from "@inspector-ai/contracts";

export type DocumentEvidence = Omit<InspectorEvidence, "stage"> & { stage: "PD" | "RD" | "ID" | "UNRESOLVED" };
export type NormalizedBox = [number, number, number, number];

/** Never display a saved frame on a different revision of the same named file. */
export function evidenceMatchesFile(evidence: DocumentEvidence, file?: SourceFileSummary): boolean {
  return /^[a-f0-9]{64}$/u.test(evidence.sourceSha256)
    && Number.isSafeInteger(evidence.pageNumber) && evidence.pageNumber >= 1 && evidence.pageNumber <= 10000
    && (!file || file.id === evidence.sourceFileId && file.sha256 === evidence.sourceSha256
      && (file.pageCount === null || evidence.pageNumber <= file.pageCount));
}
export function validEvidenceBox(box: unknown): box is NormalizedBox {
  return Array.isArray(box) && box.length === 4 && box.every(value => typeof value === "number" && Number.isFinite(value))
    && 0 <= box[0] && box[0] < box[2] && box[2] <= 1 && 0 <= box[1] && box[1] < box[3] && box[3] <= 1;
}
/** Commit a page draft on Enter/Go; typing 676 must not fetch pages 6 and 67. */
export function parseDocumentPage(draft: string, pageCount: number | null): number | null {
  if (!/^[1-9][0-9]{0,4}$/u.test(draft)) return null;
  const page = Number(draft);
  return page <= (pageCount ?? 10000) ? page : null;
}
export interface ComparisonTextPart { text: string; different: boolean }
/** Whitespace-preserving literal token comparison; no engineering inference. */
export function comparisonTextParts(value: string, other?: string): ComparisonTextPart[] {
  if (!value) return [];
  if (other === undefined || value === other) return [{ text: value, different: false }];
  const parts = value.match(/\s+|[,;|/]+|[^\s,;|/]+/gu) ?? [];
  const delimiter = (text: string) => /^[\s,;|/]+$/u.test(text);
  const words = parts.filter(text => !delimiter(text)).map(text => text.toLocaleLowerCase("ru-RU"));
  const opposite = (other.match(/[^\s,;|/]+/gu) ?? []).map(text => text.toLocaleLowerCase("ru-RU"));
  const matched = new Set<number>();
  // Bound memory for arbitrary source quotes. Normal excerpts use ordered LCS;
  // unusually long quotes still account for repeated words with a multiset.
  if (words.length <= 4096 && opposite.length <= 4096 && (words.length + 1) * (opposite.length + 1) <= 250000) {
    const rows = Array.from({ length: words.length + 1 }, () => new Uint16Array(opposite.length + 1));
    for (let i = words.length - 1; i >= 0; i--) for (let j = opposite.length - 1; j >= 0; j--) {
      rows[i][j] = words[i] === opposite[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
    for (let i = 0, j = 0; i < words.length && j < opposite.length;) {
      if (words[i] === opposite[j]) { matched.add(i); i++; j++; }
      else if (rows[i + 1][j] >= rows[i][j + 1]) i++;
      else j++;
    }
  } else {
    const remaining = new Map<string, number>();
    for (const word of opposite) remaining.set(word, (remaining.get(word) ?? 0) + 1);
    words.forEach((word, index) => { const count = remaining.get(word) ?? 0;
      if (count > 0) { matched.add(index); remaining.set(word, count - 1); } });
  }
  let wordIndex = 0;
  return parts.map(text => ({ text, different: !delimiter(text) && !matched.has(wordIndex++) }));
}
