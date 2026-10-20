import type { ColumnPylonSectionV2Request as Request, ColumnPylonSectionV2Journal as Journal,
  ColumnPylonSectionV2SideRequest as Side, ColumnPylonSectionV2TokenSelection as Token,
  ColumnPylonSectionV2SourcePreview as Preview, ColumnPylonSectionV2BasisSelection,
  DocumentTextV3LargeAuditSourceRead, SourceFileSummary, SourceReviewDecision, ColumnPylonDimensionLiteral } from '@inspector-ai/contracts';
import { api } from './api';
export type LoadedColumnSource = { preview: Preview; source: DocumentTextV3LargeAuditSourceRead; review: SourceReviewDecision; file: SourceFileSummary };
const compare = (a:string,b:string) => {const x=Array.from(a),y=Array.from(b);for(let i=0;i<Math.min(x.length,y.length);i++){const d=x[i].codePointAt(0)!-y[i].codePointAt(0)!;if(d)return d;}return x.length-y.length;};
export function columnCanonical(value:unknown):string {
  if(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(columnCanonical).join(',')+']';
  if(typeof value==='object')return '{'+Object.keys(value!).sort(compare).map(k=>JSON.stringify(k)+':'+columnCanonical((value as Record<string,unknown>)[k])).join(',')+'}';
  throw new Error('Некорректное значение для хеша');
}
export async function columnHash(value:unknown):Promise<string>{if(!globalThis.crypto?.subtle)throw new Error('WebCrypto недоступен: источник не подтверждён');const bytes=new TextEncoder().encode(columnCanonical(value));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
const equal=(a:unknown,b:unknown)=>columnCanonical(a)===columnCanonical(b);
export function columnToken(rawText:string,pageNumber:number,sourcePath:number[],start:string,end:string,kind:'number'|'unit'|'basis'):Token {
  if(!/^(0|[1-9][0-9]*)$/u.test(start)||!/^[1-9][0-9]*$/u.test(end))throw new Error('Задайте целые границы диапазона в кодовых точках');
  const a=Number(start),b=Number(end),chars=Array.from(rawText),text=chars.slice(a,b).join('');
  if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a>=b||b>chars.length||rawText.length>16384||chars.length>8192)throw new Error('Диапазон вне исходной строки');
  if(kind==='number'&&(!/^[1-9][0-9]{0,8}$/u.test(text)||/[0-9+\-−]/u.test(chars[a-1]??'')||/[0-9]/u.test(chars[b]??'')||(/[.,]/u.test(chars[a-1]??'')&&/[0-9]/u.test(chars[a-2]??''))||(/[.,]/u.test(chars[b]??'')&&/[0-9]/u.test(chars[b+1]??''))))throw new Error('Нужен целый самостоятельный положительный размер');
  const whitespace=new Set([9,10,11,12,13,28,29,30,31,32,0x85,0xa0,0x1680,0x2000,0x2001,0x2002,0x2003,0x2004,0x2005,0x2006,0x2007,0x2008,0x2009,0x200a,0x2028,0x2029,0x202f,0x205f,0x3000]);
  const left=chars[a-1],right=chars[b],digit=(c:string)=>c>='0'&&c<='9';
  if(kind==='unit'&&(text!=='мм'||left!==undefined&&!whitespace.has(left.codePointAt(0)!)&&!digit(left)&&!'=:([{;,.'.includes(left)||right!==undefined&&!whitespace.has(right.codePointAt(0)!)&&!',.;:)]}'.includes(right)))throw new Error('Выберите самостоятельное буквальное «мм»');
  return {pageNumber,sourcePath:[...sourcePath],rawText,usedTextRangeCodePoints:[a,b]};
}
export function columnSelectionDisjoint(tokens:(Token|null)[]):boolean{return tokens.every((t,i)=>!t||tokens.slice(i+1).every(u=>!u||t.pageNumber!==u.pageNumber||!equal(t.sourcePath,u.sourcePath)||t.usedTextRangeCodePoints[1]<=u.usedTextRangeCodePoints[0]||u.usedTextRangeCodePoints[1]<=t.usedTextRangeCodePoints[0]));}
export async function loadColumnPylonSource(objectId:string,file:SourceFileSummary,checkId:string,signal:AbortSignal):Promise<LoadedColumnSource>{
  signal.throwIfAborted();const preview=await api.getColumnPylonSectionV2Source(checkId,file.id,signal);signal.throwIfAborted();
  const source=await api.getDocumentTextV3LargeSource(checkId,file.id,signal);signal.throwIfAborted();
  const review=await api.getSourceReview(objectId,file.id,signal);signal.throwIfAborted();
  const origin=preview.origin;
  if(preview.schemaVersion!=='matrix-kr060-column-pylon-source-preview-v2'||preview.nativeSelectionPolicyVersion!=='column-pylon-native-section-selection-v1'||preview.objectId!==objectId||preview.sourceFileId!==file.id||preview.sourceSha256!==file.sha256||origin.checkId!==checkId||source.checkId!==checkId||source.sourceFileId!==file.id||source.sourceSha256!==file.sha256||source.purpose!=='SOURCE_AUDIT_ONLY'||source.authorityStatus!=='SOURCE_DECLARED_UNVERIFIED'||source.renderedVisibility!=='UNVERIFIED'||source.calibratedProbability!==null||!equal(preview.pageStages,source.pageStages)||preview.stage!==source.stage||!review||review.objectId!==objectId||review.sourceFileId!==file.id||review.sourceSha256!==file.sha256||review.contentHash!==preview.latestReviewHash||review.contentHash!==source.latestReviewHash||review.contentHash!==file.review?.contentHash)throw new Error('Источник или решение изменились. Обновите список и выберите заново.');
  for(const key of ['inputManifestHash','textStageContentHash','textArtifactByteSha256','textArtifactContentHash','extractorProfileHash','resourcePolicyVersion','sourceAuditProfileVersion'] as const)if(origin[key]!==source[key])throw new Error('Происхождение текстового представления не совпадает');
  if(source.textArtifact.sourceFileId!==file.id||source.textArtifact.inputSha256!==file.sha256||source.resourcePolicyVersion!=='document-text-v3-large-source-bounds-v1'||source.sourceAuditProfileVersion!=='SOURCE_AUDIT_V3_LARGE_VERTICAL_V1'||await columnHash({hashDomain:'document-text-v3-content-v1',artifact:source.textArtifact})!==origin.textArtifactContentHash)throw new Error('Хеш полного исходного текста не совпадает');
  signal.throwIfAborted();return {preview,source,review,file};
}
export async function columnLiteralSelection(loaded:LoadedColumnSource,literal:ColumnPylonDimensionLiteral):Promise<Side['selection']>{return {mode:'LITERAL_T77_V1',pageNumber:literal.pageNumber,sourcePath:[...literal.sourcePath],literalContentHash:await columnHash({hashDomain:'matrix-kr060-column-pylon-literal-v1',sourceFileId:loaded.file.id,sourceSha256:loaded.file.sha256,textArtifactContentHash:loaded.preview.origin.textArtifactContentHash,literal})};}
function projectSide(side:Journal['projection']['expected']):Side {
  const s=side.selection;
  const token=(t:Token):Token=>({pageNumber:t.pageNumber,sourcePath:[...t.sourcePath],rawText:t.rawText,usedTextRangeCodePoints:[...t.usedTextRangeCodePoints]});
  return {sourceFileId:side.sourceFileId,sourceSha256:side.sourceSha256,sourceReviewDecisionId:side.sourceReviewDecisionId,sourceReviewContentHash:side.sourceReviewContentHash,origin:{...side.origin},assertions:{...side.assertions},unitScopeAssertion:side.unitScopeAssertion,reference:side.reference,
    selection:s.mode==='LITERAL_T77_V1'?{mode:s.mode,pageNumber:s.pageNumber,sourcePath:[...s.sourcePath],literalContentHash:s.literalContentHash}:{mode:s.mode,first:token(s.first),second:token(s.second),unit:s.unit?token(s.unit):null},
    basis:side.basis.map(b=>({role:b.role,...token(b)}))};
}
/** Exact revocation, independent from any currently edited or reloadable source. */
export function withdrawColumnPylonReview(journal:Journal):Request{return {schemaVersion:'matrix-kr060-column-pylon-pair-review-input-v2',status:'WITHDRAWN',identity:{...journal.projection.identity},expected:projectSide(journal.projection.expected),actual:projectSide(journal.projection.actual),pairAssertion:journal.projection.pairAssertion,reference:journal.projection.reference,expectedReviewHash:journal.contentHash};}
export function columnPrior(items:Journal[],identity:Request['identity'],expectedId:string,actualId:string):Journal|null{const rows=items.filter(j=>equal(j.projection.identity,identity)&&j.projection.expected.sourceFileId===expectedId&&j.projection.actual.sourceFileId===actualId);if(rows.length>1)throw new Error('Неоднозначный последний журнал пары');return rows[0]??null;}
export function columnSide(loaded:LoadedColumnSource,selection:Side['selection'],assertions:Side['assertions'],unitScopeAssertion:Side['unitScopeAssertion'],reference:string,basis:ColumnPylonSectionV2BasisSelection[]):Side{return {sourceFileId:loaded.file.id,sourceSha256:loaded.file.sha256,sourceReviewDecisionId:loaded.review.id,sourceReviewContentHash:loaded.review.contentHash,origin:{...loaded.preview.origin},selection:structuredClone(selection),assertions:{...assertions},unitScopeAssertion,reference,basis:structuredClone(basis)};}
