export const visualCropFixtureScript = String.raw`
import hashlib,json,os,tempfile
from pathlib import Path
from unittest.mock import patch
import fitz
from inspector_worker.visual_proposal_adapter import VisualProposalAdapter,_PROFILES
with tempfile.TemporaryDirectory() as directory:
 path=Path(directory)/'rotated.pdf'
 with fitz.open() as document:
  page=document.new_page(width=600,height=400)
  for x,y in [(50,40),(250,140),(450,240)]:
   page.draw_rect(fitz.Rect(x,y,x+6,y+50),color=(1,0,0),width=.4)
   page.draw_line(fitz.Point(x+6,y+20),fitz.Point(x+45,y+20),color=(0,0,1))
  page.set_rotation(270);document.save(path)
 digest=hashlib.sha256(path.read_bytes()).hexdigest();out=[]
 def download(_path,destination,_sha,_size,_attempt):destination.write_bytes(path.read_bytes())
 for profile_id in ['red-vector-proposals-v7-sample','red-vector-proposals-v7-full',
                    'red-vector-proposals-v8-sample','red-vector-proposals-v8-full']:
  profile,config,version,_=_PROFILES[profile_id]
  lease={'objectId':'OBJ-CROP-V8','inputManifestHash':'a'*64,
   'release':{'lifecycle':'DRAFT','providerSlot':{'stageJobType':'ENTITY_EXTRACTION',
    'providerKind':'ENTITY_EXTRACTION_MODEL','status':'CONFIGURED','profileId':profile_id,
    'adapterVersion':version,'configHash':config}},
   'inputs':{'sourceFiles':[{'sourceFileId':'FIL-CROP','sha256':digest,'byteSize':path.stat().st_size,
    'mediaType':'application/pdf','downloadPath':'/api/internal/v1/jobs/test/inputs/FIL-CROP'}]}}
  with patch('inspector_worker.visual_proposal_adapter._download_source',side_effect=download), \
       patch('inspector_worker.visual_vlm._post_vlm',return_value=('ABSTAIN','d'*64)), \
       patch.dict(os.environ,{'VISUAL_VLM_BASE_URL':'http://visual-vlm:8080/v1','INSPECTOR_VISUAL_CACHE_ROOT':''}):
   result=VisualProposalAdapter().execute(lease,{})
  out.append({'result':result,'source':{'apiId':'FIL-CROP','sha256':digest,'pageCount':1}})
 print(json.dumps(out,ensure_ascii=False))
`;
