import { admitOcrSourcePreviewCache, parseDrainageSourcePreviewInput,
  type AdmittedOcrSourceCacheV1 } from "./drainage-source-preview.js";
import type { Ppm113SourceCandidatesV1, Ppm113SourceReferenceV1 } from "./ppm113-source-types.js";

// Whole admitted line only. Ring spelling is preserved; no Unicode normalization or pairing.
const literal = /^[ \t]*Кольцевой[ \t]+трубопровод[ \t]+ВПВ[ \t]+(?<ring>[\p{L}0-9][\p{L}0-9._-]{0,31})[ \t]*:[ \t]*внутренний[ \t]+диаметр[ \t]+(?<value>(?:0|[1-9][0-9]{0,11})(?:[.,][0-9]{1,6})?)[ \t]+(?<unit>мм|см|м)[ \t]*\.?[ \t]*$/iu;

/** Unsigned bounded decimal coefficient/scale. Measurements never pass through Number. */
function millimetres(value: string, unit: "мм" | "см" | "м"): string | null {
  const [integer, fraction = ""] = value.replace(",", ".").split(".");
  const coefficient = BigInt(integer! + fraction);
  if (coefficient === 0n) return null;
  const scale = fraction.length - ({ "мм": 0, "см": 1, "м": 3 } as const)[unit];
  if (scale <= 0) return (coefficient * 10n ** BigInt(-scale)).toString();
  const digits = coefficient.toString().padStart(scale + 1, "0");
  return (digits.slice(0, -scale) + "." + digits.slice(-scale)).replace(/0+$/u, "").replace(/\.$/u, "");
}
function classify(admitted: AdmittedOcrSourceCacheV1): Ppm113SourceCandidatesV1 {
  const { lines, binding: b } = admitted;
  const references: Ppm113SourceReferenceV1[] = [];
  let truncated = false;
  for (const [index, line] of lines.entries()) {
    const match = literal.exec(line.text), groups = match?.groups;
    if (!match || match[0].length !== line.text.length || !groups
      || !/\p{L}/u.test(groups.ring!) || !/[0-9]/u.test(groups.ring!)) continue;
    if (!["мм", "см", "м"].includes(groups.unit!)) continue;
    const rawUnit = groups.unit! as "мм" | "см" | "м";
    const internalDiameterMm = millimetres(groups.value!, rawUnit);
    if (internalDiameterMm === null) continue;
    if (references.length === 32) { truncated = true; break; }
    references.push({ status: "SOURCE_CANDIDATE", provenance: "OCR_CACHE_UNVERIFIED", probability: null,
      rawReferenceType: "NAMED_VPV_RING_INTERNAL_DIAMETER", ringId: groups.ring!, rawValue: groups.value!,
      rawUnit, internalDiameterMm, rawOcrText: line.text, matchedText: match[0],
      matchedSpanCodepoints: [0, Array.from(line.text).length], cacheSha256: b.cacheSha256,
      cacheJsonPointer: `/artifact/lines/${index}/text`, sourceFileId: b.sourceFileId,
      sourcePdfSha256: b.sourceSha256, declaredCachePage: b.declaredCachePage,
      declaredOcr: { providerProfileId: b.providerProfileId, script: b.script, score: line.score },
      declaredGeometry: { status: "DECLARED_UNVERIFIED", overlayPermitted: false,
        renderSha256: b.declaredRenderSha256, rendererProfileId: b.rendererProfileId, dpi: b.dpi,
        widthPx: b.declaredWidthPx, heightPx: b.declaredHeightPx, bboxPx: [...line.bboxPx] } });
  }
  return { schemaVersion: "ppm113-source-candidates-v1", policyVersion: "ppm113-named-ring-internal-diameter-literals-v1",
    parameterCode: "PPM-113", purpose: "SOURCE_REVIEW_ONLY", provenance: "OCR_CACHE_UNVERIFIED", probability: null,
    validatedLineCount: lines.length, referenceLimit: 32, references, truncated,
    reason: references.length ? null : "NO_EXACT_NAMED_RING_INTERNAL_DIAMETER_LITERAL", findings: null, parameterCoverage: null };
}
/** Strict cache admission completes before the first literal is considered. No drainage extraction. */
export function previewPpm113SourceCache(rawInput: unknown, trustedSourceSha256: string): Ppm113SourceCandidatesV1 {
  const input = parseDrainageSourcePreviewInput(rawInput);
  return classify(admitOcrSourcePreviewCache(input, trustedSourceSha256));
}
