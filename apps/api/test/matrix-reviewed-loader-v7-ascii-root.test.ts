import {expect,it} from 'vitest';
import {canonicalMatrixReviewedLoaderV7} from '../src/matrix-reviewed-loader-v7-native.js';
it('frozen outer transport admits ASCII keys only, Unicode scalar values remain exact',()=>{
 for(const value of [{'é':1},{nested:{'𐀀':'x'}},{'а':'Cyrillic key'}])expect(()=>canonicalMatrixReviewedLoaderV7(value)).toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
 expect(canonicalMatrixReviewedLoaderV7({z:'𐀀 ё',a:'\n'})).toBe('{"a":"\\n","z":"𐀀 ё"}');
});
