import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Finding, FindingStatus, InspectionObject } from "@inspector-ai/contracts";
import { ArrowRight, ArrowUpRight, Menu, X } from "./design-system/icons";
import { Brand, Button } from "./design-system/ui";
import { SourceImage } from "./design-system/SourceImage";
import { useScrollReveal } from "./design-system/useScrollReveal";
import { FaqItem } from "./design-system/FaqItem";
import { ParticleBuilding } from "./design-system/ParticleBuilding";
import { PreviewComparison, getPreviewSources } from "./design-system/PreviewComparison";
import { ColorModeControl } from "./design-system/ColorModeControl";
import type { ColorMode } from "./design-system/colorMode";
import { useAmbientMotion } from "./design-system/useAmbientMotion";

// Ink bounds in em for the bundled Onest Variable at weight 650.
// Trimming each glyph's side bearings keeps visible gaps equal, including к/т.
const glassWordmark = [
  ["и", .057, .495], ["н", .057, .4715], ["с", .037, .492],
  ["п", .057, .4715], ["е", .037, .50056], ["к", .057, .4975],
  ["т", .0085, .4775], ["о", .037, .524], ["р", .057, .5265],
  [" ", 0, .22], ["и", .057, .495], ["и", .057, .495],
] as const;

interface LandingProps {
  objects: InspectionObject[];
  findings: Finding[];
  parameterCount: number;
  loading?: boolean;
  opening?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onWorkspace: () => void;
  onUpload: () => void;
  onEvidence: (finding: Finding) => void;
  onCatalog: () => void;
  colorMode?: ColorMode;
  onColorModeChange?: (mode: ColorMode) => void;
}

const statusCopy: Record<FindingStatus, string> = {
  CANDIDATE: "Нужно проверить", CONFIRMED_VIOLATION: "Подтверждено", NEGATIVE_VERIFIED: "Отклонено",
  CLARIFICATION_REQUIRED: "На уточнении", MISSING_EVIDENCE: "Мало доказательств",
  NOT_COMPARABLE: "Нельзя сравнить", NOT_APPLICABLE: "Неприменимо", SUSPICION: "Подозрение",
};

export { getPreviewSources } from "./design-system/PreviewComparison";

export function Landing({ objects, findings, parameterCount, loading = true, opening = false, error, onRetry, onWorkspace, onUpload, onEvidence, onCatalog, colorMode = "system", onColorModeChange = () => {} }: LandingProps) {
  const revealRef = useScrollReveal();
  useAmbientMotion(revealRef);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lightNavigation, setLightNavigation] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const closingRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [stage, setStage] = useState<"PD" | "RD">("PD");
  const examples = findings.filter(f => getPreviewSources(f.evidence).length === 2).slice(0, 3);
  const featured = examples.find(f => f.id === selectedId) ?? examples[0];
  const source = featured && getPreviewSources(featured.evidence).find(item => item.stage === stage);
  const activeObject = objects.find(object => object.activeCheckId === featured?.checkId) ?? objects[0];
  const openEvidence = () => featured ? onEvidence(featured) : onWorkspace();

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); menuButton.current?.focus(); }
    };
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !navigationRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const closeOnResize = () => { if (window.innerWidth > 800) setMenuOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", closeOnResize);
    return () => { window.removeEventListener("keydown", closeOnEscape); window.removeEventListener("pointerdown", closeOutside); window.removeEventListener("resize", closeOnResize); };
  }, [menuOpen]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const beyondHero = (heroRef.current?.getBoundingClientRect().bottom ?? 1000) < 68;
      const closing = closingRef.current?.getBoundingClientRect();
      setLightNavigation(beyondHero && !(closing && closing.top < 68));
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); };
  }, []);

  const faq = [
    ["Как начать проверку?", "Откройте публичные примеры или загрузите свой комплект. Система покажет подсказки с адресами исходных страниц. Степень автоматической проверки зависит от доступных источников."],
    ["Кто подтверждает нарушение?", "Вы. ИИ отмечает возможное расхождение, но это ещё не подтверждённое нарушение. После сверки документов выберите решение и поясните его. В записи останутся ваше имя, комментарий и время."],
    ["Что делать, если документа не хватает?", "Откройте раздел «Покрытие»: там указаны параметры без автоматической проверки и причины пропусков. Если для вывода не хватает источника, запросите документ. Само отсутствие файла не означает, что есть нарушение."],
    ["Можно ли загрузить свои документы?", "Да, при настроенной на сервере проверке файлов на вирусы. После загрузки система создаёт отдельные кандидаты на проверку с адресами исходных страниц. Подсказки не становятся подтверждёнными замечаниями без решения инспектора."],
  ];

  return <div ref={revealRef} className="landing landing--antimetal theme-light">
    <a className="skip-link" href="#landing-main">Перейти к содержимому</a>
    <header ref={navigationRef} className={"landing-nav landing-container " + (lightNavigation ? "theme-light landing-nav--light" : "theme-dark")}>
      <a className="landing-brand-link" href="#" aria-label="Инспектор ИИ: главная"><Brand inverse={!lightNavigation} /></a>
      <nav id="landing-navigation" className={menuOpen ? "landing-nav__links is-open" : "landing-nav__links"} aria-label="О продукте">
        <a href="#workflow" onClick={() => setMenuOpen(false)}>Как это работает</a>
        <a href="#evidence" onClick={() => setMenuOpen(false)}>Документы</a>
        <a href="#principles" onClick={() => setMenuOpen(false)}>Подход</a>
      </nav>
      <div className="landing-nav__actions">
        <Button variant="inverted" onClick={onWorkspace} loading={opening}>Открыть кабинет <ArrowUpRight size={16} /></Button>
        <button ref={menuButton} className="landing-menu" aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"} aria-expanded={menuOpen} aria-controls="landing-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
      </div>
    </header>

    <main id="landing-main">
      <section ref={heroRef} className="landing-hero theme-dark">
        <div className="landing-theme-backdrop" aria-hidden="true" />
        <div className="landing-hero__layout landing-container">
        <div className="landing-hero__content">
          <a className="landing-announcement" href="#workflow"><span>Проверка</span> Сверьте исходные листы ПД и РД <ArrowRight size={13} /></a>
          <h1>Сверяйте ПД и РД.<br /><span>Опирайтесь на факты.</span></h1>
          <p className="hero-description">Сравнивайте исходные листы, проверяйте расхождения<br className="hero-copy-break" /> и фиксируйте решение с обоснованием.</p>
          <div className="hero-actions"><Button variant="accent" onClick={onWorkspace} loading={opening}>Открыть кабинет <ArrowRight size={17} /></Button></div>
        </div>
        <ParticleBuilding />
        </div>
      </section>

      {featured && <section className="product-preview landing-container" aria-label="Интерактивный пример сравнения документов" id="live-example">
        <div className="preview-intro"><div><p className="landing-eyebrow">Рабочий пример</p><h2>Два листа. Повод проверить.</h2></div><p>Откройте запись своего объекта и проверьте предположение по оригиналам ПД и РД.</p></div>
        <div className="preview-window theme-light">
          <header className="preview-titlebar"><div><span>Ваш объект</span><strong>{activeObject?.address.replace("г. Москва, ", "") ?? "Документация объекта"}</strong></div><span className="preview-demo">Запись из проверки</span></header>
          {featured ? <>
            <div className="preview-app">
              <aside className="preview-queue" aria-label="Выбор примера">
                <div className="preview-queue__track" style={{ "--preview-count": examples.length, "--preview-index": examples.indexOf(featured) } as CSSProperties}>
                  {examples.map(finding => <button key={finding.id} aria-pressed={finding.id === featured.id} onClick={() => setSelectedId(finding.id)}><span>{finding.location}</span><strong>{finding.title}</strong></button>)}
                  <span className="preview-queue__indicator" aria-hidden="true" />
                </div>
              </aside>
              <PreviewComparison finding={featured} />
            </div>
            <footer className="preview-result"><div><span className={"status-badge status-badge--" + featured.status.toLowerCase()}>{statusCopy[featured.status]}</span><p>{featured.location}<span>{featured.parameterCode}</span></p></div><Button onClick={openEvidence} loading={opening}>Сверить документы <ArrowRight size={16} /></Button></footer>
          </> : <div className={"preview-placeholder " + (error ? "has-error" : "")} role="status" aria-busy={loading && !error}>
            {!error && loading && <div className="preview-skeleton" aria-hidden="true"><i /><i /></div>}
            <strong>{error ? "Не удалось загрузить пример" : loading ? "Загружаем документы…" : "Пока нет примеров с листами ПД и РД"}</strong>
            <p>{error ? "Проверьте подключение и попробуйте ещё раз." : "Здесь появятся исходные листы ПД и РД."}</p>
            {error && onRetry && <Button variant="secondary" onClick={onRetry}>Повторить загрузку</Button>}
          </div>}
        </div>
        <p className="preview-caption"><span>Исходные листы объекта</span> ПД — проектная документация · РД — рабочая документация</p>
      </section>}

      <section className="landing-section landing-container workflow-section" id="workflow">
        <div data-reveal className="section-heading-copy"><p className="landing-eyebrow">Как это работает</p><h2>От файла<br />к решению.</h2><p>Три шага в одном рабочем пространстве. Каждый вывод можно проверить по исходному листу.</p><button className="landing-inline-link" onClick={onWorkspace}><span className="landing-inline-link__label">Открыть кабинет</span><ArrowRight size={16} /></button></div>
        <ol className="workflow-steps">
          <li data-reveal><span className="workflow-number" aria-hidden="true">01</span><div><h3>Соберите комплект</h3><p>Загрузите ПД, РД и ИД в один объект.</p></div></li>
          <li data-reveal><span className="workflow-number" aria-hidden="true">02</span><div><h3>Проверьте расхождение</h3><p>Сравните значения и откройте листы, на которых основан вывод.</p></div></li>
          <li data-reveal><span className="workflow-number" aria-hidden="true">03</span><div><h3>Оставьте решение</h3><p>Ваш статус и комментарий сохранятся в протоколе проверки.</p></div></li>
        </ol>
      </section>

      <section className="landing-interlude theme-dark" data-ambient aria-label="Принцип проверки">
        <div className="landing-theme-backdrop" aria-hidden="true" />
        <div className="landing-container landing-interlude__inner"><p>Система показывает возможное расхождение.</p><p>Решение остаётся за инспектором.</p><Button variant="accent" onClick={onWorkspace} loading={opening}>Открыть кабинет <ArrowRight size={16} /></Button></div>
      </section>

      <section className="evidence-feature" id="evidence">
        <div className="landing-container evidence-feature__grid">
          <div data-reveal className="evidence-feature__text"><p className="landing-eyebrow">Оригинал рядом с подсказкой</p><h2>Сверяйте подсказку с оригиналом.</h2><p>У каждой записи для проверки есть адрес в документе: файл, лист и страница PDF. Лист можно открыть в полном размере и принять решение самому.</p>{featured && <div className="source-reference"><span>{featured.parameterCode}</span><span>{featured.location}</span><span>{source ? "PDF, страница " + source.pdfPageNumber : "Исходный лист"}</span></div>}<Button variant="ghost" className="landing-inline-link landing-inline-link--evidence" onClick={onWorkspace} loading={opening}><span className="landing-inline-link__label">Открыть кабинет</span><ArrowRight size={18} /></Button></div>
          {featured && <figure data-reveal className="evidence-specimen theme-light"><div className="specimen-toolbar"><div className="segmented" role="group" aria-label="Источник примера">{(["PD", "RD"] as const).map(value => <button key={value} aria-pressed={stage === value} className={stage === value ? "active" : ""} onClick={() => setStage(value)}>{value === "PD" ? "Проектная · ПД" : "Рабочая · РД"}</button>)}</div><span>Лист {source?.documentSheetNumber ?? "не указан"}</span></div><div className="specimen-page">{loading && !source ? <div className="source-image-loading" role="status">Загружаем пример…</div> : <SourceImage key={source?.imageUrl ?? "missing"} src={source?.imageUrl ?? null} alt={"Фрагмент страницы " + (source?.fileName ?? "документа")} />}<span className="specimen-page__label">Фрагмент страницы</span></div><figcaption><span>{source?.fileName ?? "Источник недоступен"}</span><strong>{stage === "PD" ? featured.expectedValue : featured.actualValue}</strong></figcaption></figure>}
        </div>
      </section>

      <section className="landing-section landing-container principle-section" id="principles">
        <p className="landing-eyebrow">Решение инспектора</p>
        <h2 data-reveal>ИИ находит.<br /><span>Инспектор решает.</span></h2>
        <div className="principle-layout">
          <div data-reveal className="decision-principle"><h3>Вывод — ещё не нарушение.</h3><p>ИИ может ошибиться. Сверьте оригиналы, подтвердите или отклоните вывод и оставьте пояснение. В протокол попадёт ваше решение.</p><div className="missing-principle"><h3>Если источника не хватает</h3><p>Система покажет, какого документа нет. Без него сравнение не считается завершённым.</p></div></div>
          {featured && <div data-reveal className="decision-example" aria-label="Пример записи на проверку"><div className="decision-example__top"><span>На проверку</span><span>{featured.parameterCode}</span></div><p>{featured.location}</p><h3>{featured.title}</h3><div className="decision-example__values"><div><span>По проекту</span><strong>{featured.expectedValue ?? "Откройте исходный лист ПД"}</strong></div><div><span>В рабочей документации</span><strong>{featured.actualValue ?? "Откройте исходный лист РД"}</strong></div></div><span className="decision-example__foot">Решение принимает инспектор</span></div>}
        </div>
        <button type="button" className="catalog-feature" onClick={onCatalog}>
          <span className="catalog-feature__identity"><span className="catalog-feature__title">Справочник параметров</span><strong className="catalog-feature__count">{parameterCount > 0 ? new Intl.NumberFormat("ru-RU").format(parameterCount) : "Перечень параметров"}</strong></span>
          <span className="catalog-feature__action">Открыть справочник <ArrowUpRight size={18} /></span>
        </button>
      </section>

      <section id="questions" className="landing-section landing-container faq-section"><h2 data-reveal>Вопросы о работе сервиса</h2><div className="faq-list">{faq.map(([question, answer]) => <FaqItem key={question} question={question} answer={answer} />)}</div></section>
      <div ref={closingRef} className="landing-closing theme-dark" data-ambient><div className="landing-theme-backdrop" aria-hidden="true" /><section data-reveal className="landing-final landing-container"><div><p className="landing-eyebrow">Рабочий кабинет</p><h2>Увидьте расхождение.<br /><span>Проверьте сами.</span></h2><p>Загрузите комплект и сверяйте подсказки с исходными листами.</p></div><div className="final-actions"><Button variant="accent" onClick={onWorkspace} loading={opening}>Открыть кабинет <ArrowRight size={17} /></Button><Button variant="secondary" onClick={onUpload}>Загрузить свой комплект</Button></div></section></div>
    </main>

    <footer className="landing-footer theme-dark"><div className="landing-theme-backdrop" aria-hidden="true" /><div className="landing-container landing-footer__inner">
      <div className="landing-footer__top"><div><Brand inverse /><p>Проверяйте по первоисточнику.</p></div><nav aria-label="Ссылки в подвале"><a href="#workflow">Как это работает</a><a href="#principles">Решение инспектора</a><a href="#questions">Вопросы о сервисе</a></nav></div>
      <div className="landing-footer__utility"><span>Проверка строительной документации</span><ColorModeControl mode={colorMode} onChange={onColorModeChange} /></div>
      <div className="landing-footer__glassmark" aria-hidden="true"><span className="landing-footer__glassmark-symbol"><i /><i /><i /></span><span className="landing-footer__glassmark-text">{glassWordmark.map(([letter, inset, width], index) => <span key={index} className="landing-footer__glassmark-letter" data-text={letter} style={{ width: `${width}em`, textIndent: `-${inset}em` }}>{letter}</span>)}</span></div>
    </div></footer>
  </div>;
}
