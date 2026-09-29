import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type FactLinkInput, type FactLinkListRead, type FactLinkRecord,
  type PilotResultsRead } from "./api";

type FactFamily = NonNullable<PilotResultsRead["factFamily"]>;

interface LinkableFact {
  factId: string;
  parameterCode: string;
  stage: "PD" | "RD" | "ID";
  rawValue: string;
  rawUnit: string;
  sourceFileId: string;
  sourceSha256: string;
  pageNumber: number;
}

const parameterLabels: Record<string, string> = {
  "PZ-004": "Строительный объём",
  "PZ-007": "Количество надземных этажей",
  "KR-055": "Класс бетона",
  "KR-058": "Толщина фундамента",
  "KR-059": "Толщина плиты перекрытия",
};

export function linkableFacts(data: FactFamily): LinkableFact[] {
  return data.facts.flatMap((raw) => {
    if (raw.schemaVersion !== "typed-fact-v1" || raw.objectId !== data.objectId
      || typeof raw.factId !== "string" || !/^[a-f0-9]{64}$/.test(raw.factId)
      || typeof raw.parameterCode !== "string" || !(raw.parameterCode in parameterLabels)
      || (raw.stage !== "PD" && raw.stage !== "RD" && raw.stage !== "ID")
      || typeof raw.rawValue !== "string" || !raw.rawValue
      || typeof raw.rawUnit !== "string" || !raw.rawUnit
      || typeof raw.sourceFileId !== "string" || !raw.sourceFileId
      || typeof raw.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.sourceSha256)
      || typeof raw.pageNumber !== "number" || !Number.isInteger(raw.pageNumber)
      || raw.pageNumber < 1) return [];
    return [{ factId: raw.factId, parameterCode: raw.parameterCode, stage: raw.stage,
      rawValue: raw.rawValue, rawUnit: raw.rawUnit, sourceFileId: raw.sourceFileId,
      sourceSha256: raw.sourceSha256, pageNumber: raw.pageNumber }];
  });
}

export function makeFactLinkInput(data: FactFamily, pdFactId: string,
  actualFactId: string, reference: string): FactLinkInput | null {
  const facts = linkableFacts(data);
  const pd = facts.find((fact) => fact.factId === pdFactId && fact.stage === "PD");
  const actual = facts.find((fact) => fact.factId === actualFactId
    && (fact.stage === "RD" || fact.stage === "ID"));
  const basis = reference.trim();
  if (!pd || !actual || pd.parameterCode !== actual.parameterCode
    || basis.length < 8 || basis.length > 1000) return null;
  return { factFamilyContentHash: data.contentHash, pdFactId, actualFactId,
    basis: { reference: basis } };
}

function factLabel(fact: LinkableFact): string {
  return `${fact.rawValue} ${fact.rawUnit} · ${fact.sourceFileId}, стр. ${fact.pageNumber}`;
}

function FactSource({ fact, objectId }: { fact: LinkableFact; objectId: string }) {
  return <p>{fact.stage}: {factLabel(fact)} · SHA-256 {fact.sourceSha256.slice(0, 12)}… · <a
    href={api.sourcePagePreviewUrl(objectId, fact.sourceFileId, fact.pageNumber)}
    target="_blank" rel="noopener noreferrer">Открыть исходный лист</a></p>;
}

export function SavedFactLink({ item, facts, objectId }: {
  item: FactLinkRecord;
  facts: LinkableFact[];
  objectId: string;
}) {
  const pd = facts.find((fact) => fact.factId === item.link.pdFactId);
  const actual = facts.find((fact) => fact.factId === item.link.actualFactId);
  const reference = typeof item.link.basis === "object" && item.link.basis
    ? item.link.basis.reference : "";
  return <details>
    <summary>{pd?.parameterCode ?? "Параметр"} · связь ПД и {actual?.stage ?? "РД/ИД"} · {new Date(item.createdAt).toLocaleString("ru-RU")}</summary>
    {pd && <FactSource fact={pd} objectId={objectId} />}
    {actual && <FactSource fact={actual} objectId={objectId} />}
    <p>Основание эксперта: {reference}</p>
    <small>Решение {item.id} · SHA-256 {item.contentHash.slice(0, 12)}…</small>
  </details>;
}

export function FactLinkReview({ data, checkId, objectId, onReprocess }: {
  data: FactFamily;
  checkId: string;
  objectId: string;
  onReprocess: () => Promise<void>;
}) {
  const [links, setLinks] = useState<FactLinkListRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pdFactId, setPdFactId] = useState("");
  const [actualFactId, setActualFactId] = useState("");
  const [basis, setBasis] = useState("");
  const [saving, setSaving] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const facts = useMemo(() => linkableFacts(data), [data]);
  const codes = Object.keys(parameterLabels).filter((parameterCode) =>
    facts.some((fact) => fact.parameterCode === parameterCode && fact.stage === "PD")
    && facts.some((fact) => fact.parameterCode === parameterCode
      && (fact.stage === "RD" || fact.stage === "ID")));
  const pdChoices = facts.filter((fact) => fact.parameterCode === code && fact.stage === "PD");
  const actualChoices = facts.filter((fact) => fact.parameterCode === code
    && (fact.stage === "RD" || fact.stage === "ID"));
  const selectedPd = pdChoices.find((fact) => fact.factId === pdFactId);
  const selectedActual = actualChoices.find((fact) => fact.factId === actualFactId);
  const input = makeFactLinkInput(data, pdFactId, actualFactId, basis);
  const alreadyLinked = links?.items.some((item) => item.link.pdFactId === pdFactId
    && item.link.actualFactId === actualFactId) ?? false;

  useEffect(() => {
    let cancelled = false;
    setLinks(null); setLoading(true); setError(null); setNotice(null);
    setCode(""); setPdFactId(""); setActualFactId(""); setBasis("");
    void api.getFactLinks(checkId).then((value) => {
      if (!cancelled) setLinks(value);
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Не удалось загрузить связи фактов");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [checkId, data.contentHash]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!links?.canReview || !input || alreadyLinked || saving) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const saved = await api.recordFactLink(checkId, input);
      setLinks((current) => current && ({ ...current,
        items: current.items.some((item) => item.id === saved.id)
          ? current.items : [...current.items, saved] }));
      setCode(""); setPdFactId(""); setActualFactId(""); setBasis("");
      setNotice("Связь сохранена как решение эксперта. Запустите новую проверку, чтобы она вошла в анализ.");
      try { setLinks(await api.getFactLinks(checkId)); }
      catch { setError("Связь сохранена, но список решений не обновился. Повторная загрузка страницы покажет актуальные данные."); }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить связь фактов");
    } finally {
      setSaving(false);
    }
  };

  const rerun = async () => {
    if (!links?.canRun || reprocessing) return;
    setError(null); setReprocessing(true);
    try { await onReprocess(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось запустить новую проверку"); }
    finally { setReprocessing(false); }
  };

  return <section className="surface" aria-label="Ручная связь фактов ПД и РД" style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Решение эксперта</span><h3>Связать факты одного элемента</h3><p>Сверьте оба исходных листа. Выберите конкретный факт ПД и соответствующий факт РД или ИД.</p></div></div>
    <p>Связь не подтверждает правильность чисел и не создаёт находку или вывод об отсутствии нарушения. Новая проверка применит сохранённое решение к проверенным источникам.</p>
    {loading && <p role="status">Загружаем решения по связям…</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {links && <>
      <h4>Сохранённые связи: {links.items.length}</h4>
      {links.items.length === 0 && <p>Связи ещё не сохранены.</p>}
      {links.items.map((item) => <SavedFactLink key={item.id} item={item} facts={facts} objectId={objectId} />)}
      {links.canReview && <form className="source-review-form" onSubmit={(event) => void save(event)}>
        <h4>Новая связь</h4>
        {codes.length === 0 ? <p>Пары предложений ПД и РД/ИД пока нет. Сравнение остаётся остановленным.</p> : <>
          <label><span>Параметр</span><select aria-label="Параметр для связи фактов" value={code}
            onChange={(event) => { setCode(event.target.value); setPdFactId(""); setActualFactId(""); }}>
            <option value="">Выберите параметр</option>
            {codes.map((item) => <option key={item} value={item}>{item} · {parameterLabels[item]}</option>)}
          </select></label>
          {code && <>
            <label><span>Факт ПД</span><select aria-label="Факт ПД" value={pdFactId}
              onChange={(event) => setPdFactId(event.target.value)}>
              <option value="">Выберите факт ПД</option>
              {pdChoices.map((fact) => <option key={fact.factId} value={fact.factId}>{factLabel(fact)}</option>)}
            </select></label>
            <label><span>Факт РД или ИД</span><select aria-label="Факт РД или ИД" value={actualFactId}
              onChange={(event) => setActualFactId(event.target.value)}>
              <option value="">Выберите факт РД или ИД</option>
              {actualChoices.map((fact) => <option key={fact.factId} value={fact.factId}>{fact.stage} · {factLabel(fact)}</option>)}
            </select></label>
          </>}
          {selectedPd && <FactSource fact={selectedPd} objectId={objectId} />}
          {selectedActual && <FactSource fact={selectedActual} objectId={objectId} />}
          <label><span>Основание соответствия</span><textarea value={basis} rows={3}
            onChange={(event) => setBasis(event.target.value)} minLength={8} maxLength={1000}
            placeholder="Укажите корпус, зону, этаж, отметку или обозначение элемента на обоих листах" />
            <small>Опишите, почему эти два значения относятся к одному элементу. Одного совпадения текста или числа недостаточно.</small></label>
          <button className="button button--primary" type="submit" disabled={!input || alreadyLinked || saving}>
            {saving ? "Сохраняем…" : alreadyLinked ? "Связь уже сохранена" : "Сохранить связь эксперта"}
          </button>
        </>}
      </form>}
      {!links.canReview && <p>Для создания связи нужно право принимать решения по источникам.</p>}
      {links.items.length > 0 && <p>Чтобы применить сохранённые связи, запустите новую проверку. Текущий результат не меняется.</p>}
      {links.items.length > 0 && links.canRun && <button className="button button--secondary"
        type="button" disabled={reprocessing} onClick={() => void rerun()}>
        {reprocessing ? "Запускаем…" : "Новая проверка"}
      </button>}
    </>}
  </section>;
}
