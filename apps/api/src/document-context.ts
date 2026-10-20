const patterns: Record<string, RegExp> = {
  HEATING: /(?:^|[^\p{L}])отоплени[еяию](?=$|[^\p{L}])/iu,
  VENTILATION: /(?:^|[^\p{L}])вентиляци[яиюе](?=$|[^\p{L}])/iu,
  WATER_SUPPLY: /(?:^|[^\p{L}])водоснабжени[еяию](?=$|[^\p{L}])/iu,
  DRAINAGE: /(?:^|[^\p{L}])(?:водоотведени[еяию]|канализаци[яиюе])(?=$|[^\p{L}])/iu,
  ELECTRICAL: /(?:^|[^\p{L}])(?:электроснабжени[еяию]|электроосвещени[еяию])(?=$|[^\p{L}])/iu,
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function validDocumentContextV2(value: unknown, pageCount: number): boolean {
  if (!record(value) || value.schemaVersion !== "document-context-v2"
    || value.methodId !== "metadata-outline-page-signals-v2" || !Array.isArray(value.inspectedPages)
    || value.inspectedPages.length !== pageCount || !Array.isArray(value.signals)
    || !Array.isArray(value.domains)) return false;
  let unreadable = 0;
  for (const [index, page] of value.inspectedPages.entries()) {
    if (!record(page) || page.pageNumber !== index + 1 || !hash(page.textSha256)
      || typeof page.textAvailable !== "boolean") return false;
    if (!page.textAvailable) unreadable++;
  }
  const domains = new Set<string>();
  for (const signal of value.signals) {
    if (!record(signal) || !["METADATA", "OUTLINE", "PAGE_TEXT"].includes(String(signal.kind))
      || typeof signal.domain !== "string" || !patterns[signal.domain]
      || typeof signal.snippet !== "string" || signal.snippet.length > 400
      || !patterns[signal.domain].test(signal.snippet) || !hash(signal.textSha256)
      || !(signal.pageNumber === null || (Number.isSafeInteger(signal.pageNumber)
        && Number(signal.pageNumber) >= 1 && Number(signal.pageNumber) <= pageCount))) return false;
    if (signal.kind === "PAGE_TEXT" && (signal.pageNumber === null
      || (value.inspectedPages[Number(signal.pageNumber) - 1] as Record<string, unknown>).textSha256 !== signal.textSha256)) return false;
    domains.add(signal.domain);
  }
  const sorted = [...domains].sort();
  return JSON.stringify(value.domains) === JSON.stringify(sorted)
    && value.status === (sorted.length > 1 ? "MIXED" : sorted[0] ?? "UNKNOWN")
    && value.ambiguity === (sorted.length > 1)
    && value.reasonCode === (sorted.length > 1 ? "MULTIPLE_SYSTEMS" : sorted.length ? "TOPIC_SIGNALS" : "NO_TOPIC_SIGNALS")
    && value.unreadablePageCount === unreadable;
}
