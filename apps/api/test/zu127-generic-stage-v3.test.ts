import { pythonExecutable, pythonEnv, pythonAvailable } from "./python.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test, vi } from "vitest";
import { pythonHash } from "../src/trusted-page-words.js";
import { verifyZu127GenericStageV3, ZU127_GENERIC_V3_CONFIG_HASH,
  type AuthenticatedZu127GenericV3Input } from "../src/zu127-generic-stage-v3.js";

const original = vi.hoisted(() => ({ popplerCalls: 0, corruptXml: false }));
const xml = `<html><body><page width="595.320000" height="841.920000"><word xMin="450.220000" yMin="147.297320" xMax="467.800000" yMax="156.261320">0,65</word></page></body></html>`;
const plain = "Сопротивление теплопередаче окна\n";
const pdf = Buffer.from("%PDF-1.7 synthetic ZU document bytes", "utf8");
const python = pythonExecutable;

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile: (program: string, args: string[], _options: unknown,
    callback: (error: Error | null, stdout: Buffer, stderr: Buffer) => void) => {
    original.popplerCalls += 1;
    if (args[0] === "-v") {
      callback(null, Buffer.alloc(0), Buffer.from(
        `${program} version 25.12.0\nCopyright Poppler\n`));
    } else if (program === "pdfinfo") {
      callback(null, Buffer.from("Pages: 6\nEncrypted: no\n"), Buffer.alloc(0));
    } else if (args.includes("-bbox-layout")) {
      callback(null, Buffer.from(original.corruptXml ? xml.replace("0,65", "0,85") : xml),
        Buffer.alloc(0));
    } else if (args.includes("-raw")) {
      callback(null, Buffer.from(plain), Buffer.alloc(0));
    } else {
      callback(new Error("unexpected Poppler invocation"), Buffer.alloc(0), Buffer.alloc(0));
    }
  },
}));

const fixtureScript = `import base64,hashlib,json
from pathlib import Path
from inspector_worker.zu127_generic_stage_v3 import evaluate_fenced_zu127_generic_stage_v3,PROFILE_CONFIG_HASH,PROFILE_ID
from services.worker.tests.test_zu127_generic_stage_v3 import setup,ATTEMPT,PDF,digest
lease,artifact=setup()
xml=${JSON.stringify(xml)}.encode()
plain=${JSON.stringify(plain)}.encode()
def extract(_path,**scope):
 pages=[]
 for number in scope['page_numbers']:
  words=[{'wordIndex':0,'rawText':'0,65','bboxMilliPointsTopLeft':[450220,147297,467800,156261]}]
  body={'providerId':'worker-poppler-pdftotext-bbox-layout-v1@25.12.0',
   'sourceSha256':scope['expected_sha256'],'pdfPageCount':scope['expected_page_count'],
   'pageNumber':number,'pageWidthMilliPoints':595320,'pageHeightMilliPoints':841920,
   'xmlSha256':hashlib.sha256(xml).hexdigest(),'plainTextSha256':hashlib.sha256(plain).hexdigest(),
   'pageText':plain.decode(),'words':words,'wordArtifactSha256':digest(words)}
  pages.append({**body,'inspectionSha256':digest(body)})
 body={'schemaVersion':'poppler-page-evidence-v1','purpose':'REVIEW_ONLY',
  'sourceSha256':scope['expected_sha256'],'sourceByteSize':scope['expected_byte_size'],
  'pdfPageCount':scope['expected_page_count'],'selectedPageNumbers':scope['page_numbers'],
  'pageEvidence':pages,'absenceConclusion':'NOT_AVAILABLE',
  'typedFacts':None,'findings':None,'parameterCoverage':None}
 return {**body,'contentHash':digest(body)}
def text(_lease,_source,_attempt): return artifact
def source(_path,target,_sha,_size,_attempt): target.write_bytes(PDF)
import sys
if sys.argv[-1]=='blocked':
 lease['inputs']['sourceDecisions']={}
 lease['inputs']['sourceFiles'][0]['sectionCode']=None
result=evaluate_fenced_zu127_generic_stage_v3(lease,ATTEMPT,download_text=text,
 download_source=source,extract_pages=extract)
print(json.dumps({'profileConfigHash':PROFILE_CONFIG_HASH,'input':{
 'jobId':lease['jobId'],'runId':lease['runId'],'objectId':lease['objectId'],
 'inputManifestHash':lease['inputManifestHash'],'releaseId':lease['releaseId'],
 'releaseManifestHash':lease['release']['manifestHash'],'providerProfileId':PROFILE_ID,
 'providerConfigHash':PROFILE_CONFIG_HASH,'sourceFiles':lease['inputs']['sourceFiles'],
 'sourceDecisions':lease['inputs']['sourceDecisions'],
 'textArtifacts':[{'sourceFileId':'S1','contentSha256':digest(artifact),'artifact':artifact}],
 'workerResult':result}},ensure_ascii=False))`;

function fixture(blocked = false): {
  profileConfigHash: string;
  input: Omit<AuthenticatedZu127GenericV3Input, "originalPdfBytesForSource">;
} {
  return JSON.parse(execFileSync(python, ["-c", fixtureScript, blocked ? "blocked" : "eligible"], {
    encoding: "utf8", env: { ...process.env, ...pythonEnv },
  })) as ReturnType<typeof fixture>;
}

function withOriginal(blocked = false): AuthenticatedZu127GenericV3Input {
  return { ...fixture(blocked).input, originalPdfBytesForSource: async () => pdf };
}

test.skipIf(!pythonAvailable)("accepts Python worker wrapper with four complete page replays", async () => {
  const fromPython = fixture();
  assert.equal(fromPython.profileConfigHash,
    "e593f2298e672177bbeac05cd9b6cda6f4926a3a9260ea3b3c35dbf63010264c");
  assert.equal(ZU127_GENERIC_V3_CONFIG_HASH, fromPython.profileConfigHash);
  original.popplerCalls = 0;
  assert.equal(await verifyZu127GenericStageV3(withOriginal()), true);
  assert.equal(original.popplerCalls, 11); // Two version checks, pdfinfo, two tools per page.
});

test.skipIf(!pythonAvailable)("blocked source never fetches original PDF", async () => {
  const input = withOriginal(true);
  input.originalPdfBytesForSource = async () => { throw Error("PDF must not be fetched"); };
  original.popplerCalls = 0;
  assert.equal(await verifyZu127GenericStageV3(input), true);
  assert.equal(original.popplerCalls, 0);
});

test.skipIf(!pythonAvailable)("rejects wrapper hash, decision hash and scope tampering", async () => {
  for (const mutate of [
    (input: AuthenticatedZu127GenericV3Input) => {
      (input.workerResult as Record<string, unknown>).contentHash = "0".repeat(64);
    },
    (input: AuthenticatedZu127GenericV3Input) => {
      (input.workerResult as Record<string, unknown>).sourceDecisionSnapshotSha256 = "0".repeat(64);
    },
    (input: AuthenticatedZu127GenericV3Input) => {
      input.providerConfigHash = "0".repeat(64);
    },
    (input: AuthenticatedZu127GenericV3Input) => {
      (input.workerResult as Record<string, unknown>).findings = [];
    },
    (input: AuthenticatedZu127GenericV3Input) => {
      (input.workerResult as Record<string, unknown>).pageReceipts = [];
    },
    (input: AuthenticatedZu127GenericV3Input) => {
      (input.workerResult as Record<string, unknown>).extra = "forged";
    },
  ]) {
    const input = withOriginal();
    mutate(input);
    assert.equal(await verifyZu127GenericStageV3(input), false);
  }
});

test.skipIf(!pythonAvailable)("rejects PDF byte swap, complete-word change and text artifact change", async () => {
  const wrongPdf = withOriginal();
  wrongPdf.originalPdfBytesForSource = async () => Buffer.from("%PDF-wrong");
  assert.equal(await verifyZu127GenericStageV3(wrongPdf), false);
  const wrongPoppler = withOriginal();
  original.corruptXml = true;
  assert.equal(await verifyZu127GenericStageV3(wrongPoppler), false);
  original.corruptXml = false;
  const wrongText = withOriginal();
  const entry = wrongText.textArtifacts[0] as Record<string, any>;
  entry.artifact.pages[0].blocks[0].text = "подмена";
  entry.contentSha256 = pythonHash(entry.artifact);
  assert.equal(await verifyZu127GenericStageV3(wrongText), false);
});
