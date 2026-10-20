import {expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildApp} from '../src/app.js';
import {buildDocumentTextV3AuditReleaseTextLayer} from '../src/document-text-v3-audit-release.js';
import type {AuthenticatedActor,IdentityService} from '../src/identity.js';
import type {InspectionRepository} from '../src/repository.js';

// Original-backed whole manual frozen before the v3 producer. Only current profile
// substitution is allowed; raw/native/path/quality channels remain byte-semantic exact.
const manualBytes=readFileSync(new URL('../../../fixtures/document-text-v3-v1/qa-core-manual-goldens.json',import.meta.url));
const canonical=(v:any):string=>v!==null&&typeof v==='object'?Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');

it('authenticates source-audit GET, serializes the full original located/unlocated artifact unchanged, never writes',async()=>{
 const artifact=structuredClone(JSON.parse(manualBytes.toString()).cases[0].artifact);
 const layer=buildDocumentTextV3AuditReleaseTextLayer();
 artifact.extractorProfile=structuredClone(layer.extractorProfile);artifact.extractorProfileHash=layer.extractorProfileHash;
 const expected={schemaVersion:'document-text-v3-source-read-v1',purpose:'SOURCE_AUDIT_ONLY',checkId:'CHK-QA-AUDIT',sourceFileId:artifact.sourceFileId,sourceSha256:artifact.inputSha256,inputManifestHash:'a'.repeat(64),textStageContentHash:'b'.repeat(64),textArtifactByteSha256:digest(artifact),textArtifactContentHash:digest({hashDomain:'document-text-v3-content-v1',artifact}),extractorProfileHash:artifact.extractorProfileHash,stage:'PD',pageStages:{},latestReviewHash:null,authorityStatus:'SOURCE_DECLARED_UNVERIFIED',renderedVisibility:'UNVERIFIED',calibratedProbability:null,textArtifact:artifact};
 const before=structuredClone(expected);
 const actor:AuthenticatedActor={sessionId:'session-audit',userId:'reader-audit',organizationId:'org-audit',displayName:'Audit reader',roles:['INSPECTOR'],capabilities:['SOURCE_REVIEW'],csrfHash:'c'.repeat(64),expiresAt:'2030-01-01T00:00:00Z'};
 const get=vi.fn().mockResolvedValue(expected),write=vi.fn(()=>{throw Error('read-only route must not write');});
 const identity:IdentityService={login:async()=>undefined,resolveSession:async token=>token==='qa-session'?actor:undefined,verifyCsrf:()=>false,revokeSession:async()=>undefined,close:async()=>undefined};
 const app=await buildApp({repository:{getDocumentTextV3Source:get,recordSourceReviewCommand:write,createObject:write,startCheck:write} as unknown as InspectionRepository,identityService:identity});
 const url='/api/checks/CHK-QA-AUDIT/source-text-v3?sourceFileId='+encodeURIComponent(artifact.sourceFileId);
 try{
  const unauthorized=await app.inject({method:'GET',url});expect(unauthorized.statusCode).toBe(401);expect(get).not.toHaveBeenCalled();
  const response=await app.inject({method:'GET',url,headers:{cookie:'inspector_session=qa-session'}});
  expect(response.statusCode,response.body).toBe(200);expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.json()).toEqual(expected);expect(expected).toEqual(before);
  expect(get).toHaveBeenCalledExactlyOnceWith('CHK-QA-AUDIT',artifact.sourceFileId,actor);
  expect(artifact.pages.some((p:any)=>p.locatedLines.length>0)).toBe(true);expect(artifact.pages.some((p:any)=>p.unlocatedLines.length>0)).toBe(true);
  expect(response.json().textArtifact.pages).toEqual(before.textArtifact.pages);
  expect(response.json().textArtifactByteSha256).not.toBe(response.json().textArtifactContentHash);
  get.mockResolvedValueOnce(undefined);
  const missing=await app.inject({method:'GET',url,headers:{cookie:'inspector_session=qa-session'}});
  expect(missing.statusCode).toBe(404);expect(missing.json()).toMatchObject({error:'NOT_FOUND'});expect(missing.body).not.toContain('locatedLines');
  expect(write).not.toHaveBeenCalled();
 }finally{await app.close();}
});
