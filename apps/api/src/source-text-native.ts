import { isProxy } from "node:util/types";

/** Full authenticated source artifacts have a separate read budget from review commands. */
export const SOURCE_TEXT_READ_LIMITS = Object.freeze({ bytes: 8_000_000, nodes: 1_000_000, depth: 64, containerItems: 32768 });
export function assertSourceTextNative(input: unknown): void {
  let nodes = 0, bytes = 0;
  const ancestors = new Set<object>();
  function invalid(): never { throw new TypeError("Source text must be plain acyclic integer JSON"); }
  function limit(): never { throw new RangeError("Source text exceeds bounded read limits"); }
  function visit(value: unknown, depth: number): void {
    if (++nodes > SOURCE_TEXT_READ_LIMITS.nodes || depth > SOURCE_TEXT_READ_LIMITS.depth) limit();
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "number") { if (!Number.isSafeInteger(value)) invalid(); return; }
    if (typeof value === "string") {
      if (value.length > SOURCE_TEXT_READ_LIMITS.bytes) limit();
      for (const character of value) { const n = character.codePointAt(0)!; if (n >= 0xd800 && n <= 0xdfff) invalid(); }
      bytes += Buffer.byteLength(value, "utf8"); if (bytes > SOURCE_TEXT_READ_LIMITS.bytes) limit(); return;
    }
    if (!value || typeof value !== "object" || isProxy(value) || ancestors.has(value)) invalid();
    const array = Array.isArray(value);
    if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
    if (names.some(name => typeof name !== "string")) invalid();
    let keys: string[];
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0) invalid();
      if (length > SOURCE_TEXT_READ_LIMITS.containerItems) limit();
      if (names.length !== length + 1) invalid();
      keys = Array.from({ length }, (_, i) => String(i));
    } else {
      if (names.length > SOURCE_TEXT_READ_LIMITS.containerItems) limit();
      keys = names as string[];
    }
    ancestors.add(value);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) invalid();
      if (!array) visit(key, depth + 1);
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
  }
  visit(input, 0);
  // Serialization is safe only after native validation; escaped bytes count too.
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > SOURCE_TEXT_READ_LIMITS.bytes) limit();
}
