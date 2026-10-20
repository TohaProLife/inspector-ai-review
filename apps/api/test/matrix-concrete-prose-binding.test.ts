import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractConcreteCandidates, validConcreteSourceBinding } from "../src/matrix-concrete-prose.js";
const fixture=JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/rebar-F0106-F0139.json",import.meta.url),"utf8"));
function original(stage:"PD"|"RD") {
  const source=fixture.sources.find((s:any)=>s.source.stage===stage),artifact=structuredClone(source.sourceArtifact);
  const page=artifact.pages[stage==="PD"?49:3],previous=stage==="PD"?artifact.pages[48]:null;
  const candidate=extractConcreteCandidates(page,stage,previous)[0];
  const fragment=(part:any)=>{const p=artifact.pages.find((p:any)=>p.pageNumber===part.pageNumber),b=part.bboxMilliPoints;
    return {blockId:`${part.blockIndex}:${part.lineIndex}`,rawText:part.rawText,bbox:{x:b[0]/p.widthMilliPoints,y:1-b[3]/p.heightMilliPoints,width:(b[2]-b[0])/p.widthMilliPoints,height:(b[3]-b[1])/p.heightMilliPoints}};};
  const primary=candidate.primaryFragments.map(fragment),contexts=candidate.contextFragments.map(part=>({pageNumber:part.pageNumber,...fragment(part),role:part.role}));
  return {artifact,primary,item:{attribute:"CONCRETE_CLASS",unit:"B_CLASS",rawUnit:"B_CLASS",parameterCodes:["KR-055"],stage,pageNumber:page.pageNumber,value:candidate.value,rawValue:candidate.rawValue,contextFragments:contexts} as Record<string,any>};
}
describe("concrete prose source reconstruction",()=>{
  for(const stage of ["PD","RD"] as const){
    it(stage+" authentic original passes and leaves artifact unchanged",()=>{const x=original(stage),before=JSON.stringify(x);
      expect(validConcreteSourceBinding(x.item,x.primary,x.artifact,()=>stage)).toBe(true);expect(JSON.stringify(x)).toBe(before);});
    for(const field of ["attribute","unit","rawUnit","parameterCodes","value","rawValue"])
      it(stage+" rejects changed "+field,()=>{const x=original(stage);x.item[field]=field==="parameterCodes"?["KR-056"]:"forged";
        expect(validConcreteSourceBinding(x.item,x.primary,x.artifact)).toBe(false);});
    for(const field of ["applicationScope","componentRole","concreteApplicationScope","componentKey","zoneKey"])
      it(stage+" rejects worker identity "+field,()=>{const x=original(stage);x.item[field]="STAIR";expect(validConcreteSourceBinding(x.item,x.primary,x.artifact)).toBe(false);});
    it(stage+" rejects reordered missing and modified source context",()=>{
      for(const edit of [(x:any)=>x.item.contextFragments.reverse(),(x:any)=>x.item.contextFragments.pop(),
        (x:any)=>{x.item.contextFragments[0].rawText+=" ";},(x:any)=>{x.item.contextFragments[0].bbox.x+=.001;},
        (x:any)=>{x.item.contextFragments[0].role="TABLE_SCOPE";},(x:any)=>{x.primary[0].rawText+=" ";}]){
        const x=original(stage);edit(x);
        // Reversal is a no-op for the single RD context; all meaningful changes reject.
        const unchanged=stage==="RD"&&x.item.contextFragments.length===1&&JSON.stringify(x)===JSON.stringify(original(stage));
        expect(validConcreteSourceBinding(x.item,x.primary,x.artifact)).toBe(unchanged);
      }
    });
  }
  it("rejects PD header moved to a non-adjacent page or wrong reviewed stage",()=>{
    const x=original("PD");expect(validConcreteSourceBinding(x.item,x.primary,x.artifact,n=>n===49?"RD":"PD")).toBe(false);
    x.artifact.pages[48].pageNumber=48;expect(validConcreteSourceBinding(x.item,x.primary,x.artifact)).toBe(false);
  });
  it("rejects a same-word forged scope after authentic artifact text changed",()=>{
    const x=original("PD");x.artifact.pages[48].blocks[10].text=x.artifact.pages[48].blocks[10].text.replace(/тяжелого\s+бетона/u,"легкого бетона");
    expect(validConcreteSourceBinding(x.item,x.primary,x.artifact)).toBe(false);
  });
});
