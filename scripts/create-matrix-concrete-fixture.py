#!/usr/bin/env python3
"""Create explicitly synthetic concrete PDFs and validate local source geometry.

Selected complete public rows keep their wording and source-relative placement.
Every generated PDF has a new SHA; RD's single class token is changed to В25.
No source approval, physical applicability or structural identity is inferred.
"""
from __future__ import annotations
import argparse,copy,hashlib,json,sys
from pathlib import Path
import fitz
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'services/worker'))
from inspector_worker.text_layer import extract_pdf_text_artifact
from inspector_worker.concrete_prose import EXTRACTOR_VERSION,extract_concrete_candidates
from inspector_worker.matrix_engine import build_matrix_execution
from inspector_worker.matrix_fact_scope import derive_matrix_fact_target
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
LAYER_SHA='9f37be960de31044d71f57e29a3680168d71e82920fe055723e733f31a9269d9'
RULE='matrix-kr-055-concrete_class'
ATTRIBUTE='CONCRETE_CLASS'

def create(directory:Path)->dict:
 directory.mkdir(parents=True,exist_ok=True)
 if any(directory.iterdir()):raise ValueError('Preserve existing fixture; choose an empty directory')
 assert hashlib.sha256((ROOT/'services/worker/inspector_worker/text_layer.py').read_bytes()).hexdigest()==LAYER_SHA
 public=json.loads((ROOT/'services/worker/tests/fixtures/rebar-F0106-F0139.json').read_text())
 documents=[];results=[];sources=[];artifacts=[]
 for source in public['sources']:
  stage=source['source']['stage'];original=source['sourceArtifact'];doc=fitz.open();font=fitz.Font(fontfile=FONT)
  page_rows=[(49,[(10,0),(10,1)]),(50,[(0,0),(3,0)])] if stage=='PD' else [(4,[(1,3),(44,0)])]
  for original_page,selected in page_rows:
   old=original['pages'][original_page-1];width=old['widthMilliPoints']/1000;height=old['heightMilliPoints']/1000
   page=doc.new_page(width=width,height=height)
   for block_index,line_index in selected:
    block=old['blocks'][block_index];text=block['text'].split('\n')[line_index];box=block['lineBboxesMilliPoints'][line_index]
    if stage=='RD' and block_index==44:
     assert text.count('В30')==1;text=text.replace('В30','В25',1)
    point=fitz.Point(box[0]/1000,height-(box[1]/1000+2.8828125))
    scale=(box[2]-box[0])/1000/font.text_length(text,fontsize=12)
    page.insert_text(point,text,fontsize=12,fontname='T32DejaVu',fontfile=FONT,morph=(point,fitz.Matrix(scale,1)))
   page.insert_text((40 if stage=='PD' else 900,815 if stage=='PD' else 50),
    'СИНТЕТИЧЕСКИЙ ТЕСТ T32. Не данные строительного объекта.',fontsize=9,fontname='T32DejaVu',fontfile=FONT)
  name=f'matrix-concrete-binding-{stage}.pdf';pdf=directory/name
  doc.set_metadata({'title':f'SYNTHETIC T32 {stage}: controlled stair concrete strength fixture',
   'subject':'Synthetic source geometry and HTTP review test; not real structural approval'})
  doc.save(pdf);doc.close();raw=pdf.read_bytes();digest=hashlib.sha256(raw).hexdigest()
  artifact=extract_pdf_text_artifact(pdf,'SYNTHETIC-T32-'+stage,digest)
  assert artifact['pageCount']==(2 if stage=='PD' else 1)
  candidates=[]
  for i,page in enumerate(artifact['pages']):
   candidates.extend(extract_concrete_candidates(page,stage,artifact['pages'][i-1] if i else None))
  assert len(candidates)==1,(stage,candidates,artifact)
  candidate=candidates[0];assert candidate['value']==('В30' if stage=='PD' else 'В25')
  assert len(candidate['primaryFragments'])==1 and len(candidate['contextFragments'])==(3 if stage=='PD' else 1)
  assert candidate['rawUnit']=='B_CLASS' and candidate['canonicalUnit']=='B_CLASS'
  (directory/f'{stage}.text.json').write_text(json.dumps(artifact,ensure_ascii=False,sort_keys=True,separators=(',',':')))
  documents.append({'name':name,'stage':stage,'sectionCode':'KR','sha256':digest,'bytes':len(raw),'pages':artifact['pageCount']})
  results.append({'stage':stage,'candidate':candidate,'textArtifactSha256':hashlib.sha256((directory/f'{stage}.text.json').read_bytes()).hexdigest()})
  sources.append({'sourceFileId':artifact['sourceFileId'],'sha256':digest,'stages':[stage]});artifacts.append(artifact)
 fixture={'schemaVersion':'synthetic-matrix-concrete-binding-v1','syntheticOnly':True,'extractorVersion':EXTRACTOR_VERSION,
  'documents':documents,'expected':{'observations':2,'pages':3,'initialQualified':0,'boundQualified':1,'attribute':ATTRIBUTE,
   'canonicalUnit':'B_CLASS','ruleId':RULE,'values':['В30','В25'],'qualifiedSequence':[0,1,0,1],'delta':'-5'}}
 (directory/'fixture.json').write_text(json.dumps(fixture,ensure_ascii=False,indent=2)+'\n')
 (directory/'extraction-acceptance.json').write_text(json.dumps({'status':'PASS','syntheticOnly':True,'textLayerSha256':LAYER_SHA,'results':results},ensure_ascii=False,indent=2)+'\n')
 args={'object_id':'synthetic-T32-local-only','input_manifest_hash':'a'*64,'sources':sources,'text_artifacts':artifacts}
 def rows(a):return [r for r in build_matrix_execution(**a)['results'] if r['ruleId']==RULE]
 initial=build_matrix_execution(**args);sequence=[sum(bool(r['qualified']) for r in rows(args))]
 facts={f['stage']:f for f in initial['observations'] if f['attribute']==ATTRIBUTE}
 assert set(facts)=={'PD','RD'} and len(initial['observations'])==2
 reviewed=copy.deepcopy(args);reviewed['input_manifest_hash']='b'*64
 for i,(source,artifact) in enumerate(zip(reviewed['sources'],reviewed['text_artifacts'])):
  target=derive_matrix_fact_target(facts[source['stages'][0]],artifact);assert target
  target={'checkId':'synthetic-T32-origin','executionContentHash':'c'*64,**{k:target[k] for k in ('observationId','evidenceHash','textArtifactHash')}}
  contexts={'ELEMENT_IDENTITY':{'reference':'Local synthetic same cast-in-place load-bearing stair identity explicitly simulated',
   'componentRole':'MONOLITHIC_LOAD_BEARING_STAIR','componentKey':'synthetic-T32-stair','zoneKey':'synthetic-T32-underground-flight-1',
   'operatingModeKey':'CAST_IN_PLACE_LOAD_BEARING_STAIR','measurementBasisKey':'CONCRETE_COMPRESSIVE_STRENGTH_CLASS'},
   'MATERIAL_CLASS_BASIS':{'reference':'Local synthetic same heavy concrete compressive strength class basis explicitly simulated',
    'attribute':ATTRIBUTE,'canonicalUnit':'B_CLASS','measurementBasisKey':'CONCRETE_COMPRESSIVE_STRENGTH_CLASS'}}
  source.update(sectionCode='KR',revisionStatus='CURRENT',approvalStatus='APPROVED',linkGroupId='synthetic-T32-local')
  source['scopeProofs']={'FACT_BINDINGS':{'schemaVersion':'matrix-fact-scopes-v1','status':'VERIFIED','sourceFileId':source['sourceFileId'],
   'sourceSha256':source['sha256'],'objectId':reviewed['object_id'],'inputManifestHash':reviewed['input_manifest_hash'],
   'reference':'Local synthetic proof simulation; not authenticated server evidence','reviewContentHash':('e' if i==0 else 'f')*64,
   'bindings':[{'ruleId':RULE,'ruleVersion':'1','parameterCode':'KR-055','entityKey':'synthetic-T32-stair',
    'reference':'Local simulated same synthetic load-bearing stair','target':target,'contexts':contexts}]}}
 sequence.append(sum(bool(r['qualified']) for r in rows(reviewed)))
 withdrawn=copy.deepcopy(reviewed);del withdrawn['sources'][1]['scopeProofs']['FACT_BINDINGS']['bindings'][0]['contexts']['MATERIAL_CLASS_BASIS']
 sequence.append(sum(bool(r['qualified']) for r in rows(withdrawn)));sequence.append(sum(bool(r['qualified']) for r in rows(reviewed)))
 assert sequence==[0,1,0,1]
 accepted=[r for r in rows(reviewed) if r['qualified']];assert len(accepted)==1 and accepted[0]['delta']=='-5'
 local={'status':'PASS_LOCAL_SIMULATION','authenticatedServerProof':False,'syntheticOnly':True,'standWrites':0,'browserCalls':0,
  'qualifiedSequence':sequence,'delta':'-5','sources':documents,'primaryCounts':[1,1],'contextCounts':[3,1]}
 (directory/'local-engine.json').write_text(json.dumps(local,ensure_ascii=False,indent=2)+'\n')
 return local

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--directory',required=True,type=Path)
 print(json.dumps(create(parser.parse_args().directory.resolve()),ensure_ascii=False))
