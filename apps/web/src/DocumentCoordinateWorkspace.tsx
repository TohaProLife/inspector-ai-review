import { useEffect, useRef, useState } from "react";
import { documentCoordinatePageFrameSchema, type DocumentCoordinatePageFrame, type DocumentCoordinatePreviewInput,
  type DocumentCoordinatePreviewRead, type SourceFileSummary } from "@inspector-ai/contracts";
import { api } from "./api";
import { DocumentCoordinateEditor } from "./DocumentCoordinateEditor";
import { DocumentCoordinateReferenceWorkspace } from "./DocumentCoordinateReferenceWorkspace";

export interface DocumentCoordinateWorkspaceProps {objectId:string;checkId:string;files:SourceFileSummary[]}
export interface DocumentCoordinateFrameIdentity {objectId:string;checkId:string;sourceFileId:string;sourceSha256:string;pageNumber:number}
/** Actual authenticated frame acquisition, with source/page association and
 * cancellation on both sides of the await. No preview or review is saved. */
export async function loadDocumentCoordinateFrame(identity:DocumentCoordinateFrameIdentity,signal:AbortSignal):Promise<DocumentCoordinatePageFrame> {
  signal.throwIfAborted();
  if(!identity.objectId||!identity.checkId||!identity.sourceFileId||identity.sourceSha256.length!==64||!/^[a-f0-9]{64}$/u.test(identity.sourceSha256)
    ||!Number.isSafeInteger(identity.pageNumber)||identity.pageNumber<1||identity.pageNumber>10000)throw Error("Выберите исходный PDF и страницу текущей проверки.");
  const raw=await api.getDocumentCoordinateFrame(identity.objectId,identity.sourceFileId,identity.pageNumber,identity.checkId,signal);
  signal.throwIfAborted();
  const parsed=documentCoordinatePageFrameSchema.safeParse(raw);
  if(!parsed.success||parsed.data.sourceFileId!==identity.sourceFileId||parsed.data.sourceSha256!==identity.sourceSha256
    ||parsed.data.pdfPageNumber!==identity.pageNumber)throw Error("Рамка относится к другому источнику, SHA или странице. Загрузите источник снова.");
  signal.throwIfAborted();return parsed.data;
}
export function DocumentCoordinateWorkspace(props:DocumentCoordinateWorkspaceProps) {
  return <CoordinateWorkspace key={JSON.stringify([props.objectId,props.checkId,props.files.map(file=>[file.id,file.sha256,file.review?.contentHash??null])])} {...props}/>;
}
function CoordinateWorkspace({objectId,checkId,files}:DocumentCoordinateWorkspaceProps) {
  const [sourceFileId,setSourceFileId]=useState(""),[page,setPage]=useState(""),[frame,setFrame]=useState<DocumentCoordinatePageFrame|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const controller=useRef<AbortController|null>(null),generation=useRef(0);
  useEffect(()=>()=>{generation.current++;controller.current?.abort();},[]);
  const invalidate=()=>{generation.current++;controller.current?.abort();setFrame(null);setError("");setBusy(false);};
  const file=files.find(file=>file.id===sourceFileId);
  const pageNumber=/^[1-9][0-9]*$/u.test(page)?Number(page):null;
  const validPage=pageNumber!==null&&Number.isSafeInteger(pageNumber)&&pageNumber<=10000&&(!file?.pageCount||pageNumber<=file.pageCount);
  async function load() {
    if(!file||!validPage||pageNumber===null||busy)return;
    invalidate();const id=++generation.current,abort=new AbortController();controller.current=abort;setBusy(true);
    try {
      const loaded=await loadDocumentCoordinateFrame({objectId,checkId,sourceFileId:file.id,sourceSha256:file.sha256,pageNumber},abort.signal);
      if(id===generation.current&&!abort.signal.aborted)setFrame(loaded);
    }catch(e){if(id===generation.current&&!abort.signal.aborted)setError(e instanceof Error?e.message:String(e));}
    finally{if(id===generation.current)setBusy(false);}
  }
  async function preview(input:DocumentCoordinatePreviewInput,signal:AbortSignal):Promise<DocumentCoordinatePreviewRead> {
    signal.throwIfAborted();
    if(!frame||!file||input.checkId!==checkId||input.sourceFrame.sourceFileId!==file.id||input.sourceFrame.sourceSha256!==file.sha256
      ||Object.keys(frame).some(key=>input.sourceFrame[key as keyof DocumentCoordinatePageFrame]!==frame[key as keyof DocumentCoordinatePageFrame]))throw Error("Исходная страница изменилась. Загрузите рамку снова.");
    const response=await api.previewDocumentCoordinates(objectId,input,signal);signal.throwIfAborted();return response;
  }
  return <section aria-label="Рабочая область предварительной координатной привязки" style={{minWidth:0,overflowWrap:"anywhere"}}>
    <h2>Предварительная привязка координат документа</h2>
    <p>Только ручная проверка напечатанных координат исходного листа. Она не подтверждает абсолютную геопривязку, положение на местности или нормативное нарушение.</p>
    <fieldset style={{minWidth:0}}><legend>Исходный PDF и страница</legend>
      <label>Источник PDF<select value={sourceFileId} onChange={e=>{invalidate();setSourceFileId(e.target.value);setPage("");}}>
        <option value="">Выберите исходный документ</option>{files.map(file=><option key={`${file.id}:${file.sha256}`} value={file.id}>{file.name} · {file.sha256.slice(0,16)}</option>)}
      </select></label>
      <label>Страница PDF<input type="number" min={1} max={file?.pageCount??10000} step={1} value={page}
        onChange={e=>{invalidate();setPage(e.target.value);}}/></label>
      {file&&<p>SHA-256 <code>{file.sha256}</code> · Страниц: {file.pageCount??"не подтверждено"}</p>}
      <button type="button" disabled={!file||!validPage||busy} onClick={()=>void load()}>{busy?"Проверяем исходную рамку…":"Загрузить рамку исходной страницы"}</button>
      {error&&<p role="alert">{error}</p>}
    </fieldset>
    {frame&&file&&<><DocumentCoordinateEditor key={JSON.stringify([checkId,frame])} checkId={checkId} frame={frame}
      previewUrl={api.sourcePagePreviewUrl(objectId,file.id,frame.pdfPageNumber)}
      originalUrl={`${api.sourceFileUrl(objectId,file.id)}#page=${frame.pdfPageNumber}`} onPreview={preview} disabled={busy}/>
      <DocumentCoordinateReferenceWorkspace identity={{objectId,checkId,file,reviewHash:file.review?.contentHash??null}} frame={frame} disabled={busy}/></>}
  </section>;
}
