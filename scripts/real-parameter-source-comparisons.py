#!/usr/bin/env python3
"""Two opt-in source comparisons; no V13/runtime imports or engineering verdict.

PZ-013: declared school seats. IOS4-079: selected P17 declared flow group.
Reuses existing ventilation extraction and OCR replay geometry implementations.
Whole public originals, full caches and immutable review-only OCR are required.
"""
from __future__ import annotations

import argparse
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import runpy
import sys

DEFAULT_BINDINGS_SHA256 = 'd2d63b9c161605c192a75c4119d91edbe23e4e9ca879511a1d09c2aed64d50b7'
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BINDINGS = ROOT / 'fixtures/real-parameter-source-comparisons-v1/source-bindings.json'
CAPACITY = re.compile(r'\bшкола\s+на\s+([1-9][0-9]{0,5})\s+мест\b', re.IGNORECASE)


class ComparisonError(ValueError):
    pass


def file_sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1048576), b''):
            h.update(chunk)
    return h.hexdigest()


def pinned_json(path: Path, expected: str, name: str, limit: int = 128000000):
    if (not isinstance(expected, str) or re.fullmatch(r'[a-f0-9]{64}', expected) is None
            or path.stat().st_size > limit or file_sha(path) != expected):
        raise ComparisonError(name + '_SHA256_OR_SIZE_MISMATCH')
    return json.loads(path.read_text())


def tool(path: Path, expected: str):
    if file_sha(path) != expected:
        raise ComparisonError('REUSED_IMPLEMENTATION_SHA256_MISMATCH')
    return runpy.run_path(str(path))


def box_valid(box, page: dict) -> bool:
    return (isinstance(box, list) and len(box) == 4 and all(type(v) is int for v in box)
            and 0 <= box[0] < box[2] <= page['widthMilliPoints']
            and 0 <= box[1] < box[3] <= page['heightMilliPoints'])


def native_quotes(artifact: dict, role: str) -> list[dict]:
    """Every explicit school declaration, retaining all repeats and geometry."""
    quotes = []
    for page in artifact['pages']:
        if 'blocks' in page:
            for bi, block in enumerate(page['blocks']):
                lines = block['text'].split('\n'); boxes = block.get('lineBboxesMilliPoints', [])
                for li, raw in enumerate(lines):
                    if not CAPACITY.search(raw):
                        continue
                    if len(boxes) != len(lines) or not box_valid(boxes[li], page):
                        raise ComparisonError('SCHOOL_NATIVE_EXACT_LINE_BBOX_UNVERIFIED')
                    quotes.append({'physicalPage': page['pageNumber'], 'blockIndex': bi, 'lineIndex': li,
                                   'rawText': raw, 'bboxMilliPoints': boxes[li], 'inputRole': role,
                                   'evidenceKind': 'TEXT_LAYER'})
        else:
            for li, line in enumerate(page['locatedLines']):
                if CAPACITY.search(line['rawText']):
                    if not box_valid(line['bboxMilliPoints'], page):
                        raise ComparisonError('SCHOOL_NATIVE_EXACT_LINE_BBOX_UNVERIFIED')
                    quotes.append({'physicalPage': page['pageNumber'], 'locatedLineIndex': li,
                                   'sourcePath': line['sourcePath'], 'rawText': line['rawText'].rstrip('\n'),
                                   'bboxMilliPoints': line['bboxMilliPoints'], 'inputRole': role,
                                   'evidenceKind': 'TEXT_LAYER'})
    return quotes


def require_anchor(quotes: list[dict], anchor: dict) -> dict:
    keys = ['physicalPage', 'lineIndex'] + (['blockIndex'] if 'blockIndex' in anchor else [])
    selected = [q for q in quotes if all(q.get(k) == anchor[k] for k in keys)]
    if len(selected) != 1:
        raise ComparisonError('EXACT_SOURCE_ANCHOR_MISSING_OR_AMBIGUOUS')
    if any(selected[0][k] != anchor[k] for k in ['rawText', 'bboxMilliPoints']):
        raise ComparisonError('SOURCE_ANCHOR_TEXT_OR_BBOX_MISMATCH')
    return selected[0]


def compare_school(pd: list[dict], rd_native: list[dict], rd_ocr: list[dict]) -> dict:
    groups = []
    for quotes in [pd, rd_native, rd_ocr]:
        if not quotes:
            raise ComparisonError('SCHOOL_CAPACITY_EVIDENCE_INCOMPLETE')
        values = set()
        for quote in quotes:
            matches = CAPACITY.findall(quote['rawText'])
            if len(matches) != 1:
                raise ComparisonError('SCHOOL_CAPACITY_ENTITY_AMBIGUOUS')
            values.add(int(matches[0]))
        if len(values) != 1:
            raise ComparisonError('SCHOOL_CAPACITY_DECLARATIONS_CONFLICT')
        groups.append(next(iter(values)))
    if groups[1] != groups[2]:
        raise ComparisonError('SCHOOL_RD_NATIVE_OCR_CONFLICT')
    delta = groups[1] - groups[0]
    return {'parameterCode': 'PZ-013', 'narrowAttribute': 'DECLARED_SCHOOL_SEAT_CAPACITY',
            'status': 'SOURCE_VALUES_COMPARED_REVIEW_ONLY', 'declaredScope': 'school_declared_seat_capacity',
            'unit': 'мест', 'pdValue': groups[0], 'rdValue': groups[1], 'deltaRdMinusPd': delta,
            'comparison': 'DECREASE' if delta < 0 else 'INCREASE' if delta > 0 else 'EQUAL',
            'sourceQuotes': {'PD': pd, 'RD_NATIVE': rd_native, 'RD_OCR': rd_ocr},
            'baseGapRetained': 'COMPOSITE_TRIGGER',
            'remainingScope': 'OTHER_CAPACITY_TYPES_PRODUCTION_POWER_APPROVAL_AND_ENGINEERING_UNQUALIFIED',
            'engineeringQualification': False, 'matrixFinding': False, 'complianceEstablished': False,
            'violationEstablished': False, 'completeConfiguration': False, 'factEligible': False,
            'coverageDelta': 0, 'p': None}


def compare_ventilation(observations: list[dict], binding: dict, evaluator) -> dict:
    selected = [q for q in observations if q['stem'] == binding['stem']]
    candidates, refusals = evaluator(selected)
    if refusals or len(candidates) != 1:
        raise ComparisonError('VENTILATION_SELECTED_GROUP_INCOMPLETE_OR_CONFLICTING:' +
                              ','.join(r['reason'] for r in refusals))
    candidate = candidates[0]
    if [m['system'] for m in candidate['rdMembers']] != binding['requiredRdMembers']:
        raise ComparisonError('VENTILATION_SELECTED_MEMBER_SCOPE_MISMATCH')
    pd = [q for q in selected if q['inputRole'] == 'PD']; rd = [q for q in selected if q['inputRole'] == 'RD']
    require_anchor(pd, binding['pdAnchor'])
    for anchor in binding['rdAnchors']:
        require_anchor(rd, anchor)
    baseline = Decimal(candidate['pdDeclaredFlowM3PerHour'])
    total = Decimal(candidate['rdAggregateFlowM3PerHour'])
    return {'parameterCode': 'IOS4-079', 'narrowAttribute': 'SELECTED_FAN_GROUP_DECLARED_VOLUMETRIC_FLOW',
            'status': 'SOURCE_VALUES_COMPARED_REVIEW_ONLY', 'declaredScope': binding['declaredScope'],
            'unit': 'м³/ч', 'pdValue': str(baseline), 'rdValue': str(total), 'deltaRdMinusPd': str(total - baseline),
            'comparison': 'EQUAL', 'pdBaseline': candidate['pdBaseline'], 'rdMembers': candidate['rdMembers'],
            'exactAggregateFlowEqual': True, 'pressureAggregated': False,
            'sourceOnlySplitCandidate': candidate, 'baseGapRetained': 'PUBLIC_MAPPING_CONFLICT',
            'remainingScope': 'AIR_CHANGE_RATE_ROOM_VOLUME_OPERATING_MODE_EQUIPMENT_IDENTITY_APPROVAL_UNQUALIFIED',
            'airChangeRateEstablished': False, 'samePhysicalSystemEstablished': False,
            'engineeringQualification': False, 'matrixFinding': False, 'complianceEstablished': False,
            'violationEstablished': False, 'completeConfiguration': False, 'factEligible': False,
            'coverageDelta': 0, 'p': None}


def verified_ocr(report: dict, directory: Path, artifact: dict, original: Path, ocr_tool) -> list[dict]:
    """Offline exact replay from original bytes, never invoking the CPU provider."""
    gaps = ocr_tool['select_gaps'](artifact)
    numbers = [p['pageNumber'] for p in gaps]
    if (report.get('status') != 'ALL_SELECTED_PAGES_OCR_EXECUTED_REVIEW_ONLY'
            or report.get('sourceFileId') != artifact['sourceFileId']
            or report.get('sourcePdfSha256') != artifact['inputSha256']
            or report.get('selectedPageNumbers') != numbers
            or [p.get('pageNumber') for p in report.get('pages', [])] != numbers
            or report.get('failures') != [] or report.get('factEligible') is not False
            or report.get('engineeringQualification') is not False or report.get('coverageDelta') != 0
            or report.get('p') is not None or report.get('dpi') not in {120, 144}):
        raise ComparisonError('OCR_SOURCE_SELECTION_OR_AUTHORITY_UNVERIFIED')
    import fitz
    quotes = []
    with fitz.open(original) as document:
        if document.is_encrypted or len(document) != artifact['pageCount']:
            raise ComparisonError('OCR_ORIGINAL_PAGE_SEQUENCE_UNVERIFIED')
        for native, evidence in zip(gaps, report['pages']):
            if (evidence['sourcePdfSha256'] != artifact['inputSha256']
                    or evidence['nativeV4Sha256'] != report['nativeV4Sha256']
                    or evidence['widthMilliPoints'] != native['widthMilliPoints']
                    or evidence['heightMilliPoints'] != native['heightMilliPoints']
                    or evidence.get('factEligible') is not False or evidence.get('absenceProof') is not False
                    or evidence.get('p') is not None):
                raise ComparisonError('OCR_PAGE_SOURCE_OR_AUTHORITY_UNVERIFIED')
            png, width, height = ocr_tool['render_page'](document[native['pageNumber'] - 1], native, report['dpi'])
            page_dir = directory / f"p{native['pageNumber']:03d}"
            if hashlib.sha256(png).hexdigest() != evidence['renderSha256'] or file_sha(page_dir / 'render.png') != evidence['renderSha256']:
                raise ComparisonError('OCR_ORIGINAL_RENDER_SHA256_MISMATCH')
            raw = ocr_tool['read_replay_response'](page_dir, evidence)
            lines = ocr_tool['normalize_response'](json.loads(raw), width, height, report['dpi'],
                                                  native['widthMilliPoints'], native['heightMilliPoints'])
            if lines != evidence['lines']:
                raise ComparisonError('OCR_NORMALIZED_LINES_OR_GEOMETRY_MISMATCH')
            for line in lines:
                if CAPACITY.search(line['text']):
                    quotes.append({'physicalPage': native['pageNumber'], 'lineIndex': line['lineIndex'],
                                   'rawText': line['text'], 'bboxMilliPoints': line['bboxMilliPoints'],
                                   'inputRole': 'RD', 'evidenceKind': 'OCR', 'humanVerified': False,
                                   'recognitionScore': line['recognitionScore'],
                                   'recognitionScoreMeaning': line['recognitionScoreMeaning'],
                                   'renderSha256': evidence['renderSha256'], 'responseSha256': evidence['responseSha256']})
    return quotes


def build_report(*, manifest: Path, pd_pdf: Path, pd_canonical: Path, rd_pdf: Path, rd_canonical: Path,
                 rd_native_v4: Path, ocr_directory: Path, bindings_path: Path = DEFAULT_BINDINGS,
                 expected_bindings_sha: str = DEFAULT_BINDINGS_SHA256) -> dict:
    binding = pinned_json(bindings_path, expected_bindings_sha, 'BINDINGS', 100000)
    if (binding.get('schemaVersion') != 'real-parameter-source-bindings-v1'
            or binding.get('qualification', {}).get('engineeringQualification') is not False
            or binding['qualification'].get('coverageDelta') != 0 or binding['qualification'].get('p') is not None):
        raise ComparisonError('BINDINGS_SCHEMA_OR_AUTHORITY_UNVERIFIED')
    pins = binding['implementationPins']; sources = binding['sources']
    vent = tool(ROOT / 'scripts/probe-ventilation-system-split-public.py', pins['ventilationProbeSha256'])
    ocr = tool(ROOT / 'scripts/ocr-full-source-gap-probe.py', pins['ocrProbeSha256'])
    inputs = [vent['SourceInput'](role, sources[role]['fileId'], pdf, cache, sources[role]['canonicalSha256'])
              for role, pdf, cache in [('PD', pd_pdf, pd_canonical), ('RD', rd_pdf, rd_canonical)]]
    verified, artifacts = vent['verify_inputs'](manifest, inputs, binding['manifestSha256'])
    for record in verified:
        if (record['objectId'] != binding['objectId']
                or record['originalSha256'] != sources[record['inputRole']]['pdfSha256']):
            raise ComparisonError('PINNED_SOURCE_OBJECT_OR_PDF_MISMATCH')
    native, _, row = ocr['verify_sources'](manifest, rd_pdf, rd_native_v4, binding['manifestSha256'],
                                         sources['RD']['pdfSha256'], sources['RD']['nativeV4Sha256'])
    if native['sourceFileId'] != sources['RD']['fileId'] or row['object_id'] != binding['objectId']:
        raise ComparisonError('NATIVE_V4_OBJECT_MISMATCH')
    ocr_report = pinned_json(ocr_directory / 'report.json', sources['RD']['ocrReportSha256'], 'OCR_REPORT')
    if ocr_report.get('nativeV4Sha256') != sources['RD']['nativeV4Sha256']:
        raise ComparisonError('OCR_NATIVE_V4_BINDING_MISMATCH')
    pd_quotes = native_quotes(artifacts[0], 'PD'); rd_quotes = native_quotes(native, 'RD')
    # The legacy full RD cache and current V4 must agree on school declarations.
    rd_legacy = native_quotes(artifacts[1], 'RD')
    rd_ocr = verified_ocr(ocr_report, ocr_directory, native, rd_pdf, ocr)
    for role, quotes in [('PD', pd_quotes), ('RD_NATIVE', rd_quotes), ('RD_NATIVE_LEGACY', rd_legacy), ('RD_OCR', rd_ocr)]:
        for quote in quotes:
            quote.update({'sourceFileId': sources['PD' if role == 'PD' else 'RD']['fileId'],
                          'sourcePdfSha256': sources['PD' if role == 'PD' else 'RD']['pdfSha256'],
                          'artifactSha256': (sources['PD']['canonicalSha256'] if role == 'PD' else
                                            sources['RD']['nativeV4Sha256'] if role == 'RD_NATIVE' else
                                            sources['RD']['canonicalSha256'] if role == 'RD_NATIVE_LEGACY' else
                                            sources['RD']['ocrReportSha256']),
                          'coordinateSystem': 'PDF_BOTTOM_LEFT_MILLI_POINTS'})
    require_anchor(pd_quotes, binding['school']['pdAnchor'])
    for anchor in binding['school']['rdOcrAnchors']:
        require_anchor(rd_ocr, anchor)
    capacity = compare_school(pd_quotes, rd_quotes, rd_ocr)
    legacy_capacity = compare_school(pd_quotes, rd_legacy, rd_ocr)
    if capacity['rdValue'] != legacy_capacity['rdValue']:
        raise ComparisonError('SCHOOL_RD_CACHE_VERSION_CONFLICT')
    observations, rejected = [], []
    for record, artifact in zip(verified, artifacts):
        accepted, refused = vent['extract_observations'](record, artifact)
        observations.extend(accepted); rejected.extend(refused)
    if any(q['stem'] == binding['ventilation']['stem'] for q in rejected):
        raise ComparisonError('VENTILATION_SELECTED_GEOMETRY_INCOMPLETE')
    ventilation = compare_ventilation(observations, binding['ventilation'], vent['evaluate_splits'])
    # Native original text corroborates each selected TEXT_LAYER anchor. Geometry
    # remains the pinned canonical frame; no newer extractor silently replaces it.
    import fitz
    for pdf, anchors in [(pd_pdf, [binding['school']['pdAnchor'], binding['ventilation']['pdAnchor']]),
                         (rd_pdf, binding['ventilation']['rdAnchors'])]:
        with fitz.open(pdf) as document:
            for anchor in anchors:
                page = document[anchor['physicalPage'] - 1]
                if anchor['rawText'] not in page.get_text('text'):
                    raise ComparisonError('ORIGINAL_NATIVE_ANCHOR_NOT_REPRODUCED')
    # Reused legacy candidate includes absolute input paths only in top-level
    # source records, which are deliberately omitted from the portable result.
    result = {'schemaVersion': 'real-parameter-source-comparisons-v1', 'status': 'TWO_SOURCE_COMPARISONS_COMPLETE_REVIEW_ONLY',
              'objectId': binding['objectId'], 'bindingsSha256': expected_bindings_sha,
              'manifestSha256': binding['manifestSha256'], 'sourcePins': sources,
              'implementationPins': pins, 'comparisons': [capacity, ventilation],
              'qualification': binding['qualification'], 'p': None, 'coverageDelta': 0,
              'engineeringQualification': False, 'matrixFinding': False, 'factEligible': False,
              'runtime': {'network': 0, 'newOCR': 0, 'model': 0, 'database': 0, 'engineImports': 0, 'labelsRead': 0},
              'deduplication': 'P17_EXTRACTION_AND_EVALUATION_REUSED_FROM_EXISTING_PROBE'}
    for path, expected in [(pd_pdf, sources['PD']['pdfSha256']), (rd_pdf, sources['RD']['pdfSha256']),
                           (rd_native_v4, sources['RD']['nativeV4Sha256']),
                           (manifest, binding['manifestSha256']), (bindings_path, expected_bindings_sha),
                           (pd_canonical, sources['PD']['canonicalSha256']),
                           (rd_canonical, sources['RD']['canonicalSha256']),
                           (ocr_directory / 'report.json', sources['RD']['ocrReportSha256'])]:
        if file_sha(path) != expected:
            raise ComparisonError('SOURCE_CHANGED_DURING_COMPARISON')
    result['contentHash'] = vent['content_hash'](result)
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline-source-comparisons', action='store_true', required=True)
    for name in ['manifest', 'pd-pdf', 'pd-canonical', 'rd-pdf', 'rd-canonical', 'rd-native-v4', 'ocr-directory', 'output']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--bindings', type=Path, default=DEFAULT_BINDINGS)
    parser.add_argument('--expected-bindings-sha256', default=DEFAULT_BINDINGS_SHA256)
    args = parser.parse_args(argv)
    try:
        if args.output.exists():
            raise ComparisonError('OUTPUT_ALREADY_EXISTS')
        report = build_report(manifest=args.manifest, pd_pdf=args.pd_pdf, pd_canonical=args.pd_canonical,
                              rd_pdf=args.rd_pdf, rd_canonical=args.rd_canonical, rd_native_v4=args.rd_native_v4,
                              ocr_directory=args.ocr_directory, bindings_path=args.bindings,
                              expected_bindings_sha=args.expected_bindings_sha256)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('x') as stream:
            stream.write(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + '\n')
        print(json.dumps({'status': report['status'], 'contentHash': report['contentHash'],
                          'resultSha256': file_sha(args.output), 'comparisons': len(report['comparisons']),
                          'engineeringQualification': False, 'coverageDelta': 0, 'p': None}, ensure_ascii=False))
        return 0
    except (ValueError, OSError, KeyError, TypeError, IndexError) as error:
        print(json.dumps({'status': 'REFUSED', 'reason': str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
