import { canonicalJson, sha256 } from "./canonical-json.js";
import { candidateFamilyPreviewSpecs, validNumericLine,
  type CandidateFamilyPreviewVerificationInput } from "./candidate-family-preview.js";

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => value !== null
  && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === "string"
  && /^[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, min = 0): value is number =>
  Number.isSafeInteger(value) && Number(value) >= min;
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const exact = (value: Json, fields: string[]) => same(Object.keys(value).sort(), fields.sort());
// Python json.dumps(sort_keys=True) uses code-point order.
function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${workerJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) => sha256(workerJson(value));
const candidateFields = ["schemaVersion", "resultType", "kind", "reason", "parameterCode",
  "family", "attribute", "matchedLabel", "rawValue", "rawUnit", "sourceFileId",
  "sourceSha256", "artifactSha256", "pageNumber", "pageWidthMilliPoints",
  "pageHeightMilliPoints", "stage", "sectionCode",
  "revisionStatus", "approvalStatus", "origin", "lineText", "blockTextSha256",
  "locator", "relatedDocuments", "missingConfirmation", "suggestedElement", "rank", "candidateId"];
const relatedFields = ["sourceFileId", "sourceSha256", "parameterCode", "attribute",
  "matchedLabel", "pageNumber", "pageWidthMilliPoints", "pageHeightMilliPoints",
  "rawValue", "rawUnit", "lineText", "artifactSha256",
  "blockTextSha256", "locator"];
const locatorFields = ["kind", "blockIndex", "lineIndex", "start", "end", "bboxMilliPoints"];
const numericFamilies = new Set(["DECREASE", "INCREASE", "DIFFERENT", "RELATIVE_DELTA",
  "RELATIVE_INCREASE", "LOWER_BOUND", "UPPER_BOUND"]);
const presenceFeatureCues: Record<string, { attribute: string; pattern: RegExp }> = {
  "SPZU-039": { attribute: "DRAINAGE_MEASURE_SET",
    pattern: /^пристенн[\p{L}\p{N}_]*\s+дренаж[\p{L}\p{N}_]*$/iu },
  "AR-053": { attribute: "NOISE_PROTECTION_MEASURE_SET",
    pattern: /^звукоизоляционн[\p{L}\p{N}_]*\s+прокладк[\p{L}\p{N}_]*$/iu },
  "ODI-122": { attribute: "TACTILE_WARNING_SET",
    pattern: /^тактильн[\p{L}\p{N}_]*\s+указател[\p{L}\p{N}_]*$/iu },
  "ODI-123": { attribute: "ASSISTANCE_CALL_SYSTEM_SET",
    pattern: /^(?:кнопк[\p{L}\p{N}_]*\s+вызов[\p{L}\p{N}_]*\s+персонал[\p{L}\p{N}_]*|систем[\p{L}\p{N}_]*\s+дву(?:х)?сторонн[\p{L}\p{N}_]*\s+связ[\p{L}\p{N}_]*)$/iu },
  "ZU-129": { attribute: "ENERGY_METER_SET",
    pattern: /^(?:сч[её]тчик[\p{L}\p{N}_]*\s+вод[\p{L}\p{N}_]*|водосч[её]тчик[\p{L}\p{N}_]*)$/iu },
};
const catalogTopicCues: Record<string, RegExp> = {
  "SPZU-031": /^радиусам\s+поворота\s+ПППМ$/iu,
  "IOS1-068": /^Номинальн[\p{L}\p{N}_]*\s+ток[\p{L}\p{N}_]*\s+защитн[\p{L}\p{N}_]*\s+автомат[\p{L}\p{N}_]*$/iu,
  "SM-132": /^Сводн[\p{L}\p{N}_]*\s+сметн[\p{L}\p{N}_]*\s+расч[её]т$/iu,
  "PPM-105": /^выхода?\s+\(В2\s+и\s+В3\)\s+в\s+осях\s+15-17\s+по\s+оси\s+М\s+ширина\s+каждого\s+1[,.]3\s+м$/iu,
  "KR-064": /^В\s+осях\s+\d+\/[А-ЯA-Z]\s+расположена\s+шахта\s+лифта$/iu,
  "IOS4-076": /^ТС\s+Т1,Т2\s*-\s*2Д\d+\/\d+$/iu,
  "SPZU-035": /^в\s+охранной\s+зоне\s+газопровода\s+\(2м\s+в\s+обе\s+стороны\)$/iu,
  "AR-043": /^открываются\s+по\s+направлению\s+выхода\s+из\s+здания$/iu,
  "PZ-021": /^эффективности\s+не\s+определяется$/iu,
  "ZU-126": /^0[,.]045$/iu,
  "ZU-127": /^0[,.]65$/iu,
  "ZU-128": /^150$/iu,
  "SPZU-026": /^Площадь\s+твердых\s+покрытий$/iu,
  "SPZU-037": /^Проектом\s+не\s+предусматриваются\s+парковочные\s+места\s+на\s+территории$/iu,
  "PPM-106": /^по\s+направлению\s+выхода\s+из\s+здания$/iu,
  "AR-040": /^Ширина\s+горизонтальных\s+участков\s+путей\s+эвакуации$/iu,
  "PZ-016": /^Суммарный\s+расчетный\s+расход\s+воды\s+на\s+здания\s+\d+[,.]\d+\s+м3\/сут$/iu,
  "ODI-118": /^Высота\s+порогов\s+или\s+перепад\s+высот\s+не\s+превышает\s+0[,.]014\s+м$/iu,
  "IOS2-073": /^COR-3\s+MVL\s+\d+\/SKw-MB-PN25-EB-R$/iu,
  "IOS3-074": /^по\s+выпускам\s+из\s+труб\s+ВЧШГ\s+диаметром\s+\d+$/iu,
  "SPZU-034": /^проектируемый\s+колодец\s+на\s+канализационной\s+сети\s+Д=150мм$/iu,
  "AR-045": /^Отвод\s+дождев[\p{L}\p{N}_]*\s+и\s+тал[\p{L}\p{N}_]*\s+вод\s+с\s+кровл[\p{L}\p{N}_]*\s+здани[\p{L}\p{N}_]*\s+осуществляется\s+через\s+водосточн[\p{L}\p{N}_]*\s+воронк[\p{L}\p{N}_]*$/iu,
  "KR-060": /^колонн[\p{L}\p{N}_]*\s+с\s+сечени[\p{L}\p{N}_]*$/iu,
  "KR-065": /^отверсти[\p{L}\p{N}_]*\s+в\s+перекрыти[\p{L}\p{N}_]*\s+под\s+вентиляционн[\p{L}\p{N}_]*\s+шахт[\p{L}\p{N}_]*$/iu,
  "PZ-005": /^подземная\s+часть,\s+в\s+т\.ч\.$/iu,
  "PZ-006": /^наземная\s+часть,\s+в\s+т\.ч\.$/iu,
  "PZ-011": /^Количество\s+квартир[\p{L}\p{N}_]*$/iu,
  "POS-086": /^Обоснование\s+потребност[\p{L}\p{N}_]*\s+строительств[\p{L}\p{N}_]*\s+в\s+рабоч[\p{L}\p{N}_]*\s+кадрах$/iu,
  "POS-088": /^Общая\s+потребляемая\s+мощность\s+на\s+период\s+строительств[\p{L}\p{N}_]*$/iu,
  "KR-056": /^из\s+стали\s+[СC]\s*245\s+по\s+ГОСТ$/iu,
  "KR-066": /^сварн[\p{L}\p{N}_]*\s+шв[\p{L}\p{N}_]*\s+обработать\s+антикоррозийн[\p{L}\p{N}_]*\s+состав[\p{L}\p{N}_]*$/iu,
  "PZ-003": /^Расчетн[\p{L}\p{N}_]*\s+площад[\p{L}\p{N}_]*\s+здани[\p{L}\p{N}_]*$/iu,
  "PZ-010": /^Количество\s+квартир[\p{L}\p{N}_]*$/iu,
  "PZ-013": /^Вместимость\s+обеденн[\p{L}\p{N}_]*\s+зал[\p{L}\p{N}_]*\s+на\s+\d+\s+посадочн[\p{L}\p{N}_]*\s+мест$/iu,
  "AR-044": /^ТН-Кровля\s+Стандарт(?:\s+Терраса)?$/iu,
  "KR-063": /^тип\s+всех\s+сварн[\p{L}\p{N}_]*\s+соединени[\p{L}\p{N}_]*\s+К1-Кт$/iu,
  "IOS3-075": /^полипропиленов[\p{L}\p{N}_]*\s+канализационн[\p{L}\p{N}_]*\s+труб[\p{L}\p{N}_]*$/iu,
  "POS-082": /^Продолжительност[\p{L}\p{N}_]*\s+строительств[\p{L}\p{N}_]*\s+надземн[\p{L}\p{N}_]*\s+част[\p{L}\p{N}_]*$/iu,
  "ODI-116": /^Ширин[\p{L}\p{N}_]*\s+пут[\p{L}\p{N}_]*\s+движени[\p{L}\p{N}_]*\s+по\s+коридор[\p{L}\p{N}_]*$/iu,
  "ZU-124": /^Класс\s+энергосбережени[\p{L}\p{N}_]*$/iu,
  "ZU-131": /^Удельн[\p{L}\p{N}_]*\s+расход[\p{L}\p{N}_]*\s+теплов[\p{L}\p{N}_]*\s+энерги[\p{L}\p{N}_]*\s+на$/iu,
  "PZ-007": /^количеств[\p{L}\p{N}_]*\s+этаж[\p{L}\p{N}_]*\s+наземн[\p{L}\p{N}_]*\s+част[\p{L}\p{N}_]*$/iu,
  "PZ-012": /^машино.?мест[\p{L}\p{N}_]*\s+постоянн[\p{L}\p{N}_]*\s+хранени[\p{L}\p{N}_]*\s+в\s+подземн[\p{L}\p{N}_]*\s+автостоянк[\p{L}\p{N}_]*$/iu,
  "SPZU-029": /^ведомост[\p{L}\p{N}_]*\s+мал[\p{L}\p{N}_]*\s+архитектурн[\p{L}\p{N}_]*\s+форм[\p{L}\p{N}_]*$/iu,
  "IOS2-072": /^напорн[\p{L}\p{N}_]*\s+полиэтиленов[\p{L}\p{N}_]*\s+труб[\p{L}\p{N}_]*\s+ПЭ\s*100\+?$/iu,
  "SPZU-025": /^площадь\s+асфальтобетонн[\p{L}\p{N}_]*\s+покрыти[\p{L}\p{N}_]*\s+проезд[\p{L}\p{N}_]*$/iu,
  "SPZU-027": /^площадь\s+озеленени[\p{L}\p{N}_]*$/iu,
  "SPZU-028": /^универсальн[\p{L}\p{N}_]*\s+спортивн[\p{L}\p{N}_]*\s+площадк[\p{L}\p{N}_]*$/iu,
  "SPZU-033": /^(?:продольн[\p{L}\p{N}_]*|поперечн[\p{L}\p{N}_]*)\s+уклон[\p{L}\p{N}_]*\s+по\s+проезд[\p{L}\p{N}_]*$/iu,
  "KR-055": /^(?:фундаментн[\p{L}\p{N}_]*\s+плит[\p{L}\p{N}_]*|несущ[\p{L}\p{N}_]*\s+железобетонн[\p{L}\p{N}_]*\s+конструкц[\p{L}\p{N}_]*|ж\/б.{0,35}стен[\p{L}\p{N}_]*\s+в\s+грунт[\p{L}\p{N}_]*).{0,180}?бетон[\p{L}\p{N}_]*\s+класс[\p{L}\p{N}_]*\s+[ВB]\s*\d{2}$/iu,
  "KR-057": /^арматур[\p{L}\p{N}_]*\s+класса\s+[АA]\s*(?:240|400|500)\s*[СC]?$/iu,
  "PZ-001": /^площадь\s+застройки$/iu,
  "PZ-015": /^категори[\p{L}\p{N}_]*\s+надежност[\p{L}\p{N}_]*\s+электроснабжен[\p{L}\p{N}_]*$/iu,
  "SPZU-032": /^конструкци[\p{L}\p{N}_]*\s+дорожн[\p{L}\p{N}_]*\s+одежд[\p{L}\p{N}_]*$/iu,
  "SPZU-030": /^ширин[\p{L}\p{N}_]*\s+проезд[\p{L}\p{N}_]*\s+для\s+пожарн[\p{L}\p{N}_]*\s+техник[\p{L}\p{N}_]*$/iu,
  "PPM-102": /^(?:разделен[\p{L}\p{N}_]*\s+на\s+следующ[\p{L}\p{N}_]*|разделени[\p{L}\p{N}_]*\s+на)\s+пожарн[\p{L}\p{N}_]*\s+отсек[\p{L}\p{N}_]*$/iu,
  "PPM-104": /^ширин[\p{L}\p{N}_]*\s+проход[\p{L}\p{N}_]*\s+между\s+рядами$/iu,
  "PPM-103": /^(?:огнестойкост[\p{L}\p{N}_]*|предел[\p{L}\p{N}_]*\s+огнестойкост[\p{L}\p{N}_]*)\s+двер[\p{L}\p{N}_]*$/iu,
  "AR-052": /^фасадн[\p{L}\p{N}_]*\s+элемент[\p{L}\p{N}_]*.{0,80}анодированн[\p{L}\p{N}_]*$/iu,
  "IOS4-077": /^радиатор\s+в\s+помещении\s+\d+\s+заменен[\p{L}\p{N}_]*$/iu,
  "ODI-120": /^опорн[\p{L}\p{N}_]*\s+поручн[\p{L}\p{N}_]*$/iu,
  "PZ-004": /^строительн[\p{L}\p{N}_]*\s+объем[\p{L}\p{N}_]*\s+здания$/iu,
  "PZ-009": /^относительн[\p{L}\p{N}_]*\s+отметк[\p{L}\p{N}_]*\s+0[,.]000\s+принят[\p{L}\p{N}_]*\s+(?:абсолютн[\p{L}\p{N}_]*\s+отметк[\p{L}\p{N}_]*|абс\.\s*отм\.)$/iu,
  "KR-059": /^плит[\p{L}\p{N}_]*\s+перекрытия\s+и\s+покрытия\s+толщиной$/iu,
  "IOS5-080": /^(?:автоматическ[\p{L}\p{N}_]*|систем[\p{L}\p{N}_]*)\s+пожарн[\p{L}\p{N}_]*\s+сигнализац[\p{L}\p{N}_]*$/iu,
  "PPM-108": /^(?:проектн[\p{L}\p{N}_]*\s+расположен[\p{L}\p{N}_]*|размещен[\p{L}\p{N}_]*)\s+пожарн[\p{L}\p{N}_]*\s+извещател[\p{L}\p{N}_]*$/iu,
  "ODI-117": /^ширин[\p{L}\p{N}_]*\s+дверн[\p{L}\p{N}_]*\s+про[её]м[\p{L}\p{N}_]*$/iu,
  "PZ-017": /^теплов[\p{L}\p{N}_]*\s+нагрузк[\p{L}\p{N}_]*$/iu,
  "AR-041": /^ширин[\p{L}\p{N}_]*\s+эвакуационн[\p{L}\p{N}_]*\s+выход[\p{L}\p{N}_]*$/iu,
  "AR-046": /^оконн[\p{L}\p{N}_]*\s+блок[\p{L}\p{N}_]*$/iu,
  "PPM-107": /^класс[\p{L}\p{N}_]*\s+пожарн[\p{L}\p{N}_]*\s+опасност[\p{L}\p{N}_]*\s+материал[\p{L}\p{N}_]*$/iu,
  "PPM-110": /^систем[\p{L}\p{N}_]*\s+оповещен[\p{L}\p{N}_]*\s+и\s+управлен[\p{L}\p{N}_]*$/iu,
  "PPM-112": /^подпор[\p{L}\p{N}_]*\s+воздух[\p{L}\p{N}_]*\s+при\s+пожар[\p{L}\p{N}_]*$/iu,
  "PPM-113": /^(?:систем[\p{L}\p{N}_]*\s+)?внутренн[\p{L}\p{N}_]*\s+пожаротушен[\p{L}\p{N}_]*$/iu,
  "PPM-114": /^расход[\p{L}\p{N}_]*\s+вод[\p{L}\p{N}_]*\s+на\s+наружн[\p{L}\p{N}_]*\s+пожаротушен[\p{L}\p{N}_]*$/iu,
  "ODI-119": /^универсальн[\p{L}\p{N}_]*\s+кабин[\p{L}\p{N}_]*\s+для\s+инвалид[\p{L}\p{N}_]*$/iu,
  "ODI-121": /^машино.?мест[\p{L}\p{N}_]*\s+для\s+инвалид[\p{L}\p{N}_]*$/iu,
  "IOS1-069": /^сечени[\p{L}\p{N}_]*\s+(?:провод[\p{L}\p{N}_]*\s+и\s+)?кабел[\p{L}\p{N}_]*$/iu,
  "IOS1-070": /^контур[\p{L}\p{N}_]*\s+(?:защитн[\p{L}\p{N}_]*\s+)?заземлен[\p{L}\p{N}_]*$/iu,
  "PPM-111": /^огнезадерживающ[\p{L}\p{N}_]*\s+клапан[\p{L}\p{N}_]*$/iu,
  "PPM-109": /^огнестойк(?:ими|им|их|ого|ие|ий)\s+кабел[\p{L}\p{N}_]*$/iu,
  "ZU-125": /^толщин[\p{L}\p{N}_]*\s+утеплител[\p{L}\p{N}_]*$/iu,
  "ZU-130": /^светодиодн[\p{L}\p{N}_]*\s+светильник[\p{L}\p{N}_]*$/iu,
  "POS-081": /^опасн[\p{L}\p{N}_]*\s+зон[\p{L}\p{N}_]*.{0,45}(?:башенн[\p{L}\p{N}_]*\s+)?кран[\p{L}\p{N}_]*$/iu,
  "POS-083": /^(?:временн[\p{L}\p{N}_]*\s+бытов[\p{L}\p{N}_]*\s+помещен[\p{L}\p{N}_]*|бытов[\p{L}\p{N}_]*\s+город[\p{L}\p{N}_]*)$/iu,
  "POS-084": /^временн[\p{L}\p{N}_]*\s+(?:авто)?дорог[\p{L}\p{N}_]*\s+ширин[\p{L}\p{N}_]*$/iu,
  "POS-085": /^площадк[\p{L}\p{N}_]*\s+складирован[\p{L}\p{N}_]*$/iu,
  "POS-087": /^технологическ[\p{L}\p{N}_]*\s+последовательн[\p{L}\p{N}_]*\s+работ[\p{L}\p{N}_]*\s+по\s+монтаж[\p{L}\p{N}_]*$/iu,
  "POS-089": /^мойк[\p{L}\p{N}_]*\s+кол[её]с[\p{L}\p{N}_]*$/iu,
  "AR-042": /^высот[\p{L}\p{N}_]*\s+потолк[\p{L}\p{N}_]*\s+коридор[\p{L}\p{N}_]*$/iu,
  "AR-047": /^входн[\p{L}\p{N}_]*\s+тамбур[\p{L}\p{N}_]*\s+глубин[\p{L}\p{N}_]*$/iu,
  "AR-048": /^ширин[\p{L}\p{N}_]*\s+проступ[\p{L}\p{N}_]*.{0,60}высот[\p{L}\p{N}_]*\s+ступен[\p{L}\p{N}_]*$/iu,
  "SPZU-036": /^шумозащитн[\p{L}\p{N}_]*\s+огражден[\p{L}\p{N}_]*$/iu,
  "SPZU-038": /^парковочн[\p{L}\p{N}_]*\s+мест[\p{L}\p{N}_]*\s+для\s+мгн$/iu,
  "AR-049": /^высот[\p{L}\p{N}_]*\s+огражден[\p{L}\p{N}_]*\s+лестниц[\p{L}\p{N}_]*$/iu,
  "KR-061": /^толщин[\p{L}\p{N}_]*\s+несущ[\p{L}\p{N}_]*\s+стен[\p{L}\p{N}_]*$/iu,
  "KR-058": /^толщин[\p{L}\p{N}_]*\s+фундаментн[\p{L}\p{N}_]*\s+плит[\p{L}\p{N}_]*$/iu,
  "KR-067": /^ведомост[\p{L}\p{N}_]*\s+расход[\p{L}\p{N}_]*\s+материал[\p{L}\p{N}_]*$/iu,
  "PZ-014": /^расчетн[\p{L}\p{N}_]*\s+электрическ[\p{L}\p{N}_]*\s+нагрузк[\p{L}\p{N}_]*$/iu,
  "AR-050": /^отделк[\p{L}\p{N}_]*\s+помещен[\p{L}\p{N}_]*\s+общественн[\p{L}\p{N}_]*\s+назначен[\p{L}\p{N}_]*$/iu,
  "AR-051": /^естественн[\p{L}\p{N}_]*\s+освещен[\p{L}\p{N}_]*\s+помещен[\p{L}\p{N}_]*$/iu,
};

function lines(text: string): Array<{ text: string; start: number }> {
  const parts = text.match(/.*(?:\r\n|[\n\r]|$)/gu) ?? [];
  const result: Array<{ text: string; start: number }> = [];
  let start = 0;
  for (const part of parts) {
    if (!part) continue;
    result.push({ text: part.replace(/[\r\n]+$/u, ""), start });
    start += Array.from(part).length;
  }
  return result;
}

export interface ReviewCandidatesVerificationInput
  extends Omit<CandidateFamilyPreviewVerificationInput, "result"> { result: unknown }

function verifiedLine(row: Json, input: ReviewCandidatesVerificationInput,
  artifactHashes: Map<string, string>): boolean {
  const source = input.sourceFiles.find((item) => item.sourceFileId === row.sourceFileId);
  const stored = input.textArtifacts[String(row.sourceFileId)];
  if (!source || source.objectId !== input.objectId || source.sha256 !== row.sourceSha256
    || !stored || !hash(row.artifactSha256) || stored.content_hash !== row.artifactSha256
    || (() => {
      const key = String(row.sourceFileId);
      if (!artifactHashes.has(key)) artifactHashes.set(key, digest(stored.content_json));
      return artifactHashes.get(key) !== row.artifactSha256;
    })() || !record(stored.content_json)
    || stored.content_json.schemaVersion !== "document-text-v2"
    || stored.content_json.sourceFileId !== source.sourceFileId
    || stored.content_json.inputSha256 !== source.sha256
    || !Array.isArray(stored.content_json.pages) || !integer(row.pageNumber, 1)
    || !record(row.locator) || !exact(row.locator, locatorFields)
    || row.locator.kind !== "DOCUMENT_TEXT_BLOCK_LINE"
    || !integer(row.locator.blockIndex) || !integer(row.locator.lineIndex)
    || !integer(row.locator.start) || !integer(row.locator.end, 1)
    || Number(row.locator.end) <= Number(row.locator.start)) return false;
  const page = stored.content_json.pages[Number(row.pageNumber) - 1];
  if (!record(page) || page.pageNumber !== row.pageNumber || !record(page.quality)
    || page.quality.disposition !== "TEXT_LAYER_CANDIDATE" || !Array.isArray(page.blocks)
    || row.pageWidthMilliPoints !== page.widthMilliPoints
    || row.pageHeightMilliPoints !== page.heightMilliPoints) return false;
  const block = page.blocks[Number(row.locator.blockIndex)];
  if (!record(block) || typeof block.text !== "string" || !Array.isArray(block.bboxMilliPoints)
    || sha256(block.text) !== row.blockTextSha256) return false;
  const lineBoxes = block.lineBboxesMilliPoints;
  if (lineBoxes !== undefined && (!Array.isArray(lineBoxes)
    || lineBoxes.length !== lines(block.text).length)) return false;
  const expectedBox = Array.isArray(lineBoxes)
    ? lineBoxes[Number(row.locator.lineIndex)] : block.bboxMilliPoints;
  const blockBox = block.bboxMilliPoints as unknown[];
  if (!Array.isArray(expectedBox) || !same(expectedBox, row.locator.bboxMilliPoints)
    || expectedBox.length !== 4 || expectedBox.some((value: unknown, index: number) =>
      !integer(value) || index < 2 && Number(value) < Number(blockBox[index])
      || index >= 2 && Number(value) > Number(blockBox[index]))) return false;
  const line = lines(block.text)[Number(row.locator.lineIndex)];
  if (!line || line.text !== row.lineText || typeof row.rawValue !== "string"
    || !row.rawValue || row.rawValue.length > 500
    || Number(row.locator.start) < line.start
    || Number(row.locator.end) > line.start + Array.from(line.text).length
    || Array.from(block.text).slice(Number(row.locator.start), Number(row.locator.end)).join("")
      !== row.rawValue || typeof row.matchedLabel !== "string"
    || !line.text.toLocaleLowerCase("ru-RU").replaceAll("ё", "е")
      .includes(row.matchedLabel.toLocaleLowerCase("ru-RU").replaceAll("ё", "е"))) return false;
  const spec = candidateFamilyPreviewSpecs[String(row.parameterCode)];
  if (row.parameterCode === "FREE-HEATING-001") {
    if (row.family !== "TEXT_REFERENCE" || row.reason !== "EXACT_LABEL_LINE"
      || row.attribute !== "warm_floor_reference"
      || row.rawUnit !== null || row.rawValue !== row.matchedLabel
      || !/^т[её]пл[\p{L}\p{N}_]*\s+пол[\p{L}\p{N}_]*$/iu.test(String(row.rawValue))) return false;
  } else if (row.parameterCode === "IOS4-078" || row.parameterCode === "IOS4-079") {
    const ventilation = row.parameterCode === "IOS4-078";
    const phrase = ventilation
      ? /^принципиальн[\p{L}\p{N}_]*\s+схем[\p{L}\p{N}_]*\s+систем[\p{L}\p{N}_]*\s+общеобменн[\p{L}\p{N}_]*\s+вентиляц[\p{L}\p{N}_]*$/iu
      : /^принципиальн[\p{L}\p{N}_]*\s+схем[\p{L}\p{N}_]*\s+систем[\p{L}\p{N}_]*\s+теплоснабжен[\p{L}\p{N}_]*\s+приточн[\p{L}\p{N}_]*\s+установ[\p{L}\p{N}_]*$/iu;
    if (row.family !== "TEXT_REFERENCE" || row.reason !== "PAGE_TOPIC_LINE"
      || row.attribute !== (ventilation ? "ventilation_scheme" : "supply_unit_scheme")
      || row.rawUnit !== null || row.rawValue !== row.matchedLabel
      || !phrase.test(String(row.rawValue))) return false;
  } else if (row.reason === "FEATURE_LABEL_LINE") {
    const cue = presenceFeatureCues[String(row.parameterCode)];
    if (!cue || row.family !== "PRESENCE_SET" || row.attribute !== cue.attribute
      || row.rawUnit !== null || row.rawValue !== row.matchedLabel
      || !cue.pattern.test(String(row.rawValue))) return false;
  } else if (row.reason === "CATALOG_TOPIC_LINE") {
    const cue = catalogTopicCues[String(row.parameterCode)];
    const pageBlocks = page.blocks as unknown[];
    if (!cue || row.family !== "TEXT_REFERENCE" || row.attribute !== "catalog_topic"
      || row.rawUnit !== null || row.rawValue !== row.matchedLabel
      || !cue.test(String(row.rawValue))) return false;
    const blockIndex = Number(row.locator.blockIndex);
    const previousBlock: unknown = pageBlocks[blockIndex - 1];
    const precedingBlocks = pageBlocks.slice(Math.max(0, blockIndex - 12), blockIndex)
      .filter((item: unknown) => record(item) && typeof item.text === "string");
    const precedingText = precedingBlocks.map((item: unknown) => String((item as { text: string }).text)).join(" ");
    if (row.parameterCode === "PZ-021"
      && !/В\s+рамках\s+разработки\s+проектной\s+документации\s+класс\s+энергетической/iu.test(precedingText)) return false;
    if (row.parameterCode === "ZU-126" && !(
      pageBlocks.some((item: unknown) => record(item) && typeof item.text === "string"
        && /^Наружные\s+стены$/iu.test(item.text))
      && pageBlocks.some((item: unknown) => record(item) && typeof item.text === "string"
        && item.text.includes("λ"))
      && /Минераловатный\s+утеплитель/iu.test(precedingText))) return false;
    if (row.parameterCode === "ZU-127" && !(
      pageBlocks.some((item: unknown) => record(item) && typeof item.text === "string"
        && /Окна\s+и\s+витражи/iu.test(item.text))
      && blockIndex > 0 && record(previousBlock)
      && typeof previousBlock.text === "string"
      && /Блоки\s+оконные/iu.test(previousBlock.text))) return false;
    if (row.parameterCode === "ZU-128" && !(
      pageBlocks.some((item: unknown) => record(item) && typeof item.text === "string"
        && /^Покрытие$/iu.test(item.text))
      && /Минераловатный\s+плиты/iu.test(precedingText)
      && blockIndex > 0 && record(previousBlock)
      && typeof previousBlock.text === "string"
      && previousBlock.text.trim() === "8")) return false;
    if (row.parameterCode === "PZ-005" || row.parameterCode === "PZ-006") {
      const preceding = pageBlocks.slice(Math.max(0, Number(row.locator.blockIndex) - 8),
        Number(row.locator.blockIndex));
      if (!preceding.some((item: unknown) => record(item)
        && typeof item.text === "string" && /Строительный\s+объем/iu.test(item.text))) return false;
    }
    if (row.parameterCode === "PZ-011" && !([/\b1-\s*комн/iu, /\b2-\s*комн/iu]
      .every((pattern) => pageBlocks.some((item: unknown) => record(item)
        && typeof item.text === "string" && pattern.test(item.text))))) return false;
    if (row.parameterCode === "PZ-001"
      && !/^\s*(?:составля[\p{L}\p{N}_]*|[:=–—])/iu.test(
        Array.from(line.text).slice(Number(row.locator.end) - line.start).join(""))) return false;
  } else if (!spec || row.reason !== "EXACT_LABEL_LINE" || spec.family !== row.family
    || !(String(row.attribute) in spec.attributes)) return false;
  if (row.parameterCode === "PZ-023") {
    const context = /класс\s+конструктивной\s+пожарной\s+опасности(?:\s+здания)?\s*[–—:-]\s*(?<value>[СC][0-3])\b/iu.exec(line.text);
    if (!context || context.groups?.value !== row.rawValue || row.rawUnit !== null) return false;
  }
  if (spec && numericFamilies.has(String(row.family))
    && !validNumericLine({ canonicalUnit: spec.attributes[String(row.attribute)],
      rawUnit: row.rawUnit, rawValue: row.rawValue, matchedLabel: row.matchedLabel },
    line.text, Number(row.locator.start) - line.start)) return false;
  return true;
}

/** Independent write/read check of saved run suggestions against manifest and exact lines. */
export function verifyReviewCandidates(input: ReviewCandidatesVerificationInput): boolean {
  try {
    const result = input.result;
    if (!record(result) || !exact(result, ["schemaVersion", "resultType", "objectId",
      "inputManifestHash", "candidates", "candidateCount", "truncated", "findingCount",
      "parameterCoverage", "contentHash"])
      || result.schemaVersion !== "review-candidates-v1" || result.resultType !== "REVIEW_CANDIDATE"
      || result.objectId !== input.objectId || result.inputManifestHash !== input.inputManifestHash
      || result.findingCount !== null || result.parameterCoverage !== null
      || typeof result.truncated !== "boolean" || !hash(result.contentHash)
      || !Array.isArray(result.candidates) || result.candidates.length > 96
      || result.candidateCount !== result.candidates.length
      || Buffer.byteLength(workerJson(result), "utf8") > 2 * 1024 * 1024) return false;
    const { contentHash: _hash, ...unhashed } = result;
    if (digest(unhashed) !== result.contentHash) return false;
    const counts = new Map<string, number>();
    const codeCounts = new Map<string, number>();
    const artifactHashes = new Map<string, string>();
    const ids = new Set<string>();
    const keys = new Set<string>();
    let lastRank = Infinity;
    let lastTieKey = "";
    for (const raw of result.candidates) {
      if (!record(raw) || !exact(raw, candidateFields)
        || raw.schemaVersion !== "review-candidate-v1" || raw.resultType !== "REVIEW_CANDIDATE"
        || !["EXACT_LABEL_LINE", "PAGE_TOPIC_LINE", "FEATURE_LABEL_LINE",
          "CATALOG_TOPIC_LINE"].includes(String(raw.reason))
        || raw.origin !== "PDF_TEXT_LAYER"
        || raw.suggestedElement !== null || !hash(raw.candidateId)
        || !integer(raw.rank) || Number(raw.rank) > lastRank
        || !Array.isArray(raw.relatedDocuments) || raw.relatedDocuments.length > 3
        || !Array.isArray(raw.missingConfirmation)
        || !verifiedLine(raw, input, artifactHashes)) return false;
      const tieKey = `${raw.sourceFileId}\u0000${String(raw.pageNumber).padStart(8, "0")}`
        + `\u0000${raw.parameterCode}\u0000${raw.candidateId}`;
      if (Number(raw.rank) === lastRank && tieKey < lastTieKey) return false;
      lastRank = Number(raw.rank);
      lastTieKey = tieKey;
      const { candidateId: _id, ...content } = raw;
      if (digest(content) !== raw.candidateId || ids.has(raw.candidateId)) return false;
      ids.add(raw.candidateId);
      const sourceId = String(raw.sourceFileId);
      counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1);
      if (counts.get(sourceId)! > 16) return false;
      const codeCountKey = `${sourceId}\u0000${raw.parameterCode}`;
      codeCounts.set(codeCountKey, (codeCounts.get(codeCountKey) ?? 0) + 1);
      if (codeCounts.get(codeCountKey)! > 4) return false;
      const key = [sourceId, raw.pageNumber, raw.parameterCode, raw.attribute,
        raw.rawValue, raw.rawUnit].join("|");
      if (keys.has(key)) return false;
      keys.add(key);
      const source = input.sourceFiles.find((item) => item.sourceFileId === sourceId)!;
      const review = input.sourceReviews[sourceId];
      const stage = source.stages.length === 1 ? source.stages[0]
        : review?.pageStages[String(raw.pageNumber)];
      const expectedStage = stage === "PD" || stage === "RD" ? stage : null;
      if (raw.stage !== expectedStage || raw.sectionCode !== (source.sectionCode ?? null)
        || raw.revisionStatus !== (review?.revisionStatus ?? "UNKNOWN")
        || raw.approvalStatus !== (review?.approvalStatus ?? "UNKNOWN")) return false;
      const missing: string[] = [];
      if (raw.revisionStatus !== "CURRENT") missing.push("REVISION_NOT_CONFIRMED");
      if (raw.approvalStatus !== "APPROVED") missing.push("APPROVAL_NOT_CONFIRMED");
      if (raw.stage === null) missing.push("PAGE_STAGE_NOT_CONFIRMED");
      if (raw.sectionCode === null) missing.push("SECTION_NOT_CONFIRMED");
      if (!review?.linkGroupId) missing.push("DOCUMENT_LINK_NOT_CONFIRMED");
      if (raw.reason === "PAGE_TOPIC_LINE") {
        missing.push("PAGE_TOPIC_NOT_COMPARISON", "CODE_MAPPING_NOT_CONFIRMED");
      }
      if (raw.reason === "FEATURE_LABEL_LINE") {
        missing.push("SCOPE_NOT_CONFIRMED", "CODE_MAPPING_NOT_CONFIRMED");
      }
      if (raw.reason === "CATALOG_TOPIC_LINE") {
        missing.push("PAGE_TOPIC_NOT_COMPARISON", "CODE_MAPPING_NOT_CONFIRMED");
        if (["ZU-126", "ZU-127", "ZU-128"].includes(String(raw.parameterCode))) {
          missing.push("TABLE_ROW_ASSOCIATION_NOT_CONFIRMED");
        } else missing.push("VALUE_NOT_EXTRACTED");
        if (raw.parameterCode === "PZ-021") missing.push("CLASS_NOT_ASSIGNED_IN_SOURCE");
        if (raw.parameterCode === "SPZU-026") missing.push("PAVING_MATERIAL_NOT_CONFIRMED");
        if (raw.parameterCode === "SPZU-037") missing.push("PARKING_LAYOUT_NOT_CONFIRMED");
        if (raw.parameterCode === "SPZU-035") missing.push("ZONE_PLAN_BOUNDARY_NOT_CONFIRMED");
        if (raw.parameterCode === "KR-064") missing.push("SHAFT_DIMENSIONS_NOT_CONFIRMED");
        if (raw.parameterCode === "IOS4-076") missing.push("NETWORK_VS_INTERNAL_NOT_CONFIRMED");
        if (raw.parameterCode === "PPM-105") missing.push("EXTERIOR_EXIT_NOT_CONFIRMED");
        if (raw.parameterCode === "IOS1-068") missing.push("CIRCUIT_DEVICE_ASSIGNMENT_NOT_CONFIRMED");
        if (raw.parameterCode === "SM-132") missing.push("TOTAL_COST_AND_APPROVED_BASELINE_NOT_CONFIRMED");
        if (raw.parameterCode === "SPZU-031") missing.push("TURNING_RADIUS_VALUE_NOT_CONFIRMED");
      }
      missing.push("ELEMENT_NOT_CONFIRMED");
      for (const related of raw.relatedDocuments) {
        if (!record(related) || !exact(related, relatedFields)
          || related.sourceFileId === raw.sourceFileId
          || related.parameterCode !== raw.parameterCode || related.attribute !== raw.attribute
          || !verifiedLine({ ...related, family: raw.family, reason: raw.reason },
            input, artifactHashes)) return false;
        const other = input.sourceFiles.find((item) => item.sourceFileId === related.sourceFileId)!;
        const otherStage = other.stages.length === 1 ? other.stages[0]
          : input.sourceReviews[other.sourceFileId]?.pageStages[String(related.pageNumber)];
        const otherGroup = input.sourceReviews[other.sourceFileId]?.linkGroupId;
        if (!raw.stage || otherStage !== (raw.stage === "PD" ? "RD" : "PD")
          || !((source.sectionCode && source.sectionCode === other.sectionCode)
            || (review?.linkGroupId && review.linkGroupId === otherGroup))
          || (source.sectionCode && other.sectionCode
            && source.sectionCode !== other.sectionCode)
          || (review?.linkGroupId && otherGroup && review.linkGroupId !== otherGroup)) return false;
      }
      if (raw.relatedDocuments.length && !missing.includes("DOCUMENT_LINK_NOT_CONFIRMED")
        && raw.relatedDocuments.some((item: Json) =>
          !input.sourceReviews[String(item.sourceFileId)]?.linkGroupId)) {
        missing.push("DOCUMENT_LINK_NOT_CONFIRMED");
      }
      if (raw.relatedDocuments.length) missing.push("SAME_ELEMENT_NOT_CONFIRMED");
      const differs = !["PRESENCE_SET", "TEXT_REFERENCE"].includes(String(raw.family))
        && raw.relatedDocuments.some((item: Json) =>
        item.rawValue !== raw.rawValue && item.rawUnit === raw.rawUnit);
      const kind = differs ? "POSSIBLE_DIFFERENCE"
        : raw.relatedDocuments.length ? "POSSIBLE_PAIR" : "ONE_DOCUMENT_SIGNAL";
      const rank = (differs ? 100 : raw.relatedDocuments.length ? 70 : 40)
        - Math.min(missing.length, 10)
        - (raw.reason === "CATALOG_TOPIC_LINE" && raw.parameterCode === "PPM-105" ? 7
          : raw.reason === "CATALOG_TOPIC_LINE" ? 12
          : ["PAGE_TOPIC_LINE", "FEATURE_LABEL_LINE"].includes(String(raw.reason)) ? 8 : 0);
      if (raw.kind !== kind || raw.rank !== rank || !same(raw.missingConfirmation, missing)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
