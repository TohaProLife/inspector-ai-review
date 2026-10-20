/** Output-only v13 native admission draft. No provenance or eligibility authority. */
import { isProxy } from "node:util/types";
import { createHash } from "node:crypto";
import { MatrixReviewedLoaderV7ValidationError } from "./matrix-reviewed-loader-v7-native.js";

export class ConcreteWallNativeV13Error extends TypeError {
  constructor(readonly code: "INVALID_INPUT" | "INPUT_LIMIT") {
    super(code);
    this.name = "ConcreteWallNativeV13Error";
  }
}
type Limits = Readonly<{ bytes: number; nodes: number; depth: number }>;
const LEASE: Limits = Object.freeze({ bytes: 67_108_864, nodes: 4_500_018, depth: 69 });
const ORIGINS: Limits = Object.freeze({ bytes: 524_288, nodes: 200_000, depth: 64 });
const fail = (code: "INVALID_INPUT" | "INPUT_LIMIT"): never => {
  throw new ConcreteWallNativeV13Error(code);
};

/** Private limits. All native errors precede the final aggregate byte gate. */
function validateNative(value: unknown, limits: Limits): (item: object) => { array: boolean; keys: string[]; descriptors: PropertyDescriptorMap } {
  let nodes = 0, bytes = 0;
  const active = new Set<object>();
  const stringBytes = (item: string): number => {
    if (item.length > 4_000_000) fail("INPUT_LIMIT");
    let count = 0, size = 2, surrogate = false;
    for (const char of item) {
      if (++count > 2_000_000) fail("INPUT_LIMIT");
      const point = char.codePointAt(0)!;
      surrogate ||= point >= 0xd800 && point <= 0xdfff;
      size += point === 34 || point === 92 ? 2 : point < 32
        ? [8, 9, 10, 12, 13].includes(point) ? 2 : 6
        : point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    }
    if (surrogate) fail("INVALID_INPUT");
    return size;
  };
  const properties = (item: object): { array: boolean; keys: string[]; descriptors: PropertyDescriptorMap } => {
    if (isProxy(item)) fail("INVALID_INPUT");
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) fail("INVALID_INPUT");
    const descriptors = Object.getOwnPropertyDescriptors(item), names = Reflect.ownKeys(descriptors);
    if (names.some(key => typeof key !== "string" || /[^\x00-\x7f]/u.test(key))) fail("INVALID_INPUT");
    let keys: string[];
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0) fail("INVALID_INPUT");
      if (length > 32_768) fail("INPUT_LIMIT");
      if (names.length !== length + 1) fail("INVALID_INPUT");
      keys = Array.from({ length }, (_, index) => String(index));
    } else {
      if (names.length > 32_768) fail("INPUT_LIMIT");
      // ASCII keys: native sort equals code-point order.
      keys = (names as string[]).sort();
    }
    return { array, keys, descriptors };
  };
  const validate = (item: unknown, depth: number): void => {
    if (++nodes > limits.nodes || depth > limits.depth) fail("INPUT_LIMIT");
    if (item === null) { bytes += 4; return; }
    if (typeof item === "boolean") { bytes += item ? 4 : 5; return; }
    if (typeof item === "number") {
      if (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item))) fail("INVALID_INPUT");
      // Finite fractions allowed at native admission. No cross-language hash
      // identity claim for arbitrary fractional scalar representations.
      bytes += JSON.stringify(item).length;
      return;
    }
    if (typeof item === "string") { bytes += stringBytes(item); return; }
    if (typeof item !== "object" || item === null || isProxy(item) || active.has(item)) return fail("INVALID_INPUT");
    const { array, keys, descriptors } = properties(item);
    active.add(item);
    bytes += 2 + Math.max(0, keys.length - 1) + (array ? 0 : keys.length);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail("INVALID_INPUT");
      if (!array) validate(key, depth + 1);
      validate(descriptor.value, depth + 1);
    }
    active.delete(item);
  };
  validate(value, 0);
  if (bytes > limits.bytes) fail("INPUT_LIMIT");

  return properties;
}

function canonicalNative(value: unknown, limits: Limits): string {
  const properties = validateNative(value, limits);

  // Serialize only admitted data; no aggregate string for rejected huge input.
  // Explicit own descriptors avoid invoking inherited/custom JSON callbacks.
  const emit = (item: unknown): string => {
    if (item === null || typeof item !== "object") return JSON.stringify(item);
    const { array, keys, descriptors } = properties(item);
    const parts: string[] = [];
    for (const key of keys) parts.push(array ? emit(descriptors[key]!.value)
      : JSON.stringify(key) + ":" + emit(descriptors[key]!.value));
    return (array ? "[" : "{") + parts.join(",") + (array ? "]" : "}");
  };
  return emit(value);
}

/** Full lease first; no property read or callback before native admission. */
export function canonicalConcreteWallLeaseNativeV13(value: unknown): string {
  return canonicalNative(value, LEASE);
}

/** Same full lease canonical bytes, hashed without retaining an aggregate string. */
export function sha256CanonicalConcreteWallLeaseNativeV13(value: unknown): string {
  const properties = validateNative(value, LEASE);
  const hash = createHash("sha256");
  let chunks: string[] = [], length = 0;
  const flush = (): void => {
    if (chunks.length) { hash.update(chunks.join(""), "utf8"); chunks = []; length = 0; }
  };
  const write = (token: string): void => {
    if (token.length >= 65_536) { flush(); hash.update(token, "utf8"); }
    else { chunks.push(token); length += token.length; if (length >= 65_536) flush(); }
  };
  const emit = (item: unknown): void => {
    if (item === null || typeof item !== "object") { write(JSON.stringify(item)); return; }
    const { array, keys, descriptors } = properties(item);
    write(array ? "[" : "{");
    for (let index = 0; index < keys.length; index++) {
      if (index) write(",");
      const key = keys[index]!;
      if (!array) { write(JSON.stringify(key)); write(":"); }
      emit(descriptors[key]!.value);
    }
    write(array ? "]" : "}");
  };
  emit(value); flush();
  return hash.digest("hex");
}

/** Additional fixed origin subtree cap, before any closed origin DTO read. */
export function canonicalConcreteWallOriginsNativeV1(value: unknown): string {
  return canonicalNative(value, ORIGINS);
}

/** Fixed full native admission without allocating an unused canonical string. */
export function assertConcreteWallLeaseNativeV13(value: unknown): void {
  validateNative(value, LEASE);
}

/** Fixed origin subtree admission; identical native errors and policy. */
export function assertConcreteWallOriginsNativeV1(value: unknown): void {
  validateNative(value, ORIGINS);
}

/** Exact V7 integer/native canonical bytes and refusals, without a joined envelope. */
export function sha256CanonicalMatrixReviewedLoaderV7V13(input: unknown): string {
  const hash = createHash("sha256");
  let nodes = 0, bytes = 0, length = 0;
  let chunks: string[] = [];
  const active = new Set<object>();
  const reject = (code: "INVALID_INPUT" | "INPUT_LIMIT"): never => {
    throw new MatrixReviewedLoaderV7ValidationError(code);
  };
  const charge = (size: number): void => {
    bytes += size;
    if (bytes > 67_108_864) reject("INPUT_LIMIT");
  };
  const flush = (): void => {
    if (chunks.length) { hash.update(chunks.join(""), "utf8"); chunks = []; length = 0; }
  };
  const write = (token: string): void => {
    if (token.length >= 65_536) { flush(); hash.update(token, "utf8"); }
    else { chunks.push(token); length += token.length; if (length >= 65_536) flush(); }
  };
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 4_500_018 || depth > 69) reject("INPUT_LIMIT");
    if (value === null) { charge(4); write("null"); return; }
    if (typeof value === "boolean") { charge(value ? 4 : 5); write(String(value)); return; }
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) reject("INVALID_INPUT");
      const result = String(value); charge(result.length); write(result); return;
    }
    if (typeof value === "string") {
      if (value.length > 4_000_000) reject("INPUT_LIMIT");
      let count = 0;
      for (const char of value) {
        if (++count > 2_000_000) reject("INPUT_LIMIT");
        const point = char.codePointAt(0)!;
        if (point >= 0xd800 && point <= 0xdfff) reject("INVALID_INPUT");
      }
      const result = JSON.stringify(value);
      charge(Buffer.byteLength(result, "utf8")); write(result); return;
    }
    if (typeof value !== "object" || !value || isProxy(value) || active.has(value)) return reject("INVALID_INPUT");
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) reject("INVALID_INPUT");
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
    if (names.some(key => typeof key !== "string" || /[^\x00-\x7f]/u.test(key))) reject("INVALID_INPUT");
    let keys: string[];
    if (array) {
      const size = descriptors.length?.value;
      if (!Number.isSafeInteger(size) || size < 0) reject("INVALID_INPUT");
      if (size > 32_768) reject("INPUT_LIMIT");
      if (names.length !== size + 1) reject("INVALID_INPUT");
      keys = Array.from({ length: size }, (_, index) => String(index));
    } else {
      if (names.length > 32_768) reject("INPUT_LIMIT");
      // Only ASCII keys were admitted, so this is exactly V7 code-point order.
      keys = (names as string[]).sort();
    }
    active.add(value);
    charge(2 + Math.max(0, keys.length - 1) + (array ? 0 : keys.length));
    write(array ? "[" : "{");
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]!, property = descriptors[key];
      if (!property?.enumerable || !Object.hasOwn(property, "value")) reject("INVALID_INPUT");
      if (index) write(",");
      if (!array) { visit(key, depth + 1); write(":"); }
      visit(property.value, depth + 1);
    }
    active.delete(value);
    write(array ? "]" : "}");
  };
  visit(input, 0); flush();
  return hash.digest("hex");
}

/** Exact portable typed-tree SHA for a fully admitted native lease, without a tagged-tree copy. */
export function sha256PortableEvidenceNativeV13(value: unknown): string {
  assertConcreteWallLeaseNativeV13(value);
  const hash = createHash("sha256"), numberBytes = Buffer.allocUnsafe(8);
  let chunks: string[] = [], length = 0;
  const flush = (): void => {
    if (chunks.length) { hash.update(chunks.join(""), "utf8"); chunks = []; length = 0; }
  };
  const write = (token: string): void => {
    if (token.length >= 65_536) { flush(); hash.update(token, "utf8"); }
    else { chunks.push(token); length += token.length; if (length >= 65_536) flush(); }
  };
  const emit = (item: unknown): void => {
    if (typeof item === "number") {
      numberBytes.writeDoubleBE(item, 0);
      write('["$number","'); write(numberBytes.toString("hex")); write('"]');
      return;
    }
    if (item === null || typeof item !== "object") { write(JSON.stringify(item)); return; }
    // Admission already checked the complete graph. Read only own data descriptors;
    // no getters, iterators, toJSON, input callbacks or intermediate portable graph.
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Array.isArray(item)) {
      write('["$array",[');
      const size = descriptors.length!.value as number;
      for (let index = 0; index < size; index++) {
        if (index) write(",");
        emit(descriptors[String(index)]!.value);
      }
    } else {
      const keys = Object.keys(descriptors).sort((left, right) =>
        Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
      write('["$object",[');
      for (let index = 0; index < keys.length; index++) {
        if (index) write(",");
        const key = keys[index]!;
        write("["); write(JSON.stringify(key)); write(",");
        emit(descriptors[key]!.value); write("]");
      }
    }
    write("]]");
  };
  emit(value); flush();
  return hash.digest("hex");
}
