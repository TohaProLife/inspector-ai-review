import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { readCanonicalPdfPageFrame } from "../src/canonical-pdf-page-frame.js";
import { readLocalRegistrationPageFrame } from "../src/local-registration-page-frame.js";
import { sha256 } from "../src/canonical-json.js";
import { localRegistrationPdf } from "./local-registration-fixture.js";
const before = JSON.parse(readFileSync(new URL("../../../fixtures/document-coordinate-v1/legacy-four-frames.json", import.meta.url), "utf8"));
it.each([0, 90, 180, 270])("preserves exact old frame/hash at rotation %i while exposing generic geometry", async rotate => {
  const sourceBytes = localRegistrationPdf("generic-frame-preservation", rotate);
  const selected = { sourceBytes, expectedSourceSha256: sha256(sourceBytes), sourceFileId: "FIL-synthetic", pdfPageNumber: 1 };
  const old = before.find((frame: any) => frame.rotate === rotate);
  const generic = await readCanonicalPdfPageFrame(selected);
  const { objectKey, floorKey, phaseKey, revisionKey, ...geometry } = old;
  expect(generic).toEqual({ ...geometry, geometryPrecisionPt: 0.01 });
  expect(generic).not.toHaveProperty("floorKey"); expect(generic).not.toHaveProperty("phaseKey");
  expect(await readLocalRegistrationPageFrame({ ...selected, objectId: "OBJ-synthetic", floorKey: "1", phaseKey: "A" })).toEqual(old);
  await expect(readCanonicalPdfPageFrame({ ...selected, expectedSourceSha256: "f".repeat(64) })).rejects.toMatchObject({ code: "INVALID_SOURCE" });
});
