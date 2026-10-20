import { createHash } from "node:crypto";
import type { MatrixFireResistanceSourceDeclaration, MatrixSourceDeclarationsV2 } from "@inspector-ai/contracts";
import { canonicalSourceDeclarationJson, extractSourceDeclarations, sourceDeclarationId,
  type SourceDeclarationInput } from "./matrix-source-declarations.js";
import { extractFireResistanceCandidates } from "./matrix-fire-resistance-table.js";

function codePointCompare(left: string, right: string): number {
  const a=Array.from(left,c=>c.codePointAt(0)!),b=Array.from(right,c=>c.codePointAt(0)!);
  for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])return a[i]<b[i]?-1:1;
  return a.length<b.length?-1:a.length>b.length?1:0;
}
/** v1 validates the complete original input first; no native source/artifact access precedes it. */
export function extractSourceDeclarationsV2(input: SourceDeclarationInput): MatrixSourceDeclarationsV2 {
  const steel=extractSourceDeclarations(input);
  const result:MatrixSourceDeclarationsV2={schemaVersion:"matrix-source-declarations-v2",objectId:steel.objectId,
    inputManifestHash:steel.inputManifestHash,extractorVersion:"matrix-source-declarations-v2",purpose:"EVIDENCE_ONLY",
    declarations:[...steel.declarations]};
  // These consumed values have already passed v1 descriptors, native JSON, source stage and full-artifact guards.
  const artifacts=new Map(input.textArtifacts.map(raw=>{const a=raw as Record<string,unknown>;return [a.sourceFileId as string,a] as const;}));
  for(const raw of input.sources){
    const source=raw as {sourceFileId:string;sha256:string;stages:string[];pageStages?:Record<string,string>};
    if(source.stages.length!==1||!["PD","RD"].includes(source.stages[0])
      ||Object.values(source.pageStages??{}).some(stage=>stage!==source.stages[0]))continue;
    const artifact=artifacts.get(source.sourceFileId);if(!artifact)continue;
    const textArtifactHash=createHash("sha256").update(canonicalSourceDeclarationJson({
      hashDomain:"matrix-source-declaration-text-artifact-v1",textArtifact:artifact}),"utf8").digest("hex");
    for(const page of artifact.pages as Array<Record<string,unknown>>){
      for(const candidate of extractFireResistanceCandidates(page,source.stages[0])){
        const declaration:Omit<MatrixFireResistanceSourceDeclaration,"id">={
          schemaVersion:"matrix-source-declaration-v1",kind:"SOURCE_AUTHORED_FIRE_RESISTANCE_DECLARATION",
          extractorVersion:"matrix-fire-resistance-table-v1",sourceFileId:source.sourceFileId,sourceSha256:source.sha256,
          textArtifactHash,stage:source.stages[0] as "PD"|"RD",pageNumber:page.pageNumber as number,
          widthMilliPoints:page.widthMilliPoints as number,heightMilliPoints:page.heightMilliPoints as number,
          entityKey:null,applicabilityStatus:"UNREVIEWED",...candidate,
        };
        result.declarations.push({id:sourceDeclarationId(declaration as unknown as Record<string,unknown>),...declaration});
      }
    }
  }
  result.declarations.sort((a,b)=>codePointCompare(a.sourceFileId,b.sourceFileId)||a.pageNumber-b.pageNumber||codePointCompare(a.id,b.id));
  return result;
}
/** Reconstructs all declarations; a portable ID or worker-supplied policy grants no source authority. */
export function validateSourceDeclarationsV2(raw:unknown,input:SourceDeclarationInput):MatrixSourceDeclarationsV2|null {
  try{
    const expected=extractSourceDeclarationsV2(input);
    return canonicalSourceDeclarationJson(raw)===canonicalSourceDeclarationJson(expected)?expected:null;
  }catch{return null;}
}
