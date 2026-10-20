import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateVisualProposalStageResult, visualProfileForAnalysisMode, v9SampleVisualProposalProfile,
  v9FullVisualProposalProfile, v9SampleVisualProposalConfigHash, v9FullVisualProposalConfigHash } from "../src/visual-proposal.js";

// Hand-authored policy oracle, independent of DUT object construction.
const samplePolicy = {
  schemaVersion: "visual-proposal-profile-v9", methodId: "red-vector-panel-blue-contact-v1",
  maxPagesPerSource: 1024, maxProposalsPerSource: 500, coordinateSystem: "NORMALIZED_TOP_LEFT",
  contextMethodId: "metadata-outline-page-signals-v2", maxContextPages: 10000,
  vlmMethodId: "spread-two-saved-proposals-server-nonnegative-v1",
  vlmModelId: "inspector-qwen3-vl-8b-fp8", vlmModelRevision: "9cdc6310a8cb770ce18efaf4e9935334512aee45",
  vlmModelLockSha256: "e2586e16f45deee017935d4c60b550e48059fdc02cbc9c9114053f2f1fe4d879",
  vlmModelShards: [
    {filename:"model-00001-of-00002.safetensors",sha256:"e2dea2e85e643ef7045c31a485a426631a1e0a84e463f8b2c7e9c6682a06eafd"},
    {filename:"model-00002-of-00002.safetensors",sha256:"3dc64ec934af27a7007d265014e907aff9e16658d409e5cd4cf79869bf2bd8c1"},
  ],
  vlmPromptSha256: "34a372ca6f4032b74ff51c11dd7adfe14df31b266ca356a5a2ec15b1d56c9611",
  maxVlmObservationsPerSource: 2, vlmCropMaxEdgePx: 2048,
  analysisMode: "SAMPLE", vlmCropMethodId: "normalized-display-square-v2",
};
const fullPolicy = {...samplePolicy, analysisMode:"FULL", maxPagesPerSource:10000,
  maxProposalsPerSource:100000, maxVlmObservationsPerSource:100000,
  vlmMethodId:"all-saved-proposals-server-nonnegative-v1"};
const sampleHash="6ca99692c980c76e5eab5fef31a199fd80f02f7dc308142ed9eb3273807d3930";
const fullHash="316488e0793d23652d62dd3d531f11282abe587645a06fcdb2a84609039147af";
const manifest="a".repeat(64), source="b".repeat(64), text="c".repeat(64);
function fixture(full=false): any {
  const policy=full?fullPolicy:samplePolicy;
  const ordinals=full?[0,1,2]:[0,2];
  return {
    schemaVersion:"analysis-stage-result-v2",jobType:"ENTITY_EXTRACTION",inputManifestHash:manifest,
    disposition:"VISUAL_PROPOSAL_SCAN",reasonCode:"PROPOSAL_ONLY_UNVERIFIED",
    providerKind:"ENTITY_EXTRACTION_MODEL",providerProfileId:full?"red-vector-proposals-v9-full":"red-vector-proposals-v9-sample",
    providerConfigHash:full?fullHash:sampleHash,outputCount:3,
    analysis:{schemaVersion:"visual-proposal-analysis-v9",objectId:"OBJ-V9",inputManifestHash:manifest,profile:structuredClone(policy),sources:[{
      sourceFileId:"FILE-V9",sourceSha256:source,pageCount:3,scannedPageCount:3,scannedPageNumbers:[1,2,3],skippedPageCount:0,
      status:"SCANNED",proposalLimitReached:false,unretainedProposalCount:0,
      proposals:[1,2,3].map(pageNumber=>({pageNumber,bboxNormalized:[.1,.2,.3,.4],status:"GEOMETRIC_PROPOSAL_NOT_CLASSIFIED"})),
      documentContext:{schemaVersion:"document-context-v2",methodId:"metadata-outline-page-signals-v2",status:"MIXED",reasonCode:"MULTIPLE_SYSTEMS",
        domains:["VENTILATION","WATER_SUPPLY"],ambiguity:true,unreadablePageCount:0,
        inspectedPages:[1,2,3].map(pageNumber=>({pageNumber,textSha256:text,textAvailable:true})),
        signals:[{kind:"METADATA",pageNumber:null,domain:"WATER_SUPPLY",snippet:"Водоснабжение",textSha256:text},
          {kind:"PAGE_TEXT",pageNumber:3,domain:"VENTILATION",snippet:"Система вентиляции",textSha256:text}]},
      vlm:{schemaVersion:"visual-vlm-observations-v1",methodId:policy.vlmMethodId,eligibleProposalCount:3,
        selectedOrdinals:ordinals,omittedProposalCount:full?0:1,observations:ordinals.map(proposalOrdinal=>({
          proposalOrdinal,sourceSha256:source,pageNumber:proposalOrdinal+1,bboxNormalized:[.1,.2,.3,.4],cropSha256:"d".repeat(64),
          modelId:"inspector-qwen3-vl-8b-fp8",modelRevision:"9cdc6310a8cb770ce18efaf4e9935334512aee45",
          modelLockSha256:"e2586e16f45deee017935d4c60b550e48059fdc02cbc9c9114053f2f1fe4d879",
          promptSha256:"34a372ca6f4032b74ff51c11dd7adfe14df31b266ca356a5a2ec15b1d56c9611",
          decision:"RADIATOR_HINT",reasonCode:"MODEL_RESPONSE",responseSha256:"e".repeat(64),
        }))},
    }]},
  };
}
function validate(value:any){return validateVisualProposalStageResult(value,manifest,"OBJ-V9",[{apiId:"FILE-V9",sha256:source,pageCount:3}],value.providerProfileId);}
describe("immutable V9 server visual profiles",()=>{
  it("matches independent policy values and canonical hashes",()=>{
    expect(v9SampleVisualProposalProfile).toEqual(samplePolicy);expect(v9FullVisualProposalProfile).toEqual(fullPolicy);
    expect(v9SampleVisualProposalConfigHash).toBe(sampleHash);expect(v9FullVisualProposalConfigHash).toBe(fullHash);
    expect(v9SampleVisualProposalProfile).not.toHaveProperty("vlmModelWeightsSha256");
  });
  it.each([
    ["V6","SAMPLE","V9_SAMPLE"],["V6","FULL","V9_FULL"],["V9_SAMPLE","FULL","V9_FULL"],["V9_FULL","SAMPLE","V9_SAMPLE"],
    ["V8_SAMPLE","FULL","V8_FULL"],["V8_FULL","SAMPLE","V8_SAMPLE"],["V7_FULL","SAMPLE","V7_SAMPLE"],["V4","FULL","V7_FULL"],
  ] as const)("routes %s + %s to %s",(profile,mode,wanted)=>expect(visualProfileForAnalysisMode(profile,mode)).toBe(wanted));
  it.each([false,true])("accepts source-bound SAMPLE/FULL, metadata and late mixed context: %s",full=>{
    const checked=validate(fixture(full));expect(checked?.outputCount).toBe(3);
    expect(checked?.storedResult).not.toHaveProperty("finding");expect(checked?.storedResult).not.toHaveProperty("coverage");
  });
  it("states exact 2 of 20 SAMPLE counts with 18 omitted",()=>{
    const value=fixture(false),source=value.analysis.sources[0];
    value.outputCount=20;source.proposals=Array.from({length:20},()=>({pageNumber:1,bboxNormalized:[.1,.2,.3,.4],status:"GEOMETRIC_PROPOSAL_NOT_CLASSIFIED"}));
    source.vlm.eligibleProposalCount=20;source.vlm.selectedOrdinals=[5,15];source.vlm.omittedProposalCount=18;
    source.vlm.observations.forEach((row:any,index:number)=>{row.proposalOrdinal=index===0?5:15;row.pageNumber=1;});
    expect(validate(value)?.outputCount).toBe(20);
    source.vlm.omittedProposalCount=0;expect(validate(value)).toBeUndefined();
  });
  it("keeps server OTHER as abstention",()=>{
    const value=fixture(true),row=value.analysis.sources[0].vlm.observations[0];
    row.decision="ABSTAIN";row.reasonCode="MODEL_OTHER_UNTRUSTED";expect(validate(value)).toBeDefined();
    row.decision="OTHER_HINT";expect(validate(value)).toBeUndefined();
  });
  const negatives:Array<[string,(v:any)=>void]>=[
    ["positive OTHER",v=>{v.analysis.sources[0].vlm.observations[0].decision="OTHER_HINT";}],
    ["4B metadata",v=>{v.analysis.sources[0].vlm.observations[0].modelId="inspector-qwen3vl4b-eval";}],
    ["wrong server revision",v=>{v.analysis.sources[0].vlm.observations[0].modelRevision="0".repeat(40);}],
    ["wrong server lock",v=>{v.analysis.sources[0].vlm.observations[0].modelLockSha256="0".repeat(64);}],
    ["old FULL method",v=>{v.analysis.sources[0].vlm.methodId="all-saved-proposals-v1";}],
    ["omitted FULL observation",v=>{v.analysis.sources[0].vlm.observations.pop();}],
    ["forged selected ordinals",v=>{v.analysis.sources[0].vlm.selectedOrdinals=[0,2];}],
    ["forged omitted count",v=>{v.analysis.sources[0].vlm.omittedProposalCount=1;}],
    ["FULL skipped pages",v=>{v.analysis.sources[0].skippedPageCount=1;}],
    ["FULL unretained proposals",v=>{v.analysis.sources[0].unretainedProposalCount=1;}],
    ["source swap",v=>{v.analysis.sources[0].vlm.observations[0].sourceSha256="f".repeat(64);}],
    ["crop swap",v=>{v.analysis.sources[0].vlm.observations[0].bboxNormalized=[0,0,.5,.5];}],
    ["first-two-page context",v=>{v.analysis.sources[0].documentContext.inspectedPages.pop();}],
    ["mixed flattened",v=>{v.analysis.sources[0].documentContext.status="UNKNOWN";}],
    ["legacy crop policy",v=>{v.analysis.profile.vlmCropMethodId="normalized-derotated-square-v1";}],
    ["finding smuggled",v=>{v.findings=[{violation:true}];}],
  ];
  it.each(negatives)("rejects %s",(_name,mutate)=>{const value=fixture(true);mutate(value);expect(validate(value)).toBeUndefined();});
  it("retains the exact historical serialized profile declarations",()=>{
    const original=readFileSync(new URL("./fixtures/visual-proposal-v1-v8-frozen.txt",import.meta.url),"utf8");
    const candidate=readFileSync(new URL("../src/visual-proposal.ts",import.meta.url),"utf8");
    expect(candidate.slice(0,candidate.indexOf("// New server release:"))).toBe(original.slice(0,original.indexOf("export const legacyVisualProposalConfigHash =")));
  });
});

describe("actual HTTP response serializer schema",()=>{
  it.each([false,true])("preserves V9 server policy/method/context and observations: FULL=%s",async full=>{
    const {default:Fastify}=await import("fastify");
    // Evaluate the exact self-contained schema literal from the canonical candidate,
    // avoiding unrelated contract imports and every database/runtime side effect.
    const contract=readFileSync(new URL("../src/api-contract.ts",import.meta.url),"utf8");
    const start=contract.indexOf("  VisualProposalRead: {");
    const end=contract.indexOf("  OcrLayoutPageSummary:",start);
    const schema=Function(`return ({${contract.slice(start,end)}}).VisualProposalRead`)();
    const value={...fixture(full).analysis,status:"PROPOSAL_ONLY_UNVERIFIED",artifactId:"01234567-89ab-4cde-8fab-0123456789ab",contentHash:"f".repeat(64)};
    const app=Fastify();
    try{
      app.get("/visual-v9",{schema:{response:{200:schema}}},async()=>value);
      const response=await app.inject({method:"GET",url:"/visual-v9"});
      expect(response.statusCode,response.body).toBe(200);
      const serialized=response.json();
      expect(serialized).toEqual(value);
      expect(serialized.sources[0].vlm.methodId).toBe(full?"all-saved-proposals-server-nonnegative-v1":"spread-two-saved-proposals-server-nonnegative-v1");
      expect(serialized.profile.vlmCropMaxEdgePx).toBe(2048);
      expect(serialized.sources[0].documentContext.status).toBe("MIXED");
    }finally{await app.close();}
  });
});
