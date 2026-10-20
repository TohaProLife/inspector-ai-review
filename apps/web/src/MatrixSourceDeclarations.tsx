import { useState } from "react";
import type { InspectorEvidence, MatrixSourceDeclarations as DeclarationsArtifact, MatrixSourceDeclarationsRead, MatrixSteelSourceDeclaration, SourceFileSummary } from "@inspector-ai/contracts";
import { InspectorEvidenceViewer } from "./InspectorEvidenceViewer";
import { MatrixFireResistanceDeclarations } from "./MatrixFireResistanceDeclarations";

type FragmentKind = "primary" | "scope";
export function sourceDeclarationScopeLabel(fact: MatrixSteelSourceDeclaration): string {
  return fact.productScope.role === "DISTRIBUTION_BELT_I_BEAMS"
    ? `Распределительный пояс: ${fact.productScope.count} двутавра ${fact.productScope.profile}, ярус ${fact.productScope.tier}`
    : "Двутавры: профиль, количество и ярус в декларации не указаны";
}
export function sourceDeclarationMatchesQuery(fact: MatrixSteelSourceDeclaration, query: string, files: SourceFileSummary[], section: string | null = null): boolean {
  const file = files.find(item => item.id === fact.sourceFileId);
  return [fact.value, fact.value.replaceAll("С", "C"), fact.rawValue, fact.stage, fact.pageNumber, fact.sourceFileId,
    file?.name ?? "", section ?? "", sourceDeclarationScopeLabel(fact), fact.productScope.productStandard, fact.productScope.gradeStandard,
    ...fact.primaryFragments.map(part => part.rawText), ...fact.scopeFragments.map(part => part.rawText)]
    .join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}
export function sourceDeclarationEvidence(fact: MatrixSteelSourceDeclaration, kind: FragmentKind, index: number): InspectorEvidence {
  const fragment = (kind === "primary" ? fact.primaryFragments : fact.scopeFragments)[index];
  if (!fragment) throw new RangeError("Source declaration fragment is absent");
  const box = fragment.bboxMilliPoints;
  return { id: `${fact.id.slice(0, 48)}:${kind}:${index}`, sourceFileId: fact.sourceFileId, sourceSha256: fact.sourceSha256,
    stage: fact.stage, pageNumber: fragment.pageNumber, sheet: null, revision: null,
    bbox: [box[0] / fact.widthMilliPoints, 1 - box[3] / fact.heightMilliPoints,
      box[2] / fact.widthMilliPoints, 1 - box[1] / fact.heightMilliPoints],
    value: fragment.rawText, unit: "", element: "Принадлежность одному элементу и применимость не проверены" };
}
export function sourceDeclarationViewerKey(objectId: string, fact: MatrixSteelSourceDeclaration, kind: FragmentKind, index: number): string {
  return JSON.stringify([objectId, fact.id, fact.sourceFileId, fact.sourceSha256, fact.pageNumber, kind, index]);
}

function MatrixSteelSourceDeclarations({ artifact, objectId, files, query, sections = {} }: {
  artifact?: DeclarationsArtifact; objectId: string; files: SourceFileSummary[]; query: string;
  sections?: Record<string, string | null>;
}) {
  const [selection, setSelection] = useState<{ id: string; kind: FragmentKind; index: number } | null>(null);
  if (!artifact) return null;
  const visible = artifact.declarations.filter(fact => sourceDeclarationMatchesQuery(fact, query, files, sections[fact.sourceFileId]));
  const selected = selection ? visible.find(fact => fact.id === selection.id) : undefined;
  const selectedEvidence = selected && selection ? sourceDeclarationEvidence(selected, selection.kind, selection.index) : undefined;
  return <section aria-label="Декларации материалов из исходников" style={{ marginTop: "var(--space-lg)", overflowWrap: "anywhere" }}>
    <h3>Декларации материалов из исходников</h3>
    <p>Значения и область применения, записанные автором документа. Принадлежность одному элементу и применимость не проверены.</p>
    <p>Эти сведения сохраняются отдельно от результатов проверок. Число деклараций не увеличивает машинное покрытие.</p>
    <p role="status">Деклараций материалов: {visible.length} / {artifact.declarations.length}</p>
    <div style={{ maxHeight: 560, overflow: "auto" }}>{visible.map(fact => <article key={fact.id}
      style={{ borderBottom: "1px solid var(--border-subtle)", padding: "12px 0" }}>
      <strong>Класс стали: {fact.rawValue}</strong>{fact.rawValue !== fact.value && <span> · запись класса {fact.value}</span>}
      <p>{sourceDeclarationScopeLabel(fact)}</p>
      <p>{fact.stage === "PD" ? "ПД" : "РД"} · Раздел: {sections[fact.sourceFileId] ?? "не установлен"} · PDF {fact.pageNumber}</p>
      <p>{files.find(file => file.id === fact.sourceFileId)?.name ?? fact.sourceFileId} · SHA {fact.sourceSha256.slice(0, 16)}</p>
      <p>Указано в исходнике: {fact.productScope.productStandard}; {fact.productScope.gradeStandard}.</p>
      {(["primary", "scope"] as const).map(kind => <div key={kind}>
        <p><strong>{kind === "primary" ? "Декларация класса" : "Контекст исходного текста"}</strong></p>
        {(kind === "primary" ? fact.primaryFragments : fact.scopeFragments).map((fragment, index) => <div key={`${fragment.blockIndex}:${fragment.lineIndex}`}>
          <p style={{ whiteSpace: "pre-wrap" }}>{fragment.rawText}</p>
          <button type="button" className="button button--secondary" style={{ maxWidth: "100%", whiteSpace: "normal" }}
            onClick={() => setSelection({ id: fact.id, kind, index })}>
            {kind === "primary" ? "Открыть декларацию" : "Открыть контекст"} · PDF {fragment.pageNumber} · фрагмент {index + 1}
          </button>
        </div>)}
      </div>)}
      <small>Элемент не сопоставлен · ID {fact.id.slice(0, 16)}</small>
    </article>)}</div>
    {!visible.length && <p>Подходящих деклараций в сохранённом результате нет. Полнота поиска материалов по документам не подтверждена.</p>}
    {selected && selection && <>
      <p role="status">Выбрана декларация материала · {selection.kind === "primary" ? "исходное значение" : "контекст"} · PDF {selectedEvidence!.pageNumber} · фрагмент {selection.index + 1}. Выделена полная исходная строка.</p>
      <div className="inspector-review-viewers"><InspectorEvidenceViewer key={sourceDeclarationViewerKey(objectId, selected, selection.kind, selection.index)}
        objectId={objectId} stage={selected.stage} evidence={selectedEvidence}
        file={files.find(file => file.id === selected.sourceFileId)} onOpened={() => {}} /></div>
    </>}
  </section>;
}

export function MatrixSourceDeclarations({artifact,...props}:{artifact?:MatrixSourceDeclarationsRead;objectId:string;files:SourceFileSummary[];query:string;sections?:Record<string,string|null>}) {
  if(!artifact)return null;
  if(artifact.schemaVersion==="matrix-source-declarations-v1")return <MatrixSteelSourceDeclarations artifact={artifact} {...props}/>;
  const steel=artifact.declarations.filter((fact):fact is MatrixSteelSourceDeclaration=>fact.kind==="SOURCE_AUTHORED_STEEL_DECLARATION");
  const steelArtifact:DeclarationsArtifact={schemaVersion:"matrix-source-declarations-v1",extractorVersion:"matrix-source-declarations-v1",
    objectId:artifact.objectId,inputManifestHash:artifact.inputManifestHash,purpose:"EVIDENCE_ONLY",declarations:steel};
  return <>
    {!!steel.length&&<MatrixSteelSourceDeclarations artifact={steelArtifact} {...props}/>}
    <MatrixFireResistanceDeclarations declarations={artifact.declarations.filter(fact=>fact.kind==="SOURCE_AUTHORED_FIRE_RESISTANCE_DECLARATION")} {...props}/>
  </>;
}
