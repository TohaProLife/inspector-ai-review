import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { readRawPdfPageFrame } from "../src/geometry-pdf-raw-page.js";

function tablePdf(pageDictionary = "<</Type/Page/Parent 2 0 R>>"): Buffer {
  let source = "%PDF-1.7\n";
  const offsets = [0];
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Count 1/Kids[3 0 R]/MediaBox[0 0 123.456789 100]/CropBox[10 10 100.123456 90]/Rotate 90>>",
    pageDictionary,
  ];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(source);
  source += "xref\n0 4\n0000000000 65535 f \n";
  for (let id = 1; id <= 3; id += 1) {
    source += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  source += `trailer\n<</Size 4/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source, "latin1");
}

function incrementalPdf(): Buffer {
  const base = tablePdf().toString("latin1");
  const oldXref = Number(/startxref\s+(\d+)/u.exec(base)![1]);
  const newObjectOffset = Buffer.byteLength(base);
  let updated = base + "3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[-1192.08 -841.86 1192.08 841.86]/Rotate 180>>\nendobj\n";
  const latestXref = Buffer.byteLength(updated);
  updated += `xref\n3 1\n${String(newObjectOffset).padStart(10, "0")} 00000 n \n`
    + `trailer\n<</Size 4/Root 1 0 R/Prev ${oldXref}>>\nstartxref\n${latestXref}\n%%EOF\n`;
  return Buffer.from(updated, "latin1");
}

function compressedPdf(): Buffer {
  const chunks: Buffer[] = [Buffer.from("%PDF-1.7\n", "ascii")];
  const offsets: number[] = [0];
  const add = (id: number, body: Buffer): void => {
    offsets[id] = Buffer.concat(chunks).length;
    chunks.push(Buffer.from(`${id} 0 obj\n`, "ascii"), body, Buffer.from("\nendobj\n", "ascii"));
  };
  add(1, Buffer.from("<</Type/Catalog/Pages 2 0 R>>"));
  add(3, Buffer.from("<</Type/Page/Parent 2 0 R>>"));
  const compressedObject = Buffer.from(
    "<</Type/Pages/Count 1/Kids[3 0 R]/MediaBox[0 0 123.456789 100]/Rotate 90>>", "ascii");
  const objectHeader = Buffer.from("2 0 ", "ascii");
  const objectStream = deflateSync(Buffer.concat([objectHeader, compressedObject]));
  add(4, Buffer.concat([Buffer.from(`<</Type/ObjStm/N 1/First 4/Length ${objectStream.length}`
    + "/Filter/FlateDecode>>\nstream\n", "ascii"), objectStream, Buffer.from("\nendstream", "ascii")]));
  offsets[5] = Buffer.concat(chunks).length;
  const row = (type: number, offset: number, third: number): Buffer => {
    const buffer = Buffer.alloc(7);
    buffer[0] = type; buffer.writeUInt32BE(offset, 1); buffer.writeUInt16BE(third, 5);
    return buffer;
  };
  const rows = [row(0, 0, 65535), row(1, offsets[1], 0), row(2, 4, 0),
    row(1, offsets[3], 0), row(1, offsets[4], 0), row(1, offsets[5], 0)];
  const predicted = Buffer.alloc(6 * 8);
  for (let index = 0; index < rows.length; index += 1) {
    predicted[index * 8] = 2;
    for (let byte = 0; byte < 7; byte += 1) {
      predicted[index * 8 + byte + 1] = (rows[index][byte]
        - (index ? rows[index - 1][byte] : 0) + 256) & 255;
    }
  }
  const stream = deflateSync(predicted);
  add(5, Buffer.concat([Buffer.from(`<</Type/XRef/Size 6/W[1 4 2]/Root 1 0 R`
    + `/Filter/FlateDecode/DecodeParms<</Columns 7/Predictor 12>>/Length ${stream.length}>>\nstream\n`, "ascii"),
  stream, Buffer.from("\nendstream", "ascii")]));
  chunks.push(Buffer.from(`startxref\n${offsets[5]}\n%%EOF\n`, "ascii"));
  return Buffer.concat(chunks);
}

test("preserves original numeric operands and inherited page boxes", () => {
  const frame = readRawPdfPageFrame(tablePdf(), 1);
  assert.deepEqual(frame.mediaBoxOperands, ["0", "0", "123.456789", "100"]);
  assert.deepEqual(frame.cropBoxOperands, ["10", "10", "100.123456", "90"]);
  assert.deepEqual(frame.mediaBox, [0, 0, 123.456789, 100]);
  assert.equal(frame.rotate, 90);
  assert.equal(frame.pageObjectId, 3);
  assert.equal(frame.mediaBoxObjectId, 2);
  assert.equal(frame.cropBoxObjectId, 2);
  assert.equal(frame.rotateObjectId, 2);
});

test("latest incremental revision wins without rewriting original numeric operands", () => {
  const frame = readRawPdfPageFrame(incrementalPdf(), 1);
  assert.deepEqual(frame.mediaBoxOperands, ["-1192.08", "-841.86", "1192.08", "841.86"]);
  assert.deepEqual(frame.cropBoxOperands, ["10", "10", "100.123456", "90"]);
  assert.equal(frame.rotate, 180);
  assert.equal(frame.mediaBoxObjectId, 3);
  assert.equal(Math.fround(Number(frame.mediaBoxOperands[0])), -1192.0799560546875);
});

test("reads Flate xref stream, PNG predictor and compressed page-tree object", () => {
  const frame = readRawPdfPageFrame(compressedPdf(), 1);
  assert.deepEqual(frame.mediaBoxOperands, ["0", "0", "123.456789", "100"]);
  assert.equal(frame.mediaBoxObjectId, 2);
  assert.equal(frame.rotate, 90);
});

test("allows only a direct unit-scale PDF UserUnit", () => {
  assert.equal(readRawPdfPageFrame(tablePdf("<</Type/Page/Parent 2 0 R/UserUnit 1.0>>"), 1)
    .mediaBox[2], 123.456789);
  for (const value of ["2", "0.5", "1 0 R", "/One", "null"]) {
    assert.throws(() => readRawPdfPageFrame(
      tablePdf(`<</Type/Page/Parent 2 0 R/UserUnit ${value}>>`), 1),
    /unsupported PDF UserUnit/);
  }
});

test("fails closed on missing page, forged page box, altered xref and unsupported stream", () => {
  const valid = tablePdf();
  assert.throws(() => readRawPdfPageFrame(valid, 2), /page number/);
  assert.throws(() => readRawPdfPageFrame(Buffer.from(valid.toString("latin1")
    .replace("/CropBox[10 10 100.123456 90]", "/CropBox[-1 10 100.123456 90]"), "latin1"), 1),
  /outside MediaBox/);
  const malformed = Buffer.from(valid.toString("latin1").replace("startxref\n", "startxref\n999999\n"), "latin1");
  assert.throws(() => readRawPdfPageFrame(malformed, 1), /startxref missing/);
  const unsupported = Buffer.from(compressedPdf().toString("latin1")
    .replace("/Filter/FlateDecode", "/Filter/LZWDecode  "), "latin1");
  assert.throws(() => readRawPdfPageFrame(unsupported, 1), /stream filter/);
});

const publicPath = process.env.INSPECTOR_PUBLIC_F0126_PDF;
test.skipIf(!publicPath)("reads exact raw operands from original permitted F0126 p17", () => {
  assert.ok(publicPath);
  const bytes = readFileSync(publicPath);
  const frame = readRawPdfPageFrame(bytes, 17);
  assert.equal(frame.sourceSha256,
    "b4846376535dd97aa24a8e384e0cb71f40792084fc61981dad587b15bbf63088");
  assert.deepEqual(frame.mediaBoxOperands, ["-1192.08", "-841.86", "1192.08", "841.86"]);
  assert.deepEqual(frame.cropBoxOperands, frame.mediaBoxOperands);
  assert.deepEqual(frame.mediaBox, [-1192.08, -841.86, 1192.08, 841.86]);
  assert.equal(frame.rotate, 0);
  assert.equal(Math.fround(frame.mediaBox[0]), -1192.0799560546875);
  assert.equal(Math.fround(frame.mediaBox[1]), -841.8599853515625);
});
