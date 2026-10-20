/** Display aid only. These fields never alter the imported line or its review. */
export type SourceOcrUnitHint = Readonly<{
  kind: "PAIRED_HEAT_UNITS_CONTRADICT";
  kilowattsLiteral: string;
  gigacaloriesPerHourLiteral: string;
  equivalentKilowatts: Readonly<{ lower: string; upper: string }>;
}>;

const MAX_LINE_LENGTH = 12_000;
// Only Cyrillic letters and their explicit case variants. No Latin lookalikes,
// inferred units, grouping separators, prefixes, suffixes or joined OCR lines.
const PAIR = /^[ \t\u00a0\u202f]*(\d{1,12}(?:[.,]\d{1,6})?)[ \t\u00a0\u202f]*[кК][вВ][тТ]\.?[ \t\u00a0\u202f]*\([ \t\u00a0\u202f]*(\d{1,12}(?:[.,]\d{1,6})?)[ \t\u00a0\u202f]*[гГ][кК][аА][лЛ][ \t\u00a0\u202f]*\/[ \t\u00a0\u202f]*[чЧ](?:[аА][сС])?[ \t\u00a0\u202f]*\)[ \t\u00a0\u202f]*$/u;
const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/u;
const SCALE = 10_000_000n;
// International Table calorie: 4.1868 J; 10^9 cal_IT / 3600 s = 1163 kW.
// NIST SP811, footnote9: https://www.nist.gov/pml/special-publication-811/nist-guide-si-footnotes
// Same conversion as the existing API/Python conservative OCR heat-row aid.
const KILOWATTS_PER_GIGACALORIE_PER_HOUR = 1163n;

type Interval = Readonly<{ lower: bigint; upper: bigint }>;

function writtenRoundingInterval(literal: string): Interval | undefined {
  const [whole, fraction = ""] = literal.replace(",", ".").split(".");
  const mantissa = BigInt(whole + fraction);
  if (mantissa <= 0n) return undefined;
  // Seven decimal places represent half of even the smallest admitted digit.
  const lastPlace = 10n ** BigInt(7 - fraction.length);
  const center = mantissa * lastPlace;
  const halfLastPlace = lastPlace / 2n;
  return { lower: center - halfLastPlace, upper: center + halfLastPlace };
}

function decimalString(scaled: bigint): string {
  const whole = scaled / SCALE;
  const fraction = (scaled % SCALE).toString().padStart(7, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/**
 * Recognize one complete literal line: positive кВт (Гкал/ч or Гкал/час).
 * One comma or dot is a decimal separator; grouped numbers are unsupported.
 * Return a hint only when closed written-rounding intervals are disjoint.
 * No hint means either overlap or abstention, never a claim of correctness.
 */
export function sourceOcrHeatUnitHint(text: string): SourceOcrUnitHint | undefined {
  if (typeof text !== "string" || text.length > MAX_LINE_LENGTH || LINE_BREAK.test(text)) return undefined;
  const match = PAIR.exec(text);
  if (!match) return undefined;
  const kilowatts = writtenRoundingInterval(match[1]);
  const gigacalories = writtenRoundingInterval(match[2]);
  if (!kilowatts || !gigacalories) return undefined;
  const lower = gigacalories.lower * KILOWATTS_PER_GIGACALORIE_PER_HOUR;
  const upper = gigacalories.upper * KILOWATTS_PER_GIGACALORIE_PER_HOUR;
  if (kilowatts.lower <= upper && lower <= kilowatts.upper) return undefined;
  return Object.freeze({
    kind: "PAIRED_HEAT_UNITS_CONTRADICT",
    kilowattsLiteral: match[1],
    gigacaloriesPerHourLiteral: match[2],
    equivalentKilowatts: Object.freeze({ lower: decimalString(lower), upper: decimalString(upper) }),
  });
}
