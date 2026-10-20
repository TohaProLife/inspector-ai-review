import type { InspectorEvidenceViewerProps } from "./InspectorEvidenceViewer";
import type { DocumentCoordinateReferenceRead } from "./document-coordinate-reference-notes";
export interface DocumentCoordinateReferenceNotesProps {
  value: DocumentCoordinateReferenceRead;
  onOpenEvidence?: (evidence: NonNullable<InspectorEvidenceViewerProps["evidence"]>) => void;
}
const labels = { COORDINATE_SYSTEM_DECLARATION: "Система координат по тексту листа",
  HEIGHT_SYSTEM_DECLARATION: "Система высот по тексту листа", PRINTED_SCALE_DECLARATION: "Напечатанный масштаб" };
export function DocumentCoordinateReferenceNotes({ value, onOpenEvidence }: DocumentCoordinateReferenceNotesProps) {
  const repeated = value.notes.some(note => value.notes.filter(other => other.kind === note.kind).length > 1);
  return <section aria-label="Что указано на исходном листе" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
    <h4>Что указано на исходном листе</h4>
    <p>SOURCE_DECLARED_UNVERIFIED · Заявления исходного документа. Уверенность не измерена; геодезическая достоверность, абсолютная привязка и положение на местности не подтверждены.</p>
    <p>Источник {value.identity.file.id} · SHA <code>{value.identity.file.sha256}</code> · PDF {value.frame.pdfPageNumber}.</p>
    <p>Хеш полного текста <code>{value.origin.textArtifactHash}</code> · Хеш стадии <code>{value.origin.textStageContentHash}</code> · Хеш комплекта <code>{value.origin.inputManifestHash}</code>.</p>
    {value.indexPageExcluded ? <p role="status">На странице обнаружено содержание или ведомость листов. Заметки этой индексной страницы исключены; сведения с других страниц не подставляются.</p>
      : value.totalNotes === 0 ? <p role="status">В доступном тексте выбранной страницы заметка не найдена. Это не подтверждает отсутствие на оригинале.{value.pageHasNoText ? " Доступного текста страницы нет." : ""}</p> : <>
        <p>Заметок: {value.totalNotes}. Показано: {value.notes.length}.{value.truncated ? " Список сокращён до 50; дополнительные заметки не скрывают неоднозначность." : ""}</p>
        {repeated && <p role="status">Есть несколько заявлений одного вида. Возможны повторы или противоречия; значение автоматически не выбирается.</p>}
        {value.notes.map(note => <article key={note.id} style={{ borderTop: "1px solid var(--border-subtle)", paddingBlock: 8 }}>
          <strong>{labels[note.kind]} · {note.kind}</strong>
          <p>PDF {note.pageNumber} · блок {note.blockIndex}, строка {note.lineIndex}</p>
          <blockquote style={{ marginInline: 0, whiteSpace: "pre-wrap" }}>{note.rawText}</blockquote>
          {note.evidence && onOpenEvidence ? <button type="button" className="button button--secondary" onClick={() => onOpenEvidence(note.evidence!)}>Открыть исходную строку</button>
            : <p>Точная геометрия строки недоступна либо просмотр не подключён. Полный текст сохранён; рамка блока не заменяет рамку строки.</p>}
        </article>)}
      </>}
    <p>Названия сохранены буквально: код EPSG, зона и единицы не определяются. Напечатанный масштаб не задаёт единицу координат, масштаб нормализованной страницы или допуск. Поля расчёта, факты, решения по источнику и машинное покрытие не изменяются.</p>
  </section>;
}
