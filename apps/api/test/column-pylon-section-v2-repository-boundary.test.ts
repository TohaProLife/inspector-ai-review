import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { ColumnPylonSectionV2Repository, type ColumnPylonSectionRepositoryPorts } from "../src/postgres-column-pylon-section-v2.js";
import type { AuditedMutationCommand } from "../src/repository.js";
import { columnPylonSectionPairKey } from "../src/matrix-column-pylon-section-v2.js";

it("self-pair is a bounded invalid request before DB or PDF access",async()=>{
  const helpers=JSON.parse(readFileSync(new URL("../../../fixtures/matrix-column-pylon-section-v2-v1/qa-independent-helper-goldens.json",import.meta.url),"utf8"));
  const input=structuredClone(helpers.cases[0].expectedRequest);input.actual.sourceFileId=input.expected.sourceFileId;
  const transact=vi.fn(()=>{throw Error("Self-pair must not reach SQL");});
  const repository=new ColumnPylonSectionV2Repository({transact} as unknown as ColumnPylonSectionRepositoryPorts);
  const command={actor:{capabilities:["SOURCE_REVIEW"]}} as AuditedMutationCommand;
  await expect(repository.record("OBJ-SELF-PAIR",input,command)).resolves.toMatchObject({kind:"invalid_state",code:"KR060_INVALID_INPUT"});
  expect(transact).not.toHaveBeenCalled();
});

it("a rehashed withdrawal cannot change the immediately prior projection payload",async()=>{
  const packet=JSON.parse(readFileSync(new URL("../../../fixtures/matrix-column-pylon-section-v2/owner-manual-review.json",import.meta.url),"utf8"));
  const sample=packet.materializationCases[0],prior=sample.context.previous,withdrawn=structuredClone(sample.expected);
  const canonical=(value:any):string=>value!==null&&typeof value==="object"?Array.isArray(value)?"["+value.map(canonical).join(",")+"]"
    :"{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}":JSON.stringify(value);
  const hash=(value:any)=>createHash("sha256").update(canonical(value)).digest("hex");
  function rehash(value:any){const {contentHash:_p,...p}=value.projection;
    value.projection.contentHash=hash({hashDomain:"matrix-kr060-column-pylon-pair-projection-json-v2",projection:p});
    const {contentHash:_j,...j}=value;value.contentHash=hash({hashDomain:"matrix-kr060-column-pylon-pair-journal-json-v2",journal:j});}
  const objectId="00000000-0000-4000-8000-000000000082";
  function row(value:any,sequence:string){return {id:value.id,sequence_no:sequence,object_id:objectId,
    pair_key:columnPylonSectionPairKey({objectId:value.objectId,identity:value.projection.identity,
      expectedSourceFileId:value.projection.expected.sourceFileId,actualSourceFileId:value.projection.actual.sourceFileId}),
    expected_source_file_id:"00000000-0000-4000-8000-000000000083",actual_source_file_id:"00000000-0000-4000-8000-000000000084",
    expected_source_api_id:value.projection.expected.sourceFileId,actual_source_api_id:value.projection.actual.sourceFileId,
    expected_review_decision_id:value.projection.expected.sourceReviewDecisionId,actual_review_decision_id:value.projection.actual.sourceReviewDecisionId,
    previous_decision_id:value.previousDecisionId,previous_review_hash:value.previousReviewHash,projection_json:value.projection,
    actor_id:value.actorId,content_hash:value.contentHash,created_at:value.createdAt};}
  const client={query:vi.fn().mockResolvedValue({rows:[row(prior,"1")]})};
  const repository=new ColumnPylonSectionV2Repository({}as ColumnPylonSectionRepositoryPorts);
  await expect((repository as any).chain(client,row(withdrawn,"2"),objectId,withdrawn.objectId)).resolves.toEqual(withdrawn);
  withdrawn.projection.reference="Altered withdrawal reference";rehash(withdrawn);
  await expect((repository as any).chain(client,row(withdrawn,"2"),objectId,withdrawn.objectId)).rejects.toMatchObject({code:"KR060_INPUT_INTEGRITY"});
});
