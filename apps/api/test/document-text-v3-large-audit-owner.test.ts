/** Independent finite release/admission expectations. No extraction/runtime proof. */
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildDocumentTextV3LargeAuditReleaseTextLayer,validateDocumentTextV3LargeAuditRelease} from '../src/document-text-v3-large-audit-release.js';
import {validateDocumentTextV3LargeAuditResult} from '../src/document-text-v3-large-audit-admission.js';
import {documentTextV3LargeAuditApiSchemas,documentTextV3LargeAuditApiOperations} from '../src/document-text-v3-large-audit-api-contract.js';
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const canonical=(v:any):string=>v!==null&&typeof v==='object'?Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort((a,b)=>{const aa=Array.from(a,c=>c.codePointAt(0)!),bb=Array.from(b,c=>c.codePointAt(0)!);for(let i=0;i<Math.min(aa.length,bb.length);i++)if(aa[i]!==bb[i])return aa[i]!-bb[i]!;return aa.length-bb.length;}).map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const fileSha=(name:string)=>sha(readFileSync(new URL('../../../services/worker/inspector_worker/'+name,import.meta.url)));
const resource='document-text-v3-large-source-bounds-v1';
function validCase(){
 const release=buildDocumentTextV3LargeAuditReleaseTextLayer();
 const manual=JSON.parse(readFileSync(new URL('../../../fixtures/document-text-v3-vertical-v1/qa-whole-manual-goldens.json',import.meta.url),'utf8'));
 const artifact=structuredClone(manual.cases[0].artifact);artifact.extractorProfile=structuredClone(release.extractorProfile);artifact.extractorProfileHash=release.extractorProfileHash;
 const source={id:'00000000-0000-4000-8000-000000000079',apiId:artifact.sourceFileId,sha256:artifact.inputSha256,mediaType:'application/pdf'};
 const result={disposition:'DOCUMENT_TEXT_LAYER_COMPLETED',purpose:'SOURCE_AUDIT_ONLY',resourcePolicyVersion:resource,sources:[{sourceFileId:source.apiId,inputSha256:source.sha256,status:'EXTRACTED',artifact}],workerId:'worker-large-owner'};
 return {release,artifact,source,result};
}
it('new closed release pins actual files at call time and fixed vertical/resource/profile identity',()=>{
 const release=buildDocumentTextV3LargeAuditReleaseTextLayer();
 expect(Object.keys(release).sort()).toEqual(['artifactSchemaVersion','purpose','sourceAuditProfileVersion','resourcePolicyVersion','extractorProfile','extractorProfileHash','processorVersion','processorSourceSha256','cachePolicyVersion','cacheSourceSha256'].sort());
 expect(release.sourceAuditProfileVersion).toBe('SOURCE_AUDIT_V3_LARGE_VERTICAL_V1');expect(release.resourcePolicyVersion).toBe(resource);expect(release.extractorProfile.traversalPolicyVersion).toBe('pdfminer-analyzed-figures-boxes-flow-none-vertical-v1');
 expect(release.extractorProfile.textLayerSourceSha256).toBe(fileSha('text_layer.py'));expect(release.extractorProfile.documentTextV3SourceSha256).toBe(fileSha('document_text_v3.py'));
 expect(release.processorSourceSha256).toBe(fileSha('durable_text_v3_large.py'));expect(release.cacheSourceSha256).toBe(fileSha('durable_text_v3_large_cache.py'));
 expect(release.extractorProfileHash).toBe(sha(canonical({hashDomain:'document-text-extractor-profile-v1',profile:release.extractorProfile})));expect(validateDocumentTextV3LargeAuditRelease(release,{requireCurrentProducer:true})).toBe(true);
});
it('historical structure and current producer are separate; bad closed literals/hash/profile reject',()=>{
 const release=buildDocumentTextV3LargeAuditReleaseTextLayer();
 for(const [key,value] of [['purpose','ENGINEERING'],['sourceAuditProfileVersion','SOURCE_AUDIT_V3'],['resourcePolicyVersion','document-text-v3-standard-bounds-v1'],['processorVersion','durable-document-text-v3-v1'],['cachePolicyVersion','durable-text-layer-v3-cache-v1'],['extra',null],['processorSourceSha256','a'.repeat(64)+'\n'],['extractorProfileHash','0'.repeat(64)]])expect(validateDocumentTextV3LargeAuditRelease({...release,[key as string]:value}),String(key)).toBe(false);
 const historical=structuredClone(release);historical.extractorProfile.documentTextV3SourceSha256='1'.repeat(64);historical.processorSourceSha256='2'.repeat(64);historical.cacheSourceSha256='3'.repeat(64);historical.extractorProfileHash=sha(canonical({hashDomain:'document-text-extractor-profile-v1',profile:historical.extractorProfile}));
 expect(validateDocumentTextV3LargeAuditRelease(historical)).toBe(true);expect(validateDocumentTextV3LargeAuditRelease(historical,{requireCurrentProducer:true})).toBe(false);
 for(const traversal of ['pdfminer-top-level-whole-lines-v1','pdfminer-analyzed-figures-boxes-flow-none-v1']){const wrong:any=structuredClone(release);wrong.extractorProfile.traversalPolicyVersion=traversal;wrong.extractorProfileHash=sha(canonical({hashDomain:'document-text-extractor-profile-v1',profile:wrong.extractorProfile}));expect(validateDocumentTextV3LargeAuditRelease(wrong)).toBe(false);}
});
it('release and option native failures invoke no getters/proxy/toJSON callbacks',()=>{
 let calls=0;const getter=Object.defineProperty({},'purpose',{enumerable:true,get(){calls++;throw Error('getter');}}),proxy=new Proxy({},{ownKeys(){calls++;throw Error('proxy');},getPrototypeOf(){calls++;throw Error('proxy');}}),toJSON={toJSON(){calls++;throw Error('toJSON');}};
 for(const value of [getter,proxy,toJSON,Object.create(null),null,[],{deep:getter}])expect(validateDocumentTextV3LargeAuditRelease(value)).toBe(false);
 const option=Object.defineProperty({},'requireCurrentProducer',{enumerable:true,get(){calls++;throw Error('option');}});expect(validateDocumentTextV3LargeAuditRelease(buildDocumentTextV3LargeAuditReleaseTextLayer(),option as any)).toBe(false);expect(calls).toBe(0);
});
it('whole independently authored vertical artifact admits without mutation, preserving two hash identities and policy',()=>{
 const {release,artifact,source,result}=validCase(),before=structuredClone({release,artifact,source,result});const accepted=validateDocumentTextV3LargeAuditResult(result,[source],release);
 expect(accepted).toBeDefined();expect({release,artifact,source,result}).toEqual(before);expect(accepted!.artifacts).toHaveLength(1);
 const stored=accepted!.artifacts[0]!;expect(stored.canonical).toBe(canonical(artifact));expect(stored.contentHash).toBe(sha(canonical(artifact)));expect(stored.byteSize).toBe(Buffer.byteLength(canonical(artifact)));expect(stored.resourcePolicyVersion).toBe(resource);expect(stored.artifact).not.toBe(artifact);
 expect(accepted!.storedResult).toMatchObject({purpose:'SOURCE_AUDIT_ONLY',resourcePolicyVersion:resource,sourceAuditProfileVersion:'SOURCE_AUDIT_V3_LARGE_VERTICAL_V1',sourceCount:1,extractedCount:1,skippedCount:0,ocrScheduled:false,calibratedProbability:null,authorityStatus:'SOURCE_DECLARED_UNVERIFIED',renderedVisibility:'UNVERIFIED'});
 const item=(accepted!.storedResult.sources as any[])[0];expect(item.artifactContentHash).toBe(sha(canonical({hashDomain:'document-text-v3-content-v1',artifact})));expect(item.contentHash).not.toBe(item.artifactContentHash);expect(item.resourcePolicyVersion).toBe(resource);
});
it('source result bijection and every sibling validate before output, no unsupported-PDF substitution',()=>{
 const {release,source,result}=validCase();
 for(const patch of [{resourcePolicyVersion:'document-text-v3-standard-bounds-v1'},{extra:null},{sources:[]},{sources:[...result.sources,...result.sources]},{sources:[{...result.sources[0],sourceFileId:'foreign'}]},{sources:[{...result.sources[0],inputSha256:'0'.repeat(64)}]},{sources:[{sourceFileId:source.apiId,inputSha256:source.sha256,status:'SKIPPED_UNSUPPORTED_FORMAT',reason:'not extracted'}]}])expect(validateDocumentTextV3LargeAuditResult({...result,...patch},[source],release)).toBeUndefined();
 const second={...source,id:'second-id',apiId:'second-source'};const bad=structuredClone(result.sources[0]!);bad.sourceFileId=second.apiId;bad.artifact.sourceFileId=second.apiId;bad.artifact.pages[0].pageNumber=99;
 expect(validateDocumentTextV3LargeAuditResult({...result,sources:[result.sources[0],bad]},[source,second],release)).toBeUndefined();
 expect(validateDocumentTextV3LargeAuditResult(result,[source,{...source}],release)).toBeUndefined();
});
it('unsupported nonPDF remains a whole explicit skipped source and detached metadata',()=>{
 const release=buildDocumentTextV3LargeAuditReleaseTextLayer(),source={id:'skip-id',apiId:'skip-source',sha256:'b'.repeat(64),mediaType:'application/octet-stream'},result={disposition:'DOCUMENT_TEXT_LAYER_COMPLETED',purpose:'SOURCE_AUDIT_ONLY',resourcePolicyVersion:resource,sources:[{sourceFileId:source.apiId,inputSha256:source.sha256,status:'SKIPPED_UNSUPPORTED_FORMAT',reason:'Unsupported format'}],workerId:'worker'};
 const accepted=validateDocumentTextV3LargeAuditResult(result,[source],release);expect(accepted).toBeDefined();expect(accepted!.artifacts).toEqual([]);expect(accepted!.storedResult).toMatchObject({sourceCount:1,skippedCount:1,extractedCount:0});
 for(const reason of ['', 'x'.repeat(501)])expect(validateDocumentTextV3LargeAuditResult({...result,sources:[{...result.sources[0],reason}]},[source],release)).toBeUndefined();
});
it('result/release/source callbacks never run; all unknown arguments guard descriptor-first',()=>{
 const {release,source,result}=validCase();let calls=0;const getter=Object.defineProperty({},'sources',{enumerable:true,get(){calls++;throw Error('getter');}}),proxy=new Proxy({},{getPrototypeOf(){calls++;throw Error('proxy');},ownKeys(){calls++;throw Error('proxy');}});
 for(const value of [getter,proxy,{...result,hidden:{toJSON(){calls++;throw Error('toJSON');}}}])expect(validateDocumentTextV3LargeAuditResult(value,[source],release)).toBeUndefined();
 const badSource=Object.defineProperty({...source},'sha256',{enumerable:true,get(){calls++;throw Error('source');}});expect(validateDocumentTextV3LargeAuditResult(result,[badSource],release)).toBeUndefined();expect(validateDocumentTextV3LargeAuditResult(result,[source],proxy as any)).toBeUndefined();expect(calls).toBe(0);
});
it('whole result limit applies before closed semantic rejection, without mutating payload',()=>{
 const {release,source,result}=validCase();const value={...result,padding:Array(17).fill('x'.repeat(1999999))};expect(Buffer.byteLength(canonical(value))).toBeGreaterThan(32000000);expect(validateDocumentTextV3LargeAuditResult(value,[source],release)).toBeUndefined();expect(value.padding).toHaveLength(17);
},30000);
it('API contract derives exact sourceRead19/start empty shapes and distinct versioned operations',()=>{
 const schemas=documentTextV3LargeAuditApiSchemas as any,read=schemas.DocumentTextV3LargeAuditSourceRead;
 expect(read.additionalProperties).toBe(false);expect(read.required).toHaveLength(19);expect(read.properties.resourcePolicyVersion.const).toBe(resource);expect(read.properties.calibratedProbability.type).toBe('null');expect(schemas.SourceAuditV3LargeVerticalInput).toEqual({type:'object',additionalProperties:false,properties:{}});
 expect(documentTextV3LargeAuditApiOperations.map(x=>x.fastifyPath)).toEqual(['/api/objects/:id/source-audit-v3-large-vertical-v1','/api/checks/:id/source-text-v3-large-v1']);
 const serialized=JSON.stringify(documentTextV3LargeAuditApiOperations);expect(serialized).toContain('Idempotency-Key');expect(serialized).toContain('X-CSRF-Token');expect(JSON.stringify(schemas)).not.toContain('$ref');
});
