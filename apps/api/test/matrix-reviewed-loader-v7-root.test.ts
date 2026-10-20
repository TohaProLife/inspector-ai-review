import {expect,it} from 'vitest';
import {validateMatrixReviewedLoaderV7} from '../src/matrix-reviewed-loader-v7.js';
it('full parent admits native JSON before property access',()=>{
 let callbacks=0;const x=Object.defineProperty({},'schemaVersion',{enumerable:true,get(){callbacks++;throw Error('getter');}});
 for(const value of [x,new Proxy({},{ownKeys(){callbacks++;throw Error('proxy');}}),{schemaVersion:'matrix-reviewed-inventory-loader-inputs-v7',unexpected:true}])expect(()=>validateMatrixReviewedLoaderV7(value)).toThrow();
 expect(callbacks).toBe(0);
});
it('old schema and missing child envelopes never accepted as v7',()=>{
 for(const schemaVersion of ['matrix-reviewed-inventory-loader-inputs-v6','matrix-reviewed-inventory-loader-inputs-v7'])expect(()=>validateMatrixReviewedLoaderV7({schemaVersion,objectId:'11111111-1111-1111-1111-111111111111',objectApiId:'OBJ-TEST',inputManifestHash:'a'.repeat(64)})).toThrow();
});
