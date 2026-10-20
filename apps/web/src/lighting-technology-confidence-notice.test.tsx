import {readFileSync} from "node:fs";
import {renderToStaticMarkup} from "react-dom/server";
import {expect,it} from "vitest";
import type {MatrixExecutionRead} from "@inspector-ai/contracts";
import {MatrixConfidencePolicyNotice} from "./MatrixExecutionPanel";
const manual=JSON.parse(readFileSync(new URL("../../../fixtures/portable-historical-tests-v1/confidence-notice-manual-before-code.json",import.meta.url),"utf8"));
for(const [index,entry] of manual.cases.entries())it("global confidence threshold follows actual saved presentation policy case"+index,()=>{
 const presentation=entry.versions.map((policyVersion:string,i:number)=>({resultIndex:i,policyVersion,warningThreshold:entry.thresholds[i]})) as MatrixExecutionRead["presentation"];
 const before=JSON.stringify(presentation),html=renderToStaticMarkup(<MatrixConfidencePolicyNotice presentation={presentation}/>);
 expect(JSON.stringify(presentation)).toBe(before);
 expect(html).toContain("Без калибровки — кандидат, уверенность не измерена");
 if(index===0){expect(html).toContain("Калиброванная уверенность ≥80%");expect(html).not.toContain("строго");}
 else if(index===1){expect(html).toContain("Калиброванная уверенность строго &gt;80%");expect(html).not.toContain("≥80%");}
 else {expect(html).toContain("сохранённой политикой каждого результата");expect(html).not.toContain("80%");}
});
