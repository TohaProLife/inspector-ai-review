import { canonicalJson, sha256 } from "./canonical-json.js";

// API-owned copy of the versioned worker allowlist. Keep the canonical SHA pin
// in sync with unresolved-config-review.ts when deliberately changing it.
const config = {
  "bounds": {
    "maxLeadsPerCode": 16,
    "maxLineChars": 500,
    "maxTextArtifactBytes": 67108864
  },
  "entries": [
    {
      "allowedSourceRoles": [
        {
          "section": "PZ",
          "stage": "PD"
        },
        {
          "section": "AR",
          "stage": "RD"
        }
      ],
      "anchors": [
        "полезная площадь",
        "расчетная площадь",
        "расчётная площадь"
      ],
      "candidateExtractorFamily": "AREA_PROGRAM",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "PZ-003",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "APPROVAL_OR_CONTEXT",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "TABLE_ROW_GEOMETRY",
        "PROGRAM_CONTEXT"
      ],
      "specificProofDependency": "полезное назначение площадей и перевод конкретных помещений в технические зоны"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "PZ",
          "stage": "PD"
        },
        {
          "section": "AR",
          "stage": "RD"
        }
      ],
      "anchors": [
        "квартирография",
        "состав квартир",
        "экспликация квартир"
      ],
      "candidateExtractorFamily": "AREA_PROGRAM",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "PZ-011",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "COMPOSITE_TRIGGER",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "TABLE_ROW_GEOMETRY",
        "PROGRAM_CONTEXT"
      ],
      "specificProofDependency": "структуру квартир по типам и помещениям, а не только общее число квартир"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "PZ",
          "stage": "PD"
        },
        {
          "section": "GP",
          "stage": "RD"
        }
      ],
      "anchors": [
        "коэффициент застройки"
      ],
      "candidateExtractorFamily": "AREA_PROGRAM",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "PZ-019",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "NORMATIVE_OR_APPLICABILITY",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "TABLE_ROW_GEOMETRY",
        "PROGRAM_CONTEXT",
        "APPLICABLE_NORM"
      ],
      "specificProofDependency": "расчёт КЗ и утверждённое применимое предельное значение"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "PZ",
          "stage": "PD"
        },
        {
          "section": "GP",
          "stage": "RD"
        }
      ],
      "anchors": [
        "коэффициент использования территории",
        "коэффициент интенсивности застройки"
      ],
      "candidateExtractorFamily": "AREA_PROGRAM",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "PZ-020",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "NORMATIVE_OR_APPLICABILITY",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "TABLE_ROW_GEOMETRY",
        "PROGRAM_CONTEXT",
        "APPLICABLE_NORM"
      ],
      "specificProofDependency": "расчёт КИТ и утверждённую для участка рамку плотности"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "GP",
          "stage": "PD"
        },
        {
          "section": "GP",
          "stage": "RD"
        }
      ],
      "anchors": [
        "площадь озеленения",
        "площадь газонов"
      ],
      "candidateExtractorFamily": "AREA_PROGRAM",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "SPZU-027",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "NORMATIVE_OR_APPLICABILITY",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "TABLE_ROW_GEOMETRY",
        "PROGRAM_CONTEXT",
        "APPLICABLE_NORM"
      ],
      "specificProofDependency": "площадь озеленения и применимое минимальное требование ГПЗУ"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "GP",
          "stage": "PD"
        },
        {
          "section": "GP",
          "stage": "RD"
        }
      ],
      "anchors": [
        "детская площадка",
        "спортивная площадка",
        "площадь площадок"
      ],
      "candidateExtractorFamily": "AREA_PROGRAM",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "SPZU-028",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "NORMATIVE_OR_APPLICABILITY",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "TABLE_ROW_GEOMETRY",
        "PROGRAM_CONTEXT",
        "APPLICABLE_NORM"
      ],
      "specificProofDependency": "вид площадки, её площадь и применимое требование для состава объекта"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "AR",
          "stage": "PD"
        },
        {
          "section": "AR",
          "stage": "RD"
        }
      ],
      "anchors": [
        "оконные блоки",
        "ведомость заполнения оконных проемов",
        "ведомость оконных блоков"
      ],
      "candidateExtractorFamily": "AREA_PROGRAM",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "AR-046",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "COMPOSITE_TRIGGER",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "TABLE_ROW_GEOMETRY",
        "PROGRAM_CONTEXT"
      ],
      "specificProofDependency": "набор окон конкретных помещений и площадь их остекления"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "PZ",
          "stage": "PD"
        },
        {
          "section": "AR",
          "stage": "RD"
        },
        {
          "section": "KR",
          "stage": "RD"
        }
      ],
      "anchors": [
        "строительный объем подземной части",
        "строительный объём подземной части",
        "объем подземной части",
        "объём подземной части"
      ],
      "candidateExtractorFamily": "DIMENSION_LAYOUT",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "PZ-005",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "GEOMETRY_OR_TOPOLOGY",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "DRAWING_GEOMETRY",
        "DIMENSION_OBJECT"
      ],
      "specificProofDependency": "подземный контур, отметки и объём того же паркинга или подвала"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "GP",
          "stage": "PD"
        },
        {
          "section": "GP",
          "stage": "RD"
        }
      ],
      "anchors": [
        "радиус поворота",
        "радиус закругления",
        "радиусы закруглений"
      ],
      "candidateExtractorFamily": "DIMENSION_LAYOUT",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "SPZU-031",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "NORMATIVE_OR_APPLICABILITY",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "DRAWING_GEOMETRY",
        "DIMENSION_OBJECT",
        "APPLICABLE_NORM"
      ],
      "specificProofDependency": "радиус конкретного поворота пожарного проезда и применимую норму"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "GP",
          "stage": "PD"
        },
        {
          "section": "GP",
          "stage": "RD"
        }
      ],
      "anchors": [
        "уклон дороги",
        "уклон проезда",
        "проектный уклон"
      ],
      "candidateExtractorFamily": "DIMENSION_LAYOUT",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "SPZU-033",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "GEOMETRY_OR_TOPOLOGY",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "DRAWING_GEOMETRY",
        "DIMENSION_OBJECT",
        "APPLICABLE_NORM"
      ],
      "specificProofDependency": "уклон участка дороги, направление стока и проектные отметки"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "AR",
          "stage": "PD"
        },
        {
          "section": "AR",
          "stage": "RD"
        }
      ],
      "anchors": [
        "высота проема",
        "высота проёма",
        "чистая высота коридора",
        "высота пути эвакуации"
      ],
      "candidateExtractorFamily": "DIMENSION_LAYOUT",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "AR-042",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "COMPOSITE_TRIGGER",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "DRAWING_GEOMETRY",
        "DIMENSION_OBJECT",
        "APPLICABLE_NORM"
      ],
      "specificProofDependency": "тип проёма или коридора, чистую высоту и применимую норму"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "AR",
          "stage": "PD"
        },
        {
          "section": "AR",
          "stage": "RD"
        }
      ],
      "anchors": [
        "глубина тамбура",
        "ширина тамбура",
        "габариты тамбура"
      ],
      "candidateExtractorFamily": "DIMENSION_LAYOUT",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "AR-047",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "NORMATIVE_OR_APPLICABILITY",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "DRAWING_GEOMETRY",
        "DIMENSION_OBJECT",
        "APPLICABLE_NORM"
      ],
      "specificProofDependency": "геометрию конкретного тамбура и применимость требования для коляски"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "AR",
          "stage": "PD"
        },
        {
          "section": "AR",
          "stage": "RD"
        }
      ],
      "anchors": [
        "лестничный марш",
        "высота подступенка",
        "ширина проступи",
        "количество ступеней"
      ],
      "candidateExtractorFamily": "DIMENSION_LAYOUT",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "AR-048",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "COMPOSITE_TRIGGER",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "DRAWING_GEOMETRY",
        "DIMENSION_OBJECT",
        "APPLICABLE_NORM"
      ],
      "specificProofDependency": "число ступеней и размеры проступи и подступенка конкретного марша"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "AR",
          "stage": "PD"
        },
        {
          "section": "AR",
          "stage": "RD"
        }
      ],
      "anchors": [
        "коэффициент естественной освещенности",
        "коэффициент естественной освещённости",
        "расчет кео",
        "расчёт кео"
      ],
      "candidateExtractorFamily": "DIMENSION_LAYOUT",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "AR-051",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "GEOMETRY_OR_TOPOLOGY",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "DRAWING_GEOMETRY",
        "DIMENSION_OBJECT",
        "APPLICABLE_NORM"
      ],
      "specificProofDependency": "конфигурацию переплётов и расчёт влияния на светопропускание"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "KR",
          "stage": "PD"
        },
        {
          "section": "KR",
          "stage": "RD"
        }
      ],
      "anchors": [
        "сечение колонны",
        "сечение пилона",
        "поперечное сечение колонны"
      ],
      "candidateExtractorFamily": "DIMENSION_LAYOUT",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "KR-060",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "GEOMETRY_OR_TOPOLOGY",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "DRAWING_GEOMETRY",
        "DIMENSION_OBJECT"
      ],
      "specificProofDependency": "оба размера поперечного сечения той же несущей колонны или пилона"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "POS",
          "stage": "PD"
        }
      ],
      "anchors": [
        "ширина временной дороги",
        "ширина временного проезда",
        "ширина автодороги"
      ],
      "candidateExtractorFamily": "DIMENSION_LAYOUT",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "POS-084",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "NORMATIVE_OR_APPLICABILITY",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "DRAWING_GEOMETRY",
        "DIMENSION_OBJECT",
        "APPLICABLE_NORM"
      ],
      "specificProofDependency": "чистую ширину участка дороги и применимый нормативный класс проезда"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "ODI",
          "stage": "PD"
        },
        {
          "section": "AR",
          "stage": "RD"
        }
      ],
      "anchors": [
        "ширина коридора мгн",
        "ширина коридора для мгн",
        "ширина пути движения мгн"
      ],
      "candidateExtractorFamily": "DIMENSION_LAYOUT",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "ODI-116",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "NORMATIVE_OR_APPLICABILITY",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "DRAWING_GEOMETRY",
        "DIMENSION_OBJECT",
        "APPLICABLE_NORM"
      ],
      "specificProofDependency": "чистую ширину коридора МГН и применимый нормативный случай"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "ODI",
          "stage": "PD"
        },
        {
          "section": "AR",
          "stage": "PD"
        },
        {
          "section": "AR",
          "stage": "RD"
        }
      ],
      "anchors": [
        "ширина дверного проема в свету",
        "ширина дверного проёма в свету",
        "ширина прохода в свету"
      ],
      "candidateExtractorFamily": "DIMENSION_LAYOUT",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "ODI-117",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "NORMATIVE_OR_APPLICABILITY",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "DRAWING_GEOMETRY",
        "DIMENSION_OBJECT",
        "APPLICABLE_NORM"
      ],
      "specificProofDependency": "ширину двери в свету, а не ширину полотна, и применимую норму"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "ODI",
          "stage": "PD"
        },
        {
          "section": "AR",
          "stage": "RD"
        },
        {
          "section": "VK",
          "stage": "RD"
        }
      ],
      "anchors": [
        "универсальная кабина",
        "габариты санузла мгн",
        "санузел для инвалидов"
      ],
      "candidateExtractorFamily": "DIMENSION_LAYOUT",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "ODI-119",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "NORMATIVE_OR_APPLICABILITY",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "DRAWING_GEOMETRY",
        "DIMENSION_OBJECT",
        "APPLICABLE_NORM"
      ],
      "specificProofDependency": "внутренний контур универсальной кабины и применимый нормативный случай"
    }
  ],
  "executionPolicy": "REVIEW_ONLY_ABSTAIN",
  "matching": "ANY_LITERAL_LOWERCASE_COLLAPSE_WHITESPACE",
  "registrySha256": "fdc6a69544e06513ee37baa20ad21a1c5c1bc711b04907491becc3283604a87a",
  "schemaVersion": "unresolved-review-config-v1",
  "strategySha256": "0e9519b426c93fa9eaefe7416d6ced893c212ff3deb198d87e70eedf884d5514",
  "version": "1"
};
const configSha256 = "c5aedccb8752ef365ea18298e1ed222f97abd207607b8caf5a18f23fd547bc85";
if (sha256(canonicalJson(config)) !== configSha256) {
  throw new Error("unresolved review config SHA pin mismatch");
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const pinnedUnresolvedReviewConfig = deepFreeze(config);
