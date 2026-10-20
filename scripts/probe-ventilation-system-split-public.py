#!/usr/bin/env python3
"""Opt-in offline source probe: single ventilation mark versus suffix group.

Reads a pinned public document manifest, whole original PDFs and pinned full
canonical caches. Never reads answers, invokes the current engine or emits a
matrix finding. Exact aggregate flow corroborates a source-only candidate; it
cannot establish physical-system equivalence, approved change or violation.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from decimal import Decimal, localcontext
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any

EXPECTED_MANIFEST_SHA256 = '853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7'
_HASH = re.compile(r'[a-f0-9]{64}')
_NUMBER = r'(?:0|[1-9][0-9]{0,11})(?:[.,][0-9]{1,6})?'
_LINE = re.compile(
    rf'[ \t]*(?:Проект:[ \t]*)?(?P<system>П(?P<stem>[1-9][0-9]{{0,2}})'
    rf'(?:\.(?P<suffix>[1-9][0-9]{{0,2}}))?)[ \t]*'
    rf'\(L[ \t]*=[ \t]*(?P<flow>{_NUMBER})[ \t]+м(?:3|³)/ч,[ \t]*'
    rf'Pc[ \t]*=[ \t]*(?P<pressure>{_NUMBER})[ \t]+Па\)[ \t]*'
)


class ProbeError(ValueError):
    pass


@dataclass(frozen=True)
class SourceInput:
    role: str
    file_id: str
    original: Path
    canonical: Path
    expected_canonical_sha256: str


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def content_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def decimal_text(value: Decimal) -> str:
    text = format(value, 'f')
    return text.rstrip('0').rstrip('.') if '.' in text else text


def parse_system_line(raw: str) -> dict[str, str | None] | None:
    """Whole explicit source line only; no values inferred from a nearby table."""
    match = _LINE.fullmatch(raw)
    if not match:
        return None
    flow, pressure = (Decimal(match[name].replace(',', '.')) for name in ['flow', 'pressure'])
    if flow <= 0 or pressure <= 0:
        return None
    return {'system': match['system'], 'stem': 'П' + match['stem'], 'suffix': match['suffix'],
            'airflowM3PerHour': decimal_text(flow), 'freePressurePa': decimal_text(pressure)}


def _box(value: Any, width: int, height: int) -> bool:
    return (isinstance(value, list) and len(value) == 4
            and all(type(n) is int for n in value)
            and 0 <= value[0] < value[2] <= width
            and 0 <= value[1] < value[3] <= height)


def verify_inputs(manifest_path: Path, inputs: list[SourceInput],
                  expected_manifest_sha256: str) -> tuple[list[dict], list[dict]]:
    if not _HASH.fullmatch(expected_manifest_sha256):
        raise ProbeError('INVALID_MANIFEST_HASH_ANCHOR')
    manifest_bytes = manifest_path.read_bytes()
    if len(manifest_bytes) > 16 * 1024 * 1024:
        raise ProbeError('MANIFEST_LIMIT')
    if hashlib.sha256(manifest_bytes).hexdigest() != expected_manifest_sha256:
        raise ProbeError('MANIFEST_SHA256_MISMATCH')
    if (len(inputs) != 2 or {source.role for source in inputs} != {'PD', 'RD'}
            or len({source.file_id for source in inputs}) != 2):
        raise ProbeError('EXACT_PD_RD_SOURCE_ROLES_REQUIRED')
    selected: dict[str, dict] = {}
    wanted = {source.file_id for source in inputs}
    for line in manifest_bytes.decode('utf-8').splitlines():
        row = json.loads(line)
        if row.get('file_id') not in wanted:
            continue
        if row['file_id'] in selected:
            raise ProbeError('DUPLICATE_MANIFEST_SOURCE')
        selected[row['file_id']] = row
    if set(selected) != wanted:
        raise ProbeError('MANIFEST_SOURCE_MISSING')
    if len({row.get('object_id') for row in selected.values()}) != 1:
        raise ProbeError('OBJECT_MISMATCH')
    artifacts, verified = [], []
    for source in inputs:
        row = selected[source.file_id]
        if (not isinstance(row.get('object_id'), str) or not row['object_id'].strip()
                or row.get('split') != 'TRAIN_PUBLIC' or row.get('distribution_status') != 'INCLUDE'
                or row.get('label_visibility') != 'PUBLIC_TRAIN' or row.get('section') != 'OV'
                or row.get('extension') != '.pdf'):
            raise ProbeError('PUBLIC_SOURCE_SCOPE_UNVERIFIED')
        if row.get('stage') not in ({'PD'} if source.role == 'PD' else {'RD', 'RD_ID_MIXED'}):
            raise ProbeError('SOURCE_ROLE_STAGE_UNVERIFIED')
        if (not isinstance(row.get('sha256'), str) or not _HASH.fullmatch(row['sha256'])
                or type(row.get('size_bytes')) is not int or row['size_bytes'] <= 0
                or type(row.get('pdf_pages')) is not int or not 1 <= row['pdf_pages'] <= 4096):
            raise ProbeError('INVALID_MANIFEST_SOURCE_METADATA')
        if (not source.original.is_file() or source.original.stat().st_size != row['size_bytes']
                or file_sha256(source.original) != row['sha256']):
            raise ProbeError('ORIGINAL_SHA256_OR_SIZE_MISMATCH')
        cache_bytes = source.canonical.read_bytes()
        if len(cache_bytes) > 128 * 1024 * 1024:
            raise ProbeError('CANONICAL_CACHE_LIMIT')
        if (not _HASH.fullmatch(source.expected_canonical_sha256)
                or hashlib.sha256(cache_bytes).hexdigest() != source.expected_canonical_sha256):
            raise ProbeError('CANONICAL_CACHE_SHA256_MISMATCH')
        artifact = json.loads(cache_bytes)
        if (not isinstance(artifact, dict) or artifact.get('schemaVersion') not in {'document-text-v1', 'document-text-v2'}
                or artifact.get('coordinateSystem') != 'PDF_BOTTOM_LEFT_MILLI_POINTS'
                or artifact.get('sourceFileId') != source.file_id or artifact.get('inputSha256') != row['sha256']
                or artifact.get('pageCount') != row['pdf_pages'] or not isinstance(artifact.get('pages'), list)
                or len(artifact['pages']) != row['pdf_pages']):
            raise ProbeError('CANONICAL_SOURCE_IDENTITY_OR_COMPLETENESS_MISMATCH')
        for number, page in enumerate(artifact['pages'], 1):
            if (not isinstance(page, dict) or type(page.get('pageNumber')) is not int or page['pageNumber'] != number
                    or any(type(page.get(key)) is not int or page[key] <= 0
                           for key in ['widthMilliPoints', 'heightMilliPoints'])
                    or not isinstance(page.get('blocks'), list)):
                raise ProbeError('CANONICAL_FULL_PAGE_SEQUENCE_UNVERIFIED')
            for block in page['blocks']:
                if not isinstance(block, dict) or not isinstance(block.get('text'), str):
                    raise ProbeError('CANONICAL_BLOCK_UNVERIFIED')
        record = {'inputRole': source.role, 'fileId': source.file_id, 'objectId': row['object_id'],
                  'manifestStage': row['stage'], 'stage': row['stage'] if row['stage'] in {'PD', 'RD'} else 'UNRESOLVED',
                  'stageReason': None if row['stage'] in {'PD', 'RD'} else 'PAGE_STAGE_UNVERIFIED',
                  'section': row['section'], 'originalPath': str(source.original.resolve()),
                  'originalSha256': row['sha256'], 'originalBytes': row['size_bytes'], 'pageCount': row['pdf_pages'],
                  'canonicalPath': str(source.canonical.resolve()), 'canonicalSha256': source.expected_canonical_sha256,
                  'sourceApproval': 'UNVERIFIED', 'revisionStatus': 'UNVERIFIED'}
        artifacts.append(artifact)
        verified.append(record)
    return verified, artifacts


def extract_observations(source: dict, artifact: dict) -> tuple[list[dict], list[dict]]:
    observations, rejected = [], []
    for page in artifact['pages']:
        for block_index, block in enumerate(page['blocks']):
            lines = block['text'].split('\n')
            boxes = block.get('lineBboxesMilliPoints')
            for line_index, raw in enumerate(lines):
                parsed = parse_system_line(raw)
                if parsed is None:
                    continue
                quote = {'fileId': source['fileId'], 'sourceSha256': source['originalSha256'],
                         'canonicalSha256': source['canonicalSha256'], 'inputRole': source['inputRole'],
                         'manifestStage': source['manifestStage'], 'stage': source['stage'], 'stageReason': source['stageReason'],
                         'physicalPage': page['pageNumber'], 'blockIndex': block_index, 'lineIndex': line_index,
                         'blockId': f'{block_index}:{line_index}', 'rawText': raw, 'rawBlockText': block['text'],
                         'coordinateSystem': 'PDF_BOTTOM_LEFT_MILLI_POINTS',
                         'pageWidthMilliPoints': page['widthMilliPoints'], 'pageHeightMilliPoints': page['heightMilliPoints'],
                         **parsed}
                if (not isinstance(boxes, list) or len(boxes) != len(lines)
                        or not _box(boxes[line_index], page['widthMilliPoints'], page['heightMilliPoints'])):
                    rejected.append({**quote, 'reason': 'EXACT_LINE_BBOX_UNVERIFIED'})
                    continue
                quote['bboxMilliPoints'] = boxes[line_index]
                quote['quoteId'] = content_hash(quote)
                observations.append(quote)
    return observations, rejected


def evaluate_splits(observations: list[dict]) -> tuple[list[dict], list[dict]]:
    """Conservative grouping. Repeated equal quotes retain all provenance."""
    candidates, refusals = [], []
    for stem in sorted({quote['stem'] for quote in observations}):
        selected = [quote for quote in observations if quote['stem'] == stem]
        refusal = {'stem': stem, 'quoteIds': [quote['quoteId'] for quote in selected]}
        if any(quote['stage'] not in ({'PD'} if quote['inputRole'] == 'PD' else {'RD', 'UNRESOLVED'})
               or (quote['stage'] == 'UNRESOLVED' and quote.get('manifestStage') != 'RD_ID_MIXED')
               for quote in selected):
            refusals.append({**refusal, 'reason': 'SOURCE_ROLE_STAGE_UNVERIFIED'}); continue
        if any(len({q['fileId'] for q in selected if q['inputRole'] == role}) > 1 for role in ['PD', 'RD']):
            refusals.append({**refusal, 'reason': 'AMBIGUOUS_SOURCE'}); continue
        groups: dict[tuple[str, str], list[dict]] = {}
        for quote in selected:
            groups.setdefault((quote['inputRole'], quote['system']), []).append(quote)
        if any(len({(q['airflowM3PerHour'], q['freePressurePa']) for q in quotes}) != 1 for quotes in groups.values()):
            refusals.append({**refusal, 'reason': 'CONFLICTING_TAG_VALUES'}); continue
        if any(q['suffix'] is not None for q in selected if q['inputRole'] == 'PD'):
            refusals.append({**refusal, 'reason': 'AMBIGUOUS_PD_BASELINE_CONFIGURATION'}); continue
        if any(q['suffix'] is None for q in selected if q['inputRole'] == 'RD'):
            refusals.append({**refusal, 'reason': 'AMBIGUOUS_RD_UNSPLIT_CONFIGURATION'}); continue
        pd = groups.get(('PD', stem), [])
        rd = [quotes for (role, _), quotes in groups.items() if role == 'RD']
        if not pd:
            refusals.append({**refusal, 'reason': 'PD_BASELINE_MISSING'}); continue
        if len(rd) < 2:
            refusals.append({**refusal, 'reason': 'RD_SPLIT_MEMBERS_MISSING'}); continue
        if len(rd) > 64:
            refusals.append({**refusal, 'reason': 'RD_SPLIT_MEMBER_LIMIT'}); continue
        rd.sort(key=lambda quotes: int(quotes[0]['suffix']))
        with localcontext() as context:
            context.prec = 80
            total = sum((Decimal(quotes[0]['airflowM3PerHour']) for quotes in rd), Decimal(0))
        if total != Decimal(pd[0]['airflowM3PerHour']):
            refusals.append({**refusal, 'reason': 'AGGREGATE_FLOW_MISMATCH', 'rdAggregateFlowM3PerHour': decimal_text(total)}); continue
        def member(quotes: list[dict]) -> dict:
            first = quotes[0]  # All values were required equal; retain EVERY original quote.
            return {'system': first['system'], 'airflowM3PerHour': first['airflowM3PerHour'],
                    'freePressurePa': first['freePressurePa'], 'quoteIds': [quote['quoteId'] for quote in quotes],
                    'sourceQuotes': quotes}
        candidates.append({'status': 'SOURCE_ONLY_SPLIT_CANDIDATE', 'stem': stem,
                           'pdBaseline': member(pd), 'rdMembers': [member(quotes) for quotes in rd],
                           'pdDeclaredFlowM3PerHour': pd[0]['airflowM3PerHour'],
                           'rdAggregateFlowM3PerHour': decimal_text(total), 'exactAggregateFlowEqual': True,
                           'aggregateMeaning': 'CORROBORATION_ONLY', 'humanPairIdentity': 'UNVERIFIED',
                           'samePhysicalSystemEstablished': False, 'approvedChangeStatus': 'UNVERIFIED',
                           'matrixFinding': False, 'violationEstablished': False, 'numericReductionEstablished': False,
                           'p': None, 'calibratedProbability': None, 'probabilityStatus': 'NOT_ESTIMABLE',
                           'pageStagesVerified': all(q['stage'] in {'PD', 'RD'} for q in selected),
                           'stageReason': 'PAGE_STAGE_UNVERIFIED' if any(q['stage'] == 'UNRESOLVED' for q in selected) else None})
    return candidates, refusals


def build_report(manifest: Path, inputs: list[SourceInput], expected_manifest_sha256: str) -> dict:
    verified, artifacts = verify_inputs(manifest, inputs, expected_manifest_sha256)
    observations, rejected = [], []
    for source, artifact in zip(verified, artifacts):
        accepted, skipped = extract_observations(source, artifact)
        observations.extend(accepted); rejected.extend(skipped)
    candidates, refusals = evaluate_splits(observations)
    report = {'schemaVersion': 'ventilation-system-split-source-probe-v1', 'status': 'OFFLINE_SOURCE_PROBE_COMPLETE',
              'manifestPath': str(manifest.resolve()), 'manifestSha256': expected_manifest_sha256,
              'objectId': verified[0]['objectId'], 'sources': verified, 'observations': observations,
              'rejectedQuotes': rejected, 'candidates': candidates, 'refusedGroups': refusals,
              'inputPolicy': 'PINNED_MANIFEST_WHOLE_ORIGINALS_AND_FULL_CANONICAL_CACHES_NO_LABELS',
              'p': None, 'humanPairIdentity': 'UNVERIFIED', 'matrixFinding': False,
              'limits': 'SOURCE_ONLY_NO_ENTITY_EQUIVALENCE_APPROVAL_OR_VIOLATION',
              'runtime': {'network': 0, 'model': 0, 'OCR': 0, 'database': 0, 'engineImports': 0, 'labelsRead': 0}}
    report['contentHash'] = content_hash(report)
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline-probe', action='store_true', help='explicitly enable this source-only offline probe')
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--expected-manifest-sha256', default=EXPECTED_MANIFEST_SHA256)
    for role in ['pd', 'rd']:
        parser.add_argument(f'--{role}-file-id', required=True)
        parser.add_argument(f'--{role}-original', required=True, type=Path)
        parser.add_argument(f'--{role}-canonical', required=True, type=Path)
        parser.add_argument(f'--expected-{role}-canonical-sha256', required=True)
    parser.add_argument('--output', required=True, type=Path, help='new JSON output; existing files are never overwritten')
    args = parser.parse_args(argv)
    if not args.offline_probe:
        parser.error('--offline-probe is required; this utility emits no matrix finding')
    inputs = [SourceInput(role.upper(), getattr(args, f'{role}_file_id'), getattr(args, f'{role}_original'),
                          getattr(args, f'{role}_canonical'), getattr(args, f'expected_{role}_canonical_sha256'))
              for role in ['pd', 'rd']]
    try:
        if args.output.resolve() in {args.manifest.resolve(), *(p.resolve() for source in inputs for p in [source.original, source.canonical])}:
            raise ProbeError('OUTPUT_INPUT_COLLISION')
        if args.output.exists():
            raise ProbeError('OUTPUT_ALREADY_EXISTS')
        report = build_report(args.manifest, inputs, args.expected_manifest_sha256)
        payload = (json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + '\n').encode()
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('xb') as output:
            output.write(payload)
        print(json.dumps({'status': report['status'], 'output': str(args.output), 'outputSha256': hashlib.sha256(payload).hexdigest(),
                          'contentHash': report['contentHash'], 'observations': len(report['observations']),
                          'candidates': len(report['candidates']), 'refusedGroups': len(report['refusedGroups']),
                          'p': None, 'matrixFinding': False}, ensure_ascii=False))
        return 0
    except (ProbeError, OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps({'status': 'REFUSED', 'reason': str(error)}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
