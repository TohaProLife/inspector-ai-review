/** Portable build check: installed runtime dependencies, bundled fonts and all report formats. No DB/network. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { SaxesParser } from "saxes";
import { fromBuffer } from "yauzl";
import { renderProtocolReport } from "../src/protocol-report-renderer.js";
import type { ProtocolReportDocument } from "../src/protocol-report-document.js";

const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const directory = new URL("../assets/protocol-fonts/", import.meta.url);
const pins = JSON.parse(await readFile(new URL("font-pins.json", directory), "utf8"));
assert.equal(pins.schemaVersion, "protocol-font-assets-v1");
for (const file of pins.files) {
  assert.ok(/^[A-Za-z0-9.-]+$/.test(file.path));
  const bytes = await readFile(new URL(file.path, directory));
  assert.equal(bytes.length, file.sizeBytes); assert.equal(digest(bytes), file.sha256);
}
const snapshotJson = '{"fixture":"INSTALLED_EXPORT_SELF_CHECK","p":null,"text":"Школа на 600 мест","flow":"9060 м³/ч"}';
const document: ProtocolReportDocument = {
  templateVersion: "installed-export-check-v1", protocolId: "SYNTHETIC-BUILD-CHECK", createdAt: "2026-10-20T00:00:00.000Z",
  snapshotHash: digest(snapshotJson), status: "SYNTHETIC_SOURCE_ONLY", title: "ПРОВЕРКА УСТАНОВЛЕННОГО ЭКСПОРТА",
  metadata: [], notices: ["Синтетическая проверка сборки; инженерного заключения нет."], snapshotJson,
  sections: [{ id: "fixture", title: "Кириллица и единицы", paragraphs: ["Школа на 600 мест"],
    tables: [{ columns: ["ПД", "РД", "Результат"], rows: [["9060 м³/ч", "3340 + 5720 м³/ч", "Вероятность не рассчитана"]] }] }],
};
function embeddedSnapshot(xml: string): string {
  const parser = new SaxesParser({ xmlns: true }); let inside = false, value = "";
  parser.on("doctype", () => { throw new Error("UNEXPECTED_DTD"); });
  parser.on("opentag", tag => { if (tag.local === "canonicalSnapshot") inside = true; });
  parser.on("text", part => { if (inside) value += part; });
  parser.on("closetag", tag => { if (tag.local === "canonicalSnapshot") inside = false; });
  parser.on("error", error => { throw error; }); parser.write(xml).close(); return value;
}
async function docxSnapshot(bytes: Buffer): Promise<string> {
  return new Promise((resolve, reject) => fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
    if (error || !zip) { reject(error); return; }
    let found = false; zip.on("error", reject); zip.on("end", () => { if (!found) reject(new Error("SNAPSHOT_MISSING")); });
    zip.on("entry", entry => {
      if (entry.fileName !== "customXml/item1.xml") { zip.readEntry(); return; }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) { reject(error); return; }
        const chunks: Buffer[] = []; stream.on("error", reject); stream.on("data", chunk => chunks.push(chunk));
        stream.on("end", () => { found = true; zip.close(); resolve(embeddedSnapshot(Buffer.concat(chunks).toString("utf8"))); });
      });
    }); zip.readEntry();
  }));
}
const outputs = [];
for (const format of ["pdf", "docx", "xml"] as const) {
  const bytes = await renderProtocolReport(document, format), again = await renderProtocolReport(document, format);
  assert.ok(bytes.length > 100); assert.deepEqual(again, bytes);
  if (format === "xml") assert.equal(embeddedSnapshot(bytes.toString("utf8")), snapshotJson);
  if (format === "docx") assert.equal(await docxSnapshot(bytes), snapshotJson);
  if (format === "pdf") {
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    const text = spawnSync("pdftotext", ["-", "-"], { input: bytes, encoding: "utf8", maxBuffer: 1024 * 1024 });
    assert.equal(text.status, 0); assert.ok(text.stdout.includes("Школа на 600 мест")); assert.ok(text.stdout.includes("9060 м³/ч"));
  }
  outputs.push({ format, bytes: bytes.length, sha256: digest(bytes) });
}
process.stdout.write(JSON.stringify({ status: "PASS_INSTALLED_REPORT_EXPORTS", fonts: pins.files.length, outputs,
  networkCalls: 0, databaseCalls: 0, syntheticOnly: true }) + "\n");
