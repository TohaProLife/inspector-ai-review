import React,{createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {DocumentCoordinateWorkspace,loadDocumentCoordinateFrame} from './DocumentCoordinateWorkspace';
import {api} from './api';
const file:any={id:'SRC-EXACT',sha256:'a'.repeat(64),name:'Исходный ПЗУ.pdf',mediaType:'application/pdf',pageCount:18,stages:['PD'],byteSize:6442837};
const props=(extra:any={})=>({objectId:'OBJ-EXACT',checkId:'CHK-EXACT',files:[structuredClone(file)],...extra});
const render=(extra:any={})=>renderToStaticMarkup(createElement(DocumentCoordinateWorkspace,props(extra)));
afterEach(()=>vi.restoreAllMocks());
describe('Printed coordinate workspace: explicit source, frozen address, SSR idle',()=>{
 it('SSR no network, frame request or numerical preview before explicit action',()=>{const get=vi.spyOn(api as any,'getDocumentCoordinateFrame'),post=vi.spyOn(api as any,'previewDocumentCoordinates');const html=render();expect(html).toContain('Источник PDF');expect(html).toContain('Страница PDF');expect(html).toContain('Загрузить рамку исходной страницы');expect(get).not.toHaveBeenCalled();expect(post).not.toHaveBeenCalled();});
 it('no files yields no inferred source or real golden preload',()=>{const html=render({files:[]});expect(html).not.toContain('5408,70');expect(html).not.toContain('6d4aecc346a99c5daa8580a2d872c9f02046cbefc206e76028cc1d031b5b5a34');expect(html).not.toContain('<iframe');});
 it('source label stays source authored and harmless Unicode text',()=>{const html=render({files:[{...file,name:'План Ω <script>bad()</script>.pdf'}]});expect(html).toContain('План Ω');expect(html).not.toContain('<script>bad()');});
 it('outer key resets object/check/source/hash identity without claiming mounted effect behavior',()=>{const a=DocumentCoordinateWorkspace(props());expect(a.key).not.toBeNull();expect(DocumentCoordinateWorkspace(props()).key).toBe(a.key);for(const x of [{objectId:'OBJ-OTHER'},{checkId:'CHK-OTHER'},{files:[{...file,id:'SRC-OTHER'}]},{files:[{...file,sha256:'b'.repeat(64)}]}])expect(DocumentCoordinateWorkspace(props(x)).key).not.toBe(a.key);});
 it('SSR never promotes numerical preview into machine findings or certainty',()=>{const html=render();expect(html.replace(/<[^>]*>/g,' ')).not.toMatch(/Нарушений нет|NO_VIOLATION|Подтверждённая геопривязка|100%|99%/);});
});

const address={objectId:'OBJ-EXACT',checkId:'CHK-EXACT',sourceFileId:file.id,sourceSha256:file.sha256,pageNumber:13};
const exactFrame:any={sourceFileId:file.id,sourceSha256:file.sha256,pdfPageNumber:13,pageFrameSha256:'b'.repeat(64),coordinateSpace:'CANONICAL_VISIBLE_NORMALIZED',visibleWidthPt:1684,visibleHeightPt:1191,rotate:270,geometryPrecisionPt:.01};
describe('Authenticated frame loading: real async seam, no mounted effect claim',()=>{
 it('calls exact object/source/page/check and carries caller AbortSignal',async()=>{const signal=new AbortController().signal,get=vi.spyOn(api as any,'getDocumentCoordinateFrame').mockResolvedValue(structuredClone(exactFrame));expect(await loadDocumentCoordinateFrame(address,signal)).toEqual(exactFrame);expect(get).toHaveBeenCalledExactlyOnceWith(address.objectId,address.sourceFileId,address.pageNumber,address.checkId,signal);});
 it('aborted before explicit load performs zero requests',async()=>{const get=vi.spyOn(api as any,'getDocumentCoordinateFrame'),controller=new AbortController();controller.abort();await expect(loadDocumentCoordinateFrame(address,controller.signal)).rejects.toThrow();expect(get).not.toHaveBeenCalled();});
 it('ignores deferred stale completion after abort even transport resolves',async()=>{let resolve!:(v:any)=>void;const deferred=new Promise<any>(r=>resolve=r);vi.spyOn(api as any,'getDocumentCoordinateFrame').mockReturnValue(deferred);const controller=new AbortController(),pending=loadDocumentCoordinateFrame(address,controller.signal);controller.abort();resolve(structuredClone(exactFrame));await expect(pending).rejects.toThrow();});
 it('rejects changed exact SID/SHA/page and cannot borrow previous source frame',async()=>{for(const patch of [{sourceFileId:'FOREIGN'},{sourceSha256:'c'.repeat(64)},{pdfPageNumber:12}]){vi.spyOn(api as any,'getDocumentCoordinateFrame').mockResolvedValue({...exactFrame,...patch});await expect(loadDocumentCoordinateFrame(address,new AbortController().signal)).rejects.toThrow();vi.restoreAllMocks();}});
 it('rejects malformed authenticated frame shape before editor activation',async()=>{for(const patch of [{pageFrameSha256:'not-a-hash'},{visibleWidthPt:0},{visibleHeightPt:NaN},{rotate:45},{geometryPrecisionPt:0},{coordinateSpace:'PDF_RAW_UNROTATED'}]){vi.spyOn(api as any,'getDocumentCoordinateFrame').mockResolvedValue({...exactFrame,...patch});await expect(loadDocumentCoordinateFrame(address,new AbortController().signal)).rejects.toThrow();vi.restoreAllMocks();}});
});
