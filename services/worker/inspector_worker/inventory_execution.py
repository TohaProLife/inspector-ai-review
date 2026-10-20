"""Staged T42 typed inventory execution, not DB/source authentication.

Inputs come from a separately protected complete loader. Native materialization
is capped at inherited 8,000,000 UTF8 key/value bytes including identities; the
64MiB serialized transport ceiling does not enlarge this stricter pure budget.
No scalar registry/execution/IDs or frozen T41 comparison payload is modified.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from typing import Any

from inspector_worker import ar053_inventory_comparison as pure
from inspector_worker.inventory_source import reconstruct_ar053_inventory_source
from inspector_worker.source_declarations import _valid_artifact

WRAPPER_VERSION = 'matrix-inventory-execution-v1'
COVERAGE_POLICY_VERSION = 'matrix-inventory-coverage-v1'
SCHEMA_VERSION = 'matrix-inventory-comparisons-v1'
PARTIAL_GAP = ('PARTIAL_SUBRULES_ONLY:REVIEWED_DECLARED_JOINT_DAMPING_TAPE_MEMBERSHIP_ONLY;'
               'GLOBAL_OR_PHYSICAL_ABSENCE_AND_SUBSTITUTION_UNSUPPORTED')
_IDENTITY_KEYS = set(pure._IDENTITY_KEYS)
_CAPABILITY_ENTRY = {'parameterCode': 'AR-053', 'matrixCode': 'M-053', 'ruleId': pure.RULE_ID,
    'ruleVersion': '1', 'enabled': True, 'comparisonVariant': 'PD_RD', 'family': 'PRESENCE_SET',
    'executionKind': 'REVIEWED_DECLARED_REGION_INVENTORY',
    'resultSchemaVersion': 'matrix-ar053-inventory-comparison-v1', 'partialGap': PARTIAL_GAP}
_CAPABILITY = {'schemaVersion': 'matrix-inventory-capabilities-v1', 'entries': [_CAPABILITY_ENTRY]}
_PACKAGE_KEYS = {'schemaVersion', 'objectId', 'inputManifestHash', 'sources', 'origins', 'identities'}
_ENVELOPE_KEYS = {'schemaVersion', 'purpose', 'objectId', 'inputManifestHash', 'capabilityRegistryHash', 'results'}
_COMMON_KEYS = {'schemaVersion', 'id', 'ruleId', 'ruleVersion', 'parameterCode', 'comparisonVariant', 'kind'}
_COVERAGE_KEYS = {'parameterCode', 'implementedAtomicRules', 'enabledAtomicRules', 'evaluatedAtomicRules',
                  'successfulComparisons', 'abstentions', 'failures', 'executionStatus', 'reason'}
_COUNTS = _COVERAGE_KEYS - {'parameterCode', 'executionStatus', 'reason'}
_LEGITIMATE_ABSTENTIONS = {'SOURCE_STAGE_UNVERIFIED', 'AMBIGUOUS_INVENTORY_SCOPE',
    'MATCHED_INVENTORY_PAIR_UNVERIFIED', 'SOURCE_REVIEW_UNVERIFIED', 'SOURCE_SECTION_UNVERIFIED',
    'LINK_SCOPE_UNVERIFIED', 'HUMAN_COMPLETENESS_UNVERIFIED', 'NONEMPTY_CLOSED_REGION_UNVERIFIED',
    'PD_REQUIREMENT_UNVERIFIED', 'NEGATIVE_SCOPE_UNVERIFIED'}


def _require(condition: bool, reason: str) -> None:
    if not condition:
        raise ValueError(reason)


def _bounded(value: Any) -> None:
    _require(pure._portable_error(value) is None, 'inventory execution input is not bounded portable JSON')


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def canonical_inventory_json(value: Any) -> str:
    _bounded(value)
    return _canonical(value)


def _hash(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode('utf-8')).hexdigest()


def _registry(registry: Any) -> str:
    _bounded(registry)
    _require(_canonical(registry) == _canonical(_CAPABILITY), 'invalid inventory capability registry')
    return _hash(registry)


def _all_claims(package: dict[str, Any]):
    for source in package['sources']:
        review = source['review']
        for claim in review['inventoryScope']['claims'] if review and review['inventoryScope'] else []:
            yield source, claim


def _validate_package(package: Any) -> list[dict[str, Any]]:
    _bounded(package)
    _require(pure._exact(package, _PACKAGE_KEYS), 'invalid loader package keys')
    _require(package['schemaVersion'] == 'matrix-ar053-loader-inputs-v1'
             and pure._id(package['objectId']) and pure._sha(package['inputManifestHash']), 'invalid loader metadata')
    _require(type(package['sources']) is list and type(package['origins']) is list
             and type(package['identities']) is list and len(package['identities']) <= 128
             and not pure._collection_limit(package), 'loader collection limit or shape')
    _require(all(pure._source(source) for source in package['sources'])
             and all(pure._origin(origin) for origin in package['origins'])
             and all(pure._identity(identity) for identity in package['identities']), 'invalid loader DTO')
    sources = {source['sourceFileId']: source for source in package['sources']}
    origins = {(origin['sourceFileId'], origin['checkId']): origin for origin in package['origins']}
    _require(len(sources) == len(package['sources']) and len(origins) == len(package['origins']), 'duplicate loader source/origin')
    for origin in package['origins']:
        source = sources.get(origin['sourceFileId'])
        _require(source is not None and origin['objectId'] == package['objectId']
                 and origin['sourceSha256'] == source['sourceSha256'], 'origin source association mismatch')
        artifact = origin['textArtifact']
        _require(_valid_artifact(artifact) and artifact['sourceFileId'] == origin['sourceFileId']
                 and artifact['inputSha256'] == origin['sourceSha256'], 'invalid complete origin text artifact')
        _require(_hash({'hashDomain': 'matrix-source-declaration-text-artifact-v1', 'textArtifact': artifact})
                 == origin['textArtifactHash'], 'origin text artifact hash mismatch')
    for source in package['sources']:
        review = source['review']
        if review is None:
            continue
        snapshot = source['reviewSnapshot']
        _require(review['objectId'] == package['objectId'] and review['sourceFileId'] == source['sourceFileId']
                 and review['sourceSha256'] == source['sourceSha256']
                 and review['decisionId'] == snapshot['decisionId'] and review['contentHash'] == snapshot['contentHash'],
                 'review snapshot provenance mismatch')
    identities = {}
    for source, claim in _all_claims(package):
        origin = origins.get((source['sourceFileId'], claim['target']['checkId']))
        _require(origin is not None and all(claim['target'][key] == origin[key]
                 for key in ('inputManifestHash', 'textStageContentHash', 'textArtifactHash')), 'claim origin association mismatch')
        # Origin integrity uses its own stored declared stage, without consumer
        # eligibility overrides. Conflicting consumer stages remain pure abstention.
        result = reconstruct_ar053_inventory_source({'sourceFileId': source['sourceFileId'],
            'sourceSha256': source['sourceSha256'], 'stage': claim['inventorySnapshot']['stage'],
            'pageStages': {}, 'textArtifact': origin['textArtifact'], 'selection': claim['selection']})
        _require(result['status'] == 'RECONSTRUCTED' and result['inventory'] == claim['inventorySnapshot']
                 and _hash({'hashDomain': 'matrix-inventory-source-id-v1', 'inventory': result['inventory']})
                 == claim['target']['inventoryContentHash'], 'claim inventory reconstruction mismatch')
        identity = {key: claim[key] for key in _IDENTITY_KEYS}
        identities[_canonical(identity)] = identity
    derived = [identities[key] for key in sorted(identities)]
    _require(len(derived) <= 128 and package['identities'] == derived, 'loader identities differ from complete derived scope')
    return derived


def _result_id(envelope: dict[str, Any], body: dict[str, Any]) -> str:
    return _hash({'hashDomain': 'matrix-inventory-execution-result-id-v1',
        'objectId': envelope['objectId'], 'inputManifestHash': envelope['inputManifestHash'],
        'capabilityRegistryHash': envelope['capabilityRegistryHash'], 'result': body})


def build_inventory_comparisons(package: Any, capability_registry: Any) -> dict[str, Any]:
    capability_hash = _registry(capability_registry)
    identities = _validate_package(package)
    envelope = {'schemaVersion': SCHEMA_VERSION, 'purpose': 'MACHINE_COMPARISON',
        'objectId': package['objectId'], 'inputManifestHash': package['inputManifestHash'],
        'capabilityRegistryHash': capability_hash, 'results': []}
    for identity in identities:
        comparison = pure.compare_ar053_inventories({'schemaVersion': pure.INPUT_VERSION,
            'objectId': package['objectId'], 'inputManifestHash': package['inputManifestHash'],
            'identity': identity, 'sources': package['sources'], 'origins': package['origins']})
        _require(comparison['status'] == 'CANDIDATE' or comparison['reasonCode'] in _LEGITIMATE_ABSTENTIONS,
                 'trusted inventory comparison integrity failure')
        envelope['results'].append({'schemaVersion': 'matrix-inventory-execution-result-v1',
            'ruleId': pure.RULE_ID, 'ruleVersion': '1', 'parameterCode': 'AR-053', 'comparisonVariant': 'PD_RD',
            'kind': 'SCOPED_COMPARISON', 'identity': deepcopy(identity), 'comparison': comparison})
    if not identities:
        envelope['results'].append({'schemaVersion': 'matrix-inventory-execution-result-v1',
            'ruleId': pure.RULE_ID, 'ruleVersion': '1', 'parameterCode': 'AR-053', 'comparisonVariant': 'PD_RD',
            'kind': 'UNBOUND_ATOM_ABSTENTION', 'reasonCode': 'REVIEWED_INVENTORY_IDENTITY_MISSING',
            'calibratedProbability': None})
    for body in envelope['results']:
        body['id'] = _result_id(envelope, body)
    _validate_envelope(envelope, capability_hash)
    return envelope


def _reference(value: Any) -> bool:
    return (pure._exact(value, {'sourceFileId', 'sourceSha256', 'reviewDecisionId', 'reviewContentHash', 'inventoryContentHash'})
            and pure._id(value['sourceFileId']) and pure._id(value['reviewDecisionId'])
            and all(pure._sha(value[key]) for key in ('sourceSha256', 'reviewContentHash', 'inventoryContentHash')))


def _comparison(value: Any, identity: dict[str, Any]) -> bool:
    if type(value) is not dict or value.get('schemaVersion') != pure.RESULT_VERSION or value.get('calibratedProbability') is not None:
        return False
    if value.get('status') == 'ABSTAIN':
        return (pure._exact(value, {'schemaVersion', 'status', 'reasonCode', 'calibratedProbability'})
                and type(value['reasonCode']) is str and value['reasonCode'] in _LEGITIMATE_ABSTENTIONS)
    return (pure._exact(value, {'schemaVersion', 'status', 'ruleId', 'ruleVersion', 'parameterCode', 'reasonCode',
                'calibratedProbability', 'comparisonScope', 'identity', 'expected', 'actual', 'missingFeatureKeys'})
            and value['status'] == 'CANDIDATE' and value['ruleId'] == pure.RULE_ID and value['ruleVersion'] == '1'
            and value['parameterCode'] == 'AR-053' and value['identity'] == identity
            and value['reasonCode'] == 'DAMPING_TAPE_NOT_LISTED_IN_REVIEWED_RD_REGION'
            and value['comparisonScope'] == 'REVIEWED_DECLARED_REGIONS_ONLY'
            and value['missingFeatureKeys'] == ['DAMPING_TAPE'] and _reference(value['expected']) and _reference(value['actual'])
            and value['expected']['sourceFileId'] != value['actual']['sourceFileId'])


def _validate_envelope(envelope: Any, capability_hash: str) -> None:
    _bounded(envelope)
    _require(pure._exact(envelope, _ENVELOPE_KEYS) and envelope['schemaVersion'] == SCHEMA_VERSION
             and envelope['purpose'] == 'MACHINE_COMPARISON' and pure._id(envelope['objectId'])
             and pure._sha(envelope['inputManifestHash']) and envelope['capabilityRegistryHash'] == capability_hash
             and type(envelope['results']) is list and 1 <= len(envelope['results']) <= 128, 'invalid inventory result envelope')
    identity_keys = []
    for row in envelope['results']:
        _require(type(row) is dict and row.get('schemaVersion') == 'matrix-inventory-execution-result-v1'
                 and row.get('ruleId') == pure.RULE_ID and row.get('ruleVersion') == '1'
                 and row.get('parameterCode') == 'AR-053' and row.get('comparisonVariant') == 'PD_RD'
                 and pure._sha(row.get('id')), 'invalid typed inventory row')
        if row.get('kind') == 'UNBOUND_ATOM_ABSTENTION':
            _require(len(envelope['results']) == 1 and pure._exact(row, _COMMON_KEYS | {'reasonCode', 'calibratedProbability'})
                     and row['reasonCode'] == 'REVIEWED_INVENTORY_IDENTITY_MISSING'
                     and row['calibratedProbability'] is None, 'invalid unbound abstention')
        else:
            _require(pure._exact(row, _COMMON_KEYS | {'identity', 'comparison'}) and row['kind'] == 'SCOPED_COMPARISON'
                     and pure._identity(row['identity']) and _comparison(row['comparison'], row['identity']), 'invalid scoped comparison')
            identity_keys.append(_canonical(row['identity']))
        body = {key: value for key, value in row.items() if key != 'id'}
        _require(row['id'] == _result_id(envelope, body), 'typed inventory result ID mismatch')
    _require(identity_keys == sorted(set(identity_keys)), 'duplicate or unsorted result identities')


def merge_inventory_coverage(baseCoverage: Any, envelope: Any, capability_registry: Any) -> list[dict[str, Any]]:
    """Merge only independently verified typed execution, not source authority.

    Shape/ID checking here cannot replace rebuilding the envelope from the full
    authenticated package at API completion/seal/read. Other131 rows unchanged.
    """
    capability_hash = _registry(capability_registry)
    _validate_envelope(envelope, capability_hash)
    _bounded(baseCoverage)
    registry_path = Path(__file__).resolve().parents[1] / 'rules/matrix-execution-v1.json'
    scalar_registry = json.loads(registry_path.read_text())
    codes = [entry['parameterCode'] for entry in scalar_registry['entries']]
    _require(not any(rule['ruleId'] == pure.RULE_ID for entry in scalar_registry['entries']
                     for rule in entry['atomicRules']), 'inventory rule collides with scalar namespace')
    _require(len(codes) == 132 and len(set(codes)) == 132 and type(baseCoverage) is list
             and len(baseCoverage) == 132, 'invalid base coverage length/catalog')
    for index, row in enumerate(baseCoverage):
        _require(pure._exact(row, _COVERAGE_KEYS) and row['parameterCode'] == codes[index]
                 and all(pure._integer(row[key]) for key in _COUNTS)
                 and type(row['executionStatus']) is str
                 and row['executionStatus'] in {'UNSUPPORTED', 'PARTIAL', 'EVALUATED', 'TECHNICAL_FAILURE'}
                 and type(row['reason']) is str,
                 'invalid base coverage row')
    target = next(row for row in baseCoverage if row['parameterCode'] == 'AR-053')
    _require(target['executionStatus'] == 'UNSUPPORTED' and all(target[key] == 0 for key in _COUNTS),
             'inventory overlay overlaps base atomic coverage')
    merged = deepcopy(baseCoverage)
    target = next(row for row in merged if row['parameterCode'] == 'AR-053')
    successful = sum(row['kind'] == 'SCOPED_COMPARISON' and row['comparison']['status'] == 'CANDIDATE'
                     for row in envelope['results'])
    target.update(implementedAtomicRules=1, enabledAtomicRules=1, evaluatedAtomicRules=1,
                  successfulComparisons=successful, abstentions=len(envelope['results']) - successful,
                  failures=0, executionStatus='PARTIAL', reason=PARTIAL_GAP)
    return merged
