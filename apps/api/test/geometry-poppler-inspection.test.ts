import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { sha256 } from "../src/canonical-json.js";
import { inspectGeometryPageWithPoppler,
  inspectGeometryPageWithVerifiedPopplerRender,
  parsePopplerPageInspection } from "../src/geometry-poppler-inspection.js";

// Four-page PDF generated once by worker's PyMuPDF synthetic fixture.
// Worker `_source_page` returned MediaBox [0,0,200,100], raw CropBox
// [20,20,180,90], and rotations 0/90/180/270 respectively. Poppler is
// run independently against these original bytes in each positive test.
const workerPdfBase64 = "JVBERi0xLjcKJcK1wrYKJSBXcml0dGVuIGJ5IE11UERGIDEuMjcuMgoKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFIvSW5mbzw8L1Byb2R1Y2VyKE11UERGIDEuMjcuMik+Pj4+CmVuZG9iagoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0NvdW50IDQvS2lkc1s0IDAgUiA2IDAgUiA4IDAgUiAxMCAwIFJdPj4KZW5kb2JqCgozIDAgb2JqCjw8Pj4KZW5kb2JqCgo0IDAgb2JqCjw8L1R5cGUvUGFnZS9NZWRpYUJveFswIDAgMjAwIDEwMF0vUm90YXRlIDAvUmVzb3VyY2VzIDMgMCBSL1BhcmVudCAyIDAgUi9Dcm9wQm94WzIwIDIwIDE4MCA5MF0+PgplbmRvYmoKCjUgMCBvYmoKPDw+PgplbmRvYmoKCjYgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCAyMDAgMTAwXS9Sb3RhdGUgOTAvUmVzb3VyY2VzIDUgMCBSL1BhcmVudCAyIDAgUi9Dcm9wQm94WzIwIDIwIDE4MCA5MF0+PgplbmRvYmoKCjcgMCBvYmoKPDw+PgplbmRvYmoKCjggMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCAyMDAgMTAwXS9Sb3RhdGUgMTgwL1Jlc291cmNlcyA3IDAgUi9QYXJlbnQgMiAwIFIvQ3JvcEJveFsyMCAyMCAxODAgOTBdPj4KZW5kb2JqCgo5IDAgb2JqCjw8Pj4KZW5kb2JqCgoxMCAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDIwMCAxMDBdL1JvdGF0ZSAyNzAvUmVzb3VyY2VzIDkgMCBSL1BhcmVudCAyIDAgUi9Dcm9wQm94WzIwIDIwIDE4MCA5MF0+PgplbmRvYmoKCnhyZWYKMCAxMQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwNDIgMDAwMDAgbiAKMDAwMDAwMDEyMCAwMDAwMCBuIAowMDAwMDAwMTkxIDAwMDAwIG4gCjAwMDAwMDAyMTIgMDAwMDAgbiAKMDAwMDAwMDMyNSAwMDAwMCBuIAowMDAwMDAwMzQ2IDAwMDAwIG4gCjAwMDAwMDA0NjAgMDAwMDAgbiAKMDAwMDAwMDQ4MSAwMDAwMCBuIAowMDAwMDAwNTk2IDAwMDAwIG4gCjAwMDAwMDA2MTcgMDAwMDAgbiAKCnRyYWlsZXIKPDwvU2l6ZSAxMS9Sb290IDEgMCBSL0lEWzxDMkFBNENDMkE2QzNCREMzOEMzRUMzODVDMzlBNzZDMz48QkYwRDY0ODE0RTA1ODVBOUY2ODk3NkMwREZGNTY3Q0E+XT4+CnN0YXJ0eHJlZgo3MzMKJSVFT0YK";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlQAAAABJRU5ErkJggg==", "base64");
const pdf = Buffer.from(workerPdfBase64, "base64");

test("independently reads cropped page frame at four rotations and binds hashes", async () => {
  for (const rotation of [0, 90, 180, 270]) {
    const page = rotation / 90 + 1;
    const result = await inspectGeometryPageWithPoppler({ sourceBytes: pdf,
      renderBytes: png, pdfPageNumber: page,
      expectedSourceSha256: sha256(pdf), expectedRenderSha256: sha256(png) });
    assert.deepEqual(result.mediaBox, [0, 0, 200, 100]);
    assert.deepEqual(result.cropBox, [20, 20, 180, 90]);
    assert.equal(result.rotate, rotation);
    assert.equal(result.pdfPageNumber, page);
    assert.equal(result.sourceSha256, sha256(pdf));
    assert.equal(result.renderSha256, sha256(png));
    assert.deepEqual(result.vectorItemSha256ByLocator, {});
  }
});

test("fails closed on changed bytes, unavailable pages, invalid PNG and bad PDF", async () => {
  const base = { sourceBytes: pdf, renderBytes: png, pdfPageNumber: 1,
    expectedSourceSha256: sha256(pdf), expectedRenderSha256: sha256(png) };
  await assert.rejects(inspectGeometryPageWithPoppler({ ...base,
    expectedSourceSha256: "0".repeat(64) }), /SHA mismatch/);
  await assert.rejects(inspectGeometryPageWithPoppler({ ...base,
    expectedRenderSha256: "0".repeat(64) }), /SHA mismatch/);
  await assert.rejects(inspectGeometryPageWithPoppler({ ...base, pdfPageNumber: 5 }));
  await assert.rejects(inspectGeometryPageWithPoppler({ ...base,
    sourceBytes: Buffer.from("%PDF-broken") }));
  await assert.rejects(inspectGeometryPageWithPoppler({ ...base,
    renderBytes: Buffer.from("not PNG") }), /outside bounds/);
  await assert.rejects(inspectGeometryPageWithPoppler({ ...base, pdfPageNumber: 0 }), /outside bounds/);
});

test("rejects ambiguous or unsupported Poppler output", () => {
  const valid = `Pages: 4\nEncrypted: no\nPage 1 size: 160 x 70 pts\nPage 1 rot: 0\nPage 1 MediaBox: 0 0 200 100\nPage 1 CropBox: 20 20 180 90\n`;
  assert.deepEqual(parsePopplerPageInspection(valid, 1), {
    mediaBox: [0, 0, 200, 100], cropBox: [20, 20, 180, 90], rotate: 0 });
  for (const changed of [valid.replace("rot: 0", "rot: 45"),
    valid.replace("Encrypted: no", "Encrypted: yes"),
    valid.replace("Pages: 4", "Pages: 0"),
    valid.replace("CropBox: 20 20 180 90", "CropBox: -1 20 180 90"),
    valid.replace("Page 1 CropBox", "Page 2 CropBox"),
    valid + "Page 1 CropBox: 20 20 180 90\n",
    valid.replace("Page 1 MediaBox: 0 0 200 100\n", "")]) {
    assert.throws(() => parsePopplerPageInspection(changed, 1));
  }
});

test("fails closed when Poppler executable is unavailable", async () => {
  const previousPath = process.env.PATH;
  process.env.PATH = "/__inspector_missing_poppler__";
  try {
    await assert.rejects(inspectGeometryPageWithPoppler({ sourceBytes: pdf,
      renderBytes: png, pdfPageNumber: 1 }), /ENOENT/);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
});

test("authenticates exact Poppler PNG and rejects profile or pixel substitution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-geometry-poppler-test-"));
  try {
    const source = join(directory, "source.pdf");
    const target = join(directory, "render");
    await writeFile(source, pdf);
    const version = spawnSync("pdftoppm", ["-v"], { encoding: "utf8", timeout: 5_000 });
    assert.equal(version.status, 0);
    const parsedVersion = /^pdftoppm version (\d+\.\d+\.\d+)\s*$/m
      .exec(`${version.stdout}\n${version.stderr}`)?.[1];
    assert.ok(parsedVersion);
    const profile = `poppler-pdftoppm-cropbox-72dpi-png-singlefile-v1@${parsedVersion}`;
    const rendering = spawnSync("pdftoppm", ["-f", "2", "-l", "2", "-r", "72",
      "-cropbox", "-png", "-singlefile", source, target], {
      encoding: "utf8", timeout: 30_000, maxBuffer: 256 * 1024,
    });
    assert.equal(rendering.status, 0);
    assert.equal(rendering.stderr, "");
    const rendered = await readFile(`${target}.png`);
    const base = { sourceBytes: pdf, renderBytes: rendered, pdfPageNumber: 2,
      expectedSourceSha256: sha256(pdf), expectedRenderSha256: sha256(rendered),
      rendererProfileId: profile };
    const inspected = await inspectGeometryPageWithVerifiedPopplerRender(base);
    assert.equal(inspected.rotate, 90);
    assert.equal(inspected.renderSha256, sha256(rendered));
    await assert.rejects(inspectGeometryPageWithVerifiedPopplerRender({ ...base,
      rendererProfileId: `${profile}-forged` }), /profile/);
    await assert.rejects(inspectGeometryPageWithVerifiedPopplerRender({ ...base,
      rendererProfileId: "poppler-pdftoppm-cropbox-72dpi-png-singlefile-v1@0.0.0" }), /version mismatch/);
    await assert.rejects(inspectGeometryPageWithVerifiedPopplerRender({ ...base,
      renderBytes: png, expectedRenderSha256: sha256(png) }), /render bytes mismatch/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const publicF0126Path = process.env.INSPECTOR_PUBLIC_F0126_PDF;
test.skipIf(!publicF0126Path)("inspects allowed original F0126 page 17 when supplied", async () => {
  assert.ok(publicF0126Path);
  const sourceBytes = await readFile(publicF0126Path);
  assert.equal(sha256(sourceBytes),
    "b4846376535dd97aa24a8e384e0cb71f40792084fc61981dad587b15bbf63088");
  const directory = await mkdtemp(join(tmpdir(), "inspector-public-geometry-test-"));
  try {
    const output = join(directory, "page");
    const version = spawnSync("pdftoppm", ["-v"], { encoding: "utf8", timeout: 5_000 });
    assert.equal(version.status, 0);
    const parsedVersion = /^pdftoppm version (\d+\.\d+\.\d+)\s*$/m
      .exec(`${version.stdout}\n${version.stderr}`)?.[1];
    assert.ok(parsedVersion);
    const rendering = spawnSync("pdftoppm", ["-f", "17", "-l", "17", "-r", "72",
      "-cropbox", "-png", "-singlefile", publicF0126Path, output], {
      encoding: "utf8", timeout: 30_000, maxBuffer: 256 * 1024,
    });
    assert.equal(rendering.status, 0);
    assert.equal(rendering.stderr, "");
    const renderBytes = await readFile(`${output}.png`);
    const inspection = await inspectGeometryPageWithVerifiedPopplerRender({
      sourceBytes, renderBytes, pdfPageNumber: 17,
      expectedSourceSha256: sha256(sourceBytes), expectedRenderSha256: sha256(renderBytes),
      rendererProfileId: `poppler-pdftoppm-cropbox-72dpi-png-singlefile-v1@${parsedVersion}`,
    });
    assert.deepEqual(inspection.mediaBox, [-1192.08, -841.86, 1192.08, 841.86]);
    assert.deepEqual(inspection.cropBox, inspection.mediaBox);
    // Worker PyMuPDF reads same raw box through float32; v1 exact equality
    // must reject this public artifact until a versioned frame contract exists.
    assert.notDeepEqual(inspection.mediaBox,
      [-1192.0799560546875, -841.8599853515625,
        1192.0799560546875, 841.8599853515625]);
    assert.equal(inspection.rotate, 0);
    assert.deepEqual(inspection.vectorItemSha256ByLocator, {});
    if (parsedVersion === "26.05.0") {
      assert.equal(inspection.renderSha256,
        "a1aca1ee57070b4bec5182741bfba296621875eec802c31bd09280c10b61f24a");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
