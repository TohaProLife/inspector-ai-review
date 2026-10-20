import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import { matrixInventoryScopeInputSchema as scopeInput, matrixInventoryScopeDecisionSchema as scopeDecision,
  INVENTORY_REVIEW_LIMITS, type MatrixInventoryScopeInput, type MatrixInventoryScopeDecision } from "@inspector-ai/contracts";
import { canonicalSourceDeclarationJson } from "./matrix-source-declarations.js";
const scalar = (s:string) => {for(const c of s){const n=c.codePointAt(0)!;if(n>=0xd800&&n<=0xdfff)return false;}return true;};
export class InventoryReviewValidationError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "INPUT_LIMIT" | "DUPLICATE_INVENTORY"
    | "SNAPSHOT_MISMATCH" | "INVENTORY_INCOMPLETE", message: string) { super(message); }
}
function invalid(message: string): never { throw new InventoryReviewValidationError("INVALID_INPUT", message); }
function limit(): never { throw new InventoryReviewValidationError("INPUT_LIMIT", "Inventory review exceeds bounded JSON limits"); }

/** Node-only preflight MUST run before Zod/traversal/stringification. No getters. */
export function assertInventoryReviewNative(input: unknown, mode: "REQUEST" | "MATERIALIZED" = "REQUEST"): void {
  // One TOTAL envelope budget, never a per-claim budget multiplied by16.
  const byteLimit = mode === "REQUEST" ? INVENTORY_REVIEW_LIMITS.requestBytes : INVENTORY_REVIEW_LIMITS.materializedBytes;
  let nodes = 0, bytes = 0; const parents = new Set<object>();
  function visit(value: unknown, depth: number): void {
    if (++nodes > INVENTORY_REVIEW_LIMITS.nodes || depth > INVENTORY_REVIEW_LIMITS.depth) limit();
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "number") { if (!Number.isSafeInteger(value)) invalid("Unsafe/fractional number"); return; }
    if (typeof value === "string") {
      if (value.length > byteLimit) limit();
      if (!scalar(value)) invalid("Unicode scalar required");
      bytes += Buffer.byteLength(value, "utf8");
      if (bytes > byteLimit) limit();
      return;
    }
    if (!value || typeof value !== "object" || isProxy(value) || parents.has(value)) invalid("Plain acyclic data required");
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (prototype !== (array ? Array.prototype : Object.prototype)) invalid("Custom prototype rejected");
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
    if (names.some(name => typeof name !== "string")) invalid("Symbol rejected");
    let keys: string[];
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0) invalid("Invalid array length");
      if (length > INVENTORY_REVIEW_LIMITS.containerItems) limit();
      if (names.length !== length + 1) invalid("Sparse/extra array properties rejected");
      keys = Array.from({ length }, (_, i) => String(i));
    } else {
      if (names.length > INVENTORY_REVIEW_LIMITS.containerItems) limit();
      keys = names as string[];
    }
    parents.add(value);
    for (const name of keys) {
      const d = descriptors[name];
      if (!d || !d.enumerable || !Object.hasOwn(d, "value")) invalid("Accessor/non-enumerable property rejected");
      if (!array) visit(name, depth + 1);
      visit(d.value, depth + 1);
    }
    parents.delete(value);
  }
  visit(input, 0);
  // Count JSON punctuation/escaping as well as scalar bytes; do this only after native validation.
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > byteLimit) limit();
}
/** Call on the COMPLETE normalized parent source-review hash body, not just its
 * inventory sibling, before canonical hash/INSERT. Includes all16 claims and
 * matrixScope/basis/status/actor/object/source overhead in the same8MB ceiling.
 */
export function assertMaterializedSourceReviewEnvelope(parentReviewHashBody: unknown): void {
  assertInventoryReviewNative(parentReviewHashBody, "MATERIALIZED");
}
function noDuplicates(scope: MatrixInventoryScopeInput | MatrixInventoryScopeDecision): void {
  const seen = new Set<string>();
  for (const c of scope.claims) {
    // Same immutable inventory cannot acquire two identities via different origin checks.
    if (seen.has(c.target.inventoryContentHash))
      throw new InventoryReviewValidationError("DUPLICATE_INVENTORY", "Inventory is claimed more than once");
    seen.add(c.target.inventoryContentHash);
  }
}
export function parseInventoryScopeInput(raw: unknown): MatrixInventoryScopeInput {
  assertInventoryReviewNative(raw);
  const parsed = scopeInput.safeParse(raw);
  if (!parsed.success) invalid("Invalid inventory request shape");
  noDuplicates(parsed.data); return parsed.data;
}
/** Structural + internal hash consistency only; does not replace authorized source reconstruction. */
export function parseInventoryScopeDecision(raw: unknown): MatrixInventoryScopeDecision {
  assertInventoryReviewNative(raw, "MATERIALIZED");
  const parsed = scopeDecision.safeParse(raw);
  if (!parsed.success) invalid("Invalid materialized inventory shape");
  noDuplicates(parsed.data);
  for (const c of parsed.data.claims) {
    const s = c.inventorySnapshot;
    const h = createHash("sha256").update(canonicalSourceDeclarationJson({
      hashDomain: "matrix-inventory-source-id-v1", inventory: s })).digest("hex");
    if (h !== c.target.inventoryContentHash || s.textArtifactHash !== c.target.textArtifactHash
      || canonicalSourceDeclarationJson(c.selection) !== canonicalSourceDeclarationJson({
        pageNumber: s.pageNumber, regionBoxMilliPoints: s.regionBoxMilliPoints,
        headerFragments: s.headerFragments, scopeFragments: s.scopeFragments }))
      throw new InventoryReviewValidationError("SNAPSHOT_MISMATCH", "Materialized inventory/target selection mismatch");
    if (c.assertion === "HUMAN_ASSERTED_COMPLETE" && (!s.featureRows.length || s.unresolvedRows.length))
      throw new InventoryReviewValidationError("INVENTORY_INCOMPLETE", "Nonempty unresolved-free inventory required");
  }
  return parsed.data;
}
/** Absence stays absent: old source-review hashes must not gain null/default inventory fields. */
export function inventoryScopeHashFields(scope: MatrixInventoryScopeDecision | undefined):
  { inventoryScope: MatrixInventoryScopeDecision } | Record<string, never> {
  return scope === undefined ? {} : { inventoryScope: scope };
}

/** Bounded lexical JSON guard before framework parsing loses duplicate member names.
 * Scoped to inventory/source-review endpoints; legacy global JSON parser remains unchanged. */
export function validateInventoryReviewJsonBytes(bytes:Buffer):void {
  if(bytes.length>INVENTORY_REVIEW_LIMITS.requestBytes)limit();
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{invalid('Invalid UTF-8 JSON');}
  let i=0,nodes=0;
  const ws=()=>{while(i<text.length&&/[\x20\x09\x0a\x0d]/.test(text[i]!))i++;};
  const string=():string=>{const begin=i;if(text[i++]!=='"')invalid('JSON string required');
    while(i<text.length){const c=text[i++];if(c==='\\'){i++;continue;}if(c==='"'){
      try{const value=JSON.parse(text.slice(begin,i));if(!scalar(value))invalid('Unicode scalar required');return value;}catch{invalid('Invalid JSON string');}
    }}return invalid('Unterminated JSON string');};
  function value(depth:number):void{
    if(depth>INVENTORY_REVIEW_LIMITS.depth||++nodes>INVENTORY_REVIEW_LIMITS.nodes)limit();ws();const c=text[i];
    if(c==='{'){i++;ws();const keys=new Set<string>();if(text[i]==='}'){i++;return;}
      while(true){ws();const key=string();if(keys.has(key))invalid('Duplicate JSON object key');keys.add(key);
        if(keys.size>INVENTORY_REVIEW_LIMITS.containerItems)limit();ws();if(text[i++]!==':')invalid('JSON colon required');value(depth+1);ws();
        const end=text[i++];if(end==='}')return;if(end!==',')invalid('JSON object delimiter required');}}
    if(c==='['){i++;ws();let length=0;if(text[i]===']'){i++;return;}while(true){if(++length>INVENTORY_REVIEW_LIMITS.containerItems)limit();value(depth+1);ws();const end=text[i++];if(end===']')return;if(end!==',')invalid('JSON array delimiter required');}}
    if(c==='"'){string();return;}
    for(const literal of ['true','false','null'])if(text.startsWith(literal,i)){i+=literal.length;return;}
    const number=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(i));
    if(!number)invalid('Invalid JSON value');if(!Number.isSafeInteger(Number(number[0])))invalid('Unsafe/fractional number');i+=number[0].length;
  }
  value(0);ws();if(i!==text.length)invalid('Trailing JSON content');
}
