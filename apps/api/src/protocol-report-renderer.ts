import { readFile } from "node:fs/promises";
import PDFDocument from "pdfkit";
import { ZipFile } from "yazl";
import type { ProtocolReportDocument, ProtocolReportFormat } from "./protocol-report-document.js";

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const XML_NAMESPACE = "urn:inspector-ai:protocol-report:v1";
const FONT_DIRECTORY = new URL("../assets/protocol-fonts/", import.meta.url);
const INVALID_XML = /[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu;

function text(value: string): string {
  return value.replace(INVALID_XML, "\ufffd");
}
function xml(value: string): string {
  return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/\r/g, "&#13;");
}
function attribute(value: string): string {
  return xml(value).replace(/\n/g, "&#10;").replace(/\t/g, "&#9;");
}
function assertString(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new Error("PROTOCOL_REPORT_STRING_REQUIRED");
}
function validate(document: ProtocolReportDocument): Date {
  for (const key of ["templateVersion", "protocolId", "createdAt", "snapshotHash", "status", "title", "snapshotJson"] as const) {
    assertString(document[key]);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(document.createdAt)) {
    throw new Error("PROTOCOL_REPORT_ISO_TIMESTAMP_REQUIRED");
  }
  const date = new Date(document.createdAt);
  const calendar = new Date(document.createdAt.replace(/(?:Z|[+-]\d{2}:\d{2})$/, "Z"));
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(calendar.getTime())
      || calendar.toISOString().slice(0, 19) !== document.createdAt.slice(0, 19)) {
    throw new Error("PROTOCOL_REPORT_INVALID_TIMESTAMP");
  }
  JSON.parse(document.snapshotJson);
  // Never rewrite canonical snapshot bytes to repair XML. Ordinary display
  // strings replace invalid scalar/control characters visibly with U+FFFD.
  if (text(document.snapshotJson) !== document.snapshotJson) {
    throw new Error("PROTOCOL_REPORT_SNAPSHOT_NOT_XML10_SAFE");
  }
  if (!Array.isArray(document.metadata) || !Array.isArray(document.notices) || !Array.isArray(document.sections)) {
    throw new Error("PROTOCOL_REPORT_ARRAY_REQUIRED");
  }
  for (const entry of document.metadata) { assertString(entry.label); assertString(entry.value); }
  for (const notice of document.notices) assertString(notice);
  for (const section of document.sections) {
    assertString(section.id); assertString(section.title);
    if (section.paragraphs !== undefined && !Array.isArray(section.paragraphs)) throw new Error("PROTOCOL_REPORT_ARRAY_REQUIRED");
    if (section.tables !== undefined && !Array.isArray(section.tables)) throw new Error("PROTOCOL_REPORT_ARRAY_REQUIRED");
    for (const paragraph of section.paragraphs ?? []) assertString(paragraph);
    for (const table of section.tables ?? []) {
      if (!Array.isArray(table.columns) || table.columns.length === 0 || !Array.isArray(table.rows)) {
        throw new Error("PROTOCOL_REPORT_TABLE_COLUMNS_REQUIRED");
      }
      for (const column of table.columns) assertString(column);
      for (const row of table.rows) {
        if (!Array.isArray(row) || row.length !== table.columns.length) throw new Error("PROTOCOL_REPORT_TABLE_ROW_WIDTH_MISMATCH");
        for (const cell of row) assertString(cell);
      }
    }
  }
  return date;
}

function reportXml(document: ProtocolReportDocument): string {
  return XML_DECLARATION + '\n' +
    `<protocolReport xmlns="${XML_NAMESPACE}" templateVersion="${attribute(document.templateVersion)}"` +
    ` protocolId="${attribute(document.protocolId)}" createdAt="${attribute(document.createdAt)}"` +
    ` snapshotHash="${attribute(document.snapshotHash)}" status="${attribute(document.status)}">` +
    `<title>${xml(document.title)}</title><metadata>` +
    document.metadata.map((entry) => `<entry><label>${xml(entry.label)}</label><value>${xml(entry.value)}</value></entry>`).join("") +
    `</metadata><notices>${document.notices.map((notice) => `<notice>${xml(notice)}</notice>`).join("")}</notices><sections>` +
    document.sections.map((section) => `<section id="${attribute(section.id)}"><title>${xml(section.title)}</title>` +
      `<paragraphs>${(section.paragraphs ?? []).map((paragraph) => `<paragraph>${xml(paragraph)}</paragraph>`).join("")}</paragraphs><tables>` +
      (section.tables ?? []).map((table) => `<table><columns>${table.columns.map((column, index) =>
        `<column index="${index + 1}">${xml(column)}</column>`).join("")}</columns><rows>` +
        table.rows.map((row, index) => `<row index="${index + 1}">${row.map((cell, column) =>
          `<cell column="${column + 1}">${xml(cell)}</cell>`).join("")}</row>`).join("") + `</rows></table>`).join("") +
      `</tables></section>`).join("") + `</sections><canonicalSnapshot encoding="json">${xml(document.snapshotJson)}</canonicalSnapshot></protocolReport>\n`;
}

function fixedMetadata(document: ProtocolReportDocument): Array<{ label: string; value: string }> {
  return [
    { label: "Идентификатор протокола", value: document.protocolId },
    { label: "Дата снимка", value: document.createdAt },
    { label: "Статус", value: document.status },
    { label: "Версия шаблона", value: document.templateVersion },
    { label: "SHA-256 снимка", value: document.snapshotHash },
    ...document.metadata,
  ];
}

async function pdf(document: ProtocolReportDocument, createdAt: Date): Promise<Buffer> {
  const [regular, bold] = await Promise.all([
    readFile(new URL("DejaVuSans.ttf", FONT_DIRECTORY)),
    readFile(new URL("DejaVuSans-Bold.ttf", FONT_DIRECTORY)),
  ]);
  return new Promise<Buffer>((resolve, reject) => {
    const output: Buffer[] = [];
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32,
      autoFirstPage: false, bufferPages: true, compress: true,
      info: { Title: text(document.title), Author: "Inspector AI", Creator: "Inspector AI protocol renderer v1",
        Producer: "Inspector AI / PDFKit 0.20.2", Subject: text(document.protocolId),
        Keywords: text(`template=${document.templateVersion};snapshot=${document.snapshotHash}`),
        CreationDate: createdAt, ModDate: createdAt } });
    doc.on("data", (chunk: Buffer) => output.push(chunk));
    doc.once("error", reject);
    doc.once("end", () => resolve(Buffer.concat(output)));
    try {
      doc.registerFont("Report", regular); doc.registerFont("ReportBold", bold);
      const margin = 32, bodyTop = 72, footerSpace = 35;
      let y = bodyTop;
      const width = () => doc.page.width - margin * 2;
      const bottom = () => doc.page.height - footerSpace;
      function page(): void {
        doc.addPage(); y = bodyTop;
        doc.font("Report").fontSize(7).fillColor("#333333");
        doc.text(text(`Протокол ${document.protocolId}`).slice(0, 140), margin, 22, { lineBreak: false });
        doc.text(text(`Шаблон ${document.templateVersion}`).slice(0, 140), margin, 34, { lineBreak: false });
        doc.text(text(`SHA-256 ${document.snapshotHash}`), margin, 46, { lineBreak: false });
        doc.moveTo(margin, 61).lineTo(doc.page.width - margin, 61).lineWidth(0.5).strokeColor("#999999").stroke();
        doc.fillColor("#111111");
      }
      const segmenter = new Intl.Segmenter("ru", { granularity: "grapheme" });
      function wrap(value: string, availableWidth: number, font: string, size: number): string[] {
        doc.font(font).fontSize(size);
        const lines: string[] = [];
        for (const part of text(value).replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n")) {
          if (part === "") { lines.push(""); continue; }
          const chars = Array.from(segmenter.segment(part), (s) => s.segment);
          let start = 0;
          while (start < chars.length) {
            let end = start, lastSpace = -1;
            while (end < chars.length && doc.widthOfString(chars.slice(start, end + 1).join("")) <= availableWidth) {
              if (/\s/u.test(chars[end])) lastSpace = end;
              end += 1;
            }
            if (end === start) end += 1; // A single glyph still remains in the export.
            else if (end < chars.length && lastSpace >= start) end = lastSpace + 1;
            lines.push(chars.slice(start, end).join("")); start = end;
          }
        }
        return lines;
      }
      function lineHeight(font: string, size: number): number {
        return doc.font(font).fontSize(size).currentLineHeight(true) + 1;
      }
      function paragraph(value: string, font = "Report", size = 9, gap = 6): void {
        const height = lineHeight(font, size);
        for (const line of wrap(value, width(), font, size)) {
          if (y + height > bottom()) page();
          doc.font(font).fontSize(size).fillColor("#111111").text(line, margin, y, { lineBreak: false });
          y += height;
        }
        y += gap;
      }
      function table(columns: string[], rows: string[][]): void {
        // Horizontal bands preserve every column without unreadably narrow cells.
        for (let band = 0; band < columns.length; band += 8) {
          const labels = columns.slice(band, band + 8), count = labels.length;
          const cellWidth = width() / count, pad = 4, fontSize = 8, h = lineHeight("Report", fontSize);
          if (columns.length > 8) paragraph(`Столбцы ${band + 1}–${band + count} из ${columns.length}`, "ReportBold", 9);
          let header = labels.map((label) => wrap(label, cellWidth - pad * 2, "ReportBold", fontSize));
          if (Math.max(...header.map((lines) => lines.length)) * h + pad * 2 > 100) {
            // Very long labels are printed completely as a paginated legend;
            // compact numbered column headers can then repeat on every page.
            labels.forEach((label, index) => paragraph(`Столбец ${band + index + 1}: ${label}`, "ReportBold", 8));
            header = labels.map((_, index) => [`Столбец ${band + index + 1}`]);
          }
          const headerLines = Math.max(...header.map((lines) => lines.length));
          const headerHeight = headerLines * h + pad * 2;
          function fragment(cells: string[][], offset: number, length: number, heading: boolean): void {
            const height = length * h + pad * 2;
            cells.forEach((lines, index) => {
              const x = margin + index * cellWidth;
              doc.lineWidth(0.4).strokeColor("#999999");
              if (heading) doc.rect(x, y, cellWidth, height).fillAndStroke("#eeeeee", "#999999");
              else doc.rect(x, y, cellWidth, height).stroke();
              doc.font(heading ? "ReportBold" : "Report").fontSize(fontSize).fillColor("#111111");
              for (let i = 0; i < length; i += 1) {
                const value = lines[offset + i];
                if (value !== undefined) doc.text(value, x + pad, y + pad + i * h, { lineBreak: false });
              }
            });
            y += height;
          }
          function heading(newPage: boolean): void {
            if (newPage || y + headerHeight + h + pad * 2 > bottom()) page();
            fragment(header, 0, headerLines, true);
          }
          heading(false);
          for (const row of rows) {
            const cells = row.slice(band, band + count).map((cell) => wrap(cell, cellWidth - pad * 2, "Report", fontSize));
            const lines = Math.max(...cells.map((cell) => cell.length));
            const wholeHeight = lines * h + pad * 2;
            if (wholeHeight <= bottom() - bodyTop - headerHeight && y + wholeHeight > bottom()) heading(true);
            let offset = 0;
            while (offset < lines) {
              const available = Math.floor((bottom() - y - pad * 2) / h);
              if (available < 1) { heading(true); continue; }
              const take = Math.min(available, lines - offset);
              fragment(cells, offset, take, false); offset += take;
              if (offset < lines) heading(true);
            }
          }
          y += 8;
        }
      }
      page();
      paragraph(document.title, "ReportBold", 15, 10);
      for (const entry of fixedMetadata(document)) paragraph(`${entry.label}: ${entry.value}`, "Report", 9, 4);
      for (const notice of document.notices) paragraph(notice, "ReportBold", 9);
      for (const section of document.sections) {
        if (y + 35 > bottom()) page();
        paragraph(section.title, "ReportBold", 12, 8);
        for (const value of section.paragraphs ?? []) paragraph(value);
        for (const value of section.tables ?? []) table(value.columns, value.rows);
      }
      const range = doc.bufferedPageRange();
      for (let index = range.start; index < range.start + range.count; index += 1) {
        doc.switchToPage(index);
        doc.font("Report").fontSize(7).fillColor("#333333");
        doc.text(`Страница ${index + 1} / ${range.count}`, margin, doc.page.height - 23, { lineBreak: false });
      }
      doc.file(Buffer.from(document.snapshotJson, "utf8"), { name: "canonical-snapshot.json", type: "application/json",
        creationDate: createdAt, modifiedDate: createdAt });
      doc.file(Buffer.from(reportXml(document), "utf8"), { name: "protocol-report.xml", type: "application/xml",
        creationDate: createdAt, modifiedDate: createdAt });
      doc.end();
    } catch (error) { doc.destroy(); reject(error); }
  });
}

function wordText(value: string): string {
  return text(value).replace(/\r\n?/g, "\n").split(/(\n|\t)/).map((part) =>
    part === "\n" ? "<w:br/>" : part === "\t" ? "<w:tab/>" : `<w:t xml:space="preserve">${xml(part)}</w:t>`).join("");
}
function wordParagraph(value: string, style = "Normal"): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r>${wordText(value)}</w:r></w:p>`;
}
function wordTableBand(columns: string[], rows: string[][]): string {
  const width = Math.floor(15398 / columns.length);
  function row(cells: string[], heading: boolean): string {
    return `<w:tr>${heading ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells.map((cell) =>
      `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${heading ? '<w:shd w:fill="EEEEEE"/>' : ""}</w:tcPr>` +
      `<w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r>${heading ? "<w:rPr><w:b/></w:rPr>" : ""}${wordText(cell)}</w:r></w:p></w:tc>`).join("")}</w:tr>`;
  }
  return `<w:tbl><w:tblPr><w:tblW w:w="15398" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>` +
    ["top", "left", "bottom", "right", "insideH", "insideV"].map((edge) => `<w:${edge} w:val="single" w:sz="4" w:color="999999"/>`).join("") +
    `</w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${columns.map(() => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>` + row(columns, true) +
    rows.map((cells) => row(cells, false)).join("") + "</w:tbl>";
}

function wordTable(columns: string[], rows: string[][]): string {
  let output = "";
  for (let start = 0; start < columns.length; start += 8) {
    let labels = columns.slice(start, start + 8);
    if (columns.length > 8) output += wordParagraph(`Столбцы ${start + 1}–${start + labels.length} из ${columns.length}`, "Notice");
    if (labels.some((label) => label.length > 400)) {
      labels.forEach((label, index) => { output += wordParagraph(`Столбец ${start + index + 1}: ${label}`); });
      labels = labels.map((_, index) => `Столбец ${start + index + 1}`);
    }
    output += wordTableBand(labels, rows.map((row) => row.slice(start, start + labels.length)));
  }
  return output;
}

async function docx(document: ProtocolReportDocument, createdAt: Date): Promise<Buffer> {
  const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
  const officeRel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const body = wordParagraph(document.title, "Title") + fixedMetadata(document).map((entry) => wordParagraph(`${entry.label}: ${entry.value}`)).join("") +
    document.notices.map((notice) => wordParagraph(notice, "Notice")).join("") + document.sections.map((section) =>
      wordParagraph(section.title, "Heading1") + (section.paragraphs ?? []).map((value) => wordParagraph(value)).join("") +
      (section.tables ?? []).map((table) => wordTable(table.columns, table.rows)).join("")).join("");
  const entries: Array<[string, string]> = [
    ["[Content_Types].xml", `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      [["/word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"],
       ["/word/styles.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"],
       ["/word/footer1.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"],
       ["/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"],
       ["/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml"]].map(([name, type]) => `<Override PartName="${name}" ContentType="${type}"/>`).join("") + "</Types>"],
    ["_rels/.rels", `${XML_DECLARATION}<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${officeRel}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${officeRel}/extended-properties" Target="docProps/app.xml"/></Relationships>`],
    ["docProps/core.xml", `${XML_DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(document.title)}</dc:title><dc:creator>Inspector AI</dc:creator><dc:identifier>${xml(document.protocolId)}</dc:identifier><cp:version>${xml(document.templateVersion)}</cp:version><cp:keywords>${xml(document.snapshotHash)}</cp:keywords><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt.toISOString()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt.toISOString()}</dcterms:modified></cp:coreProperties>`],
    ["docProps/app.xml", `${XML_DECLARATION}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Inspector AI</Application></Properties>`],
    ["word/document.xml", `${XML_DECLARATION}<w:document xmlns:w="${w}" xmlns:r="${officeRel}"><w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360"/></w:sectPr></w:body></w:document>`],
    ["word/_rels/document.xml.rels", `${XML_DECLARATION}<Relationships xmlns="${rel}"><Relationship Id="rIdStyles" Type="${officeRel}/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="${officeRel}/footer" Target="footer1.xml"/><Relationship Id="rIdSnapshot" Type="${officeRel}/customXml" Target="../customXml/item1.xml"/></Relationships>`],
    ["word/styles.xml", `${XML_DECLARATION}<w:styles xmlns:w="${w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans" w:cs="DejaVu Sans"/><w:sz w:val="18"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Notice"><w:name w:val="Notice"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style></w:styles>`],
    ["word/footer1.xml", `${XML_DECLARATION}<w:ftr xmlns:w="${w}">${wordParagraph(`Шаблон ${document.templateVersion}; SHA-256 ${document.snapshotHash}`)}<w:p><w:r><w:t>Страница </w:t></w:r><w:fldSimple w:instr="PAGE"/><w:r><w:t> / </w:t></w:r><w:fldSimple w:instr="NUMPAGES"/></w:p></w:ftr>`],
    ["customXml/item1.xml", reportXml(document)],
  ];
  return new Promise<Buffer>((resolve, reject) => {
    const zip = new ZipFile(), chunks: Buffer[] = [];
    zip.on("error", reject); zip.outputStream.on("error", reject);
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once("end", () => resolve(Buffer.concat(chunks)));
    // DOS-local midnight plus no extended timestamps keeps bytes stable across
    // host timezones, DST and wall clocks. Actual snapshot dates are core props.
    const timestamp = new Date(1980, 0, 1, 0, 0, 0);
    for (const [name, value] of entries) zip.addBuffer(Buffer.from(value, "utf8"), name,
      { mtime: timestamp, mode: 0o100644, compress: true, compressionLevel: 9, forceDosTimestamp: true });
    zip.end();
  });
}

/** Pure in-memory export. No source fetching, DB, model or external converter. */
export async function renderProtocolReport(document: ProtocolReportDocument, format: ProtocolReportFormat): Promise<Buffer> {
  const createdAt = validate(document);
  switch (format) {
    case "pdf": return pdf(document, createdAt);
    case "docx": return docx(document, createdAt);
    case "xml": return Buffer.from(reportXml(document), "utf8");
    default: throw new Error("PROTOCOL_REPORT_FORMAT_UNSUPPORTED");
  }
}
