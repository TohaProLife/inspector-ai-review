import { readFileSync } from "node:fs";
import Fastify from "fastify";
import { describe,expect,it } from "vitest";
import { validateVisualProposalStageResult } from "../src/visual-proposal.js";

describe("actual Python worker V9 to API and HTTP response boundary (synthetic, no GPU)",()=>{
  it.each(["sample","full"])("validates and serializes actual %s fixture",async mode=>{
    const data=JSON.parse(readFileSync(new URL(`./fixtures/visual-v9-worker-${mode}.json`,import.meta.url),"utf8"));
    const full=mode==="full";
    const checked=validateVisualProposalStageResult(data.result,data.inputManifestHash,data.objectId,data.expectedSources,data.releaseProfileId);
    expect(checked).toBeDefined();expect(checked?.outputCount).toBe(5);
    const source=data.result.analysis.sources[0];
    expect(source.scannedPageNumbers).toEqual([1,2,3,4,5]);expect(source.skippedPageCount).toBe(0);
    expect(source.vlm.selectedOrdinals).toEqual(full?[0,1,2,3,4]:[1,3]);
    expect(source.vlm.omittedProposalCount).toBe(full?0:3);
    expect(data.httpRequests).toHaveLength(full?5:2);
    for(const request of data.httpRequests){expect(request.host).toBe("vlm:8000");expect(request.model).toBe("inspector-qwen3-vl-8b-fp8");}
    const contract=readFileSync(new URL("../src/api-contract.ts",import.meta.url),"utf8");
    const start=contract.indexOf("  VisualProposalRead: {");const end=contract.indexOf("  OcrLayoutPageSummary:",start);
    const schema=Function(`return ({${contract.slice(start,end)}}).VisualProposalRead`)();
    const value={...data.result.analysis,status:"PROPOSAL_ONLY_UNVERIFIED",artifactId:checked!.id,contentHash:checked!.contentHash};
    const app=Fastify();
    try{
      app.get("/fixture-v9",{schema:{response:{200:schema}}},async()=>value);
      const response=await app.inject({method:"GET",url:"/fixture-v9"});
      expect(response.statusCode,response.body).toBe(200);expect(response.json()).toEqual(value);
    }finally{await app.close();}
  });
});
