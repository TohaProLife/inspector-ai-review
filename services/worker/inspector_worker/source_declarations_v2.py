"""Immutable evidence v2: unchanged steel declarations plus literal fire table rows.

The frozen v1 wrapper validates all committed input before any second parser
runs. Neither declaration kind enters scalar observations or rule coverage.
"""
from __future__ import annotations
from typing import Any

from . import source_declarations as legacy
from .fire_resistance_table import EXTRACTOR_VERSION as FIRE_EXTRACTOR_VERSION, extract_fire_resistance_candidates

SCHEMA_VERSION = 'matrix-source-declarations-v2'
EXTRACTOR_VERSION = 'matrix-source-declarations-v2'
HASH_POLICY_VERSION = legacy.HASH_POLICY_VERSION
canonical_source_declaration_json = legacy.canonical_source_declaration_json
source_declaration_id = legacy.source_declaration_id


def extract_source_declarations(input: Any) -> dict[str, Any]:
    """Reconstruct both evidence kinds over independently validated full inputs."""
    steel = legacy.extract_source_declarations(input)
    result = {**steel, 'schemaVersion': SCHEMA_VERSION, 'extractorVersion': EXTRACTOR_VERSION}
    artifacts = {artifact['sourceFileId']: artifact for artifact in input['textArtifacts']}
    for source in input['sources']:
        stages = source['stages']
        if (len(stages) != 1 or stages[0] not in {'PD', 'RD'}
                or any(stage != stages[0] for stage in source.get('pageStages', {}).values())):
            continue
        artifact = artifacts.get(source['sourceFileId'])
        if artifact is None:
            continue
        text_hash = legacy._hash({'hashDomain': 'matrix-source-declaration-text-artifact-v1',
                                  'textArtifact': artifact})
        for page in artifact['pages']:
            for candidate in extract_fire_resistance_candidates(page, stages[0]):
                body = {'schemaVersion': 'matrix-source-declaration-v1',
                        'kind': 'SOURCE_AUTHORED_FIRE_RESISTANCE_DECLARATION',
                        'extractorVersion': FIRE_EXTRACTOR_VERSION,
                        'sourceFileId': source['sourceFileId'], 'sourceSha256': source['sha256'],
                        'textArtifactHash': text_hash, 'stage': stages[0],
                        'pageNumber': page['pageNumber'], 'widthMilliPoints': page['widthMilliPoints'],
                        'heightMilliPoints': page['heightMilliPoints'], 'entityKey': None,
                        'applicabilityStatus': 'UNREVIEWED', **candidate}
                result['declarations'].append({'id': source_declaration_id(body), **body})
    result['declarations'].sort(key=lambda declaration: (
        declaration['sourceFileId'], declaration['pageNumber'], declaration['id']))
    return result


def validate_source_declarations(raw: Any, input: Any) -> dict[str, Any] | None:
    """Untrusted claims must equal the independently reconstructed full sibling.

    Malformed trusted input raises ValueError exactly as v1; malformed worker
    output returns None. Recomputed IDs never grant source or scope authority.
    """
    expected = extract_source_declarations(input)
    try:
        return expected if canonical_source_declaration_json(raw) == canonical_source_declaration_json(expected) else None
    except (ValueError, TypeError, UnicodeError, RecursionError):
        return None


extract_source_declarations_v2 = extract_source_declarations
validate_source_declarations_v2 = validate_source_declarations
