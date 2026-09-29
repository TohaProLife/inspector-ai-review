import { canonicalJson, sha256 } from "./canonical-json.js";

// API-owned copy of the audited v3 allowlist. Its SHA pin is checked at load.
const config = {
  "auditedRenderProfile": "pdftoppm-100dpi-png-singlefile",
  "bounds": {
    "maxLeadsPerCode": 16,
    "maxLineChars": 500,
    "maxTextArtifactBytes": 67108864
  },
  "entries": [
    {
      "allowedSourceRoles": [
        {
          "section": "IOS1",
          "stage": "PD"
        },
        {
          "section": "EOM",
          "stage": "PD"
        },
        {
          "section": "EOM",
          "stage": "RD"
        }
      ],
      "anchorEvidence": [
        {
          "lineText": "4.  Номинальный  ток  защитных  автоматов  необходимо  опреде-",
          "pageNumber": 249,
          "renderSha256": "d1f222d09970bebe86306186d688f9b637643092e3db45e382094fa912920da3",
          "sourceFileId": "F0148",
          "sourceSha256": "e4b188ce7f815a95dc7be708135943b6f6bdbfeb61422305ff2a2d6f59ca36bd"
        }
      ],
      "anchors": [
        "номинальный ток защитных автоматов"
      ],
      "candidateExtractorFamily": "NETWORK_TOPOLOGY",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "IOS1-068",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "COMPOSITE_TRIGGER",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "DRAWING_GEOMETRY",
        "GRAPH_CONNECTIVITY",
        "CIRCUIT_DEVICE_ASSIGNMENT"
      ],
      "specificProofDependency": "назначение аппарата, ток уставки и согласование с защищаемой цепью"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "IOS1",
          "stage": "PD"
        },
        {
          "section": "EOM",
          "stage": "PD"
        },
        {
          "section": "EOM",
          "stage": "RD"
        }
      ],
      "anchorEvidence": [
        {
          "lineText": "кабели марки ВВГнг(А)-FRLS.  Электропроводку питания линий аварийного освещения со встроенными ",
          "pageNumber": 21,
          "renderSha256": "552775ce8c4fa8a02c1416e97f1e6782467160b74b911b2e42c134422b9f840b",
          "sourceFileId": "F0128",
          "sourceSha256": "7f3737225014e681de43ce118ae29633492dd84d6ba36cb28c1d115141ac8fca"
        }
      ],
      "anchors": [
        "кабели марки ввгнг(а)-frls"
      ],
      "candidateExtractorFamily": "NETWORK_TOPOLOGY",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "IOS1-069",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "COMPOSITE_TRIGGER",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "DRAWING_GEOMETRY",
        "GRAPH_CONNECTIVITY",
        "CABLE_LINE_ASSIGNMENT",
        "APPLICABLE_NORM"
      ],
      "specificProofDependency": "сечение, марку и назначение каждой кабельной линии"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "IOS1",
          "stage": "PD"
        },
        {
          "section": "EOM",
          "stage": "PD"
        },
        {
          "section": "EOM",
          "stage": "RD"
        }
      ],
      "anchorEvidence": [
        {
          "lineText": "Полоса металлическая, 40х4 (для контура заземления ",
          "pageNumber": 20,
          "renderSha256": "2a72089ff7f36db3bb6ac1d12120147b0ff42dd33718362a481ed471a8021e4f",
          "sourceFileId": "F0162",
          "sourceSha256": "79a3cc7d7ca5a1df4093b26b0bd739c8f299f1d5739b18e04a9cdcf44e0c4946"
        }
      ],
      "anchors": [
        "полоса металлическая, 40х4"
      ],
      "candidateExtractorFamily": "NETWORK_TOPOLOGY",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "IOS1-070",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "COMPOSITE_TRIGGER",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "DRAWING_GEOMETRY",
        "GRAPH_CONNECTIVITY",
        "GROUNDING_CIRCUIT_CLOSURE"
      ],
      "specificProofDependency": "связность контура и количество элементов заземления и молниезащиты"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "IOS4",
          "stage": "PD"
        },
        {
          "section": "OV",
          "stage": "PD"
        },
        {
          "section": "OV",
          "stage": "RD"
        }
      ],
      "anchorEvidence": [
        {
          "lineText": "В здании запроектирована двухтрубная, стояковая, с тупиковым и ",
          "pageNumber": 11,
          "renderSha256": "259fb42cb771b947743b01030fb4ca6a57e062aba54c2443adfa3e2175d82710",
          "sourceFileId": "F0171",
          "sourceSha256": "a9070055b75adeea0d47651cf9dca3ca818ca5f54ac7ce9ddcd86efc817db7dc"
        }
      ],
      "anchors": [
        "двухтрубная, стояковая"
      ],
      "candidateExtractorFamily": "NETWORK_TOPOLOGY",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "IOS4-076",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "COMPOSITE_TRIGGER",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "DRAWING_GEOMETRY",
        "GRAPH_CONNECTIVITY",
        "PIPE_BRANCH_ASSIGNMENT"
      ],
      "specificProofDependency": "диаметры Т1/Т2 и гидравлическую схему соответствующих ветвей"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "IOS4",
          "stage": "PD"
        },
        {
          "section": "OV",
          "stage": "PD"
        },
        {
          "section": "OV",
          "stage": "RD"
        }
      ],
      "anchorEvidence": [
        {
          "lineText": " Воздуховод из оцинкованной стали, класс гермет. «В», d=0,7 мм, 300х150",
          "pageNumber": 144,
          "renderSha256": "88826766e0a2a6b9d2499f91bebf54d7e7a1fbbb51b46a80b2f5909dae78b798",
          "sourceFileId": "F0171",
          "sourceSha256": "a9070055b75adeea0d47651cf9dca3ca818ca5f54ac7ce9ddcd86efc817db7dc"
        }
      ],
      "anchors": [
        "воздуховод из оцинкованной стали, класс гермет."
      ],
      "candidateExtractorFamily": "NETWORK_TOPOLOGY",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "IOS4-078",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "PUBLIC_MAPPING_CONFLICT",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "DRAWING_GEOMETRY",
        "GRAPH_CONNECTIVITY",
        "DUCT_SECTION_GEOMETRY"
      ],
      "specificProofDependency": "форму и размеры воздуховода и площадь живого сечения в той же ветви"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "PPM",
          "stage": "PD"
        },
        {
          "section": "OV",
          "stage": "PD"
        },
        {
          "section": "OV",
          "stage": "RD"
        }
      ],
      "anchorEvidence": [
        {
          "lineText": "- дымовые и огнезадерживающие клапаны «Венткомфорт ВКП»  или их ",
          "pageNumber": 19,
          "renderSha256": "621727d933bf5ac87b9e0e86af84cce43fa0106ce038277a0a6fa812083a8709",
          "sourceFileId": "F0171",
          "sourceSha256": "a9070055b75adeea0d47651cf9dca3ca818ca5f54ac7ce9ddcd86efc817db7dc"
        }
      ],
      "anchors": [
        "дымовые и огнезадерживающие клапаны"
      ],
      "candidateExtractorFamily": "NETWORK_TOPOLOGY",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "PPM-111",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "COMPOSITE_TRIGGER",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "DRAWING_GEOMETRY",
        "GRAPH_CONNECTIVITY",
        "BARRIER_PENETRATION",
        "APPLICABLE_NORM"
      ],
      "specificProofDependency": "пересечение воздуховода с преградой и клапан нужного предела"
    },
    {
      "allowedSourceRoles": [
        {
          "section": "PPM",
          "stage": "PD"
        },
        {
          "section": "VK",
          "stage": "PD"
        },
        {
          "section": "VK",
          "stage": "RD"
        },
        {
          "section": "NVK",
          "stage": "RD"
        }
      ],
      "anchorEvidence": [
        {
          "lineText": "внутреннего пожаротушения 20.2 л/сек.  ",
          "pageNumber": 8,
          "renderSha256": "df717730876399f5aa6ac8d5ab7fd2c03fd3604c5725b7f3f108fa0cba3e51ab",
          "sourceFileId": "F0163",
          "sourceSha256": "18282c9104974a462338ff2d246bf081545bdfcafde1a85ee5e6d4ca54584861"
        }
      ],
      "anchors": [
        "внутреннего пожаротушения 20.2 л/сек."
      ],
      "candidateExtractorFamily": "NETWORK_TOPOLOGY",
      "locatorType": "TEXT_LINE_BBOX_ONLY",
      "parameterCode": "PPM-113",
      "registryClassification": "UNRESOLVED",
      "registryReasonCode": "COMPOSITE_TRIGGER",
      "requiredProofGates": [
        "APPROVED_SOURCE_REVISIONS",
        "VERIFIED_SECTION_STAGE",
        "SAME_ELEMENT_OR_SPACE",
        "PD_RD_PAIR",
        "DRAWING_GEOMETRY",
        "GRAPH_CONNECTIVITY",
        "FIRE_WATER_NETWORK",
        "HYDRAULIC_CONTEXT"
      ],
      "specificProofDependency": "диаметр кольцевой сети и количество пожарных кранов"
    }
  ],
  "executionPolicy": "REVIEW_ONLY_ABSTAIN",
  "matching": "ANY_LITERAL_LOWERCASE_COLLAPSE_WHITESPACE",
  "registrySha256": "fdc6a69544e06513ee37baa20ad21a1c5c1bc711b04907491becc3283604a87a",
  "schemaVersion": "unresolved-review-config-v3",
  "strategySha256": "0e9519b426c93fa9eaefe7416d6ced893c212ff3deb198d87e70eedf884d5514",
  "version": "3"
};
const configSha256 = "ca9fb46fa07a5ccb32f8176b88bebede90b5b30875a29257465da5259b84365a";
if (sha256(canonicalJson(config)) !== configSha256) {
  throw new Error("unresolved review v3 config SHA pin mismatch");
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const pinnedUnresolvedReviewConfigV3 = deepFreeze(config);
