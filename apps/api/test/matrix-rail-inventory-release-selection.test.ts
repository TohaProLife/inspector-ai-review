import {describe,it,expect} from 'vitest';
import {PostgresInspectionRepository} from '../src/postgres-repository.js';
import {canonicalJson,sha256} from '../src/canonical-json.js';
import {matrixRailInventoryDefinitions,matrixRailInventoryConfigHash} from '../src/matrix-rail-inventory-profile.js';
import {matrixDefinitions,matrixConfigHash} from '../src/matrix-execution.js';
import {matrixInventoryDefinitions,matrixInventoryConfigHash} from '../src/matrix-inventory-profile.js';
import {matrixCallInventoryDefinitions,matrixCallInventoryConfigHash} from '../src/matrix-call-inventory-profile.js';

describe('actual release construction from matrix feature flags',()=>{
 for(const row of [
  ...[false,true].flatMap(ar=>[false,true].flatMap(call=>[false,true].map(rail=>({ar,call,rail,
    version:rail?'matrix-text-facts-rail-inventory-v7':call?'matrix-text-facts-call-inventory-v6':ar?'matrix-text-facts-inventory-v5':'matrix-text-facts-evidence-v4',
    adapter:rail?'7':call?'6':ar?'5':'4',definitions:rail?matrixRailInventoryDefinitions:call?matrixCallInventoryDefinitions:ar?matrixInventoryDefinitions:matrixDefinitions,
    hash:rail?matrixRailInventoryConfigHash:call?matrixCallInventoryConfigHash:ar?matrixInventoryConfigHash:matrixConfigHash}))))
 ])it(`stores coherent rules and slot with AR=${row.ar}, call=${row.call}, rail=${row.rail}`,async()=>{
  const flags=['INSPECTOR_MATRIX_INVENTORY_COMPARISONS','INSPECTOR_MATRIX_CALL_INVENTORY_COMPARISONS','INSPECTOR_MATRIX_VISUAL_PROPOSALS','INSPECTOR_MATRIX_RAIL_INVENTORY_COMPARISONS'];
  const previous=flags.map(k=>process.env[k]);
  process.env[flags[0]!] = row.ar?'1':'0';process.env[flags[1]!] = row.call?'1':'0';delete process.env[flags[2]!];process.env[flags[3]!] = row.rail?'1':'0';
  try{
   const repository=Object.create(PostgresInspectionRepository.prototype) as any;
   Object.assign(repository,{analysisProfile:'MATRIX_V1',parameters:Array(132).fill({}),visualProfile:'DEFAULT'});
   let stored:any[]|undefined;
   const client={query:async(sql:string,values:any[])=>{
    if(sql.startsWith('INSERT INTO analysis_releases')){stored=values;return {rows:[]};}
    expect(sql).toContain('SELECT content_hash');expect(stored).toBeDefined();return {rows:[{content_hash:stored![1]}]};
   }};
   const release=await repository.ensureAnalysisRelease(client);
   expect(release.manifest.rules.matrixDefinitions).toEqual(row.definitions);
   const slot=release.manifest.providerSlots.find((x:any)=>x.stageJobType==='RULE_EVALUATION');
   expect(slot).toMatchObject({profileId:row.version,adapterVersion:row.adapter,configHash:row.hash,status:'CONFIGURED',resourceProfile:'CPU'});
   expect(sha256(canonicalJson(release.manifest.rules.matrixDefinitions))).toBe(slot.configHash);
   expect(stored).toEqual([release.manifest.releaseId,sha256(release.canonical),Buffer.byteLength(release.canonical),release.canonical]);
   expect(JSON.parse(stored![3]).rules.matrixDefinitions).toEqual(row.definitions);
  }finally{flags.forEach((k,i)=>{if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i];});}
 });
});
