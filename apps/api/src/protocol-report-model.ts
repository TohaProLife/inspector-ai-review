import type { CandidateReviewEvent, Finding, ProtocolExport } from "@inspector-ai/contracts";
import type { ProtocolReportDocument } from "./protocol-report-document.js";
import type { ReviewCandidatesRead } from "./repository.js";

export const protocolReportTemplateVersion = "appendix-2-report-v1";
export const protocolReportLimits = { snapshotBytes: 8 * 1024 * 1024, rows: 10000, textCharacters: 3000000, artifactBytes: 16 * 1024 * 1024 } as const;

export class ProtocolReportError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 422) { super(message); }
}

const stageNames: Record<string, string> = { PD: "ПД", RD: "РД", ID: "ИД" };
const outcomeNames: Record<string, string> = {
  CANDIDATE: "Кандидат", CONFIRMED_VIOLATION: "Подтверждено инспектором",
  NEGATIVE_VERIFIED: "Отрицательный результат проверен", MISSING_EVIDENCE: "Не хватает доказательств",
  NOT_APPLICABLE: "Неприменимо", NOT_COMPARABLE: "Несопоставимо", CLARIFICATION_REQUIRED: "Требует уточнения", SUSPICION: "Подозрение ИИ",
  CONFIRM: "Подтверждено инспектором", REJECT: "Отклонено", CLARIFY: "Требует уточнения",
  PARTIAL_CONFIRM: "Частично подтверждено", ACCEPT_FOR_REVIEW: "Оставлено для проверки", CORRECT_EVIDENCE: "Доказательства исправлены; нужно новое решение",
};
const coverageNames: Record<string, string> = { UNSUPPORTED: "Не поддерживается", PARTIAL: "Частично", PENDING: "Ожидает обработки", EVALUATED: "Выполнено", TECHNICAL_FAILURE: "Технический сбой" };
const shown = (value: string | number | null | undefined, missing = "Не указано") => value === null || value === undefined || value === "" ? missing : String(value);
const percent = (value: number, total: number) => total > 0 ? `${(100 * value / total).toFixed(1).replace(".", ",")}%` : "Не определено";
const decisionLabel = (value: string) => outcomeNames[value] ?? value;
const sourceAddress = (finding: Finding) => finding.evidence.map(source => `${stageNames[source.stage] ?? source.stage}: ${source.fileName}; ID ${source.fileId}; PDF стр. ${source.pdfPageNumber}; лист ${shown(source.documentSheetNumber)}; SHA256 ${source.sha256}${source.bbox ? `; bbox ${source.bbox.join(", ")}` : ""}`).join("\n") || "Источники не сохранены";

function findingRows(findings: Finding[]) {
  return findings.map((finding, index) => [String(index + 1), `${finding.parameterCode}\n${finding.title}\n${finding.location}`, shown(finding.expectedValue), shown(finding.actualValue), shown(finding.idValue), finding.comparisonResult,
    `${decisionLabel(finding.status)}\n${finding.decision ? `${finding.decision.author}; ${finding.decision.decidedAt}; ${finding.decision.reason}` : "Решение отсутствует"}`]);
}

/** Pure presentation adapter. All data comes from one frozen protocol, never from live findings/catalogs. */
export function buildProtocolReport(snapshot: ProtocolExport, snapshotJson: string, snapshotHash: string, canonical: boolean): ProtocolReportDocument {
  if (Buffer.byteLength(snapshotJson, "utf8") > protocolReportLimits.snapshotBytes)
    throw new ProtocolReportError("PROTOCOL_REPORT_LIMIT_EXCEEDED", "Снимок превышает лимит экспорта 8 MiB", 413);
  if (snapshot.schemaVersion !== "1.0" || !snapshot.protocol || !Array.isArray(snapshot.findings)
    || !Number.isInteger(snapshot.protocol.version) || snapshot.protocol.version < 1
    || !["DRAFT", "FINAL"].includes(snapshot.protocol.status) || !Number.isFinite(Date.parse(snapshot.protocol.createdAt))
    || !/^[a-f0-9]{64}$/.test(snapshotHash))
    throw new ProtocolReportError("PROTOCOL_SNAPSHOT_INVALID", "Сохранённый протокол не соответствует формату экспорта");

  const protocol = snapshot.protocol, findings = snapshot.findings;
  const sources = snapshot.sources ?? [];
  const coverage = snapshot.coverage;
  const stats = protocol.stats;
  const total = coverage?.totalParameters ?? stats.total;
  const latestEvents = new Map<string, CandidateReviewEvent>();
  for (const event of snapshot.candidateReview?.decisions ?? []) latestEvents.set(event.candidateId, event);
  const events = [...latestEvents.values()];
  const reviewArtifact = snapshot.candidateReview?.artifact as unknown as ReviewCandidatesRead | undefined;
  if (reviewArtifact && (!Array.isArray(reviewArtifact.candidates) || reviewArtifact.schemaVersion !== "review-candidates-v1"))
    throw new ProtocolReportError("PROTOCOL_REVIEW_SNAPSHOT_INVALID", "Сохранённые кандидаты имеют неизвестный формат; используйте исходный JSON");
  const sourceCandidates = reviewArtifact?.candidates ?? [];
  const pendingSourceCandidates = sourceCandidates.filter(candidate => !["CONFIRM", "PARTIAL_CONFIRM", "REJECT"].includes(latestEvents.get(candidate.candidateId)?.decision ?? ""));
  const confirmed = findings.filter(finding => finding.status === "CONFIRMED_VIOLATION");
  const critical = confirmed.filter(finding => finding.severity === "CRITICAL");
  const significant = confirmed.filter(finding => finding.severity !== "CRITICAL");
  const candidates = findings.filter(finding => ["CANDIDATE", "SUSPICION", "CLARIFICATION_REQUIRED", "MISSING_EVIDENCE", "NOT_COMPARABLE"].includes(finding.status));
  const stages = ["PD", "RD", "ID"];
  const stageCounts = Object.fromEntries(stages.map(stage => [stage, sources.filter(source => source.stages.includes(stage as "PD" | "RD" | "ID")).length]));
  const scenario = !snapshot.sources ? "Не сохранён в историческом снимке" : stages.filter(stage => stageCounts[stage] > 0).join("_") || "Документы не сохранены";
  const idMissing = snapshot.sources !== undefined && stageCounts.ID === 0;
  const notices = [
    protocol.status === "DRAFT" ? "ЧЕРНОВИК. Решения и замечания отражают состояние сохранённой версии; финализация не выполнена." : "ФИНАЛЬНАЯ ВЕРСИЯ НА МОМЕНТ ВЫПУСКА. Актуальный отзыв проверяется в системе; скачанный файл не обновляется после отзыва.",
    "Электронная подпись не сформирована. Передача в ИАИС этим файлом не подтверждается.",
    "Полнота чтения документов и найденное расхождение сами по себе не подтверждают инженерное нарушение. Кандидаты и решения инспектора показаны отдельно.",
    !canonical ? "УЧЕБНЫЙ / ИСТОРИЧЕСКИЙ СНИМОК без сохранённого canonical artifact. Объект и режим не дополняются текущими данными; этот файл не подтверждает проверку новых документов." : "Документ построен только из сохранённых canonical JSON bytes; SHA256 снимка приведён ниже.",
  ];
  if (coverage?.gaps.length || stats.unsupported > 0) notices.push("ПРОВЕРКА НЕПОЛНАЯ. Технические пробелы приведены отдельно; непроверенный параметр не означает отсутствие нарушения.");
  if (idMissing) notices.push("ИД отсутствует в сохранённом составе источников. Соответствие фактически выполненных работ не установлено.");
  if (!snapshot.scope) notices.push("Объект и границы проверки не сохранены в этой исторической версии; проверять её применимость по исходной записи.");
  const section = (id: string, title: string, paragraphs: string[], columns: string[], rows: string[][]): ProtocolReportDocument["sections"][number] => ({ id, title, paragraphs, tables: rows.length ? [{ columns, rows }] : [] });
  const comparisonColumns = ["№", "Раздел / параметр / место", "ПД", "РД", "ИД", "Отклонение / исход", "Решение инспектора"];
  const missingIdGaps = (coverage?.gaps ?? []).filter(gap => /(?:\bID\b|ID_MISSING|MISSING_ID|ИД|исполнительн)/iu.test(gap.reason));
  const doc: ProtocolReportDocument = {
    templateVersion: protocolReportTemplateVersion, protocolId: protocol.id, createdAt: protocol.createdAt,
    snapshotHash, status: protocol.status, title: "ПРОТОКОЛ АВТОМАТИЗИРОВАННОЙ СВЕРКИ",
    metadata: [
      { label: "Номер и версия", value: `${protocol.id}; версия ${protocol.version}` },
      { label: "Объект", value: snapshot.scope ? `${snapshot.scope.object.name}; ${snapshot.scope.object.id}` : "Не сохранён в снимке" },
      { label: "Адрес", value: snapshot.scope?.object.address ?? "Не сохранён в снимке" },
      { label: "Проверка", value: protocol.checkId }, { label: "Дата выпуска (UTC)", value: protocol.createdAt },
      { label: "Автор версии", value: protocol.createdBy }, { label: "Статус при выпуске", value: protocol.status },
      { label: "Состав стадий", value: scenario }, { label: "Состояние анализа", value: snapshot.scope?.run.state ?? "Не сохранено" },
      { label: "Шаблон", value: protocolReportTemplateVersion }, { label: "SHA256 снимка", value: snapshotHash },
      ...Object.entries(snapshot.integrity ?? {}).map(([label, value]) => ({ label, value })),
    ], notices, snapshotJson,
    sections: [
      section("documents", "РАЗДЕЛ 1. СТАТУС ЗАГРУЗКИ ДОКУМЕНТОВ", ["Наличие источников показано по сохранённому manifest. Ожидаемый реестр документов и полнота комплекта не устанавливаются по числу файлов."],
        ["Тип", "Загружено файлов", "Ожидается", "Состояние"], stages.map(stage => [stageNames[stage], snapshot.sources ? String(stageCounts[stage]) : "Не сохранено", "Реестр не сохранён", !snapshot.sources ? "Не установлено" : stageCounts[stage] ? "Есть файлы; полнота не установлена" : "Нет файлов этой стадии"])),
      section("statistics", "РАЗДЕЛ 2. СВОДНАЯ СТАТИСТИКА", ["Счётчики параметров и результатов имеют разную единицу учёта: по одному параметру возможны несколько замечаний. Подтверждения исходных листов не увеличивают машинное покрытие."],
        ["Показатель", "Количество", "% параметров"], [
          ["Всего параметров в сохранённой версии", String(total), total ? "100%" : "Не определено"],
          ["Параметров с выполнением по snapshot", shown(coverage?.executedParameters, "Не сохранено"), coverage ? percent(coverage.executedParameters, total) : "Не определено"],
          ["Неподдерживаемых параметров", String(coverage?.unsupportedParameters ?? stats.unsupported), percent(coverage?.unsupportedParameters ?? stats.unsupported, total)],
          ["Подтверждённых результатов исполняемых правил", String(confirmed.length), "Другая единица учёта"],
          ["Кандидатов / подозрений / уточнений исполняемых правил", String(candidates.length), "Другая единица учёта"],
          ["Исходных подсказок без окончательного решения", String(pendingSourceCandidates.length), "Другая единица учёта"],
          ["Сохранённых событий решений по исходным листам", String(snapshot.candidateReview?.decisions.length ?? 0), "Другая единица учёта"],
          ["Последних решений по исходным листам", String(events.length), "Другая единица учёта"],
        ]),
      section("missing-id", "РАЗДЕЛ 3. ПАРАМЕТРЫ, НЕ ПРОВЕРЕННЫЕ ИЗ-ЗА ОТСУТСТВИЯ ИД", [
        idMissing ? "В manifest нет ИД. Связь каждого параметра с отсутствующим документом показывается только при наличии сохранённого основания." : "Состав и пробелы приведены строго по сохранённой версии.",
        ...(!missingIdGaps.length ? ["Перечень параметров с явно сохранённой причиной отсутствия ИД пуст; это не доказательство полноты ИД или выполнения проверки."] : []),
      ], ["Код", "Параметр", "Состояние", "Причина"], missingIdGaps.map(gap => [gap.parameterCode, gap.parameterName, coverageNames[gap.executionStatus], gap.reason])),
      section("critical", "РАЗДЕЛ 4. КРИТИЧЕСКИЕ НАРУШЕНИЯ", critical.length ? ["Только результаты с сохранённым подтверждением инспектора и критичностью CRITICAL."] : ["Подтверждённых критических результатов в этой версии нет."], comparisonColumns, findingRows(critical)),
      section("significant", "РАЗДЕЛ 5. СУЩЕСТВЕННЫЕ НАРУШЕНИЯ", significant.length ? ["Подтверждённые результаты остальных уровней; исходная критичность сохранена в приложении доказательств."] : ["Подтверждённых результатов остальных уровней в этой версии нет."], comparisonColumns, findingRows(significant)),
      section("candidates", "РАЗДЕЛ 6. ПОДОЗРЕНИЯ ИИ И КАНДИДАТЫ", ["Этот раздел не является перечнем подтверждённых нарушений. Нечисловая уверенность означает отсутствие применимой подтверждённой вероятности."],
        ["Код / элемент", "Состояние", "ПД / РД / ИД", "Основание", "Уверенность"], candidates.map(finding => [
          `${finding.parameterCode}; ${finding.title}; ${finding.location}`, decisionLabel(finding.status), `${shown(finding.expectedValue)} / ${shown(finding.actualValue)} / ${shown(finding.idValue)}`, finding.rationale,
          typeof finding.confidence !== "number" || !Number.isFinite(finding.confidence) ? "Не установлена" : `${finding.confidence} (сохранённое значение)`,
        ])),
      section("resolution", "РАЗДЕЛ 7. РЕЗОЛЮТИВНАЯ ЧАСТЬ", ["Приведены сохранённые основания и решения. Новые нормативные предписания и рекомендации при экспорте не генерируются."],
        ["Код / элемент", "Сохранённое основание и решение"], [
          ...confirmed.map(finding => [`${finding.parameterCode}; ${finding.title}`, `${finding.rationale}\n${finding.decision?.reason ?? "Решение не сохранено"}`]),
          ...events.filter(event => ["CONFIRM", "PARTIAL_CONFIRM"].includes(event.decision)).map(event => [event.details?.entity ?? event.candidateId, `${decisionLabel(event.decision)}; ${event.note}\n${event.details?.parts.map(part => `${part.description}: ${decisionLabel(part.decision)}; ${part.note}`).join("\n") ?? ""}`]),
        ]),
      section("review", "ПРИЛОЖЕНИЕ А. РЕШЕНИЯ ИНСПЕКТОРА ПО ИСХОДНЫМ ЛИСТАМ", ["Решения человека отделены от автоматических результатов и их критичности. Ниже последние решения; полная append-only история сохранена в JSON/XML."],
        ["Элемент / кандидат", "Решение", "Основание", "Автор / дата / SHA256", "Источники и части"], events.map(event => [
          event.details?.entity ?? event.candidateId, decisionLabel(event.decision), event.note,
          `${event.actorId}; ${event.createdAt}; ${event.decisionHash}${event.inheritedFrom ? `\nУнаследовано: ${event.inheritedFrom.decisionId}; ${event.inheritedFrom.createdAt}` : ""}`,
          `${event.details?.sources.map(source => `${stageNames[source.stage]}: ${source.sourceFileId}; стр. ${source.pageNumber}; лист ${shown(source.sheet)}; ред. ${shown(source.revision)}; ${source.value} ${source.unit ?? ""}; SHA256 ${source.sourceSha256}; bbox ${source.bbox?.join(", ") ?? "нет"}`).join("\n") ?? "Источники не сохранены"}\n${event.details?.parts.map(part => `${part.id}: ${part.description}; ${decisionLabel(part.decision)}; ${part.note}; evidence ${part.evidenceIds.join(", ")}`).join("\n") ?? ""}`,
        ])),
      section("evidence", "ПРИЛОЖЕНИЕ Б. АДРЕСА ДОКАЗАТЕЛЬСТВ", ["Страницы — физические страницы PDF. Координаты bbox приводятся как сохранены, без преобразования и новой квалификации геопривязки."],
        ["Код / ID результата", "Критичность / исход", "Основание", "Исходные документы"], findings.map(finding => [
          `${finding.parameterCode}; ${finding.id}`, `${finding.severity}; ${decisionLabel(finding.status)}`, finding.rationale, sourceAddress(finding),
        ])),
      section("sources", "ПРИЛОЖЕНИЕ В. РЕЕСТР ИСХОДНИКОВ", snapshot.sources ? [] : ["Реестр не сохранён в исторической версии."],
        ["ID / имя", "Стадии", "Формат / размер", "SHA256"], sources.map(source => [
          `${source.fileId}; ${source.fileName}`, source.stages.map(stage => stageNames[stage] ?? stage).join(", "), `${source.mediaType}; ${source.byteSize} байт`, source.sha256,
        ])),
      section("coverage", "ПРИЛОЖЕНИЕ Г. ТЕХНИЧЕСКИЕ ПРОБЕЛЫ", [
        ...(coverage?.acknowledgement ? [`Неполнота признана: ${coverage.acknowledgement.actorName}; ${coverage.acknowledgement.acknowledgedAt}; ${coverage.acknowledgement.reason}; SHA256 ${coverage.acknowledgement.gapsHash}`] : ["Подтверждение выпуска неполного протокола не сохранено."]),
        ...(!coverage ? ["Детальный ledger покрытия не сохранён. Текущий справочник при экспорте не используется."] : []),
        ...(snapshot.lineage ? [`Предыдущая версия ${snapshot.lineage.previousProtocolId}; основание ${snapshot.lineage.basis}; ${snapshot.lineage.comment}; SHA256 ${snapshot.lineage.previousSnapshotHash}`] : []),
      ], ["Код", "Параметр", "Состояние", "Причина"], (coverage?.gaps ?? []).map(gap => [gap.parameterCode, gap.parameterName, coverageNames[gap.executionStatus] ?? gap.executionStatus, gap.reason])),
    ],
  };
  if (pendingSourceCandidates.length) {
    const candidateSection = doc.sections.find(item => item.id === "candidates")!;
    candidateSection.paragraphs!.push("Подсказки по тексту исходных листов приведены отдельно. Совпадение меток не устанавливает тождество элементов, сопоставимость стадий или подтверждённую вероятность.");
    candidateSection.tables!.push({
      columns: ["Код / атрибут / кандидат", "Исходное значение", "Состояние", "Источник / связанные документы", "Необходимые подтверждения"],
      rows: pendingSourceCandidates.map(candidate => [
        `${candidate.parameterCode}; ${candidate.attribute}; ${candidate.candidateId}`,
        `${candidate.rawValue} ${candidate.rawUnit ?? ""}\n${candidate.lineText}`,
        `${decisionLabel(latestEvents.get(candidate.candidateId)?.decision ?? "CANDIDATE")}\nУверенность не установлена`,
        `${stageNames[candidate.stage ?? ""] ?? "Стадия не установлена"}: ${candidate.sourceFileId}; стр. ${candidate.pageNumber}; SHA256 ${candidate.sourceSha256}; bbox (millipoints) ${candidate.locator.bboxMilliPoints.join(", ")}\n${candidate.relatedDocuments.map(source => `${source.sourceFileId}; стр. ${source.pageNumber}; ${source.rawValue} ${source.rawUnit ?? ""}; SHA256 ${source.sourceSha256}`).join("\n")}`,
        candidate.missingConfirmation.join("\n"),
      ]),
    });
  }
  const rows = doc.sections.reduce((sum, item) => sum + (item.tables ?? []).reduce((count, table) => count + table.rows.length, 0), 0);
  if (rows > protocolReportLimits.rows || JSON.stringify(doc).length > protocolReportLimits.textCharacters)
    throw new ProtocolReportError("PROTOCOL_REPORT_LIMIT_EXCEEDED", "Содержимое превышает лимит экспорта; используйте сохранённый JSON", 413);
  return doc;
}
