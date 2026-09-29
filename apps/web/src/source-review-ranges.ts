import type { SourcePageStage, UploadStage } from "@inspector-ai/contracts";

export function parsePageStageRanges(
  input: string,
  allowedStages: UploadStage[],
  pageCount: number,
): Record<string, SourcePageStage> {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 10000) {
    throw new Error("Число страниц исходного PDF неизвестно или слишком велико");
  }
  const result: Record<string, SourcePageStage> = {};
  for (const entry of input.split(/[,;\n]+/).map((part) => part.trim()).filter(Boolean)) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?\s*[:=]\s*(PD|RD|ID|UNRESOLVED)$/i.exec(entry);
    if (!match) throw new Error(`Неверный диапазон: ${entry}`);
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    const stage = match[3].toUpperCase() as SourcePageStage;
    if ((stage !== "UNRESOLVED" && !allowedStages.includes(stage)) || start < 1 || end < start || end > pageCount) {
      throw new Error(`Диапазон вне стадий или страниц PDF: ${entry}`);
    }
    for (let page = start; page <= end; page += 1) {
      if (result[String(page)]) throw new Error(`Страница ${page} указана дважды`);
      result[String(page)] = stage;
    }
  }
  if (Object.keys(result).length !== pageCount) {
    throw new Error(`Укажите стадию каждой страницы: ${Object.keys(result).length} из ${pageCount}`);
  }
  return result;
}

export function formatPageStageRanges(stages: Record<string, SourcePageStage>): string {
  const pages = Object.entries(stages)
    .map(([page, stage]) => ({ page: Number(page), stage }))
    .filter((entry) => Number.isSafeInteger(entry.page) && entry.page > 0)
    .sort((a, b) => a.page - b.page);
  const ranges: string[] = [];
  for (let index = 0; index < pages.length;) {
    let end = index;
    while (end + 1 < pages.length
      && pages[end + 1].page === pages[end].page + 1
      && pages[end + 1].stage === pages[index].stage) end += 1;
    ranges.push(`${pages[index].page}${end > index ? `-${pages[end].page}` : ""}=${pages[index].stage}`);
    index = end + 1;
  }
  return ranges.join(", ");
}
