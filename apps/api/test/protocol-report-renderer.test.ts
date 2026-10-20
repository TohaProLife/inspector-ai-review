import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { SaxesParser } from "saxes";
import { fromBuffer } from "yauzl";
import { test } from "vitest";
import type { ProtocolReportDocument } from "../src/protocol-report-document.js";
import { renderProtocolReport } from "../src/protocol-report-renderer.js";

function fixture(): ProtocolReportDocument {
  return {
    templateVersion: "protocol-v1", protocolId: "ПРОТОКОЛ-42", createdAt: "2026-10-20T12:34:56.000Z",
    snapshotHash: "a".repeat(64), status: "DRAFT_REVIEW_ONLY", title: "Протокол проверки исходников",
    metadata: [{ label: "Объект", value: 'Школа <600> & "источник"' }],
    notices: ["Вероятность не оценена; p=null. Требуется проверка инспектора."],
    sections: [{ id: "evidence", title: "Доказательства", paragraphs: ["Русская цитата.\nВторая строка\tтабуляция."],
      tables: [{ columns: ["Код", "ПД", "РД", "Основание"], rows: [
        ["PZ-013", "600 мест", "600 мест", "Кандидат; редакции не квалифицированы"],
        ["IOS4-079", "9060 м³/ч", "3340 + 5720 м³/ч", "Сравнение выбранной группы"],
      ] }] }],
    snapshotJson: '{"p":null,"raw":"</canonicalSnapshot><script>&\\\"","кириллица":"Школа"}',
  };
}

type XmlNode = { name: string; attrs: Record<string, string>; text: string; children: XmlNode[] };
function parseXml(source: string): XmlNode {
  const parser = new SaxesParser({ xmlns: true });
  const stack: XmlNode[] = []; let root: XmlNode | undefined;
  parser.on("doctype", () => { throw new Error("UNEXPECTED_DTD"); });
  parser.on("opentag", (tag) => {
    const node: XmlNode = { name: tag.name, attrs: Object.fromEntries(Object.entries(tag.attributes).map(([key, value]) => [key, value.value])), text: "", children: [] };
    if (stack.length) stack[stack.length - 1].children.push(node); else { assert.equal(root, undefined); root = node; }
    stack.push(node);
  });
  parser.on("text", (value) => { if (stack.length) stack[stack.length - 1].text += value; });
  parser.on("closetag", () => { stack.pop(); });
  parser.on("error", (error) => { throw error; });
  parser.write(source).close(); assert.ok(root); assert.equal(stack.length, 0); return root;
}
function nodes(root: XmlNode, name: string): XmlNode[] {
  return [...(root.name === name ? [root] : []), ...root.children.flatMap((child) => nodes(child, name))];
}
async function unzip(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(error); return; }
      const files = new Map<string, Buffer>();
      zip.on("error", reject); zip.once("end", () => resolve(files));
      zip.on("entry", (entry) => {
        try {
          assert.equal(entry.lastModFileDate, 33); assert.equal(entry.lastModFileTime, 0);
          assert.ok(!files.has(entry.fileName)); assert.ok(!entry.fileName.includes("..")); assert.ok(!entry.isEncrypted());
        } catch (failure) { zip.close(); reject(failure); return; }
        zip.openReadStream(entry, (failure, stream) => {
          if (failure || !stream) { reject(failure); return; }
          const chunks: Buffer[] = []; stream.on("data", (chunk: Buffer) => chunks.push(chunk)); stream.on("error", reject);
          stream.once("end", () => { files.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}

/** Minimal independent reader for PDFKit's Identity-H / ToUnicode output.
 * Parses emitted content streams, not renderer layout helpers or input data.
 */
function pdfContents(buffer: Buffer): { pages: string[]; embeddedFiles: Buffer[]; raw: string } {
  const raw = buffer.toString("latin1"); const objects = new Map<number, string>();
  for (const match of raw.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)) objects.set(Number(match[1]), match[2]);
  function stream(body: string): Buffer {
    const start = body.indexOf("stream\n"), end = body.lastIndexOf("\nendstream");
    assert.ok(start >= 0 && end > start);
    const bytes = Buffer.from(body.slice(start + 7, end), "latin1");
    return /\/FlateDecode\b/.test(body.slice(0, start)) ? inflateSync(bytes) : bytes;
  }
  function utf16(hex: string): string { return Buffer.from(hex, "hex").swap16().toString("utf16le"); }
  const fonts = new Map<number, Map<number, string>>();
  for (const [id, body] of objects) {
    const ref = /\/ToUnicode (\d+) 0 R/.exec(body); if (!ref) continue;
    const cmap = stream(objects.get(Number(ref[1]))!).toString("ascii"), codes = new Map<number, string>();
    for (const range of cmap.matchAll(/<([\da-f]+)>\s*<([\da-f]+)>\s*\[([^\]]+)\]/gi)) {
      let index = Number.parseInt(range[1], 16);
      for (const value of range[3].matchAll(/<([\da-f]+)>/gi)) codes.set(index++, utf16(value[1]));
    }
    assert.ok(codes.size > 0); fonts.set(id, codes);
  }
  const fontNames = new Map<string, Map<number, string>>();
  for (const body of objects.values()) for (const ref of body.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
    if (fonts.has(Number(ref[2]))) fontNames.set(ref[1], fonts.get(Number(ref[2]))!);
  }
  const pages: string[] = [], embeddedFiles: Buffer[] = [];
  for (const body of objects.values()) {
    if (/\/Type \/EmbeddedFile\b/.test(body)) embeddedFiles.push(stream(body));
    if (!/\/Type \/Page\b/.test(body)) continue;
    const ref = /\/Contents (\d+) 0 R/.exec(body); assert.ok(ref);
    const content = stream(objects.get(Number(ref[1]))!).toString("ascii"); let value = "";
    for (const block of content.matchAll(/\bBT\n([\s\S]*?)\bET\b/g)) {
      const font = /\/(F\d+) [\d.]+ Tf/.exec(block[1]); if (!font) continue;
      const map = fontNames.get(font[1]); assert.ok(map);
      for (const literal of block[1].matchAll(/<([\da-f]+)>/gi)) {
        for (let i = 0; i < literal[1].length; i += 4) {
          const code = Number.parseInt(literal[1].slice(i, i + 4), 16);
          assert.ok(map.has(code), `Unmapped glyph ${code}`); value += map.get(code);
        }
      }
      value += "\n";
    }
    pages.push(value);
  }
  assert.ok(pages.length); return { pages, embeddedFiles, raw };
}

for (const format of ["pdf", "docx", "xml"] as const) {
  test(`${format}: deterministic bytes and no mutation of the immutable projection`, async () => {
    const input = fixture(), before = structuredClone(input);
    const first = await renderProtocolReport(input, format);
    await new Promise((resolve) => setTimeout(resolve, 12));
    const second = await renderProtocolReport(input, format);
    assert.deepEqual(first, second); assert.deepEqual(input, before);
  });
}

test("XML: structured tables, Cyrillic, exact canonical JSON and injection escaping", async () => {
  const input = fixture(); input.sections[0].paragraphs!.push('<!DOCTYPE x SYSTEM "file:///etc/passwd"><script>не исполнять</script>');
  input.metadata.push({ label: "CR", value: "раз\rдва\nтри\tчетыре" });
  const bytes = await renderProtocolReport(input, "xml"), value = bytes.toString("utf8"), tree = parseXml(value);
  assert.equal(tree.name, "protocolReport"); assert.equal(tree.attrs.snapshotHash, input.snapshotHash);
  assert.equal(nodes(tree, "section")[0].attrs.id, "evidence");
  assert.deepEqual(nodes(tree, "column").map((n) => n.text), input.sections[0].tables![0].columns);
  assert.deepEqual(nodes(tree, "row").map((row) => row.children.map((cell) => cell.text)), input.sections[0].tables![0].rows);
  assert.equal(nodes(tree, "canonicalSnapshot")[0].attrs.encoding, "json");
  assert.equal(nodes(tree, "canonicalSnapshot")[0].text, input.snapshotJson);
  assert.deepEqual(JSON.parse(nodes(tree, "canonicalSnapshot")[0].text), JSON.parse(input.snapshotJson));
  assert.ok(nodes(tree, "value").some((n) => n.text === "раз\rдва\nтри\tчетыре"));
  assert.equal(nodes(tree, "script").length, 0); assert.ok(value.includes("&lt;!DOCTYPE"));
  assert.ok(value.startsWith('<?xml version="1.0" encoding="UTF-8"'));
});

test("DOCX: real ZIP, well-formed OOXML, closed relationships, rows and repeatable header", async () => {
  const input = fixture(); input.sections[0].tables![0].rows.push(["КОНЕЦ", "Ж".repeat(12000), "строка\nперенос\tтаб", '<>&"']);
  const files = await unzip(await renderProtocolReport(input, "docx"));
  assert.deepEqual([...files.keys()], ["[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "docProps/app.xml", "word/document.xml", "word/_rels/document.xml.rels", "word/styles.xml", "word/footer1.xml", "customXml/item1.xml"]);
  const trees = new Map([...files].map(([name, value]) => [name, parseXml(value.toString("utf8"))]));
  const body = trees.get("word/document.xml")!;
  assert.equal(nodes(body, "w:tblHeader").length, 1); assert.equal(nodes(body, "w:cantSplit").length, 0);
  assert.equal(nodes(body, "w:tr").length, 4); assert.equal(nodes(body, "w:tc").length, 16);
  assert.ok(nodes(body, "w:t").some((n) => n.text === "Ж".repeat(12000)));
  assert.ok(nodes(body, "w:t").some((n) => n.text === `${input.metadata[0].label}: ${input.metadata[0].value}`));
  assert.ok(nodes(body, "w:br").length >= 2); assert.ok(nodes(body, "w:tab").length >= 2);
  assert.equal(nodes(body, "w:pgSz")[0].attrs["w:orient"], "landscape");
  assert.equal(nodes(trees.get("customXml/item1.xml")!, "canonicalSnapshot")[0].text, input.snapshotJson);
  const core = trees.get("docProps/core.xml")!;
  assert.equal(nodes(core, "dcterms:created")[0].text, input.createdAt);
  assert.equal(nodes(core, "dcterms:modified")[0].text, input.createdAt);
  for (const [name, tree] of trees) {
    if (!name.endsWith(".rels")) continue;
    for (const relationship of nodes(tree, "Relationship")) {
      assert.notEqual(relationship.attrs.TargetMode, "External");
      const prefix = name === "_rels/.rels" ? "" : "word/";
      const target = relationship.attrs.Target.startsWith("../") ? relationship.attrs.Target.slice(3) : prefix + relationship.attrs.Target;
      assert.ok(files.has(target), `Unresolved package relationship ${target}`);
    }
  }
});

test("PDF: embedded Cyrillic, exact oversized row, every row, repeated headers and page numbers", async () => {
  const input = fixture(); input.sections[0].paragraphs = [];
  input.sections[0].tables = [{ columns: ["ЗАГОЛОВОК_A", "ЗАГОЛОВОК_B"], rows: Array.from({ length: 170 }, (_, index) => [
    `СТРОКА_${String(index).padStart(4, "0")}`, index === 4 ? "Ж".repeat(12000) + "КОНЕЦ_ДЛИННОЙ_СТРОКИ" : `Источник_${index}_с_кириллицей`,
  ]) }];
  const bytes = await renderProtocolReport(input, "pdf"), result = pdfContents(bytes), all = result.pages.join("\n");
  assert.ok(bytes.subarray(0, 8).toString().startsWith("%PDF-1."));
  assert.ok(result.raw.includes("/FontFile2")); assert.match(result.raw, /\/BaseFont \/[A-Z]+\+DejaVuSans-Bold/); assert.ok(result.raw.includes("/ToUnicode"));
  assert.ok(result.raw.includes("D:20261020123456Z")); assert.ok(result.pages.length > 8);
  assert.equal((all.match(/Ж/g) ?? []).length, 12000);
  assert.ok(all.replace(/\s/gu, "").includes("КОНЕЦ_ДЛИННОЙ_СТРОКИ"));
  for (let index = 0; index < 170; index += 1) assert.equal((all.match(new RegExp(`СТРОКА_${String(index).padStart(4, "0")}`, "g")) ?? []).length, 1);
  for (const [index, page] of result.pages.entries()) {
    assert.ok(page.includes("ЗАГОЛОВОК_A")); assert.ok(page.includes("ЗАГОЛОВОК_B"));
    assert.ok(page.includes(`Страница ${index + 1} / ${result.pages.length}`));
    assert.ok(page.includes(input.snapshotHash));
  }
  assert.ok(result.embeddedFiles.some((file) => file.equals(Buffer.from(input.snapshotJson))));
  assert.ok(result.embeddedFiles.some((file) => file.toString("utf8").startsWith("<?xml") && parseXml(file.toString("utf8")).name === "protocolReport"));
  assert.ok(!result.raw.includes("/JavaScript")); assert.ok(!result.raw.includes("/OpenAction"));
}, 30000);

test("PDF: wide tables and very long column labels preserve all data through bands/legend", async () => {
  const input = fixture(); input.sections[0].paragraphs = ["ДЛИННЫЙ_АБЗАЦ ".repeat(400)];
  input.sections[0].tables = [{ columns: ["ДЛИННЫЙ_ЗАГОЛОВОК ".repeat(250), ...Array.from({ length: 9 }, (_, i) => `КОЛОНКА_${i + 1}`)],
    rows: [Array.from({ length: 10 }, (_, i) => `ЗНАЧЕНИЕ_${i}`)] }];
  const parsed = pdfContents(await renderProtocolReport(input, "pdf")), all = parsed.pages.join("\n");
  assert.equal((all.match(/ДЛИННЫЙ_АБЗАЦ/g) ?? []).length, 400);
  assert.equal((all.match(/ДЛИННЫЙ_ЗАГОЛОВОК/g) ?? []).length, 250);
  for (let index = 0; index < 10; index += 1) assert.ok(all.includes(`ЗНАЧЕНИЕ_${index}`));
}, 30000);

test("DOCX: ZIP bytes stable across timezone changes", async () => {
  const before = process.env.TZ;
  try {
    process.env.TZ = "UTC"; const utc = await renderProtocolReport(fixture(), "docx");
    process.env.TZ = "Pacific/Honolulu"; const pacific = await renderProtocolReport(fixture(), "docx");
    assert.deepEqual(utc, pacific);
  } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
});

test("DOCX: wide columns use ordered bands; oversized labels remain complete in legend", async () => {
  const input = fixture(), long = "Исходный заголовок ".repeat(100);
  input.sections[0].tables = [{ columns: [long, ...Array.from({ length: 9 }, (_, i) => `Колонка_${i}`)],
    rows: [Array.from({ length: 10 }, (_, i) => `ДАННЫЕ_${i}`)] }];
  const files = await unzip(await renderProtocolReport(input, "docx"));
  const tree = parseXml(files.get("word/document.xml")!.toString("utf8"));
  assert.equal(nodes(tree, "w:tbl").length, 2); assert.equal(nodes(tree, "w:tblHeader").length, 2);
  const values = nodes(tree, "w:t").map((n) => n.text);
  assert.ok(values.includes(`Столбец 1: ${long}`));
  for (let index = 0; index < 10; index += 1) assert.equal(values.filter((value) => value === `ДАННЫЕ_${index}`).length, 1);
});

test("snapshot identity and dates are exported and change deterministic bytes", async () => {
  for (const format of ["pdf", "docx", "xml"] as const) {
    const original = fixture(), changed = { ...original, snapshotHash: "b".repeat(64), protocolId: "ПРОТОКОЛ-43", createdAt: "2026-10-21T12:34:56.000Z" };
    assert.notDeepEqual(await renderProtocolReport(original, format), await renderProtocolReport(changed, format));
  }
});

test("XML 1.0 invalid display characters visibly replaced; escaped snapshot controls preserved", async () => {
  const input = fixture(); input.title = "До\u0001после\ud800конец\ufffe";
  input.snapshotJson = JSON.stringify({ control: "\u0001", loneSurrogate: "\ud800", valid: "😀" });
  for (const format of ["xml", "docx", "pdf"] as const) {
    const bytes = await renderProtocolReport(input, format);
    if (format === "xml") {
      const tree = parseXml(bytes.toString("utf8")); assert.equal(nodes(tree, "title")[0].text, "До\ufffdпосле\ufffdконец\ufffd");
      assert.equal(nodes(tree, "canonicalSnapshot")[0].text, input.snapshotJson);
    } else if (format === "docx") {
      for (const value of (await unzip(bytes)).values()) parseXml(value.toString("utf8"));
    } else { assert.ok(pdfContents(bytes).pages.join("\n").includes("До�после�конец�")); }
  }
});

test("fail closed for malformed JSON, raw invalid snapshot characters, timestamp and row shape", async () => {
  const cases: Array<[Partial<ProtocolReportDocument>, RegExp]> = [
    [{ snapshotJson: "{not JSON}" }, /JSON|property|Unexpected/i],
    [{ snapshotJson: '"raw\u0001"' }, /JSON|control/i],
    [{ snapshotJson: '"raw\ud800"' }, /PROTOCOL_REPORT_SNAPSHOT_NOT_XML10_SAFE/],
    [{ createdAt: "2026-10-20" }, /PROTOCOL_REPORT_ISO_TIMESTAMP_REQUIRED/],
    [{ createdAt: "2026-99-99T00:00:00Z" }, /PROTOCOL_REPORT_INVALID_TIMESTAMP/],
    [{ createdAt: "2026-02-31T00:00:00Z" }, /PROTOCOL_REPORT_INVALID_TIMESTAMP/],
    [{ sections: [{ id: "x", title: "x", tables: [{ columns: ["a"], rows: [["a", "b"]] }] }] }, /PROTOCOL_REPORT_TABLE_ROW_WIDTH_MISMATCH/],
    [{ sections: [{ id: "x", title: "x", tables: [{ columns: [], rows: [] }] }] }, /PROTOCOL_REPORT_TABLE_COLUMNS_REQUIRED/],
  ];
  for (const [patch, reason] of cases) for (const format of ["pdf", "docx", "xml"] as const) {
    await assert.rejects(renderProtocolReport({ ...fixture(), ...patch }, format), reason);
  }
  await assert.rejects(renderProtocolReport(fixture(), "html" as "pdf"), /PROTOCOL_REPORT_FORMAT_UNSUPPORTED/);
});

test("empty optional sections and zero data rows remain valid exports", async () => {
  const input = fixture(); input.sections = [{ id: "empty", title: "Пустой раздел" }, { id: "table", title: "Пустая таблица", tables: [{ columns: ["Код"], rows: [] }] }];
  assert.ok(pdfContents(await renderProtocolReport(input, "pdf")).pages.join("\n").includes("Пустой раздел"));
  const docx = await unzip(await renderProtocolReport(input, "docx"));
  assert.equal(nodes(parseXml(docx.get("word/document.xml")!.toString()), "w:tr").length, 1);
  assert.equal(nodes(parseXml((await renderProtocolReport(input, "xml")).toString()), "row").length, 0);
});

test("embedded font assets match pinned source bytes and carry redistribution license", async () => {
  const directory = new URL("../assets/protocol-fonts/", import.meta.url);
  const pins = JSON.parse(await readFile(new URL("font-pins.json", directory), "utf8")) as { files: Array<{ path: string; sha256: string }> };
  for (const pin of pins.files) {
    const bytes = await readFile(new URL(pin.path, directory));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), pin.sha256);
  }
  const license = await readFile(new URL("LICENSE.txt", directory), "utf8");
  assert.ok(license.includes("Bitstream")); assert.ok(license.includes("Permission is hereby granted"));
});
