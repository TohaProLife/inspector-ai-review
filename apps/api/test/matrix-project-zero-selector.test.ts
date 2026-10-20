import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { deriveMatrixFactTarget, portableEvidenceHash } from "../src/matrix-fact-scope.js";
import { pythonEnv, pythonExecutable } from "./python.js";

it("binds literal project-zero unit declarations into independent portable selectors",()=>{
  const result=spawnSync(pythonExecutable,["-c",`import json,sys
from inspector_worker.matrix_engine import build_matrix_execution
from inspector_worker.matrix_fact_scope import derive_matrix_fact_target
f=json.load(sys.stdin)
sources=[{'sourceFileId':i['source']['file_id'],'sha256':i['source']['sha256'],'objectId':'selector-test','stages':[i['source']['stage']]} for i in f['sources']]
artifacts=[i['sourceArtifact'] for i in f['sources']]
r=build_matrix_execution(object_id='selector-test',input_manifest_hash='a'*64,sources=sources,text_artifacts=artifacts)
a=artifacts[1]
o=next(o for o in r['observations'] if o['attribute']=='PROJECT_ZERO_ABSOLUTE_ELEVATION' and o['stage']=='RD')
json.dump({'fact':o,'artifact':a,'target':derive_matrix_fact_target(o,a)},sys.stdout,ensure_ascii=False)`],
    {input:readFileSync(new URL("../../../services/worker/tests/fixtures/project-zero-F0101-F0139.json",import.meta.url)),
      encoding:"utf8",maxBuffer:8*1024*1024,env:{...process.env,...pythonEnv},timeout:30000});
  expect(result.status,result.stderr).toBe(0);
  const {fact,artifact,target}=JSON.parse(result.stdout);
  expect(fact.contextFragments).toHaveLength(2);
  expect(fact.contextFragments.map((part:any)=>part.role)).toEqual(["UNIT_DECLARATION","UNIT_DECLARATION"]);
  expect(deriveMatrixFactTarget(fact,artifact)).toEqual(target);
  expect(target.fragmentsHash).toBe(portableEvidenceHash(fact.contextFragments));
  for(const mutate of [(f:any)=>f.contextFragments.reverse(),(f:any)=>f.contextFragments[0].role="TABLE_SCOPE",
    (f:any)=>f.contextFragments[0].rawText+=" "]){
    const changed=structuredClone(fact);mutate(changed);
    expect(deriveMatrixFactTarget(changed,artifact)).not.toEqual(target);
  }
});
