import type { MatrixObservation } from "@inspector-ai/contracts";
import { matrixFactScopeSchema, type MatrixFactScopeBinding }
  from "@inspector-ai/contracts";
import { prepareMatrixFactArtifact, type MatrixFactTargetEvidence } from "./matrix-fact-scope.js";

const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
type Source={sourceFileId:string;sha256:string;scopeProofs?:Record<string,unknown>;textArtifact?:Record<string,unknown>|null};
type Input={objectId:string;inputManifestHash:string};
export type FactScopeRule={ruleId:string;version:string;attribute:string;canonicalUnit:string};
export interface MatrixFactScopeResolver {
  entity(fact:MatrixObservation):string|null;
  proof(fact:MatrixObservation,rule:FactScopeRule,parameterCode:string,key:string):Record<string,unknown>|null;
  effectiveFlags(fact:MatrixObservation,rule:FactScopeRule,parameterCode:string):string[];
}

/** Presence disables all whole-file fallback, including an explicitly empty binding list. */
export function hasMatrixFactBindings(source:Source):boolean {
  return Object.hasOwn(source.scopeProofs??{},"FACT_BINDINGS");
}

/** Trusted input envelope still needs exact source/manifest provenance and portable evidence matching. */
export function prepareMatrixFactBindings(source:Source,input:Input,
  rules:Array<FactScopeRule&{parameterCode:string}>):MatrixFactScopeResolver|null {
  if(!hasMatrixFactBindings(source))return null;
  const envelope=source.scopeProofs!.FACT_BINDINGS;
  if(!record(envelope)||envelope.status!=="VERIFIED"||envelope.sourceFileId!==source.sourceFileId
    ||envelope.sourceSha256!==source.sha256||envelope.objectId!==input.objectId
    ||envelope.inputManifestHash!==input.inputManifestHash
    ||typeof envelope.reference!=="string"||!envelope.reference.trim()
    ||(Object.hasOwn(envelope,"reviewContentHash")&&(typeof envelope.reviewContentHash!=="string"
      ||!/^[a-f0-9]{64}$/u.test(envelope.reviewContentHash))))throw Error("Invalid fact scope provenance");
  const scope=matrixFactScopeSchema.safeParse({schemaVersion:envelope.schemaVersion,bindings:envelope.bindings});
  if(!scope.success)throw Error("Invalid fact scope bindings");
  const artifact=scope.data.bindings.length?prepareMatrixFactArtifact(source.textArtifact):null;
  if(scope.data.bindings.length&&!artifact)throw Error("Fact scope original text artifact missing");
  // Derive evidence from a private artifact snapshot; caller-owned facts are never cached.
  function matching(fact:MatrixObservation):{target:MatrixFactTargetEvidence|null;bindings:MatrixFactScopeBinding[]} {
    const candidates=scope.success?scope.data.bindings.filter(binding=>binding.target.observationId===fact.id
      &&rules.some(rule=>rule.ruleId===binding.ruleId&&rule.version===binding.ruleVersion
        &&rule.parameterCode===binding.parameterCode&&rule.attribute===fact.attribute&&rule.canonicalUnit===fact.unit)
      &&(fact.parameterCodes as string[]).includes(binding.parameterCode)):[];
    const target=candidates.length?artifact?.deriveTarget(fact)??null:null;
    return {target,bindings:target?candidates.filter(binding=>binding.target.evidenceHash===target.evidenceHash
      &&binding.target.textArtifactHash===target.textArtifactHash):[]};
  }
  function selected(fact:MatrixObservation,rule:FactScopeRule,parameterCode:string) {
    const result=matching(fact);
    return {...result,binding:result.bindings.find(binding=>binding.ruleId===rule.ruleId
      &&binding.ruleVersion===rule.version&&binding.parameterCode===parameterCode)};
  }
  return {
    entity(fact){const entities=new Set(matching(fact).bindings.map(binding=>binding.entityKey));
      return entities.size===1?[...entities][0]:null;},
    proof(fact,rule,parameterCode,key){
      const {binding}=selected(fact,rule,parameterCode);if(!binding)return null;
      if(/^(?:RULE_SCOPE_COMPLETE|PARAMETER_SCOPE_COMPLETE)(?::|$)/u.test(key))return null;
      const details=key==="ENTITY_SCOPE"?{reference:binding.reference}:binding.contexts[key];
      if(key==="PROJECT_ZERO_GEODETIC_AUTHORITY"&&(!binding.contexts[key]?.projectZeroAuthority
        ||typeof envelope.reviewContentHash!=="string"||!/^[a-f0-9]{64}$/u.test(envelope.reviewContentHash)))return null;
      return details?{...details,...(key==="PROJECT_ZERO_GEODETIC_AUTHORITY"
        ?{serverReviewContentHash:envelope.reviewContentHash,bindingTarget:binding.target}:{}),sourceFileId:source.sourceFileId,sourceSha256:source.sha256,
        objectId:input.objectId,inputManifestHash:input.inputManifestHash,entityKey:binding.entityKey,status:"VERIFIED"}:null;
    },
    effectiveFlags(fact,rule,parameterCode){
      const {binding,target}=selected(fact,rule,parameterCode);
      const reviewed=!!target?.fragmentsHash&&binding?.tableContextReview?.fragmentsHash===target.fragmentsHash;
      return (fact.sourceFlags as string[]).filter(flag=>flag!=="TABLE_CONTEXT_UNVERIFIED"||!reviewed);
    },
  };
}
