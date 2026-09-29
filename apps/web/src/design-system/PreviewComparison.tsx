import { useEffect, useState } from "react";
import type { Finding } from "@inspector-ai/contracts";
import { SourceImage } from "./SourceImage";
import { PreviewDocumentHeader } from "./PreviewDocumentHeader";

type PreviewSource = Finding["evidence"][number];
type PreviewPair = {
  key: string;
  finding: Finding;
  sources: PreviewSource[];
  ready: boolean[];
};

export function getPreviewSources(evidence: Finding["evidence"]) {
  const project = evidence.find(source => source.stage === "PD" && source.imageUrl);
  const working = evidence.find(source => source.stage === "RD" && source.imageUrl);
  return project && working ? [project, working] : [];
}

function pairKey(finding: Finding) {
  return JSON.stringify([
    finding.id, finding.expectedValue, finding.actualValue,
    ...getPreviewSources(finding.evidence).map(source => [source.fileId, source.imageUrl, source.pdfPageNumber]),
  ]);
}

function createPair(finding: Finding): PreviewPair {
  const sources = getPreviewSources(finding.evidence);
  return { key: pairKey(finding), finding, sources, ready: sources.map(() => false) };
}

/** Keeps the previous two sheets visible until both new sheets have loaded. */
export function PreviewComparison({ finding }: { finding: Finding }) {
  const [slots, setSlots] = useState<[PreviewPair | null, PreviewPair | null]>(() => [createPair(finding), null]);
  const [active, setActive] = useState(0);
  const requestedKey = pairKey(finding);
  const shownKey = slots[active]?.key;

  useEffect(() => {
    if (shownKey === requestedKey) return;
    const waiting = 1 - active;
    if (slots[waiting]?.key === requestedKey) return;
    setSlots(current => {
      if (current[active]?.key === requestedKey || current[waiting]?.key === requestedKey) return current;
      const next: [PreviewPair | null, PreviewPair | null] = [...current];
      next[waiting] = createPair(finding);
      return next;
    });
  }, [active, finding, requestedKey, shownKey, slots]);

  useEffect(() => {
    if (shownKey === requestedKey) return;
    const waiting = 1 - active;
    const next = slots[waiting];
    if (next?.key !== requestedKey || next.ready.length !== 2 || !next.ready.every(Boolean)) return;
    const frame = window.requestAnimationFrame(() => setActive(waiting));
    return () => window.cancelAnimationFrame(frame);
  }, [active, requestedKey, shownKey, slots]);

  const markReady = (slotIndex: number, sourceIndex: number, key: string) => {
    setSlots(current => {
      const pair = current[slotIndex];
      if (!pair || pair.key !== key || pair.ready[sourceIndex]) return current;
      const next: [PreviewPair | null, PreviewPair | null] = [...current];
      const ready = [...pair.ready];
      ready[sourceIndex] = true;
      next[slotIndex] = { ...pair, ready };
      return next;
    });
  };

  return <div className="preview-comparison" aria-busy={shownKey !== requestedKey}>
    {slots.map((pair, slotIndex) => pair && <div key={slotIndex} className={"preview-comparison__layer" + (slotIndex === active ? " is-active" : "")} aria-hidden={slotIndex !== active} inert={slotIndex !== active}>
      {pair.sources.map((source, sourceIndex) => <article className="preview-document" key={pair.key + source.fileId}>
        <PreviewDocumentHeader source={source} />
        <div className="preview-drawing">
          <SourceImage src={source.imageUrl} alt={source.stage + ": " + source.fileName + ", страница PDF " + source.pdfPageNumber} loading="eager" onLoad={() => markReady(slotIndex, sourceIndex, pair.key)} onError={() => markReady(slotIndex, sourceIndex, pair.key)} />
          <span className="preview-drawing__label">Фрагмент листа</span>
        </div>
        <footer><span>{sourceIndex === 0 ? "По проекту" : "В рабочей документации"}</span><p>{sourceIndex === 0 ? pair.finding.expectedValue : pair.finding.actualValue}</p></footer>
      </article>)}
    </div>)}
  </div>;
}
