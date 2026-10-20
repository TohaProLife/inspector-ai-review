"""Independent staged ODI120 comparator for reviewed declared room inventories.

Supplied metadata is a protected-loader projection, not proof of DB authority.
No call/AR semantic comparator imports. Physical absence is never inferred.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib,json,re
from typing import Any
from inspector_worker.table_row_binding import _portable_error,_key,_text
from inspector_worker.rail_inventory_source import reconstruct_odi120_rail_inventory_source

SCHEMA='matrix-odi120-rail-inventory-comparison-v1'
INPUT_SCHEMA='matrix-odi120-rail-inventory-input-v1'
SOURCE_SCHEMA='matrix-odi120-rail-inventory-source-v1'
POLICY='matrix-odi120-rail-inventory-literals-v1'
REVIEW_SCHEMA='matrix-odi120-rail-inventory-review-v1'
ROLE='ACCESSIBLE_SANITARY_ROOM_RAIL_INVENTORY'
_SAFE=2**53-1
_SHA=re.compile(r'[a-f0-9]{64}\Z',re.ASCII)
_PAGE=re.compile(r'[1-9][0-9]{0,15}\Z',re.ASCII)
_STAGES={'PD','RD','ID','UNRESOLVED'}
_SECTIONS={'PZ','SPZU','AR','KR','IOS1','IOS2','IOS3','IOS4','IOS5','POS','POD','OOS','PPM','ODI','ZU','SM','EOM','GP','GSV','KJ','KM','NVK','OV','PP','PPR','SS','VK'}
_FEATURES={'WC_FIXED_RAIL','WC_FOLDING_RAIL','BASIN_RAIL'}
_IDENTITY={'entityKey','buildingKey','floorKey','roomKey','componentRole'}
_FRAGMENT={'pageNumber','blockIndex','lineIndex','rawText','bboxMilliPoints'}
_SELECTION={'pageNumber','regionBoxMilliPoints','headerFragments','scopeFragments','endFragments'}
_TARGET={'checkId','inputManifestHash','textStageContentHash','textArtifactHash','inventoryContentHash'}
_SNAPSHOT={'schemaVersion','extractorVersion','policyVersion','sourceFileId','sourceSha256','textArtifactHash','stage','pageNumber','widthMilliPoints','heightMilliPoints','regionBoxMilliPoints','headerFragments','scopeFragments','endFragments','roomToken','featureRows'}
_REVIEW={'decisionId','contentHash','objectId','sourceFileId','sourceSha256','actorId','revisionStatus','approvalStatus','sectionCode','linkGroupId','pageStages','railInventoryScope'}
_CLAIM={'target','selection','identity','roomMapping','assertion','reference','inventorySnapshot'}
_ORIGIN={'checkId','objectId','sourceFileId','sourceSha256','inputManifestHash','textStageContentHash','textArtifactHash','textArtifact'}


def _a(reason: str) -> dict[str,Any]:
    return {'schemaVersion':SCHEMA,'status':'ABSTAIN','reasonCode':reason,'calibratedProbability':None}


def _exact(v: Any, keys: set[str]) -> bool:return type(v) is dict and set(v)==keys

def _enum(v: Any, values: set[str]) -> bool:return type(v) is str and v in values

def _sha(v: Any) -> bool:return type(v) is str and _SHA.fullmatch(v) is not None

def _int(v: Any, minimum: int=0) -> bool:return type(v) is int and minimum<=v<=_SAFE

def _k(v: Any, maximum: int=200) -> bool:return _key(v) and len(v)<=maximum

def _box(v: Any, width: int=_SAFE, height: int=_SAFE) -> bool:
    return type(v) is list and len(v)==4 and all(_int(n)for n in v) and v[0]<v[2]<=width and v[1]<v[3]<=height

def _identity(v: Any) -> bool:
    return _exact(v,_IDENTITY) and v['componentRole']==ROLE and all(_k(v[k])for k in _IDENTITY-{'componentRole'})

def _fragment(v: Any, width: int=_SAFE, height: int=_SAFE, page: int|None=None) -> bool:
    return (_exact(v,_FRAGMENT) and _int(v['pageNumber'],1) and (page is None or v['pageNumber']==page)
            and _int(v['blockIndex']) and _int(v['lineIndex']) and _text(v['rawText'],line=True)
            and 0<len(v['rawText'])<=8192 and bool(v['rawText'].strip()) and _box(v['bboxMilliPoints'],width,height))

def _anchor(v: Any,width: int=_SAFE,height: int=_SAFE,page: int|None=None) -> bool:
    return type(v) is list and len(v)==1 and _fragment(v[0],width,height,page)

def _selection(v: Any) -> bool:
    return (_exact(v,_SELECTION) and _int(v['pageNumber'],1) and _box(v['regionBoxMilliPoints'])
            and all(_anchor(v[k])for k in ('headerFragments','scopeFragments','endFragments')))

def _snapshot(v: Any) -> bool:
    if (not _exact(v,_SNAPSHOT) or v['schemaVersion']!=SOURCE_SCHEMA or v['extractorVersion']!=SOURCE_SCHEMA
            or v['policyVersion']!=POLICY or not _k(v['sourceFileId']) or not _sha(v['sourceSha256'])
            or not _sha(v['textArtifactHash']) or not _enum(v['stage'],{'PD','RD'}) or not _int(v['pageNumber'],1)
            or not _int(v['widthMilliPoints'],1) or not _int(v['heightMilliPoints'],1) or not _k(v['roomToken'])):
        return False
    w,h,p=v['widthMilliPoints'],v['heightMilliPoints'],v['pageNumber']
    if (not _box(v['regionBoxMilliPoints'],w,h) or not all(_anchor(v[k],w,h,p)for k in ('headerFragments','scopeFragments','endFragments'))
            or type(v['featureRows']) is not list or not 1<=len(v['featureRows'])<=3):return False
    for row in v['featureRows']:
        if (not _exact(row,{'featureKey','fragments'}) or not _enum(row['featureKey'],_FEATURES)
                or type(row['fragments']) is not list or not 1<=len(row['fragments'])<=3
                or not all(_fragment(f,w,h,p)for f in row['fragments'])):return False
    return True

def _stages(v: Any) -> bool:
    return type(v) is dict and all(_PAGE.fullmatch(k) and int(k)<=_SAFE and _enum(s,_STAGES)for k,s in v.items())

def _target(v: Any) -> bool:
    return _exact(v,_TARGET) and _k(v['checkId'],120) and all(_sha(v[k])for k in _TARGET-{'checkId'})

def _claim(v: Any) -> bool:
    return (_exact(v,_CLAIM) and _target(v['target']) and _selection(v['selection']) and _identity(v['identity'])
            and _exact(v['roomMapping'],{'kind','sourceRoomToken','assertion'})
            and v['roomMapping']['kind']=='HUMAN_REVIEWED_ACCESSIBLE_ROOM_MAPPING'
            and _k(v['roomMapping']['sourceRoomToken'])
            and _enum(v['roomMapping']['assertion'],{'UNKNOWN','HUMAN_ASSERTED_SAME_ACCESSIBLE_ROOM'})
            and _enum(v['assertion'],{'UNKNOWN','HUMAN_ASSERTED_COMPLETE'})
            and _text(v['reference'],line=True) and 8<=len(v['reference'])<=1000
            and v['reference'].strip()==v['reference'] and _snapshot(v['inventorySnapshot']))

def _review(v: Any) -> bool:
    if (not _exact(v,_REVIEW) or not all(_k(v[k])for k in ('decisionId','objectId','sourceFileId','actorId'))
            or not _sha(v['contentHash']) or not _sha(v['sourceSha256'])
            or not _enum(v['revisionStatus'],{'CURRENT','SUPERSEDED','UNKNOWN'})
            or not _enum(v['approvalStatus'],{'APPROVED','UNAPPROVED','UNKNOWN'})
            or not (v['sectionCode'] is None or _enum(v['sectionCode'],_SECTIONS))
            or not (v['linkGroupId'] is None or _k(v['linkGroupId'],120)) or not _stages(v['pageStages'])):return False
    s=v['railInventoryScope']
    return s is None or (_exact(s,{'schemaVersion','claims'}) and s['schemaVersion']==REVIEW_SCHEMA and type(s['claims']) is list and all(_claim(c)for c in s['claims']))

def _source(v: Any) -> bool:
    if (not _exact(v,{'sourceFileId','sourceSha256','stages','reviewSnapshot','review'}) or not _k(v['sourceFileId'])
            or not _sha(v['sourceSha256']) or type(v['stages']) is not list
            or not all(_enum(s,_STAGES)for s in v['stages']) or len(set(v['stages']))!=len(v['stages'])):return False
    if v['review'] is None:return v['reviewSnapshot'] is None
    r=v['reviewSnapshot']
    return _exact(r,{'decisionId','contentHash'}) and _k(r['decisionId']) and _sha(r['contentHash']) and _review(v['review'])

def _origin(v: Any) -> bool:
    return (_exact(v,_ORIGIN) and _k(v['checkId'],120) and all(_k(v[k])for k in ('objectId','sourceFileId'))
            and all(_sha(v[k])for k in ('sourceSha256','inputManifestHash','textStageContentHash','textArtifactHash'))
            and type(v['textArtifact']) is dict)

def _caps(v: Any) -> bool:
    if type(v) is not dict:return False
    if type(v.get('sources')) is list and len(v['sources'])>64:return True
    if type(v.get('origins')) is list and len(v['origins'])>128:return True
    total=0
    for s in v.get('sources',[])if type(v.get('sources')) is list else []:
        if type(s) is not dict or type(s.get('review')) is not dict:continue
        scope=s['review'].get('railInventoryScope')
        if type(scope) is dict and type(scope.get('claims')) is list:
            count=len(scope['claims']);total+=count
            if count>16 or total>128:return True
    return False

def _hash(v: Any) -> str:
    return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf-8')).hexdigest()

def _claims(source: dict[str,Any]) -> list[dict[str,Any]]:
    review=source['review']
    return [] if review is None or review['railInventoryScope'] is None else review['railInventoryScope']['claims']

def _samephysical(a: dict[str,Any],b: dict[str,Any]) -> bool:
    return all(a[k]==b[k]for k in ('buildingKey','floorKey','roomKey'))

def compare_odi120_rail_inventories(input: Any) -> dict[str,Any]:
    error=_portable_error(input)
    if error:return _a('INPUT_LIMIT' if error=='LIMIT' else 'INVALID_INPUT')
    if _caps(input):return _a('INPUT_LIMIT')
    if (not _exact(input,{'schemaVersion','objectId','inputManifestHash','identity','sources','origins'})
            or input['schemaVersion']!=INPUT_SCHEMA or not _k(input['objectId']) or not _sha(input['inputManifestHash'])
            or not _identity(input['identity']) or type(input['sources']) is not list or not all(_source(s)for s in input['sources'])
            or type(input['origins']) is not list or not all(_origin(o)for o in input['origins'])):return _a('INVALID_INPUT')
    sources=input['sources'];origins=input['origins'];by_source={};by_origin={}
    for s in sources:
        if s['sourceFileId'] in by_source:return _a('SOURCE_PROVENANCE_UNVERIFIED')
        by_source[s['sourceFileId']]=s
        r=s['review'];snap=s['reviewSnapshot']
        if r is not None and (r['objectId']!=input['objectId'] or r['sourceFileId']!=s['sourceFileId']
                or r['sourceSha256']!=s['sourceSha256'] or snap['decisionId']!=r['decisionId']
                or snap['contentHash']!=r['contentHash']):return _a('SOURCE_PROVENANCE_UNVERIFIED')
        for c in _claims(s):
            if c['inventorySnapshot']['sourceFileId']!=s['sourceFileId'] or c['inventorySnapshot']['sourceSha256']!=s['sourceSha256']:
                return _a('SOURCE_PROVENANCE_UNVERIFIED')
    for o in origins:
        key=(o['sourceFileId'],o['checkId']);s=by_source.get(o['sourceFileId'])
        if key in by_origin or s is None or o['objectId']!=input['objectId'] or o['sourceSha256']!=s['sourceSha256']:
            return _a('SOURCE_PROVENANCE_UNVERIFIED')
        by_origin[key]=o
    for s in sources:
        for c in _claims(s):
            t=c['target'];o=by_origin.get((s['sourceFileId'],t['checkId']))
            if o is None or any(o[k]!=t[k]for k in ('inputManifestHash','textStageContentHash','textArtifactHash')):
                return _a('SOURCE_PROVENANCE_UNVERIFIED')
    wanted=input['identity'];collected=[]
    for s in sources:
        for c in _claims(s):
            i=c['identity']
            if i['entityKey']==wanted['entityKey'] or _samephysical(i,wanted):
                if i!=wanted:return _a('ROOM_IDENTITY_CONFLICT')
                collected.append((s,c))
    groups={'PD':[],'RD':[]}
    for s,c in collected:
        if len(s['stages'])!=1 or s['stages'][0] not in groups:return _a('SOURCE_STAGE_UNVERIFIED')
        stage=s['stages'][0]
        if any(v!=stage for v in s['review']['pageStages'].values()):return _a('SOURCE_STAGE_UNVERIFIED')
        groups[stage].append((s,c))
    for rows in groups.values():
        hashes=[c['target']['inventoryContentHash']for s,c in rows]
        if len(hashes)!=len(set(hashes)):return _a('INVALID_INPUT')
    if any(len(rows)>1 for rows in groups.values()):return _a('AMBIGUOUS_INVENTORY_SCOPE')
    if len(groups['PD'])!=1 or len(groups['RD'])!=1:return _a('MATCHED_INVENTORY_PAIR_UNVERIFIED')
    pairs=[groups['PD'][0],groups['RD'][0]]
    if pairs[0][0]['sourceFileId']==pairs[1][0]['sourceFileId']:return _a('MATCHED_INVENTORY_PAIR_UNVERIFIED')
    if any(s['review']['revisionStatus']!='CURRENT' or s['review']['approvalStatus']!='APPROVED'for s,c in pairs):return _a('SOURCE_REVIEW_UNVERIFIED')
    if pairs[0][0]['review']['sectionCode']!='ODI' or pairs[1][0]['review']['sectionCode']!='AR':return _a('SOURCE_SECTION_UNVERIFIED')
    links=[s['review']['linkGroupId']for s,c in pairs]
    if not links[0] or links[0]!=links[1]:return _a('LINK_SCOPE_UNVERIFIED')
    inventories=[]
    for s,c in pairs:
        o=by_origin[(s['sourceFileId'],c['target']['checkId'])];artifact=o['textArtifact']
        if _hash({'hashDomain':'matrix-source-declaration-text-artifact-v1','textArtifact':artifact})!=o['textArtifactHash']:
            return _a('INVENTORY_RECONSTRUCTION_UNVERIFIED')
        reconstructed=reconstruct_odi120_rail_inventory_source({'sourceFileId':s['sourceFileId'],'sourceSha256':s['sourceSha256'],
            'stage':s['stages'][0],'pageStages':s['review']['pageStages'],'textArtifact':artifact,'selection':c['selection']})
        if reconstructed['status']!='RECONSTRUCTED':return _a('INVENTORY_RECONSTRUCTION_UNVERIFIED')
        inv=reconstructed['inventory']
        if inv!=c['inventorySnapshot'] or _hash({'hashDomain':'matrix-odi120-rail-inventory-source-id-v1','inventory':inv})!=c['target']['inventoryContentHash']:
            return _a('INVENTORY_RECONSTRUCTION_UNVERIFIED')
        inventories.append(inv)
    if any(c['roomMapping']['assertion']!='HUMAN_ASSERTED_SAME_ACCESSIBLE_ROOM' or c['roomMapping']['sourceRoomToken']!=inv['roomToken']for (s,c),inv in zip(pairs,inventories)):
        return _a('ROOM_MAPPING_UNVERIFIED')
    if any(c['assertion']!='HUMAN_ASSERTED_COMPLETE'for s,c in pairs):return _a('HUMAN_COMPLETENESS_UNVERIFIED')
    if any(not inv['featureRows']for inv in inventories):return _a('NONEMPTY_CLOSED_REGION_UNVERIFIED')
    pd={r['featureKey']for r in inventories[0]['featureRows']};rd={r['featureKey']for r in inventories[1]['featureRows']}
    wc={'WC_FIXED_RAIL','WC_FOLDING_RAIL'}
    if not wc<=pd:return _a('PD_REQUIREMENT_UNVERIFIED')
    if wc&rd:return _a('NEGATIVE_SCOPE_UNVERIFIED')
    def ref(pair):
        s,c=pair;r=s['review']
        return {'sourceFileId':s['sourceFileId'],'sourceSha256':s['sourceSha256'],'reviewDecisionId':r['decisionId'],
                'reviewContentHash':r['contentHash'],'inventoryContentHash':c['target']['inventoryContentHash']}
    return {'schemaVersion':SCHEMA,'status':'CANDIDATE','ruleId':'matrix-odi-120-declared_accessible_room_wc_rails_omission',
        'ruleVersion':'1','parameterCode':'ODI-120','reasonCode':'BOTH_WC_RAIL_TYPES_NOT_LISTED_IN_REVIEWED_RD_ROOM_INVENTORY',
        'calibratedProbability':None,'comparisonScope':'REVIEWED_NAMED_ACCESSIBLE_ROOM_DECLARED_REGIONS_ONLY','identity':deepcopy(wanted),
        'expected':ref(pairs[0]),'actual':ref(pairs[1]),'missingFeatureKeys':['WC_FIXED_RAIL','WC_FOLDING_RAIL']}
