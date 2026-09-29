import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

/** Bounded independent reader for PDF page-tree geometry, not a content parser. */
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_DECODED_STREAM_BYTES = 16 * 1024 * 1024;
const MAX_OBJECTS = 100_000;
const MAX_PAGES = 10_000;
const MAX_DEPTH = 40;
const MAX_REVISIONS = 32;
const profile = "pdf-raw-page-tree-v1";
type PdfValue = PdfNumber | PdfRef | PdfName | PdfValue[] | PdfDict | string | boolean | null;
type PdfDict = { [key: string]: PdfValue };
type PdfNumber = { type: "number"; raw: string };
type PdfRef = { type: "ref"; id: number; generation: number };
type PdfName = { type: "name"; value: string };
type XrefEntry = { type: 0 } | { type: 1; offset: number; generation: number }
  | { type: 2; streamId: number; index: number };
type Indirect = { id: number; generation: number; value: PdfValue; stream?: Buffer };
type Box = [number, number, number, number];
type RawBox = [string, string, string, string];

export interface RawPdfPageFrame {
  parserProfileId: typeof profile;
  sourceSha256: string;
  pdfPageNumber: number;
  mediaBox: Box;
  cropBox: Box;
  mediaBoxOperands: RawBox;
  cropBoxOperands: RawBox;
  rotate: 0 | 90 | 180 | 270;
  rotateOperand: string;
  pageObjectId: number;
  /** Object where effective inherited value was defined. */
  mediaBoxObjectId: number;
  cropBoxObjectId: number | null;
  rotateObjectId: number | null;
}

const numberToken = /^[-+]?(?:\d+\.?\d*|\.\d+)$/u;
const integerToken = /^(?:0|[1-9]\d*)$/u;
const isRef = (value: PdfValue | undefined): value is PdfRef =>
  !!value && typeof value === "object" && !Array.isArray(value) && value.type === "ref";
const isNumber = (value: PdfValue | undefined): value is PdfNumber =>
  !!value && typeof value === "object" && !Array.isArray(value) && value.type === "number";
const isName = (value: PdfValue | undefined, name?: string): value is PdfName =>
  !!value && typeof value === "object" && !Array.isArray(value)
    && value.type === "name" && (name === undefined || value.value === name);
function dict(value: PdfValue | undefined): PdfDict {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || "type" in value) throw new Error("PDF dictionary required");
  return value as PdfDict;
}
function unsigned(value: PdfValue | undefined, maximum = MAX_OBJECTS): number {
  if (!isNumber(value) || !integerToken.test(value.raw)) throw new Error("PDF unsigned integer required");
  const number = Number(value.raw);
  if (!Number.isSafeInteger(number) || number > maximum) throw new Error("PDF integer outside bounds");
  return number;
}
function reference(value: PdfValue | undefined): PdfRef {
  if (!isRef(value) || value.id < 1 || value.id > MAX_OBJECTS) {
    throw new Error("PDF indirect reference required");
  }
  return value;
}
function array(value: PdfValue | undefined): PdfValue[] {
  if (!Array.isArray(value)) throw new Error("PDF array required");
  return value;
}
function rawBox(value: PdfValue | undefined): { box: Box; operands: RawBox } {
  const parts = array(value);
  if (parts.length !== 4 || !parts.every(isNumber)) throw new Error("PDF box requires four direct numbers");
  const operands = parts.map((part) => part.raw) as RawBox;
  const box = operands.map(Number) as Box;
  if (box.some((part) => !Number.isFinite(part) || Math.abs(part) > 1_000_000)
    || box[2] <= box[0] || box[3] <= box[1]) throw new Error("invalid PDF page box");
  return { box, operands };
}
function whitespace(code: number): boolean {
  return code === 0 || code === 9 || code === 10 || code === 12 || code === 13 || code === 32;
}
function delimiter(code: number): boolean {
  return whitespace(code) || "()<>[]{}/%".includes(String.fromCharCode(code));
}

class Lexer {
  position: number;
  constructor(readonly source: string, position = 0, readonly limit = source.length) {
    this.position = position;
  }
  skip(): void {
    while (this.position < this.limit) {
      const code = this.source.charCodeAt(this.position);
      if (whitespace(code)) { this.position += 1; continue; }
      if (code === 37) { // comment
        while (this.position < this.limit && !"\r\n".includes(this.source[this.position])) this.position += 1;
        continue;
      }
      break;
    }
  }
  starts(token: string): boolean { this.skip(); return this.source.startsWith(token, this.position); }
  word(): string {
    this.skip();
    const first = this.position;
    while (this.position < this.limit && !delimiter(this.source.charCodeAt(this.position))) {
      this.position += 1;
      if (this.position - first > 1_000_000) throw new Error("PDF token too long");
    }
    if (first === this.position) throw new Error("PDF token expected");
    return this.source.slice(first, this.position);
  }
  name(): PdfName {
    this.position += 1;
    const first = this.position;
    while (this.position < this.limit && !delimiter(this.source.charCodeAt(this.position))) this.position += 1;
    const raw = this.source.slice(first, this.position);
    return { type: "name", value: raw.replace(/#([0-9a-fA-F]{2})/gu,
      (_match, hex: string) => String.fromCharCode(parseInt(hex, 16))) };
  }
  value(depth = 0): PdfValue {
    if (depth > MAX_DEPTH) throw new Error("PDF object nesting limit");
    this.skip();
    const ch = this.source[this.position];
    if (ch === "<" && this.source[this.position + 1] === "<") {
      this.position += 2;
      const result: PdfDict = Object.create(null);
      let count = 0;
      while (!this.starts(">>")) {
        if (++count > 10_000 || this.position >= this.limit || this.source[this.position] !== "/") {
          throw new Error("invalid PDF dictionary");
        }
        const key = this.name().value;
        if (Object.hasOwn(result, key)) throw new Error("duplicate PDF dictionary key");
        result[key] = this.value(depth + 1);
      }
      this.position += 2;
      return result;
    }
    if (ch === "[") {
      this.position += 1;
      const result: PdfValue[] = [];
      while (!this.starts("]")) {
        if (this.position >= this.limit || result.length > 100_000) throw new Error("invalid PDF array");
        result.push(this.value(depth + 1));
      }
      this.position += 1;
      return result;
    }
    if (ch === "/") return this.name();
    if (ch === "(") {
      const start = ++this.position;
      let level = 1;
      while (this.position < this.limit && level > 0) {
        const current = this.source[this.position++];
        if (current === "\\") this.position += 1;
        else if (current === "(") level += 1;
        else if (current === ")") level -= 1;
      }
      if (level !== 0) throw new Error("unterminated PDF string");
      return this.source.slice(start, this.position - 1);
    }
    if (ch === "<") {
      const end = this.source.indexOf(">", this.position + 1);
      if (end < 0 || end >= this.limit) throw new Error("unterminated PDF hex string");
      const result = this.source.slice(this.position + 1, end);
      this.position = end + 1;
      return result;
    }
    const token = this.word();
    if (numberToken.test(token)) {
      const first: PdfNumber = { type: "number", raw: token };
      if (integerToken.test(token)) {
        const afterFirst = this.position;
        try {
          const second = this.word();
          if (integerToken.test(second) && this.word() === "R") {
            const id = Number(token); const generation = Number(second);
            if (!Number.isSafeInteger(id) || id > MAX_OBJECTS
              || !Number.isSafeInteger(generation) || generation > 65535) {
              throw new Error("PDF reference outside bounds");
            }
            return { type: "ref", id, generation };
          }
        } catch { /* Numeric operands are valid at the end of an object. */ }
        this.position = afterFirst;
      }
      return first;
    }
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "null") return null;
    throw new Error(`unsupported PDF token ${token.slice(0, 24)}`);
  }
}

function decodeStream(body: Buffer, descriptor: PdfDict): Buffer {
  const filter = descriptor.Filter;
  if (!isName(filter, "FlateDecode") && filter !== undefined) {
    throw new Error("unsupported PDF stream filter");
  }
  let result = filter ? inflateSync(body, { maxOutputLength: MAX_DECODED_STREAM_BYTES }) : body;
  if (result.length > MAX_DECODED_STREAM_BYTES) throw new Error("decoded PDF stream too large");
  if (!descriptor.DecodeParms) return result;
  const parms = dict(descriptor.DecodeParms);
  const predictor = unsigned(parms.Predictor, 15);
  if (predictor === 1) return result;
  if (predictor < 10 || predictor > 15 || unsigned(parms.Colors ?? { type: "number", raw: "1" }, 4) !== 1
    || unsigned(parms.BitsPerComponent ?? { type: "number", raw: "8" }, 16) !== 8) {
    throw new Error("unsupported PDF stream predictor");
  }
  const columns = unsigned(parms.Columns, MAX_DECODED_STREAM_BYTES);
  if (columns < 1 || result.length % (columns + 1) !== 0) {
    throw new Error("invalid PDF predictor row width");
  }
  const rows = result.length / (columns + 1);
  const decoded = Buffer.alloc(rows * columns);
  for (let row = 0; row < rows; row += 1) {
    const base = row * (columns + 1);
    const kind = result[base];
    if (kind > 4) throw new Error("unsupported PNG predictor filter");
    for (let col = 0; col < columns; col += 1) {
      const left = col ? decoded[row * columns + col - 1] : 0;
      const up = row ? decoded[(row - 1) * columns + col] : 0;
      const upperLeft = row && col ? decoded[(row - 1) * columns + col - 1] : 0;
      let prediction = 0;
      if (kind === 1) prediction = left;
      if (kind === 2) prediction = up;
      if (kind === 3) prediction = Math.floor((left + up) / 2);
      if (kind === 4) {
        const estimate = left + up - upperLeft;
        const distances = [Math.abs(estimate - left), Math.abs(estimate - up),
          Math.abs(estimate - upperLeft)];
        prediction = distances[0] <= distances[1] && distances[0] <= distances[2]
          ? left : distances[1] <= distances[2] ? up : upperLeft;
      }
      decoded[row * columns + col] = (result[base + 1 + col] + prediction) & 255;
    }
  }
  result = decoded;
  return result;
}

class Reader {
  readonly text: string;
  readonly xref = new Map<number, XrefEntry>();
  readonly cache = new Map<number, Indirect>();
  readonly resolving = new Set<number>();
  root?: PdfRef;
  constructor(readonly bytes: Buffer) { this.text = bytes.toString("latin1"); }
  objectAt(offset: number): Indirect {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= this.text.length) {
      throw new Error("PDF object offset outside bounds");
    }
    const lexer = new Lexer(this.text, offset);
    const id = Number(lexer.word());
    const generation = Number(lexer.word());
    if (!Number.isSafeInteger(id) || id < 1 || id > MAX_OBJECTS
      || !Number.isSafeInteger(generation) || generation < 0 || generation > 65535
      || lexer.word() !== "obj") throw new Error("invalid PDF indirect object header");
    const value = lexer.value();
    if (lexer.starts("stream")) {
      lexer.position += 6;
      if (this.text.startsWith("\r\n", lexer.position)) lexer.position += 2;
      else if ("\r\n".includes(this.text[lexer.position])) lexer.position += 1;
      else throw new Error("invalid PDF stream separator");
      const descriptor = dict(value);
      const length = unsigned(descriptor.Length, MAX_PDF_BYTES);
      const end = lexer.position + length;
      if (end > this.bytes.length) throw new Error("PDF stream exceeds source");
      const stream = this.bytes.subarray(lexer.position, end);
      lexer.position = end;
      if (this.text.startsWith("\r\n", end)) lexer.position += 2;
      else if ("\r\n".includes(this.text[end])) lexer.position += 1;
      if (!lexer.starts("endstream")) throw new Error("invalid PDF stream length");
      lexer.position += 9;
      if (!lexer.starts("endobj")) throw new Error("unterminated PDF object");
      return { id, generation, value, stream };
    }
    if (!lexer.starts("endobj")) throw new Error("unterminated PDF object");
    return { id, generation, value };
  }
  loadXref(): void {
    const tail = this.text.slice(-2048);
    const matches = [...tail.matchAll(/startxref\s+(\d+)\s+%%EOF\s*/gu)];
    if (matches.length < 1 || !tail.endsWith(matches.at(-1)![0])) {
      throw new Error("PDF final startxref missing");
    }
    let current = Number(matches.at(-1)![1]);
    const visited = new Set<number>();
    for (let revision = 0; revision < MAX_REVISIONS; revision += 1) {
      if (visited.has(current)) throw new Error("PDF xref cycle");
      visited.add(current);
      const { trailer, entries } = this.xrefAt(current);
      if (trailer.Encrypt !== undefined) throw new Error("encrypted PDF unsupported");
      if (!this.root && trailer.Root !== undefined) this.root = reference(trailer.Root);
      if (trailer.XRefStm !== undefined) {
        const offset = unsigned(trailer.XRefStm, this.bytes.length - 1);
        if (visited.has(offset)) throw new Error("PDF hybrid xref cycle");
        visited.add(offset);
        const hybrid = this.xrefAt(offset);
        // In a hybrid-reference revision the supplementary xref stream carries
        // compressed-object entries. Older revisions must not override either.
        for (const [id, entry] of hybrid.entries) {
          const tableEntry = entries.get(id);
          if (!tableEntry || tableEntry.type === 0 && entry.type === 2) entries.set(id, entry);
          else if (entry.type !== 0 && JSON.stringify(entry) !== JSON.stringify(tableEntry)) {
            throw new Error("ambiguous hybrid PDF xref entry");
          }
        }
      }
      for (const [id, entry] of entries) if (!this.xref.has(id)) this.xref.set(id, entry);
      if (trailer.Prev === undefined) {
        if (!this.root) throw new Error("PDF root missing");
        return;
      }
      current = unsigned(trailer.Prev, this.bytes.length - 1);
    }
    throw new Error("PDF revision limit");
  }
  xrefAt(offset: number): { trailer: PdfDict; entries: Map<number, XrefEntry> } {
    const lexer = new Lexer(this.text, offset);
    const entries = new Map<number, XrefEntry>();
    if (lexer.starts("xref")) {
      lexer.position += 4;
      while (!lexer.starts("trailer")) {
        const first = Number(lexer.word()); const count = Number(lexer.word());
        if (!Number.isSafeInteger(first) || !Number.isSafeInteger(count)
          || first < 0 || count < 1 || first + count > MAX_OBJECTS) {
          throw new Error("PDF xref subsection outside bounds");
        }
        for (let index = 0; index < count; index += 1) {
          const objectOffset = Number(lexer.word());
          const generation = Number(lexer.word());
          const state = lexer.word();
          if (!Number.isSafeInteger(objectOffset) || !Number.isSafeInteger(generation)
            || generation > 65535 || (state !== "n" && state !== "f")
            || entries.has(first + index)) throw new Error("invalid PDF xref entry");
          entries.set(first + index, state === "n"
            ? { type: 1, offset: objectOffset, generation } : { type: 0 });
        }
      }
      lexer.position += 7;
      return { trailer: dict(lexer.value()), entries };
    }
    const indirect = this.objectAt(offset);
    const trailer = dict(indirect.value);
    if (!isName(trailer.Type, "XRef") || !indirect.stream) throw new Error("PDF xref stream required");
    const widths = array(trailer.W).map((value) => unsigned(value, 8));
    if (widths.length !== 3 || widths.reduce((sum, width) => sum + width, 0) < 1) {
      throw new Error("invalid PDF xref widths");
    }
    const size = unsigned(trailer.Size);
    const indices = trailer.Index === undefined ? [{ type: "number", raw: "0" },
      { type: "number", raw: String(size) }] as PdfValue[] : array(trailer.Index);
    if (indices.length < 2 || indices.length % 2 !== 0) throw new Error("invalid PDF xref index");
    const decoded = decodeStream(indirect.stream, trailer);
    const rowWidth = widths.reduce((sum, width) => sum + width, 0);
    let cursor = 0;
    for (let section = 0; section < indices.length; section += 2) {
      const first = unsigned(indices[section]); const count = unsigned(indices[section + 1]);
      if (first + count > size || first + count > MAX_OBJECTS) {
        throw new Error("PDF xref index outside bounds");
      }
      for (let index = 0; index < count; index += 1) {
        if (cursor + rowWidth > decoded.length || entries.has(first + index)) {
          throw new Error("invalid PDF xref stream length");
        }
        const values = widths.map((width, ordinal) => {
          let number = width === 0 && ordinal === 0 ? 1 : 0;
          for (let byte = 0; byte < width; byte += 1) number = number * 256 + decoded[cursor++];
          return number;
        });
        const [type, location, generationOrIndex] = values;
        if (!values.every(Number.isSafeInteger)) throw new Error("PDF xref value outside bounds");
        if (type === 0) entries.set(first + index, { type: 0 });
        else if (type === 1) entries.set(first + index,
          { type: 1, offset: location, generation: generationOrIndex });
        else if (type === 2) entries.set(first + index,
          { type: 2, streamId: location, index: generationOrIndex });
        else throw new Error("unsupported PDF xref entry type");
      }
    }
    if (cursor !== decoded.length) throw new Error("extra PDF xref stream bytes");
    return { trailer, entries };
  }
  object(id: number): Indirect {
    const cached = this.cache.get(id);
    if (cached) return cached;
    if (this.resolving.has(id)) throw new Error("cyclic compressed PDF object");
    this.resolving.add(id);
    try {
      return this.uncachedObject(id);
    } finally {
      this.resolving.delete(id);
    }
  }
  private uncachedObject(id: number): Indirect {
    const entry = this.xref.get(id);
    if (!entry || entry.type === 0) throw new Error("missing PDF object");
    let result: Indirect;
    if (entry.type === 1) {
      result = this.objectAt(entry.offset);
      if (result.id !== id || result.generation !== entry.generation) {
        throw new Error("PDF xref object mismatch");
      }
    } else {
      const container = this.object(entry.streamId);
      const descriptor = dict(container.value);
      if (!isName(descriptor.Type, "ObjStm") || !container.stream) {
        throw new Error("invalid PDF compressed object container");
      }
      const count = unsigned(descriptor.N, MAX_OBJECTS);
      const first = unsigned(descriptor.First, MAX_DECODED_STREAM_BYTES);
      const decoded = decodeStream(container.stream, descriptor);
      if (first >= decoded.length || entry.index >= count) {
        throw new Error("PDF compressed object outside bounds");
      }
      const source = decoded.toString("latin1");
      const header = new Lexer(source, 0, first);
      const ids: number[] = []; const offsets: number[] = [];
      for (let i = 0; i < count; i += 1) {
        ids.push(Number(header.word())); offsets.push(Number(header.word()));
      }
      if (ids[entry.index] !== id || offsets.some((offset) =>
        !Number.isSafeInteger(offset) || offset < 0 || first + offset >= decoded.length)
        || offsets.some((offset, index) => index > 0 && offset <= offsets[index - 1])) {
        throw new Error("PDF compressed object index mismatch");
      }
      const start = first + offsets[entry.index];
      const end = entry.index + 1 < count ? first + offsets[entry.index + 1] : decoded.length;
      const lexer = new Lexer(source, start, end);
      result = { id, generation: 0, value: lexer.value() };
      lexer.skip();
      if (lexer.position !== end) throw new Error("PDF compressed object has trailing bytes");
    }
    this.cache.set(id, result);
    return result;
  }
  referenced(ref: PdfRef): Indirect {
    const result = this.object(ref.id);
    if (result.generation !== ref.generation) throw new Error("PDF reference generation mismatch");
    return result;
  }
  dereference(value: PdfValue | undefined): PdfValue {
    let current = value;
    const seen = new Set<number>();
    while (isRef(current)) {
      if (seen.has(current.id)) throw new Error("cyclic PDF reference");
      seen.add(current.id);
      current = this.referenced(current).value;
    }
    if (current === undefined) throw new Error("missing PDF value");
    return current;
  }
}

/** Reads effective page geometry from original bytes. Unsupported syntax fails closed. */
export function readRawPdfPageFrame(sourceBytes: Buffer, pdfPageNumber: number): RawPdfPageFrame {
  if (!Buffer.isBuffer(sourceBytes) || sourceBytes.length < 20
    || sourceBytes.length > MAX_PDF_BYTES || sourceBytes.subarray(0, 5).toString() !== "%PDF-"
    || !Number.isSafeInteger(pdfPageNumber) || pdfPageNumber < 1
    || pdfPageNumber > MAX_PAGES) throw new Error("PDF page input outside bounds");
  const reader = new Reader(sourceBytes);
  reader.loadXref();
  const catalog = dict(reader.referenced(reference(reader.root)).value);
  if (!isName(catalog.Type, "Catalog")) throw new Error("PDF catalog required");
  const pages = reference(catalog.Pages);
  type Inherited = { media?: { box: Box; operands: RawBox; id: number };
    crop?: { box: Box; operands: RawBox; id: number };
    rotate?: { value: 0 | 90 | 180 | 270; operand: string; id: number } };
  const visited = new Set<number>();
  let ordinal = 0;
  let result: RawPdfPageFrame | undefined;
  function visit(ref: PdfRef, inherited: Inherited, depth: number): void {
    if (depth > MAX_DEPTH || visited.has(ref.id) || visited.size > MAX_PAGES * 2) {
      throw new Error("invalid PDF page tree");
    }
    visited.add(ref.id);
    const current = dict(reader.referenced(ref).value);
    const next = { ...inherited };
    if (current.MediaBox !== undefined) {
      next.media = { ...rawBox(reader.dereference(current.MediaBox)), id: ref.id };
    }
    if (current.CropBox !== undefined) {
      next.crop = { ...rawBox(reader.dereference(current.CropBox)), id: ref.id };
    }
    if (current.Rotate !== undefined) {
      const rotation = reader.dereference(current.Rotate);
      if (!isNumber(rotation) || !/^-?\d+$/u.test(rotation.raw)) {
        throw new Error("invalid PDF Rotate");
      }
      const angle = Number(rotation.raw);
      if (!Number.isSafeInteger(angle) || Math.abs(angle) > 3600 || angle % 90 !== 0) {
        throw new Error("unsupported PDF Rotate");
      }
      next.rotate = { value: ((angle % 360 + 360) % 360) as 0 | 90 | 180 | 270,
        operand: rotation.raw, id: ref.id };
    }
    if (isName(current.Type, "Pages")) {
      const kids = array(current.Kids);
      if (kids.length < 1 || kids.length > MAX_PAGES || unsigned(current.Count, MAX_PAGES) < kids.length) {
        throw new Error("invalid PDF page tree count");
      }
      for (const child of kids) visit(reference(child), next, depth + 1);
      return;
    }
    if (!isName(current.Type, "Page") || !next.media) {
      throw new Error("PDF page or inherited MediaBox missing");
    }
    // Geometry transforms use standard 1/72-inch PDF points. /UserUnit is a
    // page attribute, not inherited; a non-unit or indirect value changes the
    // physical scale and needs a separately versioned transform contract.
    if (current.UserUnit !== undefined
      && (!isNumber(current.UserUnit) || Number(current.UserUnit.raw) !== 1)) {
      throw new Error("unsupported PDF UserUnit");
    }
    ordinal += 1;
    if (ordinal !== pdfPageNumber) return;
    const crop = next.crop ?? next.media;
    const media = next.media;
    if (crop.box[0] < media.box[0] || crop.box[1] < media.box[1]
      || crop.box[2] > media.box[2] || crop.box[3] > media.box[3]) {
      throw new Error("PDF CropBox outside MediaBox");
    }
    result = { parserProfileId: profile,
      sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
      pdfPageNumber, mediaBox: media.box, cropBox: crop.box,
      mediaBoxOperands: media.operands, cropBoxOperands: crop.operands,
      rotate: next.rotate?.value ?? 0, rotateOperand: next.rotate?.operand ?? "0",
      pageObjectId: ref.id, mediaBoxObjectId: media.id,
      cropBoxObjectId: next.crop?.id ?? null, rotateObjectId: next.rotate?.id ?? null };
  }
  visit(pages, {}, 0);
  if (!result || ordinal !== unsigned(dict(reader.object(pages.id).value).Count, MAX_PAGES)) {
    throw new Error("PDF page number or page-tree count mismatch");
  }
  return result;
}
