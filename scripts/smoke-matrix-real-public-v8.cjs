/** T53 real-public differential acceptance. No production imports, browser, or domain writes.
 * --self-test: offline original-SID fact/selector and adversarial checks.
 * verify PRIVATE_STATE_0600: GET-only, after parent authorizes coherent v8 deployment.
 * FEEDBACK_QA_OUTPUT must name a fresh attempt directory; first RED is never overwritten.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const hex = /^[a-f0-9]{64}$/u;
const pins = {
  plan: ['output/matrix-t48-20261018/real-oracle-plan.json', '70667ff1decd186a4d62605ea2883f39bfc2564f5be10000d94046554e2a8e98'],
  historical: ['output/matrix-t47-20261018/real-concrete-saved-execution.json', 'ba84eae5e55eabbe36c31ed646bfaaf37a174475353d5650395d547c4156a1a9'],
  fixture: ['services/worker/tests/fixtures/rebar-F0106-F0139.json', 'ee4c645f50f87d44e056b62f215170067e8cd75555837473e2599072c9fa6b54'],
  fireDeclarations: ['services/worker/tests/fixtures/matrix-fire-table-v1/wrapper-golden.json', 'e3db3a3ecaa7b59aaf8e853cf98da4d4ae1d3479c415296429d3c9e18a2df5d5'],
};
const specs = [
  {originalSourceFileId: 'F0106', stage: 'PD', sha256: 'ae8b16439650526a5ef6e1975c852fa38c2ab4466cd73ab725a47bcb32a6b655', bytes: 23871472, pages: 139,
    localPdf: 'output/matrix-t31-20261018/F0106-original.pdf'},
  {originalSourceFileId: 'F0139', stage: 'RD', sha256: 'd59c225e75d1e0227f08869b31165bd93bf85ed4b1da005c3e86ebc27023b73f', bytes: 2298875, pages: 22,
    localPdf: 'output/matrix-t30-20261018/F0139-original.pdf'},
];
const typedSpecs = [
  {key: 'inventoryComparisons', evidenceKey: 'inventoryComparisonEvidence', parameterCode: 'AR-053', officialCode: 'M-053',
    resultSchema: 'matrix-inventory-execution-result-v1', envelopeSchema: 'matrix-inventory-comparisons-v1',
    ruleId: 'matrix-ar-053-declared_joint_damping_tape_omission', hashDomain: 'matrix-inventory-execution-result-id-v1',
    capabilityRegistryHash: '4041e18e6325759fc44fdbc2c67045130fd194ade42d208ba1fda24d8decd76a',
    reasonCode: 'REVIEWED_INVENTORY_IDENTITY_MISSING', location: 'Область ведомости не установлена',
    partialGap: 'PARTIAL_SUBRULES_ONLY:REVIEWED_DECLARED_JOINT_DAMPING_TAPE_MEMBERSHIP_ONLY;GLOBAL_OR_PHYSICAL_ABSENCE_AND_SUBSTITUTION_UNSUPPORTED'},
  {key: 'callInventoryComparisons', evidenceKey: 'callInventoryComparisonEvidence', parameterCode: 'ODI-123', officialCode: 'M-123',
    resultSchema: 'matrix-call-inventory-execution-result-v1', envelopeSchema: 'matrix-call-inventory-comparisons-v1',
    ruleId: 'matrix-odi-123-declared_sanitary_room_personnel_call_button_omission', hashDomain: 'matrix-call-inventory-execution-result-id-v1',
    capabilityRegistryHash: '86b0c1fef9f55bf5a6802c1747c9e59fd0f5ebb16c230a74d685b30c307f6e2d',
    reasonCode: 'REVIEWED_CALL_INVENTORY_IDENTITY_MISSING', location: 'Помещение системы вызова не установлено',
    partialGap: 'PARTIAL_SUBRULES_ONLY:REVIEWED_NAMED_ACCESSIBLE_ROOM_PERSONNEL_CALL_BUTTON_MEMBERSHIP_ONLY;ENTRANCES_OTHER_ROOMS_GLOBAL_PHYSICAL_ABSENCE_FUNCTIONALITY_AND_SUBSTITUTION_UNSUPPORTED'},
  {key: 'railInventoryComparisons', evidenceKey: 'railInventoryComparisonEvidence', parameterCode: 'ODI-120', officialCode: 'M-120',
    resultSchema: 'matrix-rail-inventory-execution-result-v1', envelopeSchema: 'matrix-rail-inventory-comparisons-v1',
    ruleId: 'matrix-odi-120-declared_accessible_room_wc_rails_omission', hashDomain: 'matrix-rail-inventory-execution-result-id-v1',
    capabilityRegistryHash: '1a50046599c3c2c0965919a33615da4254dc9e0a1e05f4bedb723d94de2be409',
    reasonCode: 'REVIEWED_RAIL_INVENTORY_IDENTITY_MISSING', location: 'Помещение ведомости поручней не установлено',
    partialGap: 'PARTIAL_SUBRULES_ONLY:REVIEWED_NAMED_ACCESSIBLE_ROOM_BOTH_WC_RAIL_TYPES_MEMBERSHIP_OMISSION_ONLY;QUANTITIES_MOUNTING_LOAD_DIMENSIONS_OTHER_ROOMS_GLOBAL_PHYSICAL_ABSENCE_AND_SUBSTITUTION_UNSUPPORTED'},
  {key:'waterNodeComparisons',evidenceKey:'waterNodeComparisonEvidence',parameterCode:'ZU-129',officialCode:'M-129',resultSchema:'matrix-water-node-execution-result-v1',envelopeSchema:'matrix-water-node-comparisons-v1',ruleId:'matrix-zu-129-declared_cold_water_inlet_meter_omission',hashDomain:'matrix-water-node-execution-result-id-v1',capabilityRegistryHash:'15bebe6faf9fe0f6ce75ad7399f46fad582356ce175cbdbaffa0eaea7dab2f88',reasonCode:'REVIEWED_WATER_NODE_IDENTITY_MISSING',location:'Общедомовой вводной узел ХВС не установлен',partialGap:'PARTIAL_SUBRULES_ONLY:REVIEWED_NAMED_COMMON_BUILDING_COLD_WATER_INLET_NODE_METER_MEMBERSHIP_OMISSION_ONLY;QUANTITIES_CAPACITY_DIAMETERS_APARTMENT_HOT_WATER_ELECTRICITY_HEAT_OTHER_NODES_GLOBAL_PHYSICAL_ABSENCE_AND_NORMATIVE_COMPLIANCE_UNSUPPORTED'}
];

// Legacy fact ID: ASCII-key sorted ordinary JSON, including finite normalized bbox numbers.
function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { assert.ok(Number.isFinite(value)); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype);
  const keys = Object.keys(value).sort();
  for (const key of keys) assert.match(key, /^[\x20-\x7e]+$/u);
  return '{' + keys.map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
// Distinct portable fact-selector format: finite IEEE754 numbers are tagged big-endian bytes.
function portableTree(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value));
    const bytes = Buffer.alloc(8); bytes.writeDoubleBE(value);
    return ['$number', bytes.toString('hex')];
  }
  if (Array.isArray(value)) return ['$array', value.map(portableTree)];
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype);
  return ['$object', Object.keys(value).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .map(key => [key, portableTree(value[key])])];
}
const portableHash = value => sha(JSON.stringify(portableTree(value)));
function pinnedJson([filename, expected]) {
  const bytes = fs.readFileSync(path.join(root, filename));
  assert.equal(sha(bytes), expected, `Frozen input SHA: ${filename}`);
  return JSON.parse(bytes);
}
function inputs() {
  const plan = pinnedJson(pins.plan), historical = pinnedJson(pins.historical), fixture = pinnedJson(pins.fixture);
  assert.equal(historical.execution.observations.length, 15);
  assert.equal(historical.execution.results.length, 63);
  assert.equal(fixture.sources.length, 2);
  for (const spec of specs) {
    const item = fixture.sources.find(row => row.source.file_id === spec.originalSourceFileId);
    assert.ok(item, 'Both frozen original sources required');
    assert.equal(item.source.sha256, spec.sha256); assert.equal(item.source.stage, spec.stage);
    assert.deepEqual(item.provenance.manifestGate, {split: 'TRAIN_PUBLIC', distributionStatus: 'INCLUDE', labelVisibility: 'PUBLIC_TRAIN'});
    assert.equal(item.sourceArtifact.sourceFileId, spec.originalSourceFileId);
    assert.equal(item.sourceArtifact.inputSha256, spec.sha256);
    assert.equal(item.sourceArtifact.pageCount, spec.pages);
    assert.deepEqual(item.sourceArtifact.pages.map(page => page.pageNumber), Array.from({length: spec.pages}, (_, i) => i + 1));
  }
  return {plan, historical, fixture};
}
function observationId(fact) {
  return sha(canonical({sourceFileId: fact.sourceFileId, sourceSha256: fact.sourceSha256, stage: fact.stage,
    pageNumber: fact.pageNumber, blockIds: fact.evidenceFragments.map(fragment => fragment.blockId),
    attribute: fact.attribute, value: fact.value, unit: fact.unit,
    ...(fact.contextFragments ? {contextFragments: fact.contextFragments} : {})}));
}
function normalized(box, page) {
  return {x: box[0] / page.widthMilliPoints, y: 1 - box[3] / page.heightMilliPoints,
    width: (box[2] - box[0]) / page.widthMilliPoints, height: (box[3] - box[1]) / page.heightMilliPoints};
}
function nearBox(actual, expected, label) {
  assert.deepEqual(Object.keys(actual).sort(), ['height', 'width', 'x', 'y']);
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-6, `${label}: ${key}`);
}
function originalFragment(fragment, pageNumber, artifact) {
  assert.match(fragment.blockId, /^\d+:\d+$/u);
  const [blockIndex, lineIndex] = fragment.blockId.split(':').map(Number);
  const page = artifact.pages[pageNumber - 1]; assert.ok(page && page.pageNumber === pageNumber, 'Original fragment page');
  const block = page.blocks[blockIndex]; assert.ok(block, 'Original fragment block');
  const line = block.text.split('\n')[lineIndex];
  assert.equal(fragment.rawText, line, 'Whole original raw line, including unused text');
  const box = block.lineBboxesMilliPoints?.[lineIndex];
  assert.ok(Array.isArray(box) && box.length === 4, 'Exact original line box required');
  nearBox(fragment.bbox, normalized(box, page), 'Source fragment geometry');
  return box;
}
function selectorFor(fact, artifact, textArtifactHash) {
  assert.equal(fact.sourceFileId, artifact.sourceFileId); assert.equal(fact.sourceSha256, artifact.inputSha256);
  assert.equal(fact.id, observationId(fact), 'Legacy fact ID independently recomputed');
  assert.equal(fact.entityKey, null, 'No human identity inferred');
  assert.ok(fact.sourceFlags.includes('SOURCE_APPROVAL_UNKNOWN') && fact.sourceFlags.includes('SOURCE_REVISION_UNKNOWN'));
  assert.equal(fact.blockId, fact.evidenceFragments[0].blockId);
  const boxes = fact.evidenceFragments.map(fragment => originalFragment(fragment, fact.pageNumber, artifact));
  for (const fragment of fact.contextFragments || []) originalFragment(fragment, fragment.pageNumber, artifact);
  const union = [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])), Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))];
  nearBox(fact.bbox, normalized(union, artifact.pages[fact.pageNumber - 1]), 'Primary-only fact geometry');
  const fields = ['sourceFileId', 'sourceSha256', 'stage', 'pageNumber', 'blockId', 'attribute', 'value', 'unit',
    'rawValue', 'rawUnit', 'rawText', 'method', 'extractorVersion', 'bbox', 'evidenceFragments'];
  return {schemaVersion: 'matrix-fact-selector-v1', ...Object.fromEntries(fields.map(key => [key, fact[key]])),
    ...(fact.contextFragments ? {contextFragments: fact.contextFragments} : {}), textArtifactHash};
}
function expectations(sourceSpecs, data = inputs()) {
  assert.equal(sourceSpecs.length, 2); assert.equal(new Set(sourceSpecs.map(s => s.sourceFileId)).size, 2);
  const artifacts = new Map(), sourceMap = new Map(), oldToNewId = new Map(), expected = clone(data.historical.execution);
  for (const spec of specs) {
    const assigned = sourceSpecs.find(s => s.sha256 === spec.sha256);
    assert.ok(assigned, 'Source mapping by exact original SHA');
    for (const key of ['originalSourceFileId', 'stage', 'bytes', 'pages']) assert.equal(assigned[key], spec[key], `Source metadata: ${key}`);
    assert.match(assigned.sourceFileId, /^[A-Za-z0-9_-]{1,200}$/u);
    const artifact = clone(data.fixture.sources.find(s => s.source.sha256 === spec.sha256).sourceArtifact);
    artifact.sourceFileId = assigned.sourceFileId; // The ONLY original artifact modification.
    const old = data.historical.execution.metadata.find(m => m.sourceSha256 === spec.sha256); assert.ok(old);
    sourceMap.set(old.sourceFileId, assigned.sourceFileId);
    artifacts.set(assigned.sourceFileId, {artifact, textArtifactHash: portableHash(artifact), spec: assigned});
  }
  const targets = expected.observations.map(fact => {
    const oldId = fact.id;
    fact.sourceFileId = sourceMap.get(fact.sourceFileId); assert.ok(fact.sourceFileId);
    fact.id = observationId(fact); oldToNewId.set(oldId, fact.id);
    const {artifact, textArtifactHash} = artifacts.get(fact.sourceFileId);
    const selector = selectorFor(fact, artifact, textArtifactHash);
    return {sourceFileId: fact.sourceFileId, selector, target: {observationId: fact.id, evidenceHash: portableHash(selector), textArtifactHash},
      ...(fact.contextFragments ? {fragmentsHash: portableHash(fact.contextFragments)} : {})};
  });
  for (const row of expected.results) for (const key of ['expectedObservationId', 'actualObservationId']) {
    if (row[key] !== null) { assert.ok(oldToNewId.has(row[key]), 'Frozen result ref must name original fact'); row[key] = oldToNewId.get(row[key]); }
  }
  for (const metadata of expected.metadata) metadata.sourceFileId = sourceMap.get(metadata.sourceFileId);
  return {data, execution: expected, targets, artifacts, oldToNewId};
}
const sorted = (items, key) => [...items].sort((a, b) => a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);
function validateScalar(actual, expected) {
  assert.equal(actual.observations.length, 15); assert.equal(new Set(actual.observations.map(f => f.id)).size, 15);
  assert.deepEqual(sorted(actual.observations, 'id'), sorted(expected.execution.observations, 'id'), 'All15 original fact payloads');
  assert.deepEqual(actual.results, expected.execution.results, 'All63 original result payloads and remapped fact refs');
  assert.deepEqual(sorted(actual.metadata, 'sourceFileId'), sorted(expected.execution.metadata, 'sourceFileId'), 'Exact UNKNOWN source metadata');
  assert.deepEqual(actual.coverage, expected.execution.coverage, 'Unchanged full132 scalar coverage');
  assert.equal(actual.schemaVersion, expected.execution.schemaVersion); assert.equal(actual.registryHash, expected.execution.registryHash);
  assert.match(actual.objectId, /^[a-f0-9-]{36}$/u); assert.match(actual.inputManifestHash, hex);
  assert.ok(actual.results.every(row => row.qualified === false));
}
function unbound(execution, spec) {
  const result = {schemaVersion: spec.resultSchema, ruleId: spec.ruleId, ruleVersion: '1', parameterCode: spec.parameterCode,
    comparisonVariant: 'PD_RD', kind: 'UNBOUND_ATOM_ABSTENTION', reasonCode: spec.reasonCode, calibratedProbability: null};
  const body = {objectId: execution.objectId, inputManifestHash: execution.inputManifestHash, capabilityRegistryHash: spec.capabilityRegistryHash};
  return {schemaVersion: spec.envelopeSchema, purpose: 'MACHINE_COMPARISON', ...body,
    results: [{...result, id: sha(canonical({hashDomain: spec.hashDomain, ...body, result}))}]};
}
function counts(rows) {
  return {parameters: rows.filter(row => row.implementedAtomicRules > 0).length,
    atoms: rows.reduce((sum, row) => sum + row.implementedAtomicRules, 0), unsupported: rows.filter(row => row.executionStatus === 'UNSUPPORTED').length};
}
function validateTyped(machine) {
  assert.deepEqual(counts(machine.execution.coverage), {parameters: 55, atoms: 63, unsupported: 77});
  const expectedCoverage = clone(machine.execution.coverage);
  for (const spec of typedSpecs) {
    assert.deepEqual(machine[spec.key], unbound(machine.execution, spec), `Exact typed unbound envelope ${spec.parameterCode}`);
    assert.deepEqual(machine[spec.evidenceKey], [], `No invented typed evidence ${spec.parameterCode}`);
    const i = expectedCoverage.findIndex(row => row.parameterCode === spec.parameterCode); assert.ok(i >= 0);
    assert.deepEqual(expectedCoverage[i], {parameterCode: spec.parameterCode, implementedAtomicRules: 0, enabledAtomicRules: 0,
      evaluatedAtomicRules: 0, successfulComparisons: 0, abstentions: 0, failures: 0, executionStatus: 'UNSUPPORTED', reason: 'ENUMERATION_COMPLETE_AND_NEGATIVE_SCOPE_REQUIRED'});
    expectedCoverage[i] = {parameterCode: spec.parameterCode, implementedAtomicRules: 1, enabledAtomicRules: 1,
      evaluatedAtomicRules: 1, successfulComparisons: 0, abstentions: 1, failures: 0, executionStatus: 'PARTIAL', reason: spec.partialGap};
  }
  assert.deepEqual(machine.effectiveCoverage, expectedCoverage, 'Only4 explicit partial capability overlays; other128 rows unchanged');
  assert.deepEqual(counts(machine.effectiveCoverage), {parameters: 59, atoms: 67, unsupported: 73});
}
function diagnostic(spec) {
  return {parameter_code: spec.officialCode, location: spec.location, pd_value: null, rd_value: null, id_value: null,
    violation_label: 'COMPARISON_IMPOSSIBLE', protocol_status: 'COMPARISON_IMPOSSIBLE', criticality: spec.reasonCode, evidence: []};
}
function scalarSubmission(execution, sourceSpecs) {
  const facts = new Map(execution.observations.map(f => [f.id, f]));
  const originalIds = new Map(sourceSpecs.map(s => [s.sourceFileId, s.originalSourceFileId]));
  return {object_id: 'OBJ-NOVOSLOBODSKAYA', checks: execution.results.map(row => {
    const expected = facts.get(row.expectedObservationId), actual = facts.get(row.actualObservationId);
    assert.match(row.parameterCode, /^[A-Z0-9_]+-\d{3}$/u);
    return {parameter_code: 'M-' + row.parameterCode.split('-')[1], location: row.entityKey ?? 'Область элемента не установлена',
      pd_value: expected?.stage === 'PD' ? expected.value : null,
      rd_value: actual?.stage === 'RD' ? actual.value : expected?.stage === 'RD' ? expected.value : null,
      id_value: actual?.stage === 'ID' ? actual.value : null, violation_label: 'COMPARISON_IMPOSSIBLE', protocol_status: 'COMPARISON_IMPOSSIBLE',
      criticality: row.reasonCode, evidence: [expected, actual].filter(Boolean).map(fact => {
        const originalId = originalIds.get(fact.sourceFileId); assert.ok(originalId);
        return {stage: fact.stage, file_id: originalId, pdf_page_number: fact.pageNumber};
      })};
  })};
}
function sourceDeclarations(expected, execution) {
  const golden = pinnedJson(pins.fireDeclarations).expected;
  const originalFire = golden.declarations.filter(d => d.kind === 'SOURCE_AUTHORED_FIRE_RESISTANCE_DECLARATION');
  assert.equal(originalFire.length, 6, 'Six original fire-table declarations');
  const declarations = originalFire.map(declaration => {
    const body = clone(declaration); delete body.id;
    assert.equal(sha(canonical({hashDomain: 'matrix-source-declaration-id-v1', declaration: body})), declaration.id, 'Frozen original declaration semantic ID');
    const entry = [...expected.artifacts.values()].find(x => x.spec.sha256 === body.sourceSha256); assert.ok(entry);
    body.sourceFileId = entry.spec.sourceFileId;
    body.textArtifactHash = sha(canonical({hashDomain: 'matrix-source-declaration-text-artifact-v1', textArtifact: entry.artifact}));
    return {...body, id: sha(canonical({hashDomain: 'matrix-source-declaration-id-v1', declaration: body}))};
  });
  return {...clone(golden), objectId: execution.objectId, inputManifestHash: execution.inputManifestHash, declarations};
}
function validateDeclarations(actual, expected) {
  assert.ok(actual, 'Mandatory v8 evidence-only sourceDeclarations sibling');
  assert.deepEqual({...actual, declarations: sorted(actual.declarations, 'id')}, {...expected, declarations: sorted(expected.declarations, 'id')},
    'Six source-authored original fire rows; exact source-bound evidence-only payload');
}
function validateTargets(body, expected, checkId, contentHash) {
  assert.equal(body.checkId, checkId); assert.equal(body.executionContentHash, contentHash); assert.equal(body.items.length, 15);
  const items = expected.targets.map(({sourceFileId, target, fragmentsHash}) => ({sourceFileId,
    target: {...target, checkId, executionContentHash: contentHash}, ...(fragmentsHash ? {fragmentsHash} : {})}));
  assert.deepEqual(sorted(body.items.map(item => ({...item, sortId: item.target.observationId})), 'sortId'),
    sorted(items.map(item => ({...item, sortId: item.target.observationId})), 'sortId'), 'All15 independently authenticated fact targets');
}
function pdfFrames(pdfPath, artifact) {
  const info = execFileSync('pdfinfo', ['-f', '1', '-l', String(artifact.pageCount), '-box', pdfPath],
    {encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024, env: {...process.env, LC_ALL: 'C'}});
  assert.match(info, new RegExp(`^Pages:\\s+${artifact.pageCount}\\s*$`, 'm'));
  return artifact.pages.map(page => {
    const number = page.pageNumber;
    const rotation = new RegExp(`^Page\\s+${number}\\s+rot:\\s+(0|90|180|270)\\s*$`, 'm').exec(info);
    const crop = new RegExp(`^Page\\s+${number}\\s+CropBox:\\s*([-+\\d.]+)\\s+([-+\\d.]+)\\s+([-+\\d.]+)\\s+([-+\\d.]+)\\s*$`, 'm').exec(info);
    assert.ok(rotation && crop, `Original PDF frame ${number}`);
    const box = crop.slice(1).map(Number), rotate = Number(rotation[1]);
    const dimensions = [box[2] - box[0], box[3] - box[1]];
    if (rotate === 90 || rotate === 270) dimensions.reverse();
    assert.ok(Math.abs(dimensions[0] - page.widthMilliPoints / 1000) < .025, `Original PDF width ${number}`);
    assert.ok(Math.abs(dimensions[1] - page.heightMilliPoints / 1000) < .025, `Original PDF height ${number}`);
    return {pageNumber: number, cropBox: box, rotation: rotate, widthMilliPoints: page.widthMilliPoints, heightMilliPoints: page.heightMilliPoints};
  });
}
function offlineSelfTest() {
  const data = inputs();
  const originalSources = specs.map(spec => ({...spec, sourceFileId: data.historical.execution.metadata.find(m => m.sourceSha256 === spec.sha256).sourceFileId}));
  const old = expectations(originalSources, data);
  validateScalar(data.historical.execution, old);
  assert.equal(sha(canonical(scalarSubmission(data.historical.execution, originalSources))), data.historical.submission.contentHash,
    'All63 original submission rows match frozen historical raw SHA');
  assert.deepEqual([...old.oldToNewId], data.historical.execution.observations.map(f => [f.id, f.id]));
  const syntheticSources = specs.map(spec => ({...spec, sourceFileId: 'FIL-T53-OFFLINE-' + spec.stage}));
  const remapped = expectations(syntheticSources, data);
  assert.ok([...remapped.oldToNewId].every(([a, b]) => a !== b));
  assert.equal(new Set(remapped.targets.map(t => t.target.evidenceHash)).size, 15);
  for (const target of remapped.targets) assert.notEqual(target.target.textArtifactHash, old.targets.find(t => t.selector.sourceSha256 === target.selector.sourceSha256).target.textArtifactHash);
  const remappedExecution = clone(remapped.execution); remappedExecution.objectId = '00000000-0000-4000-8000-000000000048'; remappedExecution.inputManifestHash = 'b'.repeat(64);
  validateScalar(remappedExecution, remapped);
  const typedMachine = {execution: remappedExecution, effectiveCoverage: clone(remappedExecution.coverage)};
  for (const spec of typedSpecs) {
    typedMachine[spec.key] = unbound(remappedExecution, spec); typedMachine[spec.evidenceKey] = [];
    const i = typedMachine.effectiveCoverage.findIndex(r => r.parameterCode === spec.parameterCode);
    typedMachine.effectiveCoverage[i] = {parameterCode: spec.parameterCode, implementedAtomicRules: 1, enabledAtomicRules: 1, evaluatedAtomicRules: 1,
      successfulComparisons: 0, abstentions: 1, failures: 0, executionStatus: 'PARTIAL', reason: spec.partialGap};
  }
  validateTyped(typedMachine);
  const declarations = sourceDeclarations(remapped, remappedExecution);
  validateDeclarations(clone(declarations), declarations);
  const body = {checkId: 'CHK-OFFLINE', executionContentHash: 'a'.repeat(64), items: remapped.targets.map(t => ({sourceFileId: t.sourceFileId,
    target: {...t.target, checkId: 'CHK-OFFLINE', executionContentHash: 'a'.repeat(64)}, ...(t.fragmentsHash ? {fragmentsHash: t.fragmentsHash} : {})}))};
  validateTargets(body, remapped, 'CHK-OFFLINE', 'a'.repeat(64));
  const attacks = [
    ['raw-line', e => { e.observations[0].rawText += ' forged'; }],
    ['value', e => { e.observations[0].value = '999'; }],
    ['source-ID', e => { e.observations[0].sourceFileId = 'FIL-UNRELATED'; }],
    ['primary-box', e => { e.observations[0].bbox.x += .01; }],
    ['context-line', e => { e.observations.find(f => f.contextFragments).contextFragments[0].rawText += ' forged'; }],
    ['result-ref', e => { e.results[0].expectedObservationId = 'f'.repeat(64); }],
    ['qualified', e => { e.results[0].qualified = true; }],
    ['duplicate-fact', e => { e.observations[1] = clone(e.observations[0]); }],
  ];
  for (const [name, mutate] of attacks) { const forged = clone(remappedExecution); mutate(forged); assert.throws(() => validateScalar(forged, remapped), undefined, `Reject ${name}`); }
  const wrongTarget = clone(body); wrongTarget.items[0].target.evidenceHash = 'f'.repeat(64);
  assert.throws(() => validateTargets(wrongTarget, remapped, 'CHK-OFFLINE', 'a'.repeat(64)));
  const wrongTyped = clone(typedMachine); wrongTyped.railInventoryComparisons.objectId = 'OBJ-PUBLIC'; assert.throws(() => validateTyped(wrongTyped));
  const wrongCoverage = clone(typedMachine); wrongCoverage.effectiveCoverage[0].successfulComparisons++; assert.throws(() => validateTyped(wrongCoverage));
  const wrongDeclaration = clone(declarations); wrongDeclaration.declarations[0].sourceFileId = 'FIL-UNRELATED';
  assert.throws(() => validateDeclarations(wrongDeclaration, declarations));
  const originals = specs.map(spec => {
    const filename = path.join(root, spec.localPdf), bytes = fs.readFileSync(filename);
    assert.equal(bytes.length, spec.bytes); assert.equal(sha(bytes), spec.sha256);
    return {originalSourceFileId: spec.originalSourceFileId, bytes: bytes.length, sha256: sha(bytes),
      frames: pdfFrames(filename, old.artifacts.get(originalSources.find(s => s.sha256 === spec.sha256).sourceFileId).artifact)};
  });
  return {status: 'PASS_OFFLINE_ORIGINAL_DIFFERENTIAL_SELF_TEST', originalObservationIds: 15, originalSelectors: 15,
    remappedObservationIds: 15, remappedTargets: 15, scalarResults: 63, originalPages: 161,
    primaryFragments: old.execution.observations.reduce((n, f) => n + f.evidenceFragments.length, 0),
    contextFragments: old.execution.observations.reduce((n, f) => n + (f.contextFragments?.length || 0), 0),
    rejectedAttacks: attacks.length + 4, originalScalarSubmissionRows: 63, originalSourceDeclarations: 6,
    scalarCounts: counts(data.historical.execution.coverage), effectiveCounts: counts(typedMachine.effectiveCoverage),
    oldTargetSelectors: old.targets, originalPdfFrames: originals, sourceRemapOnly: true, domainWrites: 0, httpRequests: 0, browserCalls: 0,
    evidenceLimits: data.plan.limits};
}
function privateState(filename) {
  const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.mode & 0o777, 0o600, 'Private state must be0600');
  const state = JSON.parse(fs.readFileSync(filename)); assert.equal(state.schemaVersion, 'matrix-real-public-v8-state-v1');
  for (const key of ['objectId', 'checkId']) assert.match(state[key], /^[A-Za-z0-9_-]{1,200}$/u);
  assert.ok(state.cookies && Object.getPrototypeOf(state.cookies) === Object.prototype);
  assert.ok(Object.keys(state.cookies).length > 0);
  for (const [key, value] of Object.entries(state.cookies)) { assert.match(key, /^[A-Za-z0-9_-]+$/u); assert.equal(typeof value, 'string'); assert.ok(!/[\r\n;]/u.test(value)); }
  return state;
}
async function verify(state, out, step) {
  const expected = expectations(state.sources);
  const address = new URL(process.env.FEEDBACK_API_URL || (process.env.FEEDBACK_WEB_URL || 'http://127.0.0.1:28082').replace(/\/$/u, '') + '/api');
  assert.ok(address.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(address.hostname) && !address.username && !address.password && !address.search && !address.hash);
  assert.equal(address.pathname.replace(/\/$/u, ''), '/api');
  const base = address.href.replace(/\/$/u, ''), requests = [];
  async function get(endpoint, status = 200, maxBytes = 8 * 1024 * 1024) {
    assert.match(endpoint, /^[A-Za-z0-9_/-]+$/u);
    const response = await fetch(base + '/' + endpoint, {method: 'GET', redirect: 'error',
      headers: {Cookie: Object.entries(state.cookies).map(([k, v]) => `${k}=${v}`).join('; ')}, signal: AbortSignal.timeout(60000)});
    const reader = response.body?.getReader(); assert.ok(reader); const chunks = []; let size = 0, done = false;
    try { while (true) { const part = await reader.read(); if (part.done) { done = true; break; } size += part.value.length;
      assert.ok(size <= maxBytes, 'Bounded HTTP response'); chunks.push(Buffer.from(part.value)); }
    } finally { if (!done) await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = Buffer.concat(chunks); requests.push({endpoint, status: response.status, bytes: bytes.length, sha256: sha(bytes)});
    assert.equal(response.status, status, `GET ${endpoint}: HTTP${response.status}`);
    return {bytes, data: () => JSON.parse(bytes), headers: response.headers};
  }
  const prefix = `checks/${state.checkId}`;
  step('terminal-check'); const check = (await get(prefix)).data();
  assert.equal(check.objectId, state.objectId); assert.equal(check.progress, 100); assert.equal(check.mode, 'NORMAL');
  assert.ok(['PARTIAL', 'COMPLETED'].includes(check.status));
  step('matrix-original-differential'); const machineResponse = await get(prefix + '/matrix-execution'), machine = machineResponse.data();
  fs.writeFileSync(path.join(out, 'matrix-before.json'), machineResponse.bytes, {flag: 'wx'});
  assert.equal(machine.checkId, state.checkId); assert.match(machine.contentHash, hex);
  assert.notEqual(machine.execution.objectId, state.objectId, 'Typed IDs use internal machine UUID, not public objectId');
  validateScalar(machine.execution, expected); validateTyped(machine);
  validateDeclarations(machine.sourceDeclarations, sourceDeclarations(expected, machine.execution));
  assert.deepEqual(machine.presentation, expected.data.historical.presentation, 'Original63 scalar presentations');
  assert.ok(machine.presentation.every(p => p.confidence.calibratedProbability === null));
  assert.deepEqual(machine.projectConstraints, {...expected.data.historical.projectConstraints,
    objectId: machine.execution.objectId, inputManifestHash: machine.execution.inputManifestHash});
  step('files-and-original-pdfs'); const filesResponse = await get(`objects/${state.objectId}/files`), files = filesResponse.data().items;
  assert.equal(files.length, 2); const originals = [], temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-t48-originals-'));
  try {
    for (const [sourceFileId, {artifact, spec}] of expected.artifacts) {
      const file = files.find(f => f.id === sourceFileId); assert.ok(file);
      assert.equal(file.sha256, spec.sha256); assert.equal(file.size, spec.bytes); assert.equal(file.pageCount, spec.pages);
      assert.deepEqual(file.stages, [spec.stage]); assert.equal(file.review, null);
      const pdf = await get(`objects/${state.objectId}/files/${sourceFileId}/content`, 200, spec.bytes);
      assert.equal(pdf.bytes.length, spec.bytes); assert.equal(sha(pdf.bytes), spec.sha256);
      const filename = path.join(temporary, spec.originalSourceFileId + '.pdf'); fs.writeFileSync(filename, pdf.bytes, {mode: 0o600});
      originals.push({originalSourceFileId: spec.originalSourceFileId, sourceFileId, sha256: spec.sha256, bytes: spec.bytes, pages: spec.pages, frames: pdfFrames(filename, artifact)});
    }
  } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
  step('all15-fact-targets'); const targetsResponse = await get(prefix + '/matrix-fact-targets');
  validateTargets(targetsResponse.data(), expected, state.checkId, machine.contentHash);
  fs.writeFileSync(path.join(out, 'targets-before.json'), targetsResponse.bytes, {flag: 'wx'});
  step('submission-and-findings'); const submission = await get(prefix + '/submission'), submissionData = submission.data();
  assert.equal(sha(submission.bytes), machine.submission.contentHash); assert.equal(submission.headers.get('x-content-sha256'), machine.submission.contentHash);
  const originalSubmission = scalarSubmission(expected.execution, state.sources);
  assert.deepEqual(submissionData, {...originalSubmission, checks: [...originalSubmission.checks, ...typedSpecs.map(diagnostic)]},
    'All63 original scalar submission rows plus exact4 conservative typed diagnostics');
  assert.equal(submissionData.checks.length, 67);
  assert.ok(submissionData.checks.every(row => row.violation_label === 'COMPARISON_IMPOSSIBLE' && row.protocol_status === 'COMPARISON_IMPOSSIBLE'));
  fs.writeFileSync(path.join(out, 'submission-before.json'), submission.bytes, {flag: 'wx'});
  const findings = await get(prefix + '/findings'); const findingData = findings.data();
  assert.ok(Array.isArray(findingData.items) && findingData.items.length === 0, 'No qualified findings from UNKNOWN originals');
  const pilot = await get(prefix + '/pilot-results'), pilotData = pilot.data(); assert.equal(pilotData.checkId, state.checkId);
  const candidateCount = pilotData.reviewCandidates?.candidateCount || 0;
  assert.equal(candidateCount, 0, 'No qualified calibrated review candidates');
  const expected404 = [];
  for (const source of state.sources) {
    const endpoint = `objects/${state.objectId}/files/${source.sourceFileId}/source-review`, response = await get(endpoint, 404);
    expected404.push({endpoint, status: 404, bytes: response.bytes});
  }
  step('immutable-raw-readback');
  for (const [endpoint, initial] of [[prefix + '/matrix-execution', machineResponse], [prefix + '/submission', submission],
    [prefix + '/findings', findings], [prefix + '/matrix-fact-targets', targetsResponse], [prefix + '/pilot-results', pilot], [`objects/${state.objectId}/files`, filesResponse]]) {
    assert.deepEqual((await get(endpoint)).bytes, initial.bytes, `Immutable GET readback ${endpoint}`);
  }
  for (const entry of expected404) assert.deepEqual((await get(entry.endpoint, 404)).bytes, entry.bytes, 'Absent source review unchanged');
  return {status: 'PASS_READ_ONLY_REAL_PUBLIC_V7_BROWSER_PENDING', checkId: state.checkId, objectId: state.objectId,
    internalMachineObjectId: machine.execution.objectId, scalarFacts: 15, scalarResults: 63, fullOriginalPages: 161, exactFactTargets: 15,
    rawOriginalTextAndContextsUnchanged: true, originalPdfFrames: originals, scalarCounts: counts(machine.execution.coverage),
    effectiveCounts: counts(machine.effectiveCoverage), typedUnboundAtoms: 4, typedDiagnostics: typedSpecs.map(s => s.officialCode),
    qualifiedComparisons: 0, sourceReviews: 0, sourceApproval: 'UNKNOWN', calibratedProbability: null, decisionsNotApplicable: true,
    exactScalarSubmissionRows: 63, exactSourceAuthoredFireDeclarations: 6,
    expected404: expected404.map(({endpoint, status, bytes}) => ({endpoint, status, sha256: sha(bytes)})),
    rawReadbackSha256: {matrix: sha(machineResponse.bytes), submission: sha(submission.bytes), findings: sha(findings.bytes),
      files: sha(filesResponse.bytes), targets: sha(targetsResponse.bytes), pilot: sha(pilot.bytes)},
    requests, httpMethods: ['GET'], domainWrites: 0, browserCalls: 0, immutableAfterReadback: true,
    evidenceLimits: expected.data.plan.limits};
}
async function main() {
  const [mode, statePath] = process.argv.slice(2);
  assert.ok(mode === '--self-test' && !statePath || mode === 'verify' && statePath, 'Use --self-test | verify PRIVATE_STATE_0600');
  const out = path.resolve(process.env.FEEDBACK_QA_OUTPUT || path.join(root, 'output/matrix-t53-20261018', mode === '--self-test' ? 'self-test-attempt1' : 'http-attempt1'));
  fs.mkdirSync(out, {recursive: true});
  const marker = path.join(out, 'attempt-start.json');
  fs.writeFileSync(marker, JSON.stringify({startedAt: new Date().toISOString(), mode, harnessSha256: sha(fs.readFileSync(__filename)),
    planSha256: pins.plan[1], httpAuthorizedByThisScript: false}) + '\n', {flag: 'wx'});
  let stage = 'frozen-inputs';
  const oldFetch = globalThis.fetch;
  try {
    let result;
    if (mode === '--self-test') {
      globalThis.fetch = () => { throw Error('Self-test must never use HTTP'); };
      result = offlineSelfTest();
    } else result = await verify(privateState(statePath), out, value => { stage = value; });
    result.harnessSha256 = sha(fs.readFileSync(__filename)); result.frozenInputs = pins; result.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
    console.log(JSON.stringify({status: result.status, facts: 15, targets: 15, fullPages: 161, domainWrites: 0, browserCalls: 0, httpRequests: result.httpRequests ?? result.requests.length}));
  } catch (error) {
    const result = {status: 'RED_PRESERVED', mode, stage, errorName: error.name, reason: String(error.message).split('\n')[0].slice(0, 700),
      harnessSha256: sha(fs.readFileSync(__filename)), frozenInputs: pins, domainWrites: 0, browserCalls: 0, at: new Date().toISOString()};
    fs.writeFileSync(path.join(out, 'red-result.json'), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
    console.error(JSON.stringify(result)); process.exitCode = 1;
  } finally { globalThis.fetch = oldFetch; }
}
module.exports = {canonical, portableTree, portableHash, observationId, expectations, selectorFor, validateScalar, validateTargets,
  unbound, validateTyped, diagnostic, scalarSubmission, sourceDeclarations, validateDeclarations, offlineSelfTest};
if (require.main === module) main().catch(error => { console.error(String(error.message).split('\n')[0]); process.exitCode = 1; });
