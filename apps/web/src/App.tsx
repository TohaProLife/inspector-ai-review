import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { uploadPolicy, uploadStages } from "@inspector-ai/contracts";
import type {
  CheckRun,
  DecisionType,
  Finding,
  FindingStatus,
  InspectionObject,
  ParameterCatalogItem,
  ParameterCoverageItem,
  ProtocolRevocationReasonCode,
  ProtocolVersion,
  SessionUser,
  UploadStage,
} from "@inspector-ai/contracts";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  FileCheck2,
  FileClock,
  FileSearch,
  FileText,
  FolderKanban,
  LoaderCircle,
  Menu,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UploadCloud,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "./design-system/icons";
import { Sparkles } from "lucide-react";
import { api, type OcrHeatRowEvidence, type OcrHeatRowsRead, type PilotResultsRead } from "./api";
import { ColorModeControl } from "./design-system/ColorModeControl";
import { useColorMode } from "./design-system/colorMode";
import { Landing } from "./Landing";
import { Brand } from "./design-system/ui";
import { CandidateFamilyObservations } from "./CandidateFamilyObservations";
import { ReviewCandidates } from "./ReviewCandidates";
import { CandidateFamilyOcrObservations } from "./CandidateFamilyOcrObservations";
import { UnresolvedFamilyReview } from "./UnresolvedFamilyReview";
import { UnresolvedFamilyOcrReview } from "./UnresolvedFamilyOcrReview";
import { SiteTepAreaReview } from "./SiteTepAreaReview";
import { SiteGpContextReview } from "./SiteGpContextReview";
import { SiteGpTableRowReview } from "./SiteGpTableRowReview";
import { EquipmentSpecReview } from "./EquipmentSpecReview";
import { MaterialClassReview } from "./MaterialClassReview";
import { UnresolvedConfigReview } from "./UnresolvedConfigReview";
import { UnresolvedConfigReviewV2 } from "./UnresolvedConfigReviewV2";
import { UnresolvedConfigReviewV3 } from "./UnresolvedConfigReviewV3";
import { LayerAssemblyReview } from "./LayerAssemblyReview";
import { Kr065OpeningReview } from "./Kr065OpeningReview";
import { OcrTableRowsReview } from "./OcrTableRowsReview";
import { OcrRowTranscriptionReview } from "./OcrRowTranscriptionReview";
import { OcrRowApplicabilityReview } from "./OcrRowApplicabilityReview";
import { OcrFactPairReview } from "./OcrFactPairReview";
import { OcrFactPairQuantityReview } from "./OcrFactPairQuantityReview";
import { OcrFactPairComparisonPreview } from "./OcrFactPairComparisonPreview";
import { CandidateFamilyPreview } from "./CandidateFamilyPreview";
import { FactLinkReview } from "./FactLinkReview";
import { SourceReviewScreen } from "./SourceReviewScreen";
import { createSelectionRequest, isRunningCheck, readWorkspaceObject, uploadAndStartCheck } from "./workspace-object";
import { protocolFinalizationBlock, protocolRequiresGapAcknowledgement } from "./protocol-state";

type Screen = "home" | "objects" | "upload" | "processing" | "results" | "sources" | "candidates" | "evidence" | "missing" | "protocol" | "catalog" | "settings";
type ObjectScopedScreen = "results" | "candidates" | "protocol";

const objectScopedCopy: Record<ObjectScopedScreen, { title: string; description: string; action: string; emptyTitle: string; emptyDescription: string }> = {
  results: { title: "Проверки", description: "Результаты сравнения по объектам с запущенной проверкой.", action: "Открыть проверку", emptyTitle: "Проверок пока нет", emptyDescription: "Добавьте документы в объект и запустите проверку. Здесь появится её результат." },
  candidates: { title: "Кандидаты", description: "Подсказки и исходные листы по объектам проверки.", action: "Открыть кандидатов", emptyTitle: "Кандидатов пока нет", emptyDescription: "После обработки документов здесь можно будет открыть подсказки и сверить их с исходными листами." },
  protocol: { title: "Протоколы", description: "Черновики и выпущенные версии в рамках проверки объекта.", action: "Открыть протокол", emptyTitle: "Протоколов пока нет", emptyDescription: "Сначала запустите проверку объекта. Затем инспектор сможет оформить и выпустить протокол." },
};

// The attached matrix v1.1 uses M-001…M-132 for these same 132 numbered rows.
// Keep the published dataset code as the runtime identifier and show the matrix alias separately.
const matrixCode = (parameter: ParameterCatalogItem) => `M-${String(parameter.parameter_id).padStart(3, "0")}`;
const matrixReviewPriority = (parameter: ParameterCatalogItem) =>
  parameter.criticality?.startsWith("Критическое") ? "Высокий" :
    parameter.criticality?.startsWith("Существенное") ? "Средний" : "По правилу";

interface UserPreferences {
  denseRows: boolean;
  largeText: boolean;
}

interface ReviewCandidateSummary {
  checkId: string;
  status: "loading" | "ready" | "absent" | "error";
  count: number;
}

const statusLabels: Record<string, string> = {
  DRAFT: "Черновик",
  VALIDATING: "Проверка комплекта",
  PROCESSING: "Идёт анализ",
  PARTIAL: "Частичный результат",
  REVIEW_REQUIRED: "Нужны решения",
  CLARIFICATION_REQUIRED: "На уточнении",
  READY_TO_FINALIZE: "Готов к протоколу",
  FINALIZED: "Финализирован",
  CANDIDATE: "Кандидат ИИ",
  CONFIRMED_VIOLATION: "Подтверждено",
  NEGATIVE_VERIFIED: "Отклонено",
  NOT_COMPARABLE: "Нельзя сравнить",
  CLARIFICATION_REQUIRED_FINDING: "На уточнении",
  COMPLETE: "Загружено",
  MISSING: "Нет файла",
  MIXED: "Смешанный комплект",
  UNKNOWN: "Требует проверки",
};

const findingStatusLabels: Record<FindingStatus, string> = {
  CANDIDATE: "Кандидат ИИ",
  NEGATIVE_VERIFIED: "Отклонено",
  CONFIRMED_VIOLATION: "Подтверждено",
  MISSING_EVIDENCE: "Мало доказательств",
  NOT_APPLICABLE: "Неприменимо",
  NOT_COMPARABLE: "Нельзя сравнить",
  CLARIFICATION_REQUIRED: "На уточнении",
  SUSPICION: "Подозрение",
};

const pilotStatusLabels: Record<string, string> = {
  CLARIFICATION_REQUIRED: "Нужно уточнение",
  MISSING_EVIDENCE: "Недостаточно доказательств",
  CANDIDATE: "Кандидат для проверки",
  NEGATIVE_VERIFIED: "Сравнение выполнено",
};
const pilotReasonLabels: Record<string, string> = {
  REVISION_UNRESOLVED: "Редакции документов не подтверждены",
  COMPONENT_BASIS_MISMATCH: "Состав компонентов ПД и РД различается",
};
const pilotComponentLabels: Record<string, string> = {
  HEATING: "Отопление",
  VENTILATION: "Вентиляция",
  CURTAINS: "Воздушные завесы",
  DHW: "ГВС",
};
const pilotUnitLabels: Record<string, string> = { "Gcal/h": "Гкал/ч", m2: "м²" };
const ocrBasisLabels: Record<string, string> = {
  DESIGN_HEAT_RATE: "Расчётный расход тепла",
  MAX_INCLUDING_CIRCULATION: "Максимальный расход с учётом циркуляции",
  MEAN: "Средний расход тепла",
};
const ocrAbstentionLabels: Record<string, string> = {
  PAGE_STAGE_NOT_RD: "Страница не относится к РД",
  PAGE_STAGE_UNRESOLVED: "Стадия страницы не установлена",
  SECTION_UNRESOLVED: "Раздел не распознан однозначно",
  ROW_LABEL_UNRESOLVED: "Подпись строки не распознана однозначно",
  BASIS_AMBIGUOUS: "Основание строки неоднозначно",
  OCR_SCORE_TOO_LOW: "Низкая оценка OCR",
  OCR_UNIT_UNREADABLE: "Единицы или число не распознаны",
  PAIRED_UNITS_CONTRADICT: "Пара кВт и Гкал/ч противоречит пересчёту",
};
const ocrEvidenceRoleLabels: Record<string, string> = {
  section: "Раздел",
  rowLabel: "Подпись строки",
  basisContinuation: "Продолжение подписи",
  value: "Значение",
};

const stageNames: Record<string, string> = {
  PD: "Проектная документация",
  RD: "Рабочая документация",
  ID: "Исполнительная документация",
  RD_ID_MIXED: "Смешанный комплект РД / ИД",
};

const revocationReasonLabels: Record<ProtocolRevocationReasonCode, string> = {
  SOURCE_DATA_ERROR: "Ошибка в исходных данных",
  REVIEW_DECISION_ERROR: "Ошибка в решении инспектора",
  SCOPE_ERROR: "Ошибка состава проверки",
  PROTOCOL_CONTENT_ERROR: "Ошибка содержания протокола",
  OTHER: "Другая причина",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

interface SidebarProps {
  screen: Screen;
  compact: boolean;
  mobileOpen: boolean;
  onClose: () => void;
  onToggle: () => void;
  onSearch: () => void;
  onNavigate: (screen: Screen) => void;
  candidateCount: number;
}

function Sidebar({ screen, compact, mobileOpen, onClose, onToggle, onSearch, onNavigate, candidateCount }: SidebarProps) {
  const sidebarRef = useRef<HTMLElement>(null);
  const compactRail = compact && !mobileOpen;
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const main = sidebarRef.current?.closest(".app-shell")?.querySelector<HTMLElement>(".main");
    const previousInert = main?.inert;
    document.body.style.overflow = "hidden";
    if (main) main.inert = true;
    sidebarRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const controls = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]") ?? [])
        .filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === sidebarRef.current)) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const onResize = () => { if (window.innerWidth > 900) onClose(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      document.body.style.overflow = previousOverflow;
      if (main) main.inert = previousInert ?? false;
      previousFocus?.focus();
    };
  }, [mobileOpen, onClose]);
  const items = [
    { id: "home" as const, label: "Главная", icon: Building2 },
    { id: "objects" as const, label: "Объекты", icon: FolderKanban },
    { id: "results" as const, label: "Проверки", icon: ShieldCheck },
    { id: "candidates" as const, label: "Кандидаты", icon: FileSearch, badge: candidateCount },
    { id: "protocol" as const, label: "Протоколы", icon: FileCheck2 },
    { id: "catalog" as const, label: "Справочник 132", icon: BookOpen },
  ];
  return (
    <aside ref={sidebarRef} role={mobileOpen ? "dialog" : undefined} aria-modal={mobileOpen || undefined} aria-label={mobileOpen ? "Навигация" : undefined} tabIndex={mobileOpen ? -1 : undefined} className={`sidebar ${compactRail ? "sidebar--compact" : ""} ${mobileOpen ? "sidebar--mobile-open" : ""}`}>
      <div className="sidebar-top">
        <button className="sidebar-search" onClick={onSearch} aria-label="Быстрый поиск"><Search size={17} /><span className="sidebar-copy">Быстрый поиск</span><kbd className="sidebar-copy">Ctrl K</kbd></button>
      </div>
      <nav aria-label="Основная навигация">
        {items.map((item) => {
          const active = item.id === screen || (item.id === "results" && screen === "sources") || (item.id === "candidates" && (screen === "evidence" || screen === "missing"));
          return (
            <button key={item.id} className={`nav-item ${active ? "nav-item--active" : ""}`} onClick={() => onNavigate(item.id)} title={compactRail ? item.label : undefined} aria-current={active ? "page" : undefined}>
              <item.icon size={19} />
              {!compactRail && <span>{item.label}</span>}
              {!compactRail && Boolean(item.badge) && <em>{item.badge}</em>}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-bottom">
        <button className={`nav-item ${screen === "settings" ? "nav-item--active" : ""}`} onClick={() => onNavigate("settings")} title={compactRail ? "Настройки" : undefined} aria-current={screen === "settings" ? "page" : undefined}><Settings size={19} />{!compactRail && <span>Настройки</span>}</button>
        <button className="sidebar-collapse" onClick={onToggle} aria-label={compactRail ? "Развернуть меню" : "Свернуть меню"} title={compactRail ? "Развернуть меню" : "Свернуть меню"}>
          {compactRail ? <Menu size={19} /> : <PanelLeftClose size={19} />}
          {!compactRail && <span className="sidebar-copy">Свернуть меню</span>}
        </button>
      </div>
    </aside>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status === "CLARIFICATION_REQUIRED" ? "clarification" : status.toLowerCase();
  return <span className={`status-badge status-badge--${normalized}`}><span aria-hidden="true" />{findingStatusLabels[status as FindingStatus] ?? statusLabels[status] ?? status}</span>;
}

function Topbar({ object, section, onUpload, onSearch, onHome, onMenu, colorMode, onColorModeChange }: { object: InspectionObject | null; section?: string; onUpload?: () => void; onSearch: () => void; onHome: () => void; onMenu: () => void; colorMode: "system" | "light" | "dark"; onColorModeChange: (mode: "system" | "light" | "dark") => void }) {
  return (
    <header className="topbar">
      <div className="topbar-leading"><button className="topbar-menu" onClick={onMenu} aria-label="Открыть меню"><Menu size={21} /></button><button className="topbar-brand" onClick={onHome} aria-label="На главную"><Brand inverse /></button><div className="breadcrumbs"><span>Мосстройнадзор</span><ArrowRight size={13} /><strong>{object?.address ?? section ?? "Объекты"}</strong></div></div>
      <div className="topbar-actions">
        <button className="search-button" onClick={onSearch} aria-label="Найти объект или параметр" aria-haspopup="dialog"><Search size={17} /><span>Найти объект или параметр</span><kbd>⌘ K</kbd></button>
        <ColorModeControl mode={colorMode} onChange={onColorModeChange} />
        {onUpload && <button className="button button--primary button--small" onClick={onUpload}><Plus size={17} /> Новый объект</button>}
      </div>
    </header>
  );
}

interface GlobalSearchProps {
  objects: InspectionObject[];
  findings: Finding[];
  parameters: ParameterCatalogItem[];
  onClose: () => void;
  onObject: (object: InspectionObject) => void;
  onFinding: (finding: Finding) => void;
  onParameter: (parameter: ParameterCatalogItem) => void;
}

function GlobalSearch({ objects, findings, parameters, onClose, onObject, onFinding, onParameter }: GlobalSearchProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const matches = (value: string) => !normalized || value.toLowerCase().includes(normalized);
  const objectResults = objects.filter((item) => matches(`${item.address} ${item.name} ${item.id}`)).slice(0, 4);
  const findingResults = findings.filter((item) => matches(`${item.title} ${item.parameterCode} ${item.location}`)).slice(0, 6);
  const parameterResults = parameters.filter((item) => matches(`${item.parameter_code} ${matrixCode(item)} ${item.parameter_name} ${item.pd_section ?? ""}`)).slice(0, 6);
  const total = objectResults.length + findingResults.length + (normalized ? parameterResults.length : 0);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const shells = Array.from(document.querySelectorAll<HTMLElement>(".app-shell"));
    const previousInert = shells.map((shell) => shell.inert);
    shells.forEach((shell) => { shell.inert = true; });
    document.body.style.overflow = "hidden";
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input, a[href]") ?? [])
        .filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      shells.forEach((shell, index) => { shell.inert = previousInert[index]; });
      document.body.style.overflow = previousOverflow;
      returnFocus.current?.focus();
    };
  }, [onClose]);

  return (
    <div className="search-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="search-dialog" role="dialog" aria-modal="true" aria-label="Поиск по рабочему пространству">
        <div className="search-dialog__input"><Search size={20} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Адрес, объект, параметр или помещение" aria-label="Поисковый запрос" /><button onClick={onClose} aria-label="Закрыть поиск"><X size={18} /></button></div>
        <div className="search-dialog__body">
          {objectResults.length > 0 && <div className="search-group"><span>Объекты</span>{objectResults.map((item) => <button key={item.id} onClick={() => onObject(item)}><Building2 size={17} /><div><strong>{item.address}</strong><small>{item.name}</small></div><ChevronRight size={16} /></button>)}</div>}
          {findingResults.length > 0 && <div className="search-group"><span>Результаты проверки</span>{findingResults.map((item) => <button key={item.id} onClick={() => onFinding(item)}><FileSearch size={17} /><div><strong>{item.title}</strong><small>{item.parameterCode} · {item.location}</small></div><StatusBadge status={item.status} /></button>)}</div>}
          {normalized && parameterResults.length > 0 && <div className="search-group"><span>Справочник</span>{parameterResults.map((item) => <button key={item.parameter_code} onClick={() => onParameter(item)}><BookOpen size={17} /><div><strong>{item.parameter_name}</strong><small>{item.parameter_code} / {matrixCode(item)} · {item.pd_section ?? "Раздел не указан"}</small></div><ChevronRight size={16} /></button>)}</div>}
          {total === 0 && <div className="search-empty"><Search size={24} /><strong>Ничего не найдено</strong><span>Проверьте код параметра, адрес или помещение.</span></div>}
        </div>
        <footer className="search-dialog__footer"><span><kbd>Esc</kbd> закрыть</span><span>{normalized ? `${total} совпадений` : "Начните ввод или выберите недавнее"}</span></footer>
      </section>
    </div>
  );
}

function ObjectHeader({ object, check }: { object: InspectionObject; check: CheckRun | null }) {
  return (
    <section className="object-heading">
      <div>
        <div className="eyebrow">Проверка · {object.id}</div>
        <h1>{object.address}</h1>
        <p>{object.name}</p>
      </div>
      <div className="heading-meta">
        <span>Обновлено {formatDate(object.updatedAt)}</span>
        <StatusBadge status={check?.status ?? object.status} />
      </div>
    </section>
  );
}

function EmptyState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">{error ? <XCircle /> : <LoaderCircle className="spin" />}</div>
      <h2>{error ? "Не удалось загрузить данные" : "Загружаем рабочее пространство"}</h2>
      <p>{error ?? "Подключаем API и справочник параметров."}</p>
      {error && <button className="button button--secondary" onClick={onRetry}><RefreshCw size={17} /> Повторить</button>}
    </div>
  );
}

function ObjectsScreen({ objects, onOpen, onCreate, section }: { objects: InspectionObject[]; onOpen: (object: InspectionObject) => void; onCreate?: () => void; section?: ObjectScopedScreen }) {
  const [reviewCounts, setReviewCounts] = useState<Record<string, number | null>>({});
  useEffect(() => {
    let active = true;
    for (const object of objects) {
      if (!object.activeCheckId) continue;
      void api.getPilotResults(object.activeCheckId).then((result) => {
        if (active) setReviewCounts((current) => ({ ...current, [object.id]: result.reviewCandidates?.candidateCount ?? object.stats.candidates }));
      }).catch(() => {
        if (active) setReviewCounts((current) => ({ ...current, [object.id]: null }));
      });
    }
    return () => { active = false; };
  }, [objects]);
  const orderedObjects = [...objects].sort((a, b) => section
    ? Number(Boolean(b.activeCheckId)) - Number(Boolean(a.activeCheckId)) || b.updatedAt.localeCompare(a.updatedAt)
    : onCreate ? b.createdAt.localeCompare(a.createdAt) : a.name.localeCompare(b.name, "ru"));
  const activeObjects = section ? orderedObjects.filter((item) => item.activeCheckId) : orderedObjects;
  const draftObjects = section ? orderedObjects.filter((item) => !item.activeCheckId) : [];
  return (
    <div className="content content--wide">
      <div className="page-title-row">
        <div><span className="kicker">Рабочий контур</span><h1>{section ? objectScopedCopy[section].title : "Объекты проверки"}</h1><p>{section ? objectScopedCopy[section].description : "Публичные примеры и ваши комплекты документации."}</p></div>
        {onCreate && !section && <button className="button button--primary" onClick={onCreate}><Plus size={18} /> Создать объект</button>}
      </div>
      {section && !activeObjects.length && <section className="surface scoped-empty" aria-label={objectScopedCopy[section].emptyTitle}>
        <div className="scoped-empty__icon">{section === "results" ? <ShieldCheck size={27} /> : section === "candidates" ? <FileSearch size={27} /> : <FileCheck2 size={27} />}</div>
        <h2>{objectScopedCopy[section].emptyTitle}</h2><p>{objectScopedCopy[section].emptyDescription}</p>
        {onCreate && !draftObjects.length && <button className="button button--primary" onClick={onCreate}><Plus size={18} /> Создать объект</button>}
      </section>}
      {activeObjects.length > 0 && <div className="object-grid">
        {activeObjects.map((object) => (
          <article className="object-card" key={object.id}>
            <div className="object-card__top"><span className="building-icon"><Building2 size={22} /></span><StatusBadge status={object.status} /></div>
            <p className="mono-label">{object.id}</p>
            <h2>{object.address}</h2><p>{object.name}</p>
            <div className="object-card__metrics">
              <span><strong>{object.fileCount}</strong> файлов</span>
              <span><strong>{object.pageCount.toLocaleString("ru-RU")}</strong> страниц</span>
              <span><strong>{!object.activeCheckId ? "—" : reviewCounts[object.id] === null ? "Ошибка" : reviewCounts[object.id] ?? "…"}</strong> подсказок для проверки</span>
            </div>
            <button className="text-action" onClick={() => onOpen(object)}>{object.activeCheckId ? section ? objectScopedCopy[section].action : "Открыть проверку" : "Добавить документы"} <ArrowRight size={16} /></button>
          </article>
        ))}
        {onCreate && !section && <button className="object-card object-card--new" onClick={onCreate}><Plus size={26} /><strong>Новый объект</strong><span>Загрузить ПД, РД и ИД</span></button>}
      </div>}
      {section && draftObjects.length > 0 && <section className="draft-objects" aria-label="Объекты без проверки">
        <h2>Без запущенной проверки</h2>
        {draftObjects.map((item) => <button className="draft-object" key={item.id} onClick={() => onOpen(item)}><span><strong>{item.address}</strong><small>{item.name} · {item.id}</small></span><span>Добавить документы <ArrowRight size={16} /></span></button>)}
      </section>}
      {!section && !orderedObjects.length && <div className="surface scoped-empty"><div className="scoped-empty__icon"><FolderKanban size={27} /></div><h2>Объектов пока нет</h2><p>Создайте объект и добавьте документы, чтобы начать проверку.</p></div>}
    </div>
  );
}

interface UploadScreenProps {
  existingObject?: InspectionObject | null;
  onCancel: () => void;
  onCreated: (object: InspectionObject, files: Record<UploadStage, File[]>) => Promise<void>;
}

function UploadScreen({ existingObject = null, onCancel, onCreated }: UploadScreenProps) {
  const [name, setName] = useState(existingObject?.name ?? "Многоквартирный жилой дом");
  const [address, setAddress] = useState(existingObject?.address ?? "");
  const [files, setFiles] = useState<Record<UploadStage, File[]>>({ PD: [], RD: [], ID: [] });
  const [draftObject, setDraftObject] = useState<InspectionObject | null>(existingObject);
  const [permissions, setPermissions] = useState<{ upload: boolean; run: boolean } | null>(existingObject ? null : { upload: true, run: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<"address" | "files" | null>(null);
  const visibleError = validationError === "address" ? "Укажите адрес объекта"
    : validationError === "files" ? "Добавьте хотя бы один документ" : error;

  useEffect(() => {
    if (!existingObject) return;
    let cancelled = false;
    void api.listSourceFiles(existingObject.id).then((result) => {
      if (!cancelled) setPermissions(result.permissions);
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Не удалось проверить доступ к загрузке");
    });
    return () => { cancelled = true; };
  }, [existingObject]);

  const setStageFiles = (stage: UploadStage, event: ChangeEvent<HTMLInputElement>) => {
    setFiles((current) => ({ ...current, [stage]: Array.from(event.target.files ?? []) }));
    setValidationError((current) => current === "files" ? null : current);
  };

  const submit = async () => {
    if (busy || !permissions?.run) return;
    if (address.trim().length < 3) return setValidationError("address");
    if (Object.values(files).flat().length === 0 && !draftObject?.fileCount) return setValidationError("files");
    setBusy(true); setValidationError(null); setError(null);
    try {
      const object = draftObject ?? await api.createObject({ name, address });
      if (!draftObject) setDraftObject(object);
      await onCreated(object, files);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить комплект и запустить проверку");
    } finally { setBusy(false); }
  };

  return (
    <div className="content content--upload">
      <button className="back-link" onClick={onCancel}><ArrowLeft size={16} /> К объектам</button>
      <div className="page-title-row"><div><span className="kicker">Комплект документации</span><h1>{draftObject ? "Документы объекта" : "Новый объект проверки"}</h1><p>{draftObject ? `Объект сохранён. Сохранено файлов: ${draftObject.fileCount}. Добавьте документы и запустите проверку этого объекта.` : "Сначала зарегистрируем объект и состав комплекта."}</p></div></div>
      <div className="upload-layout">
        <section className="surface form-surface">
          <div className="section-heading"><div className="step-number">01</div><div><h2>Карточка объекта</h2><p>Эти данные попадут в протокол.</p></div></div>
          <div className="field-grid">
            <label><span>Наименование</span><input value={name} onChange={(event) => setName(event.target.value)} disabled={busy || Boolean(draftObject)} /></label>
            <label className="field--wide"><span>Адрес объекта</span><input value={address} onChange={(event) => { setAddress(event.target.value); setValidationError((current) => current === "address" ? null : current); }} placeholder="г. Москва, ул. …" autoFocus disabled={busy || Boolean(draftObject)} /></label>
          </div>
        </section>
        <section className="surface form-surface">
          <div className="section-heading"><div className="step-number">02</div><div><h2>Комплект документации</h2><p>{uploadPolicy.acceptedExtensions.map((item) => item.slice(1).toUpperCase()).join(", ")}. До {uploadPolicy.maxFileBytes / 1024 / 1024} МБ на файл и {uploadPolicy.maxUploadBytes / 1024 / 1024} МБ за один пакет.</p></div></div>
          <div className="dropzone-grid">
            {uploadStages.map((stage) => (
              <label className={`dropzone ${files[stage].length ? "dropzone--filled" : ""}`} key={stage}>
                <input type="file" accept={uploadPolicy.acceptedExtensions.join(",")} multiple onChange={(event) => setStageFiles(stage, event)} disabled={busy || !permissions?.upload} />
                <span className="dropzone__code">{stage}</span>
                {files[stage].length ? <CheckCircle2 size={24} /> : <UploadCloud size={24} />}
                <strong>{stageNames[stage]}</strong>
                <small>{files[stage].length ? `Выбрано файлов: ${files[stage].length}` : "Перетащите или выберите файлы"}</small>
              </label>
            ))}
          </div>
          <div className="notice notice--warning"><AlertTriangle size={18} /><div><strong>Неполный комплект не станет нарушением</strong><span>Система пометит зависимые параметры как «нельзя сравнить» и предложит дозагрузку.</span></div></div>
          {visibleError && <div className="inline-error" role="alert"><XCircle size={17} />{visibleError}</div>}
          {!permissions && !error && <p role="status">Проверяем доступ к документам…</p>}
          {permissions && !permissions.upload && <p>У вашей учётной записи нет права загружать документы этого объекта.</p>}
          {permissions && !permissions.run && <p>У вашей учётной записи нет права запускать проверку этого объекта.</p>}
          <div className="form-actions"><button className="button button--ghost" onClick={onCancel} disabled={busy}>Отмена</button><button className="button button--primary" onClick={submit} disabled={busy || !permissions?.run}>{busy ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />} {draftObject ? "Запустить проверку" : "Создать и запустить анализ"}</button></div>
        </section>
      </div>
    </div>
  );
}

function ProcessingScreen({ object, check }: { object: InspectionObject; check: CheckRun }) {
  const stages = [
    ["Приём файлов и хеширование", 12],
    ["Рендер страниц и OCR", 36],
    ["Классификация документов", 58],
    ["Связывание ПД / РД / ИД", 74],
    ["Применение доступных правил", 90],
    ["Формирование доказательств", 100],
  ] as const;
  return (
    <div className="content">
      <ObjectHeader object={object} check={check} />
      <section className="processing-hero">
        <div className="processing-orbit"><LoaderCircle className="spin" size={34} /><strong>{check.progress}%</strong></div>
        <div><span className="kicker kicker--light">Анализ комплекта</span><h2>{check.currentStage}</h2><p>{object.fileCount} файлов · {object.pageCount.toLocaleString("ru-RU")} страниц. Можно закрыть экран — обработка продолжится.</p></div>
      </section>
      <div className="pipeline-grid">
        <section className="surface pipeline-card">
          <div className="surface-title"><div><h3>Конвейер обработки</h3><p>Каждый результат привязан к версии входного файла.</p></div><span className="live-indicator">В работе</span></div>
          <div className="pipeline-list">
            {stages.map(([label, threshold], index) => {
              const complete = check.progress >= threshold;
              const active = !complete && (index === 0 || check.progress >= stages[index - 1][1]);
              return <div className={`pipeline-step ${complete ? "pipeline-step--done" : active ? "pipeline-step--active" : ""}`} key={label}><span>{complete ? <Check size={16} /> : index + 1}</span><div><strong>{label}</strong><small>{complete ? "Завершено" : active ? "Выполняется" : "Ожидает"}</small></div>{active && <LoaderCircle className="spin" size={17} />}</div>;
            })}
          </div>
        </section>
        <aside className="surface processing-summary"><h3>Состав комплекта</h3>{object.stages.map((stage) => <div className="stage-row" key={stage.stage}><span className={`stage-dot stage-dot--${stage.status.toLowerCase()}`} /><div><strong>{stageNames[stage.stage]}</strong><small>{stage.fileCount} файлов · {stage.pageCount.toLocaleString("ru-RU")} стр.</small></div><StatusBadge status={stage.status} /></div>)}</aside>
      </div>
    </div>
  );
}

function ResultsScreen({ object, check, findings, reviewCandidateSummary, canViewSources, onOpen, onMissing, onProtocol, onSources, onReviewCandidates }: { object: InspectionObject; check: CheckRun; findings: Finding[]; reviewCandidateSummary: ReviewCandidateSummary | null; canViewSources: boolean; onOpen: (finding: Finding) => void; onMissing: () => void; onProtocol: () => void; onSources: () => void; onReviewCandidates: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"ALL" | FindingStatus>("ALL");
  const visible = findings.filter((finding) => {
    const matchesQuery = `${finding.title} ${finding.parameterCode} ${finding.location}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (filter === "ALL" || finding.status === filter);
  });
  const summary = check.mode === "DEMO_SEED"
    ? "Публичные примеры для ручной проверки. Автоматический анализ 132 параметров здесь не запускался."
    : check.status === "PARTIAL"
      ? "Результат требует проверки инспектором по исходным документам."
      : "Решения инспектора не подменены выводами модели.";
  return (
    <div className="content">
      <ObjectHeader object={object} check={check} />
      <section className="review-summary" aria-label="Сводка проверки">
        <div className="summary-intro"><span>Матрица проверки</span><strong>{check.stats.total} параметра</strong><small>{summary}</small></div>
        {check.mode === "NORMAL" ? <button className="summary-metric summary-metric--button" onClick={onReviewCandidates}>
          <span>Кандидаты на замечания</span>
          <strong>{reviewCandidateSummary?.status === "ready" ? reviewCandidateSummary.count
            : reviewCandidateSummary?.status === "loading" || !reviewCandidateSummary ? "…" : "—"}</strong>
          <small>{reviewCandidateSummary?.status === "ready" ? "Открыть подсказки и исходные листы"
            : reviewCandidateSummary?.status === "error" ? "Ошибка чтения — открыть подробности"
              : reviewCandidateSummary?.status === "absent" ? "Адресных подсказок в запуске нет" : "Загружаем подсказки"}</small>
        </button> : <div className="summary-metric"><span>Учебные примеры</span><strong>{check.stats.candidates}</strong><small>ждут решения</small></div>}
        <div className="summary-metric"><span>Подтверждено</span><strong>{check.stats.confirmed}</strong><small>инспектором</small></div>
      </section>
      <section className="surface results-surface">
        <div className="surface-title results-title"><div><span className="kicker">Официальная очередь</span><h2>Результаты сравнения</h2><p>{visible.length} записей в текущем представлении</p></div><div className="source-review-actions">{check.mode === "NORMAL" && canViewSources && <button className="button button--secondary" onClick={onSources}><FileText size={17} /> Исходные документы</button>}<button className="button button--secondary" onClick={onMissing}>Ограничения анализа</button><button className="button button--secondary" onClick={onProtocol}><FileCheck2 size={17} /> Открыть протокол</button></div></div>
        <div className="filterbar">
          <label className="filter-search"><Search size={17} /><input id="results-search" aria-label="Поиск по параметру, коду или помещению" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Параметр, код или помещение" /></label>
          <div className="segmented" role="group" aria-label="Фильтр статуса">
            {(["ALL", "CANDIDATE", "CONFIRMED_VIOLATION", "NEGATIVE_VERIFIED"] as const).map((status) => <button key={status} className={filter === status ? "active" : ""} onClick={() => setFilter(status)}>{status === "ALL" ? "Все" : status === "CANDIDATE" ? "Кандидаты" : status === "CONFIRMED_VIOLATION" ? "Подтверждено" : "Отклонено"}</button>)}
          </div>
        </div>
        <div className="results-table" aria-label="Результаты проверки">
          <div className="table-row table-head" aria-hidden="true"><span>Параметр</span><span>Локация</span><span>ПД и РД</span><span>Уверенность</span><span>Статус</span><span /></div>
          {visible.map((finding) => <button className="table-row table-row--button" aria-label={`${finding.parameterCode}, ${finding.title}, ${finding.location}, ${findingStatusLabels[finding.status]}`} key={finding.id} onClick={() => onOpen(finding)}><span className="parameter-cell"><em>{finding.parameterCode}</em><strong>{finding.title}</strong></span><span>{finding.location}</span><span className="value-pair"><small>ПД</small><span>{finding.expectedValue}</span><small>РД</small><span>{finding.actualValue}</span></span><span className="confidence-value">{finding.confidence === null ? "—" : <>{Math.round(finding.confidence * 100)}<small>%</small></>}</span><span><StatusBadge status={finding.status} /></span><span className="row-action" aria-hidden="true"><ArrowRight size={17} /></span></button>)}
          {!visible.length && <div className="table-empty">В официальной очереди по этому фильтру результатов нет.
            {check.mode === "NORMAL" && reviewCandidateSummary?.status === "ready" && reviewCandidateSummary.count > 0 && <div>
              <p>Подсказок для проверки по исходным листам: {reviewCandidateSummary.count}.</p>
              <button className="button button--secondary" onClick={onReviewCandidates}>Открыть кандидатов на замечания</button>
            </div>}
          </div>}
        </div>
      </section>
    </div>
  );
}

function CandidatesScreen({ object, check, findings, onOpen }: { object: InspectionObject; check: CheckRun; findings: Finding[]; onOpen: (finding: Finding) => void }) {
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<"ALL" | Finding["severity"]>("ALL");
  const candidates = findings.filter((finding) => finding.status === "CANDIDATE");
  const visible = candidates.filter((finding) => {
    const matchesQuery = `${finding.title} ${finding.parameterCode} ${finding.location}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (severity === "ALL" || finding.severity === severity);
  });

  return (
    <div className="content">
      <ObjectHeader object={object} check={check} />
      <div className="page-title-row page-title-row--compact"><div><span className="kicker">Очередь решений</span><h1>Кандидаты ИИ</h1><p>Сначала выберите запись. Сравнение документов откроется отдельным рабочим экраном.</p></div><span className="candidate-total"><strong>{candidates.length}</strong> без решения</span></div>
      <section className="surface results-surface">
        <div className="filterbar">
          <label className="filter-search"><Search size={17} /><input id="candidates-search" aria-label="Поиск среди кандидатов" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Параметр, код или помещение" /></label>
          <div className="segmented" role="group" aria-label="Фильтр критичности">
            {(["ALL", "CRITICAL", "WARNING"] as const).map((value) => <button key={value} className={severity === value ? "active" : ""} onClick={() => setSeverity(value)}>{value === "ALL" ? "Все" : value === "CRITICAL" ? "Критичные" : "Внимание"}</button>)}
          </div>
        </div>
        <div className="candidate-list" aria-label="Кандидаты без решения">
          {visible.map((finding) => <button className="candidate-row" key={finding.id} onClick={() => onOpen(finding)}><span className={`severity-dot severity-dot--${finding.severity.toLowerCase()}`} aria-label={`Критичность: ${finding.severity === "CRITICAL" ? "критическая" : "требует внимания"}`} /><span className="parameter-cell"><em>{finding.parameterCode}</em><strong>{finding.title}</strong></span><span className="candidate-location">{finding.location}</span><span className="candidate-comparison"><small>ПД</small><strong>{finding.expectedValue ?? "Нет значения"}</strong><small>РД</small><strong>{finding.actualValue ?? "Нет значения"}</strong></span><span className="confidence-value">{finding.confidence === null ? "—" : <>{Math.round(finding.confidence * 100)}<small>%</small></>}</span><span className="candidate-open">Сравнить документы <ArrowRight size={16} /></span></button>)}
          {!visible.length && <div className="table-empty">Кандидатов по этому фильтру нет.</div>}
        </div>
      </section>
    </div>
  );
}

interface EvidenceScreenProps {
  finding: Finding;
  findings: Finding[];
  onSelect: (finding: Finding) => void;
  onBack: () => void;
  onDecision: (type: DecisionType, reason: string) => Promise<void>;
}

function EvidenceScreen({ finding, findings, onSelect, onBack, onDecision }: EvidenceScreenProps) {
  const [reason, setReason] = useState(finding.decision?.reason ?? "");
  const [zoom, setZoom] = useState(72);
  const [busy, setBusy] = useState<DecisionType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const candidates = findings.filter((item) => item.status === "CANDIDATE");
  const index = findings.findIndex((item) => item.id === finding.id);
  const left = finding.evidence[0];
  const right = finding.evidence[1];

  useEffect(() => { setReason(finding.decision?.reason ?? ""); setError(null); }, [finding.id, finding.decision?.reason]);

  const submit = async (type: DecisionType) => {
    if (reason.trim().length < 5) return setError("Добавьте причину решения — минимум 5 символов");
    setBusy(type); setError(null);
    try { await onDecision(type, reason); } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось сохранить решение"); } finally { setBusy(null); }
  };

  return (
    <div className="evidence-screen">
      <header className="evidence-topbar"><button className="back-link" onClick={onBack} disabled={Boolean(busy)}><ArrowLeft size={16} /> Результаты</button><div className="evidence-nav"><button aria-label="Предыдущий результат" disabled={Boolean(busy) || index <= 0} onClick={() => onSelect(findings[index - 1])}><ArrowLeft size={16} /></button><span>Результат {index + 1} из {findings.length}</span><button aria-label="Следующий результат" disabled={Boolean(busy) || index >= findings.length - 1} onClick={() => onSelect(findings[index + 1])}><ArrowRight size={16} /></button></div><div className="zoom-control"><button aria-label="Уменьшить масштаб" onClick={() => setZoom((value) => Math.max(40, value - 10))}><ZoomOut size={16} /></button><span>{zoom}%</span><button aria-label="Увеличить масштаб" onClick={() => setZoom((value) => Math.min(120, value + 10))}><ZoomIn size={16} /></button></div></header>
      <div className="evidence-layout">
        <aside className="candidate-rail">
          <span className="kicker">Очередь</span><strong>{candidates.length} без решения</strong>
          <div>{findings.map((item) => <button key={item.id} className={item.id === finding.id ? "active" : ""} onClick={() => onSelect(item)} disabled={Boolean(busy)}><span className={`severity-dot severity-dot--${item.severity.toLowerCase()}`} aria-label={`Критичность: ${item.severity === "CRITICAL" ? "критическая" : "требует внимания"}`} /><div><em>{item.parameterCode}</em><strong>{item.location}</strong></div>{item.status !== "CANDIDATE" && <CheckCircle2 size={14} />}</button>)}</div>
        </aside>
        <main className="document-workspace">
          {[left, right].map((evidence, evidenceIndex) => <section className="document-pane" key={evidence?.fileId ?? evidenceIndex}><header><span className={`doc-stage doc-stage--${evidence?.stage.toLowerCase()}`}>{evidence?.stage ?? "—"}</span><div><strong>{evidence?.fileName ?? "Документ не найден"}</strong><small>{evidence ? `Страница PDF ${evidence.pdfPageNumber} · лист ${evidence.documentSheetNumber ?? "—"}` : "Нет источника"}</small></div></header><div className="page-canvas">{evidence?.imageUrl ? <img src={evidence.imageUrl} alt={`${evidence.stage}, страница ${evidence.pdfPageNumber}`} style={{ width: `${zoom}%` }} /> : <div className="document-empty"><FileText size={32} />Нет изображения страницы</div>}<span className={`source-ribbon source-ribbon--${evidenceIndex}`}>{evidenceIndex === 0 ? "Ожидание по ПД" : "Факт по РД"}</span></div></section>)}
        </main>
        <aside className="decision-panel">
          <div className="decision-panel__scroll">
            <div className="decision-heading"><StatusBadge status={finding.status} /><span>{finding.confidence === null ? "Оценка модели отсутствует" : `Оценка модели: ${Math.round(finding.confidence * 100)}%`}</span><h1>{finding.title}</h1><p>{finding.parameterCode} · {finding.location}</p></div>
            <div className="comparison-box"><div><span>ПД · ожидается</span><strong>{finding.expectedValue ?? "Нет значения"}</strong></div><div><span>РД · найдено</span><strong>{finding.actualValue ?? "Нет значения"}</strong></div></div>
            <div className="reasoning"><span><Sparkles size={15} /> Основание модели</span><p>{finding.rationale}</p></div>
            <div className="source-list"><span>Источники</span>{finding.evidence.map((evidence) => <div key={`${evidence.fileId}-${evidence.pdfPageNumber}`}><FileText size={15} /><div><strong>{evidence.fileId} · стр. {evidence.pdfPageNumber}</strong><small>SHA-256: {evidence.sha256.slice(0, 12)}…</small></div></div>)}</div>
            {finding.decision && <div className="notice notice--success"><CheckCircle2 size={18} /><div><strong>Решение сохранено</strong><span>{finding.decision.author}, {formatDate(finding.decision.decidedAt)}</span></div></div>}
          </div>
          <div className="decision-actions"><label><span>Причина решения <em>обязательное поле</em></span><textarea value={reason} onChange={(event) => setReason(event.target.value)} disabled={Boolean(busy)} placeholder="Укажите основание со ссылкой на документ" rows={3} aria-invalid={Boolean(error)} aria-describedby={error ? "decision-error" : undefined} /></label>{error && <div className="inline-error" id="decision-error"><XCircle size={16} />{error}</div>}<div className="decision-buttons"><button className="decision-button decision-button--reject" onClick={() => submit("REJECT")} disabled={Boolean(busy)}>{busy === "REJECT" ? <LoaderCircle className="spin" size={17} /> : <X size={17} />} Отклонить кандидат</button><button className="decision-button decision-button--clarify" onClick={() => submit("CLARIFY")} disabled={Boolean(busy)}><Send size={17} /> Запросить уточнение</button><button className="decision-button decision-button--confirm" onClick={() => submit("CONFIRM")} disabled={Boolean(busy)}>{busy === "CONFIRM" ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} Подтвердить нарушение</button></div></div>
        </aside>
      </div>
    </div>
  );
}

function OcrEvidenceLines({ evidence }: { evidence: OcrHeatRowEvidence[] }) {
  return <div className="ocr-heat-evidence" aria-label="Исходные строки OCR">
    <strong>Исходные строки OCR — сверить с листом</strong>
    <ol>{evidence.map((line) => <li key={`${line.role}-${line.lineIndex}`}>
      <span>{ocrEvidenceRoleLabels[line.role] ?? line.role} · строка {line.lineIndex + 1}</span>
      <blockquote>{line.text || "[OCR вернул пустую строку]"}</blockquote>
      <small>Оценка OCR {line.score.toFixed(3)} · область [{line.bboxPx.join(", ")}] px</small>
    </li>)}</ol>
  </div>;
}

export function OcrHeatRowsReview({ data, objectId, onSources }: {
  data: OcrHeatRowsRead;
  objectId: string;
  onSources?: () => void;
}) {
  const reasonCounts = data.abstentions.reduce<Record<string, number>>((counts, item) => {
    counts[item.reasonCode] = (counts[item.reasonCode] ?? 0) + 1;
    return counts;
  }, {});
  return <section className="ocr-heat-review" aria-label="Непроверенные подсказки OCR по тепловым нагрузкам">
    <div className="ocr-heat-review__heading">
      <div><span className="kicker">Помощь эксперту · PZ-017</span><h3>Непроверенные подсказки OCR по тепловым нагрузкам</h3></div>
      {onSources && <button type="button" className="button button--secondary" onClick={onSources}>Сверить OCR с источником</button>}
    </div>
    <p className="ocr-heat-review__warning"><strong>Требуется ручная сверка.</strong> OCR может ошибиться в тексте, числе, единице или стадии. Эти подсказки не создают проверенные факты, сравнение ПД и РД или находки.</p>
    <p className="ocr-heat-review__counts">Всего: предложения — {data.proposalCount}, воздержания — {data.abstentionCount}. В списке: предложения — {data.proposals.length}, воздержания — {data.abstentions.length}.</p>
    {data.truncated && <p className="ocr-heat-review__truncated" role="status">Список сокращён: часть строк не показана. Числа выше относятся ко всему сохранённому результату.</p>}
    <div className="ocr-heat-review__group">
      <h4>Строки для ручной проверки</h4>
      {data.proposals.length === 0 && <p>Предложений нет. Это не подтверждает отсутствие тепловых нагрузок в документах.</p>}
      <ol className="ocr-heat-proposals">{data.proposals.map((proposal, index) => <li key={`${proposal.sourceFileId}-${proposal.pageNumber}-${index}`}>
        <div className="ocr-heat-proposal__head"><strong>{pilotComponentLabels[proposal.component] ?? proposal.component} · {ocrBasisLabels[proposal.basis] ?? proposal.basis}</strong><span>Непроверенная подсказка OCR</span></div>
        <p>Предполагаемая стадия: {stageNames[proposal.stage] ?? proposal.stage}. OCR прочитал: <strong>{proposal.values.kW.replace(".", ",")} кВт · {proposal.values["Gcal/h"].replace(".", ",")} Гкал/ч</strong>.</p>
        <p className="ocr-heat-proposal__source">Источник {proposal.sourceFileId} · страница PDF {proposal.pageNumber} · SHA-256 {proposal.inputSha256.slice(0, 12)}…</p>
        <OcrEvidenceLines evidence={proposal.evidence} />
        <div className="ocr-heat-proposal__actions"><a className="button button--secondary" href={api.sourcePagePreviewUrl(objectId, proposal.sourceFileId, proposal.pageNumber)} target="_blank" rel="noopener noreferrer">Открыть исходный лист {proposal.pageNumber}</a></div>
        <details className="ocr-heat-proposal__origin"><summary>Хеши OCR и листа</summary><p>OCR страницы: {proposal.ocrPageContentHash}</p><p>Рендер листа: {proposal.renderSha256}</p></details>
      </li>)}</ol>
    </div>
    <div className="ocr-heat-review__group">
      <h4>Где OCR воздержался</h4>
      {data.abstentionCount === 0 ? <p>Воздержаний в сохранённом результате нет.</p> : <>
        <ul className="ocr-heat-reasons" aria-label="Причины воздержаний">{Object.entries(reasonCounts).map(([reason, count]) => <li key={reason}>{ocrAbstentionLabels[reason] ?? reason}: {count}{data.truncated ? " показано" : ""}</li>)}</ul>
        {data.truncated && <p>Причины перечислены только для показанных строк.</p>}
        <div className="ocr-heat-abstentions">{data.abstentions.map((item, index) => <details key={`${item.sourceFileId}-${item.pageNumber}-${item.lineIndex}-${index}`}>
          <summary>{ocrAbstentionLabels[item.reasonCode] ?? item.reasonCode} · источник {item.sourceFileId} · страница PDF {item.pageNumber} · строка {item.lineIndex + 1}</summary>
          <p>OCR не предложил значение для этой строки. Причина: {ocrAbstentionLabels[item.reasonCode] ?? item.reasonCode} ({item.reasonCode}).</p>
          <p className="ocr-heat-proposal__source">Источник SHA-256 {item.inputSha256.slice(0, 12)}…</p>
          <OcrEvidenceLines evidence={item.evidence} />
          <a className="button button--secondary" href={api.sourcePagePreviewUrl(objectId, item.sourceFileId, item.pageNumber)} target="_blank" rel="noopener noreferrer">Открыть исходный лист {item.pageNumber}</a>
        </details>)}</div>
      </>}
    </div>
  </section>;
}

const factFamilyParameterLabels: Record<string, string> = {
  "PZ-004": "Строительный объём",
  "PZ-007": "Количество надземных этажей",
  "KR-055": "Класс бетона несущего элемента",
  "KR-058": "Толщина фундамента",
  "KR-059": "Толщина плиты перекрытия",
};
const factFamilyReasonLabels: Record<string, string> = {
  REQUIRED_FACT_MISSING: "Нет пары значений ПД и РД",
  AMBIGUOUS_FACTS: "Найдено несколько значений для одной стадии",
  REVISION_NOT_CURRENT: "Редакция источника не подтверждена как текущая",
  APPROVAL_NOT_APPROVED: "Согласование источника не подтверждено",
  LINK_GROUP_MISSING: "Группа связи документов не задана",
  LINK_GROUP_MISMATCH: "Документы относятся к разным группам связи",
  ENTITY_LINK_MISSING: "Соответствие элементов ПД и РД не подтверждено",
  AMBIGUOUS_ENTITY_LINK: "Соответствие элементов неоднозначно",
  ENTITY_LINK_INVALID: "Подтверждение соответствия элементов некорректно",
  VALUE_OR_UNIT_INVALID: "Значение или единица не распознаны однозначно",
  COMPARISON_TRIGGERED_REVIEW: "Предварительный сигнал для ручной проверки",
  COMPARISON_NOT_TRIGGERED_REVIEW: "Предварительное сравнение без сигнала",
  NO_DIFFERENCE_OBSERVED: "В предложенных значениях различия нет",
};

function factFamilyText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function FactFamilyReview({ data, objectId }: {
  data: NonNullable<PilotResultsRead["factFamily"]>;
  objectId: string;
}) {
  const factsByCode = new Map<string, Record<string, unknown>[]>();
  for (const fact of data.facts) {
    const code = factFamilyText(fact.parameterCode);
    if (code) factsByCode.set(code, [...(factsByCode.get(code) ?? []), fact]);
  }
  return <section className="surface" aria-label="Предложения по фактам и сравнениям" style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Помощь эксперту · ПЗ и КР</span><h3>Предложения по фактам и сравнениям</h3><p>Пять правил: ПЗ-004, ПЗ-007, КР-055, КР-058, КР-059.</p></div></div>
    <p><strong>Требуется ручная сверка.</strong> Значения извлечены из документов; они не являются подтверждёнными фактами. Статусы ниже не создают находки, нарушения или вывода об отсутствии нарушения.</p>
    <p>Предложений по фактам: {data.facts.length}. Статусов сравнения: {data.comparisons.length}. Находок: {data.findingCount}.</p>
    {data.comparisons.map((item, index) => {
      const code = factFamilyText(item.parameterCode) ?? `Правило ${index + 1}`;
      const status = factFamilyText(item.status) ?? "ABSTAIN";
      const reasons = Array.isArray(item.reasonCodes)
        ? item.reasonCodes.filter((reason): reason is string => typeof reason === "string") : [];
      const facts = factsByCode.get(code) ?? [];
      return <details key={`${code}-${index}`} style={{ marginTop: "var(--space-md)" }}>
        <summary><strong>{code} · {factFamilyParameterLabels[code] ?? "Параметр"}</strong> · {status === "ABSTAIN" ? "Сравнение остановлено" : status === "REVIEW_REQUIRED" ? "Нужна ручная проверка" : status} · {facts.length} предложений по фактам</summary>
        <p>Причина: {reasons.length ? reasons.map((reason) => factFamilyReasonLabels[reason] ?? reason).join("; ") : "не указана"}.</p>
        <div className="missing-list" aria-label={`Предложения по фактам ${code}`}>
          {facts.map((fact, factIndex) => {
            const stage = factFamilyText(fact.stage) ?? "?";
            const sourceFileId = factFamilyText(fact.sourceFileId);
            const sourceSha256 = factFamilyText(fact.sourceSha256);
            const pageNumber = fact.pageNumber;
            const hasPage = typeof pageNumber === "number" && Number.isInteger(pageNumber) && pageNumber > 0;
            return <div key={`${factFamilyText(fact.factId) ?? code}-${factIndex}`}>
              <span>{stage}</span><div>
                <strong>{factFamilyText(fact.rawValue) ?? "Значение не указано"} {factFamilyText(fact.rawUnit) ?? ""}</strong>
                <small>Источник {sourceFileId ?? "не указан"}{hasPage ? ` · страница PDF ${pageNumber}` : ""}{sourceSha256 ? ` · SHA-256 ${sourceSha256.slice(0, 12)}…` : ""}</small>
                {sourceFileId && hasPage && <a href={api.sourcePagePreviewUrl(objectId, sourceFileId, pageNumber)} target="_blank" rel="noopener noreferrer">Открыть исходный лист {pageNumber}</a>}
              </div>
            </div>;
          })}
          {!facts.length && <p>Предложений по фактам нет. Это не подтверждает отсутствие параметра в документах.</p>}
        </div>
      </details>;
    })}
  </section>;
}

function MissingScreen({ object, check, onBack, onUpload, onSources, onReprocess, onProtocol, parameterCatalog }: { object: InspectionObject; check: CheckRun; onBack: () => void; onUpload?: () => void; onSources?: () => void; onReprocess?: () => Promise<void>; onProtocol: () => void; parameterCatalog: Record<string, { name: string; matrixCode: string }> }) {
  const [coverage, setCoverage] = useState<ParameterCoverageItem[] | null>(null);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [pilotResults, setPilotResults] = useState<PilotResultsRead | null>(null);
  const [pilotError, setPilotError] = useState<string | null>(null);
  useEffect(() => {
    if (check.mode !== "NORMAL") return;
    let cancelled = false;
    setCoverage(null);
    setCoverageError(null);
    setPilotResults(null);
    setPilotError(null);
    api.getCoverage(check.id).then((items) => {
      if (!cancelled) setCoverage(items);
    }).catch((error: unknown) => {
      if (!cancelled) setCoverageError(error instanceof Error ? error.message : "Не удалось загрузить покрытие правил");
    });
    api.getPilotResults(check.id).then((result) => {
      if (!cancelled) setPilotResults(result);
    }).catch((error: unknown) => {
      if (!cancelled) setPilotError(error instanceof Error ? error.message : "Не удалось загрузить результаты правил");
    });
    return () => { cancelled = true; };
  }, [check.id, check.mode]);

  const partial = coverage?.filter((item) => item.executionStatus === "PARTIAL") ?? [];
  const unsupported = coverage?.filter((item) => item.executionStatus === "UNSUPPORTED") ?? [];
  const coverageList = check.mode === "NORMAL" && (
    <section className="surface" aria-label="Покрытие параметров" style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
      <div className="surface-title"><div><h3>Покрытие по параметрам</h3><p>Частичный анализ не подтверждает отсутствие расхождений.</p></div></div>
      {coverageError && <p role="alert">{coverageError}</p>}
      {!coverage && !coverageError && <p role="status">Загружаем причины по параметрам…</p>}
      {coverage && <>
        <div className="missing-list" aria-label="Частично проверенные параметры">
          {partial.map((item) => <div key={item.parameterCode}><span>{item.parameterCode}</span><div><strong>{item.parameterName}</strong><small>{item.reason}</small></div><StatusBadge status="PARTIAL" /></div>)}
          {!partial.length && <p>Частично выполненных параметров нет.</p>}
        </div>
        {pilotError && <p role="alert">{pilotError}</p>}
        {!pilotResults && !pilotError && <p role="status">Загружаем сохранённые факты…</p>}
        {pilotResults && pilotResults.items.length > 0 && <div aria-label="Сохранённые факты пилотных правил">
          <h3>Сохранённые факты пилотных правил</h3>
          {pilotResults.items.map((item) => <details key={item.resultId} style={{ marginTop: "var(--space-sm)" }}>
            <summary>{item.parameterCode} · {pilotStatusLabels[item.machineStatus] ?? item.machineStatus}{item.reasonCode ? ` · ${pilotReasonLabels[item.reasonCode] ?? item.reasonCode}` : ""}</summary>
            <p>Сравнение: {item.comparison?.disposition === "ABSTAIN" ? "остановлено" : item.comparison?.disposition ?? "не выполнялось"}{item.comparison?.reasonCode ? ` · ${pilotReasonLabels[item.comparison.reasonCode] ?? item.comparison.reasonCode}` : ""}. Это не подтверждённое нарушение.</p>
            <div className="missing-list">
              {item.facts.map((fact, index) => <div key={`${fact.sourceFileId}-${fact.pageNumber}-${fact.component ?? "value"}-${index}`}>
                <span>{fact.stage}</span><div><strong>{fact.component ? pilotComponentLabels[fact.component] ?? fact.component : "Значение"}: {fact.value.replace(".", ",")} {pilotUnitLabels[fact.unit] ?? fact.unit}</strong><small>{fact.sourceFileId} · страница PDF {fact.pageNumber} · SHA-256 {fact.sourceSha256.slice(0, 12)}…</small></div>
              </div>)}
              {!item.facts.length && <p>Проверенные значения не извлечены.</p>}
            </div>
          </details>)}
        </div>}
        <details style={{ marginTop: "var(--space-md)" }}>
          <summary>Не поддерживаются: {unsupported.length} параметров</summary>
          <div className="missing-list" aria-label="Неподдерживаемые параметры">
            {unsupported.map((item) => <div key={item.parameterCode}><span>{item.parameterCode}</span><div><strong>{item.parameterName}</strong><small>{item.reason}</small></div><code>UNSUPPORTED</code></div>)}
          </div>
        </details>
      </>}
      {pilotResults?.ocrHeatRows && <OcrHeatRowsReview data={pilotResults.ocrHeatRows} objectId={object.id} onSources={onSources} />}
      {pilotResults?.ocrTableRows && <OcrTableRowsReview data={pilotResults.ocrTableRows} objectId={object.id} />}
      {pilotResults?.ocrTableRows && <OcrRowTranscriptionReview checkId={check.id} objectId={object.id} />}
      {check.mode === "NORMAL" && onSources && <OcrRowApplicabilityReview
        checkId={check.id} objectId={object.id} onSources={onSources} />}
      {check.mode === "NORMAL" && pilotResults?.ocrTableRows &&
        <OcrFactPairReview checkId={check.id} objectId={object.id} />}
      {check.mode === "NORMAL" && pilotResults?.ocrTableRows &&
        <OcrFactPairQuantityReview checkId={check.id} objectId={object.id} />}
      {check.mode === "NORMAL" && pilotResults?.ocrTableRows &&
        <OcrFactPairComparisonPreview checkId={check.id} />}
      {pilotResults?.factFamily && <FactFamilyReview data={pilotResults.factFamily} objectId={object.id} />}
      {pilotResults?.factFamily && onReprocess && <FactLinkReview data={pilotResults.factFamily} checkId={check.id} objectId={object.id} onReprocess={onReprocess} />}
      {pilotResults?.candidateFamilyObservations && <CandidateFamilyObservations
        data={pilotResults.candidateFamilyObservations}
        objectId={object.id}
        parameterNames={Object.fromEntries((coverage ?? []).map((item) => [item.parameterCode, item.parameterName]))}
      />}
      {pilotResults?.candidateFamilyOcrObservations && <CandidateFamilyOcrObservations
        data={pilotResults.candidateFamilyOcrObservations}
        objectId={object.id}
        parameterNames={Object.fromEntries((coverage ?? []).map((item) => [item.parameterCode, item.parameterName]))}
      />}
      {pilotResults?.unresolvedFamilyReview && <UnresolvedFamilyReview
        data={pilotResults.unresolvedFamilyReview} objectId={object.id} />}
      {pilotResults?.unresolvedFamilyOcrReview && <UnresolvedFamilyOcrReview
        data={pilotResults.unresolvedFamilyOcrReview} objectId={object.id} />}
      {pilotResults?.siteTepAreaReview && <SiteTepAreaReview
        data={pilotResults.siteTepAreaReview} objectId={object.id} />}
      {pilotResults?.siteGpContextReview && <SiteGpContextReview
        data={pilotResults.siteGpContextReview} objectId={object.id} />}
      {pilotResults?.siteGpTableRowReview && <SiteGpTableRowReview
        data={pilotResults.siteGpTableRowReview} objectId={object.id} />}
      {pilotResults?.equipmentSpecReview && <EquipmentSpecReview
        data={pilotResults.equipmentSpecReview} objectId={object.id} />}
      {pilotResults?.materialClassReview && <MaterialClassReview
        data={pilotResults.materialClassReview} objectId={object.id} />}
      {pilotResults?.unresolvedConfigReview && <UnresolvedConfigReview
        data={pilotResults.unresolvedConfigReview} objectId={object.id} />}
      {pilotResults?.unresolvedConfigReviewV2 && <UnresolvedConfigReviewV2
        data={pilotResults.unresolvedConfigReviewV2} objectId={object.id} />}
      {pilotResults?.unresolvedConfigReviewV3 && <UnresolvedConfigReviewV3
        data={pilotResults.unresolvedConfigReviewV3} objectId={object.id} />}
      {pilotResults?.layerAssemblyReview && <LayerAssemblyReview
        data={pilotResults.layerAssemblyReview} objectId={object.id} />}
      {pilotResults?.kr065OpeningReview && <Kr065OpeningReview
        data={pilotResults.kr065OpeningReview} objectId={object.id} />}
      {pilotResults?.candidateFamilyPreview && !pilotResults.candidateFamilyObservations && <CandidateFamilyPreview
        data={pilotResults.candidateFamilyPreview}
        objectId={object.id}
        parameterNames={Object.fromEntries((coverage ?? []).map((item) => [item.parameterCode, item.parameterName]))}
      />}
    </section>
  );
  const reviewPanel = pilotResults?.reviewCandidates && <ReviewCandidates
    data={pilotResults.reviewCandidates} checkId={check.id}
    objectId={object.id} onProtocol={onProtocol} parameterCatalog={parameterCatalog} />;
  if (check.mode === "DEMO_SEED") {
    return <div className="content"><button className="back-link" onClick={onBack}><ArrowLeft size={16} /> К результатам</button><ObjectHeader object={object} check={check} /><section className="missing-hero"><span><AlertTriangle size={25} /></span><div><span className="kicker">Учебный объект</span><h2>{check.stats.total} параметра не проверялись в этом демо</h2><p>Здесь сохранены публичные примеры для ручной проверки. Автоматический анализ комплекта и исполнение правил для этого объекта не запускались.</p></div></section><section className="surface" style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}><h3>Что означает число {check.stats.unsupported}</h3><p>В техническом coverage учебного запуска все параметры имеют статус UNSUPPORTED: демонстрационные карточки не доказывают исполнение правил. Это число не показывает охват подсказок для новых документов. Их результаты и причины неопределённости смотрите в конкретном запуске проверки.</p></section></div>;
  }
  if (check.stats.unsupported > 0) {
    return <div className="content"><button className="back-link" onClick={onBack}><ArrowLeft size={16} /> К результатам</button><ObjectHeader object={object} check={check} />{reviewPanel}<section className="missing-hero"><span><AlertTriangle size={25} /></span><div><span className="kicker">Покрытие правил</span><h2>{check.stats.unsupported} параметров пока не исполняются</h2><p>Файлы сохранены. Указанные параметры не проверены; частично выполненные правила требуют отдельной оценки доказательств.</p></div></section><div className="missing-grid"><section className="surface"><div className="surface-title"><div><h3>Что это означает</h3><p>Ограничения относятся к этому запуску и не меняют сохранённые подсказки на исходных страницах.</p></div></div><div className="missing-list"><div><span>01</span><div><strong>Подтверждённых выводов нет</strong><small>Подсказки требуют сверки с оригиналом и решением инспектора</small></div><StatusBadge status="PARTIAL" /></div><div><span>02</span><div><strong>Частичный результат</strong><small>Нужны источник, причина и подтверждение для каждого вывода</small></div><StatusBadge status="PARTIAL" /></div></div></section><aside className="surface rule-card"><span className="rule-card__icon"><ShieldCheck size={22} /></span><h3>Безопасный результат</h3><p>UNSUPPORTED — технический пробел покрытия, не нарушение и не отрицательный вывод.</p><div><code>UNSUPPORTED</code><ArrowRight size={15} /><code>PARTIAL</code></div></aside></div>{coverageList}</div>;
  }
  return <div className="content"><button className="back-link" onClick={onBack}><ArrowLeft size={16} /> К результатам</button><ObjectHeader object={object} check={check} />{reviewPanel}<section className="missing-hero"><span><AlertTriangle size={25} /></span><div><span className="kicker">Комплектность</span><h2>Для {check.stats.notComparable} параметров недостаточно данных</h2><p>Это не нарушение. Система воздержалась от вывода и сохранила причину.</p></div>{onUpload && <button className="button button--primary" onClick={onUpload}><UploadCloud size={18} /> Дозагрузить документы</button>}</section>{coverageList}</div>;
}

function ReviewCandidatesScreen({ object, check, onBack, onProtocol, parameterCatalog }: {
  object: InspectionObject; check: CheckRun; onBack: () => void; onProtocol: () => void;
  parameterCatalog: Record<string, { name: string; matrixCode: string }>;
}) {
  const [results, setResults] = useState<PilotResultsRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setResults(null);
    setError(null);
    api.getPilotResults(check.id).then((data) => {
      if (!cancelled) setResults(data);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Не удалось загрузить подсказки");
    });
    return () => { cancelled = true; };
  }, [check.id, check.status]);
  return <div className="content">
    <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> К результатам</button>
    <ObjectHeader object={object} check={check} />
    {error && <p role="alert">{error}</p>}
    {!results && !error && <p role="status">Загружаем кандидатов запуска…</p>}
    {results && (results.reviewCandidates
      ? <ReviewCandidates data={results.reviewCandidates} checkId={check.id}
          objectId={object.id} onProtocol={onProtocol} parameterCatalog={parameterCatalog} />
      : <p>{isRunningCheck(check) ? "Анализ ещё идёт. Подсказки появятся после обработки исходных документов." : "Недостаточно данных для адресных подсказок в этом запуске."}</p>)}
  </div>;
}

function ProtocolScreen({ object, check, findings, protocols, user, reviewCandidateSummary, onBack, onReviewCandidates, onFinalize, onRevoke }: { object: InspectionObject; check: CheckRun; findings: Finding[]; protocols: ProtocolVersion[]; user: SessionUser | null; reviewCandidateSummary: ReviewCandidateSummary | null; onBack: () => void; onReviewCandidates: () => void; onFinalize: (acknowledgementReason?: string) => Promise<void>; onRevoke: (protocolId: string, reasonCode: ProtocolRevocationReasonCode, comment: string) => Promise<void> }) {
  const [busy, setBusy] = useState<"finalize" | "revoke" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [gapsAcknowledged, setGapsAcknowledged] = useState(false);
  const [acknowledgementReason, setAcknowledgementReason] = useState("");
  const [revocationReason, setRevocationReason] = useState<ProtocolRevocationReasonCode>("PROTOCOL_CONTENT_ERROR");
  const [revocationComment, setRevocationComment] = useState("");
  const [reviewDecisionCount, setReviewDecisionCount] = useState<number | null>(null);
  useEffect(() => {
    if (check.mode !== "NORMAL") return;
    let active = true;
    void api.listReviewCandidateDecisions(check.id).then((result) => {
      if (active) setReviewDecisionCount(result.items.length);
    }).catch(() => {
      if (active) setReviewDecisionCount(null);
    });
    return () => { active = false; };
  }, [check.id, check.mode]);
  const latest = protocols.at(-1);
  const activeFinal = [...protocols].reverse().find((protocol) => protocol.status === "FINAL" && protocol.validity !== "REVOKED");
  const confirmed = findings.filter((finding) => finding.status === "CONFIRMED_VIOLATION");
  const requiresGapAcknowledgement = protocolRequiresGapAcknowledgement(check);
  const finalizationBlock = protocolFinalizationBlock(check, user);
  const alreadyFinalized = check.status === "FINALIZED";
  const hasRevocationRole = Boolean(user?.roles.some((role) => role === "SUPERVISOR" || role === "ADMIN"));
  const canRevoke = check.mode === "NORMAL" && alreadyFinalized && Boolean(activeFinal) && hasRevocationRole;
  const canFinalize = !finalizationBlock
    && (!requiresGapAcknowledgement || (gapsAcknowledged && acknowledgementReason.trim().length >= 10));

  const finalize = async () => {
    if (!canFinalize || busy) return;
    setBusy("finalize");
    setMessage(null);
    try {
      await onFinalize(requiresGapAcknowledgement ? acknowledgementReason.trim() : undefined);
      setMessage("Финальная версия протокола создана");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Не удалось финализировать");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    if (!canRevoke || !activeFinal || revocationComment.trim().length < 10) return;
    setBusy("revoke");
    setMessage(null);
    try {
      await onRevoke(activeFinal.id, revocationReason, revocationComment.trim());
      setRevocationComment("");
      setMessage("Протокол отозван, создана новая черновая версия");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Не удалось отозвать протокол");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="content">
      <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> К результатам</button>
      <ObjectHeader object={object} check={check} />
      <div className="protocol-layout">
        <section className="surface protocol-document">
          <div className="protocol-cover">
            <div className="protocol-seal"><FileCheck2 size={27} /></div>
            <span>Протокол автоматизированной проверки</span>
            <h2>{object.address}</h2>
            <p>{object.id} · проверка {check.id}</p>
            <div className="protocol-summary">
              <div><strong>{check.stats.total}</strong><span>параметров</span></div>
              <div><strong>{check.stats.confirmed}</strong><span>подтверждено</span></div>
              <div><strong>{check.stats.clarification}</strong><span>на уточнении</span></div>
              <div><strong>{check.stats.candidates}</strong><span>без решения</span></div>
            </div>
          </div>
          <div className="protocol-section">
            <div><span className="kicker">Раздел 03</span><h3>Подтверждённые нарушения</h3></div>
            {confirmed.length
              ? confirmed.map((finding) => <div className="protocol-finding" key={finding.id}><span>{finding.parameterCode}</span><div><strong>{finding.title}</strong><p>{finding.location} · {finding.decision?.reason}</p></div><StatusBadge status={finding.status} /></div>)
              : <div className="protocol-empty"><ShieldCheck size={24} /><span>Инспектор ещё не подтвердил нарушения.</span></div>}
          </div>
          {check.mode === "NORMAL" && reviewCandidateSummary?.status === "ready" && reviewCandidateSummary.count > 0 && <div className="protocol-section protocol-review-note">
            <div><span className="kicker">Отдельный режим</span><h3>Подсказки для инспектора</h3></div>
            <p>{reviewCandidateSummary.count} подсказок по исходным страницам · решений инспектора: {reviewDecisionCount ?? "…"}.</p>
            <p>Подсказки не входят в перечень подтверждённых нарушений и не повышают покрытие.</p>
            <button className="button button--secondary" type="button" onClick={onReviewCandidates}>Открыть подсказки и решения</button>
          </div>}
        </section>
        <aside className="protocol-aside">
          <section className="surface">
            <h3>Версии</h3>
            {protocols.map((protocol) => {
              const isRevoked = protocol.validity === "REVOKED";
              const versionLabel = isRevoked ? "Отозвана" : protocol.status === "FINAL" ? "Финальная" : "Черновик";
              return <div className={`version-row ${isRevoked ? "version-row--revoked" : ""}`} key={protocol.id}><span><FileClock size={17} /></span><div><strong>Версия {protocol.version}</strong><small>{versionLabel} · {formatDate(protocol.createdAt)}{protocol.snapshotHash ? ` · SHA-256 ${protocol.snapshotHash.slice(0, 12)}…` : ""}</small>{protocol.revocation && <small>Причина: {revocationReasonLabels[protocol.revocation.reasonCode]} · {protocol.revocation.comment}</small>}{protocol.canonicalArtifact && <a className="artifact-link" href={api.canonicalArtifactUrl(protocol.id)}><Download size={13} /> Canonical JSON · {protocol.canonicalArtifact.byteSize} байт</a>}</div>{isRevoked ? <XCircle size={17} /> : protocol.status === "FINAL" && <CheckCircle2 size={17} />}</div>;
            })}
          </section>
          <section className="surface action-card">
            <h3>Выпуск протокола</h3>
            <p>{finalizationBlock ?? (requiresGapAcknowledgement
              ? `${check.stats.unsupported} параметров не поддерживаются. Проверка выполнена частично: можно выпустить только неполный протокол.`
              : "Все кандидаты обработаны. Можно зафиксировать версию.")}</p>
            {requiresGapAcknowledgement && !finalizationBlock && <div className="partial-acknowledgement">
              <label className="partial-acknowledgement__check"><input type="checkbox" checked={gapsAcknowledged} onChange={(event) => setGapsAcknowledged(event.target.checked)} /><span>Подтверждаю выпуск PARTIAL-протокола с текущим перечнем технических пробелов.</span></label>
              <label><span>Основание выпуска</span><textarea rows={3} value={acknowledgementReason} onChange={(event) => setAcknowledgementReason(event.target.value)} placeholder="Почему допустим выпуск неполного протокола" /></label>
              <small>Подтверждение не означает полную приёмку всех 132 параметров.</small>
            </div>}
            {message && <div className={`inline-message ${message.startsWith("Финальная") || message.startsWith("Протокол отозван") ? "inline-message--success" : ""}`}>{message}</div>}
            <button className="button button--primary button--full" onClick={finalize} disabled={Boolean(busy) || !canFinalize}>{busy === "finalize" ? <LoaderCircle className="spin" size={17} /> : <FileCheck2 size={17} />} Финализировать</button>
            {latest && <a className="button button--secondary button--full" href={api.exportUrl(latest.id)}><Download size={17} /> Скачать протокол JSON</a>}
            {latest?.canonicalArtifact && <a className="button button--secondary button--full" href={api.canonicalArtifactUrl(latest.id)}><Download size={17} /> Скачать immutable snapshot</a>}
            <small>{check.mode === "DEMO_SEED" ? "Демонстрационный seed не является результатом анализа новых документов." : "Submission JSON для текущего контура недоступен. Для передачи используйте экспорт выпущенного протокола JSON."}</small>
          </section>
          {canRevoke && activeFinal && <section className="surface action-card protocol-revocation">
            <h3>Отзыв финальной версии</h3>
            <p>Старая версия останется неизменной в истории. Проверка откроется, а система создаст новый черновик.</p>
            <label><span>Причина</span><select value={revocationReason} onChange={(event) => setRevocationReason(event.target.value as ProtocolRevocationReasonCode)}>{Object.entries(revocationReasonLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label><span>Комментарий</span><textarea rows={4} value={revocationComment} onChange={(event) => setRevocationComment(event.target.value)} placeholder="Опишите ошибку и необходимые исправления" /></label>
            <small>Комментарий обязателен, минимум 10 символов.</small>
            <button className="button button--danger button--full" onClick={revoke} disabled={Boolean(busy) || revocationComment.trim().length < 10}>{busy === "revoke" ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />} Отозвать и открыть проверку</button>
          </section>}
          {check.mode === "NORMAL" && alreadyFinalized && !hasRevocationRole && <section className="surface action-card"><h3>Нужно исправление?</h3><p>Отзыв финального протокола доступен руководителю или администратору с правом на этот объект.</p></section>}
        </aside>
      </div>
    </div>
  );
}

function SettingsScreen({ preferences, onChange, onReset }: { preferences: UserPreferences; onChange: (next: UserPreferences) => void; onReset: () => void }) {
  const options = [
    { key: "denseRows" as const, title: "Компактные строки", description: "Показывать больше результатов проверки без прокрутки." },
    { key: "largeText" as const, title: "Увеличенный рабочий текст", description: "Увеличить основной текст таблиц и панелей." },
  ];
  return <div className="content content--settings"><div className="page-title-row"><div><span className="kicker">Рабочее место</span><h1>Настройки</h1><p>Параметры сохраняются в этом браузере.</p></div><SlidersHorizontal size={24} /></div><section className="surface settings-card"><div className="settings-card__heading"><h2>Отображение</h2><p>Настройте плотность интерфейса под свой экран.</p></div>{options.map((option) => <div className="setting-row" key={option.key}><div><strong>{option.title}</strong><span>{option.description}</span></div><button className="switch" role="switch" aria-label={option.title} aria-checked={preferences[option.key]} onClick={() => onChange({ ...preferences, [option.key]: !preferences[option.key] })}><span /></button></div>)}<div className="settings-footer"><span><CheckCircle2 size={16} /> Изменения сохраняются автоматически</span><button className="button button--secondary" onClick={onReset}>Сбросить настройки</button></div></section></div>;
}

function CatalogScreen({ parameters, initialQuery = "" }: { parameters: ParameterCatalogItem[]; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  useEffect(() => setQuery(initialQuery), [initialQuery]);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = parameters.filter((parameter) => `${parameter.parameter_code} ${matrixCode(parameter)} ${parameter.parameter_name} ${parameter.pd_section ?? ""}`.toLowerCase().includes(normalizedQuery));
  return (
    <div className="content">
      <div className="page-title-row"><div><span className="kicker">Матрица методики</span><h1>Справочник 132 параметров</h1><p>Код каталога из конкурсного датасета и код приложенной матрицы 1.1. Приоритет задаёт очередь проверки, а не статус нарушения.</p></div><span className="catalog-count" role="status">{normalizedQuery ? `Найдено: ${filtered.length} из ${parameters.length}` : `Параметров: ${parameters.length}`}</span></div>
      <section className="surface results-surface">
        <div className="filterbar"><label className="filter-search filter-search--wide"><Search size={17} /><input aria-label="Поиск по справочнику" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Код M-002 или PZ-002, название или раздел" /></label></div>
        <div className="catalog-table">
          <div className="catalog-row catalog-head"><span>Коды</span><span>Параметр</span><span>Раздел ПД</span><span>Приоритет проверки</span></div>
          {filtered.slice(0, 132).map((parameter) => <div className="catalog-row" key={parameter.parameter_code}><code>{parameter.parameter_code}<br />{matrixCode(parameter)}</code><strong>{parameter.parameter_name}</strong><span>{parameter.pd_section ?? "—"}</span><span>{matrixReviewPriority(parameter)}</span></div>)}
          {!filtered.length && <div className="table-empty"><h3>Параметры не найдены</h3><p>Измените запрос или очистите поиск.</p><button className="button button--secondary" onClick={() => setQuery("")}>Очистить поиск</button></div>}
        </div>
      </section>
    </div>
  );
}

export function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [uploadTarget, setUploadTarget] = useState<InspectionObject | null>(null);
  const [colorMode, setColorMode] = useColorMode();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
  const [sidebarCompact, setSidebarCompact] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [evidenceReturnScreen, setEvidenceReturnScreen] = useState<"results" | "candidates">("results");
  const [preferences, setPreferences] = useState<UserPreferences>({ denseRows: false, largeText: false });
  const [objects, setObjects] = useState<InspectionObject[]>([]);
  const [object, setObject] = useState<InspectionObject | null>(null);
  const [check, setCheck] = useState<CheckRun | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [protocols, setProtocols] = useState<ProtocolVersion[]>([]);
  const [parameters, setParameters] = useState<ParameterCatalogItem[]>([]);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [reviewCandidateSummary, setReviewCandidateSummary] = useState<ReviewCandidateSummary | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const selectedObjectId = useRef<string | null>(null);
  const beginSelection = useRef(createSelectionRequest());
  const objectLoadVersion = useRef(0);
  const selectionPending = useRef(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("inspector-ai-preferences");
      if (saved) setPreferences({ denseRows: false, largeText: false, ...JSON.parse(saved) as Partial<UserPreferences> });
    } catch { /* Invalid local preference must not block workspace. */ }
  }, []);

  const updatePreferences = (next: UserPreferences) => {
    setPreferences(next);
    window.localStorage.setItem("inspector-ai-preferences", JSON.stringify(next));
  };

  const loadObject = useCallback(async (id: string) => {
    objectLoadVersion.current += 1;
    selectionPending.current = true;
    const isCurrent = beginSelection.current();
    try {
      const next = await readWorkspaceObject(api, id);
      if (!isCurrent()) return null;
      selectedObjectId.current = id;
      setObject(next.object); setCheck(next.check); setFindings(next.findings); setProtocols(next.protocols);
      setSelectedFindingId((current) => next.findings.some((finding) => finding.id === current) ? current : next.findings[0]?.id ?? null);
      setPollError(null);
      return next;
    } catch (caught) {
      if (!isCurrent()) return null;
      throw caught;
    } finally { if (isCurrent()) selectionPending.current = false; }
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [nextObjects, nextParameters] = await Promise.all([api.listObjects(), api.getParameters()]);
      setObjects(nextObjects); setParameters(nextParameters);
      const id = selectedObjectId.current ?? nextObjects.find((item) => item.activeCheckId)?.id ?? nextObjects[0]?.id;
      if (id) await loadObject(id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Неизвестная ошибка"); }
    finally { setLoading(false); }
  }, [loadObject]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await api.openWorkspace();
        if (!cancelled) setSessionUser(session.user);
        if (!cancelled) await load();
      } catch (caught) {
        if (!cancelled) setSessionUser(null);
        if (!cancelled) { setError(caught instanceof Error ? caught.message : "Рабочий контур недоступен"); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!check || check.mode !== "NORMAL") return;
    let active = true;
    const checkId = check.id;
    setReviewCandidateSummary({ checkId, status: "loading", count: 0 });
    void api.getPilotResults(checkId).then((results) => {
      if (!active) return;
      setReviewCandidateSummary({ checkId, status: results.reviewCandidates ? "ready" : "absent",
        count: results.reviewCandidates?.candidateCount ?? 0 });
    }).catch(() => {
      if (active) setReviewCandidateSummary({ checkId, status: "error", count: 0 });
    });
    return () => { active = false; };
  }, [check?.id, check?.mode, check?.status]);

  const currentReviewSummary = reviewCandidateSummary?.checkId === check?.id ? reviewCandidateSummary : null;
  const canCreateObject = Boolean(sessionUser?.roles.some((role) => role === "INSPECTOR" || role === "SUPERVISOR")
    || sessionUser?.capabilities.includes("OBJECT_CREATE"));

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [openSearch]);

  useEffect(() => {
    if (!check || !isRunningCheck(check)) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      if (selectionPending.current) {
        timer = window.setTimeout(() => void poll(), 1500);
        return;
      }
      const selectionVersion = objectLoadVersion.current;
      try {
        const nextCheck = await api.getCheck(check.id);
        if (cancelled || selectedObjectId.current !== nextCheck.objectId) return;
        if (selectionPending.current || selectionVersion !== objectLoadVersion.current) {
          timer = window.setTimeout(() => void poll(), 1500);
          return;
        }
        if (!isRunningCheck(nextCheck)) {
          const next = await loadObject(nextCheck.objectId);
          if (!cancelled && next) {
            setObjects((current) => current.map((item) => item.id === next.object.id ? next.object : item));
            setScreen((current) => current === "processing" ? "results" : current);
          }
          return;
        }
        setCheck(nextCheck);
        setPollError(null);
      } catch (caught) {
        if (!cancelled) setPollError(caught instanceof Error ? caught.message : "Не удалось обновить ход проверки");
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), 1500);
    };
    timer = window.setTimeout(() => void poll(), 700);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [check?.id, check?.status, loadObject]);

  const selectedFinding = useMemo(() => findings.find((finding) => finding.id === selectedFindingId) ?? findings[0] ?? null, [findings, selectedFindingId]);

  const navigate = (next: Screen) => {
    setMobileMenuOpen(false);
    setNavigationError(null);
    if (next === "catalog") setCatalogQuery("");
    setScreen(next);
  };

  const openUpload = (target: InspectionObject | null = null) => {
    setUploadTarget(target);
    setScreen("upload");
  };
  const openObject = async (nextObject: InspectionObject, destination?: ObjectScopedScreen) => {
    setLoading(true); setNavigationError(null);
    const selectionVersion = objectLoadVersion.current + 1;
    try {
      const next = await loadObject(nextObject.id);
      if (!next) return;
      if (!next.check) openUpload(next.object);
      else setScreen(isRunningCheck(next.check) ? "processing" : destination ?? "results");
    } catch (caught) {
      setNavigationError(caught instanceof Error ? caught.message : "Не удалось открыть объект");
    } finally { if (selectionVersion === objectLoadVersion.current) setLoading(false); }
  };
  const created = async (createdObject: InspectionObject, stageFiles: Record<UploadStage, File[]>) => {
    setObjects((current) => current.some((item) => item.id === createdObject.id) ? current : [...current, createdObject]);
    const nextCheck = await uploadAndStartCheck(api, createdObject.id, stageFiles);
    const nextObjects = await api.listObjects(); setObjects(nextObjects); await loadObject(createdObject.id); setCheck(nextCheck); setScreen(isRunningCheck(nextCheck) ? "processing" : "results");
  };
  const decide = async (type: DecisionType, reason: string) => {
    if (!selectedFinding) return;
    await api.decide(selectedFinding.id, { type, reason, author: "Алексей К." });
    if (object) await loadObject(object.id);
  };
  const finalize = async (acknowledgementReason?: string) => {
    if (!check || !object) return;
    await api.finalize(check.id, acknowledgementReason);
    await loadObject(object.id);
  };
  const revoke = async (protocolId: string, reasonCode: ProtocolRevocationReasonCode, comment: string) => {
    if (!check || !object) return;
    await api.revokeProtocol(check.id, protocolId, reasonCode, comment);
    await loadObject(object.id);
  };
  const reprocess = async () => {
    if (!check || !object) return;
    const nextCheck = await api.reprocessCheck(check.id);
    await loadObject(object.id);
    setCheck(nextCheck);
    setScreen(isRunningCheck(nextCheck) ? "processing" : "results");
  };

  const parameterCatalog = Object.fromEntries(parameters.map((parameter) => [parameter.parameter_code,
    { name: parameter.parameter_name, matrixCode: matrixCode(parameter) }]));
  const search = searchOpen && <GlobalSearch objects={objects} findings={findings} parameters={parameters} onClose={closeSearch} onObject={(item) => { setSearchOpen(false); void openObject(item); }} onFinding={(finding) => { setSearchOpen(false); setSelectedFindingId(finding.id); setEvidenceReturnScreen(finding.status === "CANDIDATE" ? "candidates" : "results"); setScreen("evidence"); }} onParameter={(parameter) => { setSearchOpen(false); setCatalogQuery(parameter.parameter_code); setScreen("catalog"); }} />;
  const preferenceClasses = `${preferences.denseRows ? "app-shell--dense" : ""} ${preferences.largeText ? "app-shell--large-text" : ""}`;

  if (screen === "home") return <Landing
    objects={objects} findings={findings} parameterCount={parameters.length}
    loading={loading} error={error} onRetry={() => void load()}
    onWorkspace={() => setScreen("objects")}
    onUpload={() => openUpload()}
    onEvidence={(finding) => {
      setSelectedFindingId(finding.id);
      setEvidenceReturnScreen("results");
      setScreen("evidence");
    }}
    onCatalog={() => setScreen("catalog")}
    colorMode={colorMode} onColorModeChange={setColorMode}
  />;

  if (loading || error) return <><div className={`app-shell ${preferenceClasses}`}><Sidebar screen={screen} compact={sidebarCompact} mobileOpen={mobileMenuOpen} onClose={closeMobileMenu} onToggle={() => setSidebarCompact((value) => !value)} onSearch={openSearch} onNavigate={navigate} candidateCount={0} /><button className={`sidebar-scrim ${mobileMenuOpen ? "sidebar-scrim--visible" : ""}`} onClick={closeMobileMenu} aria-label="Закрыть меню" /><main className="main"><Topbar object={object} onUpload={canCreateObject ? () => openUpload() : undefined} onSearch={openSearch} onHome={() => setScreen("home")} onMenu={() => setMobileMenuOpen(true)} colorMode={colorMode} onColorModeChange={setColorMode} /><EmptyState error={error} onRetry={() => void api.openWorkspace().then((session) => { setSessionUser(session.user); return load(); }).catch((caught) => setError(caught instanceof Error ? caught.message : "Рабочий контур недоступен"))} /></main></div>{search}</>;

  const inner = (() => {
    if (screen === "objects") return <ObjectsScreen objects={objects} onOpen={(item) => void openObject(item)} onCreate={canCreateObject ? () => openUpload() : undefined} />;
    if (screen === "upload") return canCreateObject || uploadTarget ? <UploadScreen key={uploadTarget?.id ?? "new"} existingObject={uploadTarget} onCancel={() => setScreen("objects")} onCreated={created} />
      : <ObjectsScreen objects={objects} onOpen={(item) => void openObject(item)} />;
    if (screen === "catalog") return <CatalogScreen parameters={parameters} initialQuery={catalogQuery} />;
    if (screen === "settings") return <SettingsScreen preferences={preferences} onChange={updatePreferences} onReset={() => updatePreferences({ denseRows: false, largeText: false })} />;
    if (!object || !check) return <ObjectsScreen objects={objects} section={screen === "results" || screen === "candidates" || screen === "protocol" ? screen : undefined} onOpen={(item) => void openObject(item, screen === "results" || screen === "candidates" || screen === "protocol" ? screen : undefined)} onCreate={canCreateObject ? () => openUpload() : undefined} />;
    if (screen === "processing") return <ProcessingScreen object={object} check={check} />;
    if (screen === "sources") return <SourceReviewScreen objectId={object.id} checkId={check.id} checkStatus={check.status} onBack={() => setScreen("results")} onReprocess={reprocess} onUpload={() => openUpload(object)} />;
    if (screen === "missing") return <MissingScreen object={object} check={check} onBack={() => setScreen("results")} onUpload={canCreateObject ? () => openUpload(object) : undefined} onSources={sessionUser?.capabilities.includes("SOURCE_REVIEW") ? () => setScreen("sources") : undefined} onReprocess={canCreateObject ? reprocess : undefined} onProtocol={() => setScreen("protocol")} parameterCatalog={parameterCatalog} />;
    if (screen === "protocol") return <ProtocolScreen object={object} check={check} findings={findings} protocols={protocols} user={sessionUser} reviewCandidateSummary={currentReviewSummary} onBack={() => setScreen("results")} onReviewCandidates={() => setScreen("candidates")} onFinalize={finalize} onRevoke={revoke} />;
    if (screen === "candidates") return check.mode === "NORMAL"
      ? <ReviewCandidatesScreen object={object} check={check} onBack={() => setScreen("results")}
          onProtocol={() => setScreen("protocol")} parameterCatalog={parameterCatalog} />
      : <CandidatesScreen object={object} check={check} findings={findings} onOpen={(finding) => { setSelectedFindingId(finding.id); setEvidenceReturnScreen("candidates"); setScreen("evidence"); }} />;
    if (screen === "evidence" && selectedFinding) return <EvidenceScreen finding={selectedFinding} findings={findings} onSelect={(finding) => setSelectedFindingId(finding.id)} onBack={() => setScreen(evidenceReturnScreen)} onDecision={decide} />;
    return <ResultsScreen object={object} check={check} findings={findings} reviewCandidateSummary={currentReviewSummary} canViewSources={Boolean(sessionUser?.capabilities.includes("SOURCE_REVIEW"))} onOpen={(finding) => { setSelectedFindingId(finding.id); setEvidenceReturnScreen("results"); setScreen("evidence"); }} onMissing={() => setScreen("missing")} onProtocol={() => setScreen("protocol")} onSources={() => setScreen("sources")} onReviewCandidates={() => setScreen("candidates")} />;
  })();

  const immersive = screen === "evidence";
  const topbarObject = check && ["results", "sources", "candidates", "protocol", "missing", "processing"].includes(screen) ? object : null;
  const topbarSection = screen === "settings" ? "Настройки" : screen === "catalog" ? "Справочник 132"
    : !check && (screen === "results" || screen === "candidates" || screen === "protocol") ? objectScopedCopy[screen].title : undefined;
  return <><div className={`app-shell ${immersive ? "app-shell--immersive" : ""} ${preferenceClasses}`}><Sidebar screen={screen} compact={sidebarCompact} mobileOpen={mobileMenuOpen} onClose={closeMobileMenu} onToggle={() => setSidebarCompact((value) => !value)} onSearch={openSearch} onNavigate={navigate} candidateCount={check?.mode === "NORMAL" ? currentReviewSummary?.status === "ready" ? currentReviewSummary.count : 0 : check?.stats.candidates ?? 0} /><button className={`sidebar-scrim ${mobileMenuOpen ? "sidebar-scrim--visible" : ""}`} onClick={closeMobileMenu} aria-label="Закрыть меню" /><main className="main">{!immersive && <Topbar object={topbarObject} section={topbarSection} onUpload={canCreateObject ? () => openUpload() : undefined} onSearch={openSearch} onHome={() => setScreen("home")} onMenu={() => setMobileMenuOpen(true)} colorMode={colorMode} onColorModeChange={setColorMode} />}{navigationError && <p className="inline-error" role="alert">Не удалось открыть объект: {navigationError} <button onClick={() => setNavigationError(null)} aria-label="Закрыть сообщение об ошибке"><X size={16} /></button></p>}{pollError && <p className="inline-error" role="status">Не удалось обновить ход проверки: {pollError}. Повторим автоматически.</p>}{inner}</main></div>{search}</>;
}
