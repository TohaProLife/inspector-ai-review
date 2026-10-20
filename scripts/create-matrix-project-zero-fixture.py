#!/usr/bin/env python3
"""Controlled declared-zero PDFs. Synthetic inputs never establish a real datum."""
import argparse
import hashlib
import json
from pathlib import Path
import fitz


def create(directory: Path) -> dict:
    directory.mkdir(parents=True, exist_ok=True)
    if any(directory.iterdir()):
        raise ValueError('Preserve previous fixture; choose an empty directory')
    documents = []
    for stage, value in [('PD', '159,95'), ('RD', '159.96')]:
        name = f'matrix-project-zero-binding-{stage}.pdf'
        document = fitz.open()
        page = document.new_page(width=2000, height=842)
        rows = [(40, 'СИНТЕТИЧЕСКИЙ ТЕСТ T30: не данные строительного объекта'),
                (60, 'Геодезическое основание, общий пол и высотная система проверяются явно.')]
        if stage == 'PD':
            rows += [(140, f'За относительную отметку 0,000 принята абсолютная отметка {value} м., что соответствует '),
                     (154, 'отметке чистого пола входного вестибюля на 1-м этаже.')]
        else:
            rows += [(140, f'За относительную отметку ±0.000 принята отметка чистого пола первого этажа, соответствующая абсолютной отметке {value}.'),
                     (220, 'Все размеры даны в миллиметрах,'), (234, 'отметки - в метрах.')]
        for y, text in rows:
            page.insert_text((50, y), text, fontsize=10, fontname='DejaVu',
                             fontfile='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
        document.save(directory / name)
        document.close()
        documents.append({'name': name, 'stage': stage, 'sectionCode': 'PZ' if stage == 'PD' else 'KR',
                          'sha256': hashlib.sha256((directory / name).read_bytes()).hexdigest()})
    fixture = {'schemaVersion': 'synthetic-matrix-project-zero-binding-v1', 'documents': documents,
               'expected': {'observations': 2, 'initialQualified': 0, 'boundQualified': 1,
                            'attribute': 'PROJECT_ZERO_ABSOLUTE_ELEVATION', 'canonicalUnit': 'm',
                            'ruleId': 'matrix-pz-009-declared_project_zero_absolute_elevation'}}
    (directory / 'fixture.json').write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + '\n')
    return {'directory': str(directory), 'documents': 2}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    print(json.dumps(create(parser.parse_args().directory.resolve()), ensure_ascii=False))
