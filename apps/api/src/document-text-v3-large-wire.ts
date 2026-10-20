import { isProxy } from 'node:util/types';

/** Fixed transport for the explicit large source audit only. Legacy completion is unchanged. */
export type DocumentTextV3LargeCompletionRead =
  | { status: 'VALID'; value: Record<string, unknown>; canonical: string }
  | { status: 'ABSTAIN'; reasonCode: 'INVALID_INPUT' | 'INPUT_LIMIT' };
const WIRE_BYTES = 33_554_432, RESULT_BYTES = 32_000_000;
const MAX_NODES = 1_500_000, MAX_DEPTH = 68, MAX_CONTAINER = 32_768, MAX_STRING = 2_000_000;
class Invalid extends Error {}
class Limit extends Error {}
function invalid(): never { throw new Invalid(); }
function limit(): never { throw new Limit(); }
function scalar(text: string): void {
  if (text.length > MAX_STRING * 2) limit();
  let count = 0;
  for (const c of text) {
    if (++count > MAX_STRING) limit();
    const cp = c.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) invalid();
  }
}
function compare(a: string, b: string): number {
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i)!, y = b.codePointAt(j)!;
    if (x !== y) return x - y;
    i += x > 0xffff ? 2 : 1; j += y > 0xffff ? 2 : 1;
  }
  return a.length - b.length;
}
function failure(error: unknown): DocumentTextV3LargeCompletionRead {
  return { status: 'ABSTAIN', reasonCode: error instanceof Limit ? 'INPUT_LIMIT' : 'INVALID_INPUT' };
}

/** Read only own data descriptors. Build canonical bytes before creating a detached snapshot. */
export function normalizeDocumentTextV3LargeCompletion(input: unknown): DocumentTextV3LargeCompletionRead {
  try {
    let nodes = 0, scalarBytes = 0, resultBytes: number | undefined;
    const ancestors = new Set<object>();
    function visit(value: unknown, depth: number): string {
      if (++nodes > MAX_NODES || depth > MAX_DEPTH) limit();
      if (value === null) return 'null';
      if (typeof value === 'boolean') return value ? 'true' : 'false';
      if (typeof value === 'number') { if (!Number.isSafeInteger(value)) invalid(); return String(value); }
      if (typeof value === 'string') {
        scalar(value);
        scalarBytes += Buffer.byteLength(value, 'utf8');
        if (scalarBytes > WIRE_BYTES) limit();
        return JSON.stringify(value);
      }
      if (!value || typeof value !== 'object' || isProxy(value) || ancestors.has(value)) invalid();
      const array = Array.isArray(value);
      if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) invalid();
      const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
      if (names.some(name => typeof name !== 'string')) invalid();
      let keys: string[];
      if (array) {
        const length: unknown = descriptors.length?.value;
        if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) invalid();
        if (length > MAX_CONTAINER) limit();
        if (names.length !== length + 1) invalid();
        keys = Array.from({ length }, (_, i) => String(i));
      } else {
        if (names.length > MAX_CONTAINER) limit();
        keys = (names as string[]).sort(compare);
      }
      ancestors.add(value);
      const parts: string[] = [];
      for (const key of keys) {
        const d = descriptors[key];
        if (!d?.enumerable || !Object.hasOwn(d, 'value')) invalid();
        const encodedKey = array ? '' : visit(key, depth + 1);
        const encoded = visit(d.value, depth + 1);
        if (depth === 0 && key === 'result') resultBytes = Buffer.byteLength(encoded, 'utf8');
        parts.push(array ? encoded : `${encodedKey}:${encoded}`);
      }
      ancestors.delete(value);
      return array ? `[${parts.join(',')}]` : `{${parts.join(',')}}`;
    }
    const canonical = visit(input, 0);
    if (Buffer.byteLength(canonical, 'utf8') > WIRE_BYTES || (resultBytes ?? 0) > RESULT_BYTES) limit();
    const value: unknown = JSON.parse(canonical);
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 3 || !['attemptId', 'fencingToken', 'result'].every(key => Object.hasOwn(record, key))
      || typeof record.attemptId !== 'string' || Array.from(record.attemptId).length < 1 || Array.from(record.attemptId).length > 200
      || typeof record.fencingToken !== 'number' || !Number.isSafeInteger(record.fencingToken) || record.fencingToken < 1
      || !record.result || typeof record.result !== 'object' || Array.isArray(record.result)) invalid();
    return { status: 'VALID', value: record, canonical };
  } catch (error) { return failure(error); }
}

/** Lexical guard retains duplicate decoded keys and integer token identity before JSON.parse. */
export function parseDocumentTextV3LargeCompletion(raw: Buffer): DocumentTextV3LargeCompletionRead {
  try {
    if (isProxy(raw) || !Buffer.isBuffer(raw) || Object.getPrototypeOf(raw) !== Buffer.prototype
      || Object.hasOwn(raw, 'length')) invalid();
    if (raw.length > WIRE_BYTES) limit();
    // ignoreBOM=true preserves a BOM as a character, so the grammar rejects it.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
    let offset = 0, nodes = 0;
    const whitespace = () => { while (offset < text.length && /[\x20\x09\x0a\x0d]/.test(text[offset]!)) offset++; };
    const count = (depth: number) => { if (++nodes > MAX_NODES || depth > MAX_DEPTH) limit(); };
    const string = (): string => {
      const start = offset;
      if (text[offset++] !== '"') invalid();
      while (offset < text.length) {
        const c = text[offset++];
        if (c === '\\') { offset++; continue; }
        if (c === '"') {
          const value: unknown = JSON.parse(text.slice(start, offset));
          if (typeof value !== 'string') invalid(); scalar(value); return value;
        }
      }
      return invalid();
    };
    const integer = /-?(?:0|[1-9][0-9]*)/y;
    function visit(depth: number): void {
      count(depth); whitespace();
      const c = text[offset];
      if (c === '{') {
        offset++; whitespace();
        if (text[offset] === '}') { offset++; return; }
        const keys = new Set<string>();
        while (true) {
          whitespace(); count(depth + 1); const key = string();
          if (keys.has(key)) invalid(); keys.add(key);
          if (keys.size > MAX_CONTAINER) limit();
          whitespace(); if (text[offset++] !== ':') invalid(); visit(depth + 1); whitespace();
          const end = text[offset++]; if (end === '}') return; if (end !== ',') invalid();
        }
      }
      if (c === '[') {
        offset++; whitespace(); if (text[offset] === ']') { offset++; return; }
        let length = 0;
        while (true) {
          if (++length > MAX_CONTAINER) limit(); visit(depth + 1); whitespace();
          const end = text[offset++]; if (end === ']') return; if (end !== ',') invalid();
        }
      }
      if (c === '"') { string(); return; }
      for (const literal of ['null', 'true', 'false']) if (text.startsWith(literal, offset)) { offset += literal.length; return; }
      integer.lastIndex = offset; const token = integer.exec(text);
      if (!token || !Number.isSafeInteger(Number(token[0]))) invalid();
      offset = integer.lastIndex;
    }
    visit(0); whitespace(); if (offset !== text.length) invalid();
    return normalizeDocumentTextV3LargeCompletion(JSON.parse(text));
  } catch (error) { return failure(error); }
}
