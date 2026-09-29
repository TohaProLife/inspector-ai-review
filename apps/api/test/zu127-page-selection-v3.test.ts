import { pythonExecutable, pythonEnv, pythonAvailable } from "./python.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "vitest";
import { pythonHash } from "../src/trusted-page-words.js";
import { verifyZu127PageSelectionV3,
  type Zu127PageSelectionV3Input } from "../src/zu127-page-selection-v3.js";

const python = pythonExecutable;
const fixtureScript = `import json
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION,qualify_page_text
from inspector_worker.zu127_page_selection_v3 import select_zu127_review_pages
def page(number,text):
 blocks=[{'text':text,'bboxMilliPoints':[1,1,500,500]}] if text else []
 return {'pageNumber':number,'widthMilliPoints':595000,'heightMilliPoints':842000,
         'blocks':blocks,'quality':qualify_page_text([text] if text else [],policy_version=TEXT_QUALITY_POLICY_VERSION)}
def source(source_id,source_sha,texts):
 pages=[page(index,text) for index,text in enumerate(texts,1)]
 artifact={'schemaVersion':'document-text-v2','sourceFileId':source_id,'inputSha256':source_sha,
           'coordinateSystem':'PDF_BOTTOM_LEFT_MILLI_POINTS','pageCount':len(pages),
           'textPageCount':sum(bool(p['blocks']) for p in pages),
           'qualityPolicyVersion':TEXT_QUALITY_POLICY_VERSION,
           'qualitySummary':{'textLayerCandidatePageCount':sum(p['quality']['disposition']=='TEXT_LAYER_CANDIDATE' for p in pages),
                             'ocrRequiredPageCount':sum(p['quality']['disposition']=='OCR_REQUIRED' for p in pages)},
           'pages':pages}
 review={'sourceSha256':source_sha,'revisionStatus':'CURRENT','approvalStatus':'APPROVED',
         'sectionCode':'ZU','pageStages':{},'basis':{'reference':'synthetic review basis'}}
 metadata={'sourceFileId':source_id,'sha256':source_sha,'pageCount':len(pages),
           'byteSize':100,'mediaType':'application/pdf','stages':['PD'],'sectionCode':'OTHER'}
 return metadata,review,{'sourceFileId':source_id,'contentSha256':__import__('hashlib').sha256(
     json.dumps(artifact,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
     'artifact':artifact}
first=source('S1','a'*64,['Приведенное сопротивление теплопередаче. Окна и витражи.',
                         'Коэффициент теплопередачи окон.','',
                         'Сопротивление теплопередаче. Окна.',
                         'Сопротивление теплопередаче. Витражи.',
                         'Сопротивление теплопередаче. Окна.'])
second=source('S2','c'*64,['Сопротивление теплопередаче. Окна.',
                          'Сопротивление теплопередаче. Витражи.'])
sources=[first[0],second[0]]
decisions={'S1':first[1],'S2':second[1]}
artifacts=[first[2],second[2]]
result=select_zu127_review_pages('OBJECT-1','b'*64,sources,decisions,artifacts)
print(json.dumps({'objectId':'OBJECT-1','inputManifestHash':'b'*64,'sources':sources,
                  'sourceDecisions':decisions,'textArtifacts':artifacts,
                  'workerResult':result},ensure_ascii=False))`;

function fixture(): Zu127PageSelectionV3Input {
  return JSON.parse(execFileSync(python, ["-c", fixtureScript], {
    encoding: "utf8", env: { ...process.env, ...pythonEnv },
  })) as Zu127PageSelectionV3Input;
}

function recomputeWithPython(input: Zu127PageSelectionV3Input): Zu127PageSelectionV3Input {
  const script = `import json,sys
from inspector_worker.zu127_page_selection_v3 import select_zu127_review_pages
packet=json.load(sys.stdin)
packet['workerResult']=select_zu127_review_pages(packet['objectId'],packet['inputManifestHash'],
    packet['sources'],packet['sourceDecisions'],packet['textArtifacts'])
print(json.dumps(packet,ensure_ascii=False))`;
  return JSON.parse(execFileSync(python, ["-c", script], {
    encoding: "utf8", input: JSON.stringify(input),
    env: { ...process.env, ...pythonEnv },
  })) as Zu127PageSelectionV3Input;
}

test.skipIf(!pythonAvailable)("accepts Python worker exact synthetic fixture and global page cap", () => {
  const input = fixture();
  assert.equal(verifyZu127PageSelectionV3(input), true);
  const result = input.workerResult as Record<string, any>;
  assert.equal(result.status, "ABSTAIN");
  assert.equal(result.selectedPageCount, 4);
  assert.equal(result.scannedCandidatePageCount, 6);
  assert.equal(result.truncatedCandidatePageCount, 2);
  assert.equal(result.deferredOcrRequiredPageCount, 1);
  assert.deepEqual(result.sourceRows[0].selectedPageNumbers, [1, 4, 5, 6]);
  assert.deepEqual(result.sourceRows[1].selectedPageNumbers, []);
  assert.equal(result.findings, null);
  assert.equal(result.parameterCoverage, null);
});

test.skipIf(!pythonAvailable)("rejects forged counts even with matching attacker contentHash", () => {
  const input = fixture();
  const result = structuredClone(input.workerResult as Record<string, any>);
  result.sourceRows[0].candidatePageCount = 0;
  result.scannedCandidatePageCount = 2;
  const { contentHash: _old, ...body } = result;
  result.contentHash = pythonHash(body);
  assert.equal(verifyZu127PageSelectionV3({ ...input, workerResult: result }), false);
});

test.skipIf(!pythonAvailable)("rejects omitted sources, unknown decisions and source SHA swaps", () => {
  const input = fixture();
  const missing = structuredClone(input);
  missing.sources.pop();
  assert.equal(verifyZu127PageSelectionV3(missing), false);
  const unknown = structuredClone(input);
  unknown.sourceDecisions["S3"] = structuredClone(unknown.sourceDecisions["S1"]);
  assert.equal(verifyZu127PageSelectionV3(unknown), false);
  const swapped = structuredClone(input);
  (swapped.sourceDecisions["S1"] as Record<string, unknown>).sourceSha256 = "d".repeat(64);
  assert.equal(verifyZu127PageSelectionV3(swapped), false);
});

test.skipIf(!pythonAvailable)("rejects tampered committed text, quality and OCR disposition", () => {
  const input = fixture();
  const receipt = input.textArtifacts[0] as Record<string, any>;
  const badHash = structuredClone(input);
  (badHash.textArtifacts[0] as Record<string, any>).artifact.pages[0].blocks[0].text = "подмена";
  assert.equal(verifyZu127PageSelectionV3(badHash), false);
  const forgedHash = structuredClone(input);
  const forged = forgedHash.textArtifacts[0] as Record<string, any>;
  forged.artifact.pages[0].blocks[0].text = "подмена";
  forged.contentSha256 = pythonHash(forged.artifact);
  assert.equal(verifyZu127PageSelectionV3(forgedHash), false);
  const falseOcr = structuredClone(input);
  const ocr = falseOcr.textArtifacts[0] as Record<string, any>;
  ocr.artifact.pages[2].quality.disposition = "TEXT_LAYER_CANDIDATE";
  ocr.contentSha256 = pythonHash(ocr.artifact);
  assert.equal(verifyZu127PageSelectionV3(falseOcr), false);
  assert.equal(receipt.contentSha256, pythonHash(receipt.artifact));
});

test.skipIf(!pythonAvailable)("blocks source without reviewed CURRENT APPROVED ZU decision", () => {
  const input = fixture();
  const unreviewed = structuredClone(input);
  delete unreviewed.sourceDecisions["S1"];
  assert.equal(verifyZu127PageSelectionV3(unreviewed), false);
  const wrongSection = structuredClone(input);
  (wrongSection.sourceDecisions["S1"] as Record<string, unknown>).sectionCode = "AR";
  assert.equal(verifyZu127PageSelectionV3(wrongSection), false);
  const stale = structuredClone(input);
  (stale.sourceDecisions["S1"] as Record<string, unknown>).revisionStatus = "SUPERSEDED";
  assert.equal(verifyZu127PageSelectionV3(stale), false);
  const positiveFinding = structuredClone(input);
  (positiveFinding.workerResult as Record<string, unknown>).findings = [{ code: "ZU-127" }];
  assert.equal(verifyZu127PageSelectionV3(positiveFinding), false);
});

test.skipIf(!pythonAvailable)("accepts Python blocked-source and mixed-stage ABSTAIN fixtures", () => {
  const blocked = fixture();
  delete blocked.sourceDecisions["S1"];
  const blockedResult = recomputeWithPython(blocked);
  assert.equal(verifyZu127PageSelectionV3(blockedResult), true);
  assert.equal((blockedResult.workerResult as Record<string, any>)
    .sourceRows[0].reasonCodes[0], "SOURCE_REVIEW_REQUIRED");

  const mixed = fixture();
  (mixed.sources[0] as Record<string, unknown>).stages = ["PD", "RD"];
  const mixedResult = recomputeWithPython(mixed);
  assert.equal(verifyZu127PageSelectionV3(mixedResult), true);
  assert.equal((mixedResult.workerResult as Record<string, any>)
    .sourceRows[0].reasonCodes[0], "PAGE_STAGE_REVIEW_REQUIRED");
});
