import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {PostgresInspectionRepository} from '../src/postgres-repository.js';
const manual=JSON.parse(readFileSync(new URL('../../../fixtures/matrix-column-pylon-section-execution-v1/qa-whole-expectations-v2.json',import.meta.url),'utf8'));
for(const test of manual.wholeCases)it(`diagnostic submission preserves scoped semantics: ${test.name??test.id}`,()=>{
 const envelope=structuredClone(test.expected.envelope),before=structuredClone(envelope);
 const identity={objectId:'OBJ-DIAGNOSTIC',fileIds:new Map(),officialIdsVerified:false};
 const execution={observations:[],results:[]};
 const method=(PostgresInspectionRepository.prototype as any).matrixSubmission;
 const output=method.call({},execution,'OBJ-DIAGNOSTIC',identity,undefined,undefined,undefined,undefined,undefined,undefined,envelope);
 const expected=envelope.results.filter((r:any)=>r.kind!=='SCOPED_COMPARISON'||r.comparison.status!=='NO_DECREASE_IN_REVIEWED_PAIR').map((r:any)=>{
  const c=r.kind==='SCOPED_COMPARISON'&&r.comparison.status==='CANDIDATE'?r.comparison.comparison:null;
  return {parameter_code:'M-060',location:r.kind==='SCOPED_COMPARISON'?`${r.identity.entityKey} · пара ${r.pairKey}`:'Рассмотренная пара колонны / пилона не установлена',
   pd_value:c?`${c.expectedAreaMm2} мм²`:null,rd_value:c?`${c.actualAreaMm2} мм²`:null,id_value:null,
   violation_label:'COMPARISON_IMPOSSIBLE',protocol_status:'COMPARISON_IMPOSSIBLE',criticality:r.kind==='SCOPED_COMPARISON'?r.comparison.reasonCode:r.reasonCode,evidence:[]};
 });
 expect(output).toEqual({object_id:'OBJ-DIAGNOSTIC',checks:expected});expect(envelope).toEqual(before);
 if(expected.length===2)expect(new Set(expected.map((r:any)=>r.location)).size).toBe(2);
});
