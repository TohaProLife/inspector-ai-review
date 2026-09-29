#!/usr/bin/env python3
"""Package the current public-only review-candidate demonstration for handoff."""

from __future__ import annotations

import hashlib
import json
import subprocess
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output/review-candidates-20260929"
ORIGINALS = ROOT / "output/review-candidates-20260928/originals"
REFERENCE = ROOT / "datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data"
SOURCE_ARCHIVE = OUTPUT / "reviewer-source-20260929.zip"
EVIDENCE_ARCHIVE = OUTPUT / "reviewer-evidence-20260929.zip"
SET_NAMES = tuple(sorted(path.parent.name for path in OUTPUT.glob("*/review-candidates.json")))
PUBLIC_IDS = tuple(sorted({source["sourceFileId"] for set_name in SET_NAMES
                           for source in json.loads((OUTPUT / set_name / "verification-input.json")
                                                    .read_text())["sourceFiles"]}))
assert len(SET_NAMES) >= 33 and len(PUBLIC_IDS) >= 53


def git_files(*args: str) -> list[Path]:
    result = subprocess.check_output(["git", "ls-files", "-z", *args], cwd=ROOT)
    return [Path(item.decode()) for item in result.split(b"\0") if item]


def public_manifest() -> tuple[bytes, dict[str, dict]]:
    rows = [json.loads(line) for line in (REFERENCE / "document_manifest.jsonl").read_text().splitlines() if line]
    public = [row for row in rows if row["split"] == "TRAIN_PUBLIC"
              and row["distribution_status"] == "INCLUDE"
              and row["label_visibility"] == "PUBLIC_TRAIN"]
    assert len(public) == 203
    return ("\n".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) for row in public) + "\n").encode(), {
        row["file_id"]: row for row in public
    }


def package(path: Path, entries: dict[str, bytes]) -> None:
    lines = []
    for name, payload in sorted(entries.items()):
        lines.append(f"{hashlib.sha256(payload).hexdigest()}  {name}")
    entries["SHA256SUMS.txt"] = ("\n".join(lines) + "\n").encode()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, payload in sorted(entries.items()):
            archive.writestr(name, payload)
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None
        for line in archive.read("SHA256SUMS.txt").decode().splitlines():
            digest, name = line.split("  ", 1)
            assert hashlib.sha256(archive.read(name)).hexdigest() == digest
    print(f"{path.name}: {len(entries) - 1} payload files, {path.stat().st_size} bytes, SHA-256 {hashlib.sha256(path.read_bytes()).hexdigest()}")


manifest_bytes, manifest = public_manifest()
tracked = git_files()
untracked_source = git_files("--others", "--exclude-standard", "apps", "services", "scripts", "migrations", "docs", "infra", "schemas")
source_entries: dict[str, bytes] = {}
for path in sorted(set(tracked + untracked_source)):
    if not (ROOT / path).is_file() or path.parts[0] in {"output", "var"}:
        continue
    if path == REFERENCE.relative_to(ROOT) / "document_manifest.jsonl":
        payload = manifest_bytes
    else:
        payload = (ROOT / path).read_bytes()
    source_entries[f"source/{path}"] = payload
source_entries["README.md"] = ("""# Исходники inspector-ai для проверки

Снимок исходников inspector-ai на 29.09.2026.
Включены `REVIEW_CANDIDATE`, миграция 029, локальный scorer, изменения ZU-127
и рабочие экраны дизайн-системы из ветки d81eb8e (главная, навигация, иконки, темы).
Манифест в исходниках сокращён до 203 разрешённых `TRAIN_PUBLIC/INCLUDE/PUBLIC_TRAIN` записей.
Локальные `.env`, ключи, runtime и ответы `TEST_HIDDEN` отсутствуют.

Распакуйте `source/` как корень проекта. Данные, артефакты, исходные PDF и журнал
живой демонстрации находятся в `reviewer-evidence-20260929.zip`.
Подробная проверка и ограничения: `source/docs/operations/REVIEW_CANDIDATES_20260929.md`.
Подсказки не являются официальными замечаниями или подтверждёнными нарушениями.
""").encode()
package(SOURCE_ARCHIVE, source_entries)

evidence_entries: dict[str, bytes] = {
    "evidence/public-manifest-subset.jsonl": ("\n".join(
        json.dumps(manifest[file_id], ensure_ascii=False, separators=(",", ":"))
        for file_id in PUBLIC_IDS) + "\n").encode(),
    "evidence/public_train_checks.jsonl": (REFERENCE / "public_train_checks.jsonl").read_bytes(),
    "evidence/technical-note.md": (ROOT / "docs/operations/REVIEW_CANDIDATES_20260929.md").read_bytes(),
    "evidence/local-scorer-empty-public-envelope.json":
        (ROOT / "output/local-scorer-20260929/empty-public-predictions-203.json").read_bytes(),
    "evidence/local-scorer-empty-public-report.json":
        (ROOT / "output/local-scorer-20260929/empty-public-report-203.json").read_bytes(),
}
assert (ROOT / "output/local-scorer-20260929/public-manifest-203.jsonl").read_bytes() == manifest_bytes
for file_id in PUBLIC_IDS:
    path = ORIGINALS / f"{file_id}.pdf"
    payload = path.read_bytes()
    assert len(payload) == manifest[file_id]["size_bytes"]
    assert hashlib.sha256(payload).hexdigest() == manifest[file_id]["sha256"]
    evidence_entries[f"evidence/originals/{path.name}"] = payload

all_candidates: list[dict] = []
for set_name in SET_NAMES:
    directory = OUTPUT / set_name
    artifact = json.loads((directory / "review-candidates.json").read_text())
    assert artifact["resultType"] == "REVIEW_CANDIDATE"
    all_candidates.extend(artifact["candidates"])
    for candidate in artifact["candidates"]:
        assert candidate["sourceFileId"] in PUBLIC_IDS
        assert candidate["sourceSha256"] == manifest[candidate["sourceFileId"]]["sha256"]
    for name in ("report.json", "review-candidates.json", "verification-input.json"):
        path = directory / name
        evidence_entries[f"evidence/{set_name}/{name}"] = path.read_bytes()
    if set_name == "tyumenskaya-expanded":
        evidence_entries[f"evidence/{set_name}/public-eval.json"] = (directory / "public-eval.json").read_bytes()
    crop_dir = directory / "crops"
    crop_report = json.loads((crop_dir / "report.json").read_text())
    assert len(crop_report["rows"]) == len(artifact["candidates"])
    evidence_entries[f"evidence/{set_name}/crops/report.json"] = (crop_dir / "report.json").read_bytes()
    for row in crop_report["rows"]:
        path = crop_dir / row["image"]
        payload = path.read_bytes()
        assert hashlib.sha256(payload).hexdigest() == row["imageSha256"]
        evidence_entries[f"evidence/{set_name}/crops/{path.name}"] = payload

catalog_rows = [json.loads(line) for line in
                (ROOT / "services/worker/rules/parameter_catalog_132.jsonl").read_text().splitlines() if line]
assert len(catalog_rows) == 132 and len({row["parameter_code"] for row in catalog_rows}) == 132
catalog_codes = {row["parameter_code"] for row in catalog_rows}
# The roof replay includes F0104 already present in an older multi-PDF run.
# Report distinct saved candidate identities, not the sum of overlapping runs.
all_candidates = list({row["candidateId"]: row for row in all_candidates}.values())
signal_codes = {row["parameterCode"] for row in all_candidates} & catalog_codes
assert len(all_candidates) >= 269 and len(signal_codes) >= 113
coverage = {"resultType": "REVIEW_CANDIDATE_CODE_MAP", "formalCoverageCalculated": False,
            "matrixCodeCount": 132, "matrixCodesWithPublicSignals": len(signal_codes),
            "candidateCount": len(all_candidates),
            "freeCandidateCount": sum(row["parameterCode"] not in catalog_codes
                                      for row in all_candidates),
            "codes": [{"code": row["parameter_code"], "parameterName": row["parameter_name"],
                       "candidateCount": sum(candidate["parameterCode"] == row["parameter_code"]
                                             for candidate in all_candidates),
                       "examples": [{"sourceFileId": candidate["sourceFileId"],
                                     "pageNumber": candidate["pageNumber"],
                                     "candidateId": candidate["candidateId"]}
                                    for candidate in all_candidates
                                    if candidate["parameterCode"] == row["parameter_code"]][:3]}
                      for row in catalog_rows]}
evidence_entries["evidence/candidate-code-map.json"] = (json.dumps(
    coverage, ensure_ascii=False, indent=2) + "\n").encode()
evidence_entries["evidence/homeserver-f0147-browser-export.json"] = (
    OUTPUT / "homeserver-f0147-browser-export.json").read_bytes()
evidence_entries["evidence/homeserver-f0147-post-reboot-export.json"] = (
    OUTPUT / "homeserver-f0147-post-reboot-export.json").read_bytes()

for directory_name in ("demo-latest-accept", "demo-latest-final", "demo-f0106-final",
                       "demo-f0126-final", "demo-f0163-final", "demo-f0125-odi116",
                       "demo-f0101-volume", "demo-f0125-odi118", "demo-f0152-thermal",
                       "demo-f0112-zone", "demo-f0158-shaft",
                       "demo-f0170-heating-diameter", "demo-f0193-ppm105"):
    directory = OUTPUT / directory_name
    for name in ("demo-receipt.json", "review-export.json", "source-fragment.png", "source-page.png"):
        evidence_entries[f"evidence/{directory_name}/{name}"] = (directory / name).read_bytes()
evidence_entries["evidence/demo-latest-final/web-candidates.png"] = (OUTPUT / "demo-latest-final/web-candidates.png").read_bytes()
evidence_entries["evidence/demo-f0106-final/web-candidates.png"] = (OUTPUT / "demo-f0106-final/web-candidates.png").read_bytes()
evidence_entries["evidence/demo-f0126-final/web-candidates.png"] = (OUTPUT / "demo-f0126-final/web-candidates.png").read_bytes()
evidence_entries["evidence/demo-f0163-final/web-candidates.png"] = (OUTPUT / "demo-f0163-final/web-candidates.png").read_bytes()
evidence_entries["evidence/demo-f0125-odi116/web-candidates.png"] = (OUTPUT / "demo-f0125-odi116/web-candidates.png").read_bytes()
evidence_entries["evidence/f0125-live-run.json"] = (OUTPUT / "f0125-live-run.json").read_bytes()
evidence_entries["evidence/demo-f0101-volume/web-candidates.png"] = (OUTPUT / "demo-f0101-volume/web-candidates.png").read_bytes()
evidence_entries["evidence/f0101-volume-live-run.json"] = (OUTPUT / "f0101-volume-live-run.json").read_bytes()
evidence_entries["evidence/demo-f0125-odi118/web-candidates.png"] = (OUTPUT / "demo-f0125-odi118/web-candidates.png").read_bytes()
evidence_entries["evidence/f0125-last-live-run.json"] = (OUTPUT / "f0125-last-live-run.json").read_bytes()
evidence_entries["evidence/demo-f0152-thermal/live-zu127-crop-with-font.png"] = (OUTPUT / "live-zu127-crop-with-font.png").read_bytes()
evidence_entries["evidence/f0152-thermal-live-run.json"] = (OUTPUT / "f0152-thermal-live-run.json").read_bytes()
evidence_entries["evidence/demo-f0112-zone/web-candidates.png"] = (OUTPUT / "demo-f0112-zone/web-candidates.png").read_bytes()
evidence_entries["evidence/f0112-zone-live-run.json"] = (OUTPUT / "f0112-zone-live-run.json").read_bytes()
evidence_entries["evidence/f0158-shaft-live-run.json"] = (OUTPUT / "f0158-shaft-live-run.json").read_bytes()
evidence_entries["evidence/f0170-heating-diameter-live-run.json"] = (OUTPUT / "f0170-heating-diameter-live-run.json").read_bytes()
evidence_entries["evidence/f0193-ppm105-live-run.json"] = (OUTPUT / "f0193-ppm105-live-run.json").read_bytes()
evidence_entries["evidence/latest-run.json"] = (OUTPUT / "demo-pair-f0104-f0145/latest-run.json").read_bytes()
evidence_entries["evidence/f0106-final-run.json"] = (OUTPUT / "f0106-final-run.json").read_bytes()
evidence_entries["evidence/f0126-final-run.json"] = (OUTPUT / "f0126-final-run.json").read_bytes()
evidence_entries["evidence/f0163-final-run.json"] = (OUTPUT / "f0163-final-run.json").read_bytes()
evidence_entries["evidence/demo-f0106-replay/demo-receipt.json"] = (OUTPUT / "demo-f0106-replay/demo-receipt.json").read_bytes()
evidence_entries["README.md"] = (f"""# Открытые доказательства «Кандидатов на замечания»

{len(PUBLIC_IDS)} оригинальных PDF сверены с публичным манифестом по размеру и SHA-256.
`publicManifestSha256` в live receipts относится к исходному манифесту
базового набора; его публичные 203 строки сохранены в архиве исходников.
Сверяйте включённые PDF по `evidence/public-manifest-subset.jsonl`.
На {len(PUBLIC_IDS)} PDF: {len(all_candidates)} уникальных неподтверждённых подсказок по {len(signal_codes)} из 132 матричных кодов и одному
свободному коду. Два PDF прежнего неразмеченного контроля дают одну подсказку.
Браузерный прогон homeserver `CHK-870B6DA0` сохранён отдельно в
`evidence/homeserver-f0147-browser-export.json`: 2 подсказки, 2 решения,
0 официальных нарушений. В исходных пакетах также есть новый `SPZU-031`
на F0148/PDF стр. 78; численный радиус и геометрия проезда не подтверждены.
`evidence/homeserver-f0147-post-reboot-export.json`: новый run `CHK-5D2D28DA`
после перезапуска homeserver, 2 подсказки, 2 решения и 0 подтверждённых нарушений.
Текстовые артефакты, отчёты, PNG фрагменты и журнал живой демонстрации
содержатся в `evidence/`. Для каждого файла есть SHA-256 в `SHA256SUMS.txt`.
`evidence/candidate-code-map.json` показывает все 132 кода, число подсказок
и страницы по {len(signal_codes)} кодам с реальным сигналом; это не официальный coverage.

Парный живой run `CHK-5FA94BDE`: 15 кандидатов, KR-067 принят для проверки,
AR-050 отклонён, 5 официальных ABSTAIN, 0 findings и 0 протоколов.
На финальной сборке run `CHK-26CA6BC0`: 11 кандидатов, KR-058 на F0106/53
принят для проверки, 0 findings и 0 протоколов.
На расширенной сборке run `CHK-E0763719`: 5 кандидатов, PZ-012 на F0126/14
принят для проверки, 0 findings и 0 протоколов.
На последней сборке run `CHK-D5DBED8E`: 2 кандидата, IOS2-072 на F0163/9
принят для проверки, 0 findings и 0 протоколов.
На текущей сборке run `CHK-9AA62FD5`: 7 кандидатов, ODI-116 на F0125/8
принят для проверки, 0 findings и 0 протоколов. Приложены снимок web,
SHA-проверенные лист, фрагмент, решение и экспорт.
На сборке с PPM-105 run `CHK-5A912E06`: 16 кандидатов, PPM-105 на F0193/72
принят для дальнейшей проверки, 0 findings и 0 протоколов. В строке названы
выходы В2/В3 и ширина 1,3 м; направление непосредственно наружу не подтверждено.
На финальной сборке run `CHK-7F0EA7DC`: 6 кандидатов, PZ-005 на F0101/9
принят для проверки; PZ-006 и PZ-011 также видны. 0 findings и 0 протоколов.
Приложены снимок web, SHA-проверенные лист, фрагмент, решение и экспорт.
На обновлённой сборке run `CHK-412B8AD5`: 9 кандидатов, ODI-118 на F0125/8
принят для проверки. 5 официальных ABSTAIN, 0 findings и 0 протоколов.
Приложены снимок web, SHA-проверенные лист, фрагмент, решение и экспорт.
На обновлённой сборке run `CHK-44D79216`: 14 кандидатов, ZU-127 на F0152/49
принят для проверки. 5 официальных ABSTAIN, 0 findings и 0 протоколов.
Приложены SHA-проверенные лист, исправленный фрагмент, решение и экспорт.
На обновлённой сборке run `CHK-65F44CE9`: 14 кандидатов, SPZU-035 на F0112/14
принят для проверки. 5 официальных ABSTAIN, 0 findings и 0 протоколов.
Приложены снимок web, SHA-проверенные лист, фрагмент, решение и экспорт.
На текущей сборке run `CHK-458B1AFB`: 7 кандидатов, KR-064 на F0158/22
принят для проверки. Run `CHK-55C5B498`: 1 кандидат, IOS4-076 на F0170/28
принят для проверки. В обоих 5 официальных ABSTAIN, 0 findings и 0 протоколов.
Приложены SHA-проверенные листы, фрагменты, решения и экспорты.
Открытая оценка: попадание на размеченную страницу 4/4 групп, полная пара
страниц ПД/РД 0/4. Отрицательных открытых меток нет; FPR/F1 не вычисляются.
Подробности и ограничения: `evidence/technical-note.md`.

Проверка архива: `sha256sum -c SHA256SUMS.txt` после распаковки.
Для запуска приложения используйте соответствующий `reviewer-source-20260929.zip`.
""").encode()
package(EVIDENCE_ARCHIVE, evidence_entries)
(OUTPUT / "reviewer-archives.sha256").write_text("".join(
    f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
    for path in (SOURCE_ARCHIVE, EVIDENCE_ARCHIVE)
))
