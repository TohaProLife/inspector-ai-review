import { expect, it } from "vitest";
import type { SourceFileSummary } from "@inspector-ai/contracts";
import { realParameterPairs } from "./real-parameter-pairs";
import { validEvidenceBox } from "./document-pair-navigation";
const files = [
  {id:"uploaded-pd",sha256:"a9070055b75adeea0d47651cf9dca3ca818ca5f54ac7ce9ddcd86efc817db7dc",pageCount:177},
  {id:"uploaded-rd",sha256:"0c398d7bca356455568413a6fc3b14044b7e538a902251b80e2a5574d80184fd",pageCount:676},
] as SourceFileSummary[];
it("shows only complete original-bound source citations, including rotated OCR and both RD fan pages", () => {
  const pairs = realParameterPairs(files);
  expect(pairs.map(pair => pair.parameterCode)).toEqual(["PZ-013","IOS4-079"]);
  expect(pairs[0].citations.map(citation => [citation.page,citation.kind])).toEqual([[1,"NATIVE"],[5,"OCR"],[7,"OCR"]]);
  expect(pairs[1].sources.map(source => [source.pageNumber,source.value])).toEqual([[156,"9060"],[272,"3340"],[279,"5720"]]);
  expect(pairs.flatMap(pair => pair.sources).every(source => validEvidenceBox(source.bbox))).toBe(true);
  expect(pairs[0].sources[1].bbox![1]).toBeCloseTo(1 - 598900 / 842400,14);
  expect(pairs.flatMap(pair => pair.sources).every(source => source.sourceFileId.startsWith("uploaded-"))).toBe(true);
});
it("refuses wrong bytes, ambiguous uploads and missing physical pages", () => {
  expect(realParameterPairs([{...files[0],sha256:"f".repeat(64)},files[1]])).toEqual([]);
  expect(realParameterPairs([...files,{...files[1],id:"duplicate"}])).toEqual([]);
  expect(realParameterPairs([files[0],{...files[1],pageCount:null}])).toEqual([]);
  expect(realParameterPairs([files[0],{...files[1],pageCount:6}])).toEqual([]);
});
