"""T44 independent staged comparator for projected reviewed room inventories.

No DB authority, physical absence, equivalence or normative conformity follows
from this function. Protected loader must authenticate ALL origin/review/claim
records before invocation. Frozen T43 source reconstruction is defense in depth.
This implementation never imports AR053 comparison or a TypeScript comparator.
"""
from __future__ import annotations
from copy import deepcopy
from typing import Any
import hashlib
import json
import re
from inspector_worker.table_row_binding import _portable_error, _key, _text

from inspector_worker.call_inventory_source import reconstruct_odi123_call_inventory_source as _RECONSTRUCT
_VERSION='matrix-odi123-call-inventory-comparison-v1'
_INPUT_VERSION='matrix-odi123-call-inventory-input-v1'
_REVIEW_VERSION='matrix-odi123-call-inventory-review-v1'
_ROLE='ACCESSIBLE_SANITARY_ROOM_CALL_SYSTEM'
_SYSTEM='PERSONNEL_CALL'
_RULE='matrix-odi-123-declared_sanitary_room_personnel_call_button_omission'
_FEATURES={'PERSONNEL_CALL_BUTTON','TWO_WAY_COMMUNICATION_SYSTEM'}
_SECTIONS={'PZ','SPZU','AR','KR','IOS1','IOS2','IOS3','IOS4','IOS5','POS','POD','OOS','PPM','ODI','ZU','SM','EOM','GP','GSV','KJ','KM','NVK','OV','PP','PPR','SS','VK'}
_STAGES={'PD','RD','ID','UNRESOLVED'}
_SHA=re.compile(r'[a-f0-9]{64}\Z',re.ASCII)
_PAGE=re.compile(r'[1-9][0-9]{0,15}\Z',re.ASCII)
_SAFE=2**53-1
_IDENTITY={'entityKey','buildingKey','floorKey','roomKey','componentRole','systemKind'}
_TARGET={'checkId','inputManifestHash','textStageContentHash','textArtifactHash','inventoryContentHash'}
_FRAGMENT={'pageNumber','blockIndex','lineIndex','rawText','bboxMilliPoints'}
_SELECTION={'pageNumber','regionBoxMilliPoints','headerFragments','scopeFragments','endFragments'}
_SNAPSHOT={'schemaVersion','extractorVersion','policyVersion','sourceFileId','sourceSha256','textArtifactHash','stage','pageNumber','widthMilliPoints','heightMilliPoints','regionBoxMilliPoints','headerFragments','scopeFragments','endFragments','roomToken','featureRows'}
_REVIEW={'decisionId','contentHash','objectId','sourceFileId','sourceSha256','actorId','revisionStatus','approvalStatus','sectionCode','linkGroupId','pageStages','callInventoryScope'}
_ORIGIN={'checkId','objectId','sourceFileId','sourceSha256','inputManifestHash','textStageContentHash','textArtifactHash','textArtifact'}


def _abstain(reason: str) -> dict[str, Any]:
    return {'schemaVersion':_VERSION,'status':'ABSTAIN','reasonCode':reason,'calibratedProbability':None}


def _exact(value: Any, keys: set[str]) -> bool:
    return type(value) is dict and set(value)==keys


def _integer(value: Any, minimum: int=0) -> bool:
    return type(value) is int and minimum<=value<=_SAFE


def _key_to(value: Any, maximum: int=200) -> bool:
    return _key(value) and len(value)<=maximum


def _sha(value: Any) -> bool:
    return type(value) is str and bool(_SHA.fullmatch(value))


def _enum(value: Any, choices: set[str]) -> bool:
    return type(value) is str and value in choices


def _identity(value: Any) -> bool:
    return (_exact(value,_IDENTITY) and value['componentRole']==_ROLE
            and value['systemKind']==_SYSTEM
            and all(_key(value[name]) for name in ('entityKey','buildingKey','floorKey','roomKey')))


def _box(value: Any, frame: tuple[int,int] | None=None) -> bool:
    return (type(value) is list and len(value)==4 and all(_integer(n) for n in value)
            and value[0]<value[2] and value[1]<value[3]
            and (frame is None or value[2]<=frame[0] and value[3]<=frame[1]))


def _fragment(value: Any, frame: tuple[int,int] | None=None) -> bool:
    return (_exact(value,_FRAGMENT) and _integer(value['pageNumber'],1)
            and _integer(value['blockIndex']) and _integer(value['lineIndex'])
            and _text(value['rawText'],line=True) and 0<len(value['rawText'])<=8192
            and bool(value['rawText'].strip()) and _box(value['bboxMilliPoints'],frame))


def _fragment_group(value: Any, frame: tuple[int,int] | None=None) -> bool:
    return type(value) is list and len(value)==1 and _fragment(value[0],frame)


def _selection(value: Any) -> bool:
    return (_exact(value,_SELECTION) and _integer(value['pageNumber'],1)
            and _box(value['regionBoxMilliPoints'])
            and all(_fragment_group(value[k]) for k in ('headerFragments','scopeFragments','endFragments')))


def _snapshot(value: Any) -> bool:
    if (not _exact(value,_SNAPSHOT)
            or value['schemaVersion']!='matrix-odi123-call-inventory-source-v1'
            or value['extractorVersion']!='matrix-odi123-call-inventory-source-v1'
            or value['policyVersion']!='matrix-odi123-call-inventory-literals-v1'
            or not _key(value['sourceFileId']) or not _sha(value['sourceSha256'])
            or not _sha(value['textArtifactHash']) or not _enum(value['stage'],{'PD','RD'})
            or not all(_integer(value[k],1) for k in ('pageNumber','widthMilliPoints','heightMilliPoints'))
            or not _key(value['roomToken'])):
        return False
    frame=(value['widthMilliPoints'],value['heightMilliPoints'])
    if (not _box(value['regionBoxMilliPoints'],frame)
            or not all(_fragment_group(value[k],frame) for k in ('headerFragments','scopeFragments','endFragments'))
            or type(value['featureRows']) is not list or not 1<=len(value['featureRows'])<=2):
        return False
    if not all(_exact(row,{'featureKey','fragments'}) and _enum(row['featureKey'],_FEATURES)
               and _fragment_group(row['fragments'],frame) for row in value['featureRows']):
        return False
    groups = [value[k] for k in ('headerFragments','scopeFragments','endFragments')]
    groups.extend(row['fragments'] for row in value['featureRows'])
    return all(fragment['pageNumber']==value['pageNumber'] for group in groups for fragment in group)


def _target(value: Any) -> bool:
    return (_exact(value,_TARGET) and _key_to(value['checkId'],120)
            and all(_sha(value[k]) for k in _TARGET-{'checkId'}))


def _mapping(value: Any) -> bool:
    return (_exact(value,{'kind','sourceRoomToken','assertion'})
            and value['kind']=='HUMAN_REVIEWED_ACCESSIBLE_ROOM_MAPPING'
            and _key(value['sourceRoomToken'])
            and _enum(value['assertion'],{'UNKNOWN','HUMAN_ASSERTED_SAME_ACCESSIBLE_ROOM'}))


def _claim(value: Any) -> bool:
    return (_exact(value,{'target','selection','identity','roomMapping','assertion','reference','inventorySnapshot'})
            and _target(value['target']) and _selection(value['selection']) and _identity(value['identity'])
            and _mapping(value['roomMapping'])
            and _enum(value['assertion'],{'UNKNOWN','HUMAN_ASSERTED_COMPLETE'})
            and _text(value['reference'],line=True) and 8<=len(value['reference'])<=1000
            and value['reference'].strip()==value['reference']
            and _snapshot(value['inventorySnapshot']))


def _scope(value: Any) -> bool:
    return (value is None or _exact(value,{'schemaVersion','claims'})
            and value['schemaVersion']==_REVIEW_VERSION and type(value['claims']) is list
            and len(value['claims'])<=16 and all(_claim(c) for c in value['claims']))


def _page_stages(value: Any) -> bool:
    return (type(value) is dict and all(_PAGE.fullmatch(key) and int(key)<=_SAFE
            and _enum(stage,_STAGES) for key,stage in value.items()))


def _review(value: Any) -> bool:
    return (_exact(value,_REVIEW)
            and all(_key(value[k]) for k in ('decisionId','objectId','sourceFileId','actorId'))
            and _sha(value['contentHash']) and _sha(value['sourceSha256'])
            and _enum(value['revisionStatus'],{'CURRENT','SUPERSEDED','UNKNOWN'})
            and _enum(value['approvalStatus'],{'APPROVED','UNAPPROVED','UNKNOWN'})
            and (value['sectionCode'] is None or _enum(value['sectionCode'],_SECTIONS))
            and (value['linkGroupId'] is None or _key_to(value['linkGroupId'],120))
            and _page_stages(value['pageStages']) and _scope(value['callInventoryScope']))


def _source(value: Any) -> bool:
    if (not _exact(value,{'sourceFileId','sourceSha256','stages','reviewSnapshot','review'})
            or not _key(value['sourceFileId']) or not _sha(value['sourceSha256'])
            or type(value['stages']) is not list or any(not _enum(s,_STAGES) for s in value['stages'])
            or len(set(value['stages']))!=len(value['stages'])):
        return False
    snapshot,review=value['reviewSnapshot'],value['review']
    if (snapshot is None)!=(review is None):return False
    return (snapshot is None or _exact(snapshot,{'decisionId','contentHash'})
            and _key(snapshot['decisionId']) and _sha(snapshot['contentHash']) and _review(review))


def _origin(value: Any) -> bool:
    return (_exact(value,_ORIGIN) and _key_to(value['checkId'],120)
            and all(_key(value[k]) for k in ('objectId','sourceFileId'))
            and all(_sha(value[k]) for k in ('sourceSha256','inputManifestHash','textStageContentHash','textArtifactHash'))
            and type(value['textArtifact']) is dict)


def _claims(source: dict[str,Any]) -> list[dict[str,Any]]:
    review=source['review']
    return [] if review is None or review['callInventoryScope'] is None else review['callInventoryScope']['claims']


def _collection_limit(value: Any) -> bool:
    if type(value) is not dict:return False
    sources=value.get('sources');origins=value.get('origins')
    if type(origins) is list and len(origins)>128:return True
    if type(sources) is not list:return False
    if len(sources)>64:return True
    total=0
    for source in sources:
        if type(source) is not dict:continue
        review=source.get('review')
        if type(review) is not dict:continue
        scope=review.get('callInventoryScope')
        if type(scope) is not dict:continue
        claims=scope.get('claims')
        if type(claims) is list:
            total+=len(claims)
            if len(claims)>16 or total>128:return True
    return False


def _hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf-8')).hexdigest()


def _inventory_hash(value: Any) -> str:
    return _hash({'hashDomain':'matrix-odi123-call-inventory-source-id-v1','inventory':value})


def _reference(source: dict[str,Any], claim: dict[str,Any]) -> dict[str,Any]:
    review=source['review']
    return {'sourceFileId':source['sourceFileId'],'sourceSha256':source['sourceSha256'],
            'reviewDecisionId':review['decisionId'],'reviewContentHash':review['contentHash'],
            'inventoryContentHash':claim['target']['inventoryContentHash']}


def compare_odi123_call_inventories(projection: Any) -> dict[str,Any]:
    """Compare exact projected reviewed declared inventories; never DB authority."""
    native=_portable_error(projection)
    if native:return _abstain('INPUT_LIMIT' if native=='LIMIT' else 'INVALID_INPUT')
    if _collection_limit(projection):return _abstain('INPUT_LIMIT')
    if (not _exact(projection,{'schemaVersion','objectId','inputManifestHash','identity','sources','origins'})
            or projection['schemaVersion']!=_INPUT_VERSION or not _key(projection['objectId'])
            or not _sha(projection['inputManifestHash']) or not _identity(projection['identity'])
            or type(projection['sources']) is not list or not all(_source(s) for s in projection['sources'])
            or type(projection['origins']) is not list or not all(_origin(o) for o in projection['origins'])):
        return _abstain('INVALID_INPUT')
    sources=projection['sources'];origins=projection['origins'];identity=projection['identity']
    source_map={s['sourceFileId']:s for s in sources}
    origin_map={(o['sourceFileId'],o['checkId']):o for o in origins}
    if len(source_map)!=len(sources) or len(origin_map)!=len(origins):return _abstain('INVALID_INPUT')
    for origin in origins:
        source=source_map.get(origin['sourceFileId'])
        if (source is None or origin['objectId']!=projection['objectId']
                or origin['sourceSha256']!=source['sourceSha256']):
            return _abstain('SOURCE_PROVENANCE_UNVERIFIED')
    for source in sources:
        review=source['review']
        if review is None:continue
        snapshot=source['reviewSnapshot']
        if (review['objectId']!=projection['objectId'] or review['sourceFileId']!=source['sourceFileId']
                or review['sourceSha256']!=source['sourceSha256']
                or review['decisionId']!=snapshot['decisionId'] or review['contentHash']!=snapshot['contentHash']):
            return _abstain('SOURCE_PROVENANCE_UNVERIFIED')
        for claim in _claims(source):
            inventory=claim['inventorySnapshot']
            if (inventory['sourceFileId']!=source['sourceFileId']
                    or inventory['sourceSha256']!=source['sourceSha256']):
                return _abstain('SOURCE_PROVENANCE_UNVERIFIED')
            target=claim['target'];origin=origin_map.get((source['sourceFileId'],target['checkId']))
            if origin is None or any(target[k]!=origin[k] for k in ('inputManifestHash','textStageContentHash','textArtifactHash')):
                return _abstain('SOURCE_PROVENANCE_UNVERIFIED')
    location=tuple(identity[k] for k in ('buildingKey','floorKey','roomKey'))
    matches=[]
    for source in sources:
        for claim in _claims(source):
            own=claim['identity']
            if own['entityKey']==identity['entityKey'] or tuple(own[k] for k in ('buildingKey','floorKey','roomKey'))==location:
                matches.append((source,claim))
    if any(claim['identity']!=identity for _,claim in matches):return _abstain('ROOM_IDENTITY_CONFLICT')
    groups={'PD':[],'RD':[]}
    for source,claim in matches:
        stages=source['stages'];review=source['review']
        if len(stages)!=1 or stages[0] not in groups or any(s!=stages[0] for s in review['pageStages'].values()):
            return _abstain('SOURCE_STAGE_UNVERIFIED')
        groups[stages[0]].append((source,claim))
    for group in groups.values():
        hashes=[c['target']['inventoryContentHash'] for _,c in group]
        if len(set(hashes))!=len(hashes):return _abstain('INVALID_INPUT')
    if any(len(group)>1 for group in groups.values()):return _abstain('AMBIGUOUS_INVENTORY_SCOPE')
    if len(groups['PD'])!=1 or len(groups['RD'])!=1:return _abstain('MATCHED_INVENTORY_PAIR_UNVERIFIED')
    pd,rd=groups['PD'][0],groups['RD'][0]
    if pd[0]['sourceFileId']==rd[0]['sourceFileId']:return _abstain('MATCHED_INVENTORY_PAIR_UNVERIFIED')
    pair=(pd,rd)
    if any(s['review']['revisionStatus']!='CURRENT' or s['review']['approvalStatus']!='APPROVED' for s,_ in pair):
        return _abstain('SOURCE_REVIEW_UNVERIFIED')
    if pd[0]['review']['sectionCode'] not in {'SS','ODI'} or rd[0]['review']['sectionCode']!='SS':
        return _abstain('SOURCE_SECTION_UNVERIFIED')
    link=pd[0]['review']['linkGroupId']
    if link is None or rd[0]['review']['linkGroupId']!=link:return _abstain('LINK_SCOPE_UNVERIFIED')
    inventories=[]
    for source,claim in pair:
        target=claim['target'];origin=origin_map[(source['sourceFileId'],target['checkId'])]
        result=_RECONSTRUCT({'sourceFileId':source['sourceFileId'],'sourceSha256':source['sourceSha256'],
                            'stage':source['stages'][0],'pageStages':source['review']['pageStages'],
                            'textArtifact':origin['textArtifact'],'selection':claim['selection']})
        if result['status']!='RECONSTRUCTED':return _abstain('INVENTORY_RECONSTRUCTION_UNVERIFIED')
        inventory=result['inventory']
        if (inventory!=claim['inventorySnapshot'] or _inventory_hash(inventory)!=target['inventoryContentHash']
                or inventory['textArtifactHash']!=origin['textArtifactHash']):
            return _abstain('INVENTORY_RECONSTRUCTION_UNVERIFIED')
        inventories.append(inventory)
    if any(claim['roomMapping']['sourceRoomToken']!=inventory['roomToken']
           or claim['roomMapping']['assertion']!='HUMAN_ASSERTED_SAME_ACCESSIBLE_ROOM'
           for (_,claim),inventory in zip(pair,inventories)):
        return _abstain('ROOM_MAPPING_UNVERIFIED')
    if any(claim['assertion']!='HUMAN_ASSERTED_COMPLETE' for _,claim in pair):
        return _abstain('HUMAN_COMPLETENESS_UNVERIFIED')
    if any(not inventory['featureRows'] for inventory in inventories):
        return _abstain('NONEMPTY_CLOSED_REGION_UNVERIFIED')
    expected_keys={row['featureKey'] for row in inventories[0]['featureRows']}
    actual_keys={row['featureKey'] for row in inventories[1]['featureRows']}
    if 'PERSONNEL_CALL_BUTTON' not in expected_keys:return _abstain('PD_REQUIREMENT_UNVERIFIED')
    if 'PERSONNEL_CALL_BUTTON' in actual_keys:return _abstain('NEGATIVE_SCOPE_UNVERIFIED')
    return {'schemaVersion':_VERSION,'status':'CANDIDATE','ruleId':_RULE,'ruleVersion':'1','parameterCode':'ODI-123',
            'reasonCode':'PERSONNEL_CALL_BUTTON_NOT_LISTED_IN_REVIEWED_RD_ROOM_INVENTORY','calibratedProbability':None,
            'comparisonScope':'REVIEWED_NAMED_ACCESSIBLE_ROOM_DECLARED_REGIONS_ONLY','identity':deepcopy(identity),
            'expected':_reference(*pd),'actual':_reference(*rd),'missingFeatureKeys':['PERSONNEL_CALL_BUTTON']}
