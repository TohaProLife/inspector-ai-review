import { readFileSync } from "node:fs";
import { canonicalJson, sha256 } from "./canonical-json.js";
const sourceMap=JSON.parse(readFileSync(new URL("../../../services/worker/rules/public-source-id-map-v1.json",import.meta.url),"utf8")) as {
  schemaVersion:string;version:string;sources:Array<{fileId:string;objectId:string;stage:string;sha256:string}>};
if(sourceMap.schemaVersion!=="public-source-id-map-v1"||sourceMap.sources.some(s=>
  !/^F\d{4}$/u.test(s.fileId)||!s.objectId.startsWith("OBJ-")||!['PD','RD','ID','RD_ID_MIXED','UNKNOWN'].includes(s.stage)||!/^[a-f0-9]{64}$/u.test(s.sha256)))
  throw Error("public source identity map invalid");
export const publicSourceMapHash=sha256(canonicalJson(sourceMap));
export interface MatrixSubmissionIdentity { objectId:string;fileIds:Map<string,string>;
  officialIdsVerified:boolean;mappingVersion:string;mappingHash:string; }
/** Only exact original hashes and declared stages can resolve public dataset IDs. */
export function resolveMatrixSubmissionIdentity(applicationObjectId:string,
  sources:Array<{sourceFileId:string;sha256:string;stages:string[]}>):MatrixSubmissionIdentity {
  const resolved:Array<{key:string;fileId:string;objectId:string}>=[];
  for(const source of sources)for(const stage of source.stages) {
    const matches=sourceMap.sources.filter(s=>s.sha256===source.sha256&&(s.stage===stage||(s.stage==="RD_ID_MIXED"&&["RD","ID"].includes(stage))));
    if(matches.length!==1)return {objectId:applicationObjectId,fileIds:new Map(),officialIdsVerified:false,
      mappingVersion:sourceMap.version,mappingHash:publicSourceMapHash};
    resolved.push({key:`${source.sourceFileId}:${stage}`,fileId:matches[0].fileId,objectId:matches[0].objectId});
  }
  const objects=new Set(resolved.map(s=>s.objectId));const verified=resolved.length>0&&objects.size===1;
  return {objectId:verified?resolved[0].objectId:applicationObjectId,
    fileIds:verified?new Map(resolved.map(s=>[s.key,s.fileId])):new Map(),officialIdsVerified:verified,
    mappingVersion:sourceMap.version,mappingHash:publicSourceMapHash};
}
