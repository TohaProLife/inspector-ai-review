/** Transport/serialization proof only. Real persistence and provenance have separate PostgreSQL tests. */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { InspectorStore } from "../src/store.js";
import type { AuthenticatedActor, IdentityService } from "../src/identity.js";

const helpers = JSON.parse(readFileSync(new URL("../../../fixtures/matrix-column-pylon-section-v2-v1/qa-independent-helper-goldens.json",import.meta.url),"utf8"));
const fixture = helpers.cases[0], journal = fixture.journal, input = fixture.expectedRequest;
const actor: AuthenticatedActor = { sessionId:randomUUID(),userId:journal.actorId,organizationId:randomUUID(),
  displayName:"Transport fixture",roles:["INSPECTOR"],capabilities:["SOURCE_REVIEW"],csrfHash:"a".repeat(64),expiresAt:"2030-01-01T00:00:00Z" };
const identity: IdentityService = { login:async()=>undefined,resolveSession:async token=>token==="session"?actor:undefined,
  verifyCsrf:(_actor,token)=>token==="csrf",revokeSession:async()=>undefined,close:async()=>undefined };
const headers = { cookie:"inspector_session=session; inspector_csrf=csrf","x-csrf-token":"csrf",
  "content-type":"application/json","idempotency-key":"root-v2-review-transport" };
const url = `/api/objects/${journal.objectId}/column-pylon-section-reviews-v2`;
async function setup() {
  const store = await InspectorStore.create(), permission = vi.fn().mockResolvedValue(true);
  const record = vi.fn().mockResolvedValue({kind:"success",value:journal,replayed:false});
  const comparison = vi.fn().mockResolvedValue({schemaVersion:"matrix-kr060-column-pylon-comparison-v2",status:"ABSTAIN",
    reasonCode:"PAIR_REVIEW_UNAPPROVED",identity:journal.projection.identity,comparison:null,calibratedProbability:null});
  const list = vi.fn().mockResolvedValue({items:[journal],canReview:true});
  Object.assign(store,{hasObjectPermission:permission,recordColumnPylonSectionV2ReviewCommand:record,
    getColumnPylonSectionV2Reviews:list,previewColumnPylonSectionV2Comparison:comparison});
  return {app:await buildApp({repository:store,identityService:identity}),record,comparison,list,permission};
}
it("preserves the whole frozen journal, current actor, replay header and list serialization",async()=>{
  const {app,record,list}=await setup();try {
    const response=await app.inject({method:"POST",url,headers,payload:input});
    expect(response.statusCode,response.body).toBe(201);expect(response.json()).toEqual(journal);
    expect(record).toHaveBeenCalledExactlyOnceWith(journal.objectId,input,expect.objectContaining({actor,idempotencyKey:headers["idempotency-key"]}));
    record.mockResolvedValueOnce({kind:"success",value:journal,replayed:true});
    const replay=await app.inject({method:"POST",url,headers,payload:input});expect(replay.statusCode,replay.body).toBe(201);
    expect(replay.json()).toEqual(journal);expect(replay.headers["idempotency-replayed"]).toBe("true");
    const read=await app.inject({method:"GET",url,headers});expect(read.statusCode,read.body).toBe(200);
    expect(read.json()).toEqual({items:[journal],canReview:true});expect(list).toHaveBeenCalledExactlyOnceWith(journal.objectId,actor);
    expect(read.headers["cache-control"]).toBe("private, no-store");
  } finally {await app.close();}
});
it("requires session, CSRF, object permission and idempotency before any mutation",async()=>{
  const {app,record,permission}=await setup();try {
    expect((await app.inject({method:"POST",url,payload:input})).statusCode).toBe(401);
    expect((await app.inject({method:"POST",url,headers:{cookie:headers.cookie},payload:input})).statusCode).toBe(403);
    const {"idempotency-key":_key,...withoutKey}=headers;
    expect((await app.inject({method:"POST",url,headers:withoutKey,payload:input})).statusCode).toBe(428);
    permission.mockResolvedValueOnce(false);
    expect((await app.inject({method:"POST",url,headers,payload:input})).statusCode).toBe(403);expect(record).not.toHaveBeenCalled();
  } finally {await app.close();}
});
it("rejects decoded duplicate keys, fractional/exponent lexemes, invalid UTF8/BOM and authority extras before AJV",async()=>{
  const {app,record}=await setup();try {
    const raw=JSON.stringify(input), duplicate=`{"schemaVersion":${JSON.stringify(input.schemaVersion)},${raw.slice(1)}`;
    const number=/(:|\[|,)\s*([0-9]+)(?=[,\]}])/;
    expect(number.test(raw)).toBe(true);
    const payloads=[duplicate,raw.replace(number,"$1$2.0"),raw.replace(number,"$1$2e0"),"\ufeff"+raw,
      JSON.stringify({...input,contentHash:"a".repeat(64)}),Buffer.concat([Buffer.from(raw.slice(0,-1)),Buffer.from([0xff]),Buffer.from("}")])];
    for (const payload of payloads) {const response=await app.inject({method:"POST",url,headers,payload});expect(response.statusCode,response.body).toBe(400);}
    expect((await app.inject({method:"POST",url,headers,payload:" ".repeat(524289)})).statusCode).toBe(413);
    expect(record).not.toHaveBeenCalled();
  } finally {await app.close();}
});
it("comparison accepts exactly one latest decision UUID without silently removing extra fields",async()=>{
  const {app,comparison}=await setup(),preview=url.replace("reviews-v2","comparison-v2");try {
    const bad=[JSON.stringify({reviewDecisionId:journal.id,extra:true}),`{"reviewDecisionId":"${journal.id}","reviewDecisionId":"${journal.id}"}`,
      JSON.stringify({reviewDecisionId:journal.id,calibratedProbability:1}),"\ufeff"+JSON.stringify({reviewDecisionId:journal.id})];
    for (const payload of bad) {const response=await app.inject({method:"POST",url:preview,headers,payload});expect(response.statusCode,response.body).toBe(400);}
    expect(comparison).not.toHaveBeenCalled();
    const good=await app.inject({method:"POST",url:preview,headers,payload:{reviewDecisionId:journal.id}});expect(good.statusCode,good.body).toBe(200);
    expect(good.json().calibratedProbability).toBeNull();expect(comparison).toHaveBeenCalledExactlyOnceWith(journal.objectId,journal.id,actor);
    comparison.mockResolvedValueOnce({kind:"invalid_state",code:"KR060_STALE_REVIEW",message:"Changed"});
    expect((await app.inject({method:"POST",url:preview,headers,payload:{reviewDecisionId:journal.id}})).statusCode).toBe(409);
  } finally {await app.close();}
});
it("maps bounded storage failures and resource limits without returning a comparison",async()=>{
  const {app,record}=await setup();try {
    for(const [code,status]of [["KR060_PDF_STORAGE_UNAVAILABLE",503],["KR060_PDF_IO_BUSY",503],["KR060_PDF_IO_DEADLINE",503],
      ["KR060_INPUT_LIMIT",413],["KR060_PDF_BYTES_MISMATCH",409]]) {
      record.mockResolvedValueOnce({kind:"invalid_state",code,message:"Unavailable"});
      const response=await app.inject({method:"POST",url,headers,payload:input});expect(response.statusCode,response.body).toBe(status);expect(response.json()).toEqual({error:code,message:"Unavailable"});
    }
  } finally {await app.close();}
});
