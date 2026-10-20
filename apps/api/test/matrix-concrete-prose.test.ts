import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractConcreteCandidates, CONCRETE_EXTRACTOR_VERSION } from "../src/matrix-concrete-prose.js";
const fixture=JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/rebar-F0106-F0139.json",import.meta.url),"utf8"));
// Independent research expectations, frozen before production implementation.
const golden=[
  {
    "name": "original-PD",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": false,
    "operations": [],
    "expectedCandidates": [
      {
        "value": "В30",
        "rawValue": "В30",
        "rawUnit": "B_CLASS",
        "canonicalUnit": "B_CLASS",
        "primaryFragments": [
          {
            "pageNumber": 50,
            "blockIndex": 3,
            "lineIndex": 0,
            "rawText": "Лестницы, лестничные площадки всех корпусов В30.",
            "bboxMilliPoints": [
              106320,
              698448,
              380184,
              710448
            ]
          }
        ],
        "contextFragments": [
          {
            "pageNumber": 49,
            "blockIndex": 10,
            "lineIndex": 0,
            "rawText": "Для  железобетонных  конструкций  предусматривается  использование  тяжелого  бетона",
            "bboxMilliPoints": [
              106320,
              325008,
              559542,
              337008
            ],
            "role": "ATTRIBUTE_HEADER"
          },
          {
            "pageNumber": 49,
            "blockIndex": 10,
            "lineIndex": 1,
            "rawText": "по ГОСТ 7473-2010 и ГОСТ  26633-2012 и приняты следующие классы по прочности на сжатие:",
            "bboxMilliPoints": [
              70800,
              311328,
              559415,
              323328
            ],
            "role": "ATTRIBUTE_HEADER"
          },
          {
            "pageNumber": 50,
            "blockIndex": 0,
            "lineIndex": 0,
            "rawText": "Подземная часть",
            "bboxMilliPoints": [
              106320,
              800208,
              192336,
              812208
            ],
            "role": "MATERIAL_SCOPE"
          }
        ]
      }
    ]
  },
  {
    "name": "PD-explicit-token-B25",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 3,
        "line": 0,
        "from": "В30",
        "to": "B25"
      }
    ],
    "expectedCandidates": [
      {
        "value": "B25",
        "rawValue": "B25",
        "rawUnit": "B_CLASS",
        "canonicalUnit": "B_CLASS",
        "primaryFragments": [
          {
            "pageNumber": 50,
            "blockIndex": 3,
            "lineIndex": 0,
            "rawText": "Лестницы, лестничные площадки всех корпусов B25.",
            "bboxMilliPoints": [
              106320,
              698448,
              380184,
              710448
            ]
          }
        ],
        "contextFragments": [
          {
            "pageNumber": 49,
            "blockIndex": 10,
            "lineIndex": 0,
            "rawText": "Для  железобетонных  конструкций  предусматривается  использование  тяжелого  бетона",
            "bboxMilliPoints": [
              106320,
              325008,
              559542,
              337008
            ],
            "role": "ATTRIBUTE_HEADER"
          },
          {
            "pageNumber": 49,
            "blockIndex": 10,
            "lineIndex": 1,
            "rawText": "по ГОСТ 7473-2010 и ГОСТ  26633-2012 и приняты следующие классы по прочности на сжатие:",
            "bboxMilliPoints": [
              70800,
              311328,
              559415,
              323328
            ],
            "role": "ATTRIBUTE_HEADER"
          },
          {
            "pageNumber": 50,
            "blockIndex": 0,
            "lineIndex": 0,
            "rawText": "Подземная часть",
            "bboxMilliPoints": [
              106320,
              800208,
              192336,
              812208
            ],
            "role": "MATERIAL_SCOPE"
          }
        ]
      }
    ]
  },
  {
    "name": "PD-explicit-token-В25",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 3,
        "line": 0,
        "from": "В30",
        "to": "В25"
      }
    ],
    "expectedCandidates": [
      {
        "value": "В25",
        "rawValue": "В25",
        "rawUnit": "B_CLASS",
        "canonicalUnit": "B_CLASS",
        "primaryFragments": [
          {
            "pageNumber": 50,
            "blockIndex": 3,
            "lineIndex": 0,
            "rawText": "Лестницы, лестничные площадки всех корпусов В25.",
            "bboxMilliPoints": [
              106320,
              698448,
              380184,
              710448
            ]
          }
        ],
        "contextFragments": [
          {
            "pageNumber": 49,
            "blockIndex": 10,
            "lineIndex": 0,
            "rawText": "Для  железобетонных  конструкций  предусматривается  использование  тяжелого  бетона",
            "bboxMilliPoints": [
              106320,
              325008,
              559542,
              337008
            ],
            "role": "ATTRIBUTE_HEADER"
          },
          {
            "pageNumber": 49,
            "blockIndex": 10,
            "lineIndex": 1,
            "rawText": "по ГОСТ 7473-2010 и ГОСТ  26633-2012 и приняты следующие классы по прочности на сжатие:",
            "bboxMilliPoints": [
              70800,
              311328,
              559415,
              323328
            ],
            "role": "ATTRIBUTE_HEADER"
          },
          {
            "pageNumber": 50,
            "blockIndex": 0,
            "lineIndex": 0,
            "rawText": "Подземная часть",
            "bboxMilliPoints": [
              106320,
              800208,
              192336,
              812208
            ],
            "role": "MATERIAL_SCOPE"
          }
        ]
      }
    ]
  },
  {
    "name": "PD-explicit-token-B30",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 3,
        "line": 0,
        "from": "В30",
        "to": "B30"
      }
    ],
    "expectedCandidates": [
      {
        "value": "B30",
        "rawValue": "B30",
        "rawUnit": "B_CLASS",
        "canonicalUnit": "B_CLASS",
        "primaryFragments": [
          {
            "pageNumber": 50,
            "blockIndex": 3,
            "lineIndex": 0,
            "rawText": "Лестницы, лестничные площадки всех корпусов B30.",
            "bboxMilliPoints": [
              106320,
              698448,
              380184,
              710448
            ]
          }
        ],
        "contextFragments": [
          {
            "pageNumber": 49,
            "blockIndex": 10,
            "lineIndex": 0,
            "rawText": "Для  железобетонных  конструкций  предусматривается  использование  тяжелого  бетона",
            "bboxMilliPoints": [
              106320,
              325008,
              559542,
              337008
            ],
            "role": "ATTRIBUTE_HEADER"
          },
          {
            "pageNumber": 49,
            "blockIndex": 10,
            "lineIndex": 1,
            "rawText": "по ГОСТ 7473-2010 и ГОСТ  26633-2012 и приняты следующие классы по прочности на сжатие:",
            "bboxMilliPoints": [
              70800,
              311328,
              559415,
              323328
            ],
            "role": "ATTRIBUTE_HEADER"
          },
          {
            "pageNumber": 50,
            "blockIndex": 0,
            "lineIndex": 0,
            "rawText": "Подземная часть",
            "bboxMilliPoints": [
              106320,
              800208,
              192336,
              812208
            ],
            "role": "MATERIAL_SCOPE"
          }
        ]
      }
    ]
  },
  {
    "name": "PD-unsupported-token-В20",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 3,
        "line": 0,
        "from": "В30",
        "to": "В20"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-unsupported-token-B40",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 3,
        "line": 0,
        "from": "В30",
        "to": "B40"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-unsupported-token-B7,5",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 3,
        "line": 0,
        "from": "В30",
        "to": "B7,5"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-unsupported-token-F150",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 3,
        "line": 0,
        "from": "В30",
        "to": "F150"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-unsupported-token-W6",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 3,
        "line": 0,
        "from": "В30",
        "to": "W6"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-unsupported-token-П4",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 3,
        "line": 0,
        "from": "В30",
        "to": "П4"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-unsupported-token-50%",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 3,
        "line": 0,
        "from": "В30",
        "to": "50%"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-unsupported-token-30",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 3,
        "line": 0,
        "from": "В30",
        "to": "30"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-unsupported-token-В25/В30",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 3,
        "line": 0,
        "from": "В30",
        "to": "В25/В30"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-unsupported-token-В25–В30",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 3,
        "line": 0,
        "from": "В30",
        "to": "В25–В30"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-unsupported-token-В30 или В25",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 3,
        "line": 0,
        "from": "В30",
        "to": "В30 или В25"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-unsupported-token-В30.0",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 3,
        "line": 0,
        "from": "В30",
        "to": "В30.0"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-unsupported-token-В030",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 3,
        "line": 0,
        "from": "В30",
        "to": "В030"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-unsupported-token-В30x",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 3,
        "line": 0,
        "from": "В30",
        "to": "В30x"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-negated",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 3,
        "line": 0,
        "text": "Не Лестницы, лестничные площадки всех корпусов В30."
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-quoted",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 3,
        "line": 0,
        "text": "«Лестницы, лестничные площадки всех корпусов В30.»"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-suffix",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 3,
        "line": 0,
        "text": "Лестницы, лестничные площадки всех корпусов В30. Требуется уточнение."
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-missing-full-tail",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 3,
        "line": 0,
        "text": "Лестницы, лестничные площадки всех корпусов В30"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-generic-label",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 3,
        "line": 0,
        "text": "Класс бетона: В30"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-wrong-member",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 3,
        "line": 0,
        "text": "Фундаменты, лестничные площадки всех корпусов В30."
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-unicode-linebreak",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 3,
        "line": 0,
        "text": "Лестницы, лестничные площадки всех корпусов В30. "
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-control-character",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 3,
        "line": 0,
        "text": "Лестницы, лестничные площадки всех корпусов В30.\u0000"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-duplicate-primary",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "appendLine",
        "block": 0,
        "text": "Лестницы, лестничные площадки всех корпусов В30.",
        "box": [
          10000,
          10000,
          500000,
          22000
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-malformed-competing-primary",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "appendLine",
        "block": 0,
        "text": "Лестницы, лестничные площадки всех корпусов ???.",
        "box": [
          10000,
          10000,
          500000,
          22000
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-doubled-anchor-one-line",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 3,
        "line": 0,
        "text": "Лестницы, лестничные площадки всех корпусов В30. Лестницы, лестничные площадки всех корпусов В30."
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-split-competing-primary",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "appendBlock",
        "block": 0,
        "value": {
          "text": "Лестницы, лестничные\nплощадки всех корпусов В25.",
          "bboxMilliPoints": [
            10000,
            10000,
            500000,
            35680
          ],
          "lineBboxesMilliPoints": [
            [
              10000,
              23680,
              500000,
              35680
            ],
            [
              10000,
              10000,
              500000,
              22000
            ]
          ]
        }
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-geometry-fractional",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "box",
        "block": 3,
        "line": 0,
        "value": [
          106320.5,
          698448,
          380184,
          710448
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-geometry-boolean",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "box",
        "block": 3,
        "line": 0,
        "value": [
          true,
          698448,
          380184,
          710448
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-geometry-negative",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "box",
        "block": 3,
        "line": 0,
        "value": [
          -1,
          698448,
          380184,
          710448
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-geometry-unsafe",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "box",
        "block": 3,
        "line": 0,
        "value": [
          10000,
          10000,
          9007199254740992,
          22000
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-geometry-zero-area",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "box",
        "block": 3,
        "line": 0,
        "value": [
          10000,
          10000,
          10000,
          22000
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-geometry-too-tall",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "box",
        "block": 3,
        "line": 0,
        "value": [
          100000,
          500000,
          500000,
          550000
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-geometry-right-column",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "box",
        "block": 3,
        "line": 0,
        "value": [
          150000,
          698448,
          500000,
          710448
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-missing-line-geometry",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "set",
        "path": [
          "blocks",
          3,
          "lineBboxesMilliPoints"
        ],
        "value": []
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-bad-block-union",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "set",
        "path": [
          "blocks",
          3,
          "bboxMilliPoints"
        ],
        "value": [
          1,
          1,
          2,
          2
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-quality-ocr",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "set",
        "path": [
          "quality",
          "disposition"
        ],
        "value": "OCR_REQUIRED"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-extra-page-field",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "set",
        "path": [
          "sourceApproval"
        ],
        "value": "APPROVED"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-missing-page-field",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "dropKey",
        "key": "heightMilliPoints"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-ID-stage",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "stage",
        "value": "ID"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-wrong-stage",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "stage",
        "value": "RD"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-overlapping-text",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "appendLine",
        "block": 0,
        "text": "Посторонний текст",
        "box": [
          106320,
          698448,
          380184,
          710448
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "original-RD",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": false,
    "operations": [],
    "expectedCandidates": [
      {
        "value": "В30",
        "rawValue": "В30",
        "rawUnit": "B_CLASS",
        "canonicalUnit": "B_CLASS",
        "primaryFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 44,
            "lineIndex": 0,
            "rawText": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93.",
            "bboxMilliPoints": [
              97500,
              554871,
              832168,
              566750
            ]
          }
        ],
        "contextFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 1,
            "lineIndex": 3,
            "rawText": "В основном комплекте чертежей марки НСЛ-17-02/2026-1,2-КЖ1.1.9 разработаны железобетонные конструкции внутренних монолитных лестниц подземной части . При разработке были использованы",
            "bboxMilliPoints": [
              72000,
              1102371,
              798335,
              1114370
            ],
            "role": "MATERIAL_SCOPE"
          }
        ]
      }
    ]
  },
  {
    "name": "RD-explicit-token-B25",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 44,
        "line": 0,
        "from": "В30",
        "to": "B25"
      }
    ],
    "expectedCandidates": [
      {
        "value": "B25",
        "rawValue": "B25",
        "rawUnit": "B_CLASS",
        "canonicalUnit": "B_CLASS",
        "primaryFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 44,
            "lineIndex": 0,
            "rawText": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  B25,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93.",
            "bboxMilliPoints": [
              97500,
              554871,
              832168,
              566750
            ]
          }
        ],
        "contextFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 1,
            "lineIndex": 3,
            "rawText": "В основном комплекте чертежей марки НСЛ-17-02/2026-1,2-КЖ1.1.9 разработаны железобетонные конструкции внутренних монолитных лестниц подземной части . При разработке были использованы",
            "bboxMilliPoints": [
              72000,
              1102371,
              798335,
              1114370
            ],
            "role": "MATERIAL_SCOPE"
          }
        ]
      }
    ]
  },
  {
    "name": "RD-explicit-token-В25",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 44,
        "line": 0,
        "from": "В30",
        "to": "В25"
      }
    ],
    "expectedCandidates": [
      {
        "value": "В25",
        "rawValue": "В25",
        "rawUnit": "B_CLASS",
        "canonicalUnit": "B_CLASS",
        "primaryFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 44,
            "lineIndex": 0,
            "rawText": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В25,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93.",
            "bboxMilliPoints": [
              97500,
              554871,
              832168,
              566750
            ]
          }
        ],
        "contextFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 1,
            "lineIndex": 3,
            "rawText": "В основном комплекте чертежей марки НСЛ-17-02/2026-1,2-КЖ1.1.9 разработаны железобетонные конструкции внутренних монолитных лестниц подземной части . При разработке были использованы",
            "bboxMilliPoints": [
              72000,
              1102371,
              798335,
              1114370
            ],
            "role": "MATERIAL_SCOPE"
          }
        ]
      }
    ]
  },
  {
    "name": "RD-explicit-token-B30",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 44,
        "line": 0,
        "from": "В30",
        "to": "B30"
      }
    ],
    "expectedCandidates": [
      {
        "value": "B30",
        "rawValue": "B30",
        "rawUnit": "B_CLASS",
        "canonicalUnit": "B_CLASS",
        "primaryFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 44,
            "lineIndex": 0,
            "rawText": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  B30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93.",
            "bboxMilliPoints": [
              97500,
              554871,
              832168,
              566750
            ]
          }
        ],
        "contextFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 1,
            "lineIndex": 3,
            "rawText": "В основном комплекте чертежей марки НСЛ-17-02/2026-1,2-КЖ1.1.9 разработаны железобетонные конструкции внутренних монолитных лестниц подземной части . При разработке были использованы",
            "bboxMilliPoints": [
              72000,
              1102371,
              798335,
              1114370
            ],
            "role": "MATERIAL_SCOPE"
          }
        ]
      }
    ]
  },
  {
    "name": "RD-unsupported-token-В20",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 44,
        "line": 0,
        "from": "В30",
        "to": "В20"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-unsupported-token-B40",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 44,
        "line": 0,
        "from": "В30",
        "to": "B40"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-unsupported-token-B7,5",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 44,
        "line": 0,
        "from": "В30",
        "to": "B7,5"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-unsupported-token-F150",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 44,
        "line": 0,
        "from": "В30",
        "to": "F150"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-unsupported-token-W6",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 44,
        "line": 0,
        "from": "В30",
        "to": "W6"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-unsupported-token-П4",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 44,
        "line": 0,
        "from": "В30",
        "to": "П4"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-unsupported-token-50%",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 44,
        "line": 0,
        "from": "В30",
        "to": "50%"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-unsupported-token-30",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 44,
        "line": 0,
        "from": "В30",
        "to": "30"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-unsupported-token-В25/В30",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 44,
        "line": 0,
        "from": "В30",
        "to": "В25/В30"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-unsupported-token-В25–В30",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 44,
        "line": 0,
        "from": "В30",
        "to": "В25–В30"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-unsupported-token-В30 или В25",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 44,
        "line": 0,
        "from": "В30",
        "to": "В30 или В25"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-unsupported-token-В30.0",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 44,
        "line": 0,
        "from": "В30",
        "to": "В30.0"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-unsupported-token-В030",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 44,
        "line": 0,
        "from": "В30",
        "to": "В030"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-unsupported-token-В30x",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 44,
        "line": 0,
        "from": "В30",
        "to": "В30x"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-negated",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 44,
        "line": 0,
        "text": "Не Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93."
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-quoted",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 44,
        "line": 0,
        "text": "«Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93.»"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-suffix",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 44,
        "line": 0,
        "text": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93. Требуется уточнение."
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-missing-full-tail",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 44,
        "line": 0,
        "text": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-generic-label",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 44,
        "line": 0,
        "text": "Класс бетона: В30"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-wrong-member",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 44,
        "line": 0,
        "text": "Класс  бетона  по  прочности  для  фундаментных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93."
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-unicode-linebreak",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 44,
        "line": 0,
        "text": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93. "
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-control-character",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 44,
        "line": 0,
        "text": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93.\u0000"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-duplicate-primary",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "appendLine",
        "block": 0,
        "text": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93.",
        "box": [
          10000,
          10000,
          500000,
          22000
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-malformed-competing-primary",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "appendLine",
        "block": 0,
        "text": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  ???,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93.",
        "box": [
          10000,
          10000,
          500000,
          22000
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-doubled-anchor-one-line",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 44,
        "line": 0,
        "text": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93. Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93."
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-split-competing-primary",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "appendBlock",
        "block": 0,
        "value": {
          "text": "Класс бетона по прочности\nдля лестничных маршей В25.",
          "bboxMilliPoints": [
            10000,
            10000,
            500000,
            35680
          ],
          "lineBboxesMilliPoints": [
            [
              10000,
              23680,
              500000,
              35680
            ],
            [
              10000,
              10000,
              500000,
              22000
            ]
          ]
        }
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-geometry-fractional",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "box",
        "block": 44,
        "line": 0,
        "value": [
          100000.5,
          554871,
          832168,
          566750
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-geometry-boolean",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "box",
        "block": 44,
        "line": 0,
        "value": [
          true,
          554871,
          832168,
          566750
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-geometry-negative",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "box",
        "block": 44,
        "line": 0,
        "value": [
          -1,
          554871,
          832168,
          566750
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-geometry-unsafe",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "box",
        "block": 44,
        "line": 0,
        "value": [
          10000,
          10000,
          9007199254740992,
          22000
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-geometry-zero-area",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "box",
        "block": 44,
        "line": 0,
        "value": [
          10000,
          10000,
          10000,
          22000
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-geometry-too-tall",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "box",
        "block": 44,
        "line": 0,
        "value": [
          100000,
          500000,
          500000,
          550000
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-geometry-right-column",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "box",
        "block": 44,
        "line": 0,
        "value": [
          850000,
          554871,
          1600000,
          566750
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-missing-line-geometry",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "set",
        "path": [
          "blocks",
          44,
          "lineBboxesMilliPoints"
        ],
        "value": []
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-bad-block-union",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "set",
        "path": [
          "blocks",
          44,
          "bboxMilliPoints"
        ],
        "value": [
          1,
          1,
          2,
          2
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-quality-ocr",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "set",
        "path": [
          "quality",
          "disposition"
        ],
        "value": "OCR_REQUIRED"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-extra-page-field",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "set",
        "path": [
          "sourceApproval"
        ],
        "value": "APPROVED"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-missing-page-field",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "dropKey",
        "key": "heightMilliPoints"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-ID-stage",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "stage",
        "value": "ID"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-wrong-stage",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "stage",
        "value": "PD"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-overlapping-text",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "appendLine",
        "block": 0,
        "text": "Посторонний текст",
        "box": [
          97500,
          554871,
          832168,
          566750
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-rebar-blocks-removed",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "removeBlock",
        "block": 5
      },
      {
        "op": "removeBlock",
        "block": 4
      }
    ],
    "expectedCandidates": [
      {
        "value": "В30",
        "rawValue": "В30",
        "rawUnit": "B_CLASS",
        "canonicalUnit": "B_CLASS",
        "primaryFragments": [
          {
            "pageNumber": 50,
            "blockIndex": 3,
            "lineIndex": 0,
            "rawText": "Лестницы, лестничные площадки всех корпусов В30.",
            "bboxMilliPoints": [
              106320,
              698448,
              380184,
              710448
            ]
          }
        ],
        "contextFragments": [
          {
            "pageNumber": 49,
            "blockIndex": 10,
            "lineIndex": 0,
            "rawText": "Для  железобетонных  конструкций  предусматривается  использование  тяжелого  бетона",
            "bboxMilliPoints": [
              106320,
              325008,
              559542,
              337008
            ],
            "role": "ATTRIBUTE_HEADER"
          },
          {
            "pageNumber": 49,
            "blockIndex": 10,
            "lineIndex": 1,
            "rawText": "по ГОСТ 7473-2010 и ГОСТ  26633-2012 и приняты следующие классы по прочности на сжатие:",
            "bboxMilliPoints": [
              70800,
              311328,
              559415,
              323328
            ],
            "role": "ATTRIBUTE_HEADER"
          },
          {
            "pageNumber": 50,
            "blockIndex": 0,
            "lineIndex": 0,
            "rawText": "Подземная часть",
            "bboxMilliPoints": [
              106320,
              800208,
              192336,
              812208
            ],
            "role": "MATERIAL_SCOPE"
          }
        ]
      }
    ]
  },
  {
    "name": "PD-rebar-class-malformed",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 4,
        "line": 0,
        "text": "Арматура ???"
      },
      {
        "op": "replaceLine",
        "block": 5,
        "line": 0,
        "text": "Без арматурного стандарта"
      }
    ],
    "expectedCandidates": [
      {
        "value": "В30",
        "rawValue": "В30",
        "rawUnit": "B_CLASS",
        "canonicalUnit": "B_CLASS",
        "primaryFragments": [
          {
            "pageNumber": 50,
            "blockIndex": 3,
            "lineIndex": 0,
            "rawText": "Лестницы, лестничные площадки всех корпусов В30.",
            "bboxMilliPoints": [
              106320,
              698448,
              380184,
              710448
            ]
          }
        ],
        "contextFragments": [
          {
            "pageNumber": 49,
            "blockIndex": 10,
            "lineIndex": 0,
            "rawText": "Для  железобетонных  конструкций  предусматривается  использование  тяжелого  бетона",
            "bboxMilliPoints": [
              106320,
              325008,
              559542,
              337008
            ],
            "role": "ATTRIBUTE_HEADER"
          },
          {
            "pageNumber": 49,
            "blockIndex": 10,
            "lineIndex": 1,
            "rawText": "по ГОСТ 7473-2010 и ГОСТ  26633-2012 и приняты следующие классы по прочности на сжатие:",
            "bboxMilliPoints": [
              70800,
              311328,
              559415,
              323328
            ],
            "role": "ATTRIBUTE_HEADER"
          },
          {
            "pageNumber": 50,
            "blockIndex": 0,
            "lineIndex": 0,
            "rawText": "Подземная часть",
            "bboxMilliPoints": [
              106320,
              800208,
              192336,
              812208
            ],
            "role": "MATERIAL_SCOPE"
          }
        ]
      }
    ]
  },
  {
    "name": "RD-rebar-block-removed",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "removeBlock",
        "block": 45
      }
    ],
    "expectedCandidates": [
      {
        "value": "В30",
        "rawValue": "В30",
        "rawUnit": "B_CLASS",
        "canonicalUnit": "B_CLASS",
        "primaryFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 44,
            "lineIndex": 0,
            "rawText": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93.",
            "bboxMilliPoints": [
              97500,
              554871,
              832168,
              566750
            ]
          }
        ],
        "contextFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 1,
            "lineIndex": 3,
            "rawText": "В основном комплекте чертежей марки НСЛ-17-02/2026-1,2-КЖ1.1.9 разработаны железобетонные конструкции внутренних монолитных лестниц подземной части . При разработке были использованы",
            "bboxMilliPoints": [
              72000,
              1102371,
              798335,
              1114370
            ],
            "role": "MATERIAL_SCOPE"
          }
        ]
      }
    ]
  },
  {
    "name": "RD-rebar-class-malformed",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 45,
        "line": 0,
        "text": "Арматура ???"
      }
    ],
    "expectedCandidates": [
      {
        "value": "В30",
        "rawValue": "В30",
        "rawUnit": "B_CLASS",
        "canonicalUnit": "B_CLASS",
        "primaryFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 44,
            "lineIndex": 0,
            "rawText": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93.",
            "bboxMilliPoints": [
              97500,
              554871,
              832168,
              566750
            ]
          }
        ],
        "contextFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 1,
            "lineIndex": 3,
            "rawText": "В основном комплекте чертежей марки НСЛ-17-02/2026-1,2-КЖ1.1.9 разработаны железобетонные конструкции внутренних монолитных лестниц подземной части . При разработке были использованы",
            "bboxMilliPoints": [
              72000,
              1102371,
              798335,
              1114370
            ],
            "role": "MATERIAL_SCOPE"
          }
        ]
      }
    ]
  },
  {
    "name": "RD-stripping-strength-removed",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "removeLine",
        "block": 32,
        "line": 11
      }
    ],
    "expectedCandidates": [
      {
        "value": "В30",
        "rawValue": "В30",
        "rawUnit": "B_CLASS",
        "canonicalUnit": "B_CLASS",
        "primaryFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 44,
            "lineIndex": 0,
            "rawText": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93.",
            "bboxMilliPoints": [
              97500,
              554871,
              832168,
              566750
            ]
          }
        ],
        "contextFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 1,
            "lineIndex": 3,
            "rawText": "В основном комплекте чертежей марки НСЛ-17-02/2026-1,2-КЖ1.1.9 разработаны железобетонные конструкции внутренних монолитных лестниц подземной части . При разработке были использованы",
            "bboxMilliPoints": [
              72000,
              1102371,
              798335,
              1114370
            ],
            "role": "MATERIAL_SCOPE"
          }
        ]
      }
    ]
  },
  {
    "name": "RD-stripping-strength-changed",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 32,
        "line": 11,
        "text": "Минимальная прочность после снятия опалубки 70%."
      }
    ],
    "expectedCandidates": [
      {
        "value": "В30",
        "rawValue": "В30",
        "rawUnit": "B_CLASS",
        "canonicalUnit": "B_CLASS",
        "primaryFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 44,
            "lineIndex": 0,
            "rawText": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93.",
            "bboxMilliPoints": [
              97500,
              554871,
              832168,
              566750
            ]
          }
        ],
        "contextFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 1,
            "lineIndex": 3,
            "rawText": "В основном комплекте чертежей марки НСЛ-17-02/2026-1,2-КЖ1.1.9 разработаны железобетонные конструкции внутренних монолитных лестниц подземной части . При разработке были использованы",
            "bboxMilliPoints": [
              72000,
              1102371,
              798335,
              1114370
            ],
            "role": "MATERIAL_SCOPE"
          }
        ]
      }
    ]
  },
  {
    "name": "RD-both-unrelated-removed",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "removeBlock",
        "block": 45
      },
      {
        "op": "removeLine",
        "block": 32,
        "line": 11
      }
    ],
    "expectedCandidates": [
      {
        "value": "В30",
        "rawValue": "В30",
        "rawUnit": "B_CLASS",
        "canonicalUnit": "B_CLASS",
        "primaryFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 44,
            "lineIndex": 0,
            "rawText": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93.",
            "bboxMilliPoints": [
              97500,
              554871,
              832168,
              566750
            ]
          }
        ],
        "contextFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 1,
            "lineIndex": 3,
            "rawText": "В основном комплекте чертежей марки НСЛ-17-02/2026-1,2-КЖ1.1.9 разработаны железобетонные конструкции внутренних монолитных лестниц подземной части . При разработке были использованы",
            "bboxMilliPoints": [
              72000,
              1102371,
              798335,
              1114370
            ],
            "role": "MATERIAL_SCOPE"
          }
        ]
      }
    ]
  },
  {
    "name": "PD-no-heavy-concrete-header",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "noPreviousPage"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-previous-page-not-adjacent",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "set",
        "page": "previousPage",
        "path": [
          "pageNumber"
        ],
        "value": 48
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-previous-page-wrong-format",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "set",
        "page": "previousPage",
        "path": [
          "widthMilliPoints"
        ],
        "value": 600000
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-previous-quality-ocr",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "set",
        "page": "previousPage",
        "path": [
          "quality",
          "disposition"
        ],
        "value": "OCR_REQUIRED"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-header-mentions-rebar-instead",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "page": "previousPage",
        "block": 10,
        "line": 0,
        "from": "бетона",
        "to": "арматуры"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-header-wrong-strength-basis",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "page": "previousPage",
        "block": 10,
        "line": 1,
        "from": "сжатие",
        "to": "растяжение"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-header-not-two-lines",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "removeLine",
        "page": "previousPage",
        "block": 10,
        "line": 1
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-header-geometry-gap",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "box",
        "page": "previousPage",
        "block": 10,
        "line": 1,
        "value": [
          70800,
          290000,
          559415,
          302000
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-header-overlap",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "appendLine",
        "page": "previousPage",
        "block": 0,
        "text": "Чужой текст",
        "box": [
          106320,
          325008,
          559542,
          337008
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-header-duplicate",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "appendBlock",
        "page": "previousPage",
        "block": 0,
        "value": {
          "bboxMilliPoints": [
            70800,
            311328,
            559542,
            337008
          ],
          "lineBboxesMilliPoints": [
            [
              106320,
              325008,
              559542,
              337008
            ],
            [
              70800,
              311328,
              559415,
              323328
            ]
          ],
          "text": "Для  железобетонных  конструкций  предусматривается  использование  тяжелого  бетона\nпо ГОСТ 7473-2010 и ГОСТ  26633-2012 и приняты следующие классы по прочности на сжатие:"
        }
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-header-split-malformed-competitor",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "appendBlock",
        "page": "previousPage",
        "block": 0,
        "value": {
          "text": "Для железобетонных конструкций\nпредусматривается что-то иное",
          "bboxMilliPoints": [
            10000,
            10000,
            500000,
            35680
          ],
          "lineBboxesMilliPoints": [
            [
              10000,
              23680,
              500000,
              35680
            ],
            [
              10000,
              10000,
              500000,
              22000
            ]
          ]
        }
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-scope-aboveground",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 0,
        "line": 0,
        "text": "Надземная часть"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-scope-missing",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 0,
        "line": 0,
        "text": "Общие указания"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-scope-duplicate",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "appendLine",
        "block": 0,
        "text": "Подземная часть",
        "box": [
          10000,
          10000,
          500000,
          22000
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-scope-too-close",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "box",
        "block": 0,
        "line": 0,
        "value": [
          106320,
          750000,
          192336,
          762000
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-table-values-preserved",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": false,
    "operations": [],
    "expectedCandidates": [
      {
        "value": "В30",
        "rawValue": "В30",
        "rawUnit": "B_CLASS",
        "canonicalUnit": "B_CLASS",
        "primaryFragments": [
          {
            "pageNumber": 50,
            "blockIndex": 3,
            "lineIndex": 0,
            "rawText": "Лестницы, лестничные площадки всех корпусов В30.",
            "bboxMilliPoints": [
              106320,
              698448,
              380184,
              710448
            ]
          }
        ],
        "contextFragments": [
          {
            "pageNumber": 49,
            "blockIndex": 10,
            "lineIndex": 0,
            "rawText": "Для  железобетонных  конструкций  предусматривается  использование  тяжелого  бетона",
            "bboxMilliPoints": [
              106320,
              325008,
              559542,
              337008
            ],
            "role": "ATTRIBUTE_HEADER"
          },
          {
            "pageNumber": 49,
            "blockIndex": 10,
            "lineIndex": 1,
            "rawText": "по ГОСТ 7473-2010 и ГОСТ  26633-2012 и приняты следующие классы по прочности на сжатие:",
            "bboxMilliPoints": [
              70800,
              311328,
              559415,
              323328
            ],
            "role": "ATTRIBUTE_HEADER"
          },
          {
            "pageNumber": 50,
            "blockIndex": 0,
            "lineIndex": 0,
            "rawText": "Подземная часть",
            "bboxMilliPoints": [
              106320,
              800208,
              192336,
              812208
            ],
            "role": "MATERIAL_SCOPE"
          }
        ]
      }
    ]
  },
  {
    "name": "PD-table-class-changed-without-stair-change",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 2,
        "line": 0,
        "from": "B40",
        "to": "B25"
      }
    ],
    "expectedCandidates": [
      {
        "value": "В30",
        "rawValue": "В30",
        "rawUnit": "B_CLASS",
        "canonicalUnit": "B_CLASS",
        "primaryFragments": [
          {
            "pageNumber": 50,
            "blockIndex": 3,
            "lineIndex": 0,
            "rawText": "Лестницы, лестничные площадки всех корпусов В30.",
            "bboxMilliPoints": [
              106320,
              698448,
              380184,
              710448
            ]
          }
        ],
        "contextFragments": [
          {
            "pageNumber": 49,
            "blockIndex": 10,
            "lineIndex": 0,
            "rawText": "Для  железобетонных  конструкций  предусматривается  использование  тяжелого  бетона",
            "bboxMilliPoints": [
              106320,
              325008,
              559542,
              337008
            ],
            "role": "ATTRIBUTE_HEADER"
          },
          {
            "pageNumber": 49,
            "blockIndex": 10,
            "lineIndex": 1,
            "rawText": "по ГОСТ 7473-2010 и ГОСТ  26633-2012 и приняты следующие классы по прочности на сжатие:",
            "bboxMilliPoints": [
              70800,
              311328,
              559415,
              323328
            ],
            "role": "ATTRIBUTE_HEADER"
          },
          {
            "pageNumber": 50,
            "blockIndex": 0,
            "lineIndex": 0,
            "rawText": "Подземная часть",
            "bboxMilliPoints": [
              106320,
              800208,
              192336,
              812208
            ],
            "role": "MATERIAL_SCOPE"
          }
        ]
      }
    ]
  },
  {
    "name": "PD-coarse-wholeblock-as-primary",
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "stage": "PD",
    "synthetic": true,
    "operations": [
      {
        "op": "box",
        "block": 3,
        "line": 0,
        "value": [
          70800,
          643248,
          559298,
          710448
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-scope-aboveground",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 1,
        "line": 3,
        "from": "подземной",
        "to": "надземной"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-scope-wrong-member",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 1,
        "line": 3,
        "from": "лестниц",
        "to": "колонн"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-scope-missing",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceLine",
        "block": 1,
        "line": 3,
        "text": "Общие указания"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-tail-standard-changed",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 44,
        "line": 0,
        "from": "8267-93",
        "to": "12345-2020"
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-no-concrete-class-only-durability",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "replaceToken",
        "block": 44,
        "line": 0,
        "from": "В30,  ",
        "to": ""
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-scope-duplicate",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "appendLine",
        "block": 0,
        "text": "В основном комплекте чертежей марки НСЛ-17-02/2026-1,2-КЖ1.1.9 разработаны железобетонные конструкции внутренних монолитных лестниц подземной части . При разработке были использованы",
        "box": [
          10000,
          10000,
          500000,
          22000
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-scope-too-distant",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "box",
        "block": 44,
        "line": 0,
        "value": [
          97500,
          200000,
          832168,
          211879
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "RD-scope-right-column",
    "originalSourceFileId": "F0139",
    "originalPdfPage": 4,
    "stage": "RD",
    "synthetic": true,
    "operations": [
      {
        "op": "box",
        "block": 1,
        "line": 3,
        "value": [
          850000,
          1102371,
          1600000,
          1114370
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-current-page-header-positive",
    "stage": "PD",
    "synthetic": true,
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "operations": [
      {
        "op": "noPreviousPage"
      },
      {
        "op": "appendBlock",
        "block": 0,
        "value": {
          "bboxMilliPoints": [
            70800,
            816240,
            559542,
            841920
          ],
          "lineBboxesMilliPoints": [
            [
              106320,
              829920,
              559542,
              841920
            ],
            [
              70800,
              816240,
              559415,
              828240
            ]
          ],
          "text": "Для  железобетонных  конструкций  предусматривается  использование  тяжелого  бетона\nпо ГОСТ 7473-2010 и ГОСТ  26633-2012 и приняты следующие классы по прочности на сжатие:"
        }
      }
    ],
    "expectedCandidates": [
      {
        "value": "В30",
        "rawValue": "В30",
        "rawUnit": "B_CLASS",
        "canonicalUnit": "B_CLASS",
        "primaryFragments": [
          {
            "pageNumber": 50,
            "blockIndex": 3,
            "lineIndex": 0,
            "rawText": "Лестницы, лестничные площадки всех корпусов В30.",
            "bboxMilliPoints": [
              106320,
              698448,
              380184,
              710448
            ]
          }
        ],
        "contextFragments": [
          {
            "pageNumber": 50,
            "blockIndex": 22,
            "lineIndex": 0,
            "rawText": "Для  железобетонных  конструкций  предусматривается  использование  тяжелого  бетона",
            "bboxMilliPoints": [
              106320,
              829920,
              559542,
              841920
            ],
            "role": "ATTRIBUTE_HEADER"
          },
          {
            "pageNumber": 50,
            "blockIndex": 22,
            "lineIndex": 1,
            "rawText": "по ГОСТ 7473-2010 и ГОСТ  26633-2012 и приняты следующие классы по прочности на сжатие:",
            "bboxMilliPoints": [
              70800,
              816240,
              559415,
              828240
            ],
            "role": "ATTRIBUTE_HEADER"
          },
          {
            "pageNumber": 50,
            "blockIndex": 0,
            "lineIndex": 0,
            "rawText": "Подземная часть",
            "bboxMilliPoints": [
              106320,
              800208,
              192336,
              812208
            ],
            "role": "MATERIAL_SCOPE"
          }
        ]
      }
    ]
  },
  {
    "name": "PD-current-and-previous-header-ambiguous",
    "stage": "PD",
    "synthetic": true,
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "operations": [
      {
        "op": "appendBlock",
        "block": 0,
        "value": {
          "bboxMilliPoints": [
            70800,
            816240,
            559542,
            841920
          ],
          "lineBboxesMilliPoints": [
            [
              106320,
              829920,
              559542,
              841920
            ],
            [
              70800,
              816240,
              559415,
              828240
            ]
          ],
          "text": "Для  железобетонных  конструкций  предусматривается  использование  тяжелого  бетона\nпо ГОСТ 7473-2010 и ГОСТ  26633-2012 и приняты следующие классы по прочности на сжатие:"
        }
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-current-header-below-scope",
    "stage": "PD",
    "synthetic": true,
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "operations": [
      {
        "op": "noPreviousPage"
      },
      {
        "op": "appendBlock",
        "block": 0,
        "value": {
          "bboxMilliPoints": [
            70800,
            311328,
            559542,
            337008
          ],
          "lineBboxesMilliPoints": [
            [
              106320,
              325008,
              559542,
              337008
            ],
            [
              70800,
              311328,
              559415,
              323328
            ]
          ],
          "text": "Для  железобетонных  конструкций  предусматривается  использование  тяжелого  бетона\nпо ГОСТ 7473-2010 и ГОСТ  26633-2012 и приняты следующие классы по прочности на сжатие:"
        }
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-inconsistent-font-heights",
    "stage": "PD",
    "synthetic": true,
    "originalSourceFileId": "F0106",
    "originalPdfPage": 50,
    "operations": [
      {
        "op": "box",
        "block": 3,
        "line": 0,
        "value": [
          106320,
          698448,
          380184,
          711448
        ]
      },
      {
        "op": "box",
        "block": 0,
        "line": 0,
        "value": [
          106320,
          800208,
          192336,
          811208
        ]
      }
    ],
    "expectedCandidates": []
  },
  {
    "name": "PD-native-page-shape-0",
    "stage": "PD",
    "inputOverrides": {
      "page": null
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-page-shape-1",
    "stage": "PD",
    "inputOverrides": {
      "page": []
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-page-shape-2",
    "stage": "PD",
    "inputOverrides": {
      "page": "page"
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-page-shape-3",
    "stage": "PD",
    "inputOverrides": {
      "page": true
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-page-shape-4",
    "stage": "PD",
    "inputOverrides": {
      "page": 3
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-pageNumber-0",
    "stage": "PD",
    "pageFieldOverrides": {
      "pageNumber": true
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-pageNumber-1",
    "stage": "PD",
    "pageFieldOverrides": {
      "pageNumber": 0
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-pageNumber-2",
    "stage": "PD",
    "pageFieldOverrides": {
      "pageNumber": -1
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-pageNumber-3",
    "stage": "PD",
    "pageFieldOverrides": {
      "pageNumber": 9007199254740992
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-pageNumber-4",
    "stage": "PD",
    "pageFieldOverrides": {
      "pageNumber": 120000.5
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-widthMilliPoints-0",
    "stage": "PD",
    "pageFieldOverrides": {
      "widthMilliPoints": true
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-widthMilliPoints-1",
    "stage": "PD",
    "pageFieldOverrides": {
      "widthMilliPoints": 0
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-widthMilliPoints-2",
    "stage": "PD",
    "pageFieldOverrides": {
      "widthMilliPoints": -1
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-widthMilliPoints-3",
    "stage": "PD",
    "pageFieldOverrides": {
      "widthMilliPoints": 9007199254740992
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-widthMilliPoints-4",
    "stage": "PD",
    "pageFieldOverrides": {
      "widthMilliPoints": 120000.5
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-heightMilliPoints-0",
    "stage": "PD",
    "pageFieldOverrides": {
      "heightMilliPoints": true
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-heightMilliPoints-1",
    "stage": "PD",
    "pageFieldOverrides": {
      "heightMilliPoints": 0
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-heightMilliPoints-2",
    "stage": "PD",
    "pageFieldOverrides": {
      "heightMilliPoints": -1
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-heightMilliPoints-3",
    "stage": "PD",
    "pageFieldOverrides": {
      "heightMilliPoints": 9007199254740992
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-heightMilliPoints-4",
    "stage": "PD",
    "pageFieldOverrides": {
      "heightMilliPoints": 120000.5
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "PD-native-unpaired-surrogate",
    "stage": "PD",
    "appendBlockTextCodeUnit": {
      "blockIndex": 0,
      "unicodeCodeUnit": 55296
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-page-shape-0",
    "stage": "RD",
    "inputOverrides": {
      "page": null
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-page-shape-1",
    "stage": "RD",
    "inputOverrides": {
      "page": []
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-page-shape-2",
    "stage": "RD",
    "inputOverrides": {
      "page": "page"
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-page-shape-3",
    "stage": "RD",
    "inputOverrides": {
      "page": true
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-page-shape-4",
    "stage": "RD",
    "inputOverrides": {
      "page": 3
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-pageNumber-0",
    "stage": "RD",
    "pageFieldOverrides": {
      "pageNumber": true
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-pageNumber-1",
    "stage": "RD",
    "pageFieldOverrides": {
      "pageNumber": 0
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-pageNumber-2",
    "stage": "RD",
    "pageFieldOverrides": {
      "pageNumber": -1
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-pageNumber-3",
    "stage": "RD",
    "pageFieldOverrides": {
      "pageNumber": 9007199254740992
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-pageNumber-4",
    "stage": "RD",
    "pageFieldOverrides": {
      "pageNumber": 120000.5
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-widthMilliPoints-0",
    "stage": "RD",
    "pageFieldOverrides": {
      "widthMilliPoints": true
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-widthMilliPoints-1",
    "stage": "RD",
    "pageFieldOverrides": {
      "widthMilliPoints": 0
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-widthMilliPoints-2",
    "stage": "RD",
    "pageFieldOverrides": {
      "widthMilliPoints": -1
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-widthMilliPoints-3",
    "stage": "RD",
    "pageFieldOverrides": {
      "widthMilliPoints": 9007199254740992
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-widthMilliPoints-4",
    "stage": "RD",
    "pageFieldOverrides": {
      "widthMilliPoints": 120000.5
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-heightMilliPoints-0",
    "stage": "RD",
    "pageFieldOverrides": {
      "heightMilliPoints": true
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-heightMilliPoints-1",
    "stage": "RD",
    "pageFieldOverrides": {
      "heightMilliPoints": 0
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-heightMilliPoints-2",
    "stage": "RD",
    "pageFieldOverrides": {
      "heightMilliPoints": -1
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-heightMilliPoints-3",
    "stage": "RD",
    "pageFieldOverrides": {
      "heightMilliPoints": 9007199254740992
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-heightMilliPoints-4",
    "stage": "RD",
    "pageFieldOverrides": {
      "heightMilliPoints": 120000.5
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-native-unpaired-surrogate",
    "stage": "RD",
    "appendBlockTextCodeUnit": {
      "blockIndex": 0,
      "unicodeCodeUnit": 55296
    },
    "expectedCandidates": [],
    "operations": []
  },
  {
    "name": "RD-unrelated-previous-page-not-used",
    "stage": "RD",
    "inputOverrides": {
      "previousPage": {
        "malformed": true
      }
    },
    "expectedCandidates": [
      {
        "value": "В30",
        "rawValue": "В30",
        "rawUnit": "B_CLASS",
        "canonicalUnit": "B_CLASS",
        "primaryFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 44,
            "lineIndex": 0,
            "rawText": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93.",
            "bboxMilliPoints": [
              97500,
              554871,
              832168,
              566750
            ]
          }
        ],
        "contextFragments": [
          {
            "pageNumber": 4,
            "blockIndex": 1,
            "lineIndex": 3,
            "rawText": "В основном комплекте чертежей марки НСЛ-17-02/2026-1,2-КЖ1.1.9 разработаны железобетонные конструкции внутренних монолитных лестниц подземной части . При разработке были использованы",
            "bboxMilliPoints": [
              72000,
              1102371,
              798335,
              1114370
            ],
            "role": "MATERIAL_SCOPE"
          }
        ]
      }
    ],
    "operations": []
  }
];
function state(stage:string):any {const source=fixture.sources.find((s:any)=>s.source.stage===stage);return {stage,
  page:structuredClone(source.sourceArtifact.pages[stage==="PD"?49:3]),
  previousPage:stage==="PD"?structuredClone(source.sourceArtifact.pages[48]):null};}
function union(block:any){const boxes=block.lineBboxesMilliPoints;block.bboxMilliPoints=[Math.min(...boxes.map((b:any)=>b[0])),Math.min(...boxes.map((b:any)=>b[1])),Math.max(...boxes.map((b:any)=>b[2])),Math.max(...boxes.map((b:any)=>b[3]))];}
function apply(s:any,operations:any[]) {for(const op of operations){
  if(op.op==="stage"){s.stage=op.value;continue;}
  if(op.op==="noPreviousPage"){s.previousPage=null;continue;}
  const p=s[op.page??"page"];
  if(op.op==="set"){let target=p;for(const key of op.path.slice(0,-1))target=target[key];target[op.path.at(-1)]=structuredClone(op.value);continue;}
  if(op.op==="dropKey"){delete p[op.key];continue;}
  const b=p.blocks[op.block];
  if(op.op==="replaceLine"){const lines=b.text.split("\n");lines[op.line]=op.text;b.text=lines.join("\n");}
  else if(op.op==="replaceToken"){const lines=b.text.split("\n");expect(lines[op.line]).toContain(op.from);lines[op.line]=lines[op.line].replaceAll(op.from,op.to);b.text=lines.join("\n");}
  else if(op.op==="removeBlock")p.blocks.splice(op.block,1);
  else if(op.op==="removeLine"){const lines=b.text.split("\n");lines.splice(op.line,1);b.lineBboxesMilliPoints.splice(op.line,1);b.text=lines.join("\n");union(b);}
  else if(op.op==="box"){b.lineBboxesMilliPoints[op.line]=structuredClone(op.value);if(op.syncUnion!==false)union(b);}
  else if(op.op==="appendLine")p.blocks.push({text:op.text,bboxMilliPoints:structuredClone(op.box),lineBboxesMilliPoints:[structuredClone(op.box)]});
  else if(op.op==="appendBlock")p.blocks.push(structuredClone(op.value));
  else throw Error("Unknown concrete golden mutation");
}}
describe("independent staircase concrete prose",()=>{
  it.each(golden)("$name",c=>{const s=state(c.stage);apply(s,c.operations);const overrides=c as any;
    if(overrides.inputOverrides)Object.assign(s,structuredClone(overrides.inputOverrides));
    if(overrides.pageFieldOverrides)Object.assign(s.page,structuredClone(overrides.pageFieldOverrides));
    if(overrides.appendBlockTextCodeUnit){const o=overrides.appendBlockTextCodeUnit;s.page.blocks[o.blockIndex].text+=String.fromCharCode(o.unicodeCodeUnit);}
    const before=JSON.stringify(s);
    expect(extractConcreteCandidates(s.page,s.stage,s.previousPage)).toEqual(c.expectedCandidates);expect(JSON.stringify(s)).toBe(before);});
  it("scans all161 pages for exactly the two original strength declarations",()=>{
    expect(CONCRETE_EXTRACTOR_VERSION).toBe("matrix-concrete-prose-v1");
    const found=fixture.sources.flatMap((s:any)=>s.sourceArtifact.pages.flatMap((page:any,i:number)=>extractConcreteCandidates(page,s.source.stage,i?s.sourceArtifact.pages[i-1]:null).map(c=>[s.source.file_id,page.pageNumber,c.value])));
    expect(found).toEqual([["F0106",50,"В30"],["F0139",4,"В30"]]);
  });
  it("rejects native getters sparse arrays non-data keys and prototypes without invoking getter",()=>{
    let reads=0;const s=state("PD");Object.defineProperty(s.page,"pageNumber",{enumerable:true,get(){reads++;return 50;}});
    expect(extractConcreteCandidates(s.page,s.stage,s.previousPage)).toEqual([]);expect(reads).toBe(0);
    for(const change of [(p:any)=>{delete p.blocks[0];},(p:any)=>{p.blocks.extra=true;},(p:any)=>{Object.setPrototypeOf(p,{trusted:true});}]){
      const s=state("PD");change(s.page);expect(extractConcreteCandidates(s.page,s.stage,s.previousPage)).toEqual([]);
    }
  });
});
