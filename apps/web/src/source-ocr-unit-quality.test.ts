import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sourceOcrHeatUnitHint } from "./source-ocr-unit-quality";

// Hand-authored expectations before implementation. The four real literal
// pairs are source quotations, not engineering labels or corrected OCR.
const ventilationHint = {
  kind: "PAIRED_HEAT_UNITS_CONTRADICT",
  kilowattsLiteral: "107,687",
  gigacaloriesPerHourLiteral: "0,926",
  equivalentKilowatts: { lower: "1076.3565", upper: "1077.5195" },
} as const;

describe("literal OCR heat-unit quality", () => {
  it("flags the real ventilation pair without correcting either literal", () => {
    expect(sourceOcrHeatUnitHint("107,687 кВт (0,926 Гкал/час)")).toEqual(ventilationHint);
  });

  it.each([
    "389,893 кВт (0,335 ГКАл/час)",
    "722,64 кВт.(0,621 Гкал/час)",
    "225,11 кВт. (0,194 ГкАл/час)",
  ])("does not flag a real pair compatible with written rounding: %s", text => {
    expect(sourceOcrHeatUnitHint(text)).toBeUndefined();
  });

  it.each(["581 кВт (1 Гкал/ч)", "1745 кВт (1 Гкал/ч)"])(
    "accepts inclusive interval contact: %s", text => {
      expect(sourceOcrHeatUnitHint(text)).toBeUndefined();
    },
  );

  it.each(["580 кВт (1 Гкал/ч)", "1746 кВт (1 Гкал/ч)"])(
    "flags intervals strictly beyond either contact boundary: %s", text => {
      expect(sourceOcrHeatUnitHint(text)?.equivalentKilowatts).toEqual({ lower: "581.5", upper: "1744.5" });
    },
  );

  it("preserves decimal spelling and explicitly supported Cyrillic case variants", () => {
    expect(sourceOcrHeatUnitHint("\t000107.687\u00a0КВТ.\u202f(00.926 ГКАЛ/ЧАС) ")).toEqual({
      ...ventilationHint, kilowattsLiteral: "000107.687", gigacaloriesPerHourLiteral: "00.926",
    });
  });

  it("keeps the maximum supported decimal precision exact above Number's integer range", () => {
    expect(sourceOcrHeatUnitHint("1 кВт (999999999999.999999 Гкал/ч)")).toEqual({
      kind: "PAIRED_HEAT_UNITS_CONTRADICT", kilowattsLiteral: "1",
      gigacaloriesPerHourLiteral: "999999999999.999999",
      equivalentKilowatts: { lower: "1162999999999999.9982555", upper: "1162999999999999.9994185" },
    });
    expect(sourceOcrHeatUnitHint("999999999999.999999 кВт (0.000001 Гкал/ч)")?.equivalentKilowatts)
      .toEqual({ lower: "0.0005815", upper: "0.0017445" });
  });

  it("accepts a 12000-character line and abstains immediately above the limit", () => {
    const core = "107,687 кВт (0,926 Гкал/час)";
    const line = " ".repeat(12000 - core.length) + core;
    expect(sourceOcrHeatUnitHint(line)).toEqual(ventilationHint);
    expect(sourceOcrHeatUnitHint(" " + line)).toBeUndefined();
  });

  it.each([
    "", "Расход: 107,687 кВт (0,926 Гкал/час)",
    "107,687 кВт (0,926 Гкал/час) — расчет", "107,687 кВт (0,926 Гкал/час) 2",
    "107,687 кВт (0,926 Гкал/час); 1 кВт (1 Гкал/ч)",
    "107,687 кВт (0,926 Гкал/час) (0,0926 Гкал/час)",
    "107,687 кВт (0,926 Гкал/час) = 1 МВт",
    "1 107,687 кВт (0,926 Гкал/час)", "1\u00a0107,687 кВт (0,926 Гкал/час)",
    "1,107.687 кВт (0,926 Гкал/час)", "1.107,687 кВт (0,926 Гкал/час)",
    "1'107 кВт (0,926 Гкал/час)", "107,,687 кВт (0,926 Гкал/час)",
    "+107,687 кВт (0,926 Гкал/час)", "-107,687 кВт (0,926 Гкал/час)",
    "107,687 кВт (+0,926 Гкал/час)", "107,687 кВт (-0,926 Гкал/час)",
    "1e3 кВт (0,926 Гкал/час)", "107,687 кВт (9.26e-1 Гкал/час)",
    "NaN кВт (0,926 Гкал/час)", "Infinity кВт (0,926 Гкал/час)",
    "0 кВт (0,926 Гкал/час)", "107,687 кВт (0,000000 Гкал/час)",
    "100–107 кВт (0,926 Гкал/час)", "100-107 кВт (0,926 Гкал/час)",
    "≈107,687 кВт (0,926 Гкал/час)", "107,687±1 кВт (0,926 Гкал/час)",
    "107,687 кВт·ч (0,926 Гкал/час)", "107,687 кВт/ч (0,926 Гкал/час)",
    "107,687 kW (0,926 Гкал/час)", "107,687 кWт (0,926 Гкал/час)",
    "107,687 кBт (0,926 Гкал/час)", "107,687 кВт (0,926 Gcal/h)",
    "107,687 кВт (0,926 Гкaл/час)", "107,687 кВт (0,926 Мкал/час)",
    "107,687 кВт (0,926 Гкал/сут)", "107,687 кВт (0,926 Гкал/мин)",
    "107,687 кВт (0,926 Гкал)", "107,687 (0,926 Гкал/час)",
    "107,687 кВт 0,926 Гкал/час", "0,926 Гкал/час (107,687 кВт)",
    "1000000000000 кВт (0,926 Гкал/час)", "107,687 кВт (1000000000000 Гкал/час)",
    "107.6870001 кВт (0,926 Гкал/час)", "107,687 кВт (0.9260001 Гкал/час)",
    ".687 кВт (0,926 Гкал/час)", "107. кВт (0,926 Гкал/час)",
    "１０７ кВт (0,926 Гкал/час)", "107,687 кВт (０.９２６ Гкал/час)",
    "107,687 кВт\n(0,926 Гкал/час)", "107,687 кВт (0,926 Гкал/час)\n",
    "\r107,687 кВт (0,926 Гкал/час)", "107,687 кВт\r\n(0,926 Гкал/час)",
    "107,687 кВт\u2028(0,926 Гкал/час)", "107,687 кВт\u2029(0,926 Гкал/час)",
    "107,687 кВт\v(0,926 Гкал/час)", "107,687 кВт\f(0,926 Гкал/час)",
    "107,687 кВт\u0085(0,926 Гкал/час)", "107,687 кВт\u0000(0,926 Гкал/час)",
  ])("abstains from unsupported or ambiguous text: %j", text => {
    expect(sourceOcrHeatUnitHint(text)).toBeUndefined();
  });

  it("returns only frozen mathematical fields, without persistence or engineering semantics", () => {
    const hint = sourceOcrHeatUnitHint("107,687 кВт (0,926 Гкал/час)");
    expect(hint).toEqual(ventilationHint);
    expect(Object.keys(hint!)).toEqual([
      "kind", "kilowattsLiteral", "gigacaloriesPerHourLiteral", "equivalentKilowatts",
    ]);
    expect(Object.isFrozen(hint)).toBe(true);
    expect(Object.isFrozen(hint!.equivalentKilowatts)).toBe(true);
    expect(sourceOcrHeatUnitHint("107,687 кВт (0,926 Гкал/час)")).toEqual(hint);
  });
});

const derivedPath = process.env.INSPECTOR_SOURCE_OCR_UNIT_QUALITY_DERIVED;
it.skipIf(!derivedPath)("opt-in: exact real F0201 derived bytes yield only page8/ordinal13, with no mutation", () => {
  const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const before = readFileSync(derivedPath!);
  expect(sha(before)).toBe("dfef3dfa207f51b6357c62ecf779355639a5dd470e7576f09f980be50672829d");
  const derived = JSON.parse(before.toString("utf8")) as {
    schemaVersion: string; sourceSha256: string; contentHash: string;
    pages: Array<{ pageNumber: number; lines: Array<{ ordinal: number; text: string; lineHash: string }> }>;
  };
  const snapshot = JSON.stringify(derived);
  expect(derived.schemaVersion).toBe("source-ocr-import-derived-v1");
  expect(derived.sourceSha256).toBe("0c398d7bca356455568413a6fc3b14044b7e538a902251b80e2a5574d80184fd");
  expect(derived.contentHash).toBe("e15523a90126dbeead4d2a37f25e932255fc838c02c13e60f454a273aebdd925");
  expect(derived.pages).toHaveLength(12);
  expect(derived.pages.reduce((count, page) => count + page.lines.length, 0)).toBe(264);
  const hints = derived.pages.flatMap(page => page.lines.flatMap(line => {
    const hint = sourceOcrHeatUnitHint(line.text);
    return hint ? [{ pageNumber: page.pageNumber, ordinal: line.ordinal, text: line.text, lineHash: line.lineHash, hint }] : [];
  }));
  expect(hints).toEqual([{
    pageNumber: 8, ordinal: 13, text: "107,687 кВт (0,926 Гкал/час)",
    lineHash: "f3aa8492dc7fb20308d777e267abba5ac5dec8ba49fa00ce193b63c1c3b9433d", hint: ventilationHint,
  }]);
  expect(JSON.stringify(derived)).toBe(snapshot);
  expect(readFileSync(derivedPath!).equals(before)).toBe(true);
});
