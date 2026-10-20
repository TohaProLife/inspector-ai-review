"""Original-backed isolated v3 cache contract. No legacy cache reuse."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from inspector_worker.durable_text_v3_cache import cached_durable_text_layer_v3
from inspector_worker.document_text_v3 import get_document_text_v3_extractor_profile
ROOT=Path(__file__).resolve().parents[3]
MANUAL=json.loads((ROOT/'fixtures/document-text-v3-figures-v1/qa-core-manual-goldens.json').read_text())['cases'][0]
def canonical(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def setup(root):
 artifact=copy.deepcopy(MANUAL['artifact']);artifact['extractorProfile']=get_document_text_v3_extractor_profile(traversal_policy_version='pdfminer-analyzed-figures-whole-lines-v1')
 artifact['extractorProfileHash']=hashlib.sha256(canonical({'hashDomain':'document-text-extractor-profile-v1','profile':artifact['extractorProfile']})).hexdigest()
 return artifact,{'cache_root':root/'cache','source_path':ROOT/MANUAL['originalPath'],'source_file_id':artifact['sourceFileId'],'source_sha256':artifact['inputSha256'],'extractor_profile':artifact['extractorProfile'],'extractor_profile_hash':artifact['extractorProfileHash']}
class DurableTextV3CacheTests(unittest.TestCase):
 def test_full_original_hit_miss_detached_and_child_namespace(self):
  with tempfile.TemporaryDirectory() as d:
   a,args=setup(Path(d));calls=[]
   def extract():calls.append(1);return copy.deepcopy(a)
   first,s1=cached_durable_text_layer_v3(**args,extract=extract);first['pages'][0]['locatedLines'][0]['rawText']='tampered return'
   second,s2=cached_durable_text_layer_v3(**args,extract=extract)
   self.assertEqual((s1,s2,len(calls)),('MISS_WRITTEN','HIT',1));self.assertEqual(second,a)
   entries=list(args['cache_root'].rglob('*.json'));self.assertEqual(len(entries),1)
   self.assertEqual(entries[0].relative_to(args['cache_root']).parts[0],'durable-text-layer-v3-cache-v1')
 def test_original_sha_checked_before_hit(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);a,args=setup(root);source=root/'source.pdf';source.write_bytes(args['source_path'].read_bytes());args['source_path']=source;calls=[]
   def extract():calls.append(1);return copy.deepcopy(a)
   cached_durable_text_layer_v3(**args,extract=extract);source.write_bytes(b'changed immutable original')
   with self.assertRaises(ValueError):cached_durable_text_layer_v3(**args,extract=extract)
   self.assertEqual(len(calls),1)
 def test_cache_corrupt_duplicate_float_and_oversize_never_recompute(self):
  for mutation in ('content','duplicate','float','oversize'):
   with self.subTest(mutation=mutation),tempfile.TemporaryDirectory() as d:
    a,args=setup(Path(d));cached_durable_text_layer_v3(**args,extract=lambda:copy.deepcopy(a));entry=next(args['cache_root'].rglob('*.json'));payload=json.loads(entry.read_text())
    if mutation=='content':payload['artifact']['pages'][0]['locatedLines'][0]['rawText']='FORGED';data=canonical(payload)
    elif mutation=='duplicate':data=b'{"schemaVersion":"wrong",'+entry.read_bytes()[1:]
    elif mutation=='float':payload['artifact']['pages'][0]['widthMilliPoints']=200000.5;data=canonical(payload)
    else:data=b' '*8000001
    entry.write_bytes(data);calls=[]
    with self.assertRaises(ValueError):cached_durable_text_layer_v3(**args,extract=lambda:calls.append(1))
    self.assertEqual(calls,[])
 def test_foreign_source_or_profile_never_published_and_identity_isolated(self):
  for field in ('sourceFileId','inputSha256','extractorProfileHash'):
   with self.subTest(field=field),tempfile.TemporaryDirectory() as d:
    a,args=setup(Path(d));bad=copy.deepcopy(a);bad[field]='foreign' if field=='sourceFileId' else '0'*64
    with self.assertRaises(ValueError):cached_durable_text_layer_v3(**args,extract=lambda:bad)
    self.assertEqual(list(args['cache_root'].rglob('*.json')),[])
  with tempfile.TemporaryDirectory() as d:
   a,args=setup(Path(d));cached_durable_text_layer_v3(**args,extract=lambda:copy.deepcopy(a));other=copy.deepcopy(a);other['sourceFileId']='OTHER-SOURCE';args['source_file_id']=other['sourceFileId']
   value,status=cached_durable_text_layer_v3(**args,extract=lambda:other)
   self.assertEqual((status,value),('MISS_WRITTEN',other));self.assertEqual(len(list(args['cache_root'].rglob('*.json'))),2)
 def test_symlink_entry_and_namespace_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);a,args=setup(root);cached_durable_text_layer_v3(**args,extract=lambda:copy.deepcopy(a));entry=next(args['cache_root'].rglob('*.json'));outside=root/'outside.json';outside.write_bytes(entry.read_bytes());entry.unlink();entry.symlink_to(outside);calls=[]
   with self.assertRaises((ValueError,OSError)):cached_durable_text_layer_v3(**args,extract=lambda:calls.append(1))
   self.assertEqual(calls,[]);self.assertTrue(outside.exists())
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);a,args=setup(root);args['cache_root'].mkdir();outside=root/'external';outside.mkdir();(args['cache_root']/'durable-text-layer-v3-cache-v1').symlink_to(outside,target_is_directory=True)
   with self.assertRaises((ValueError,OSError)):cached_durable_text_layer_v3(**args,extract=lambda:copy.deepcopy(a))
   self.assertEqual(list(outside.iterdir()),[])
