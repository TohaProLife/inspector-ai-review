import { useEffect, useState } from "react";
import { matrixFactScopeSchema, matrixFactScopeTargetSchema, type MatrixObservation,
  type MatrixFactScope, type MatrixFactScopeContext, type MatrixFactScopeTarget } from "@inspector-ai/contracts";
import { PROJECT_ZERO_AUTHORITY, PROJECT_ZERO_BASIS, ownProjectZeroAuthority, type ProjectZeroAuthorityOption } from "./matrix-project-zero-authority";
import registry from "../../../services/worker/rules/matrix-execution-v1.json";

const editorStyles = `
.matrix-fact-scope { min-width:0; max-width:100%; }
.matrix-fact-scope fieldset { min-width:0; max-width:100%; margin:12px 0; border:1px solid var(--line,#b9c9ce); }
.matrix-fact-scope legend { max-width:100%; white-space:normal; }
.matrix-fact-scope label { display:flex; flex-direction:column; gap:5px; min-width:0; margin:10px 0; }
.matrix-fact-scope label:has(input[type="checkbox"]) { display:block; }
.matrix-fact-scope input:not([type="checkbox"]),.matrix-fact-scope select,.matrix-fact-scope textarea {
  width:100%; min-width:0; max-width:100%; box-sizing:border-box; font:inherit;
  color:inherit; background:var(--surface,#fff); border:1px solid var(--line,#b9c9ce); border-radius:5px; padding:8px;
}
.matrix-fact-scope input[type="checkbox"] { margin-right:8px; }
.matrix-fact-scope button { max-width:100%; white-space:normal; overflow-wrap:anywhere; }
.matrix-fact-scope blockquote { margin-inline:0; }
.matrix-fact-scope article { border-top:1px solid var(--line,#b9c9ce); padding:12px 0; }
`;

const identityFields = ["componentKey", "zoneKey", "operatingModeKey", "measurementBasisKey"] as const;
type IdentityField = typeof identityFields[number];
const WALL_FLOOR_CONTEXT = "CONCRETE_WALL_FLOOR_SCOPE_V1";
const wallFloors = ["-3", "-2", "-1", "0", "1"] as const;
const isConcreteClass = (fact:MatrixObservation) => fact.attribute === "CONCRETE_CLASS" && fact.unit === "B_CLASS"
  && Array.isArray(fact.parameterCodes) && fact.parameterCodes.includes("KR-055");
/** Exact extractor dispatch precedes historical MATERIAL_SCOPE/stair handling. */
const isConcreteWallProse = (fact:MatrixObservation) => fact.stage === "RD" && isConcreteClass(fact)
  && fact.extractorVersion === "matrix-concrete-wall-prose-v1";
const isConcreteWallDraft = (fact:MatrixObservation, draft:MatrixFactScopeDraft, available:boolean) =>
  isConcreteWallProse(fact) || (available && fact.stage === "PD" && isConcreteClass(fact)
    && draft.concreteScope === "WALL" && fact.contextFragments?.some(part => part.role === "TABLE_SCOPE"));
const wallIdentityLabels:Record<IdentityField,string> = { componentKey:"Стена или явно согласованная группа стен",
  zoneKey:"Корпус и зона стены", operatingModeKey:"Назначение несущей стены", measurementBasisKey:"Основание класса бетона" };
const isConcreteProse=(fact:MatrixObservation)=>fact.extractorVersion!=="matrix-concrete-wall-prose-v1"&&fact.attribute==="CONCRETE_CLASS"&&fact.unit==="B_CLASS"
  &&Array.isArray(fact.parameterCodes)&&fact.parameterCodes.includes("KR-055")&&fact.contextFragments?.some(part=>part.role==="MATERIAL_SCOPE");
const concreteIdentityLabels:Record<IdentityField,string>={componentKey:"Лестничная конструкция или согласованная группа",
  zoneKey:"Корпус и зона лестницы",operatingModeKey:"Назначение несущей лестницы",measurementBasisKey:"Основание класса бетона"};
const identityLabels: Record<IdentityField, string> = {
  componentKey: "Позиция оборудования или слой",
  zoneKey: "Зона обслуживания или участок",
  operatingModeKey: "Режим работы или состояние конструкции",
  measurementBasisKey: "База измерения и расчётная точка",
};
const pavingIdentityLabels: Record<IdentityField, string> = {
  componentKey: "Тип и конструкция плиточного покрытия",
  zoneKey: "Участок и границы мощения",
  operatingModeKey: "Размещение по грунту или на кровле",
  measurementBasisKey: "База расчёта площади мощения",
};
const egressBases: Record<string, { value: string; label: string }> = {
  EVACUATION_CORRIDOR_CLEARANCE: { value: "CLEAR_FINISHED_FLOOR_TO_LOWEST_OBSTRUCTION",
    label: "От чистого пола до нижнего препятствия" },
  EVACUATION_DOOR_CLEARANCE: { value: "CLEAR_FINISHED_FLOOR_TO_OPENING_HEAD",
    label: "От чистого пола до верха свободного проёма" },
};
const stairBases: Record<string, { value: string; label: string }> = {
  STAIR_TREAD: { value: "FINISHED_HORIZONTAL_TREAD_CLEAR_DEPTH", label: "Горизонтальная глубина проступи в свету после отделки" },
  STAIR_RISER: { value: "FINISHED_VERTICAL_RISER_HEIGHT", label: "Вертикальная высота подступенка после отделки" },
};
const fenceBases = { TERRITORY_FENCE_SEGMENT: { value: "FINISHED_GROUND_TO_FENCE_TOP", label: "От поверхности готового грунта до верха ограждения" } };
const measuredBases: Record<string, { value: string; label: string }> = { ...egressBases, ...stairBases, ...fenceBases,
  WORKING_REINFORCEMENT_POSITION: { value: "DECLARED_REINFORCEMENT_CLASS", label: "Явно принятый класс рабочей арматуры" },
  PROJECT_ZERO_DATUM: { value: PROJECT_ZERO_BASIS, label: "От принятого чистого пола до утверждённого высотного datum" } };
const fenceIdentityLabels: Record<IdentityField, string> = {
  componentKey: "Участок ограждения", zoneKey: "Граница территории и зона",
  operatingModeKey: "Назначение ограждения", measurementBasisKey: "База измерения ограждения",
};
const stairIdentityLabels: Record<IdentityField, string> = {
  componentKey: "Марш и ступень", zoneKey: "Этаж и лестничная клетка",
  operatingModeKey: "Назначение лестницы", measurementBasisKey: "База измерения ступени",
};
const egressIdentityLabels: Record<IdentityField, string> = {
  componentKey: "Коридор или дверной проём",
  zoneKey: "Этаж, помещение и участок маршрута",
  operatingModeKey: "Назначение пути",
  measurementBasisKey: "База измерения высоты",
};
const projectZeroIdentityLabels: Record<IdentityField, string> = {
  componentKey: "Здание или строительный объём", zoneKey: "Общий ноль и соответствующий пол",
  operatingModeKey: "Высотная система и datum", measurementBasisKey: "База абсолютной отметки проектного нуля",
};
const rebarIdentityLabels: Record<IdentityField, string> = {
  componentKey: "Позиция или группа рабочей арматуры", zoneKey: "Конструкция, этаж и зона армирования",
  operatingModeKey: "Функция арматуры", measurementBasisKey: "Основание класса арматуры",
};
function labelsForRole(role: string): Record<IdentityField, string> {
  return role === "WORKING_REINFORCEMENT_POSITION" ? rebarIdentityLabels
    : role === "SIDEWALK_TILE_PAVING" ? pavingIdentityLabels
    : role === "PROJECT_ZERO_DATUM" ? projectZeroIdentityLabels
    : role === "TERRITORY_FENCE_SEGMENT" ? fenceIdentityLabels
    : stairBases[role] ? stairIdentityLabels : egressBases[role] ? egressIdentityLabels : identityLabels;
}
const contextLabels: Record<string, string> = {
  REINFORCEMENT_APPLICATION_SCOPE: "Применимость класса к той же рабочей арматуре",
  PROJECT_ZERO_GEODETIC_AUTHORITY: "Геодезическое основание ПД для проектного нуля",
  FENCE_TYPE_IDENTITY: "Тип и функция ограждения территории",
  STAIR_FLIGHT_STEP_IDENTITY: "Идентичность марша и ступени",
  NORM_APPLICABILITY_VERIFIED: "Применимость нормативного требования",
  TECHNICAL_CONDITIONS_LIMIT: "Лимит технических условий",
  APPROVED_CHANGE_STATUS: "Наличие согласованного изменения",
  THERMAL_RESISTANCE_REDUCTION_VERIFIED: "Подтверждённое снижение сопротивления теплопередаче",
  ELEMENT_IDENTITY: "Идентичность элемента",
  SLAB_FLOOR_ZONE_IDENTITY: "Этаж и зона плиты перекрытия",
  FOUNDATION_ZONE_IDENTITY: "Зона фундамента",
  STRUCTURE_SCOPE: "Область конструкции",
  BUILDING_SCOPE: "Область здания",
  BUILDING_AREA_BASIS: "База расчёта площади здания",
  MATERIAL_CLASS_BASIS: "Основание класса материала",
  CONCRETE_WALL_FLOOR_SCOPE_V1: "Один общий этаж для согласованной стены",
  MATERIAL_COMPONENT_IDENTITY: "Материал и элемент конструкции",
  ACCESSIBLE_DOOR_IDENTITY: "Дверь на доступном маршруте",
  ANNUAL_PERIOD_BASIS: "Годовой период расчёта",
  BUILDING_HEIGHT_DATUM: "Исходная отметка высоты здания",
  COLUMN_OR_PYLON_IDENTITY: "Колонна или пилон",
  CONSUMER_IDENTITY: "Потребитель и точка подключения",
  CORRIDOR_IDENTITY: "Коридор",
  COST_COMPONENT_SCOPE: "Состав учитываемых затрат",
  CRITICAL_STAGE_IDENTITY: "Критический этап работ",
  DEMOLITION_MATERIAL_TYPE: "Вид материала от разборки",
  DIAMETER_BASIS: "Способ определения диаметра",
  DOOR_IDENTITY: "Дверь и её положение",
  EARTHWORK_SCOPE: "Область земляных работ",
  ESTIMATE_SCOPE: "Область сметного расчёта",
  EVACUATION_ROUTE_IDENTITY: "Маршрут эвакуации",
  EXTERNAL_DOOR_IDENTITY: "Наружная дверь",
  EXTERNAL_VOLUME_GEOMETRY: "Геометрия наружного строительного объёма",
  FINISH_LOCATION_IDENTITY: "Участок отделки",
  FIRE_ACCESS_ROAD_IDENTITY: "Пожарный проезд",
  FIRE_RATING_NOTATION: "Обозначение предела огнестойкости",
  FLOOR_COUNT_CONVENTION: "Правило подсчёта этажей",
  FLOOR_IDENTITY: "Этаж и его границы",
  GAS_SUPPLY_SCOPE: "Область газоснабжения",
  GUARD_LOCATION_IDENTITY: "Место расположения ограждения",
  GUARD_TYPE_IDENTITY: "Вид ограждения",
  HEATING_LOAD_SCOPE: "Состав расчётной отопительной нагрузки",
  HOUSING_UNIT_SCOPE: "Состав учитываемых квартир",
  INSULATION_MATERIAL_IDENTITY: "Материал утеплителя",
  OUTLET_IDENTITY: "Выпуск и точка подключения",
  PASSAGE_IDENTITY: "Проход и его положение",
  PIPE_RUN_IDENTITY: "Участок трубопровода",
  PIPE_SYSTEM_IDENTITY: "Система трубопровода",
  PRICE_BASE_DATE: "Дата и база цен",
  REBAR_ROLE_IDENTITY: "Назначение арматуры",
  RESOURCE_TYPE_IDENTITY: "Вид ресурса",
  ROOF_ASSEMBLY_IDENTITY: "Состав кровельной конструкции",
  SEWER_SYSTEM_IDENTITY: "Система канализации",
  SITE_CAMP_CAPACITY_BASIS: "Расчёт вместимости строительного городка",
  SURFACE_PARKING_SCOPE: "Область наземной парковки",
  SURFACE_TYPE_IDENTITY: "Тип покрытия",
  TEMPORARY_NETWORK_IDENTITY: "Временная инженерная сеть",
  THICKNESS_MEASUREMENT_BASIS: "Способ и место измерения толщины",
  UNDERGROUND_PARKING_SCOPE: "Область подземной парковки",
  VOLUME_COMPONENT_IDENTITY: "Составляющая строительного объёма",
  WALL_ASSEMBLY_IDENTITY: "Состав конструкции стены",
  WALL_IDENTITY: "Стена и её положение",
  WATER_SUPPLY_SCOPE: "Область водоснабжения",
  WORKFORCE_SCOPE: "Состав учитываемого персонала",
  ZONE_IDENTITY: "Зона и её границы",
};

export interface MatrixFactEditorRule {
  ruleId: string;
  version: string;
  parameterCode: string;
  parameterName: string;
  label: string;
  trigger: string;
  attribute: string;
  canonicalUnit: string;
  enabled: boolean;
  threshold: { value: string; unit: string; strict: boolean } | null;
  requiredContext: string[];
  expectedSections: string[];
  actualSections: string[];
  subruleContext?: { schemaVersion: string; componentRole: string; identityFields: string[] };
}

/** Only rules independently declared for this extracted attribute, unit and parameter are selectable. */
export function matrixFactScopeRules(fact: MatrixObservation): MatrixFactEditorRule[] {
  if (fact.method !== "TEXT_LAYER" || !Array.isArray(fact.parameterCodes)) return [];
  return registry.entries.flatMap(entry => entry.atomicRules.filter(rule => rule.enabled
    && rule.attribute === fact.attribute && rule.canonicalUnit === fact.unit
    && (fact.parameterCodes as unknown[]).includes(entry.parameterCode)).map(rule => ({ ...rule,
    parameterCode: entry.parameterCode, parameterName: entry.name, label: rule.labels[0] ?? entry.name,
    trigger: entry.trigger }))) as MatrixFactEditorRule[];
}

export interface MatrixFactContextDraft {
  reviewed: boolean;
  reference: string;
  applicable?: boolean;
  limitValue?: string;
  approvedChangeStatus?: "" | "ABSENT" | "PRESENT";
  reductionConfirmed?: boolean;
  projectZeroAuthorityKey?: string;
}

export interface MatrixFactScopeDraft {
  ruleId: string;
  entityKey: string;
  reference: string;
  identityReviewed: boolean;
  contexts: Record<string, MatrixFactContextDraft>;
  identity: Partial<Record<IdentityField, string>>;
  drawingSection: string;
  drawingSectionReviewed: boolean;
  drawingSectionReference: string;
  tableContextReviewed: boolean;
  tableContextReference: string;
  // Local draft fields only; persisted floor uses the existing context.componentKey.
  concreteScope?: "" | "WALL";
  wallFloor?: string;
}

export function emptyMatrixFactScopeDraft(ruleId = ""): MatrixFactScopeDraft {
  return { ruleId, entityKey: "", reference: "", identityReviewed: false, contexts: {}, identity: {},
    drawingSection: "", drawingSectionReviewed: false, drawingSectionReference: "",
    tableContextReviewed: false, tableContextReference: "" };
}

/** A changed element cannot inherit checked conditions or the previous position identity. */
export function changeMatrixFactScopeEntity(draft: MatrixFactScopeDraft, entityKey: string): MatrixFactScopeDraft {
  if (draft.entityKey === entityKey) return draft;
  return { ...draft, entityKey, identityReviewed: false, identity: {}, drawingSectionReviewed: false,
    tableContextReviewed: false, ...("wallFloor" in draft ? { wallFloor: "" } : {}), contexts: Object.fromEntries(Object.entries(draft.contexts)
      .map(([key, context]) => [key, { ...context, reviewed: false }])) };
}

/** Identity/floor edits require later explicit reconfirmation of every wall judgment. */
export function changeMatrixConcreteWallIdentity(draft:MatrixFactScopeDraft,
  change:Pick<Partial<MatrixFactScopeDraft>, "identity" | "wallFloor">):MatrixFactScopeDraft {
  return { ...draft, ...change, identityReviewed:false, tableContextReviewed:false,
    contexts:Object.fromEntries(Object.entries(draft.contexts).map(([key, context]) => [key, { ...context, reviewed:false }])) };
}

export interface MatrixFactScopeEditorProps {
  fact: MatrixObservation;
  target: MatrixFactScopeTarget;
  fragmentsHash?: string;
  projectZeroAuthorities?: ProjectZeroAuthorityOption[];
  preferredRuleId?: string;
  concreteWallReviewAvailable?: boolean;
  onRuleChange?: (ruleId: string | null) => void;
  value?: MatrixFactScope;
  disabled?: boolean;
  onChange: (scope: MatrixFactScope) => void;
}

type Preparation = { scope: MatrixFactScope; error: null } | { scope: null; error: string };
const failure = (error: string): Preparation => ({ scope: null, error });
const validReference = (reference: string) => reference.trim().length >= 8 && reference.trim().length <= 1000;
const completeness = /^(?:RULE_SCOPE_COMPLETE|PARAMETER_SCOPE_COMPLETE)(?::|$)/u;

/** Prepare a draft only. Source trust, original target and authenticated saving remain server decisions. */
export function prepareMatrixFactScope(input: Omit<MatrixFactScopeEditorProps, "onChange" | "disabled"> & {
  draft: MatrixFactScopeDraft;
}): Preparation {
  const { fact, target, fragmentsHash, value, draft, projectZeroAuthorities = [] } = input;
  const concreteProse=isConcreteProse(fact);
  const wallMode=isConcreteWallDraft(fact,draft,input.concreteWallReviewAvailable === true);
  const rule = matrixFactScopeRules(fact).find(item => item.ruleId === draft.ruleId);
  if (!rule) return failure("Для этого факта нет выбранного исполняемого правила.");
  if (!matrixFactScopeTargetSchema.safeParse(target).success || target.observationId !== fact.id)
    return failure("Адрес исходного факта не совпадает. Повторно откройте факт из сохранённого запуска.");
  if (value && !matrixFactScopeSchema.safeParse(value).success)
    return failure("Текущий черновик привязок некорректен. Перечитайте сохранённое решение.");
  if (!draft.entityKey.trim() || !validReference(draft.reference) || !draft.identityReviewed)
    return failure("Укажите элемент, основание от 8 символов и явно подтвердите его идентичность.");
  const requiredContext = wallMode ? [...rule.requiredContext, WALL_FLOOR_CONTEXT] : rule.requiredContext;
  if (wallMode && (requiredContext.some(key => !draft.contexts[key]?.reviewed) || !draft.tableContextReviewed))
    return failure("Отдельно подтвердите стену, основание класса, один общий этаж и связь со всеми исходными контекстными фрагментами.");
  const contexts: Record<string, MatrixFactScopeContext> = {};
  for (const [key, context] of Object.entries(draft.contexts)) {
    if (!context.reviewed) continue;
    if (completeness.test(key) || !requiredContext.includes(key))
      return failure("Условие не относится к выбранному правилу. Полнота области здесь не подтверждается.");
    if (!matrixFactScopeContextLabel(key)) return failure("Это условие пока недоступно для проверки в редакторе.");
    if (!validReference(context.reference)) return failure("Для каждого отмеченного условия нужно отдельное основание от 8 символов.");
    const details: MatrixFactScopeContext = { reference: context.reference.trim() };
    if(wallMode&&key==="ELEMENT_IDENTITY") {
      if(identityFields.some(field=>!draft.identity[field]?.trim())
        ||draft.identity.operatingModeKey!=="CAST_IN_PLACE_LOAD_BEARING_WALL"
        ||draft.identity.measurementBasisKey!=="CONCRETE_COMPRESSIVE_STRENGTH_CLASS")
        return failure("Явно укажите ту же несущую монолитную стену, корпус и зону; подтвердите основание класса бетона.");
      Object.assign(details,{componentRole:"MONOLITHIC_LOAD_BEARING_WALL",
        ...Object.fromEntries(identityFields.map(field=>[field,draft.identity[field]!.trim()]))});
    }
    if(wallMode&&key===WALL_FLOOR_CONTEXT) {
      if(!wallFloors.some(floor=>floor===draft.wallFloor)||!draft.identity.zoneKey?.trim())
        return failure("Выберите ровно один общий этаж от -3 до 1 и явно укажите зону стены.");
      Object.assign(details,{componentRole:"EXACT_STOREY",componentKey:draft.wallFloor,
        zoneKey:draft.identity.zoneKey.trim(),measurementBasisKey:"EXACT_COMMON_STOREY"});
    }
    if(concreteProse&&key==="ELEMENT_IDENTITY") {
      if(identityFields.some(field=>!draft.identity[field]?.trim())
        ||draft.identity.operatingModeKey!=="CAST_IN_PLACE_LOAD_BEARING_STAIR"
        ||draft.identity.measurementBasisKey!=="CONCRETE_COMPRESSIVE_STRENGTH_CLASS")
        return failure("Укажите ту же несущую монолитную лестничную конструкцию, корпус и зону; подтвердите класс прочности бетона на сжатие.");
      Object.assign(details,{componentRole:"MONOLITHIC_LOAD_BEARING_STAIR",
        ...Object.fromEntries(identityFields.map(field=>[field,draft.identity[field]!.trim()]))});
    }
    if((concreteProse||wallMode)&&key==="MATERIAL_CLASS_BASIS") {
      if(draft.identity.measurementBasisKey!=="CONCRETE_COMPRESSIVE_STRENGTH_CLASS")
        return failure("Отдельно подтвердите проектный класс бетона по прочности на сжатие.");
      Object.assign(details,{attribute:"CONCRETE_CLASS",canonicalUnit:"B_CLASS",measurementBasisKey:"CONCRETE_COMPRESSIVE_STRENGTH_CLASS"});
    }
    if (key === PROJECT_ZERO_AUTHORITY) {
      if (fact.stage === "PD") details.projectZeroAuthority = ownProjectZeroAuthority(fact, target);
      else if (fact.stage === "RD") {
        const choices = projectZeroAuthorities.filter(item => item.key === context.projectZeroAuthorityKey);
        if (choices.length !== 1 || !choices[0].authority.reviewContentHash)
          return failure("Выберите сохранённое действующее основание ПД. Текстовое описание не заменяет связь с оригиналом.");
        details.projectZeroAuthority = choices[0].authority;
      } else return failure("Основание проектного нуля доступно только для ПД и РД.");
    }
    if (key === "NORM_APPLICABILITY_VERIFIED") {
      if (!context.applicable || !rule.threshold) return failure("Отдельно подтвердите применимость нормативного порога к этому элементу.");
      Object.assign(details, { applicable: true, parameterCode: rule.parameterCode, attribute: rule.attribute,
        threshold: rule.threshold.value, canonicalUnit: rule.canonicalUnit });
    }
    if (key === "TECHNICAL_CONDITIONS_LIMIT") {
      const limit = context.limitValue?.trim().replace(",", ".") ?? "";
      if (!/^\d+(?:\.\d+)?$/u.test(limit) || limit.length > 60) return failure("Укажите проверенный числовой лимит ТУ в единицах правила.");
      Object.assign(details, { limitValue: limit, canonicalUnit: rule.canonicalUnit });
    }
    if (key === "APPROVED_CHANGE_STATUS") {
      if (!["ABSENT", "PRESENT"].includes(context.approvedChangeStatus ?? ""))
        return failure("Явно укажите, есть ли согласованное изменение.");
      details.approvedChangePresent = context.approvedChangeStatus === "PRESENT";
    }
    if (key === "THERMAL_RESISTANCE_REDUCTION_VERIFIED") {
      if (!context.reductionConfirmed) return failure("Отдельно подтвердите снижение сопротивления теплопередаче.");
      details.reductionConfirmed = true;
    }
    if (key.startsWith("ATOMIC_SUBRULE_SCOPE:")) {
      if (key !== `ATOMIC_SUBRULE_SCOPE:${rule.ruleId}` || !rule.subruleContext
        || rule.subruleContext.identityFields.some(field => !identityFields.includes(field as IdentityField)
          || !draft.identity[field as IdentityField]?.trim()))
        return failure("Заполните позицию, зону, режим и базу измерения выбранного правила по оригиналу.");
      const egressBasis = egressBases[rule.subruleContext.componentRole];
      if (egressBasis && (draft.identity.operatingModeKey !== "EVACUATION"
        || draft.identity.measurementBasisKey !== egressBasis.value))
        return failure("Отдельно подтвердите эвакуационное назначение и высоту в свету от чистого пола. Номинальный размер не подходит.");
      const stairBasis = stairBases[rule.subruleContext.componentRole];
      if (stairBasis && (draft.identity.operatingModeKey !== "EVACUATION"
        || draft.identity.measurementBasisKey !== stairBasis.value))
        return failure("Отдельно подтвердите эвакуационное назначение лестницы и размер ступени после отделки.");
      if (rule.subruleContext.componentRole === "TERRITORY_FENCE_SEGMENT"
        && (draft.identity.operatingModeKey !== "TERRITORY_BOUNDARY"
          || draft.identity.measurementBasisKey !== "FINISHED_GROUND_TO_FENCE_TOP"))
        return failure("Отдельно подтвердите границу территории и высоту от готового грунта до верха ограждения.");
      if (rule.subruleContext.componentRole === "PROJECT_ZERO_DATUM"
        && draft.identity.measurementBasisKey !== PROJECT_ZERO_BASIS)
        return failure("Подтвердите отсчёт от принятого чистого пола до утверждённого высотного datum. Одинаковые числа не подтверждают общий ноль.");
      if (rule.subruleContext.componentRole === "WORKING_REINFORCEMENT_POSITION"
        && (draft.identity.operatingModeKey !== "WORKING_NOT_CONSTRUCTIVE_ASSEMBLY_OR_EMBEDDED"
          || draft.identity.measurementBasisKey !== "DECLARED_REINFORCEMENT_CLASS"))
        return failure("Отдельно подтвердите ту же позицию рабочей арматуры и явно принятый класс. Конструктивная, монтажная арматура и закладные детали не подходят.");
      Object.assign(details, { parameterCode: rule.parameterCode, attribute: rule.attribute,
        canonicalUnit: rule.canonicalUnit, componentRole: rule.subruleContext.componentRole,
        ...Object.fromEntries(rule.subruleContext.identityFields.map(field => [field, draft.identity[field as IdentityField]!.trim()])) });
    }
    contexts[key] = details;
  }
  if (draft.drawingSectionReviewed) {
    if (!new Set([...rule.expectedSections, ...rule.actualSections]).has(draft.drawingSection)
      || !validReference(draft.drawingSectionReference))
      return failure("Для раздела листа выберите значение по штампу и укажите отдельное основание.");
    contexts.DRAWING_SECTION_VERIFIED = { drawingSection: draft.drawingSection, reference: draft.drawingSectionReference.trim() };
  }
  const tableContext = draft.tableContextReviewed ? {
    fragmentsHash: fragmentsHash ?? "", reference: draft.tableContextReference.trim(),
  } : undefined;
  if (tableContext && (concreteProse || !(wallMode ? fact.contextFragments?.length
    : fact.contextFragments?.some(part => ["ATTRIBUTE_HEADER", "TABLE_SCOPE"].includes(part.role))) || !/^[a-f0-9]{64}$/u.test(tableContext.fragmentsHash)
    || !validReference(tableContext.reference)))
    return failure("Проверка таблицы требует исходных контекстных фрагментов и отдельного основания от 8 символов.");
  const retained = (value?.bindings ?? []).filter(binding => binding.target.observationId !== fact.id || binding.ruleId !== rule.ruleId);
  const entityKey = draft.entityKey.trim();
  if (retained.some(binding => binding.target.observationId === fact.id && binding.entityKey !== entityKey))
    return failure("Этот факт уже связан с другим элементом в другом правиле. Сначала явно удалите конфликтующую привязку.");
  const prepared = matrixFactScopeSchema.safeParse({ schemaVersion: "matrix-fact-scopes-v1", bindings: [...retained, {
    ruleId: rule.ruleId, ruleVersion: rule.version, parameterCode: rule.parameterCode, entityKey,
    reference: draft.reference.trim(), target, contexts, ...(tableContext ? { tableContextReview: tableContext } : {}),
  }] });
  return prepared.success ? { scope: prepared.data, error: null } : failure("Проверьте длину полей и допустимое количество привязок.");
}

export function removeMatrixFactScopeBinding(value: MatrixFactScope, observationId: string, ruleId: string): MatrixFactScope {
  return { schemaVersion: "matrix-fact-scopes-v1", bindings: value.bindings.filter(binding =>
    binding.target.observationId !== observationId || binding.ruleId !== ruleId) };
}

export function matrixFactScopeContextLabel(key: string): string | undefined {
  return key.startsWith("ATOMIC_SUBRULE_SCOPE:") ? "Позиция, зона, режим и база измерения"
    : contextLabels[key];
}

/** Keyed inner state prevents confirmations carrying over when the selected immutable fact changes. */
export function MatrixFactScopeEditor(props: MatrixFactScopeEditorProps) {
  return <FactScopeEditorFields key={`${props.target.checkId}:${props.target.executionContentHash}:${props.target.observationId}:${props.target.evidenceHash}:${props.preferredRuleId ?? ""}:${props.concreteWallReviewAvailable === true}`}
    {...props} />;
}

function FactScopeEditorFields({ fact, target, fragmentsHash, projectZeroAuthorities = [], preferredRuleId, concreteWallReviewAvailable = false, value, disabled = false, onChange, onRuleChange }: MatrixFactScopeEditorProps) {
  const concreteProse=isConcreteProse(fact);
  const rules = matrixFactScopeRules(fact);
  const [draft, setDraft] = useState(() => emptyMatrixFactScopeDraft(
    rules.find(rule => rule.ruleId === preferredRuleId)?.ruleId ?? rules[0]?.ruleId));
  const [message, setMessage] = useState("");
  const wallMode=isConcreteWallDraft(fact,draft,concreteWallReviewAvailable);
  const rule = rules.find(item => item.ruleId === draft.ruleId);
  const requiredContext = rule ? wallMode ? [...rule.requiredContext, WALL_FLOOR_CONTEXT] : rule.requiredContext : [];
  const selectedRuleId = rule?.ruleId ?? null;
  useEffect(() => { onRuleChange?.(selectedRuleId); }, [onRuleChange, selectedRuleId]);
  const targetValid = matrixFactScopeTargetSchema.safeParse(target).success && target.observationId === fact.id;
  const edit = (change: Partial<MatrixFactScopeDraft>) => { setDraft(previous => ({ ...previous, ...change, identityReviewed: false })); setMessage(""); };
  const editContext = (key: string, change: Partial<MatrixFactContextDraft>) => {
    setDraft(previous => ({ ...previous, identityReviewed: false,
      contexts: { ...previous.contexts, [key]: { ...(previous.contexts[key] ?? { reviewed: false, reference: "" }), ...change } } }));
    setMessage("");
  };
  const editWallIdentity = (change:Pick<Partial<MatrixFactScopeDraft>, "identity" | "wallFloor">) => {
    setDraft(previous=>changeMatrixConcreteWallIdentity(previous,change));setMessage("");
  };
  const prepared = prepareMatrixFactScope({ fact, target, fragmentsHash, projectZeroAuthorities, concreteWallReviewAvailable, value, draft });
  const apply = () => {
    if (disabled || !prepared.scope) return;
    onChange(prepared.scope);
    setDraft(previous => ({ ...previous, identityReviewed: false }));
    setMessage("Привязка добавлена в черновик. Сохраните решение по источнику и запустите новую проверку.");
  };
  return <section className="matrix-fact-scope" aria-label="Привязка конкретного машинного факта" style={{ overflowWrap: "anywhere" }}>
    <style>{editorStyles}</style>
    <h3>Привязка конкретной строки</h3>
    <p>Исходный PDF: {fact.sourceFileId} · {fact.stage} · страница {fact.pageNumber} · строка {fact.blockId}</p>
    <blockquote>{fact.rawText}</blockquote>
    <p>Решение относится к одной строке и одному правилу. Черновик вступит в силу только после сохранения решения по источнику и нового запуска.</p>
    {!targetValid && <p role="alert">Адрес исходного факта не совпадает. Повторно откройте сохранённый запуск.</p>}
    {!rules.length && <p role="status">Для признака и единицы этого факта нет доступного исполняемого правила.</p>}
    {!!rules.length && <fieldset disabled={disabled || !targetValid}>
      <legend>Область выбранного факта</legend>
      <label>Правило<select value={draft.ruleId} onChange={event => { setDraft(emptyMatrixFactScopeDraft(event.target.value)); setMessage(""); }}>
        {rules.map(item => <option key={item.ruleId} value={item.ruleId}>{item.parameterCode} · {item.parameterName} · {item.label}</option>)}
      </select></label>
      {rule && <p>{rule.trigger}</p>}
      {concreteWallReviewAvailable && fact.stage === "PD" && isConcreteClass(fact)
        && fact.contextFragments?.some(part=>part.role==="TABLE_SCOPE") && <label>Область бетонной строки ПД
        <select value={draft.concreteScope??""} onChange={event=>{setDraft({...emptyMatrixFactScopeDraft(draft.ruleId),concreteScope:event.target.value==="WALL"?"WALL":""});setMessage("");}}>
          <option value="">Стена не выбрана: обычная привязка таблицы</option>
          <option value="WALL">Явно сопоставляю строку с несущей монолитной стеной</option>
        </select></label>}
      {wallMode && <p>Сопоставьте точные строки ПД и РД из одного сохранённого запуска v13 с общей исходной областью.
        Идентичность стены, зона и один этаж требуют отдельных оснований. Совпадение B-класса этого не подтверждает.
        Согласование источника, редакция и комплект проверяются отдельно.</p>}
      <label>Ключ здания, этажа или элемента<input value={draft.entityKey} maxLength={200}
        placeholder="Например: корпус-1/плита-минус-1" onChange={event => {
          setDraft(previous => changeMatrixFactScopeEntity(previous, event.target.value)); setMessage("");
        }} /></label>
      <label>Основание идентичности элемента<textarea rows={3} value={draft.reference} maxLength={1000}
        placeholder="Лист, позиция, оси, отметка — что связывает эту строку с элементом"
        onChange={event => edit({ reference: event.target.value })} /></label>
      <p>Ниже отмечайте только проверенные условия. Неотмеченные условия останутся неподтверждёнными.</p>
      {rule&&requiredContext.filter(key => !completeness.test(key)).map(key => {
        const context = draft.contexts[key] ?? { reviewed: false, reference: "" };
        return <fieldset key={key}><legend>{matrixFactScopeContextLabel(key) ?? "Дополнительное условие правила"}</legend>
          {!matrixFactScopeContextLabel(key) && <p>Это условие пока недоступно для проверки в редакторе.</p>}
          {wallMode&&key==="ELEMENT_IDENTITY"&&<>
            <p>Укажите ту же физическую стену или явно согласованную группу, корпус и зону. Общий класс B60 не устанавливает идентичность.</p>
            {identityFields.map(field=><label key={field}>{wallIdentityLabels[field]}
              {field==="operatingModeKey"||field==="measurementBasisKey"?<select aria-label={wallIdentityLabels[field]}
                value={draft.identity[field]??""} onChange={event=>editWallIdentity({identity:{...draft.identity,[field]:event.target.value}})}>
                <option value="">Не установлено</option>{field==="operatingModeKey"?
                  <option value="CAST_IN_PLACE_LOAD_BEARING_WALL">Несущая монолитная стена подтверждена</option>:
                  <option value="CONCRETE_COMPRESSIVE_STRENGTH_CLASS">Проектный класс бетона по прочности на сжатие</option>}
              </select>:<input value={draft.identity[field]??""} maxLength={200}
                onChange={event=>editWallIdentity({identity:{...draft.identity,[field]:event.target.value}})}/>}
            </label>)}
          </>}
          {wallMode&&key===WALL_FLOOR_CONTEXT&&<label>Один общий этаж стены
            <select aria-label="Один общий этаж стены" value={draft.wallFloor??""}
              onChange={event=>editWallIdentity({wallFloor:event.target.value})}>
              <option value="">Не установлен</option>{wallFloors.map(floor=><option key={floor} value={floor}>{floor}</option>)}
            </select><small>Ровно один этаж; диапазон и соседний этаж не подходят. Зона берётся из явно указанной идентичности стены.</small>
          </label>}
          {concreteProse&&key==="ELEMENT_IDENTITY"&&<>
            <p>Сопоставьте ту же несущую монолитную лестницу или явно согласованную группу в одном корпусе и зоне. Общее указание для всех корпусов не устанавливает связь с конкретным маршем автоматически.</p>
            {identityFields.map(field=><label key={field}>{concreteIdentityLabels[field]}
              {field==="operatingModeKey"||field==="measurementBasisKey"?<select aria-label={concreteIdentityLabels[field]}
                value={draft.identity[field]??""} onChange={event=>{edit({identity:{...draft.identity,[field]:event.target.value}});editContext(key,{reviewed:false});editContext("MATERIAL_CLASS_BASIS",{reviewed:false});}}>
                <option value="">Не установлено</option>{field==="operatingModeKey"?
                  <option value="CAST_IN_PLACE_LOAD_BEARING_STAIR">Несущая монолитная лестничная конструкция подтверждена</option>:
                  <option value="CONCRETE_COMPRESSIVE_STRENGTH_CLASS">Проектный класс бетона по прочности на сжатие</option>}
              </select>:<input value={draft.identity[field]??""} maxLength={200} onChange={event=>{edit({identity:{...draft.identity,[field]:event.target.value}});editContext(key,{reviewed:false});}}/>}
            </label>)}
          </>}
          {(concreteProse||wallMode)&&key==="MATERIAL_CLASS_BASIS"&&<p>Проверьте именно класс прочности бетона на сжатие. Марки морозостойкости F, водонепроницаемости W, подвижность смеси и прочность при распалубке не заменяют проектный класс.</p>}
          {key.startsWith("ATOMIC_SUBRULE_SCOPE:") && rule?.subruleContext && <>
            {rule.subruleContext.componentRole === "WORKING_REINFORCEMENT_POSITION" && <p>Проверьте, что исходная декларация относится к той же рабочей арматуре выбранной конструкции. Форшахта, основные конструкции, монтажная арматура и закладные детали не отождествляются. Правило проверяет только явно указанный в каталоге переход А500С в А400; другие классы и общая шкала пластичности не определяются.</p>}
            <p>В сравниваемых источниках используйте одинаковые ключи для одной позиции и расчётной точки.</p>
            {rule.subruleContext.componentRole === "PROJECT_ZERO_DATUM" && <p>Подтвердите одинаковые здание, принятый ноль, соответствующий чистый пол и высотную систему. Пол вестибюля и пол первого этажа автоматически не отождествляются. Контрольные точки и независимая геопривязка здесь не подтверждаются.</p>}
            {rule.subruleContext.componentRole === "SIDEWALK_TILE_PAVING" && <p>Площади по грунту и на кровле проверяйте отдельно. Общая площадь твёрдых покрытий не заменяет площадь плитки.</p>}
            {rule.subruleContext.componentRole === "TERRITORY_FENCE_SEGMENT" && <p>Проверьте тот же участок, тип и функцию ограждения территории. Высота панели, лестничного ограждения или ограждения котлована не заменяет высоту от готового грунта.</p>}
            {!!stairBases[rule.subruleContext.componentRole] && <p>Проверьте размер ступени после отделки, одинаковые марш и ступень. Число ступеней, уклон и номинальный размер не заменяют этот размер. Применимость нормы и исключения проверяются отдельно.</p>}
            {!!egressBases[rule.subruleContext.componentRole] && <p>Проверьте свободную высоту после отделки. Высота полотна, строительного проёма и помещения сама по себе не подтверждает этот размер.</p>}
            {rule.subruleContext.identityFields.map(field => <label key={field}>{labelsForRole(rule.subruleContext!.componentRole)[field as IdentityField] ?? field}
              {measuredBases[rule.subruleContext!.componentRole] && (field === "measurementBasisKey" || field === "operatingModeKey" && rule.subruleContext!.componentRole !== "PROJECT_ZERO_DATUM")
                ? <select aria-label={labelsForRole(rule.subruleContext!.componentRole)[field as IdentityField]} value={draft.identity[field as IdentityField] ?? ""}
                  onChange={event => { edit({ identity: { ...draft.identity, [field]: event.target.value } }); editContext(key, { reviewed: false }); }}>
                  <option value="">Не установлено</option>
                  {field === "operatingModeKey" ? rule.subruleContext!.componentRole === "WORKING_REINFORCEMENT_POSITION"
                    ? <option value="WORKING_NOT_CONSTRUCTIVE_ASSEMBLY_OR_EMBEDDED">Рабочая арматура выбранной конструкции подтверждена</option>
                    : rule.subruleContext!.componentRole === "TERRITORY_FENCE_SEGMENT"
                    ? <option value="TERRITORY_BOUNDARY">Граница территории подтверждена</option>
                    : <option value="EVACUATION">Маршрут эвакуации подтверждён</option>
                    : <option value={measuredBases[rule.subruleContext!.componentRole].value}>{measuredBases[rule.subruleContext!.componentRole].label}</option>}
                </select>
                : <input value={draft.identity[field as IdentityField] ?? ""} maxLength={200} onChange={event => {
                edit({ identity: { ...draft.identity, [field]: event.target.value } }); editContext(key, { reviewed: false });
              }} />}</label>)}
          </>}
          {key === PROJECT_ZERO_AUTHORITY && (fact.stage === "PD" ? <p>Отметьте условие только после проверки: этот оригинал ПД действительно служит утверждённым геодезическим основанием проектного нуля. Согласование всего файла само по себе этого не подтверждает.</p> : <>
            <p>Выберите явно подтверждённое основание ПД. Ссылка сохраняется на конкретную строку и версию решения; после изменения решения ПД требуется повторная проверка.</p>
            <label>Основание ПД<select aria-label="Основание ПД" value={context.projectZeroAuthorityKey ?? ""}
              onChange={event => editContext(key, { projectZeroAuthorityKey: event.target.value, reviewed: false })}>
              <option value="">Не выбрано</option>{projectZeroAuthorities.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select></label>
            {!projectZeroAuthorities.length && <p role="status">Действующих подтверждённых оснований ПД нет. Сначала проверьте исходную строку ПД и сохраните отдельное решение по источнику.</p>}
          </>)}
          {key === "NORM_APPLICABILITY_VERIFIED" && <>
            <p>Порог из правила: {rule.threshold?.value ?? "не задан"} {rule.canonicalUnit}{rule.threshold?.strict ? "; строгая граница" : ""}.</p>
            <label><input type="checkbox" checked={context.applicable === true} onChange={event => editContext(key, {
              applicable: event.target.checked, reviewed: false })} />Нормативное требование применимо к этому элементу; проверено по оригиналу.</label>
          </>}
          {key === "TECHNICAL_CONDITIONS_LIMIT" && <label>Проверенный лимит ТУ, {rule.canonicalUnit}
            <input inputMode="decimal" value={context.limitValue ?? ""} maxLength={60}
              onChange={event => editContext(key, { limitValue: event.target.value, reviewed: false })} /></label>}
          {key === "APPROVED_CHANGE_STATUS" && <label>Согласованное изменение<select aria-label="Согласованное изменение" value={context.approvedChangeStatus ?? ""}
            onChange={event => editContext(key, { approvedChangeStatus: event.target.value as MatrixFactContextDraft["approvedChangeStatus"], reviewed: false })}>
            <option value="">Не установлено</option><option value="ABSENT">Согласованное изменение отсутствует</option>
            <option value="PRESENT">Согласованное изменение есть</option></select></label>}
          {key === "THERMAL_RESISTANCE_REDUCTION_VERIFIED" && <label><input type="checkbox" checked={context.reductionConfirmed === true}
            onChange={event => editContext(key, { reductionConfirmed: event.target.checked, reviewed: false })} />Снижение сопротивления теплопередаче подтверждено.</label>}
          <label>Основание условия<textarea aria-label="Основание условия" rows={2} maxLength={1000} value={context.reference}
            onChange={event => editContext(key, { reference: event.target.value, reviewed: false })} /></label>
          <label><input type="checkbox" checked={context.reviewed} disabled={!matrixFactScopeContextLabel(key)}
            onChange={event => editContext(key, { reviewed: event.target.checked })} />
            Условие «{matrixFactScopeContextLabel(key) ?? "Дополнительное условие правила"}» проверено для этой строки и этого правила.</label>
        </fieldset>;
      })}
      {rule && <fieldset><legend>Раздел листа по штампу, если проверен отдельно</legend>
        <label>Раздел<select value={draft.drawingSection} onChange={event => edit({ drawingSection: event.target.value, drawingSectionReviewed: false })}>
          <option value="">Не подтверждаю отдельно</option>{[...new Set([...rule.expectedSections, ...rule.actualSections])].map(section => <option key={section}>{section}</option>)}
        </select></label>
        <label>Основание раздела<textarea rows={2} maxLength={1000} value={draft.drawingSectionReference}
          onChange={event => edit({ drawingSectionReference: event.target.value, drawingSectionReviewed: false })} /></label>
        <label><input type="checkbox" checked={draft.drawingSectionReviewed} onChange={event => edit({ drawingSectionReviewed: event.target.checked })} />Раздел этой строки проверен по штампу.</label>
      </fieldset>}
      {!concreteProse&&(wallMode ? !!fact.contextFragments?.length : !!fact.contextFragments?.some(part => ["ATTRIBUTE_HEADER", "TABLE_SCOPE"].includes(part.role))) && <fieldset><legend>{wallMode?"Связь строки со всеми исходными контекстными фрагментами":"Связь строки с контекстом таблицы"}</legend>
        <p>{wallMode?"Сверьте класс, область стены и все исходные контекстные фрагменты на страницах:":"Сверьте строку, заголовок и область таблицы на всех указанных страницах:"} {[...new Set((fact.contextFragments??[]).map(part => part.pageNumber))].join(", ")}.</p>
        <p>Это решение не подтверждает OCR-транскрипцию, редакцию, согласование источника или полноту области.</p>
        {!fragmentsHash && <p role="status">Адрес контекстных фрагментов ещё не получен. Подтверждение таблицы недоступно.</p>}
        <label>{wallMode?"Основание связи с исходным контекстом стены":"Основание связи с таблицей"}<textarea rows={2} maxLength={1000} value={draft.tableContextReference}
          onChange={event => edit({ tableContextReference: event.target.value, tableContextReviewed: false })} /></label>
        <label><input type="checkbox" checked={draft.tableContextReviewed} disabled={!/^[a-f0-9]{64}$/u.test(fragmentsHash ?? "")}
          onChange={event => edit({ tableContextReviewed: event.target.checked })} />{wallMode?"Связь этой строки со всеми исходными контекстными фрагментами стены проверена.":"Связь этой строки со всеми контекстными фрагментами таблицы проверена."}</label>
      </fieldset>}
      <label><input type="checkbox" checked={draft.identityReviewed} onChange={event => setDraft(previous => ({ ...previous, identityReviewed: event.target.checked }))} />
        Идентичность указанного элемента проверена по исходной строке. Отмеченные условия относятся к этому элементу.</label>
      {draft.identityReviewed && prepared.error && <p role="alert">{prepared.error}</p>}
      <button type="button" className="button button--secondary" disabled={disabled || !prepared.scope} onClick={apply}>Добавить привязку в черновик</button>
    </fieldset>}
    {message && <p role="status">{message}</p>}
    <div aria-label="Привязки в черновике"><h4>Привязки в черновике: {value?.bindings.length ?? 0}</h4>
      {!value?.bindings.length && <p>Привязок нет. Полнота области и идентичность соседних строк не подтверждены.</p>}
      {value?.bindings.map(binding => <article key={`${binding.target.observationId}:${binding.ruleId}`}>
        <strong>{binding.parameterCode} · {binding.entityKey}</strong>
        <p>{binding.target.observationId === fact.id ? "Выбранная строка" : "Другая исходная строка"} · {binding.reference}</p>
        <p>Проверено условий: {Object.keys(binding.contexts).length}.{!["PZ-009", "KR-057"].includes(binding.parameterCode) && <> Контекст таблицы: {binding.tableContextReview ? "отдельно проверен" : "не подтверждён"}.</>}</p>
        {binding.contexts[PROJECT_ZERO_AUTHORITY]?.projectZeroAuthority && <p>Основание проектного нуля: PDF {binding.contexts[PROJECT_ZERO_AUTHORITY].projectZeroAuthority!.pageNumber} · {binding.contexts[PROJECT_ZERO_AUTHORITY].projectZeroAuthority!.reviewContentHash ? "ссылка на сохранённое решение ПД" : "явное подтверждение исходной строки ПД"}.</p>}

        <button type="button" className="button button--secondary" disabled={disabled} onClick={() => {
          onChange(removeMatrixFactScopeBinding(value, binding.target.observationId, binding.ruleId));
          setDraft(previous => ({ ...previous, identityReviewed: false }));
          setMessage("Привязка удалена из черновика. Сохраните решение по источнику и запустите новую проверку.");
        }}>Удалить привязку {binding.parameterCode} · {binding.entityKey}</button>
      </article>)}
    </div>
  </section>;
}
