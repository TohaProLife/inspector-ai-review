#!/usr/bin/env python3
"""Create two controlled territory-fence PDFs. No real project data or approval."""
import argparse
import hashlib
import json
from pathlib import Path
import fitz


def create(directory: Path) -> dict:
    directory.mkdir(parents=True, exist_ok=True)
    names = [f'matrix-fence-binding-{stage}.pdf' for stage in ('PD', 'RD')]
    if any((directory / name).exists() for name in [*names, 'fixture.json']):
        raise ValueError('Preserve existing fixture; choose a new directory')
    documents = []
    for stage, value, name in zip(('PD', 'RD'), ('2.5', '2.4'), names):
        document = fitz.open()
        page = document.new_page(width=595, height=842)
        rows = ['СИНТЕТИЧЕСКИЙ ТЕСТ T22: высота ограждения территории',
                'Не данные реального строительного объекта',
                'Участок, зона, тип и база измерения проверяются отдельно.',
                f'Высота ограждения территории: {value} м']
        for index, row in enumerate(rows):
            page.insert_text((30, 55 + index * 45), row, fontsize=10,
                             fontfile='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', fontname='DejaVu')
        document.save(directory / name)
        document.close()
        documents.append({'name': name, 'stage': stage, 'sectionCode': 'GP',
                          'sha256': hashlib.sha256((directory / name).read_bytes()).hexdigest()})
    descriptor = {'schemaVersion': 'synthetic-matrix-fence-binding-v1', 'documents': documents,
                  'expected': {'observations': 2, 'initialQualified': 0, 'boundQualified': 1,
                               'attribute': 'TERRITORY_FENCE_HEIGHT', 'canonicalUnit': 'm',
                               'ruleId': 'matrix-spzu-036-territory_fence_height'}}
    (directory / 'fixture.json').write_text(json.dumps(descriptor, ensure_ascii=False, indent=2) + '\n')
    return {'directory': str(directory), 'documents': 2, 'expected': descriptor['expected']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('/tmp/matrix-fence-fixture'))
    args = parser.parse_args()
    print(json.dumps(create(args.directory.resolve()), ensure_ascii=False))
