import { useState } from "react";
import type { InspectorEvidence, MatrixProjectConstraint, MatrixProjectConstraints as ConstraintsArtifact, SourceFileSummary } from "@inspector-ai/contracts";
import { InspectorEvidenceViewer } from "./InspectorEvidenceViewer";

export function projectConstraintEvidence(fact: MatrixProjectConstraint, fragmentIndex: number): InspectorEvidence {
  const fragment = fact.fragments[fragmentIndex];
  if (!fragment) throw new RangeError("Project constraint fragment is absent");
  const box = fragment.bboxMilliPoints;
  return {
    id: `${fact.id.slice(0, 50)}:constraint:${fragmentIndex}`,
    sourceFileId: fact.sourceFileId, sourceSha256: fact.sourceSha256, stage: fact.stage,
    pageNumber: fact.pageNumber, sheet: null, revision: null,
    bbox: [box[0] / fact.widthMilliPoints, 1 - box[3] / fact.heightMilliPoints,
      box[2] / fact.widthMilliPoints, 1 - box[1] / fact.heightMilliPoints],
    value: Array.from(fragment.rawText).slice(fragment.usedTextRange.start, fragment.usedTextRange.end).join(""),
    unit: "", element: "Применимость проектного условия к проёму не проверена",
  };
}

export function MatrixProjectConstraints({ artifact, objectId, files, query }: {
  artifact?: ConstraintsArtifact; objectId: string; files: SourceFileSummary[]; query: string;
}) {
  const [selected, setSelected] = useState<{ fact: MatrixProjectConstraint; fragmentIndex: number } | null>(null);
  if (!artifact) return null;
  const search = query.trim().toLocaleLowerCase();
  const visible = artifact.constraints.filter(fact => `${fact.attribute} ${fact.limitValue} ${fact.canonicalUnit} ${fact.stage} ${fact.pageNumber} ${fact.sourceFileId} ${files.find(file => file.id === fact.sourceFileId)?.name ?? ""} ${fact.fragments.map(fragment => fragment.rawText).join(" ")}`.toLocaleLowerCase().includes(search));
  const evidence = selected ? projectConstraintEvidence(selected.fact, selected.fragmentIndex) : undefined;
  return <section aria-label="Проектные ограничения из исходников" style={{ marginTop: "var(--space-lg)", overflowWrap: "anywhere" }}>
    <h3>Проектные ограничения из исходников</h3>
    <p>Условия, записанные автором проекта. Применимость к конкретному элементу не проверена; сравнение с РД ещё не выполнено.</p>
    <p role="status">Проектных ограничений: {visible.length} / {artifact.constraints.length}</p>
    <div style={{ maxHeight: 500, overflow: "auto" }}>{visible.map(fact => <article key={fact.id}
      style={{ borderBottom: "1px solid var(--border-subtle)", padding: "12px 0" }}>
      <strong>Ширина дверного проёма в свету: не менее {fact.limitValue} м</strong>
      <p>Кандидат проектного ограничения · ПД · PDF {fact.pageNumber}</p>
      <p>При открытом дверном полотне; пути движения пользователя кресла-коляски и выходы в лестничные клетки и лифтовые холлы.</p>
      <p>{files.find(file => file.id === fact.sourceFileId)?.name ?? fact.sourceFileId} · SHA {fact.sourceSha256.slice(0, 16)}</p>
      <p>Для проверки соответствия нужны связь с конкретным проёмом, область применения и проверенные исходники.</p>
      {fact.fragments.map((fragment, index) => <div key={fragment.blockIndex}>
        <p style={{ whiteSpace: "pre-wrap" }}><mark>{Array.from(fragment.rawText).slice(fragment.usedTextRange.start, fragment.usedTextRange.end).join("")}</mark>{Array.from(fragment.rawText).slice(fragment.usedTextRange.end).join("")}</p>
        <button type="button" className="button button--secondary" style={{ maxWidth: "100%", whiteSpace: "normal" }}
          onClick={() => setSelected({ fact, fragmentIndex: index })}>Открыть условие · PDF {fact.pageNumber} · фрагмент {index + 1}</button>
      </div>)}
      <small>Проём не сопоставлен · условие ≥ {fact.limitValue} м · ID {fact.id.slice(0, 16)}</small>
    </article>)}</div>
    {!visible.length && <p>Подходящих проектных ограничений в сохранённом результате нет. Полнота поиска по документам не подтверждена.</p>}
    {selected && <>
      <p role="status">Выбрано проектное условие · PDF {selected.fact.pageNumber} · фрагмент {selected.fragmentIndex + 1}. Выделена исходная строка; цвет текста в карточке показывает использованную часть предложения.</p>
      <div className="inspector-review-viewers"><InspectorEvidenceViewer key={`${selected.fact.id}:${selected.fragmentIndex}`}
        objectId={objectId} stage={selected.fact.stage} evidence={evidence}
        file={files.find(file => file.id === selected.fact.sourceFileId)} onOpened={() => {}} /></div>
    </>}
  </section>;
}
