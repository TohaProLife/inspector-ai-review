import { expect, it } from "vitest";
import { sha256 } from "../src/canonical-json.js";
import { readLocalRegistrationPageFrame } from "../src/local-registration-page-frame.js";
import { localRegistrationPdf } from "./local-registration-fixture.js";

it("derives crop/rotation from original bytes, binds their SHA and keeps floor/phase explicit", async () => {
  const sourceBytes = localRegistrationPdf("rotated", 90);
  const input = { sourceBytes, expectedSourceSha256: sha256(sourceBytes), sourceFileId: "FIL-synthetic", objectId: "OBJ-synthetic",
    pdfPageNumber: 1, floorKey: "floor-declared-1", phaseKey: "phase-declared-A" };
  const frame = await readLocalRegistrationPageFrame(input);
  expect(frame).toMatchObject({ visibleWidthPt: 140, visibleHeightPt: 160, rotate: 90,
    floorKey: input.floorKey, phaseKey: input.phaseKey, sourceSha256: input.expectedSourceSha256,
    revisionKey: `sha256:${input.expectedSourceSha256}`, coordinateSpace: "CANONICAL_VISIBLE_NORMALIZED" });
  expect(frame.pageFrameSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(await readLocalRegistrationPageFrame(input)).toEqual(frame);
  const changedBytes = localRegistrationPdf("another-original", 90);
  expect((await readLocalRegistrationPageFrame({ ...input, sourceBytes: changedBytes,
    expectedSourceSha256: sha256(changedBytes) })).pageFrameSha256).not.toBe(frame.pageFrameSha256);
  await expect(readLocalRegistrationPageFrame({ ...input, sourceBytes: changedBytes })).rejects.toMatchObject({ code: "INVALID_SOURCE" });
  await expect(readLocalRegistrationPageFrame({ ...input, pdfPageNumber: 2 })).rejects.toMatchObject({ status: 422 });
  await expect(readLocalRegistrationPageFrame({ ...input, floorKey: " " })).rejects.toMatchObject({ code: "INVALID_SOURCE" });
});
