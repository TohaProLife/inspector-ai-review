import { pythonExecutable, pythonEnv, projectRoot } from "./python.js";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyReviewCandidates } from "../src/review-candidates.js";

const script = String.raw`
import json
from services.worker.tests.test_run_candidate_family_preview import source, artifact, candidate_line, MANIFEST, OBJECT, digest
from inspector_worker.review_candidates import evaluate_review_candidates
a=source('PD-SOURCE', 'PZ'); a['revisionStatus']='UNKNOWN'; a['approvalStatus']='UNKNOWN'
b=source('RD-SOURCE', 'PZ', stage='RD'); b['revisionStatus']='UNKNOWN'; b['approvalStatus']='UNKNOWN'
x=artifact(a,[candidate_line('PZ-002')])
y=artifact(b,[candidate_line('PZ-002').replace('42', '43')])
result=evaluate_review_candidates(OBJECT,MANIFEST,[a,b],[x,y])
print(json.dumps({'input':{'objectId':OBJECT,'inputManifestHash':MANIFEST,
  'sourceFiles':[{'sourceFileId':s['sourceFileId'],'objectId':OBJECT,'sha256':s['sha256'],
    'stages':s['stages'],'sectionCode':s['sectionCode'],'sourceReviewHash':None} for s in [a,b]],
  'sourceReviews':{},'textArtifacts':{s['sourceFileId']:{'content_json':t,'content_hash':digest(t)}
    for s,t in [(a,x),(b,y)]},'result':result}},ensure_ascii=False))
`;

function fixture(pythonScript = script) {
  const output = execFileSync(pythonExecutable, ["-c", pythonScript], {
    cwd: projectRoot,
    env: { ...process.env, ...pythonEnv, PYTHONPATH: "services/worker" }, encoding: "utf8",
  });
  return JSON.parse(output).input;
}

function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) =>
      `${JSON.stringify(key)}:${workerJson(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash("sha256").update(workerJson(value)).digest("hex");

describe("review candidates", () => {
  it("verifies exact fire-road, electrical and estimate topic lines as unconfirmed review leads", () => {
    const topicScript = String.raw`
import json
from services.worker.tests.test_run_candidate_family_preview import source, artifact, MANIFEST, OBJECT, digest
from inspector_worker.review_candidates import evaluate_review_candidates
a=source('PD-EOM', 'EOM'); a['revisionStatus']='UNKNOWN'; a['approvalStatus']='UNKNOWN'
b=source('PD-SM', 'SM'); b['revisionStatus']='UNKNOWN'; b['approvalStatus']='UNKNOWN'
c=source('PD-SPZU', 'SPZU'); c['revisionStatus']='UNKNOWN'; c['approvalStatus']='UNKNOWN'
x=artifact(a,['Номинальный ток защитных автоматов необходимо определить'])
y=artifact(b,['Часть 1. Сводный сметный расчет.'])
z=artifact(c,['− выявить обеспеченность проектируемого объекта проездами и подъездами, удовлетворяющими габаритам и радиусам поворота ПППМ;'])
result=evaluate_review_candidates(OBJECT,MANIFEST,[a,b,c],[x,y,z])
print(json.dumps({'input':{'objectId':OBJECT,'inputManifestHash':MANIFEST,
  'sourceFiles':[{'sourceFileId':s['sourceFileId'],'objectId':OBJECT,'sha256':s['sha256'],
    'stages':s['stages'],'sectionCode':s['sectionCode'],'sourceReviewHash':None} for s in [a,b,c]],
  'sourceReviews':{},'textArtifacts':{s['sourceFileId']:{'content_json':t,'content_hash':digest(t)}
    for s,t in [(a,x),(b,y),(c,z)]},'result':result}},ensure_ascii=False))
`;
    const input = fixture(topicScript);
    expect(input.result.candidates.map((row: { parameterCode: string }) => row.parameterCode).sort())
      .toEqual(["IOS1-068", "SM-132", "SPZU-031"]);
    expect(input.result.candidates.every((row: { kind: string }) => row.kind === "ONE_DOCUMENT_SIGNAL"))
      .toBe(true);
    expect(verifyReviewCandidates(input)).toBe(true);
  });

  it("accepts exact public-style unreviewed lines and tentative differences", () => {
    const input = fixture();
    expect(input.result.candidateCount).toBe(2);
    expect(input.result.candidates.every((row: { kind: string }) =>
      row.kind === "POSSIBLE_DIFFERENCE")).toBe(true);
    expect(verifyReviewCandidates(input)).toBe(true);
  });

  it("rejects changed source, line, locator, relation, and result type", () => {
    const original = fixture();
    for (const mutate of [
      (value: typeof original) => { value.sourceFiles[0].sha256 = "0".repeat(64); },
      (value: typeof original) => { value.result.candidates[0].lineText = "Подменённая строка"; },
      (value: typeof original) => { value.result.candidates[0].locator.blockIndex = 100; },
      (value: typeof original) => { value.result.candidates[0].relatedDocuments[0].pageNumber = 999; },
      (value: typeof original) => { value.result.resultType = "FINDING"; },
    ]) {
      const changed = structuredClone(original);
      mutate(changed);
      expect(verifyReviewCandidates(changed)).toBe(false);
    }
  });

  it("rejects a locator moved to another page even after all candidate hashes are recomputed", () => {
    const changed = fixture();
    const { contentHash: originalHash, ...original } = changed.result;
    expect(digest(original)).toBe(originalHash);
    const { candidateId: originalCandidateId, ...originalCandidate } = changed.result.candidates[0];
    expect(digest(originalCandidate)).toBe(originalCandidateId);
    changed.result.candidates[0].pageNumber = 2;
    const { candidateId: _id, ...candidate } = changed.result.candidates[0];
    changed.result.candidates[0].candidateId = digest(candidate);
    const { contentHash: _hash, ...result } = changed.result;
    changed.result.contentHash = digest(result);
    expect(verifyReviewCandidates(changed)).toBe(false);
  });

  it("rejects a reordered equal-rank list after the artifact hash is recomputed", () => {
    const changed = fixture();
    changed.result.candidates.reverse();
    const { contentHash: _hash, ...result } = changed.result;
    changed.result.contentHash = digest(result);
    expect(verifyReviewCandidates(changed)).toBe(false);
  });

  it("does not suggest a document pair across conflicting reviewed link groups", () => {
    const pairScript = String.raw`
import json
from services.worker.tests.test_run_candidate_family_preview import source, artifact, candidate_line, MANIFEST, OBJECT
from inspector_worker.review_candidates import evaluate_review_candidates
a=source('PD-SOURCE', 'PZ'); a['linkGroupId']='group-a'
b=source('RD-SOURCE', 'PZ', stage='RD'); b['linkGroupId']='group-b'
x=artifact(a,[candidate_line('PZ-002')])
y=artifact(b,[candidate_line('PZ-002').replace('42', '43')])
result=evaluate_review_candidates(OBJECT,MANIFEST,[a,b],[x,y])
print(json.dumps([row['kind'] for row in result['candidates']]))
`;
    const output = execFileSync(pythonExecutable, ["-c", pairScript], {
      cwd: projectRoot,
      env: { ...process.env, ...pythonEnv, PYTHONPATH: "services/worker" }, encoding: "utf8",
    });
    expect(JSON.parse(output)).toEqual(["ONE_DOCUMENT_SIGNAL", "ONE_DOCUMENT_SIGNAL"]);
  });

  it("does not pair same-topic pages when section and link group are both unknown", () => {
    const unknownScript = script.replace(
      "x=artifact(a,[candidate_line('PZ-002')])",
      "a['sectionCode']=None; b['sectionCode']=None\nx=artifact(a,[candidate_line('PZ-002')])",
    );
    const input = fixture(unknownScript);
    expect(input.result.candidates.map((row: { kind: string }) => row.kind))
      .toEqual(["ONE_DOCUMENT_SIGNAL", "ONE_DOCUMENT_SIGNAL"]);
    expect(verifyReviewCandidates(input)).toBe(true);
  });

  it("accepts a public warm-floor text reference without claiming an absent RD element", () => {
    const warmScript = String.raw`
import json
from services.worker.tests.test_run_candidate_family_preview import source, artifact, MANIFEST, OBJECT, digest
from inspector_worker.review_candidates import evaluate_review_candidates
a=source('PD-OV', 'OV'); a['revisionStatus']='UNKNOWN'; a['approvalStatus']='UNKNOWN'
x=artifact(a,['Регулятор для системы “теплый пол”'])
result=evaluate_review_candidates(OBJECT,MANIFEST,[a],[x])
print(json.dumps({'input':{'objectId':OBJECT,'inputManifestHash':MANIFEST,
  'sourceFiles':[{'sourceFileId':a['sourceFileId'],'objectId':OBJECT,'sha256':a['sha256'],
    'stages':a['stages'],'sectionCode':'OV','sourceReviewHash':None}],
  'sourceReviews':{},'textArtifacts':{a['sourceFileId']:{'content_json':x,'content_hash':digest(x)}},
  'result':result}},ensure_ascii=False))
`;
    const input = fixture(warmScript);
    expect(input.result.candidateCount).toBe(1);
    expect(input.result.candidates[0]).toMatchObject({
      parameterCode: "FREE-HEATING-001", kind: "ONE_DOCUMENT_SIGNAL",
      rawValue: "теплый пол", suggestedElement: null,
    });
    expect(verifyReviewCandidates(input)).toBe(true);
  });

  it("keeps an HVAC sheet title as a topic cue with explicit missing comparison", () => {
    const topicScript = String.raw`
import json
from services.worker.tests.test_run_candidate_family_preview import source, artifact, MANIFEST, OBJECT, digest
from inspector_worker.review_candidates import evaluate_review_candidates
a=source('PD-OV', 'OV'); a['revisionStatus']='UNKNOWN'; a['approvalStatus']='UNKNOWN'
x=artifact(a,['Принципиальная схема систем общеобменной вентиляции (продолжение №3)'])
result=evaluate_review_candidates(OBJECT,MANIFEST,[a],[x])
print(json.dumps({'input':{'objectId':OBJECT,'inputManifestHash':MANIFEST,
  'sourceFiles':[{'sourceFileId':a['sourceFileId'],'objectId':OBJECT,'sha256':a['sha256'],
    'stages':a['stages'],'sectionCode':'OV','sourceReviewHash':None}],
  'sourceReviews':{},'textArtifacts':{a['sourceFileId']:{'content_json':x,'content_hash':digest(x)}},
  'result':result}},ensure_ascii=False))
`;
    const input = fixture(topicScript);
    expect(input.result.candidateCount).toBe(1);
    expect(input.result.candidates[0]).toMatchObject({
      parameterCode: "IOS4-078", reason: "PAGE_TOPIC_LINE",
      missingConfirmation: expect.arrayContaining([
        "PAGE_TOPIC_NOT_COMPARISON", "CODE_MAPPING_NOT_CONFIRMED",
      ]),
    });
    expect(verifyReviewCandidates(input)).toBe(true);
  });

  it("keeps a literal structural fire class line from a public page", () => {
    const classScript = String.raw`
import json
from services.worker.tests.test_run_candidate_family_preview import source, artifact, MANIFEST, OBJECT, digest
from inspector_worker.review_candidates import evaluate_review_candidates
a=source('PD-PZ', 'PZ'); a['revisionStatus']='UNKNOWN'; a['approvalStatus']='UNKNOWN'
x=artifact(a,['класс конструктивной пожарной опасности здания – С0;'])
result=evaluate_review_candidates(OBJECT,MANIFEST,[a],[x])
print(json.dumps({'input':{'objectId':OBJECT,'inputManifestHash':MANIFEST,
  'sourceFiles':[{'sourceFileId':a['sourceFileId'],'objectId':OBJECT,'sha256':a['sha256'],
    'stages':a['stages'],'sectionCode':'PZ','sourceReviewHash':None}],
  'sourceReviews':{},'textArtifacts':{a['sourceFileId']:{'content_json':x,'content_hash':digest(x)}},
  'result':result}},ensure_ascii=False))
`;
    const input = fixture(classScript);
    expect(input.result.candidateCount).toBe(1);
    expect(input.result.candidates[0]).toMatchObject({ parameterCode: "PZ-023",
      family: "CLASS_DECREASE", rawValue: "С0", reason: "EXACT_LABEL_LINE" });
    expect(verifyReviewCandidates(input)).toBe(true);
  });

  it("keeps literal presence features with their scope and code still unconfirmed", () => {
    const featureScript = String.raw`
import json
from services.worker.tests.test_run_candidate_family_preview import source, artifact, MANIFEST, OBJECT, digest
from inspector_worker.review_candidates import evaluate_review_candidates
a=source('PD-FEATURES', 'AR'); a['revisionStatus']='UNKNOWN'; a['approvalStatus']='UNKNOWN'
x=artifact(a,['Пристенный дренаж','звукоизоляционные прокладки','Тактильные указатели','Кнопка вызова персонала\nКнопки вызова персонала','Счетчик воды'])
result=evaluate_review_candidates(OBJECT,MANIFEST,[a],[x])
print(json.dumps({'input':{'objectId':OBJECT,'inputManifestHash':MANIFEST,
  'sourceFiles':[{'sourceFileId':a['sourceFileId'],'objectId':OBJECT,'sha256':a['sha256'],
    'stages':a['stages'],'sectionCode':'AR','sourceReviewHash':None}],
  'sourceReviews':{},'textArtifacts':{a['sourceFileId']:{'content_json':x,'content_hash':digest(x)}},
  'result':result}},ensure_ascii=False))
`;
    const input = fixture(featureScript);
    expect(input.result.candidateCount).toBe(5);
    expect(input.result.candidates.map((row: { parameterCode: string }) => row.parameterCode).sort())
      .toEqual(["AR-053", "ODI-122", "ODI-123", "SPZU-039", "ZU-129"]);
    expect(input.result.candidates.every((row: { reason: string; missingConfirmation: string[] }) =>
      row.reason === "FEATURE_LABEL_LINE"
      && row.missingConfirmation.includes("SCOPE_NOT_CONFIRMED")
      && row.missingConfirmation.includes("CODE_MAPPING_NOT_CONFIRMED"))).toBe(true);
    expect(verifyReviewCandidates(input)).toBe(true);
  });

  it("keeps exact catalog topics as low-confidence navigation cues", () => {
    const catalogScript = String.raw`
import json
from services.worker.tests.test_run_candidate_family_preview import source, artifact, MANIFEST, OBJECT, digest
from inspector_worker.review_candidates import evaluate_review_candidates
a=source('PD-CATALOG', 'PZ'); a['revisionStatus']='UNKNOWN'; a['approvalStatus']='UNKNOWN'
b=source('PD-CATALOG-2', 'PZ'); b['revisionStatus']='UNKNOWN'; b['approvalStatus']='UNKNOWN'
x=artifact(a,['Площадь застройки составляет 0,14 га.',
              'Категория надежности электроснабжения насосных станций принята II.',
              'Конструкция дорожной одежды проездов для пожарной техники.',
              'Комплекс разделен на следующие пожарные отсеки:',
              'Огнестойкость дверей лифтов принята EI 60.',
              'Вертикальные фасадные элементы с вогнутой поверхностью из анодированных панелей',
              'Радиатор в помещении 270 заменен и перенесен под потолок.',
              'Установлены опорные поручни по всему пути.'])
y=artifact(b,['Строительный объем здания V=60997,93 куб.м;',
              'За относительную отметку 0,000 принята абсолютная отметка 159,95 м.',
              'Плиты перекрытия и покрытия толщиной 200 мм.',
              'Автоматическая пожарная сигнализация',
              'Размещение пожарных извещателей производится с учетом проекта.',
              'Ширина дверных проемов в стенах и перегородках.'])
result=evaluate_review_candidates(OBJECT,MANIFEST,[a,b],[x,y])
print(json.dumps({'input':{'objectId':OBJECT,'inputManifestHash':MANIFEST,
  'sourceFiles':[{'sourceFileId':s['sourceFileId'],'objectId':OBJECT,'sha256':s['sha256'],
    'stages':s['stages'],'sectionCode':'PZ','sourceReviewHash':None} for s in [a,b]],
  'sourceReviews':{},'textArtifacts':{s['sourceFileId']:{'content_json':t,'content_hash':digest(t)}
    for s,t in [(a,x),(b,y)]},
  'result':result}},ensure_ascii=False))
`;
    const input = fixture(catalogScript);
    expect(input.result.candidates.map((row: { parameterCode: string }) => row.parameterCode).sort())
      .toEqual(["AR-052", "IOS4-077", "IOS5-080", "KR-059", "ODI-117", "ODI-120", "PPM-102", "PPM-103", "PPM-108", "PZ-001", "PZ-004", "PZ-009", "PZ-015", "SPZU-032"]);
    expect(input.result.candidates.every((row: { reason: string; missingConfirmation: string[] }) =>
      row.reason === "CATALOG_TOPIC_LINE"
      && row.missingConfirmation.includes("VALUE_NOT_EXTRACTED"))).toBe(true);
    expect(verifyReviewCandidates(input)).toBe(true);
    input.result.candidates[0].parameterCode = "PZ-002";
    expect(verifyReviewCandidates(input)).toBe(false);
  });

  it("verifies additional public-page topic cues without treating them as findings", () => {
    const topicScript = String.raw`
import json
from services.worker.tests.test_run_candidate_family_preview import source, artifact, MANIFEST, OBJECT, digest
from inspector_worker.review_candidates import evaluate_review_candidates
a=source('PD-TOPIC-A', 'PZ'); b=source('PD-TOPIC-B', 'PZ')
a['revisionStatus']='UNKNOWN'; a['approvalStatus']='UNKNOWN'
b['revisionStatus']='UNKNOWN'; b['approvalStatus']='UNKNOWN'
x=artifact(a,['Тепловая нагрузка, Гкал/час',
              'Ширина эвакуационных выходов предусмотрена не менее 1,2 м.',
              'Оконный блок с повышенной звукоизоляцией.',
              'Класс пожарной опасности материала, не более указанного.',
              'Система оповещения и управления эвакуацией.'])
y=artifact(b,['Предусмотрен подпор воздуха при пожаре.',
              'Система внутреннего пожаротушения 19,0 л/с.',
              'Расход воды на наружное пожаротушение определялся по объему здания.',
              'Универсальная кабина для инвалидов.',
              'Машино-место для инвалидов группы М4.'])
result=evaluate_review_candidates(OBJECT,MANIFEST,[a,b],[x,y])
print(json.dumps({'input':{'objectId':OBJECT,'inputManifestHash':MANIFEST,
  'sourceFiles':[{'sourceFileId':s['sourceFileId'],'objectId':OBJECT,'sha256':s['sha256'],
    'stages':s['stages'],'sectionCode':'PZ','sourceReviewHash':None} for s in [a,b]],
  'sourceReviews':{},'textArtifacts':{s['sourceFileId']:{'content_json':t,'content_hash':digest(t)}
    for s,t in [(a,x),(b,y)]},'result':result}},ensure_ascii=False))
`;
    const input = fixture(topicScript);
    expect(input.result.candidates.map((row: { parameterCode: string }) => row.parameterCode).sort())
      .toEqual(["AR-041", "AR-046", "ODI-119", "ODI-121", "PPM-107", "PPM-110",
        "PPM-112", "PPM-113", "PPM-114", "PZ-017"]);
    expect(input.result.candidates.every((row: { reason: string; missingConfirmation: string[] }) =>
      row.reason === "CATALOG_TOPIC_LINE"
      && row.missingConfirmation.includes("CODE_MAPPING_NOT_CONFIRMED")
      && row.missingConfirmation.includes("VALUE_NOT_EXTRACTED"))).toBe(true);
    for (const row of input.result.candidates) {
      const single = structuredClone(input);
      single.result.candidates = [row];
      single.result.candidateCount = 1;
      const { contentHash: _old, ...unhashed } = single.result;
      single.result.contentHash = digest(unhashed);
      expect(verifyReviewCandidates(single), row.parameterCode).toBe(true);
    }
    expect(verifyReviewCandidates(input)).toBe(true);
  });

  it("verifies POS, electrical, fire and insulation topic locators independently", () => {
    const topicScript = String.raw`
import json
from services.worker.tests.test_run_candidate_family_preview import source, artifact, MANIFEST, OBJECT, digest
from inspector_worker.review_candidates import evaluate_review_candidates
a=source('PD-UTILITY', 'AR'); b=source('PD-POS', 'POS'); c=source('PD-AR-TOPICS', 'AR')
a['revisionStatus']='UNKNOWN'; a['approvalStatus']='UNKNOWN'
b['revisionStatus']='UNKNOWN'; b['approvalStatus']='UNKNOWN'
c['revisionStatus']='UNKNOWN'; c['approvalStatus']='UNKNOWN'
x=artifact(a,['Сечение проводов и кабелей распределительных сетей выбрано по расчету.',
              'Предусматривается контур защитного заземления из стальной полосы.',
              'Установлены огнезадерживающие клапаны.',
              'Линии оповещения выполняются огнестойкими кабелями.',
              'Применяются светодиодные светильники.',
              'Приняты максимальные толщины утеплителя в фасадных конструкциях.',
              'Высота потолка коридора, hк: 3,4 м.',
              'Лестницы с шириной проступи 280 мм и высотой ступени 150 мм.',
              'Высота ограждений лестниц предусматривается 1,2 м.',
              'Толщина фундаментной плиты определена по расчету, составляет 1000 мм.',
              'Толщина несущих стен назначена по расчету.',
              'Ведомость расхода материалов.'])
y=artifact(b,['Расчет опасной зоны от работы башенного крана при строительстве.',
              'Предусмотрены временные бытовые помещения.',
              'Устройство временных дорог шириной 6.0 м.',
              'Материалы размещены на площадке складирования.',
              'Технологическая последовательность работ по монтажу стальных элементов.',
              'Установка пункта мойки колес на выезде.',
              'Входные тамбуры глубиной не менее 2,45 м.',
              'Шумозащитное ограждение территории.',
              'Ширину проходов между рядами приняли не менее 0,9 м.',
              'Ширина проездов для пожарной техники составляет не менее 3,5 метра.',
              'При необходимости парковочного места для МГН используются площадки.',
              'Расчетные электрические нагрузки квартир приняты по заданию.'])
z=artifact(c,['Отделка помещений общественного назначения - Shell&Core.',
              'Проект обеспечивает естественное освещение помещений.',
              'Площадь асфальтобетонного покрытия проездов 120 м².',
              'Площадь озеленения, в том числе газоны.',
              'Универсальная спортивная площадка.',
              'Продольные уклоны по проездам составляют от 0,5 до 4%.',
              'Фундаментная плита выполнена из бетона класса В40.',
              'Бетон класса В15 применяется в покрытии проезда.',
              'Применена арматура класса A500C.',
              'Количество этажей наземной части основного здания: 3 этажа.',
              'Машино-места постоянного хранения в подземной автостоянке.',
              'Ведомость малых архитектурных форм.',
              'Проектируемая сеть принята из напорных полиэтиленовых труб ПЭ100+ SDR17 DN110.'])
result=evaluate_review_candidates(OBJECT,MANIFEST,[a,b,c],[x,y,z])
print(json.dumps({'input':{'objectId':OBJECT,'inputManifestHash':MANIFEST,
  'sourceFiles':[{'sourceFileId':s['sourceFileId'],'objectId':OBJECT,'sha256':s['sha256'],
    'stages':s['stages'],'sectionCode':s['sectionCode'],'sourceReviewHash':None} for s in [a,b,c]],
  'sourceReviews':{},'textArtifacts':{s['sourceFileId']:{'content_json':t,'content_hash':digest(t)}
    for s,t in [(a,x),(b,y),(c,z)]},'result':result}},ensure_ascii=False))
`;
    const input = fixture(topicScript);
    expect(input.result.candidates.map((row: { parameterCode: string }) => row.parameterCode).sort())
      .toEqual(["AR-042", "AR-047", "AR-048", "AR-049", "AR-050", "AR-051",
        "IOS1-069", "IOS1-070", "IOS2-072",
        "KR-055", "KR-057", "KR-058", "KR-061", "KR-067", "POS-081", "POS-083", "POS-084", "POS-085", "POS-087",
        "POS-089", "PPM-104", "PPM-109", "PPM-111", "PZ-007", "PZ-012", "PZ-014", "SPZU-025", "SPZU-027", "SPZU-028", "SPZU-029", "SPZU-030", "SPZU-033", "SPZU-036", "SPZU-038",
        "ZU-125", "ZU-130"]);
    expect(input.result.candidates.every((row: { missingConfirmation: string[] }) =>
      row.missingConfirmation.includes("VALUE_NOT_EXTRACTED"))).toBe(true);
    expect(input.result.candidates.filter((row: { parameterCode: string }) =>
      row.parameterCode === "KR-055")).toHaveLength(1);
    expect(verifyReviewCandidates(input)).toBe(true);
  });

  it("does not call two differently worded text references a difference", () => {
    const pairScript = String.raw`
import json
from services.worker.tests.test_run_candidate_family_preview import source, artifact, MANIFEST, OBJECT, digest
from inspector_worker.review_candidates import evaluate_review_candidates
a=source('PD-OV', 'OV'); b=source('RD-OV', 'OV', stage='RD')
a['revisionStatus']='UNKNOWN'; a['approvalStatus']='UNKNOWN'
b['revisionStatus']='UNKNOWN'; b['approvalStatus']='UNKNOWN'
x=artifact(a,['Регулятор для системы “теплый пол”'])
y=artifact(b,['Схема системы “теплые полы”'])
result=evaluate_review_candidates(OBJECT,MANIFEST,[a,b],[x,y])
print(json.dumps({'input':{'objectId':OBJECT,'inputManifestHash':MANIFEST,
  'sourceFiles':[{'sourceFileId':s['sourceFileId'],'objectId':OBJECT,'sha256':s['sha256'],
    'stages':s['stages'],'sectionCode':'OV','sourceReviewHash':None} for s in [a,b]],
  'sourceReviews':{},'textArtifacts':{s['sourceFileId']:{'content_json':t,'content_hash':digest(t)}
    for s,t in [(a,x),(b,y)]},'result':result}},ensure_ascii=False))
`;
    const input = fixture(pairScript);
    expect(input.result.candidates.map((row: { kind: string }) => row.kind))
      .toEqual(["POSSIBLE_PAIR", "POSSIBLE_PAIR"]);
    expect(verifyReviewCandidates(input)).toBe(true);
  });
});
