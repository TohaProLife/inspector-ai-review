"""Independent expected evidence and fail-closed boundaries for stair concrete prose.

Frozen public161page inputs are reused. Expected outputs and operation vectors
are embedded, so neither ignored output files nor original PDF mounts are needed.
No engine, rebar helper or review approval is involved in extraction.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest

from inspector_worker.concrete_prose import EXTRACTOR_VERSION, extract_concrete_candidates

_FIXTURE = Path(__file__).parent / "fixtures/rebar-F0106-F0139.json"
_FIXTURE_SHA = "ee4c645f50f87d44e056b62f215170067e8cd75555837473e2599072c9fa6b54"
_GOLDEN = json.loads(r'''
{
  "schemaVersion": "matrix-t32-concrete-prototype-golden-v1",
  "mode": "LOCAL_RESEARCH_ONLY_NOT_PRODUCTION_TESTS",
  "fixtureSha256": "ee4c645f50f87d44e056b62f215170067e8cd75555837473e2599072c9fa6b54",
  "cases": [
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
    }
  ],
  "full161Scan": [
    {
      "sourceFileId": "F0106",
      "pageNumber": 50,
      "candidates": [
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
      "sourceFileId": "F0139",
      "pageNumber": 4,
      "candidates": [
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
    }
  ]
}
''')

def union(block):
    boxes = block["lineBboxesMilliPoints"]
    block["bboxMilliPoints"] = [min(b[0] for b in boxes), min(b[1] for b in boxes),
                                max(b[2] for b in boxes), max(b[3] for b in boxes)]

def apply(state, operations):
    for op in operations:
        if op["op"] == "stage":
            state["stage"] = op["value"]
            continue
        if op["op"] == "noPreviousPage":
            state["previousPage"] = None
            continue
        p = state[op.get("page", "page")]
        if op["op"] == "set":
            target = p
            for key in op["path"][:-1]:
                target = target[key]
            target[op["path"][-1]] = deepcopy(op["value"])
            continue
        if op["op"] == "dropKey":
            del p[op["key"]]
            continue
        b = p["blocks"][op["block"]]
        if op["op"] == "replaceLine":
            lines = b["text"].split("\n")
            lines[op["line"]] = op["text"]
            b["text"] = "\n".join(lines)
        elif op["op"] == "replaceToken":
            lines = b["text"].split("\n")
            assert op["from"] in lines[op["line"]]
            lines[op["line"]] = lines[op["line"]].replace(op["from"], op["to"])
            b["text"] = "\n".join(lines)
        elif op["op"] == "removeBlock":
            del p["blocks"][op["block"]]
        elif op["op"] == "removeLine":
            lines = b["text"].split("\n")
            del lines[op["line"]]
            del b["lineBboxesMilliPoints"][op["line"]]
            b["text"] = "\n".join(lines)
            union(b)
        elif op["op"] == "box":
            b["lineBboxesMilliPoints"][op["line"]] = deepcopy(op["value"])
            if op.get("syncUnion", True):
                union(b)
        elif op["op"] == "appendLine":
            p["blocks"].append({"text": op["text"], "bboxMilliPoints": deepcopy(op["box"]),
                                "lineBboxesMilliPoints": [deepcopy(op["box"])]})
        elif op["op"] == "appendBlock":
            p["blocks"].append(deepcopy(op["value"]))
        else:
            raise AssertionError("unknown research operation")

class ConcreteProseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        data = _FIXTURE.read_bytes()
        assert hashlib.sha256(data).hexdigest() == _FIXTURE_SHA
        cls.fixture = json.loads(data)
        cls.base = {}
        for item in cls.fixture["sources"]:
            s, artifact = item["source"], item["sourceArtifact"]
            assert (s["split"], s["distribution_status"], s["label_visibility"]) == ("TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN")
            n = 50 if s["stage"] == "PD" else 4
            cls.base[s["stage"]] = {"stage": s["stage"], "page": artifact["pages"][n - 1],
                                    "previousPage": artifact["pages"][n - 2] if s["stage"] == "PD" else None}

    def check_case(self, case):
        state = deepcopy(self.base[case["stage"]])
        apply(state, case["operations"])
        before = deepcopy(state)
        actual = extract_concrete_candidates(state["page"], state["stage"], state["previousPage"])
        self.assertEqual(actual, case["expectedCandidates"])
        self.assertEqual(state, before)
        self.assertEqual(extract_concrete_candidates(state["page"], state["stage"], state["previousPage"]), actual)
        for candidate in actual:
            for fragment in candidate["primaryFragments"] + candidate["contextFragments"]:
                fragment["bboxMilliPoints"][0] = -1
        self.assertEqual(state, before)
        self.assertEqual(extract_concrete_candidates(state["page"], state["stage"], state["previousPage"]), case["expectedCandidates"])

    def test_version_and_fixed_expected_domain(self):
        self.assertEqual(EXTRACTOR_VERSION, "matrix-concrete-prose-v1")
        self.assertEqual(len(_GOLDEN["cases"]), 123)
        self.assertEqual(sum(bool(c["expectedCandidates"]) for c in _GOLDEN["cases"]), 17)

    def test_full161_scan_exact_original_evidence_and_input_unchanged(self):
        before = deepcopy(self.fixture)
        rows = []
        for source in self.fixture["sources"]:
            pages = source["sourceArtifact"]["pages"]
            for index, page in enumerate(pages):
                previous = pages[index - 1] if index and source["source"]["stage"] == "PD" else None
                result = extract_concrete_candidates(page, source["source"]["stage"], previous)
                if result:
                    rows.append({"sourceFileId": source["source"]["file_id"], "pageNumber": page["pageNumber"], "candidates": result})
        self.assertEqual(rows, _GOLDEN["full161Scan"])
        self.assertEqual(self.fixture, before)
        self.assertEqual(hashlib.sha256(_FIXTURE.read_bytes()).hexdigest(), _FIXTURE_SHA)

    def current_page_header_state(self):
        state = deepcopy(self.base["PD"])
        header = deepcopy(state["previousPage"]["blocks"][10])
        header["lineBboxesMilliPoints"] = [[106320, 829920, 559542, 841920], [70800, 816240, 559415, 828240]]
        union(header)
        state["page"]["blocks"].append(header)
        state["previousPage"] = None
        return state

    def test_current_page_material_header_above_scope(self):
        state = self.current_page_header_state()
        expected = deepcopy(_GOLDEN["cases"][0]["expectedCandidates"])
        for index, fragment in enumerate(expected[0]["contextFragments"][:2]):
            fragment["pageNumber"] = 50
            fragment["blockIndex"] = len(state["page"]["blocks"]) - 1
            fragment["bboxMilliPoints"] = deepcopy(state["page"]["blocks"][-1]["lineBboxesMilliPoints"][index])
        self.assertEqual(extract_concrete_candidates(state["page"], "PD"), expected)

    def test_current_and_previous_header_ambiguous(self):
        state = self.current_page_header_state()
        state["previousPage"] = deepcopy(self.base["PD"]["previousPage"])
        self.assertEqual(extract_concrete_candidates(state["page"], "PD", state["previousPage"]), [])

    def test_current_header_below_scope_rejected(self):
        state = self.current_page_header_state()
        header = state["page"]["blocks"][-1]
        header["lineBboxesMilliPoints"] = [[106320, 325008, 559542, 337008], [70800, 311328, 559415, 323328]]
        union(header)
        self.assertEqual(extract_concrete_candidates(state["page"], "PD"), [])

    def test_mixed_line_heights_rejected(self):
        state = deepcopy(self.base["PD"])
        state["page"]["blocks"][3]["lineBboxesMilliPoints"][0][3] = 711448
        union(state["page"]["blocks"][3])
        state["page"]["blocks"][0]["lineBboxesMilliPoints"][0][3] = 811208
        union(state["page"]["blocks"][0])
        self.assertEqual(extract_concrete_candidates(state["page"], "PD", state["previousPage"]), [])

    def test_native_shape_and_unpaired_surrogates_rejected(self):
        for stage in ("PD", "RD"):
            for invalid in (None, [], "page", True, 3):
                with self.subTest(stage=stage, invalid=repr(invalid)):
                    self.assertEqual(extract_concrete_candidates(invalid, stage), [])
            for field in ("pageNumber", "widthMilliPoints", "heightMilliPoints"):
                for value in (True, 0, -1, 2 ** 53, 120000.5):
                    with self.subTest(stage=stage, field=field, value=value):
                        state = deepcopy(self.base[stage]); state["page"][field] = value
                        self.assertEqual(extract_concrete_candidates(state["page"], stage, state["previousPage"]), [])
            state = deepcopy(self.base[stage]); state["page"]["blocks"][0]["text"] += "\ud800"
            self.assertEqual(extract_concrete_candidates(state["page"], stage, state["previousPage"]), [])

    def test_external_stage_not_source_authentication(self):
        state = deepcopy(self.base["RD"])
        # RD has no cross-page material header. Caller must bind primary/scope
        # to one actual source; an unrelated supplied previous page is unused.
        self.assertEqual(extract_concrete_candidates(state["page"], "RD", {"malformed": True}),
                         next(c["expectedCandidates"] for c in _GOLDEN["cases"] if c["name"] == "original-RD"))


def _make_case_test(case):
    def test(self):
        self.check_case(case)
    test.__doc__ = case["name"]
    return test


for _index, _case in enumerate(_GOLDEN["cases"]):
    _name = "".join(c if c.isascii() and c.isalnum() else "_" for c in _case["name"])
    setattr(ConcreteProseTests, f"test_boundary_{_index:03d}_{_name}", _make_case_test(_case))

if __name__ == "__main__":
    unittest.main()
