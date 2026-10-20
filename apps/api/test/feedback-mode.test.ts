import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { pythonExecutable, pythonEnv, projectRoot } from "./python.js";
import { v7FullVisualProposalProfile, v7FullVisualProposalConfigHash, v7SampleVisualProposalProfile,
  v7SampleVisualProposalConfigHash, selectedVisualVlmOrdinals, validateVisualProposalStageResult, v7FullVisualProposalProfileId, v7SampleVisualProposalProfileId } from "../src/visual-proposal.js";
import { validDocumentContextV2 } from "../src/document-context.js";
describe("feedback v7 immutable modes", () => {
 it("matches Python immutable release hashes and has no full selection sampling", () => {
  const actual = JSON.parse(execFileSync(pythonExecutable, ["-c", `import json\nfrom inspector_worker.visual_proposal_adapter import PROFILE_V7_FULL,PROFILE_HASH_V7_FULL,PROFILE_V7_SAMPLE,PROFILE_HASH_V7_SAMPLE\nprint(json.dumps([PROFILE_V7_FULL,PROFILE_HASH_V7_FULL,PROFILE_V7_SAMPLE,PROFILE_HASH_V7_SAMPLE]))`], { cwd: projectRoot, env: {...process.env, ...pythonEnv, PYTHONPATH:"services/worker"}, encoding:"utf8" }));
  expect(actual).toEqual([v7FullVisualProposalProfile,v7FullVisualProposalConfigHash,v7SampleVisualProposalProfile,v7SampleVisualProposalConfigHash]);
  expect(selectedVisualVlmOrdinals(501,"FULL")).toHaveLength(501);
  expect(selectedVisualVlmOrdinals(501,"SAMPLE")).toHaveLength(2);
 });
 it("verifies metadata and later outline context without dropping mixed systems", () => {
  const actual = JSON.parse(execFileSync(pythonExecutable, ["-c", `import fitz,json\nfrom inspector_worker.document_context import document_context\nd=fitz.open()\nfor _ in range(4): d.new_page()\nd.set_metadata({'title':'Отопление'})\nd.set_toc([[1,'Вентиляция',4]])\nprint(json.dumps(document_context(d),ensure_ascii=False))`], {cwd:projectRoot, env:{...process.env,...pythonEnv,PYTHONPATH:"services/worker"},encoding:"utf8"}));
  expect(validDocumentContextV2(actual,4)).toBe(true);
  expect(actual.status).toBe("MIXED");
  actual.domains.pop(); expect(validDocumentContextV2(actual,4)).toBe(false);
 });
 it("accepts real Python FULL and SAMPLE artifacts and rejects omitted full observations", () => {
  const results = JSON.parse(execFileSync(pythonExecutable, ["-c", `import fitz,json,tempfile,hashlib
from pathlib import Path
from unittest.mock import patch
from inspector_worker.visual_proposal_adapter import VisualProposalAdapter,PROFILE_ID_V7_FULL,PROFILE_ID_V7_SAMPLE,PROFILE_HASH_V7_FULL,PROFILE_HASH_V7_SAMPLE
with tempfile.TemporaryDirectory() as root:
 p=Path(root)/'source.pdf'
 with fitz.open() as d:
  for _ in range(3):
   page=d.new_page(width=200,height=100)
   page.draw_rect(fitz.Rect(20,10,26,60),color=(1,0,0),width=.4)
   page.draw_line(fitz.Point(26,30),fitz.Point(65,30),color=(0,0,1))
  d.set_metadata({'title':'Отопление и вентиляция'});d.save(p)
 digest=hashlib.sha256(p.read_bytes()).hexdigest()
 results=[]
 for profile,config in [(PROFILE_ID_V7_FULL,PROFILE_HASH_V7_FULL),(PROFILE_ID_V7_SAMPLE,PROFILE_HASH_V7_SAMPLE)]:
  lease={'objectId':'OBJ-TEST','inputManifestHash':'a'*64,'release':{'lifecycle':'DRAFT','providerSlot':{'stageJobType':'ENTITY_EXTRACTION','providerKind':'ENTITY_EXTRACTION_MODEL','status':'CONFIGURED','profileId':profile,'adapterVersion':'7','configHash':config}},'inputs':{'sourceFiles':[{'sourceFileId':'FIL-TEST','sha256':digest,'byteSize':p.stat().st_size,'mediaType':'application/pdf','downloadPath':'/api/internal/v1/jobs/test/inputs/FIL-TEST'}]}}
  with patch('inspector_worker.visual_proposal_adapter._download_source',side_effect=lambda _url,dest,*_:dest.write_bytes(p.read_bytes())),patch.dict('os.environ',{},clear=True):
   results.append(VisualProposalAdapter().execute(lease,{}))
 print(json.dumps(results,ensure_ascii=False))`], { cwd: projectRoot, env: {...process.env, ...pythonEnv}, encoding:"utf8" }));
  for (const [index, profile] of [v7FullVisualProposalProfileId,v7SampleVisualProposalProfileId].entries()) {
    const result = results[index];
    const expected = [{apiId:"FIL-TEST",sha256:result.analysis.sources[0].sourceSha256,pageCount:3}];
    expect(validateVisualProposalStageResult(result,"a".repeat(64),"OBJ-TEST",expected,profile)).toBeDefined();
    expect(result.analysis.sources[0].vlm.observations).toHaveLength(index === 0 ? 3 : 2);
    if (index === 0) {
      result.analysis.sources[0].vlm.observations.pop();
      expect(validateVisualProposalStageResult(result,"a".repeat(64),"OBJ-TEST",expected,profile)).toBeUndefined();
    }
  }
 });
});
