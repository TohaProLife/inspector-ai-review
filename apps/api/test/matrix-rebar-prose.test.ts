import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { extractRebarCandidates, normalizeRebarClass, REBAR_EXTRACTOR_VERSION } from "../src/matrix-rebar-prose.js";
import { pythonExecutable, pythonEnv } from "./python.js";
const fixture=JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/rebar-F0106-F0139.json",import.meta.url),"utf8"));
// Frozen Python golden SHA7056ff5ed50c803463532be6ded99d98987f97ef859e34588d5138ea19fcfaae.
const frozenGolden=[
  {
    "expectedCandidates": [
      {
        "canonicalUnit": "rebar_catalog_example",
        "primaryFragments": [
          {
            "bboxMilliPoints": [
              104880,
              629328,
              559151,
              641328
            ],
            "blockIndex": 4,
            "lineIndex": 0,
            "rawText": "Арматура  для  железобетонных  конструкций  предусмотрена  класса  А500C  по  ГОСТ  Р"
          },
          {
            "bboxMilliPoints": [
              70800,
              615648,
              131796,
              627648
            ],
            "blockIndex": 5,
            "lineIndex": 0,
            "rawText": "52544-2006."
          }
        ],
        "rawUnit": null,
        "rawValue": "А500C",
        "scopeFragments": [
          {
            "bboxMilliPoints": [
              106320,
              800208,
              192336,
              812208
            ],
            "blockIndex": 0,
            "lineIndex": 0,
            "rawText": "Подземная часть"
          },
          {
            "bboxMilliPoints": [
              106320,
              698448,
              380184,
              710448
            ],
            "blockIndex": 3,
            "lineIndex": 0,
            "rawText": "Лестницы, лестничные площадки всех корпусов В30."
          }
        ],
        "value": "А500С"
      }
    ],
    "name": "original-PD",
    "operations": [],
    "originalPdfPage": 50,
    "originalSourceFileId": "F0106",
    "stage": "PD",
    "synthetic": false
  },
  {
    "expectedCandidates": [
      {
        "canonicalUnit": "rebar_catalog_example",
        "primaryFragments": [
          {
            "bboxMilliPoints": [
              104880,
              629328,
              559151,
              641328
            ],
            "blockIndex": 4,
            "lineIndex": 0,
            "rawText": "Арматура  для  железобетонных  конструкций  предусмотрена  класса  А500C  по  ГОСТ  Р"
          },
          {
            "bboxMilliPoints": [
              70800,
              615648,
              131796,
              627648
            ],
            "blockIndex": 5,
            "lineIndex": 0,
            "rawText": "52544-2006."
          }
        ],
        "rawUnit": null,
        "rawValue": "А500C",
        "scopeFragments": [
          {
            "bboxMilliPoints": [
              106320,
              800208,
              192336,
              812208
            ],
            "blockIndex": 0,
            "lineIndex": 0,
            "rawText": "Подземная часть"
          },
          {
            "bboxMilliPoints": [
              106320,
              698448,
              380184,
              710448
            ],
            "blockIndex": 3,
            "lineIndex": 0,
            "rawText": "Лестницы, лестничные площадки всех корпусов В30."
          }
        ],
        "value": "А500С"
      }
    ],
    "name": "PD-alias-А500C",
    "operations": [
      {
        "blockIndex": 4,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "А500C",
        "old": "А500C"
      }
    ],
    "originalPdfPage": 50,
    "originalSourceFileId": "F0106",
    "stage": "PD",
    "synthetic": true
  },
  {
    "expectedCandidates": [
      {
        "canonicalUnit": "rebar_catalog_example",
        "primaryFragments": [
          {
            "bboxMilliPoints": [
              104880,
              629328,
              559151,
              641328
            ],
            "blockIndex": 4,
            "lineIndex": 0,
            "rawText": "Арматура  для  железобетонных  конструкций  предусмотрена  класса  A500C  по  ГОСТ  Р"
          },
          {
            "bboxMilliPoints": [
              70800,
              615648,
              131796,
              627648
            ],
            "blockIndex": 5,
            "lineIndex": 0,
            "rawText": "52544-2006."
          }
        ],
        "rawUnit": null,
        "rawValue": "A500C",
        "scopeFragments": [
          {
            "bboxMilliPoints": [
              106320,
              800208,
              192336,
              812208
            ],
            "blockIndex": 0,
            "lineIndex": 0,
            "rawText": "Подземная часть"
          },
          {
            "bboxMilliPoints": [
              106320,
              698448,
              380184,
              710448
            ],
            "blockIndex": 3,
            "lineIndex": 0,
            "rawText": "Лестницы, лестничные площадки всех корпусов В30."
          }
        ],
        "value": "А500С"
      }
    ],
    "name": "PD-alias-A500C",
    "operations": [
      {
        "blockIndex": 4,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "A500C",
        "old": "А500C"
      }
    ],
    "originalPdfPage": 50,
    "originalSourceFileId": "F0106",
    "stage": "PD",
    "synthetic": true
  },
  {
    "expectedCandidates": [
      {
        "canonicalUnit": "rebar_catalog_example",
        "primaryFragments": [
          {
            "bboxMilliPoints": [
              104880,
              629328,
              559151,
              641328
            ],
            "blockIndex": 4,
            "lineIndex": 0,
            "rawText": "Арматура  для  железобетонных  конструкций  предусмотрена  класса  A500С  по  ГОСТ  Р"
          },
          {
            "bboxMilliPoints": [
              70800,
              615648,
              131796,
              627648
            ],
            "blockIndex": 5,
            "lineIndex": 0,
            "rawText": "52544-2006."
          }
        ],
        "rawUnit": null,
        "rawValue": "A500С",
        "scopeFragments": [
          {
            "bboxMilliPoints": [
              106320,
              800208,
              192336,
              812208
            ],
            "blockIndex": 0,
            "lineIndex": 0,
            "rawText": "Подземная часть"
          },
          {
            "bboxMilliPoints": [
              106320,
              698448,
              380184,
              710448
            ],
            "blockIndex": 3,
            "lineIndex": 0,
            "rawText": "Лестницы, лестничные площадки всех корпусов В30."
          }
        ],
        "value": "А500С"
      }
    ],
    "name": "PD-alias-A500С",
    "operations": [
      {
        "blockIndex": 4,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "A500С",
        "old": "А500C"
      }
    ],
    "originalPdfPage": 50,
    "originalSourceFileId": "F0106",
    "stage": "PD",
    "synthetic": true
  },
  {
    "expectedCandidates": [
      {
        "canonicalUnit": "rebar_catalog_example",
        "primaryFragments": [
          {
            "bboxMilliPoints": [
              104880,
              629328,
              559151,
              641328
            ],
            "blockIndex": 4,
            "lineIndex": 0,
            "rawText": "Арматура  для  железобетонных  конструкций  предусмотрена  класса  А500С  по  ГОСТ  Р"
          },
          {
            "bboxMilliPoints": [
              70800,
              615648,
              131796,
              627648
            ],
            "blockIndex": 5,
            "lineIndex": 0,
            "rawText": "52544-2006."
          }
        ],
        "rawUnit": null,
        "rawValue": "А500С",
        "scopeFragments": [
          {
            "bboxMilliPoints": [
              106320,
              800208,
              192336,
              812208
            ],
            "blockIndex": 0,
            "lineIndex": 0,
            "rawText": "Подземная часть"
          },
          {
            "bboxMilliPoints": [
              106320,
              698448,
              380184,
              710448
            ],
            "blockIndex": 3,
            "lineIndex": 0,
            "rawText": "Лестницы, лестничные площадки всех корпусов В30."
          }
        ],
        "value": "А500С"
      }
    ],
    "name": "PD-alias-А500С",
    "operations": [
      {
        "blockIndex": 4,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "А500С",
        "old": "А500C"
      }
    ],
    "originalPdfPage": 50,
    "originalSourceFileId": "F0106",
    "stage": "PD",
    "synthetic": true
  },
  {
    "expectedCandidates": [
      {
        "canonicalUnit": "rebar_catalog_example",
        "primaryFragments": [
          {
            "bboxMilliPoints": [
              104880,
              629328,
              559151,
              641328
            ],
            "blockIndex": 4,
            "lineIndex": 0,
            "rawText": "Арматура  для  железобетонных  конструкций  предусмотрена  класса  A400  по  ГОСТ  Р"
          },
          {
            "bboxMilliPoints": [
              70800,
              615648,
              131796,
              627648
            ],
            "blockIndex": 5,
            "lineIndex": 0,
            "rawText": "52544-2006."
          }
        ],
        "rawUnit": null,
        "rawValue": "A400",
        "scopeFragments": [
          {
            "bboxMilliPoints": [
              106320,
              800208,
              192336,
              812208
            ],
            "blockIndex": 0,
            "lineIndex": 0,
            "rawText": "Подземная часть"
          },
          {
            "bboxMilliPoints": [
              106320,
              698448,
              380184,
              710448
            ],
            "blockIndex": 3,
            "lineIndex": 0,
            "rawText": "Лестницы, лестничные площадки всех корпусов В30."
          }
        ],
        "value": "А400"
      }
    ],
    "name": "PD-alias-A400",
    "operations": [
      {
        "blockIndex": 4,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "A400",
        "old": "А500C"
      }
    ],
    "originalPdfPage": 50,
    "originalSourceFileId": "F0106",
    "stage": "PD",
    "synthetic": true
  },
  {
    "expectedCandidates": [
      {
        "canonicalUnit": "rebar_catalog_example",
        "primaryFragments": [
          {
            "bboxMilliPoints": [
              104880,
              629328,
              559151,
              641328
            ],
            "blockIndex": 4,
            "lineIndex": 0,
            "rawText": "Арматура  для  железобетонных  конструкций  предусмотрена  класса  А400  по  ГОСТ  Р"
          },
          {
            "bboxMilliPoints": [
              70800,
              615648,
              131796,
              627648
            ],
            "blockIndex": 5,
            "lineIndex": 0,
            "rawText": "52544-2006."
          }
        ],
        "rawUnit": null,
        "rawValue": "А400",
        "scopeFragments": [
          {
            "bboxMilliPoints": [
              106320,
              800208,
              192336,
              812208
            ],
            "blockIndex": 0,
            "lineIndex": 0,
            "rawText": "Подземная часть"
          },
          {
            "bboxMilliPoints": [
              106320,
              698448,
              380184,
              710448
            ],
            "blockIndex": 3,
            "lineIndex": 0,
            "rawText": "Лестницы, лестничные площадки всех корпусов В30."
          }
        ],
        "value": "А400"
      }
    ],
    "name": "PD-alias-А400",
    "operations": [
      {
        "blockIndex": 4,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "А400",
        "old": "А500C"
      }
    ],
    "originalPdfPage": 50,
    "originalSourceFileId": "F0106",
    "stage": "PD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "PD-unsupported-А400С",
    "operations": [
      {
        "blockIndex": 4,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "А400С",
        "old": "А500C"
      }
    ],
    "originalPdfPage": 50,
    "originalSourceFileId": "F0106",
    "stage": "PD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "PD-unsupported-A400C",
    "operations": [
      {
        "blockIndex": 4,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "A400C",
        "old": "А500C"
      }
    ],
    "originalPdfPage": 50,
    "originalSourceFileId": "F0106",
    "stage": "PD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "PD-unsupported-А240",
    "operations": [
      {
        "blockIndex": 4,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "А240",
        "old": "А500C"
      }
    ],
    "originalPdfPage": 50,
    "originalSourceFileId": "F0106",
    "stage": "PD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "PD-unsupported-А500В",
    "operations": [
      {
        "blockIndex": 4,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "А500В",
        "old": "А500C"
      }
    ],
    "originalPdfPage": 50,
    "originalSourceFileId": "F0106",
    "stage": "PD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "PD-unsupported-A500B",
    "operations": [
      {
        "blockIndex": 4,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "A500B",
        "old": "А500C"
      }
    ],
    "originalPdfPage": 50,
    "originalSourceFileId": "F0106",
    "stage": "PD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "PD-unsupported-А500с",
    "operations": [
      {
        "blockIndex": 4,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "А500с",
        "old": "А500C"
      }
    ],
    "originalPdfPage": 50,
    "originalSourceFileId": "F0106",
    "stage": "PD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "PD-unsupported-А500С/А400",
    "operations": [
      {
        "blockIndex": 4,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "А500С/А400",
        "old": "А500C"
      }
    ],
    "originalPdfPage": 50,
    "originalSourceFileId": "F0106",
    "stage": "PD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "PD-unsupported-Ø28А500С",
    "operations": [
      {
        "blockIndex": 4,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "Ø28А500С",
        "old": "А500C"
      }
    ],
    "originalPdfPage": 50,
    "originalSourceFileId": "F0106",
    "stage": "PD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "PD-malformed-competing",
    "operations": [
      {
        "block": {
          "bboxMilliPoints": [
            1000,
            1000,
            20000,
            13000
          ],
          "lineBboxesMilliPoints": [
            [
              1000,
              1000,
              20000,
              13000
            ]
          ],
          "text": "Арматура ???"
        },
        "kind": "appendBlock"
      }
    ],
    "originalPdfPage": 50,
    "originalSourceFileId": "F0106",
    "stage": "PD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "PD-primary-shift",
    "operations": [
      {
        "blockIndex": 4,
        "dx": 10000,
        "dy": 0,
        "kind": "shiftLine",
        "lineIndex": 0
      }
    ],
    "originalPdfPage": 50,
    "originalSourceFileId": "F0106",
    "stage": "PD",
    "synthetic": true
  },
  {
    "expectedCandidates": [
      {
        "canonicalUnit": "rebar_catalog_example",
        "primaryFragments": [
          {
            "bboxMilliPoints": [
              98100,
              520311,
              832026,
              532190
            ],
            "blockIndex": 45,
            "lineIndex": 0,
            "rawText": "Арматура всех конструкций класса А500С по ГОСТ 34028-2016. Армирование монолитных лестничных маршей и площадок выполняется отдельными стержнями с перевязкой их в местах пересечений"
          }
        ],
        "rawUnit": null,
        "rawValue": "А500С",
        "scopeFragments": [
          {
            "bboxMilliPoints": [
              72000,
              1102371,
              798335,
              1114370
            ],
            "blockIndex": 1,
            "lineIndex": 3,
            "rawText": "В основном комплекте чертежей марки НСЛ-17-02/2026-1,2-КЖ1.1.9 разработаны железобетонные конструкции внутренних монолитных лестниц подземной части . При разработке были использованы"
          },
          {
            "bboxMilliPoints": [
              97500,
              554871,
              832168,
              566750
            ],
            "blockIndex": 44,
            "lineIndex": 0,
            "rawText": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93."
          },
          {
            "bboxMilliPoints": [
              72000,
              537591,
              423481,
              549470
            ],
            "blockIndex": 32,
            "lineIndex": 11,
            "rawText": "Минимальная прочность бетона конструкций после снятия опалубки должна быть не менее 50%."
          }
        ],
        "value": "А500С"
      }
    ],
    "name": "original-RD",
    "operations": [],
    "originalPdfPage": 4,
    "originalSourceFileId": "F0139",
    "stage": "RD",
    "synthetic": false
  },
  {
    "expectedCandidates": [
      {
        "canonicalUnit": "rebar_catalog_example",
        "primaryFragments": [
          {
            "bboxMilliPoints": [
              98100,
              520311,
              832026,
              532190
            ],
            "blockIndex": 45,
            "lineIndex": 0,
            "rawText": "Арматура всех конструкций класса А500C по ГОСТ 34028-2016. Армирование монолитных лестничных маршей и площадок выполняется отдельными стержнями с перевязкой их в местах пересечений"
          }
        ],
        "rawUnit": null,
        "rawValue": "А500C",
        "scopeFragments": [
          {
            "bboxMilliPoints": [
              72000,
              1102371,
              798335,
              1114370
            ],
            "blockIndex": 1,
            "lineIndex": 3,
            "rawText": "В основном комплекте чертежей марки НСЛ-17-02/2026-1,2-КЖ1.1.9 разработаны железобетонные конструкции внутренних монолитных лестниц подземной части . При разработке были использованы"
          },
          {
            "bboxMilliPoints": [
              97500,
              554871,
              832168,
              566750
            ],
            "blockIndex": 44,
            "lineIndex": 0,
            "rawText": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93."
          },
          {
            "bboxMilliPoints": [
              72000,
              537591,
              423481,
              549470
            ],
            "blockIndex": 32,
            "lineIndex": 11,
            "rawText": "Минимальная прочность бетона конструкций после снятия опалубки должна быть не менее 50%."
          }
        ],
        "value": "А500С"
      }
    ],
    "name": "RD-alias-А500C",
    "operations": [
      {
        "blockIndex": 45,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "А500C",
        "old": "А500С"
      }
    ],
    "originalPdfPage": 4,
    "originalSourceFileId": "F0139",
    "stage": "RD",
    "synthetic": true
  },
  {
    "expectedCandidates": [
      {
        "canonicalUnit": "rebar_catalog_example",
        "primaryFragments": [
          {
            "bboxMilliPoints": [
              98100,
              520311,
              832026,
              532190
            ],
            "blockIndex": 45,
            "lineIndex": 0,
            "rawText": "Арматура всех конструкций класса A500C по ГОСТ 34028-2016. Армирование монолитных лестничных маршей и площадок выполняется отдельными стержнями с перевязкой их в местах пересечений"
          }
        ],
        "rawUnit": null,
        "rawValue": "A500C",
        "scopeFragments": [
          {
            "bboxMilliPoints": [
              72000,
              1102371,
              798335,
              1114370
            ],
            "blockIndex": 1,
            "lineIndex": 3,
            "rawText": "В основном комплекте чертежей марки НСЛ-17-02/2026-1,2-КЖ1.1.9 разработаны железобетонные конструкции внутренних монолитных лестниц подземной части . При разработке были использованы"
          },
          {
            "bboxMilliPoints": [
              97500,
              554871,
              832168,
              566750
            ],
            "blockIndex": 44,
            "lineIndex": 0,
            "rawText": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93."
          },
          {
            "bboxMilliPoints": [
              72000,
              537591,
              423481,
              549470
            ],
            "blockIndex": 32,
            "lineIndex": 11,
            "rawText": "Минимальная прочность бетона конструкций после снятия опалубки должна быть не менее 50%."
          }
        ],
        "value": "А500С"
      }
    ],
    "name": "RD-alias-A500C",
    "operations": [
      {
        "blockIndex": 45,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "A500C",
        "old": "А500С"
      }
    ],
    "originalPdfPage": 4,
    "originalSourceFileId": "F0139",
    "stage": "RD",
    "synthetic": true
  },
  {
    "expectedCandidates": [
      {
        "canonicalUnit": "rebar_catalog_example",
        "primaryFragments": [
          {
            "bboxMilliPoints": [
              98100,
              520311,
              832026,
              532190
            ],
            "blockIndex": 45,
            "lineIndex": 0,
            "rawText": "Арматура всех конструкций класса A500С по ГОСТ 34028-2016. Армирование монолитных лестничных маршей и площадок выполняется отдельными стержнями с перевязкой их в местах пересечений"
          }
        ],
        "rawUnit": null,
        "rawValue": "A500С",
        "scopeFragments": [
          {
            "bboxMilliPoints": [
              72000,
              1102371,
              798335,
              1114370
            ],
            "blockIndex": 1,
            "lineIndex": 3,
            "rawText": "В основном комплекте чертежей марки НСЛ-17-02/2026-1,2-КЖ1.1.9 разработаны железобетонные конструкции внутренних монолитных лестниц подземной части . При разработке были использованы"
          },
          {
            "bboxMilliPoints": [
              97500,
              554871,
              832168,
              566750
            ],
            "blockIndex": 44,
            "lineIndex": 0,
            "rawText": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93."
          },
          {
            "bboxMilliPoints": [
              72000,
              537591,
              423481,
              549470
            ],
            "blockIndex": 32,
            "lineIndex": 11,
            "rawText": "Минимальная прочность бетона конструкций после снятия опалубки должна быть не менее 50%."
          }
        ],
        "value": "А500С"
      }
    ],
    "name": "RD-alias-A500С",
    "operations": [
      {
        "blockIndex": 45,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "A500С",
        "old": "А500С"
      }
    ],
    "originalPdfPage": 4,
    "originalSourceFileId": "F0139",
    "stage": "RD",
    "synthetic": true
  },
  {
    "expectedCandidates": [
      {
        "canonicalUnit": "rebar_catalog_example",
        "primaryFragments": [
          {
            "bboxMilliPoints": [
              98100,
              520311,
              832026,
              532190
            ],
            "blockIndex": 45,
            "lineIndex": 0,
            "rawText": "Арматура всех конструкций класса А500С по ГОСТ 34028-2016. Армирование монолитных лестничных маршей и площадок выполняется отдельными стержнями с перевязкой их в местах пересечений"
          }
        ],
        "rawUnit": null,
        "rawValue": "А500С",
        "scopeFragments": [
          {
            "bboxMilliPoints": [
              72000,
              1102371,
              798335,
              1114370
            ],
            "blockIndex": 1,
            "lineIndex": 3,
            "rawText": "В основном комплекте чертежей марки НСЛ-17-02/2026-1,2-КЖ1.1.9 разработаны железобетонные конструкции внутренних монолитных лестниц подземной части . При разработке были использованы"
          },
          {
            "bboxMilliPoints": [
              97500,
              554871,
              832168,
              566750
            ],
            "blockIndex": 44,
            "lineIndex": 0,
            "rawText": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93."
          },
          {
            "bboxMilliPoints": [
              72000,
              537591,
              423481,
              549470
            ],
            "blockIndex": 32,
            "lineIndex": 11,
            "rawText": "Минимальная прочность бетона конструкций после снятия опалубки должна быть не менее 50%."
          }
        ],
        "value": "А500С"
      }
    ],
    "name": "RD-alias-А500С",
    "operations": [
      {
        "blockIndex": 45,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "А500С",
        "old": "А500С"
      }
    ],
    "originalPdfPage": 4,
    "originalSourceFileId": "F0139",
    "stage": "RD",
    "synthetic": true
  },
  {
    "expectedCandidates": [
      {
        "canonicalUnit": "rebar_catalog_example",
        "primaryFragments": [
          {
            "bboxMilliPoints": [
              98100,
              520311,
              832026,
              532190
            ],
            "blockIndex": 45,
            "lineIndex": 0,
            "rawText": "Арматура всех конструкций класса A400 по ГОСТ 34028-2016. Армирование монолитных лестничных маршей и площадок выполняется отдельными стержнями с перевязкой их в местах пересечений"
          }
        ],
        "rawUnit": null,
        "rawValue": "A400",
        "scopeFragments": [
          {
            "bboxMilliPoints": [
              72000,
              1102371,
              798335,
              1114370
            ],
            "blockIndex": 1,
            "lineIndex": 3,
            "rawText": "В основном комплекте чертежей марки НСЛ-17-02/2026-1,2-КЖ1.1.9 разработаны железобетонные конструкции внутренних монолитных лестниц подземной части . При разработке были использованы"
          },
          {
            "bboxMilliPoints": [
              97500,
              554871,
              832168,
              566750
            ],
            "blockIndex": 44,
            "lineIndex": 0,
            "rawText": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93."
          },
          {
            "bboxMilliPoints": [
              72000,
              537591,
              423481,
              549470
            ],
            "blockIndex": 32,
            "lineIndex": 11,
            "rawText": "Минимальная прочность бетона конструкций после снятия опалубки должна быть не менее 50%."
          }
        ],
        "value": "А400"
      }
    ],
    "name": "RD-alias-A400",
    "operations": [
      {
        "blockIndex": 45,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "A400",
        "old": "А500С"
      }
    ],
    "originalPdfPage": 4,
    "originalSourceFileId": "F0139",
    "stage": "RD",
    "synthetic": true
  },
  {
    "expectedCandidates": [
      {
        "canonicalUnit": "rebar_catalog_example",
        "primaryFragments": [
          {
            "bboxMilliPoints": [
              98100,
              520311,
              832026,
              532190
            ],
            "blockIndex": 45,
            "lineIndex": 0,
            "rawText": "Арматура всех конструкций класса А400 по ГОСТ 34028-2016. Армирование монолитных лестничных маршей и площадок выполняется отдельными стержнями с перевязкой их в местах пересечений"
          }
        ],
        "rawUnit": null,
        "rawValue": "А400",
        "scopeFragments": [
          {
            "bboxMilliPoints": [
              72000,
              1102371,
              798335,
              1114370
            ],
            "blockIndex": 1,
            "lineIndex": 3,
            "rawText": "В основном комплекте чертежей марки НСЛ-17-02/2026-1,2-КЖ1.1.9 разработаны железобетонные конструкции внутренних монолитных лестниц подземной части . При разработке были использованы"
          },
          {
            "bboxMilliPoints": [
              97500,
              554871,
              832168,
              566750
            ],
            "blockIndex": 44,
            "lineIndex": 0,
            "rawText": "Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93."
          },
          {
            "bboxMilliPoints": [
              72000,
              537591,
              423481,
              549470
            ],
            "blockIndex": 32,
            "lineIndex": 11,
            "rawText": "Минимальная прочность бетона конструкций после снятия опалубки должна быть не менее 50%."
          }
        ],
        "value": "А400"
      }
    ],
    "name": "RD-alias-А400",
    "operations": [
      {
        "blockIndex": 45,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "А400",
        "old": "А500С"
      }
    ],
    "originalPdfPage": 4,
    "originalSourceFileId": "F0139",
    "stage": "RD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "RD-unsupported-А400С",
    "operations": [
      {
        "blockIndex": 45,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "А400С",
        "old": "А500С"
      }
    ],
    "originalPdfPage": 4,
    "originalSourceFileId": "F0139",
    "stage": "RD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "RD-unsupported-A400C",
    "operations": [
      {
        "blockIndex": 45,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "A400C",
        "old": "А500С"
      }
    ],
    "originalPdfPage": 4,
    "originalSourceFileId": "F0139",
    "stage": "RD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "RD-unsupported-А240",
    "operations": [
      {
        "blockIndex": 45,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "А240",
        "old": "А500С"
      }
    ],
    "originalPdfPage": 4,
    "originalSourceFileId": "F0139",
    "stage": "RD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "RD-unsupported-А500В",
    "operations": [
      {
        "blockIndex": 45,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "А500В",
        "old": "А500С"
      }
    ],
    "originalPdfPage": 4,
    "originalSourceFileId": "F0139",
    "stage": "RD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "RD-unsupported-A500B",
    "operations": [
      {
        "blockIndex": 45,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "A500B",
        "old": "А500С"
      }
    ],
    "originalPdfPage": 4,
    "originalSourceFileId": "F0139",
    "stage": "RD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "RD-unsupported-А500с",
    "operations": [
      {
        "blockIndex": 45,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "А500с",
        "old": "А500С"
      }
    ],
    "originalPdfPage": 4,
    "originalSourceFileId": "F0139",
    "stage": "RD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "RD-unsupported-А500С/А400",
    "operations": [
      {
        "blockIndex": 45,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "А500С/А400",
        "old": "А500С"
      }
    ],
    "originalPdfPage": 4,
    "originalSourceFileId": "F0139",
    "stage": "RD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "RD-unsupported-Ø28А500С",
    "operations": [
      {
        "blockIndex": 45,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "Ø28А500С",
        "old": "А500С"
      }
    ],
    "originalPdfPage": 4,
    "originalSourceFileId": "F0139",
    "stage": "RD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "RD-malformed-competing",
    "operations": [
      {
        "block": {
          "bboxMilliPoints": [
            1000,
            1000,
            20000,
            13000
          ],
          "lineBboxesMilliPoints": [
            [
              1000,
              1000,
              20000,
              13000
            ]
          ],
          "text": "Арматура ???"
        },
        "kind": "appendBlock"
      }
    ],
    "originalPdfPage": 4,
    "originalSourceFileId": "F0139",
    "stage": "RD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "RD-primary-shift",
    "operations": [
      {
        "blockIndex": 45,
        "dx": 10000,
        "dy": 0,
        "kind": "shiftLine",
        "lineIndex": 0
      }
    ],
    "originalPdfPage": 4,
    "originalSourceFileId": "F0139",
    "stage": "RD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "RD-unknown-intervening",
    "operations": [
      {
        "blockIndex": 32,
        "kind": "replaceLineText",
        "lineIndex": 11,
        "new": "Неизвестная строка.",
        "old": "Минимальная прочность бетона конструкций после снятия опалубки должна быть не менее 50%."
      }
    ],
    "originalPdfPage": 4,
    "originalSourceFileId": "F0139",
    "stage": "RD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "RD-changed-strength",
    "operations": [
      {
        "blockIndex": 32,
        "kind": "replaceLineText",
        "lineIndex": 11,
        "new": "60%",
        "old": "50%"
      }
    ],
    "originalPdfPage": 4,
    "originalSourceFileId": "F0139",
    "stage": "RD",
    "synthetic": true
  },
  {
    "expectedCandidates": [],
    "name": "PD-missing-standard-continuation",
    "operations": [
      {
        "blockIndex": 5,
        "kind": "replaceLineText",
        "lineIndex": 0,
        "new": "Нет продолжения.",
        "old": "52544-2006."
      }
    ],
    "originalPdfPage": 50,
    "originalSourceFileId": "F0106",
    "stage": "PD",
    "synthetic": true
  }
];
type Stage="PD"|"RD";
const page=(stage:Stage):any=>{const s=fixture.sources.find((s:any)=>s.source.stage===stage);return structuredClone(s.sourceArtifact.pages[s.provenance.targetOriginalPdfPage-1]);};
function edit(p:any,bi:number,li:number,old:string,value:string){const lines=p.blocks[bi].text.split("\n");expect(lines[li]).toContain(old);lines[li]=lines[li].replace(old,value);p.blocks[bi].text=lines.join("\n");}
function append(p:any,text:string,b=[1000,1000,20000,13000]){p.blocks.push({text,bboxMilliPoints:b.slice(),lineBboxesMilliPoints:[b.slice()]});}
function union(p:any,bi:number){const b=p.blocks[bi],boxes=b.lineBboxesMilliPoints;b.bboxMilliPoints=[Math.min(...boxes.map((b:any)=>b[0])),Math.min(...boxes.map((b:any)=>b[1])),Math.max(...boxes.map((b:any)=>b[2])),Math.max(...boxes.map((b:any)=>b[3]))];}
type Vector={name:string;stage:unknown;page:unknown;accepted:boolean};
const vectors:Vector[]=[];
function vector(name:string,stage:Stage,mutate:(p:any)=>void,accepted=false){const p=page(stage);mutate(p);vectors.push({name,stage,page:p,accepted});}
for(const stage of ["PD","RD"] as const){
  const bi=stage==="PD"?4:45,old=stage==="PD"?"А500C":"А500С";
  vector(`${stage}:original`,stage,()=>{},true);
  for(const alias of ["А500C","A500C","A500С","А500С","A400","А400"])vector(`${stage}:alias:${alias}`,stage,p=>edit(p,bi,0,old,alias),true);
  for(const grade of ["А240","А400С","А500В","А500с","а500с","А 500С","500","А500С/А400","А500С или А400","А500С-А400","А500С (А400)"])
    vector(`${stage}:grade:${grade}`,stage,p=>edit(p,bi,0,old,grade));
  for(const text of ["Не ","«",'"'])vector(`${stage}:prefix:${text}`,stage,p=>{p.blocks[bi].text=text+p.blocks[bi].text;});
  for(const text of ["Арматура всех конструкций ???","Арматура для железобетонных конструкций ???","Основная рабочая арматура А400, конструктивная А240.","Арматура класса А400."])
    vector(`${stage}:duplicate:${text}`,stage,p=>append(p,text));
  vector(`${stage}:duplicate-governing-split`,stage,p=>{const b=[1000,1000,20000,26000];p.blocks.push({text:"Арматура всех\nконструкций ???",bboxMilliPoints:b,lineBboxesMilliPoints:[[1000,14000,20000,26000],[1000,1000,20000,13000]]});});
  for(const text of ["Класс рабочей арматуры: А400","Арматурные стержни закладных деталей класса А500С по ГОСТ 34028-2016.","вязанными арматурными каркасами, основная рабочая арматура А400,"])
    vector(`${stage}:wrong-role:${text}`,stage,p=>{p.blocks[bi].text=text;});
  vector(`${stage}:quality`,stage,p=>{p.quality.disposition="OCR_REQUIRED";});
  for(const [key,value] of [["pageNumber",true],["widthMilliPoints",1.5],["heightMilliPoints",Number.MAX_SAFE_INTEGER+1]])vector(`${stage}:page:${key}`,stage,p=>{p[key as string]=value;});
  vector(`${stage}:extra-page-field`,stage,p=>{p.approved=true;});
  vector(`${stage}:extra-block-field`,stage,p=>{p.blocks[bi].approved=true;});
  for(const text of ["\r","\u2028","\u2029"])vector(`${stage}:separator:${text}`,stage,p=>edit(p,bi,0,"Арматура",`Арма${text}тура`));
  for(const affected of stage==="PD"?[0,3,4,5]:[1,32,44,45])for(const kind of ["missing","fraction","boolean","out-of-page","reversed","union","count"])
    vector(`${stage}:geometry:${affected}:${kind}`,stage,p=>{const b=p.blocks[affected];
      if(kind==="missing")delete b.lineBboxesMilliPoints;
      if(kind==="fraction")b.lineBboxesMilliPoints[0][0]=1.5;
      if(kind==="boolean")b.lineBboxesMilliPoints[0][0]=true;
      if(kind==="out-of-page")b.lineBboxesMilliPoints[0][2]=p.widthMilliPoints+1;
      if(kind==="reversed")b.lineBboxesMilliPoints[0][2]=0;
      if(kind==="union")b.bboxMilliPoints[0]++;
      if(kind==="count")b.lineBboxesMilliPoints.pop();});
  for(const [sbi,sli] of stage==="PD"?[[0,0],[3,0]]:[[1,3],[44,0],[32,11]]){
    vector(`${stage}:scope-missing:${sbi}`,stage,p=>{const lines=p.blocks[sbi].text.split("\n");lines[sli]="Не определено.";p.blocks[sbi].text=lines.join("\n");});
    vector(`${stage}:scope-duplicate:${sbi}`,stage,p=>append(p,p.blocks[sbi].text.split("\n")[sli]));
  }
  vector(`${stage}:overlap`,stage,p=>append(p,"Неизвестная вставка",p.blocks[bi].lineBboxesMilliPoints[0]));
  for(const wrong of ["ID","UNRESOLVED","pd",null,1,{},stage==="PD"?"RD":"PD"])vectors.push({name:`${stage}:wrong-stage:${JSON.stringify(wrong)}`,stage:wrong,page:page(stage),accepted:false});
}
for(const [stage,bi,li,dx,dy] of [["PD",5,0,-40000,0],["PD",5,0,0,-10000],["PD",0,0,3000,0],["PD",3,0,0,60000],
  ["RD",44,0,5000,0],["RD",1,3,50000,0],["RD",1,3,0,-200000],["RD",32,11,0,8000],["RD",32,11,45000,0]] as const)
  vector(`${stage}:shift:${bi}:${dx}:${dy}`,stage,p=>{p.blocks[bi].lineBboxesMilliPoints[li]=p.blocks[bi].lineBboxesMilliPoints[li].map((n:number,i:number)=>n+(i%2?dy:dx));union(p,bi);});
vector("PD:standard", "PD",p=>{p.blocks[5].text="34028-2016.";});
vector("PD:continuation-order","PD",p=>{[p.blocks[4],p.blocks[5]]=[p.blocks[5],p.blocks[4]];});
vector("RD:unknown-intervening","RD",p=>edit(p,32,11,"50%","60%"));
vector("PD:scope-above-ground","PD",p=>edit(p,0,0,"Подземная","Надземная"));
vector("RD:scope-above-ground","RD",p=>edit(p,1,3,"подземной","надземной"));

describe("independent narrow rebar prose",()=>{
  it("reconstructs full161 public pages and original source-bound fragment identities",()=>{
    expect(REBAR_EXTRACTOR_VERSION).toBe("matrix-rebar-prose-v1");
    expect(fixture.sources.reduce((n:number,s:any)=>n+s.sourceArtifact.pages.length,0)).toBe(161);
    for(const [stage,ids] of [["PD",[[4,0],[5,0],[0,0],[3,0]]],["RD",[[45,0],[1,3],[44,0],[32,11]]]] as const){
      const original=page(stage),before=JSON.stringify(original),c=extractRebarCandidates(original,stage);
      expect(c).toHaveLength(1);expect(c[0]).toMatchObject({value:"А500С",rawUnit:null,canonicalUnit:"rebar_catalog_example"});
      expect([...c[0].primaryFragments,...c[0].scopeFragments].map(p=>[p.blockIndex,p.lineIndex])).toEqual(ids);
      expect(JSON.stringify(original)).toBe(before);
      c[0].primaryFragments[0].bboxMilliPoints[0]++;expect(JSON.stringify(original)).toBe(before);
    }
  });
  it("matches all37 frozen portable Python goldens without executing Python",()=>{
    for(const c of frozenGolden){const p=page(c.stage as Stage);
      for(const op of c.operations as any[]){
        if(op.kind==="replaceLineText")edit(p,op.blockIndex,op.lineIndex,op.old,op.new);
        else if(op.kind==="appendBlock")p.blocks.push(structuredClone(op.block));
        else if(op.kind==="shiftLine"){p.blocks[op.blockIndex].lineBboxesMilliPoints[op.lineIndex]=p.blocks[op.blockIndex].lineBboxesMilliPoints[op.lineIndex].map((n:number,i:number)=>n+(i%2?op.dy:op.dx));union(p,op.blockIndex);}
        else throw Error("Unknown frozen golden operation");
      }
      expect(extractRebarCandidates(p,c.stage),c.name).toEqual(c.expectedCandidates);
    }
  });
  it.each(vectors)("$name",v=>{expect(extractRebarCandidates(v.page,v.stage).length).toBe(v.accepted?1:0);});
  it("matches independent Python exact candidates for every boundary vector and full pages",()=>{
    const full=fixture.sources.flatMap((s:any)=>s.sourceArtifact.pages.map((page:any)=>({stage:s.source.stage,page})));
    const all=[...vectors,...full];
    const child=spawnSync(pythonExecutable,["-c","import json,sys\nfrom inspector_worker.rebar_prose import extract_rebar_candidates\nx=json.load(sys.stdin)\njson.dump([extract_rebar_candidates(v['page'],v['stage']) for v in x],sys.stdout,ensure_ascii=False)"],
      {input:JSON.stringify(all),encoding:"utf8",env:{...process.env,...pythonEnv},timeout:30000,maxBuffer:8*1024*1024});
    expect(child.status,child.stderr).toBe(0);const expected=JSON.parse(child.stdout);
    all.forEach((v,i)=>expect(extractRebarCandidates(v.page,v.stage),"name" in v?String(v.name):`full-page-${i}`).toEqual(expected[i]));
  });
  it("rejects native getters, sparse arrays, extra array properties and prototypes",()=>{
    let reads=0;const p=page("PD");Object.defineProperty(p,"pageNumber",{enumerable:true,get(){reads++;return 50;}});
    expect(extractRebarCandidates(p,"PD")).toEqual([]);expect(reads).toBe(0);
    for(const change of [(p:any)=>{delete p.blocks[0];},(p:any)=>{p.blocks.extra=true;},(p:any)=>{Object.setPrototypeOf(p,{trusted:true});}]){
      const p=page("PD");change(p);expect(extractRebarCandidates(p,"PD")).toEqual([]);
    }
  });
  it("normalization admits only six literal aliases and no numerical order",()=>{
    expect(["А500C","A500C","A500С","А500С","A400","А400"].map(normalizeRebarClass)).toEqual(["А500С","А500С","А500С","А500С","А400","А400"]);
    for(const raw of ["А240","А500с","А400С",500,null,{}," А400"])expect(normalizeRebarClass(raw)).toBeNull();
  });
});
