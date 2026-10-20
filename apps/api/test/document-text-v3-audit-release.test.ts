import { expect,it } from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {buildDocumentTextV3AuditReleaseTextLayer,validateDocumentTextV3AuditRelease} from '../src/document-text-v3-audit-release.js';
const hash=(p:string)=>createHash('sha256').update(readFileSync(new URL(p,import.meta.url))).digest('hex');
it('explicit audit release pins exact new modules and full analyzed-figure profile',()=>{
 const value=buildDocumentTextV3AuditReleaseTextLayer();
 expect(Object.keys(value).sort()).toEqual(['artifactSchemaVersion','purpose','extractorProfile','extractorProfileHash','processorVersion','processorSourceSha256','cachePolicyVersion','cacheSourceSha256'].sort());
 expect(value.artifactSchemaVersion).toBe('document-text-v3');expect(value.purpose).toBe('SOURCE_AUDIT_ONLY');
 expect(value.extractorProfile.traversalPolicyVersion).toBe('pdfminer-analyzed-figures-boxes-flow-none-v1');
 expect(value.processorSourceSha256).toBe(hash('../../../services/worker/inspector_worker/durable_text_v3.py'));
 expect(value.cacheSourceSha256).toBe(hash('../../../services/worker/inspector_worker/durable_text_v3_cache.py'));
 expect(validateDocumentTextV3AuditRelease(value,{requireCurrentProducer:true})).toBe(true);
});
it('rejects wrong purpose/schema/profile/pins without mutating release',()=>{
 const original=buildDocumentTextV3AuditReleaseTextLayer();
 for(const [field,value] of [['purpose','ENGINEERING'],['artifactSchemaVersion','document-text-v2'],['processorVersion','wrong'],['cachePolicyVersion','wrong'],['processorSourceSha256','0'.repeat(64)],['cacheSourceSha256','0'.repeat(64)],['extractorProfileHash','0'.repeat(64)],['extra',null]] as Array<[string,unknown]>){
  const candidate={...structuredClone(original),[field]:value},before=structuredClone(candidate);
  expect(validateDocumentTextV3AuditRelease(candidate,{requireCurrentProducer:true}),String(field)).toBe(false);expect(candidate).toEqual(before);
 }
});
it('historical matching tuple validates structurally but fails current producer policy',()=>{
 const historical=structuredClone(buildDocumentTextV3AuditReleaseTextLayer());historical.extractorProfile.documentTextV3SourceSha256='1'.repeat(64);historical.processorSourceSha256='2'.repeat(64);historical.cacheSourceSha256='3'.repeat(64);
 const canonical=(v:any):string=>v!==null&&typeof v==='object'?Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
 historical.extractorProfileHash=createHash('sha256').update(canonical({hashDomain:'document-text-extractor-profile-v1',profile:historical.extractorProfile})).digest('hex');
 expect(validateDocumentTextV3AuditRelease(historical,{requireCurrentProducer:false})).toBe(true);
 expect(validateDocumentTextV3AuditRelease(historical,{requireCurrentProducer:true})).toBe(false);
});
