/** Explicit v11 expected whole projection frozen before current API policy exists. */
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {canonicalJson,sha256} from '../src/canonical-json.js';
import {MATRIX_STEEL_COMPARISON_V11_PROFILE as profile,MATRIX_STEEL_COMPARISON_V11_ADAPTER_VERSION,matrixSteelComparisonV11Definitions,matrixSteelComparisonV11ConfigHash,matrixFullPolicyForProfile,selectMatrixRuntimePolicy,isSteelComparisonProfile,isCurrentMatrixExecutionInstalled} from '../src/matrix-steel-comparison-profile-v11.js';
const old9='matrix-text-facts-lighting-technology-v9',old10='matrix-text-facts-steel-comparison-v10';
it('explicit profile11 equals independently frozen whole definitions and pins installed new wrapper/current reader',()=>{
 const expected=JSON.parse(readFileSync(new URL('./fixtures/matrix-policy-t80/python-v11-policy-proposal.json',import.meta.url),'utf8'));
 expect(profile).toBe('matrix-text-facts-steel-comparison-v11');expect(MATRIX_STEEL_COMPARISON_V11_ADAPTER_VERSION).toBe('11');expect(matrixSteelComparisonV11Definitions).toEqual(expected.definitions);expect(matrixSteelComparisonV11ConfigHash).toBe('3b23ac656edb37a6dbbc0b8da21c912db87f8bac29cde4623a032bad6f0586d7');expect(sha256(canonicalJson(matrixSteelComparisonV11Definitions))).toBe(expected.configHash);
 expect(matrixSteelComparisonV11Definitions.lightingTechnologyExecution.documentTextV3ReaderSourceSha256).toBe('034fb41687342fae405e11de4648856fa1e271b0a2178ca9f35d8dd50bb19361');
 expect(matrixSteelComparisonV11Definitions.steelExecution.durableWrapperSourceSha256).toBe('9b05c1c1c63fe94bad0cd5e24873599cd51207d95bcca5c41ef74d404aedf215');
});
it('current execution flag explicitly selects11 and does not rename archived9/10; six typed domains and strict confidence inherited',()=>{
 const flags={steelV11:true,steel:true,lighting:true,water:true,rail:true,call:true,inventory:true};expect(selectMatrixRuntimePolicy(flags)).toMatchObject({profileId:profile,adapterVersion:'11',configHash:matrixSteelComparisonV11ConfigHash});
 expect(selectMatrixRuntimePolicy({...flags,steelV11:false})).toMatchObject({profileId:old10,configHash:'ea3cd0eb880c3d07c04a61ec794e5edf201657c06582bf8409fcf8a882aed7d6'});
 const policy=matrixFullPolicyForProfile(profile);expect(policy).toMatchObject({steelComparisons:true,lightingTechnologyComparisons:true,waterNodeComparisons:true,railInventoryComparisons:true,callInventoryComparisons:true,inventoryComparisons:true});expect(policy&&'steelExecution'in policy.definitions?(policy.definitions.steelExecution as typeof matrixSteelComparisonV11Definitions.steelExecution).confidencePolicy:null).toMatchObject({warningThresholdBasisPoints:8000,thresholdComparison:'STRICTLY_GREATER',expectedCalibrationVersion:null});
});
it('archive is readable but unavailable for current execution; unknown profiles never become supported',()=>{
 for(const p of [old9,old10]){expect(matrixFullPolicyForProfile(p)).not.toBeNull();expect(isCurrentMatrixExecutionInstalled(p)).toBe(false);}
 expect(isCurrentMatrixExecutionInstalled(profile)).toBe(true);expect(isCurrentMatrixExecutionInstalled('matrix-text-facts-water-node-v8')).toBe(true);for(const p of [undefined,null,'','FOREIGN'])expect(isCurrentMatrixExecutionInstalled(p)).toBe(false);
 expect(isSteelComparisonProfile(old10)).toBe(true);expect(isSteelComparisonProfile(profile)).toBe(true);for(const p of [old9,undefined,null,'FOREIGN'])expect(isSteelComparisonProfile(p)).toBe(false);
});
