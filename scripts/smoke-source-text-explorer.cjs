/** T49 full original source-text explorer: independent GET-only API acceptance.
 * --self-test (offline) | verify PRIVATE_STATE_0600
 * No production imports, browser, fact inference, source reviews, or domain commands.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {isDeepStrictEqual} = require('node:util');
const root = path.resolve(__dirname, '..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const hashPattern = /^[a-f0-9]{64}$/u;
const planPin = ['output/matrix-t49-20261018/source-text-http-plan.json', '69ea04b9e261df3d77737d4ceee0c77be1346a52f956aec2f13d8d007fbb1b59'];
const fixturePin = ['services/worker/tests/fixtures/rebar-F0106-F0139.json', 'ee4c645f50f87d44e056b62f215170067e8cd75555837473e2599072c9fa6b54'];
function pinned([filename, expected]) {
  const bytes = fs.readFileSync(path.join(root, filename));
  assert.equal(sha(bytes), expected, `Frozen input SHA ${filename}`);
  return JSON.parse(bytes);
}
// Full artifact portable JSON consists of Unicode scalar strings, ASCII keys, safe integers.
function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { assert.ok(Number.isSafeInteger(value)); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype);
  const keys = Object.keys(value).sort(); for (const key of keys) assert.match(key, /^[\x20-\x7e]+$/u);
  return '{' + keys.map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
const fullArtifactHash = artifact => sha(canonical({hashDomain: 'matrix-source-declaration-text-artifact-v1', textArtifact: artifact}));
function expectedArtifact(source, fixture, plan) {
  const spec = plan.sources.find(s => s.originalSourceFileId === source.originalSourceFileId); assert.ok(spec);
  for (const key of ['sha256', 'stage', 'pages']) assert.equal(source[key], spec[key]);
  const entry = fixture.sources.find(row => row.source.file_id === source.originalSourceFileId); assert.ok(entry);
  assert.equal(entry.source.sha256, spec.sha256); assert.equal(entry.source.stage, spec.stage);
  assert.deepEqual(entry.provenance.manifestGate, {split: 'TRAIN_PUBLIC', distributionStatus: 'INCLUDE', labelVisibility: 'PUBLIC_TRAIN'});
  const artifact = clone(entry.sourceArtifact);
  assert.equal(artifact.sourceFileId, spec.originalSourceFileId); assert.equal(artifact.inputSha256, spec.sha256);
  assert.equal(artifact.pageCount, spec.pages);
  assert.deepEqual(artifact.pages.map(p => p.pageNumber), Array.from({length: spec.pages}, (_, i) => i + 1));
  artifact.sourceFileId = source.sourceFileId; // Sole permitted change to the complete original envelope.
  return artifact;
}
function literalEvidence(artifact, literal) {
  const page = artifact.pages[literal.pageNumber - 1]; assert.ok(page);
  assert.deepEqual([page.widthMilliPoints, page.heightMilliPoints], literal.frameMilliPoints);
  const block = page.blocks[literal.blockIndex]; assert.ok(block);
  const rawText = block.text.split('\n')[literal.lineIndex], box = block.lineBboxesMilliPoints?.[literal.lineIndex];
  assert.equal(rawText, literal.rawText, 'Original source-authored literal, no numeric/unit interpretation');
  assert.deepEqual(box, literal.bboxMilliPoints, 'Exact original line box');
  return {pageNumber: literal.pageNumber, blockIndex: literal.blockIndex, lineIndex: literal.lineIndex,
    rawText, bboxMilliPoints: box, pageFrame: {widthMilliPoints: page.widthMilliPoints, heightMilliPoints: page.heightMilliPoints},
    normalizedBox: {x: box[0] / page.widthMilliPoints, y: 1 - box[3] / page.heightMilliPoints,
      width: (box[2] - box[0]) / page.widthMilliPoints, height: (box[3] - box[1]) / page.heightMilliPoints}};
}
function validatePages(read, source, artifact, checkId, inputManifestHash) {
  assert.deepEqual(Object.keys(read).sort(), ['checkId', 'sourceFileId', 'sourceSha256', 'inputManifestHash', 'textStageContentHash',
    'textArtifactHash', 'stage', 'pageStages', 'latestReviewHash', 'textArtifact'].sort(), 'Exact published source-pages DTO');
  assert.equal(read.checkId, checkId); assert.equal(read.sourceFileId, source.sourceFileId);
  assert.equal(read.sourceSha256, source.sha256); assert.equal(read.stage, source.stage);
  assert.equal(read.inputManifestHash, inputManifestHash); assert.match(read.inputManifestHash, hashPattern);
  assert.match(read.textStageContentHash, hashPattern);
  assert.equal(read.textArtifactHash, fullArtifactHash(artifact), 'Independently recomputed whole original artifact hash');
  assert.deepEqual(read.pageStages, {}); assert.equal(read.latestReviewHash, null, 'No source-review decision created');
  assert.ok(isDeepStrictEqual(read.textArtifact, artifact), 'Entire original artifact, not selected pages or reconstructed text');
}
function pngDimensions(bytes, evidence) {
  assert.ok(bytes.length >= 45 && bytes.length <= 8 * 1024 * 1024);
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'Original PNG signature');
  assert.equal(bytes.readUInt32BE(8), 13); assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.deepEqual(bytes.subarray(-12), Buffer.from('0000000049454e44ae426082', 'hex'), 'Complete PNG IEND');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.ok(width > 0 && height > 0 && Math.max(width, height) === 1200, 'Default original page preview longest edge1200');
  const frame = evidence.pageFrame;
  assert.ok(Math.abs(width / height - frame.widthMilliPoints / frame.heightMilliPoints) <= 2 / height, 'Original PNG/page frame geometry ratio');
  const box = evidence.normalizedBox;
  const imageBox = {x: box.x * width, y: box.y * height, width: box.width * width, height: box.height * height};
  assert.ok(imageBox.x >= 0 && imageBox.y >= 0 && imageBox.width > 0 && imageBox.height > 0);
  assert.ok(imageBox.x + imageBox.width <= width && imageBox.y + imageBox.height <= height);
  return {width, height, sourceLineImageBox: imageBox};
}
function readState(filename) {
  const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.mode & 0o777, 0o600);
  const state = JSON.parse(fs.readFileSync(filename));
  assert.equal(state.schemaVersion, 'matrix-real-public-v7-state-v1');
  for (const key of ['objectId', 'checkId']) assert.match(state[key], /^[A-Za-z0-9_-]{1,200}$/u);
  assert.ok(state.cookies && Object.getPrototypeOf(state.cookies) === Object.prototype && Object.keys(state.cookies).length > 0);
  for (const [key, value] of Object.entries(state.cookies)) { assert.match(key, /^[A-Za-z0-9_-]+$/u); assert.equal(typeof value, 'string'); assert.ok(!/[\r\n;]/u.test(value)); }
  assert.ok(Array.isArray(state.sources) && state.sources.length === 2); assert.equal(new Set(state.sources.map(s => s.sourceFileId)).size, 2);
  for (const source of state.sources) assert.match(source.sourceFileId, /^[A-Za-z0-9_-]{1,200}$/u);
  return state;
}
function offline() {
  const plan = pinned(planPin), fixture = pinned(fixturePin);
  const artifacts = plan.sources.map(spec => ({...spec, sourceFileId: 'FIL-OFFLINE-' + spec.stage}))
    .map(source => ({source, artifact: expectedArtifact(source, fixture, plan)}));
  let literals = 0;
  for (const {source, artifact} of artifacts) {
    const response = {checkId: plan.checkId, sourceFileId: source.sourceFileId, sourceSha256: source.sha256, inputManifestHash: 'a'.repeat(64),
      textStageContentHash: 'b'.repeat(64), textArtifactHash: fullArtifactHash(artifact), stage: source.stage, pageStages: {}, latestReviewHash: null, textArtifact: artifact};
    validatePages(response, source, artifact, plan.checkId, 'a'.repeat(64));
    for (const mutate of [r => {r.sourceSha256 = 'c'.repeat(64);}, r => {r.textArtifact.pages.pop();},
      r => {r.textArtifactHash = 'c'.repeat(64);}, r => {r.inputManifestHash = 'c'.repeat(64);}, r => {r.latestReviewHash = 'c'.repeat(64); }]) {
      const forged = clone(response); mutate(forged); assert.throws(() => validatePages(forged, source, artifact, plan.checkId, 'a'.repeat(64)));
    }
  }
  for (const literal of plan.literalEvidence) {
    const artifact = artifacts.find(a => a.source.originalSourceFileId === literal.originalSourceFileId).artifact;
    literalEvidence(artifact, literal); literals++;
    const bad = clone(artifact), block = bad.pages[literal.pageNumber - 1].blocks[literal.blockIndex];
    const lines = block.text.split('\n'); lines[literal.lineIndex] += ' forged'; block.text = lines.join('\n');
    assert.throws(() => literalEvidence(bad, literal));
  }
  return {status: 'PASS_OFFLINE_FULL_SOURCE_TEXT_ORACLE', fullPages: 161, exactLiterals: literals,
    rejectedForgeries: 12, httpRequests: 0, domainWrites: 0, browserCalls: 0, evidenceLimits: plan.limits};
}
async function verify(state, out, step) {
  const plan = pinned(planPin), fixture = pinned(fixturePin);
  assert.equal(state.checkId, plan.checkId); assert.equal(state.objectId, plan.publicObjectId);
  const address = new URL(process.env.FEEDBACK_WEB_URL || 'http://127.0.0.1:28082');
  assert.ok(address.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(address.hostname) && address.pathname === '/' && !address.username && !address.password && !address.search && !address.hash);
  const requests = [];
  async function get(endpoint, expectedStatus = 200, maxBytes = 16 * 1024 * 1024) {
    assert.ok(/^\/api\/[A-Za-z0-9_/?=.-]+$/u.test(endpoint));
    const response = await fetch(address.origin + endpoint, {method: 'GET', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: {Cookie: Object.entries(state.cookies).map(([key, value]) => `${key}=${value}`).join('; ')}});
    const reader = response.body?.getReader(); assert.ok(reader); let total = 0, done = false; const chunks = [];
    try { while (true) { const part = await reader.read(); if (part.done) {done = true; break;} total += part.value.length;
      assert.ok(total <= maxBytes, 'Bounded HTTP response'); chunks.push(Buffer.from(part.value)); }
    } finally { if (!done) await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    requests.push({endpoint, status: response.status, bytes: bytes.length, sha256: sha(bytes)});
    fs.appendFileSync(path.join(out, 'get-journal.jsonl'), JSON.stringify(requests[requests.length - 1]) + '\n');
    assert.equal(response.status, expectedStatus, `GET ${endpoint}: HTTP${response.status}`);
    return {bytes, data: () => JSON.parse(bytes), headers: response.headers};
  }
  step('check-and-immutable-before');
  const prefix = `/api/checks/${state.checkId}`, check = (await get(prefix)).data();
  assert.equal(check.objectId, state.objectId); assert.equal(check.progress, 100); assert.equal(check.mode, 'NORMAL'); assert.ok(['PARTIAL', 'COMPLETED'].includes(check.status));
  const snapshots = [];
  for (const name of ['matrix-execution', 'submission', 'matrix-fact-targets']) {
    const response = await get(prefix + '/' + name); snapshots.push({name, response});
    fs.writeFileSync(path.join(out, name + '-before.json'), response.bytes, {flag: 'wx'});
  }
  const machine = snapshots[0].response.data(), inputManifestHash = machine.execution.inputManifestHash;
  assert.equal(machine.checkId, state.checkId); assert.match(inputManifestHash, hashPattern);
  assert.equal(snapshots[2].response.data().executionContentHash, machine.contentHash);
  assert.equal(sha(snapshots[1].response.bytes), machine.submission.contentHash);
  const sources = [], reads = [];
  for (const source of state.sources) {
    step('full-original-pages-' + source.originalSourceFileId);
    const artifact = expectedArtifact(source, fixture, plan), endpoint = prefix + '/source-inventory-pages?sourceFileId=' + encodeURIComponent(source.sourceFileId);
    const response = await get(endpoint), read = response.data();
    fs.writeFileSync(path.join(out, source.originalSourceFileId + '-source-pages.json'), response.bytes, {flag: 'wx'});
    validatePages(read, source, artifact, state.checkId, inputManifestHash);
    assert.match(response.headers.get('cache-control') || '', /private.*no-store/u);
    const evidence = plan.literalEvidence.filter(l => l.originalSourceFileId === source.originalSourceFileId).map(l => literalEvidence(artifact, l));
    sources.push({originalSourceFileId: source.originalSourceFileId, sourceFileId: source.sourceFileId, sourceSha256: source.sha256,
      stage: source.stage, fullPages: artifact.pageCount, inputManifestHash, textStageContentHash: read.textStageContentHash,
      textArtifactHash: read.textArtifactHash, latestReviewHash: read.latestReviewHash,
      fullRawArtifactMatched: true, fullSourceResponseSha256: sha(response.bytes), evidence});
    reads.push({endpoint, response});
    for (const line of evidence) {
      step('original-png-page-' + line.pageNumber);
      const previewEndpoint = `/api/objects/${state.objectId}/files/${source.sourceFileId}/pages/${line.pageNumber}/preview`;
      const png = await get(previewEndpoint, 200, 8 * 1024 * 1024);
      assert.match(png.headers.get('content-type') || '', /^image\/png(?:;|$)/u);
      const file = `${source.originalSourceFileId}-p${line.pageNumber}-original.png`;
      fs.writeFileSync(path.join(out, file), png.bytes, {flag: 'wx'});
      line.preview = {file, sha256: sha(png.bytes), bytes: png.bytes.length, ...pngDimensions(png.bytes, line)};
    }
  }
  step('known-foreign-source-rejection');
  const foreign = await get(prefix + '/source-inventory-pages?sourceFileId=FIL-EFFB9834', 404);
  assert.equal(foreign.data().error, 'NOT_FOUND');
  step('whole-readback-unchanged');
  for (const {endpoint, response} of reads) assert.ok((await get(endpoint)).bytes.equals(response.bytes), 'Full source origin response raw byte immutability');
  for (const {name, response} of snapshots) assert.ok((await get(prefix + '/' + name)).bytes.equals(response.bytes), `No read-induced ${name} mutation`);
  return {status: 'PASS_GET_ONLY_FULL_ORIGINAL_SOURCE_TEXT_EXPLORER_BROWSER_PENDING', checkId: state.checkId, objectId: state.objectId,
    internalObjectId: machine.execution.objectId, fullPages: 161, originalLiteralLines: 2, originalPngs: 2, sources,
    knownForeignSource: {sourceFileId: 'FIL-EFFB9834', status: 404, responseSha256: sha(foreign.bytes)},
    immutableBeforeAfter: Object.fromEntries(snapshots.map(({name, response}) => [name, {sha256: sha(response.bytes), unchanged: true}])),
    requests, httpMethods: ['GET'], domainWrites: 0, browserCalls: 0, sourceReviewsCreated: 0, newMachineFactsCreated: 0,
    evidenceLimits: plan.limits, rawStageHashIndependentlyRecomputed: false, fullTextArtifactHashIndependentlyRecomputed: true};
}
async function main() {
  const [mode, filename] = process.argv.slice(2);
  assert.ok(mode === '--self-test' && !filename || mode === 'verify' && filename, 'Use --self-test | verify PRIVATE_STATE_0600');
  const out = path.resolve(process.env.FEEDBACK_QA_OUTPUT || path.join(root, 'output/matrix-t49-20261018', mode === '--self-test' ? 'source-text-http-self-test' : 'source-text-http-attempt1'));
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'attempt-start.json'), JSON.stringify({mode, at: new Date().toISOString(), harnessSha256: sha(fs.readFileSync(__filename)), planSha256: planPin[1]}) + '\n', {flag: 'wx'});
  let stage = 'frozen-inputs'; const previousFetch = globalThis.fetch;
  try {
    let result;
    if (mode === '--self-test') {globalThis.fetch = () => {throw Error('Offline only');}; result = offline();}
    else result = await verify(readState(filename), out, value => {stage = value;});
    result.harnessSha256 = sha(fs.readFileSync(__filename)); result.planSha256 = planPin[1]; result.fixtureSha256 = fixturePin[1]; result.at = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
    console.log(JSON.stringify({status: result.status, fullPages: 161, domainWrites: 0, browserCalls: 0, httpRequests: result.httpRequests ?? result.requests.length}));
  } catch (error) {
    const result = {status: 'RED_PRESERVED', stage, errorName: error.name, reason: String(error.message).split('\n')[0].slice(0, 700),
      harnessSha256: sha(fs.readFileSync(__filename)), planSha256: planPin[1], domainWrites: 0, browserCalls: 0, at: new Date().toISOString()};
    fs.writeFileSync(path.join(out, 'red-result.json'), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
    console.error(JSON.stringify(result)); process.exitCode = 1;
  } finally {globalThis.fetch = previousFetch;}
}
module.exports = {canonical, fullArtifactHash, expectedArtifact, literalEvidence, validatePages, pngDimensions, offline};
if (require.main === module) main().catch(error => {console.error(String(error.message).split('\n')[0]); process.exitCode = 1;});
