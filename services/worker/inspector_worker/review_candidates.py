"""Run-local review suggestions from the existing pinned candidate labels and text artifacts.

These records are navigation aids. They never enter rule evaluation or coverage.
"""

from __future__ import annotations

from collections import defaultdict
import hashlib
import re
from typing import Any

from .candidate_family_rules import load_candidate_family_pack
from .class_family_candidates import load_class_family_labels
from .free_heating_suspicion import _WARM_FLOOR
from .numeric_family_candidates import load_numeric_family_labels
from .parameter_routing import _validate_artifact
from .presence_family_candidates import load_presence_family_labels
from .run_candidate_family_preview import _hash, _line_matches, _lines, _source


MAX_PER_SOURCE = 16
MAX_PER_CODE_PER_SOURCE = 4
MAX_TOTAL = 96
_HVAC_PAGE_TOPICS = (
    ("IOS4-078", "ventilation_scheme", re.compile(
        r"принципиальн\w*\s+схем\w*\s+систем\w*\s+общеобменн\w*\s+вентиляц\w*", re.I)),
    ("IOS4-079", "supply_unit_scheme", re.compile(
        r"принципиальн\w*\s+схем\w*\s+систем\w*\s+теплоснабжен\w*\s+приточн\w*\s+установ\w*", re.I)),
)
_CATALOG_TOPIC_CUES = (
    ("SPZU-031", re.compile(r"радиусам\s+поворота\s+ПППМ", re.I)),
    ("IOS1-068", re.compile(r"Номинальн\w*\s+ток\w*\s+защитн\w*\s+автомат\w*", re.I)),
    ("SM-132", re.compile(r"Сводн\w*\s+сметн\w*\s+расч[её]т", re.I)),
    ("PPM-105", re.compile(r"выхода?\s+\(В2\s+и\s+В3\)\s+в\s+осях\s+15-17\s+по\s+оси\s+М\s+ширина\s+каждого\s+1[,.]3\s+м", re.I)),
    ("KR-064", re.compile(r"В\s+осях\s+\d+/[А-ЯA-Z]\s+расположена\s+шахта\s+лифта", re.I)),
    ("IOS4-076", re.compile(r"ТС\s+Т1,Т2\s*-\s*2Д\d+/\d+", re.I)),
    ("SPZU-035", re.compile(r"в\s+охранной\s+зоне\s+газопровода\s+\(2м\s+в\s+обе\s+стороны\)", re.I)),
    ("AR-043", re.compile(r"открываются\s+по\s+направлению\s+выхода\s+из\s+здания", re.I)),
    ("PZ-021", re.compile(r"эффективности\s+не\s+определяется", re.I)),
    ("ZU-126", re.compile(r"\b0[,.]045\b", re.I)),
    ("ZU-127", re.compile(r"\b0[,.]65\b", re.I)),
    ("ZU-128", re.compile(r"\b150\b", re.I)),
    ("SPZU-026", re.compile(r"Площадь\s+твердых\s+покрытий", re.I)),
    ("SPZU-037", re.compile(r"Проектом\s+не\s+предусматриваются\s+парковочные\s+места\s+на\s+территории", re.I)),
    ("PPM-106", re.compile(r"по\s+направлению\s+выхода\s+из\s+здания", re.I)),
    ("AR-040", re.compile(r"Ширина\s+горизонтальных\s+участков\s+путей\s+эвакуации", re.I)),
    ("PZ-016", re.compile(r"Суммарный\s+расчетный\s+расход\s+воды\s+на\s+здания\s+\d+[,.]\d+\s+м3/сут", re.I)),
    ("ODI-118", re.compile(r"Высота\s+порогов\s+или\s+перепад\s+высот\s+не\s+превышает\s+0[,.]014\s+м", re.I)),
    ("IOS2-073", re.compile(r"COR-3\s+MVL\s+\d+/SKw-MB-PN25-EB-R", re.I)),
    ("IOS3-074", re.compile(r"по\s+выпускам\s+из\s+труб\s+ВЧШГ\s+диаметром\s+\d+", re.I)),
    ("SPZU-034", re.compile(r"проектируемый\s+колодец\s+на\s+канализационной\s+сети\s+Д=150мм", re.I)),
    ("AR-045", re.compile(r"Отвод\s+дождев\w*\s+и\s+тал\w*\s+вод\s+с\s+кровл\w*\s+здани\w*\s+осуществляется\s+через\s+водосточн\w*\s+воронк\w*", re.I)),
    ("KR-060", re.compile(r"колонн\w*\s+с\s+сечени\w*", re.I)),
    ("KR-065", re.compile(r"отверсти\w*\s+в\s+перекрыти\w*\s+под\s+вентиляционн\w*\s+шахт\w*", re.I)),
    ("PZ-005", re.compile(r"подземная\s+часть,\s+в\s+т\.ч\.", re.I)),
    ("PZ-006", re.compile(r"наземная\s+часть,\s+в\s+т\.ч\.", re.I)),
    ("PZ-011", re.compile(r"Количество\s+квартир\w*", re.I)),
    ("POS-086", re.compile(r"Обоснование\s+потребност\w*\s+строительств\w*\s+в\s+рабоч\w*\s+кадрах", re.I)),
    ("POS-088", re.compile(r"Общая\s+потребляемая\s+мощность\s+на\s+период\s+строительств\w*", re.I)),
    ("KR-056", re.compile(r"из\s+стали\s+[СC]\s*245\s+по\s+ГОСТ", re.I)),
    ("KR-066", re.compile(r"сварн\w*\s+шв\w*\s+обработать\s+антикоррозийн\w*\s+состав\w*", re.I)),
    ("PZ-003", re.compile(r"Расчетн\w*\s+площад\w*\s+здани\w*", re.I)),
    ("PZ-010", re.compile(r"Количество\s+квартир\w*", re.I)),
    ("PZ-013", re.compile(r"Вместимость\s+обеденн\w*\s+зал\w*\s+на\s+\d+\s+посадочн\w*\s+мест", re.I)),
    ("AR-044", re.compile(r"ТН-Кровля\s+Стандарт(?:\s+Терраса)?", re.I)),
    ("KR-063", re.compile(r"тип\s+всех\s+сварн\w*\s+соединени\w*\s+К1-Кт", re.I)),
    ("IOS3-075", re.compile(r"полипропиленов\w*\s+канализационн\w*\s+труб\w*", re.I)),
    ("POS-082", re.compile(r"Продолжительност\w*\s+строительств\w*\s+надземн\w*\s+част\w*", re.I)),
    ("ODI-116", re.compile(r"Ширин\w*\s+пут\w*\s+движени\w*\s+по\s+коридор\w*", re.I)),
    ("ZU-124", re.compile(r"Класс\s+энергосбережени\w*", re.I)),
    ("ZU-131", re.compile(r"Удельн\w*\s+расход\w*\s+теплов\w*\s+энерги\w*\s+на", re.I)),
    ("PZ-007", re.compile(r"количеств\w*\s+этаж\w*\s+наземн\w*\s+част\w*", re.I)),
    ("PZ-012", re.compile(r"машино.?мест\w*\s+постоянн\w*\s+хранени\w*\s+в\s+подземн\w*\s+автостоянк\w*", re.I)),
    ("SPZU-029", re.compile(r"ведомост\w*\s+мал\w*\s+архитектурн\w*\s+форм\w*", re.I)),
    ("IOS2-072", re.compile(r"напорн\w*\s+полиэтиленов\w*\s+труб\w*\s+ПЭ\s*100\+?", re.I)),
    ("SPZU-025", re.compile(r"площадь\s+асфальтобетонн\w*\s+покрыти\w*\s+проезд\w*", re.I)),
    ("SPZU-027", re.compile(r"площадь\s+озеленени\w*", re.I)),
    ("SPZU-028", re.compile(r"универсальн\w*\s+спортивн\w*\s+площадк\w*", re.I)),
    ("SPZU-033", re.compile(r"(?:продольн\w*|поперечн\w*)\s+уклон\w*\s+по\s+проезд\w*", re.I)),
    ("KR-055", re.compile(
        r"(?:фундаментн\w*\s+плит\w*|несущ\w*\s+железобетонн\w*\s+конструкц\w*|"
        r"ж/б.{0,35}стен\w*\s+в\s+грунт\w*).{0,180}?бетон\w*\s+класс\w*\s+[ВB]\s*\d{2}\b", re.I)),
    ("KR-057", re.compile(r"арматур\w*\s+класса\s+[АA]\s*(?:240|400|500)\s*[СC]?\b", re.I)),
    ("PZ-001", re.compile(
        r"площадь\s+застройки(?=\s*(?:составля\w*|[:=–—]))", re.I)),
    ("PZ-015", re.compile(r"категори\w*\s+надежност\w*\s+электроснабжен\w*", re.I)),
    ("SPZU-032", re.compile(r"конструкци\w*\s+дорожн\w*\s+одежд\w*", re.I)),
    ("SPZU-030", re.compile(r"ширин\w*\s+проезд\w*\s+для\s+пожарн\w*\s+техник\w*", re.I)),
    ("PPM-102", re.compile(r"(?:разделен\w*\s+на\s+следующ\w*|разделени\w*\s+на)\s+пожарн\w*\s+отсек\w*", re.I)),
    ("PPM-104", re.compile(r"ширин\w*\s+проход\w*\s+между\s+рядами", re.I)),
    ("PPM-103", re.compile(r"(?:огнестойкост\w*|предел\w*\s+огнестойкост\w*)\s+двер\w*", re.I)),
    ("AR-052", re.compile(r"фасадн\w*\s+элемент\w*.{0,80}анодированн\w*", re.I)),
    ("IOS4-077", re.compile(r"радиатор\s+в\s+помещении\s+\d+\s+заменен\w*", re.I)),
    ("ODI-120", re.compile(r"опорн\w*\s+поручн\w*", re.I)),
    ("PZ-004", re.compile(r"строительн\w*\s+объем\w*\s+здания", re.I)),
    ("PZ-009", re.compile(r"относительн\w*\s+отметк\w*\s+0[,.]000\s+принят\w*\s+(?:абсолютн\w*\s+отметк\w*|абс\.\s*отм\.)", re.I)),
    ("KR-059", re.compile(r"плит\w*\s+перекрытия\s+и\s+покрытия\s+толщиной", re.I)),
    ("IOS5-080", re.compile(r"(?:автоматическ\w*|систем\w*)\s+пожарн\w*\s+сигнализац\w*", re.I)),
    ("PPM-108", re.compile(r"(?:проектн\w*\s+расположен\w*|размещен\w*)\s+пожарн\w*\s+извещател\w*", re.I)),
    ("ODI-117", re.compile(r"ширин\w*\s+дверн\w*\s+про[её]м\w*", re.I)),
    ("PZ-017", re.compile(r"теплов\w*\s+нагрузк\w*", re.I)),
    ("AR-041", re.compile(r"ширин\w*\s+эвакуационн\w*\s+выход\w*", re.I)),
    ("AR-046", re.compile(r"оконн\w*\s+блок\w*", re.I)),
    ("PPM-107", re.compile(r"класс\w*\s+пожарн\w*\s+опасност\w*\s+материал\w*", re.I)),
    ("PPM-110", re.compile(r"систем\w*\s+оповещен\w*\s+и\s+управлен\w*", re.I)),
    ("PPM-112", re.compile(r"подпор\w*\s+воздух\w*\s+при\s+пожар\w*", re.I)),
    ("PPM-113", re.compile(r"(?:систем\w*\s+)?внутренн\w*\s+пожаротушен\w*", re.I)),
    ("PPM-114", re.compile(r"расход\w*\s+вод\w*\s+на\s+наружн\w*\s+пожаротушен\w*", re.I)),
    ("ODI-119", re.compile(r"универсальн\w*\s+кабин\w*\s+для\s+инвалид\w*", re.I)),
    ("ODI-121", re.compile(r"машино.?мест\w*\s+для\s+инвалид\w*", re.I)),
    ("IOS1-069", re.compile(r"сечени\w*\s+(?:провод\w*\s+и\s+)?кабел\w*", re.I)),
    ("IOS1-070", re.compile(r"контур\w*\s+(?:защитн\w*\s+)?заземлен\w*", re.I)),
    ("PPM-111", re.compile(r"огнезадерживающ\w*\s+клапан\w*", re.I)),
    ("PPM-109", re.compile(r"огнестойк(?:ими|им|их|ого|ие|ий)\s+кабел\w*", re.I)),
    ("ZU-125", re.compile(r"толщин\w*\s+утеплител\w*", re.I)),
    ("ZU-130", re.compile(r"светодиодн\w*\s+светильник\w*", re.I)),
    ("POS-081", re.compile(r"опасн\w*\s+зон\w*.{0,45}(?:башенн\w*\s+)?кран\w*", re.I)),
    ("POS-083", re.compile(r"временн\w*\s+бытов\w*\s+помещен\w*|бытов\w*\s+город\w*", re.I)),
    ("POS-084", re.compile(r"временн\w*\s+(?:авто)?дорог\w*\s+ширин\w*", re.I)),
    ("POS-085", re.compile(r"площадк\w*\s+складирован\w*", re.I)),
    ("POS-087", re.compile(r"технологическ\w*\s+последовательн\w*\s+работ\w*\s+по\s+монтаж\w*", re.I)),
    ("POS-089", re.compile(r"мойк\w*\s+кол[её]с\w*", re.I)),
    ("AR-042", re.compile(r"высот\w*\s+потолк\w*\s+коридор\w*", re.I)),
    ("AR-047", re.compile(r"входн\w*\s+тамбур\w*\s+глубин\w*", re.I)),
    ("AR-048", re.compile(r"ширин\w*\s+проступ\w*.{0,60}высот\w*\s+ступен\w*", re.I)),
    ("SPZU-036", re.compile(r"шумозащитн\w*\s+огражден\w*", re.I)),
    ("SPZU-038", re.compile(r"парковочн\w*\s+мест\w*\s+для\s+мгн\b", re.I)),
    ("AR-049", re.compile(r"высот\w*\s+огражден\w*\s+лестниц\w*", re.I)),
    ("KR-061", re.compile(r"толщин\w*\s+несущ\w*\s+стен\w*", re.I)),
    ("KR-058", re.compile(r"толщин\w*\s+фундаментн\w*\s+плит\w*", re.I)),
    ("KR-067", re.compile(r"ведомост\w*\s+расход\w*\s+материал\w*", re.I)),
    ("PZ-014", re.compile(r"расчетн\w*\s+электрическ\w*\s+нагрузк\w*", re.I)),
    ("AR-050", re.compile(r"отделк\w*\s+помещен\w*\s+общественн\w*\s+назначен\w*", re.I)),
    ("AR-051", re.compile(r"естественн\w*\s+освещен\w*\s+помещен\w*", re.I)),
)
_STRUCTURAL_FIRE_CLASS = re.compile(
    r"(?P<label>класс\s+конструктивной\s+пожарной\s+опасности\s+здания)\s*[–—-]\s*"
    r"(?P<value>[СC][0-3])\b", re.I)
_PRESENCE_FEATURE_CUES = (
    ("SPZU-039", re.compile(r"пристенн\w*\s+дренаж\w*", re.I)),
    ("AR-053", re.compile(r"звукоизоляционн\w*\s+прокладк\w*", re.I)),
    ("ODI-122", re.compile(r"тактильн\w*\s+указател\w*", re.I)),
    ("ODI-123", re.compile(
        r"кнопк\w*\s+вызов\w*\s+персонал\w*|систем\w*\s+дву(?:х)?сторонн\w*\s+связ\w*", re.I)),
    ("ZU-129", re.compile(r"сч[её]тчик\w*\s+вод\w*|водосч[её]тчик\w*", re.I)),
)


def evaluate_review_candidates(object_id: str, manifest_hash: str,
                               sources: list[dict[str, Any]],
                               artifacts: list[dict[str, Any]]) -> dict[str, Any]:
    """Retain exact source lines despite missing revision, approval or PD/RD link."""
    if not isinstance(object_id, str) or not object_id or not isinstance(manifest_hash, str) \
            or len(manifest_hash) != 64:
        raise ValueError("review candidate run identity invalid")
    indexed_sources = {}
    for raw in sources:
        source = _source(raw, object_id)
        if source["sourceFileId"] in indexed_sources:
            raise ValueError("duplicate review candidate source")
        indexed_sources[source["sourceFileId"]] = source
    indexed_artifacts = {}
    for artifact in artifacts:
        source_id = artifact.get("sourceFileId")
        if source_id not in indexed_sources or source_id in indexed_artifacts:
            raise ValueError("unknown or duplicate review candidate artifact")
        _validate_artifact(artifact, indexed_sources[source_id])
        indexed_artifacts[source_id] = artifact
    rules = load_candidate_family_pack()["rules"]
    labels = {
        **{row["parameterCode"]: row for row in load_numeric_family_labels()["entries"]},
        **{row["parameterCode"]: row for row in load_class_family_labels()["entries"]},
        **{row["parameterCode"]: row for row in load_presence_family_labels()["entries"]},
    }
    if len(rules) != 47 or len(labels) != 47:
        raise ValueError("review candidate labels or rule pack incomplete")
    signals = []
    for source_id in sorted(indexed_artifacts):
        source = indexed_sources[source_id]
        artifact = indexed_artifacts[source_id]
        artifact_hash = _hash(artifact)
        for page in artifact["pages"]:
            if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
                continue
            declared_stage = (source["stages"][0] if len(source["stages"]) == 1 else
                              source.get("pageStages", {}).get(str(page["pageNumber"])))
            if declared_stage not in {"PD", "RD"}:
                declared_stage = None
            for block_index, block in enumerate(page["blocks"]):
                for line_index, line, line_start in _lines(block):
                    if len(line) > 1000:
                        continue
                    matches = [(rule, match) for rule in rules
                               for match in _line_matches(line, labels[rule["parameterCode"]],
                                                          rule["family"])]
                    # Reuse the public warm-floor lexical cue. It is a source
                    # reference only; missing RD text never proves absence.
                    for warm in _WARM_FLOOR.finditer(line) if len(line) <= 500 else ():
                        matches.append(({"parameterCode": "FREE-HEATING-001",
                                         "family": "TEXT_REFERENCE"},
                                        {"attribute": "warm_floor_reference",
                                         "matchedLabel": warm.group(0),
                                         "rawValue": warm.group(0), "rawUnit": None,
                                         "start": warm.start(), "end": warm.end()}))
                    if len(line) <= 500:
                        for structural in _STRUCTURAL_FIRE_CLASS.finditer(line):
                            matches.append(({"parameterCode": "PZ-023",
                                             "family": "CLASS_DECREASE"},
                                            {"attribute": "STRUCTURAL_FIRE_HAZARD_CLASS",
                                             "matchedLabel": structural.group("label"),
                                             "rawValue": structural.group("value"),
                                             "rawUnit": None,
                                             "start": structural.start("value"),
                                             "end": structural.end("value")}))
                        for code, attribute, pattern in _HVAC_PAGE_TOPICS:
                            for topic in pattern.finditer(line):
                                matches.append(({"parameterCode": code,
                                                 "family": "TEXT_REFERENCE"},
                                                {"attribute": attribute,
                                                 "matchedLabel": topic.group(0),
                                                 "rawValue": topic.group(0),
                                                 "rawUnit": None, "reason": "PAGE_TOPIC_LINE",
                                                 "start": topic.start(), "end": topic.end()}))
                        for code, pattern in _PRESENCE_FEATURE_CUES:
                            for feature in pattern.finditer(line):
                                matches.append(({"parameterCode": code,
                                                 "family": "PRESENCE_SET"},
                                                {"attribute": labels[code]["attribute"],
                                                 "matchedLabel": feature.group(0),
                                                 "rawValue": feature.group(0),
                                                 "rawUnit": None, "reason": "FEATURE_LABEL_LINE",
                                                 "start": feature.start(), "end": feature.end()}))
                        for code, pattern in _CATALOG_TOPIC_CUES:
                            preceding_blocks = page["blocks"][max(0, block_index - 12):block_index]
                            preceding_text = " ".join(item["text"] for item in preceding_blocks)
                            if code == "PZ-021" and not re.search(
                                r"В\s+рамках\s+разработки\s+проектной\s+документации\s+класс\s+энергетической",
                                preceding_text, re.I
                            ):
                                continue
                            if code == "ZU-126" and not (
                                any(re.search(r"^Наружные\s+стены$", item["text"], re.I)
                                    for item in page["blocks"])
                                and any("λ" in item["text"] for item in page["blocks"])
                                and re.search(r"Минераловатный\s+утеплитель", preceding_text, re.I)
                            ):
                                continue
                            if code == "ZU-127" and not (
                                any(re.search(r"Окна\s+и\s+витражи", item["text"], re.I)
                                    for item in page["blocks"])
                                and re.search(r"Блоки\s+оконные", preceding_text, re.I)
                                and block_index > 0
                                and re.search(r"Блоки\s+оконные", page["blocks"][block_index - 1]["text"], re.I)
                            ):
                                continue
                            if code == "ZU-128" and not (
                                any(re.fullmatch(r"Покрытие", item["text"], re.I)
                                    for item in page["blocks"])
                                and re.search(r"Минераловатный\s+плиты", preceding_text, re.I)
                                and block_index > 0
                                and page["blocks"][block_index - 1]["text"].strip() == "8"
                            ):
                                continue
                            if code in {"PZ-005", "PZ-006"} and not any(
                                re.search(r"Строительный\s+объем", previous["text"], re.I)
                                for previous in page["blocks"][max(0, block_index - 8):block_index]
                            ):
                                continue
                            if code == "PZ-011" and not (
                                any(re.search(r"\b1-\s*комн", item["text"], re.I)
                                    for item in page["blocks"])
                                and any(re.search(r"\b2-\s*комн", item["text"], re.I)
                                        for item in page["blocks"])
                            ):
                                continue
                            for topic in pattern.finditer(line):
                                matches.append(({"parameterCode": code,
                                                 "family": "TEXT_REFERENCE"},
                                                {"attribute": "catalog_topic",
                                                 "matchedLabel": topic.group(0),
                                                 "rawValue": topic.group(0),
                                                 "rawUnit": None, "reason": "CATALOG_TOPIC_LINE",
                                                 "start": topic.start(), "end": topic.end()}))
                    for rule, match in matches:
                            if len(match["rawValue"]) > 500:
                                continue
                            code = rule["parameterCode"]
                            start = line_start + match["start"]
                            end = line_start + match["end"]
                            missing = []
                            if source["revisionStatus"] != "CURRENT":
                                missing.append("REVISION_NOT_CONFIRMED")
                            if source["approvalStatus"] != "APPROVED":
                                missing.append("APPROVAL_NOT_CONFIRMED")
                            if declared_stage is None:
                                missing.append("PAGE_STAGE_NOT_CONFIRMED")
                            if source["sectionCode"] is None:
                                missing.append("SECTION_NOT_CONFIRMED")
                            if source.get("linkGroupId") is None:
                                missing.append("DOCUMENT_LINK_NOT_CONFIRMED")
                            if match.get("reason") == "PAGE_TOPIC_LINE":
                                missing.extend(("PAGE_TOPIC_NOT_COMPARISON",
                                                "CODE_MAPPING_NOT_CONFIRMED"))
                            if match.get("reason") == "FEATURE_LABEL_LINE":
                                missing.extend(("SCOPE_NOT_CONFIRMED",
                                                "CODE_MAPPING_NOT_CONFIRMED"))
                            if match.get("reason") == "CATALOG_TOPIC_LINE":
                                missing.extend(("PAGE_TOPIC_NOT_COMPARISON",
                                                "CODE_MAPPING_NOT_CONFIRMED"))
                                if code in {"ZU-126", "ZU-127", "ZU-128"}:
                                    missing.append("TABLE_ROW_ASSOCIATION_NOT_CONFIRMED")
                                else:
                                    missing.append("VALUE_NOT_EXTRACTED")
                                if code == "PZ-021":
                                    missing.append("CLASS_NOT_ASSIGNED_IN_SOURCE")
                                if code == "SPZU-026":
                                    missing.append("PAVING_MATERIAL_NOT_CONFIRMED")
                                if code == "SPZU-037":
                                    missing.append("PARKING_LAYOUT_NOT_CONFIRMED")
                                if code == "SPZU-035":
                                    missing.append("ZONE_PLAN_BOUNDARY_NOT_CONFIRMED")
                                if code == "KR-064":
                                    missing.append("SHAFT_DIMENSIONS_NOT_CONFIRMED")
                                if code == "IOS4-076":
                                    missing.append("NETWORK_VS_INTERNAL_NOT_CONFIRMED")
                                if code == "PPM-105":
                                    missing.append("EXTERIOR_EXIT_NOT_CONFIRMED")
                                if code == "IOS1-068":
                                    missing.append("CIRCUIT_DEVICE_ASSIGNMENT_NOT_CONFIRMED")
                                if code == "SM-132":
                                    missing.append("TOTAL_COST_AND_APPROVED_BASELINE_NOT_CONFIRMED")
                                if code == "SPZU-031":
                                    missing.append("TURNING_RADIUS_VALUE_NOT_CONFIRMED")
                            missing.append("ELEMENT_NOT_CONFIRMED")
                            line_boxes = block.get("lineBboxesMilliPoints") or []
                            line_box = (line_boxes[line_index] if line_index < len(line_boxes)
                                        else block["bboxMilliPoints"])
                            signal = {
                                "parameterCode": code, "family": rule["family"],
                                "reason": match.get("reason", "EXACT_LABEL_LINE"),
                                "attribute": match["attribute"],
                                "matchedLabel": match["matchedLabel"],
                                "rawValue": match["rawValue"], "rawUnit": match["rawUnit"],
                                "sourceFileId": source_id, "sourceSha256": source["sha256"],
                                "artifactSha256": artifact_hash,
                                "pageNumber": page["pageNumber"],
                                "pageWidthMilliPoints": page["widthMilliPoints"],
                                "pageHeightMilliPoints": page["heightMilliPoints"],
                                "stage": declared_stage,
                                "sectionCode": source["sectionCode"],
                                "revisionStatus": source["revisionStatus"],
                                "approvalStatus": source["approvalStatus"],
                                "origin": "PDF_TEXT_LAYER", "lineText": line,
                                "blockTextSha256": hashlib.sha256(block["text"].encode()).hexdigest(),
                                "locator": {"kind": "DOCUMENT_TEXT_BLOCK_LINE",
                                            "blockIndex": block_index, "lineIndex": line_index,
                                            "start": start, "end": end,
                                            "bboxMilliPoints": line_box},
                                "missingConfirmation": missing,
                            }
                            signals.append(signal)
    # One repeated label on one page is one navigation target. Exact occurrences
    # in different documents/pages remain distinct and can suggest a comparison.
    unique = {}
    for signal in signals:
        key = ((signal["sourceFileId"], signal["parameterCode"], signal["attribute"])
               if signal["reason"] == "CATALOG_TOPIC_LINE"
               else (signal["sourceFileId"], signal["pageNumber"], signal["parameterCode"],
                signal["attribute"])
               if signal["reason"] in {"FEATURE_LABEL_LINE", "PAGE_TOPIC_LINE",
                                       "CATALOG_TOPIC_LINE"}
               else (signal["sourceFileId"], signal["pageNumber"], signal["parameterCode"],
                     signal["attribute"], signal["rawValue"], signal["rawUnit"]))
        previous = unique.get(key)
        if previous is None or (signal["reason"] == "CATALOG_TOPIC_LINE"
                                and (signal["pageNumber"], -len(signal["lineText"]))
                                < (previous["pageNumber"], -len(previous["lineText"]))):
            unique[key] = signal
    signals = list(unique.values())
    by_code = defaultdict(list)
    for signal in signals:
        by_code[(signal["parameterCode"], signal["attribute"])].append(signal)
    candidates = []
    for signal in signals:
        opposite = "RD" if signal["stage"] == "PD" else "PD" if signal["stage"] == "RD" else None
        related = sorted((other for other in by_code[(signal["parameterCode"], signal["attribute"])]
                          if other["sourceFileId"] != signal["sourceFileId"]
                          and opposite is not None and other["stage"] == opposite
                          and ((signal["sectionCode"] is not None
                                and signal["sectionCode"] == other["sectionCode"])
                               or (indexed_sources[signal["sourceFileId"]].get("linkGroupId")
                                   is not None and indexed_sources[signal["sourceFileId"]]["linkGroupId"]
                                   == indexed_sources[other["sourceFileId"]].get("linkGroupId")))
                          and (indexed_sources[signal["sourceFileId"]].get("linkGroupId") is None
                               or indexed_sources[other["sourceFileId"]].get("linkGroupId") is None
                               or indexed_sources[signal["sourceFileId"]]["linkGroupId"]
                               == indexed_sources[other["sourceFileId"]]["linkGroupId"])),
                         key=lambda row: (row["sourceFileId"], row["pageNumber"]))[:3]
        differing = [other for other in related if signal["family"] not in {"PRESENCE_SET", "TEXT_REFERENCE"}
                     and other["rawValue"] != signal["rawValue"]
                     and other["rawUnit"] == signal["rawUnit"]]
        kind = ("POSSIBLE_DIFFERENCE" if differing else "POSSIBLE_PAIR" if related else "ONE_DOCUMENT_SIGNAL")
        missing = list(signal["missingConfirmation"])
        if related:
            if ("DOCUMENT_LINK_NOT_CONFIRMED" not in missing
                    and any(indexed_sources[row["sourceFileId"]].get("linkGroupId") is None
                            for row in related)):
                missing.append("DOCUMENT_LINK_NOT_CONFIRMED")
            missing.append("SAME_ELEMENT_NOT_CONFIRMED")
        candidate = {
            "schemaVersion": "review-candidate-v1", "resultType": "REVIEW_CANDIDATE",
            "kind": kind, "reason": signal["reason"],
            **{key: value for key, value in signal.items() if key != "missingConfirmation"},
            "relatedDocuments": [{"sourceFileId": row["sourceFileId"],
                                  "sourceSha256": row["sourceSha256"],
                                  "parameterCode": row["parameterCode"],
                                  "attribute": row["attribute"],
                                  "matchedLabel": row["matchedLabel"],
                                  "pageNumber": row["pageNumber"],
                                  "pageWidthMilliPoints": row["pageWidthMilliPoints"],
                                  "pageHeightMilliPoints": row["pageHeightMilliPoints"],
                                  "rawValue": row["rawValue"], "rawUnit": row["rawUnit"],
                                  "lineText": row["lineText"],
                                  "artifactSha256": row["artifactSha256"],
                                  "blockTextSha256": row["blockTextSha256"],
                                  "locator": row["locator"]} for row in related],
            "missingConfirmation": missing,
            "suggestedElement": None,
            "rank": (100 if kind == "POSSIBLE_DIFFERENCE" else 70 if related else 40)
                    - min(len(missing), 10)
                    - (7 if signal["reason"] == "CATALOG_TOPIC_LINE" and signal["parameterCode"] == "PPM-105"
                       else 12 if signal["reason"] == "CATALOG_TOPIC_LINE" else 8
                       if signal["reason"] in {"PAGE_TOPIC_LINE", "FEATURE_LABEL_LINE"}
                       else 0),
        }
        candidate["candidateId"] = _hash(candidate)
        candidates.append(candidate)
    candidates.sort(key=lambda row: (-row["rank"], row["sourceFileId"],
                                     row["pageNumber"], row["parameterCode"], row["candidateId"]))
    bounded = []
    counts = defaultdict(int)
    code_counts = defaultdict(int)
    for candidate in candidates:
        code_key = (candidate["sourceFileId"], candidate["parameterCode"])
        if (counts[candidate["sourceFileId"]] >= MAX_PER_SOURCE
                or code_counts[code_key] >= MAX_PER_CODE_PER_SOURCE
                or len(bounded) >= MAX_TOTAL):
            continue
        bounded.append(candidate)
        counts[candidate["sourceFileId"]] += 1
        code_counts[code_key] += 1
    result = {"schemaVersion": "review-candidates-v1", "resultType": "REVIEW_CANDIDATE",
              "objectId": object_id, "inputManifestHash": manifest_hash,
              "candidates": bounded, "candidateCount": len(bounded),
              "truncated": len(bounded) < len(candidates),
              "findingCount": None, "parameterCoverage": None}
    result["contentHash"] = _hash(result)
    return result
