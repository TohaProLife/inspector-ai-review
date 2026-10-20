#!/usr/bin/env python3
"""Create controlled multirow originals for per-fact browser acceptance. No real project data."""
import argparse
import json
from pathlib import Path
import fitz


def create(directory: Path, kind: str = 'building') -> dict:
    directory.mkdir(parents=True, exist_ok=True)
    documents=[]
    sidewalk = kind == 'sidewalk'
    egress = kind == 'egress'
    stairs = kind == 'stairs'
    sources = [('PD', [100, 200], 'SPZU' if sidewalk else 'PZ'),
               ('RD', [110 if sidewalk else 103, 205], 'PP' if sidewalk else 'AR')]
    if egress:
        sources = [('PD', ['2.1', '2.1'], 'AR'), ('RD', ['1.99', '1.89'], 'AR')]
    if stairs:
        sources = [('PD', ['310', '149'], 'AR'), ('RD', ['299', '151'], 'AR')]
    label = 'Площадь тротуарного плиточного покрытия' if sidewalk else 'Общая площадь здания'
    for stage, values, section in sources:
        document=fitz.open()
        page=document.new_page(width=595, height=842)
        rows=[f'СИНТЕТИЧЕСКИЙ ТЕСТ {"T14: плиточное мощение" if sidewalk else "T13: независимые строки"}',
              'Не данные реального строительного объекта',
              'Разные элементы. Привязка только по явному решению инспектора.',
              f'{label}: {values[0]} м²',
              f'{label}: {values[1]} м²']
        if egress:
            rows = ['СИНТЕТИЧЕСКИЙ ТЕСТ T18: высоты путей эвакуации',
                    'Не данные реального строительного объекта',
                    'Разные элементы. Применимость порога подтверждается отдельно.',
                    f'Высота эвакуационного коридора в свету: {values[0]} м',
                    f'Высота эвакуационной двери в свету: {values[1]} м']
        if stairs:
            rows = ['СИНТЕТИЧЕСКИЙ ТЕСТ T20: размеры ступеней лестницы',
                    'Не данные реального строительного объекта',
                    'Марш и ступень. Применимость порога подтверждается отдельно.',
                    f'Глубина проступи лестницы в свету: {values[0]} мм',
                    f'Высота подступенка лестницы после отделки: {values[1]} мм']
        for index,row in enumerate(rows):
            page.insert_text((30, 55+index*45),row,fontsize=10,
                fontfile='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',fontname='DejaVu')
        name=f'matrix-{"stairs" if stairs else "egress" if egress else "sidewalk" if sidewalk else "fact"}-binding-{stage}.pdf'
        document.save(directory/name)
        document.close()
        documents.append({'name':name,'stage':stage,'sectionCode':section})
    descriptor={'schemaVersion':f'synthetic-matrix-{"stairs" if stairs else "egress" if egress else "sidewalk" if sidewalk else "fact"}-binding-v1','documents':documents,
        'expected':{'observations':4,'initialQualified':0,'boundQualified':2 if egress or stairs else 1,'unboundObservations':0 if egress or stairs else 2}}
    (directory/'fixture.json').write_text(json.dumps(descriptor,ensure_ascii=False,indent=2)+'\n')
    return {'directory':str(directory),'documents':len(documents),'expected':descriptor['expected']}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,default=Path('/tmp/matrix-fact-fixture'))
    parser.add_argument('--kind',choices=['building','sidewalk','egress','stairs'],default='building')
    args=parser.parse_args()
    print(json.dumps(create(args.directory.resolve(),args.kind),ensure_ascii=False))
