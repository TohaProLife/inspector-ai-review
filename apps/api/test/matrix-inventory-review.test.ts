import { it as test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { SourceInventory, InventorySelection } from "../src/matrix-inventory-source.js";
import { canonicalSourceDeclarationJson } from "../src/matrix-source-declarations.js";
import { canonicalJson } from "../src/canonical-json.js";
import { INVENTORY_REVIEW_VERSION, inventoryScopeDecisionToInput,
 type MatrixInventoryScopeInput,type MatrixInventoryScopeDecision,type MatrixSourceInventory } from "@inspector-ai/contracts";
import { parseInventoryScopeInput,parseInventoryScopeDecision,inventoryScopeHashFields,assertInventoryReviewNative,
 InventoryReviewValidationError,assertMaterializedSourceReviewEnvelope } from "../src/matrix-inventory-review.js";

const fixture = JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/matrix-inventory-v1/portable-goldens.json", import.meta.url), "utf8"));
const clone = <T>(v: T): T => structuredClone(v);
const hash = (inventory: unknown) => createHash("sha256").update(canonicalSourceDeclarationJson({
  hashDomain: "matrix-inventory-source-id-v1", inventory })).digest("hex");
const source = (name = "pd-both"): MatrixSourceInventory => clone(fixture.fixtures.find((f: any) => f.name === name).expected.inventory);
function scope(name = "pd-both", assertion: "UNKNOWN" | "HUMAN_ASSERTED_COMPLETE" = "UNKNOWN"): MatrixInventoryScopeDecision {
  const inventorySnapshot = source(name);
  const selection = { pageNumber: inventorySnapshot.pageNumber,
    regionBoxMilliPoints: clone(inventorySnapshot.regionBoxMilliPoints),
    headerFragments: clone(inventorySnapshot.headerFragments), scopeFragments: clone(inventorySnapshot.scopeFragments) };
  // Structural compile-time checks against root's staged pure result, without executing its algorithm.
  const compatibleInventory: SourceInventory = inventorySnapshot;
  const compatibleSelection: InventorySelection = selection;
  void compatibleInventory; void compatibleSelection;
  return { schemaVersion: INVENTORY_REVIEW_VERSION, claims: [{
    target: { checkId: "CHK-SYNTHETIC", inputManifestHash: "a".repeat(64), textStageContentHash: "b".repeat(64),
      textArtifactHash: inventorySnapshot.textArtifactHash, inventoryContentHash: hash(inventorySnapshot) },
    selection, entityKey: "joint-1", componentRole: "PARTITION_SLAB_JOINT", componentKey: "partition-1",
    zoneKey: "zone-1", operatingModeKey: "DECLARED_NOISE_PROTECTION_MEASURES",
    measurementBasisKey: "SOURCE_AUTHORED_MEASURE_MEMBERSHIP", assertion, reference: "Проверены исходные строки", inventorySnapshot,
  }] };
}
function request(materialized = scope()): MatrixInventoryScopeInput {
  return { schemaVersion: materialized.schemaVersion, claims: materialized.claims.map(({ inventorySnapshot: _s, ...rest }) => rest) };
}
const rejectInput = (mutate: (v: any) => void) => {
  const v = request(); mutate(v); assert.throws(() => parseInventoryScopeInput(v));
};
const rejectDecision = (mutate: (v: any) => void, code?: string) => {
  const v = scope(); mutate(v);
  assert.throws(() => parseInventoryScopeDecision(v), (e: unknown) => e instanceof InventoryReviewValidationError && (!code || e.code === code));
};
test("valid input does not acquire trusted snapshot", () => assert.deepEqual(parseInventoryScopeInput(request()), request()));
test("valid complete nonempty decision", () => assert.equal(parseInventoryScopeDecision(scope("pd-both", "HUMAN_ASSERTED_COMPLETE")).claims.length, 1));
for (const f of fixture.fixtures) {
  test(`original synthetic UNKNOWN snapshot ${f.name}`, () => assert.deepEqual(parseInventoryScopeDecision(scope(f.name)), scope(f.name)));
  const complete = scope(f.name, "HUMAN_ASSERTED_COMPLETE"), inventory = complete.claims[0].inventorySnapshot;
  test(`human completeness follows nonempty unresolved gate ${f.name}`, () => {
    if (inventory.featureRows.length && !inventory.unresolvedRows.length) assert.doesNotThrow(() => parseInventoryScopeDecision(complete));
    else assert.throws(() => parseInventoryScopeDecision(complete), (e: unknown) => e instanceof InventoryReviewValidationError && e.code === "INVENTORY_INCOMPLETE");
  });
}
test("[] explicit withdrawal accepted both DTOs", () => {
  const empty = {schemaVersion: INVENTORY_REVIEW_VERSION, claims: []};
  assert.deepEqual(parseInventoryScopeInput(empty), empty); assert.deepEqual(parseInventoryScopeDecision(empty), empty);
});
for (const field of ["inventorySnapshot", "actorId", "contentHash", "reviewContentHash", "decisionId", "complete", "confidence", "probability", "ruleId", "parameterCode"]) {
  test(`reject request claim server/invented field ${field}`, () => rejectInput(v => { v.claims[0][field] = "forged"; }));
}
for (const at of ["top", "target", "selection", "fragment"]) test(`strict unknown keys ${at}`, () => rejectInput(v => {
  (at === "top" ? v : at === "target" ? v.claims[0].target : at === "selection" ? v.claims[0].selection : v.claims[0].selection.headerFragments[0]).extra = true;
}));
test("16 distinct claims allowed", () => {
  const v = request(); v.claims = Array.from({length: 16}, (_, i) => {
    const c = clone(v.claims[0]); c.target.inventoryContentHash = i.toString(16).padStart(64, "0"); return c;
  }); assert.equal(parseInventoryScopeInput(v).claims.length, 16);
});
test("17 claims rejected", () => rejectInput(v => { v.claims = Array.from({length:17}, () => clone(v.claims[0])); }));
test("same inventory with different identity/origin rejected", () => rejectInput(v => {
  const c = clone(v.claims[0]); c.entityKey = "other"; c.target.checkId = "CHK-OTHER"; v.claims.push(c);
}));
test("reference minimum8 and maximum1000 codepoints", () => {
  for (const s of ["я".repeat(8), "😀".repeat(1000)]) { const v = request(); v.claims[0].reference = s; assert.equal(parseInventoryScopeInput(v).claims[0].reference, s); }
});
for (const value of ["я".repeat(7), "😀".repeat(1001), " пробелы", "пробелы ", "\u0085описание", "описание\u001c"]) {
  test(`invalid reference ${JSON.stringify(value).slice(0,25)}`, () => rejectInput(v => { v.claims[0].reference = value; }));
}
test("BOM unchanged by Python-strip reference policy", () => { const v = request(); v.claims[0].reference = "\ufeffописание"; assert.equal(parseInventoryScopeInput(v).claims[0].reference, v.claims[0].reference); });
for (const field of ["entityKey", "componentKey", "zoneKey"]) {
  test(`identity controls and codepoint cap ${field}`, () => {
    rejectInput(v => {v.claims[0][field] = "a\nidentity";}); rejectInput(v => {v.claims[0][field] = "😀".repeat(201);});
    const v: any = request(); v.claims[0][field] = "😀".repeat(200); assert.doesNotThrow(() => parseInventoryScopeInput(v));
  });
}
for (const field of ["componentRole", "operatingModeKey", "measurementBasisKey", "assertion"]) test(`fixed enum ${field}`, () => rejectInput(v => {v.claims[0][field] = "VERIFIED";}));
for (const mutation of ["missing", "unsafe", "fraction", "wrongpage", "zeroarea", "outside", "twoanchors", "newline"]) {
  test(`selection attack ${mutation}`, () => rejectInput(v => {
    const s = v.claims[0].selection;
    if (mutation === "missing") delete s.scopeFragments;
    if (mutation === "unsafe") s.pageNumber = Number.MAX_SAFE_INTEGER + 1;
    if (mutation === "fraction") s.headerFragments[0].bboxMilliPoints[0] += 0.5;
    if (mutation === "wrongpage") s.headerFragments[0].pageNumber++;
    if (mutation === "zeroarea") s.regionBoxMilliPoints[2] = s.regionBoxMilliPoints[0];
    if (mutation === "outside") s.headerFragments[0].bboxMilliPoints[0] = 0;
    if (mutation === "twoanchors") s.headerFragments.push(clone(s.headerFragments[0]));
    if (mutation === "newline") s.headerFragments[0].rawText += "\nextra";
  }));
}
test("decision target portable content mismatch", () => rejectDecision(v => {v.claims[0].inventorySnapshot.featureRows.pop();}, "SNAPSHOT_MISMATCH"));
test("decision fullartifact mismatch", () => rejectDecision(v => {v.claims[0].target.textArtifactHash = "f".repeat(64);}, "SNAPSHOT_MISMATCH"));
test("decision selection tamper", () => rejectDecision(v => {v.claims[0].selection.regionBoxMilliPoints[0]--;}, "SNAPSHOT_MISMATCH"));
test("decision source stage unknown rejected", () => rejectDecision(v => {v.claims[0].inventorySnapshot.stage = "UNRESOLVED";}));
test("decision extra confidence rejected", () => rejectDecision(v => {v.claims[0].inventorySnapshot.confidence = 1;}));
test("original raw whitespace retained in UNKNOWN shape (source auth separate)", () => {
  const v = scope(); v.claims[0].inventorySnapshot.featureRows[0].fragments[0].rawText += " ";
  v.claims[0].target.inventoryContentHash = hash(v.claims[0].inventorySnapshot);
  assert.equal(parseInventoryScopeDecision(v).claims[0].inventorySnapshot.featureRows[0].fragments[0].rawText.endsWith(" "), true);
});
test("input immutable", () => { const v = request(), before = canonicalSourceDeclarationJson(v); parseInventoryScopeInput(v); assert.equal(canonicalSourceDeclarationJson(v), before); });
test("decision immutable", () => { const v = scope(), before = canonicalSourceDeclarationJson(v); parseInventoryScopeDecision(v); assert.equal(canonicalSourceDeclarationJson(v), before); });
test("editor preserve projection strips server snapshot only", () => {
  const saved = scope("pd-both", "HUMAN_ASSERTED_COMPLETE"), before = canonicalSourceDeclarationJson(saved);
  assert.deepEqual(inventoryScopeDecisionToInput(saved), request(saved));
  assert.equal(canonicalSourceDeclarationJson(saved), before);
});
test("editor preserve projection keeps explicit withdrawal", () => assert.deepEqual(inventoryScopeDecisionToInput({schemaVersion:INVENTORY_REVIEW_VERSION,claims:[]}), {schemaVersion:INVENTORY_REVIEW_VERSION,claims:[]}));
test("no absent sibling/default hash field", () => {
  const old = {objectApiId:"OBJ-1", sourceFileApiId:"FIL-1", actorId:"actor", basis:{reference:"old unchanged"}};
  assert.equal(canonicalJson({...old, ...inventoryScopeHashFields(undefined)}), canonicalJson(old));
  assert.equal(Object.hasOwn(inventoryScopeHashFields(undefined), "inventoryScope"), false);
  assert.deepEqual(inventoryScopeHashFields({schemaVersion:INVENTORY_REVIEW_VERSION,claims:[]}), {inventoryScope:{schemaVersion:INVENTORY_REVIEW_VERSION,claims:[]}});
});
for (const kind of ["topgetter", "arraygetter", "nestedgetter", "proxy", "nonenumerable", "symbol", "sparse", "arrayextra", "cycle", "custom", "surrogate", "nan", "infinity", "undefined", "bigint"]) {
  test(`native rejection without getters ${kind}`, () => {
    let calls = 0; let v: any = request();
    if (kind === "topgetter") Object.defineProperty(v, "claims", {enumerable:true,get(){calls++;return [];}});
    if (kind === "arraygetter") Object.defineProperty(v.claims, "0", {enumerable:true,get(){calls++;return {};}});
    if (kind === "nestedgetter") Object.defineProperty(v.claims[0].target, "checkId", {enumerable:true,get(){calls++;return "CHK";}});
    if (kind === "proxy") v = new Proxy(v, {ownKeys(){calls++;throw Error("trap");},getPrototypeOf(){calls++;throw Error("trap");}});
    if (kind === "nonenumerable") Object.defineProperty(v, "hidden", {value:true});
    if (kind === "symbol") v[Symbol("x")] = true;
    if (kind === "sparse") v.claims = new Array(1);
    if (kind === "arrayextra") v.claims.extra = true;
    if (kind === "cycle") v.loop = v;
    if (kind === "custom") v = Object.assign(Object.create({custom:true}), v);
    if (kind === "surrogate") v.claims[0].reference = "text-\ud800-end";
    if (kind === "nan") v.claims[0].selection.pageNumber = NaN;
    if (kind === "infinity") v.claims[0].selection.pageNumber = Infinity;
    if (kind === "undefined") v.extra = undefined;
    if (kind === "bigint") v.extra = 1n;
    assert.throws(() => parseInventoryScopeInput(v)); assert.equal(calls, 0);
  });
}
test("bounded deeply nested input", () => { let v: any = {}; const root=v; for(let i=0;i<66;i++){v.next={};v=v.next;} assert.throws(()=>assertInventoryReviewNative(root)); });
test("bounded container item count", () => assert.throws(() => assertInventoryReviewNative(new Array(32769).fill(0)), (e: unknown) => e instanceof InventoryReviewValidationError && e.code === "INPUT_LIMIT"));
test("512KiB total JSON bytes includes escaping", () => {
  assert.doesNotThrow(() => assertInventoryReviewNative("a".repeat(524286)));
  assert.throws(() => assertInventoryReviewNative("a".repeat(524287)), (e: unknown) => e instanceof InventoryReviewValidationError && e.code === "INPUT_LIMIT");
  assert.throws(() => assertInventoryReviewNative("\u0000".repeat(100000)), (e: unknown) => e instanceof InventoryReviewValidationError && e.code === "INPUT_LIMIT");
});
function expandedUnknown(): MatrixInventoryScopeDecision {
  const v = scope(); const c = v.claims[0], s = c.inventorySnapshot;
  s.regionBoxMilliPoints = [0, 0, s.widthMilliPoints, s.heightMilliPoints];
  c.selection.regionBoxMilliPoints = clone(s.regionBoxMilliPoints);
  // Deliberately synthetic SHAPE fixture for server expansion/resource testing;
  // these rows are not claimed to come from immutable authored PDF evidence.
  s.unresolvedRows = Array.from({length:70}, (_, i) => ({reasonCode:"UNSUPPORTED_ROW",fragments:[{
    pageNumber:s.pageNumber,blockIndex:100+i,lineIndex:0,rawText:"x".repeat(8192),
    bboxMilliPoints:[60000,300000-i*2000,180000,301000-i*2000],
  }]}));
  c.target.inventoryContentHash = hash(s); return v;
}
test("small UNKNOWN request expands beyond512KiB into bounded materialized snapshot", () => {
  const saved = expandedUnknown();
  assert.ok(Buffer.byteLength(JSON.stringify(saved)) > 524288);
  assert.ok(Buffer.byteLength(JSON.stringify(request(saved))) < 524288);
  assert.doesNotThrow(() => parseInventoryScopeInput(request(saved)));
  assert.equal(parseInventoryScopeDecision(saved).claims[0].inventorySnapshot.unresolvedRows.length, 70);
  assert.doesNotThrow(() => assertMaterializedSourceReviewEnvelope({actorId:"actor",inventoryScope:saved}));
});
test("expanded snapshot still rejects HUMAN_ASSERTED_COMPLETE", () => {
  const saved = expandedUnknown(); saved.claims[0].assertion="HUMAN_ASSERTED_COMPLETE";
  assert.throws(()=>parseInventoryScopeDecision(saved),(e:unknown)=>e instanceof InventoryReviewValidationError&&e.code==="INVENTORY_INCOMPLETE");
});
test("request bound remains512KiB after materialized mode added", () => {
  assert.throws(()=>assertInventoryReviewNative(expandedUnknown()),(e:unknown)=>e instanceof InventoryReviewValidationError&&e.code==="INPUT_LIMIT");
});
test("16 snapshots share one8MB budget", () => {
  const c=expandedUnknown().claims[0], saved={schemaVersion:INVENTORY_REVIEW_VERSION,claims:Array.from({length:16},()=>clone(c))};
  assert.throws(()=>parseInventoryScopeDecision(saved),(e:unknown)=>e instanceof InventoryReviewValidationError&&e.code==="INPUT_LIMIT");
});
test("complete parent8MB cap includes status/matrixScope/actor and JSON punctuation", () => {
  const parent={objectApiId:"OBJ",sourceFileApiId:"FIL",actorId:"actor",inventoryScope:scope(),matrixScope:{entityKey:"legacy"},padding:""};
  const size=Buffer.byteLength(JSON.stringify(parent));parent.padding="a".repeat(8000000-size);
  assert.equal(Buffer.byteLength(JSON.stringify(parent)),8000000);
  assert.doesNotThrow(()=>assertMaterializedSourceReviewEnvelope(parent));
  parent.padding+="a";
  assert.throws(()=>assertMaterializedSourceReviewEnvelope(parent),(e:unknown)=>e instanceof InventoryReviewValidationError&&e.code==="INPUT_LIMIT");
});

test('old omitted sibling preserves literal legacy hash body; no null/default fields',()=>{
  const before={objectApiId:'OBJ',sourceFileApiId:'FIL',sourceSha256:'a'.repeat(64),revisionStatus:'CURRENT',approvalStatus:'APPROVED',linkGroupId:null,pageStages:{},basis:{reference:'Проверен исходный источник'},actorId:'actor'};
  assert.equal(canonicalJson({...before,...inventoryScopeHashFields(undefined)}),canonicalJson(before));
  assert.equal(createHash('sha256').update(canonicalJson({...before,...inventoryScopeHashFields(undefined)})).digest('hex'),createHash('sha256').update(canonicalJson(before)).digest('hex'));
});
