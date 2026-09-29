import { useEffect, useState, type FormEvent } from "react";
import { sourceSectionCodes } from "@inspector-ai/contracts";
import type { SourceFileListResponse, SourceFileSummary, SourceReviewInput } from "@inspector-ai/contracts";
import { ArrowLeft, FileText, LoaderCircle, RefreshCw, Save, UploadCloud } from "lucide-react";
import { api, type OcrLayoutPageRead, type OcrLayoutRead,
  type VisualProposalAnalysis, type VisualProposalReviewAction,
  type VisualProposalReviewList } from "./api";
import { formatPageStageRanges, parsePageStageRanges } from "./source-review-ranges";

type Revision = SourceReviewInput["revisionStatus"];
type Approval = SourceReviewInput["approvalStatus"];
type SourceSectionCode = (typeof sourceSectionCodes)[number];
type VisualProposal = VisualProposalAnalysis["sources"][number]["proposals"][number];
type SelectedPreview = {
  sourceFileId: string;
  pageNumber: number;
  bboxNormalized: VisualProposal["bboxNormalized"];
  proposalIndex: number;
  requestId: number;
};
type SelectedOcrLine = {
  checkId: string;
  sourceFileId: string;
  pageNumber: number;
  artifactId: string;
  ordinal: number;
};

const sourceSectionLabels: Record<SourceSectionCode, string> = {
  PZ: "Раздел 1. ПЗ",
  SPZU: "Раздел 2. СПЗУ",
  AR: "Раздел 3. АР",
  KR: "Раздел 4. КР",
  IOS1: "Раздел 5. ИОС1",
  IOS2: "Раздел 5. ИОС2",
  IOS3: "Раздел 5. ИОС3",
  IOS4: "Раздел 5. ИОС4",
  IOS5: "Раздел 5. ИОС5",
  POS: "Раздел 6. ПОС",
  POD: "Раздел 7. ПОД",
  OOS: "Раздел 8. ООС",
  PPM: "Раздел 9. ППМ",
  ODI: "Раздел 10. ОДИ",
  ZU: "Раздел 11. ЗУ",
  SM: "Раздел 12. СМ",
  EOM: "РД: ЭОМ",
  GP: "РД: ГП",
  GSV: "РД: ГСВ",
  KJ: "РД: КЖ",
  KM: "РД: КМ",
  NVK: "РД: НВК",
  OV: "РД: ОВ",
  PP: "РД: ПП",
  PPR: "РД: ППР",
  SS: "РД: СС",
  VK: "РД: ВК",
};

export function SourceSectionCodeField({ value, onChange, disabled }: {
  value: SourceSectionCode | null;
  onChange: (value: SourceSectionCode | null) => void;
  disabled: boolean;
}) {
  return <label><span>Раздел документа</span><select value={value ?? ""}
    onChange={(event) => onChange(event.target.value ? event.target.value as SourceSectionCode : null)}
    disabled={disabled}>
    <option value="">Не установлен</option>
    {sourceSectionCodes.map((code) => <option key={code} value={code}>{sourceSectionLabels[code]}</option>)}
  </select><small>Выберите раздел по исходному документу. Для новых правил факт используется только после явного выбора и сохранения решения.</small></label>;
}

function OcrSourceImage({ src, alt }: { src: string; alt: string }) {
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ request: string; imageUrl: string | null; error: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let imageUrl: string | null = null;
    const abort = new AbortController();
    setResult(null);
    const load = async () => {
      for (let attempt = 0; attempt < 5 && !cancelled; attempt += 1) {
        try {
          const response = await fetch(src, { credentials: "include", cache: "no-store", signal: abort.signal });
          if (response.ok && response.headers.get("content-type")?.includes("image/png")) {
            const body = await response.blob();
            if (cancelled) return;
            imageUrl = URL.createObjectURL(body);
            setResult({ request: src, imageUrl, error: false });
            return;
          }
          if (response.status !== 429 && response.status !== 503) break;
        } catch {
          if (cancelled) return;
        }
        if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
      if (!cancelled) setResult({ request: src, imageUrl: null, error: true });
    };
    void load();
    return () => {
      cancelled = true;
      abort.abort();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [src, retry]);
  if (result?.request === src && result.error) return <p role="alert">
    Исходный лист временно недоступен. <button type="button" onClick={() => setRetry((value) => value + 1)}>
      Повторить загрузку
    </button>
  </p>;
  if (result?.request !== src || !result.imageUrl) return <p role="status">Загружаем исходный лист…</p>;
  return <img src={result.imageUrl} alt={alt} />;
}

function ocrLineCrop(page: OcrLayoutPageRead, bbox: readonly [number, number, number, number]): [number, number, number, number] | null {
  if (page.widthPx <= 0 || page.heightPx <= 0) return null;
  const [left, top, right, bottom] = bbox;
  // The preview endpoint expands crop coordinates fourfold into a square.
  // Send one quarter of the intended context so a long OCR row stays legible.
  const contextSidePx = Math.min(page.widthPx,
    Math.max(320, (right - left) * 1.6, (bottom - top) * 6));
  const requestHalfSidePx = contextSidePx / 8;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const clamp = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 1_000_000) / 1_000_000;
  const normalized: [number, number, number, number] = [
    clamp((centerX - requestHalfSidePx) / page.widthPx),
    clamp((centerY - requestHalfSidePx) / page.heightPx),
    clamp((centerX + requestHalfSidePx) / page.widthPx),
    clamp((centerY + requestHalfSidePx) / page.heightPx),
  ];
  return normalized[0] < normalized[2] && normalized[1] < normalized[3] ? normalized : null;
}

export function ocrSourceStatusLabel(status: string): string {
  if (status === "SKIPPED_NO_SUBJECT_CONTEXT") {
    return "OCR пропущен: не найден контекст нужного раздела. Это не означает, что в файле нет текста.";
  }
  if (status === "SKIPPED_SOURCE_REVIEW_REQUIRED") {
    return "OCR отложен: источник ещё не проверен экспертом. Это не означает, что на страницах нет текста.";
  }
  if (status === "SKIPPED_SOURCE_NOT_CURRENT_APPROVED") {
    return "OCR отложен: редакция источника не подтверждена как актуальная и согласованная.";
  }
  if (status === "SKIPPED_SECTION_NOT_AR_VK") {
    return "OCR отложен: проверенный раздел источника не АР или ВК для этого профиля.";
  }
  if (status === "SKIPPED_PAGE_STAGE_UNRESOLVED") {
    return "OCR отложен: стадия требующих OCR страниц не установлена.";
  }
  if (status === "SKIPPED_RENDER_PIXEL_LIMIT") {
    return "OCR отложен: размер изображения страницы превышает ограничение обработки.";
  }
  if (status === "SKIPPED_SOURCE_TOO_LARGE") {
    return "OCR отложен: размер исходного файла превышает ограничение обработки.";
  }
  if (status === "PARTIALLY_SCANNED") {
    return "OCR выполнен только для части страниц; остальные не проверены.";
  }
  return status;
}

export function ocrProfileLabel(profileId: string): string {
  return profileId === "local-bounded-ocr-layout-v6"
    ? "Адресное OCR для проверенных разделов АР/ВК"
    : `Профиль ${profileId}`;
}

export function SourceReviewScreen({ objectId, checkId, checkStatus, onBack, onReprocess, onUpload }: {
  objectId: string;
  checkId: string | null;
  checkStatus?: string;
  onBack: () => void;
  onReprocess: () => Promise<void>;
  onUpload?: () => void;
}) {
  const [files, setFiles] = useState<SourceFileSummary[]>([]);
  const [permissions, setPermissions] = useState<SourceFileListResponse["permissions"]>({
    upload: false, review: false, run: false,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stageFile, setStageFile] = useState<File | null>(null);
  const [revision, setRevision] = useState<Revision>("UNKNOWN");
  const [approval, setApproval] = useState<Approval>("UNKNOWN");
  const [sectionCode, setSectionCode] = useState<SourceSectionCode | null>(null);
  const [linkGroup, setLinkGroup] = useState("");
  const [ranges, setRanges] = useState("");
  const [basis, setBasis] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDecision, setLoadingDecision] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [stageUploading, setStageUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ocrLayout, setOcrLayout] = useState<OcrLayoutRead | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrSelectedPage, setOcrSelectedPage] = useState<{ sourceFileId: string; pageNumber: number } | null>(null);
  const [ocrPage, setOcrPage] = useState<OcrLayoutPageRead | null>(null);
  const [ocrPageLoading, setOcrPageLoading] = useState(false);
  const [ocrPageError, setOcrPageError] = useState<string | null>(null);
  const [ocrMoreLoading, setOcrMoreLoading] = useState(false);
  const [ocrSelectedLine, setOcrSelectedLine] = useState<SelectedOcrLine | null>(null);
  const [visual, setVisual] = useState<VisualProposalAnalysis | null>(null);
  const [visualLoading, setVisualLoading] = useState(false);
  const [visualError, setVisualError] = useState<string | null>(null);
  const [visualReviews, setVisualReviews] = useState<VisualProposalReviewList | null>(null);
  const [visualReviewError, setVisualReviewError] = useState<string | null>(null);
  const [visualReviewAction, setVisualReviewAction] = useState<VisualProposalReviewAction>("UNSURE");
  const [visualReviewNote, setVisualReviewNote] = useState("");
  const [visualReviewSaving, setVisualReviewSaving] = useState(false);
  const [preview, setPreview] = useState<SelectedPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [cropLoading, setCropLoading] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);

  useEffect(() => {
    setOcrSelectedPage(null);
    setOcrPage(null);
    setOcrPageError(null);
    setOcrSelectedLine(null);
  }, [checkId, selectedId]);

  useEffect(() => {
    if (!checkId) {
      setOcrLayout(null);
      setOcrError(null);
      setOcrLoading(false);
      return;
    }
    let cancelled = false;
    setOcrLayout(null);
    setOcrError(null);
    setOcrLoading(true);
    void api.getOcrLayout(checkId).then((data) => {
      if (!cancelled) setOcrLayout(data);
    }).catch((caught) => {
      if (!cancelled) setOcrError(caught instanceof Error ? caught.message : "Не удалось загрузить OCR-страницы");
    }).finally(() => { if (!cancelled) setOcrLoading(false); });
    return () => { cancelled = true; };
  }, [checkId, checkStatus]);

  useEffect(() => {
    if (!checkId || !ocrSelectedPage || ocrSelectedPage.sourceFileId !== selectedId) return;
    let cancelled = false;
    setOcrPage(null);
    setOcrPageError(null);
    setOcrPageLoading(true);
    void api.getOcrLayoutPage(checkId, ocrSelectedPage.sourceFileId, ocrSelectedPage.pageNumber)
      .then((data) => { if (!cancelled) setOcrPage(data); })
      .catch((caught) => { if (!cancelled) setOcrPageError(caught instanceof Error
        ? caught.message : "Не удалось загрузить OCR-строки"); })
      .finally(() => { if (!cancelled) setOcrPageLoading(false); });
    return () => { cancelled = true; };
  }, [checkId, ocrSelectedPage, selectedId]);

  useEffect(() => {
    setPreview(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setCropLoading(false);
    setCropError(null);
    setVisualReviewAction("UNSURE");
    setVisualReviewNote("");
  }, [checkId, selectedId]);

  useEffect(() => {
    if (!checkId) {
      setVisual(null);
      setVisualError(null);
      setVisualLoading(false);
      setVisualReviews(null);
      setVisualReviewError(null);
      return;
    }
    let cancelled = false;
    setVisual(null);
    setVisualError(null);
    setVisualLoading(true);
    setVisualReviews(null);
    setVisualReviewError(null);
    void api.getVisualProposals(checkId).then((data) => {
      if (!cancelled) setVisual(data);
    }).catch((caught) => {
      if (!cancelled) setVisualError(caught instanceof Error ? caught.message : "Не удалось загрузить визуальные предложения");
    }).finally(() => { if (!cancelled) setVisualLoading(false); });
    void api.listVisualProposalReviews(checkId).then((data) => {
      if (!cancelled) setVisualReviews(data);
    }).catch((caught) => {
      if (!cancelled) setVisualReviewError(caught instanceof Error
        ? caught.message : "Не удалось загрузить историю решений");
    });
    return () => { cancelled = true; };
  }, [checkId, checkStatus]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api.listSourceFiles(objectId).then((data) => {
      if (cancelled) return;
      setFiles(data.items);
      setPermissions(data.permissions);
      setSelectedId((current) => data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? null);
      setError(null);
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Не удалось загрузить файлы");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [objectId]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setLoadingDecision(true);
    setStageFile(null);
    setRevision("UNKNOWN"); setApproval("UNKNOWN"); setSectionCode(null); setLinkGroup(""); setRanges(""); setBasis("");
    setSavedSnapshot(null);
    setError(null); setNotice(null);
    void api.getSourceReview(objectId, selectedId).then((decision) => {
      if (cancelled || !decision) return;
      setRevision(decision.revisionStatus);
      setApproval(decision.approvalStatus);
      setSectionCode(decision.sectionCode ?? null);
      setLinkGroup(decision.linkGroupId ?? "");
      const savedRanges = formatPageStageRanges(decision.pageStages);
      setRanges(savedRanges);
      setBasis(decision.basis.reference);
      setSavedSnapshot(JSON.stringify([
        decision.revisionStatus, decision.approvalStatus, decision.sectionCode ?? null,
        decision.linkGroupId ?? "",
        savedRanges, decision.basis.reference,
      ]));
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Не удалось загрузить решение");
    }).finally(() => { if (!cancelled) setLoadingDecision(false); });
    return () => { cancelled = true; };
  }, [objectId, selectedId]);

  const selected = files.find((file) => file.id === selectedId) ?? null;
  const ocrSource = ocrLayout?.sources.find((source) => source.sourceFileId === selectedId) ?? null;
  const activeOcrPage = ocrPage?.checkId === checkId && ocrPage.sourceFileId === selectedId
    && ocrSelectedPage?.pageNumber === ocrPage.pageNumber ? ocrPage : null;
  const activeOcrLine = activeOcrPage && ocrSelectedLine?.checkId === checkId
    && ocrSelectedLine.sourceFileId === activeOcrPage.sourceFileId
    && ocrSelectedLine.pageNumber === activeOcrPage.pageNumber
    && ocrSelectedLine.artifactId === activeOcrPage.artifactId
    ? activeOcrPage.lines.find((line) => line.ordinal === ocrSelectedLine.ordinal) ?? null : null;
  const activeOcrCrop = activeOcrPage && activeOcrLine
    ? ocrLineCrop(activeOcrPage, activeOcrLine.bboxPx) : null;
  const visualSource = visual?.sources.find((source) => source.sourceFileId === selectedId) ?? null;
  const activePreview = preview?.sourceFileId === selectedId ? preview : null;

  const loadOcrOffset = async (offset: number) => {
    if (!checkId || !activeOcrPage || ocrMoreLoading) return;
    setOcrSelectedLine(null);
    setOcrMoreLoading(true);
    setOcrPageError(null);
    try {
      const next = await api.getOcrLayoutPage(checkId, activeOcrPage.sourceFileId,
        activeOcrPage.pageNumber, offset);
      setOcrPage((current) => current && current.artifactId === next.artifactId
        && current.pageContentHash === next.pageContentHash
        && current.sourceFileId === next.sourceFileId && current.pageNumber === next.pageNumber
        ? next : current);
    } catch (caught) {
      setOcrPageError(caught instanceof Error ? caught.message : "Не удалось загрузить OCR-строки");
    } finally {
      setOcrMoreLoading(false);
    }
  };
  const activeVisualHistory = activePreview && visual
    ? visualReviews?.items.filter((review) => review.artifactId === visual.artifactId
      && review.sourceFileId === activePreview.sourceFileId
      && review.proposalOrdinal === activePreview.proposalIndex) ?? []
    : [];
  const activeVisualDecision = activeVisualHistory[activeVisualHistory.length - 1];
  const activeVlmObservation = activePreview && visualSource?.vlm?.observations.find(
    (item) => item.proposalOrdinal === activePreview.proposalIndex,
  );
  const mixed = Boolean(selected && selected.stages.length > 1);
  const currentSnapshot = JSON.stringify([revision, approval, sectionCode, linkGroup, ranges, basis]);
  const stageToAdd = selected?.stages.length === 1
    ? selected.stages[0] === "RD" ? "ID" : selected.stages[0] === "ID" ? "RD" : null
    : null;

  const addStage = async () => {
    if (!selected || !stageToAdd || !stageFile || !permissions.upload || stageUploading) return;
    setError(null); setNotice(null); setStageUploading(true);
    try {
      if (stageFile.size !== selected.size) throw new Error("Размер PDF не совпадает с исходным файлом");
      const digest = await crypto.subtle.digest("SHA-256", await stageFile.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (sha256 !== selected.sha256) throw new Error("SHA-256 PDF не совпадает с исходным файлом");
      await api.uploadFiles(objectId, stageToAdd, [stageFile]);
      const data = await api.listSourceFiles(objectId);
      const updated = data.items.find((item) => item.id === selected.id);
      if (!updated?.stages.includes(stageToAdd)) throw new Error("Вторая стадия не появилась у исходного файла");
      setFiles(data.items); setPermissions(data.permissions); setStageFile(null);
      setNotice(`Те же байты зарегистрированы как ${stageToAdd}. Теперь укажите стадию каждой страницы.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось добавить вторую стадию");
    } finally {
      setStageUploading(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !permissions.review || saving || loadingDecision) return;
    setError(null); setNotice(null);
    try {
      const pageStages = mixed
        ? parsePageStageRanges(ranges, selected.stages, selected.pageCount ?? 0)
        : {};
      const input: SourceReviewInput = {
        sourceSha256: selected.sha256,
        revisionStatus: revision,
        approvalStatus: approval,
        sectionCode,
        linkGroupId: linkGroup.trim() || null,
        pageStages,
        basis: { reference: basis.trim() },
      };
      setSaving(true);
      await api.recordSourceReview(objectId, selected.id, input);
      const data = await api.listSourceFiles(objectId);
      setFiles(data.items); setPermissions(data.permissions);
      setSavedSnapshot(currentSnapshot);
      setNotice("Решение сохранено. Только новая проверка использует его.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить решение");
    } finally {
      setSaving(false);
    }
  };

  const rerun = async () => {
    setError(null); setNotice(null); setReprocessing(true);
    try {
      await onReprocess();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось повторить проверку");
    } finally {
      setReprocessing(false);
    }
  };

  const showProposal = (proposal: VisualProposal, proposalIndex: number) => {
    if (!selectedId) return;
    const reuseImage = preview?.sourceFileId === selectedId
      && preview.pageNumber === proposal.pageNumber && !previewError;
    setPreviewLoading(reuseImage ? previewLoading : true);
    setPreviewError(null);
    setCropLoading(true);
    setCropError(null);
    setVisualReviewAction("UNSURE");
    setVisualReviewNote("");
    setPreview((previous) => ({
      sourceFileId: selectedId,
      pageNumber: proposal.pageNumber,
      bboxNormalized: proposal.bboxNormalized,
      proposalIndex,
      requestId: (previous?.requestId ?? 0) + (reuseImage ? 0 : 1),
    }));
  };

  const saveVisualReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!checkId || !visual || !visualSource || !activePreview
      || !visualReviews?.canReview || visualReviewSaving || visualReviewNote.trim().length < 8) return;
    setVisualReviewSaving(true);
    setVisualReviewError(null);
    try {
      const saved = await api.recordVisualProposalReview(checkId, {
        artifactId: visual.artifactId, contentHash: visual.contentHash,
        sourceFileId: visualSource.sourceFileId, sourceSha256: visualSource.sourceSha256,
        proposalOrdinal: activePreview.proposalIndex,
        action: visualReviewAction, note: visualReviewNote.trim(),
      });
      setVisualReviews((current) => current && ({ ...current, items: [...current.items, saved] }));
      setVisualReviewNote("");
    } catch (caught) {
      setVisualReviewError(caught instanceof Error ? caught.message : "Не удалось сохранить решение");
    } finally {
      setVisualReviewSaving(false);
    }
  };

  return (
    <div className="content content--wide source-review-screen">
      <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> К результатам</button>
      <div className="page-title-row">
        <div><span className="kicker">Исходные документы</span><h1>Проверка источников</h1><p>Сверьте исходный PDF, его редакцию и согласование. Решение сохраняется с основанием и действует только для новых прогонов.</p></div>
        <div className="source-review-actions">{permissions.upload && onUpload && <button className="button button--secondary" onClick={onUpload} disabled={saving || stageUploading || reprocessing}><UploadCloud size={17} /> Дозагрузить документы</button>}
        {permissions.run && <button className="button button--secondary" onClick={() => void rerun()} disabled={reprocessing || loading || saving || stageUploading}>
          {reprocessing ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />} Новая проверка
        </button>}</div>
      </div>
      {error && <p className="inline-message" role="alert">{error}</p>}
      {notice && <p className="inline-message inline-message--success" role="status">{notice}</p>}
      {loading ? <div className="surface source-review-loading"><LoaderCircle className="spin" size={20} /> Загружаем файлы…</div> : (
        <div className="source-review-layout">
          <section className="surface source-review-files" aria-label="Исходные файлы">
            <div className="surface-title"><div><h2>Файлы объекта</h2><p>{files.length} исходных файлов</p></div></div>
            {files.length === 0 && <p>У объекта пока нет загруженных исходных файлов.</p>}
            {files.map((file) => (
              <button key={file.id} type="button" className={`source-review-file ${file.id === selectedId ? "source-review-file--active" : ""}`} onClick={() => setSelectedId(file.id)} disabled={saving || stageUploading || reprocessing || visualReviewSaving} aria-current={file.id === selectedId ? "true" : undefined}>
                <FileText size={18} /><span><strong>{file.name}</strong><small>{file.stages.join(" / ")} · {file.pageCount ?? "?"} стр. · {file.review ? `решение ${file.review.revisionStatus}/${file.review.approvalStatus}${file.review.sectionCode ? ` · ${file.review.sectionCode}` : ""}` : "нет решения"}</small></span>
              </button>
            ))}
          </section>
          {selected && <form className="surface source-review-form" onSubmit={(event) => void submit(event)}>
            <div className="surface-title"><div><h2>{selected.name}</h2><p>Файл {selected.id} · SHA-256 {selected.sha256}</p></div><a className="button button--secondary" href={api.sourceFileUrl(objectId, selected.id)}><FileText size={17} /> Скачать оригинал</a></div>
            <p className="source-review-note">Статус согласования и актуальности задаёт инспектор по исходному документу. Система не определяет их по имени файла или дате загрузки.</p>
            {stageToAdd && <p className="source-review-note">Если PDF содержит и РД, и ИД, зарегистрируйте те же байты как {stageToAdd}. Система объединит их по SHA-256 и откроет постраничную разметку.</p>}
            {stageToAdd && permissions.upload && <div className="source-review-stage-upload"><div className="source-review-stage-upload-controls"><label><span>Добавить стадию {stageToAdd} к этому PDF</span><input type="file" accept=".pdf,application/pdf" onChange={(event) => setStageFile(event.target.files?.[0] ?? null)} /></label><button className="button button--secondary" type="button" onClick={() => void addStage()} disabled={!stageFile || stageUploading || saving || reprocessing}>{stageUploading ? <LoaderCircle className="spin" size={17} /> : <UploadCloud size={17} />} Сверить SHA и добавить</button></div><small>Выберите точно тот же исходный PDF. Новый файл с другим хешем не будет загружен этим действием.</small></div>}
            {loadingDecision ? <p><LoaderCircle className="spin" size={17} /> Загружаем решение…</p> : <>
              <div className="source-review-fields">
                <label><span>Редакция</span><select value={revision} onChange={(event) => setRevision(event.target.value as Revision)} disabled={!permissions.review || saving || reprocessing}><option value="UNKNOWN">Не установлена</option><option value="CURRENT">Актуальная</option><option value="SUPERSEDED">Заменена</option></select></label>
                <label><span>Согласование</span><select value={approval} onChange={(event) => setApproval(event.target.value as Approval)} disabled={!permissions.review || saving || reprocessing}><option value="UNKNOWN">Не установлено</option><option value="APPROVED">Согласовано</option><option value="UNAPPROVED">Не согласовано</option></select></label>
              </div>
              <SourceSectionCodeField value={sectionCode} onChange={setSectionCode} disabled={!permissions.review || saving || reprocessing} />
              <label><span>Группа связанных документов</span><input value={linkGroup} onChange={(event) => setLinkGroup(event.target.value)} maxLength={120} disabled={!permissions.review || saving || reprocessing} placeholder="Одинаковый код у сопоставимых ПД и РД" /></label>
              {mixed && <label><span>Стадия каждой страницы</span><textarea rows={4} value={ranges} onChange={(event) => setRanges(event.target.value)} disabled={!permissions.review || saving || reprocessing || selected.pageCount === null} placeholder="1-12=RD, 13-676=UNRESOLVED" /><small>Файл содержит {selected.pageCount ?? "неизвестное число"} страниц; перечислите все без пропусков. Доступны {selected.stages.join(" и ")} и UNRESOLVED. Если на одной странице одновременно есть штамп РД и исполнительная отметка, укажите UNRESOLVED: одну стадию для всего листа выбирать нельзя. Такие страницы не участвуют в автоматическом сравнении.</small></label>}
              <label><span>Основание решения</span><textarea rows={3} value={basis} onChange={(event) => setBasis(event.target.value)} minLength={8} maxLength={1000} required disabled={!permissions.review || saving || reprocessing} placeholder="Укажите лист, штамп, документ или запись, по которой проверен статус" /></label>
              {selected.review && <small>Текущее решение от {new Date(selected.review.createdAt).toLocaleString("ru-RU")} · SHA-256 {selected.review.contentHash.slice(0, 16)}…</small>}
              {permissions.review ? <button className="button button--primary" type="submit" disabled={saving || reprocessing || stageUploading || (mixed && (selected.pageCount === null || !ranges.trim())) || basis.trim().length < 8 || savedSnapshot === currentSnapshot}>{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} Сохранить решение</button> : <p>У вашей учётной записи нет права принимать решения по источникам.</p>}
            </>}
          </form>}
        </div>
      )}
      {!loading && <section className="surface visual-proposal-panel" aria-label="Сохранённый OCR">
        <div className="surface-title"><div><span className="kicker">Текущая проверка</span><h2>Распознанные страницы</h2><p>Машинный OCR отдельных листов исходных PDF.</p></div></div>
        {ocrLoading && <p role="status"><LoaderCircle className="spin" size={17} /> Загружаем OCR-результат…</p>}
        {ocrError && <p className="inline-message" role="alert">{ocrError}</p>}
        {!ocrLoading && !ocrError && !ocrLayout && <p>В этой проверке OCR-результат ещё не сохранён. Это не означает, что на чертежах нет текста или элементов.</p>}
        {ocrLayout && <>
          <p className="visual-proposal-warning"><strong>Текст не проверен человеком.</strong> Сверяйте каждую строку с исходным листом. Оценка OCR не подтверждает правильность текста; по непросмотренным листам выводов нет.</p>
          <p>OCR требовался для {ocrLayout.ocrRequiredPageCount} стр.; обработано {ocrLayout.processedPageCount}, отложено {ocrLayout.deferredPageCount}. {ocrProfileLabel(ocrLayout.providerProfileId)}.</p>
          {selected && !ocrSource && <p>Выбранного файла нет в OCR-артефакте этой проверки.</p>}
          {ocrSource && <>
            <p><strong>{selected?.name ?? ocrSource.sourceFileId}</strong> · обработано {ocrSource.processedPageCount} из {ocrSource.ocrRequiredPageCount} требующих OCR стр.; отложено {ocrSource.deferredPageCount}. Статус: {ocrSourceStatusLabel(ocrSource.status)}</p>
            {ocrSource.pages.length === 0 && <p>Для файла строки не сохранены. Это не вывод об отсутствии текста.</p>}
            {ocrSource.pages.length > 0 && <div className="source-review-note">
              <p>Открыть выбранный лист и сохранённые строки:</p>
              {ocrSource.pages.map((page) => <button key={page.pageNumber} type="button"
                className="button button--secondary" style={{ marginRight: 8, marginBottom: 8 }}
                aria-pressed={ocrSelectedPage?.sourceFileId === ocrSource.sourceFileId
                  && ocrSelectedPage.pageNumber === page.pageNumber}
                onClick={() => {
                  setOcrSelectedLine(null);
                  setOcrSelectedPage({ sourceFileId: ocrSource.sourceFileId,
                    pageNumber: page.pageNumber });
                }}>
                Страница {page.pageNumber} · {page.lineCount} строк
              </button>)}
            </div>}
            {ocrPageLoading && <p role="status"><LoaderCircle className="spin" size={17} /> Загружаем строки…</p>}
            {ocrPageError && <p className="inline-message" role="alert">{ocrPageError}</p>}
            {activeOcrPage && <div className="visual-proposal-workspace">
              <div className="visual-proposal-preview">
                <h3>Исходный лист {activeOcrPage.pageNumber}</h3>
                <p>Просмотр оригинала для ручной сверки OCR.</p>
                <div className="visual-proposal-image-wrap"><OcrSourceImage
                  src={api.sourcePagePreviewUrl(objectId, activeOcrPage.sourceFileId,
                    activeOcrPage.pageNumber)} alt={`Исходная страница ${activeOcrPage.pageNumber}`} />
                  {activeOcrLine && activeOcrPage.widthPx > 0 && activeOcrPage.heightPx > 0
                    && <span className="ocr-line-bbox" aria-label="Выбранная область OCR на исходном листе"
                      style={{
                        left: `${activeOcrLine.bboxPx[0] / activeOcrPage.widthPx * 100}%`,
                        top: `${activeOcrLine.bboxPx[1] / activeOcrPage.heightPx * 100}%`,
                        width: `${(activeOcrLine.bboxPx[2] - activeOcrLine.bboxPx[0]) / activeOcrPage.widthPx * 100}%`,
                        height: `${(activeOcrLine.bboxPx[3] - activeOcrLine.bboxPx[1]) / activeOcrPage.heightPx * 100}%`,
                      }} />}
                </div>
                <details><summary>Происхождение OCR</summary>
                  <p>Источник SHA-256: {activeOcrPage.sourceSha256}</p>
                  <p>Лист SHA-256: {activeOcrPage.pageContentHash}</p>
                  <p>Рендер SHA-256: {activeOcrPage.renderSha256}</p>
                  <p>Рендер: {activeOcrPage.rendererProfileId}, {activeOcrPage.dpi} DPI,
                    {activeOcrPage.widthPx} × {activeOcrPage.heightPx} px.</p>
                  <p>OCR: {activeOcrPage.ocrProviderProfileId}</p>
                </details>
              </div>
              <div className="visual-proposal-preview">
                <h3>Сохранённые строки ({activeOcrPage.lineCount === 0 ? 0
                  : activeOcrPage.offset + 1}–{activeOcrPage.offset + activeOcrPage.lines.length}
                  {" "}из {activeOcrPage.lineCount})</h3>
                <p>Оценка модели приведена для поиска сомнительных мест, не как подтверждённая точность.</p>
                {activeOcrPage.lineCount === 0 && <p>OCR не вернул строк на этом листе. Это не подтверждает отсутствие текста.</p>}
                {activeOcrLine && <div className="ocr-line-inspection" aria-label="Ручная сверка выбранной строки">
                  <p className="ocr-line-selection" role="status">
                    <strong>Выбрана строка {activeOcrLine.ordinal + 1}:</strong>{" "}
                    <span>{activeOcrLine.text || "[пустая строка OCR]"}</span><br />
                    Координаты области: [{activeOcrLine.bboxPx.join(", ")}] px на рендере{" "}
                    {activeOcrPage.widthPx} × {activeOcrPage.heightPx} px.
                  </p>
                  {activeOcrCrop && <figure className="ocr-line-crop">
                    <OcrSourceImage src={api.sourcePageCropUrl(objectId, activeOcrPage.sourceFileId,
                        activeOcrPage.pageNumber, activeOcrCrop)}
                        alt={`Фрагмент исходного листа ${activeOcrPage.pageNumber} вокруг строки ${activeOcrLine.ordinal + 1}`}
                        />
                    <figcaption>Фрагмент исходного листа для сверки выбранной строки.</figcaption>
                  </figure>}
                </div>}
                <ol start={activeOcrPage.offset + 1} className="visual-proposal-list">
                  {activeOcrPage.lines.map((line) => <li key={line.ordinal}>
                    <button type="button" className="ocr-line-select"
                      aria-pressed={activeOcrLine?.ordinal === line.ordinal}
                      onClick={() => {
                        setOcrSelectedLine({ checkId: activeOcrPage.checkId,
                          sourceFileId: activeOcrPage.sourceFileId, pageNumber: activeOcrPage.pageNumber,
                          artifactId: activeOcrPage.artifactId, ordinal: line.ordinal });
                      }}>
                      <span>{line.text || "[пустая строка OCR]"}</span>
                      <small>Оценка {line.confidence.toFixed(3)} · область [{line.bboxPx.join(", ")}] px</small>
                    </button>
                  </li>)}
                </ol>
                {activeOcrPage.offset > 0 && <button className="button button--secondary"
                  type="button" disabled={ocrMoreLoading}
                  onClick={() => void loadOcrOffset(Math.max(0, activeOcrPage.offset - 50))}>
                  Предыдущие 50
                </button>}
                {activeOcrPage.nextOffset !== null && <button className="button button--secondary"
                  type="button" disabled={ocrMoreLoading}
                  onClick={() => void loadOcrOffset(activeOcrPage.nextOffset!)}>
                  {ocrMoreLoading ? "Загружаем…" : "Следующие 50"}
                </button>}
              </div>
            </div>}
          </>}
        </>}
      </section>}
      {!loading && <section className="surface visual-proposal-panel" aria-label="Визуальные предложения">
        <div className="surface-title"><div><span className="kicker">Текущая проверка</span><h2>Визуальные предложения</h2><p>Геометрические области, найденные в PDF. Класс элемента и соответствие чертежу здесь не подтверждены.</p></div></div>
        {visualLoading && <p role="status"><LoaderCircle className="spin" size={17} /> Загружаем предложения…</p>}
        {visualError && <p className="inline-message" role="alert">{visualError}</p>}
        {visualReviewError && <p className="inline-message" role="alert">{visualReviewError}</p>}
        {!visualLoading && !visualError && !visual && <p>В этой проверке нет сохранённых визуальных предложений. Это не подтверждает отсутствие элементов на чертежах.</p>}
        {visual && <>
          <p className="visual-proposal-warning"><strong>Не подтверждены.</strong> Предложения не становятся замечаниями или выводом об отсутствии элемента без проверки источника.</p>
          {selected && !visualSource && <p>Для выбранного файла предложения не сохранены. Отсутствие элементов не установлено.</p>}
          {visualSource && <>
            <p><strong>{selected?.name ?? visualSource.sourceFileId}</strong> · обработано {visualSource.scannedPageCount} из {visualSource.pageCount} стр. · {visualSource.proposals.length} сохранённых областей</p>
            {visualSource.documentContext && <div className="source-review-note">
              <p><strong>Подсказка из титула файла:</strong> {visualSource.documentContext.status === "HEATING"
                ? "отопление" : visualSource.documentContext.status === "VENTILATION"
                  ? "вентиляция" : "раздел не установлен"}. Титул не описывает все страницы смешанного PDF и не классифицирует листы или найденные области.</p>
              <details><summary>Текстовое основание подсказки</summary>
                {visualSource.documentContext.inspectedPages.map((page) => <p key={page.pageNumber}>
                  Страница {page.pageNumber} · SHA-256 текста {page.textSha256.slice(0, 16)}… · {page.titleWindow ?? "титул не распознан"}
                </p>)}
              </details>
            </div>}
            {visualSource.status === "SKIPPED_PAGE_LIMIT" && <p>Файл пропущен из-за ограничения числа страниц. Визуальный поиск по нему не выполнялся.</p>}
            {visualSource.status === "PARTIALLY_SCANNED_PAGE_LIMIT" && <>
              <p>Проверена только равномерная выборка листов. Остальные {visualSource.skippedPageCount} стр. не просматривались; отсутствие элементов по ним не установлено.</p>
              <details><summary>Номера просмотренных листов</summary><p>{visualSource.scannedPageNumbers?.join(", ")}</p></details>
            </>}
            {visualSource.proposalLimitReached && <p>Достигнут лимит предложений. Ещё {visualSource.unretainedProposalCount} областей не сохранено.</p>}
            {visualSource.vlm && <p className="source-review-note">Для локальной модели выбрано {visualSource.vlm.observations.length} из {visualSource.vlm.eligibleProposalCount} сохранённых областей; ответ получен для {visualSource.vlm.observations.filter((observation) => observation.responseSha256 !== null).length}. Остальные {visualSource.vlm.omittedProposalCount} не передавались модели. Ответы — неподтверждённые подсказки; охват проверки и замечания не меняются.</p>}
            {visualSource.status === "SCANNED" && visualSource.proposals.length === 0 && <p>Геометрические кандидаты не найдены этим методом. Отсутствие элемента не установлено.</p>}
            {visualSource.proposals.length > 0 && <div className="visual-proposal-workspace">
              <div className="visual-proposal-preview" aria-live="polite">
                {activePreview ? <>
                  <h3>Лист {activePreview.pageNumber}, кандидат {activePreview.proposalIndex + 1}</h3>
                  <p>Рамка и увеличенный фрагмент показывают только геометрическое предложение. Класс объекта не установлен; проверяйте исходный PDF.</p>
                  {activeVlmObservation && <p className="source-review-note"><strong>Ответ локальной модели:</strong> {activeVlmObservation.decision === "RADIATOR_HINT" ? "предположила радиатор" : activeVlmObservation.decision === "OTHER_HINT" ? "ответила «другой объект»; радиатор здесь всё равно возможен" : activeVlmObservation.reasonCode === "MODEL_OTHER_UNTRUSTED" ? "ответила «другой объект»; отрицательный ответ отклонён" : activeVlmObservation.responseSha256 ? "модель воздержалась" : "ответ не получен"} · {activeVlmObservation.reasonCode}. Сверьте с исходным листом: ответ не меняет результат проверки и не создаёт замечание.</p>}
                  {visualSource.vlm && !activeVlmObservation && <p className="source-review-note">Эта область не вошла в ограниченную выборку для модели.</p>}
                  <div className="visual-proposal-views">
                    <section aria-label="Исходный лист целиком">
                      <h4>Лист целиком</h4>
                      {previewLoading && <p role="status"><LoaderCircle className="spin" size={17} /> Загружаем лист…</p>}
                      {previewError && <p className="inline-message" role="alert">{previewError}</p>}
                      <div className="visual-proposal-image-wrap" hidden={Boolean(previewError)}>
                        <img
                          key={activePreview.requestId}
                          src={api.sourcePagePreviewUrl(objectId, activePreview.sourceFileId, activePreview.pageNumber)}
                          alt={`Страница ${activePreview.pageNumber} файла ${selected?.name ?? activePreview.sourceFileId}`}
                          onLoad={() => setPreviewLoading(false)}
                          onError={() => { setPreviewLoading(false); setPreviewError("Не удалось загрузить изображение листа. Выберите кандидата ещё раз."); }}
                        />
                        {!previewLoading && <span
                          className="visual-proposal-bbox"
                          aria-label="Граница геометрического кандидата"
                          style={{
                            left: `${activePreview.bboxNormalized[0] * 100}%`,
                            top: `${activePreview.bboxNormalized[1] * 100}%`,
                            width: `${(activePreview.bboxNormalized[2] - activePreview.bboxNormalized[0]) * 100}%`,
                            height: `${(activePreview.bboxNormalized[3] - activePreview.bboxNormalized[1]) * 100}%`,
                          }}
                        />}
                      </div>
                    </section>
                    <section aria-label="Увеличенный фрагмент исходного листа">
                      <h4>Увеличенный фрагмент</h4>
                      {cropLoading && <p role="status"><LoaderCircle className="spin" size={17} /> Загружаем фрагмент…</p>}
                      {cropError && <p className="inline-message" role="alert">{cropError}</p>}
                      {!cropError && <div className="visual-proposal-image-wrap visual-proposal-crop-wrap">
                        <img
                          key={`${activePreview.sourceFileId}-${activePreview.pageNumber}-${activePreview.proposalIndex}`}
                          src={api.sourcePageCropUrl(objectId, activePreview.sourceFileId, activePreview.pageNumber, activePreview.bboxNormalized)}
                          alt={`Увеличенный фрагмент страницы ${activePreview.pageNumber} вокруг неклассифицированной области`}
                          onLoad={() => setCropLoading(false)}
                          onError={() => { setCropLoading(false); setCropError("Не удалось загрузить фрагмент. Проверьте область на полном листе."); }}
                        />
                      </div>}
                    </section>
                  </div>
                  {activeVisualDecision && <p className="visual-proposal-decision">Последнее решение: <strong>{activeVisualDecision.action === "KEEP_FOR_REVIEW" ? "Оставить для проверки" : activeVisualDecision.action === "REJECT" ? "Отклонить предложение" : "Неясно"}</strong> · {new Date(activeVisualDecision.createdAt).toLocaleString("ru-RU")}</p>}
                  {!visualReviews && !visualReviewError && <p role="status">Загружаем права и историю решений…</p>}
                  {visualReviews?.canReview ? <form className="visual-proposal-review-form" onSubmit={(event) => void saveVisualReview(event)}>
                    <label><span>Решение по этой области</span><select value={visualReviewAction} onChange={(event) => setVisualReviewAction(event.target.value as VisualProposalReviewAction)} disabled={visualReviewSaving}>
                      <option value="UNSURE">Неясно</option>
                      <option value="KEEP_FOR_REVIEW">Оставить для проверки</option>
                      <option value="REJECT">Отклонить предложение</option>
                    </select></label>
                    <label><span>Основание по исходному листу</span><textarea rows={3} minLength={8} maxLength={1000} value={visualReviewNote} onChange={(event) => setVisualReviewNote(event.target.value)} disabled={visualReviewSaving} required placeholder="Что видно на чертеже?" /></label>
                    <button type="submit" className="button button--secondary" disabled={visualReviewSaving || visualReviewNote.trim().length < 8}>{visualReviewSaving ? "Сохраняем…" : "Сохранить решение"}</button>
                    <small>Решение сохраняется отдельно от замечаний и не меняет охват проверки.</small>
                  </form> : visualReviews && <p>Для решений по предложениям нужно право инспектора на этот объект и актуальная завершённая проверка.</p>}
                  {activeVisualHistory.length > 0 && <details className="visual-proposal-history"><summary>История решений ({activeVisualHistory.length})</summary><ol>{activeVisualHistory.map((review) => <li key={review.id}><strong>{review.action === "KEEP_FOR_REVIEW" ? "Оставить для проверки" : review.action === "REJECT" ? "Отклонить" : "Неясно"}</strong> · {new Date(review.createdAt).toLocaleString("ru-RU")}<br />{review.note}</li>)}</ol></details>}
                </> : <p>Выберите кандидата в списке, чтобы увидеть его на листе.</p>}
              </div>
              <ol className="visual-proposal-list">
                {visualSource.proposals.map((proposal, index) => (
                  <li key={`${proposal.pageNumber}-${index}`}>
                    <button type="button" className="visual-proposal-select" onClick={() => showProposal(proposal, index)} disabled={visualReviewSaving} aria-pressed={activePreview?.proposalIndex === index}>
                      <strong>Страница {proposal.pageNumber}</strong>
                      <span>Область: X {proposal.bboxNormalized[0].toFixed(3)}–{proposal.bboxNormalized[2].toFixed(3)}, Y {proposal.bboxNormalized[1].toFixed(3)}–{proposal.bboxNormalized[3].toFixed(3)}</span>
                      <small>Показать на листе · объект не классифицирован</small>
                    </button>
                  </li>
                ))}
              </ol>
            </div>}
          </>}
        </>}
      </section>}
    </div>
  );
}
