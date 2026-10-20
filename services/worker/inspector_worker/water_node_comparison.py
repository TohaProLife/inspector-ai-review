"""Pure consistency check of supplied reviewed cold-water inlet-node inventories.

This boundary authenticates no DB review, actor, object membership or original PDF.
Every retained original and claim is verified before selecting the requested scope;
CURRENT/APPROVED and human completeness remain supplied, explicit review assertions.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import re
from typing import Any
from .table_row_binding import _portable_error, _key, _text
from .source_declarations import _valid_artifact, canonical_source_declaration_json
from .water_node_source import (
    reconstruct_zu129_water_node_source, water_node_inventory_content_hash,
    EXTRACTOR_VERSION, POLICY_VERSION,
)

_SCHEMA = 'matrix-zu129-water-node-comparison-v1'
_INPUT = 'matrix-zu129-water-node-input-v1'
_REVIEW_SCHEMA = 'matrix-zu129-water-node-review-v1'
_ROLE = 'COMMON_BUILDING_COLD_WATER_INLET_NODE_COMPONENTS'
_SAFE = 2**53 - 1
_SHA = re.compile(r'[a-f0-9]{64}\Z')
_PAGE = re.compile(r'[1-9][0-9]{0,15}\Z')
_TOKEN = re.compile(r'[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79}\Z')
_STAGES = {'PD','RD','ID','UNRESOLVED'}
_SECTIONS = {'PZ','SPZU','AR','KR','IOS1','IOS2','IOS3','IOS4','IOS5','POS','POD','OOS','PPM','ODI','ZU','SM','EOM','GP','GSV','KJ','KM','NVK','OV','PP','PPR','SS','VK'}
_IDENTITY = {'entityKey','buildingKey','nodeKey','service','accountingScope','componentRole'}
_FIXED = {'service':'COLD_WATER','accountingScope':'COMMON_BUILDING_INLET','componentRole':_ROLE}
_FRAGMENT = {'pageNumber','blockIndex','lineIndex','rawText','bboxMilliPoints'}
_SELECTION = {'pageNumber','regionBoxMilliPoints','headerFragments','scopeFragments','endFragments'}
_TARGET = {'checkId','inputManifestHash','textStageContentHash','textArtifactHash','inventoryContentHash'}
_REQUEST_CLAIM = {'target','selection','identity','nodeMapping','assertion','reference'}
_DECISION_CLAIM = _REQUEST_CLAIM | {'inventorySnapshot'}
_SNAPSHOT = {'schemaVersion','extractorVersion','policyVersion','sourceFileId','sourceSha256','textArtifactHash','stage','pageNumber','widthMilliPoints','heightMilliPoints','regionBoxMilliPoints','headerFragments','scopeFragments','endFragments','buildingToken','nodeToken','service','accountingScope','featureRows'}
_REVIEW = {'decisionId','contentHash','objectId','sourceFileId','sourceSha256','actorId','revisionStatus','approvalStatus','sectionCode','linkGroupId','pageStages','waterNodeScope'}
_ORIGIN = {'checkId','objectId','sourceFileId','sourceSha256','inputManifestHash','textStageContentHash','textArtifactHash','textArtifact'}
_FEATURES = {'WATER_METER','STRAINER','SHUTOFF_VALVE'}


def _exact(v: Any, keys: set[str]) -> bool:
    return type(v) is dict and set(v) == keys


def _enum(v: Any, values: set[str]) -> bool:
    return type(v) is str and v in values


def _sha(v: Any) -> bool:
    return type(v) is str and _SHA.fullmatch(v) is not None


def _int(v: Any, minimum: int=0) -> bool:
    return type(v) is int and minimum <= v <= _SAFE


def _k(v: Any, maximum: int=200) -> bool:
    return _key(v) and len(v) <= maximum


def _box(v: Any, width: int=_SAFE, height: int=_SAFE) -> bool:
    return type(v) is list and len(v)==4 and all(_int(n) for n in v) and v[0]<v[2]<=width and v[1]<v[3]<=height


def _identity(v: Any) -> bool:
    return (_exact(v,_IDENTITY) and all(v[k]==expected for k,expected in _FIXED.items())
            and all(_k(v[k]) for k in ('entityKey','buildingKey','nodeKey')))


def _fragment(v: Any, width: int=_SAFE, height: int=_SAFE, page: int|None=None) -> bool:
    return (_exact(v,_FRAGMENT) and _int(v['pageNumber'],1) and (page is None or v['pageNumber']==page)
            and _int(v['blockIndex']) and _int(v['lineIndex']) and _text(v['rawText'],line=True)
            and 0<len(v['rawText'])<=8192 and bool(v['rawText'].strip()) and _box(v['bboxMilliPoints'],width,height))


def _fragments(v: Any, count: int, width: int=_SAFE, height: int=_SAFE, page: int|None=None) -> bool:
    return type(v) is list and len(v)==count and all(_fragment(f,width,height,page) for f in v)


def _selection(v: Any) -> bool:
    return (_exact(v,_SELECTION) and _int(v['pageNumber'],1) and _box(v['regionBoxMilliPoints'])
            and all(_fragments(v[k],n) for k,n in (('headerFragments',1),('scopeFragments',4),('endFragments',1))))


def _snapshot(v: Any) -> bool:
    if (not _exact(v,_SNAPSHOT) or v['schemaVersion']!=EXTRACTOR_VERSION or v['extractorVersion']!=EXTRACTOR_VERSION
            or v['policyVersion']!=POLICY_VERSION or not _k(v['sourceFileId']) or not _sha(v['sourceSha256'])
            or not _sha(v['textArtifactHash']) or not _enum(v['stage'],{'PD','RD'}) or not _int(v['pageNumber'],1)
            or not _int(v['widthMilliPoints'],1) or not _int(v['heightMilliPoints'],1)
            or any(type(v[k]) is not str or not _TOKEN.fullmatch(v[k]) for k in ('buildingToken','nodeToken'))
            or v['service']!='COLD_WATER' or v['accountingScope']!='COMMON_BUILDING_INLET'):
        return False
    w,h,p=v['widthMilliPoints'],v['heightMilliPoints'],v['pageNumber']
    return (_box(v['regionBoxMilliPoints'],w,h)
            and all(_fragments(v[k],n,w,h,p) for k,n in (('headerFragments',1),('scopeFragments',4),('endFragments',1)))
            and type(v['featureRows']) is list and 1<=len(v['featureRows'])<=3
            and all(_exact(row,{'featureKey','fragments'}) and _enum(row['featureKey'],_FEATURES)
                    and _fragments(row['fragments'],1,w,h,p) for row in v['featureRows']))


def _target(v: Any) -> bool:
    return _exact(v,_TARGET) and _k(v['checkId'],120) and all(_sha(v[k]) for k in _TARGET-{'checkId'})


def _claim(v: Any, decision: bool) -> bool:
    return (_exact(v,_DECISION_CLAIM if decision else _REQUEST_CLAIM) and _target(v['target'])
            and _selection(v['selection']) and _identity(v['identity'])
            and _exact(v['nodeMapping'],{'kind','sourceBuildingToken','sourceNodeToken','assertion'})
            and v['nodeMapping']['kind']=='HUMAN_REVIEWED_COLD_WATER_INLET_NODE_MAPPING'
            and all(_k(v['nodeMapping'][k]) for k in ('sourceBuildingToken','sourceNodeToken'))
            and _enum(v['nodeMapping']['assertion'],{'UNKNOWN','HUMAN_ASSERTED_SAME_COLD_WATER_INLET_NODE'})
            and _enum(v['assertion'],{'UNKNOWN','HUMAN_ASSERTED_COMPLETE'}) and _text(v['reference'],line=True)
            and 8<=len(v['reference'])<=1000 and v['reference'].strip()==v['reference']
            and (not decision or _snapshot(v['inventorySnapshot'])))


def _scope(v: Any, decision: bool) -> bool:
    return (_exact(v,{'schemaVersion','claims'}) and v['schemaVersion']==_REVIEW_SCHEMA
            and type(v['claims']) is list and len(v['claims'])<=16 and all(_claim(c,decision) for c in v['claims']))


def _stages(v: Any) -> bool:
    return type(v) is dict and all(_PAGE.fullmatch(k) and int(k)<=_SAFE and _enum(s,_STAGES) for k,s in v.items())


def _review(v: Any) -> bool:
    return (_exact(v,_REVIEW) and all(_k(v[k]) for k in ('decisionId','objectId','sourceFileId','actorId'))
            and _sha(v['contentHash']) and _sha(v['sourceSha256'])
            and _enum(v['revisionStatus'],{'CURRENT','SUPERSEDED','UNKNOWN'})
            and _enum(v['approvalStatus'],{'APPROVED','UNAPPROVED','UNKNOWN'})
            and (v['sectionCode'] is None or _enum(v['sectionCode'],_SECTIONS))
            and (v['linkGroupId'] is None or _k(v['linkGroupId'],120)) and _stages(v['pageStages'])
            and (v['waterNodeScope'] is None or _scope(v['waterNodeScope'],True)))


def _source(v: Any) -> bool:
    if (not _exact(v,{'sourceFileId','sourceSha256','stages','reviewSnapshot','review'}) or not _k(v['sourceFileId'])
            or not _sha(v['sourceSha256']) or type(v['stages']) is not list or len(v['stages'])>4
            or not all(_enum(s,_STAGES) for s in v['stages']) or len(set(v['stages']))!=len(v['stages'])):
        return False
    if v['review'] is None:
        return v['reviewSnapshot'] is None
    return (_exact(v['reviewSnapshot'],{'decisionId','contentHash'}) and _k(v['reviewSnapshot']['decisionId'])
            and _sha(v['reviewSnapshot']['contentHash']) and _review(v['review']))


def _origin(v: Any) -> bool:
    return (_exact(v,_ORIGIN) and _k(v['checkId'],120) and _k(v['objectId']) and _k(v['sourceFileId'])
            and all(_sha(v[k]) for k in ('sourceSha256','inputManifestHash','textStageContentHash','textArtifactHash'))
            and type(v['textArtifact']) is dict)


def _claims(source: dict[str,Any]) -> list[dict[str,Any]]:
    r=source['review']
    return [] if r is None or r['waterNodeScope'] is None else r['waterNodeScope']['claims']


def _caps(v: Any) -> bool:
    if type(v) is not dict:
        return False
    if type(v.get('sources')) is list and len(v['sources'])>64:
        return True
    if type(v.get('origins')) is list and len(v['origins'])>128:
        return True
    total=0
    for source in v.get('sources',[]) if type(v.get('sources')) is list else []:
        if type(source) is not dict or type(source.get('review')) is not dict:
            continue
        scope=source['review'].get('waterNodeScope')
        if type(scope) is dict and type(scope.get('claims')) is list:
            count=len(scope['claims']);total+=count
            if count>16 or total>128:
                return True
    return False


def validate_water_node_scope_request(value: Any) -> dict[str,Any]|None:
    """Validate and detach a client scope; no server snapshot or authority accepted."""
    if _portable_error(value) or not _scope(value,False):
        return None
    hashes=[c['target']['inventoryContentHash'] for c in value['claims']]
    return deepcopy(value) if len(hashes)==len(set(hashes)) else None


def project_water_node_scope_decision(value: Any) -> dict[str,Any]|None:
    """Detach a server decision into request fields, checking internal consistency.

    Internal hash consistency is not original-text reconstruction or DB authority.
    """
    if _portable_error(value) or not _scope(value,True):
        return None
    hashes=[c['target']['inventoryContentHash'] for c in value['claims']]
    if len(hashes)!=len(set(hashes)):
        return None
    source=None
    for c in value['claims']:
        snap=c['inventorySnapshot'];target=c['target'];current=(snap['sourceFileId'],snap['sourceSha256'])
        if source is not None and current!=source:
            return None
        source=current
        if (target['textArtifactHash']!=snap['textArtifactHash'] or water_node_inventory_content_hash(snap)!=target['inventoryContentHash']
                or c['selection']!={key:snap[key] for key in _SELECTION}):
            return None
    return {'schemaVersion':_REVIEW_SCHEMA,'claims':[{key:deepcopy(c[key]) for key in _REQUEST_CLAIM} for c in value['claims']]}


def _abstain(reason: str) -> dict[str,Any]:
    return {'schemaVersion':_SCHEMA,'status':'ABSTAIN','reasonCode':reason,'calibratedProbability':None}


def _text_hash(artifact: dict[str,Any]) -> str:
    return hashlib.sha256(canonical_source_declaration_json({'hashDomain':'matrix-source-declaration-text-artifact-v1','textArtifact':artifact}).encode('utf-8')).hexdigest()


def compare_zu129_water_node_inventories(value: Any) -> dict[str,Any]:
    """Compare only after global original/claim integrity, without database trust."""
    error=_portable_error(value)
    if error:
        return _abstain('INPUT_LIMIT' if error=='LIMIT' else 'INVALID_INPUT')
    if _caps(value):
        return _abstain('INPUT_LIMIT')
    if (not _exact(value,{'schemaVersion','objectId','inputManifestHash','identity','sources','origins'})
            or value['schemaVersion']!=_INPUT or not _k(value['objectId']) or not _sha(value['inputManifestHash'])
            or not _identity(value['identity']) or type(value['sources']) is not list or not all(_source(s) for s in value['sources'])
            or type(value['origins']) is not list or not all(_origin(o) for o in value['origins'])):
        return _abstain('INVALID_INPUT')
    sources={};origins={}
    # Association checks precede any original parsing or requested-identity choice.
    for s in value['sources']:
        sid=s['sourceFileId']
        if sid in sources:
            return _abstain('SOURCE_PROVENANCE_UNVERIFIED')
        sources[sid]=s;r=s['review'];rs=s['reviewSnapshot']
        if r is not None and (r['decisionId']!=rs['decisionId'] or r['contentHash']!=rs['contentHash']
                or r['objectId']!=value['objectId'] or r['sourceFileId']!=sid or r['sourceSha256']!=s['sourceSha256']):
            return _abstain('SOURCE_PROVENANCE_UNVERIFIED')
    for o in value['origins']:
        key=(o['sourceFileId'],o['checkId']);source=sources.get(o['sourceFileId'])
        if key in origins or source is None or o['objectId']!=value['objectId'] or o['sourceSha256']!=source['sourceSha256']:
            return _abstain('SOURCE_PROVENANCE_UNVERIFIED')
        origins[key]=o
    entries=[]
    for s in value['sources']:
        for c in _claims(s):
            t=c['target'];o=origins.get((s['sourceFileId'],t['checkId']));snap=c['inventorySnapshot']
            if (o is None or any(t[k]!=o[k] for k in ('inputManifestHash','textStageContentHash','textArtifactHash'))
                    or snap['sourceFileId']!=s['sourceFileId'] or snap['sourceSha256']!=s['sourceSha256']):
                return _abstain('SOURCE_PROVENANCE_UNVERIFIED')
            entries.append((s,c,o))
    # All supplied origins, including unselected and unclaimed originals.
    for o in value['origins']:
        artifact=o['textArtifact']
        if (not _valid_artifact(artifact) or artifact['pageCount']>512 or artifact['sourceFileId']!=o['sourceFileId']
                or artifact['inputSha256']!=o['sourceSha256'] or _text_hash(artifact)!=o['textArtifactHash']):
            return _abstain('SOURCE_PROVENANCE_UNVERIFIED')
    # Stage is a global pass before any reconstruction, review or identity gate.
    for s,c,o in entries:
        if (len(s['stages'])!=1 or s['stages'][0] not in ('PD','RD')
                or any(code!=s['stages'][0] for code in s['review']['pageStages'].values())):
            return _abstain('SOURCE_STAGE_UNVERIFIED')
    verified=[]
    for s,c,o in entries:
        built=reconstruct_zu129_water_node_source({'sourceFileId':s['sourceFileId'],'sourceSha256':s['sourceSha256'],
            'stage':s['stages'][0],'pageStages':s['review']['pageStages'],'textArtifact':o['textArtifact'],'selection':c['selection']})
        if (built['status']!='RECONSTRUCTED' or built['inventory']!=c['inventorySnapshot']
                or water_node_inventory_content_hash(built['inventory'])!=c['target']['inventoryContentHash']):
            return _abstain('INVENTORY_RECONSTRUCTION_UNVERIFIED')
        verified.append((s,c,built['inventory']))
    wanted=value['identity']
    selected=[entry for entry in verified if entry[1]['identity']['entityKey']==wanted['entityKey']
              or all(entry[1]['identity'][key]==wanted[key] for key in ('buildingKey','nodeKey'))]
    if any(c['identity']!=wanted for s,c,i in selected):
        return _abstain('NODE_IDENTITY_CONFLICT')
    pd=[e for e in selected if e[0]['stages'][0]=='PD'];rd=[e for e in selected if e[0]['stages'][0]=='RD']
    for group in (pd,rd):
        hashes=[c['target']['inventoryContentHash'] for s,c,i in group]
        if len(hashes)!=len(set(hashes)):
            return _abstain('INVALID_INPUT')
    if len(pd)>1 or len(rd)>1:
        return _abstain('AMBIGUOUS_INVENTORY_SCOPE')
    if len(pd)!=1 or len(rd)!=1 or pd[0][0]['sourceFileId']==rd[0][0]['sourceFileId']:
        return _abstain('MATCHED_INVENTORY_PAIR_UNVERIFIED')
    pair=(pd[0],rd[0])
    if any(s['review']['revisionStatus']!='CURRENT' or s['review']['approvalStatus']!='APPROVED' for s,c,i in pair):
        return _abstain('SOURCE_REVIEW_UNVERIFIED')
    if pair[0][0]['review']['sectionCode']!='ZU' or pair[1][0]['review']['sectionCode']!='IOS2':
        return _abstain('SOURCE_SECTION_UNVERIFIED')
    links=[s['review']['linkGroupId'] for s,c,i in pair]
    if links[0] is None or links[1]!=links[0]:
        return _abstain('LINK_SCOPE_UNVERIFIED')
    for s,c,inv in pair:
        mapping=c['nodeMapping']
        if (mapping['assertion']!='HUMAN_ASSERTED_SAME_COLD_WATER_INLET_NODE'
                or mapping['sourceBuildingToken']!=inv['buildingToken'] or mapping['sourceNodeToken']!=inv['nodeToken']):
            return _abstain('NODE_MAPPING_UNVERIFIED')
    if any(c['assertion']!='HUMAN_ASSERTED_COMPLETE' for s,c,i in pair):
        return _abstain('HUMAN_COMPLETENESS_UNVERIFIED')
    if any(not i['featureRows'] for s,c,i in pair):
        return _abstain('NONEMPTY_CLOSED_REGION_UNVERIFIED')
    expected={r['featureKey'] for r in pair[0][2]['featureRows']};actual={r['featureKey'] for r in pair[1][2]['featureRows']}
    if 'WATER_METER' not in expected:
        return _abstain('PD_REQUIREMENT_UNVERIFIED')
    if 'WATER_METER' in actual or not actual.intersection({'STRAINER','SHUTOFF_VALVE'}):
        return _abstain('NEGATIVE_SCOPE_UNVERIFIED')
    def reference(entry):
        s,c,i=entry;r=s['review']
        return {'sourceFileId':s['sourceFileId'],'sourceSha256':s['sourceSha256'],'reviewDecisionId':r['decisionId'],
                'reviewContentHash':r['contentHash'],'inventoryContentHash':c['target']['inventoryContentHash']}
    return {'schemaVersion':_SCHEMA,'status':'CANDIDATE','ruleId':'matrix-zu-129-declared_cold_water_inlet_meter_omission',
            'ruleVersion':'1','parameterCode':'ZU-129','reasonCode':'WATER_METER_NOT_LISTED_IN_REVIEWED_RD_NODE_COMPONENTS',
            'calibratedProbability':None,'comparisonScope':'REVIEWED_NAMED_COMMON_BUILDING_COLD_WATER_INLET_NODE_COMPONENTS_ONLY',
            'identity':deepcopy(wanted),'expected':reference(pair[0]),'actual':reference(pair[1]),'missingFeatureKeys':['WATER_METER']}
