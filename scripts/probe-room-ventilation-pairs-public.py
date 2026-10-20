#!/usr/bin/env python3
"""Explicit offline comparison of source-bound, selected room ventilation tags.

Whole PDFs and full canonical artifacts are SHA checked. Native room/function
quotes are checked against the original PDF as well as the canonical cache.
Graphical tags use an independently pinned MANUAL_VISUAL_TRANSCRIPTION input;
their crop is re-rendered from the PDF, not attributed by a machine or OCR.
This utility reads no labels, imports no engine and emits no engineering finding.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import re
import runpy
import sys
from typing import Any


_BASE = runpy.run_path(str(Path(__file__).with_name('probe-ventilation-system-split-public.py')))
SourceInput = _BASE['SourceInput']
ProbeError = _BASE['ProbeError']
file_sha256 = _BASE['file_sha256']
content_hash = _BASE['content_hash']
EXPECTED_MANIFEST_SHA256 = _BASE['EXPECTED_MANIFEST_SHA256']
_HASH = re.compile(r'[a-f0-9]{64}')
_SYSTEM = re.compile(r'В2\.[1-9][0-9]{0,2}')
_ROOM = re.compile(r'[1-9][0-9]{0,2}')
RENDERER_VERSION = '1.27.2.2'
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BINDINGS = REPOSITORY_ROOT / 'fixtures/real-public-room-pairs-v1/manual-source-bindings.json'
DEFAULT_BINDINGS_SHA256 = 'b36283ee12af2d35e5f42eb583e16daaa2b3c999efcc349ece45b84b835a09d1'


def normalized(text: str) -> str:
    """Whitespace only; no fuzzy names, transliteration or numeric widening."""
    return ' '.join(text.split())


def pdf_box(top_left_box: Any, page_height: int) -> list[int]:
    return [round(top_left_box[0] * 1000), page_height - round(top_left_box[3] * 1000),
            round(top_left_box[2] * 1000), page_height - round(top_left_box[1] * 1000)]


def visual_box(crop: dict, pixel_box: list[int], page_height: int) -> list[int]:
    x, y = crop['clipPt'][:2]
    scale = crop['scale']
    return [x * 1000 + pixel_box[0] * 1000 // scale,
            page_height - (y * 1000 + pixel_box[3] * 1000 // scale),
            x * 1000 + pixel_box[2] * 1000 // scale,
            page_height - (y * 1000 + pixel_box[1] * 1000 // scale)]


def inside(box: list[int], outer: list[int]) -> bool:
    return outer[0] <= box[0] < box[2] <= outer[2] and outer[1] <= box[1] < box[3] <= outer[3]


def _read_bindings(path: Path, expected: str) -> dict:
    if not isinstance(expected, str) or not _HASH.fullmatch(expected):
        raise ProbeError('INVALID_BINDINGS_HASH_ANCHOR')
    data = path.read_bytes()
    if len(data) > 1024 * 1024:
        raise ProbeError('BINDINGS_LIMIT')
    if hashlib.sha256(data).hexdigest() != expected:
        raise ProbeError('BINDINGS_SHA256_MISMATCH')
    value = json.loads(data)
    if (not isinstance(value, dict) or value.get('schemaVersion') != 'room-ventilation-source-bindings-v1'
            or value.get('reviewAuthority') != 'UNAUTHENTICATED_SOURCE_TRANSCRIPTION_ONLY'
            or value.get('entityBindingMethod') != 'MANUAL_DRAWING_SCOPE_PLUS_EXACT_NATIVE_ROOM_NUMBER_AND_FUNCTION'
            or value.get('systemScope') != 'SELECTED_LOCAL_SYSTEM_TAGS_NO_WHOLE_RD_ABSENCE'
            or value.get('declaredScope') != 'selected_V2_series'
            or value.get('completeConfiguration') is not False
            or not isinstance(value.get('records'), list) or not 2 <= len(value['records']) <= 8):
        raise ProbeError('BINDINGS_AUTHORITY_OR_SCOPE_UNVERIFIED')
    return value


class EvidenceReader:
    def __init__(self, sources: list[dict], artifacts: list[dict], inputs: list[SourceInput], evidence_root: Path):
        try:
            import fitz
        except ImportError as exc:
            raise ProbeError('PYMUPDF_REQUIRED') from exc
        if fitz.VersionBind != RENDERER_VERSION:
            raise ProbeError('CROP_RENDERER_VERSION_MISMATCH')
        self.fitz = fitz
        self.root = evidence_root.resolve()
        self.sources = {s['inputRole']: s for s in sources}
        self.artifacts = {s['inputRole']: a for s, a in zip(sources, artifacts)}
        self.stack = ExitStack()
        self.documents, self.renders, self.native_lines = {}, {}, {}
        try:
            for item in inputs:
                doc = self.stack.enter_context(fitz.open(item.original))
                if len(doc) != self.sources[item.role]['pageCount'] or doc.is_encrypted:
                    raise ProbeError('ORIGINAL_PDF_PAGE_SEQUENCE_UNVERIFIED')
                self.documents[item.role] = doc
        except Exception:
            self.stack.close()
            raise

    def close(self):
        self.stack.close()

    def crop(self, role: str, number: int, crop: dict, width: int, height: int) -> dict:
        if not isinstance(crop, dict):
            raise ProbeError('INVALID_CROP_SCOPE')
        clip, scale = crop.get('clipPt'), crop.get('scale')
        if (not isinstance(clip, list) or len(clip) != 4 or any(type(n) is not int for n in clip)
                or not (0 <= clip[0] < clip[2] <= width // 1000 and 0 <= clip[1] < clip[3] <= height // 1000)
                or type(scale) is not int or scale not in {2, 3}
                or (clip[2] - clip[0]) * (clip[3] - clip[1]) * scale * scale > 4000000):
            raise ProbeError('INVALID_CROP_SCOPE')
        rel = crop.get('path')
        if not isinstance(rel, str) or not rel or Path(rel).is_absolute() or '..' in Path(rel).parts:
            raise ProbeError('CROP_PATH_SCOPE_UNVERIFIED')
        path = (self.root / rel).resolve()
        if not path.is_relative_to(self.root):
            raise ProbeError('CROP_PATH_SCOPE_UNVERIFIED')
        if not isinstance(crop.get('sha256'), str) or not _HASH.fullmatch(crop['sha256']):
            raise ProbeError('INVALID_CROP_HASH_ANCHOR')
        if not path.is_file() or path.stat().st_size > 8 * 1024 * 1024 or file_sha256(path) != crop['sha256']:
            raise ProbeError('CROP_FILE_SHA256_MISMATCH')
        key = role, number, tuple(clip), scale
        if key not in self.renders:
            page = self.documents[role][number - 1]
            if abs(page.rect.width * 1000 - width) > 1 or abs(page.rect.height * 1000 - height) > 1:
                raise ProbeError('ORIGINAL_CANONICAL_PAGE_FRAME_MISMATCH')
            png = page.get_pixmap(matrix=self.fitz.Matrix(scale, scale), clip=self.fitz.Rect(clip), alpha=False).tobytes('png')
            self.renders[key] = hashlib.sha256(png).hexdigest()
        if self.renders[key] != crop['sha256']:
            raise ProbeError('SOURCE_CROP_RENDER_MISMATCH')
        return {'path': str(path), 'sha256': crop['sha256'], 'clipPt': clip, 'scale': scale,
                'clipCoordinateSystem': 'PDF_TOP_LEFT_POINTS', 'renderProfile': f'PyMuPDF-{RENDERER_VERSION}-RGB-no-alpha',
                'sourceReRenderMatched': True,
                'bboxMilliPoints': [clip[0] * 1000, height - clip[3] * 1000, clip[2] * 1000, height - clip[1] * 1000]}

    def native(self, role: str, page: dict, spec: dict, purpose: str) -> dict:
        try:
            index, line_index = spec['blockIndex'], spec['lineIndex']
            if type(index) is not int or type(line_index) is not int or min(index, line_index) < 0:
                raise ProbeError('CANONICAL_QUOTE_MISMATCH')
            block = page['blocks'][index]
            raw = block['text'].split('\n')[line_index]
            boxes = block['lineBboxesMilliPoints']
            box = boxes[line_index]
            if len(boxes) != len(block['text'].split('\n')) or raw != spec['rawText'] or box != spec['bboxMilliPoints']:
                raise ProbeError('CANONICAL_QUOTE_MISMATCH')
        except (KeyError, IndexError, TypeError) as exc:
            raise ProbeError('CANONICAL_QUOTE_MISMATCH') from exc
        width, height = page['widthMilliPoints'], page['heightMilliPoints']
        if not _BASE['_box'](box, width, height):
            raise ProbeError('CANONICAL_QUOTE_GEOMETRY_UNVERIFIED')
        key = role, page['pageNumber']
        if key not in self.native_lines:
            lines = []
            for item in self.documents[role][page['pageNumber'] - 1].get_text('dict')['blocks']:
                for line in item.get('lines', []):
                    lines.append((normalized(''.join(span['text'] for span in line['spans'])), pdf_box(line['bbox'], height)))
            self.native_lines[key] = lines
        def matches(text: str, actual: list[int]) -> bool:
            return text == normalized(raw) and max(abs(a - b) for a, b in zip(actual, box)) <= 2000
        if not any(matches(text, actual) for text, actual in self.native_lines[key]):
            raise ProbeError('ORIGINAL_NATIVE_QUOTE_UNVERIFIED')
        source = self.sources[role]
        quote = {'evidenceKind': 'NATIVE_TEXT_LAYER', 'purpose': purpose,
                 'fileId': source['fileId'], 'sourceSha256': source['originalSha256'],
                 'canonicalSha256': source['canonicalSha256'], 'physicalPage': page['pageNumber'],
                 'blockIndex': index, 'lineIndex': line_index, 'rawText': raw, 'rawBlockText': block['text'],
                 'bboxMilliPoints': box, 'coordinateSystem': 'PDF_BOTTOM_LEFT_MILLI_POINTS',
                 'originalNativeTextAndGeometryMatched': True}
        quote['quoteId'] = content_hash(quote)
        return quote

    def visual(self, role: str, page: dict, spec: dict, crop: dict, purpose: str) -> dict:
        pixel = spec.get('cropPixelBox')
        clip, scale = crop['clipPt'], crop['scale']
        crop_width, crop_height = (clip[2] - clip[0]) * scale, (clip[3] - clip[1]) * scale
        if (not _BASE['_box'](pixel, crop_width, crop_height)
                or spec.get('bboxMilliPoints') != visual_box(crop, pixel, page['heightMilliPoints'])
                or not isinstance(spec.get('rawText'), str) or not spec['rawText'].strip()):
            raise ProbeError('VISUAL_QUOTE_SCOPE_MISMATCH')
        source = self.sources[role]
        quote = {'evidenceKind': 'MANUAL_VISUAL_TRANSCRIPTION', 'purpose': purpose,
                 'fileId': source['fileId'], 'sourceSha256': source['originalSha256'],
                 'canonicalSha256': source['canonicalSha256'], 'physicalPage': page['pageNumber'],
                 'rawText': spec['rawText'], 'bboxMilliPoints': spec['bboxMilliPoints'],
                 'coordinateSystem': 'PDF_BOTTOM_LEFT_MILLI_POINTS', 'cropPixelBox': pixel,
                 'cropSha256': crop['sha256'], 'crop': crop,
                 'transcriptionAuthority': 'UNAUTHENTICATED_SOURCE_TRANSCRIPTION_ONLY',
                 'automaticallyRecognized': False, 'transcriptionTextMachineVerified': False}
        quote['quoteId'] = content_hash(quote)
        return quote

    def binding(self, record: dict) -> dict:
        role, number = record['inputRole'], record.get('physicalPage')
        source, artifact = self.sources[role], self.artifacts[role]
        if (record.get('fileId') != source['fileId'] or record.get('sourceSha256') != source['originalSha256']
                or record.get('canonicalSha256') != source['canonicalSha256']
                or type(number) is not int or not 1 <= number <= source['pageCount']):
            raise ProbeError('BINDING_SOURCE_IDENTITY_MISMATCH')
        if record.get('revisionStatus') != 'UNVERIFIED':
            raise ProbeError('UNAUTHENTICATED_REVISION_CLAIM')
        page = artifact['pages'][number - 1]
        width, height = page['widthMilliPoints'], page['heightMilliPoints']
        if record.get('pageWidthMilliPoints') != width or record.get('pageHeightMilliPoints') != height:
            raise ProbeError('BINDING_PAGE_FRAME_MISMATCH')
        crop = self.crop(role, number, record.get('crop'), width, height)
        plan = self.native(role, page, record.get('planRoomLabel'), 'ROOM_PLAN_LABEL')
        room = record['roomId']
        if not inside(plan['bboxMilliPoints'], crop['bboxMilliPoints']):
            raise ProbeError('ROOM_LABEL_OUTSIDE_SELECTED_CROP')
        label = normalized(plan['rawText'])
        if not (label == room or label.startswith(room + ' ')):
            raise ProbeError('ROOM_NUMBER_BINDING_MISMATCH')
        # An explicit selected scope may contain neighbors, but cannot contain two occurrences of this room label.
        duplicates = []
        for block in page['blocks']:
            for raw, box in zip(block['text'].split('\n'), block.get('lineBboxesMilliPoints', [])):
                text = normalized(raw)
                if (text == room or text.startswith(room + ' ')) and inside(box, crop['bboxMilliPoints']):
                    duplicates.append((raw, box))
        if len(duplicates) != 1:
            raise ProbeError('AMBIGUOUS_PLAN_ROOM_LABEL')
        specs = record.get('roomNameQuotes')
        if not isinstance(specs, list) or not 1 <= len(specs) <= 2:
            raise ProbeError('ROOM_FUNCTION_BINDING_UNVERIFIED')
        names = [self.native(role, page, spec, 'ROOM_FUNCTION') for spec in specs]
        if record.get('roomNameKind') == 'INLINE_ROOM_NAME' and len(names) == 1:
            raw = normalized(names[0]['rawText'])
            if not raw.startswith(room + ' '):
                raise ProbeError('ROOM_FUNCTION_BINDING_UNVERIFIED')
            function = raw[len(room) + 1:]
        elif record.get('roomNameKind') == 'EXPLICIT_EXPLICATION_ROW' and len(names) == 2:
            number_quote, name_quote = names
            a, b = number_quote['bboxMilliPoints'], name_quote['bboxMilliPoints']
            if (normalized(number_quote['rawText']) != room or not 0 <= b[0] - a[2] <= 100000
                    or min(a[3], b[3]) <= max(a[1], b[1])):
                raise ProbeError('ROOM_FUNCTION_BINDING_UNVERIFIED')
            function = normalized(name_quote['rawText'])
        else:
            raise ProbeError('ROOM_FUNCTION_BINDING_UNVERIFIED')
        if not function or len(function) > 256:
            raise ProbeError('ROOM_FUNCTION_BINDING_UNVERIFIED')
        systems = record.get('systemQuotes')
        if not isinstance(systems, list) or not 1 <= len(systems) <= 16:
            raise ProbeError('SYSTEM_TRANSCRIPTIONS_REQUIRED')
        quotes = []
        for spec in systems:
            if not isinstance(spec, dict):
                raise ProbeError('SYSTEM_EVIDENCE_KIND_UNVERIFIED')
            if spec.get('kind') == 'NATIVE_TEXT_LAYER':
                quote = self.native(role, page, spec, 'SELECTED_LOCAL_SYSTEM_TAG')
            elif spec.get('kind') == 'MANUAL_VISUAL_TRANSCRIPTION':
                quote = self.visual(role, page, spec, crop, 'SELECTED_LOCAL_SYSTEM_TAG')
            else:
                raise ProbeError('SYSTEM_EVIDENCE_KIND_UNVERIFIED')
            if not _SYSTEM.fullmatch(quote['rawText']):
                raise ProbeError('INVALID_SYSTEM_NAME')
            if not inside(quote['bboxMilliPoints'], crop['bboxMilliPoints']):
                raise ProbeError('QUOTE_OUTSIDE_SELECTED_CROP')
            quotes.append(quote)
        system_names = [q['rawText'] for q in quotes]
        if len(set(system_names)) != len(system_names):
            raise ProbeError('AMBIGUOUS_SYSTEM_TRANSCRIPTION')
        stage_spec = record.get('stageEvidence', {})
        if not isinstance(stage_spec, dict):
            raise ProbeError('PAGE_STAGE_EVIDENCE_REQUIRED')
        if stage_spec.get('kind') == 'NATIVE_TEXT_LAYER':
            stage = self.native(role, page, stage_spec, 'PAGE_STAGE_MARK')
        elif stage_spec.get('kind') == 'MANUAL_VISUAL_TRANSCRIPTION':
            stamp_crop = self.crop(role, number, stage_spec.get('crop'), width, height)
            stage = self.visual(role, page, stage_spec, stamp_crop, 'PAGE_STAGE_MARK')
        else:
            raise ProbeError('PAGE_STAGE_EVIDENCE_REQUIRED')
        if stage['rawText'] != ('П' if role == 'PD' else 'РД'):
            raise ProbeError('SOURCE_PAGE_STAGE_CONFLICT')
        return {'roomId': room, 'roomFunction': function, 'inputRole': role, 'stage': role,
                'stageAuthority': 'SOURCE_PAGE_MARK_ONLY_NOT_APPROVED_EDITION',
                'fileId': source['fileId'], 'sourceSha256': source['originalSha256'],
                'canonicalSha256': source['canonicalSha256'], 'objectId': source['objectId'],
                'manifestStage': source['manifestStage'], 'physicalPage': number,
                'pageWidthMilliPoints': width, 'pageHeightMilliPoints': height,
                'crop': crop, 'planRoomLabel': plan, 'roomNameQuotes': names,
                'systemNames': sorted(system_names, key=lambda name: int(name.split('.')[1])),
                'systemQuotes': quotes, 'stageEvidence': stage,
                'roomSystemAssociation': 'MANUALLY_SELECTED_DRAWING_SCOPE',
                'entityCorrespondenceAuthority': 'UNVERIFIED', 'revisionAuthority': 'UNVERIFIED',
                'declaredScope': 'selected_V2_series', 'completeConfiguration': False}


def build_report(manifest: Path, inputs: list[SourceInput], expected_manifest_sha256: str,
                 bindings_path: Path, expected_bindings_sha256: str, evidence_root: Path) -> dict:
    bindings = _read_bindings(bindings_path, expected_bindings_sha256)
    sources, artifacts = _BASE['verify_inputs'](manifest, inputs, expected_manifest_sha256)
    groups: dict[str, list[dict]] = {}
    for record in bindings['records']:
        if (not isinstance(record, dict) or not isinstance(record.get('roomId'), str)
                or not _ROOM.fullmatch(record['roomId']) or record.get('inputRole') not in {'PD', 'RD'}):
            raise ProbeError('INVALID_ROOM_BINDING')
        groups.setdefault(record['roomId'], []).append(record)
    if len(groups) > 2:
        raise ProbeError('ROOM_SCOPE_LIMIT')
    reader = EvidenceReader(sources, artifacts, inputs, evidence_root)
    candidates, refused, comparisons = [], [], []
    try:
        for room, records in sorted(groups.items(), key=lambda pair: int(pair[0])):
            roles = [r['inputRole'] for r in records]
            if set(roles) != {'PD', 'RD'}:
                refused.append({'roomId': room, 'reason': 'BOTH_SOURCE_ROLES_REQUIRED'}); continue
            if len(records) != 2:
                refused.append({'roomId': room, 'reason': 'AMBIGUOUS_ENTITY_OR_REVISION_BINDING'}); continue
            if any(not isinstance(r.get('revisionAlternatives'), list) or r['revisionAlternatives'] for r in records):
                refused.append({'roomId': room, 'reason': 'AMBIGUOUS_REVISION_SCOPE'}); continue
            pair = {r['inputRole']: reader.binding(r) for r in records}
            pd, rd = pair['PD'], pair['RD']
            if pd['roomFunction'] != rd['roomFunction']:
                refused.append({'roomId': room, 'reason': 'ROOM_FUNCTION_CONFLICT', 'pdEvidence': pd, 'rdEvidence': rd}); continue
            pd_names, rd_names = pd['systemNames'], rd['systemNames']
            comparison = {'roomId': room, 'roomFunction': pd['roomFunction'], 'objectId': pd['objectId'],
                          'status': 'SOURCE_CONFIGURATION_DIFFERENCE_CANDIDATE' if pd_names != rd_names else 'SELECTED_TAG_NAMES_EQUAL',
                          'pdSystemNames': pd_names, 'rdSystemNames': rd_names,
                          'removedSelectedTagNames': [name for name in pd_names if name not in rd_names],
                          'addedSelectedTagNames': [name for name in rd_names if name not in pd_names],
                          'sharedSelectedTagNames': [name for name in pd_names if name in rd_names],
                          'pdEvidence': pd, 'rdEvidence': rd,
                          'declaredScope': 'selected_V2_series', 'completeConfiguration': False,
                          'roomMatch': 'EXACT_SOURCE_ROOM_NUMBER_AND_FUNCTION_MANUAL_SCOPE_ONLY',
                          'automaticRoomSystemAttribution': False, 'physicalEntityIdentityQualified': False,
                          'revisionAuthority': 'UNVERIFIED', 'engineeringQualification': False,
                          'wholeRdAbsenceEstablished': False, 'airflowReductionEstablished': False,
                          'normativeConclusionEstablished': False, 'violationEstablished': False,
                          'matrixFinding': False, 'coverageDelta': 0, 'p': None, 'calibratedProbability': None,
                          'probabilityStatus': 'NOT_ESTIMABLE'}
            comparisons.append(comparison)
            if pd_names != rd_names:
                candidates.append(comparison)
    finally:
        reader.close()
    report = {'schemaVersion': 'room-ventilation-source-pairs-v1', 'status': 'OFFLINE_SOURCE_PROBE_COMPLETE',
              'manifestPath': str(manifest.resolve()), 'manifestSha256': expected_manifest_sha256,
              'bindingsPath': str(bindings_path.resolve()), 'bindingsSha256': expected_bindings_sha256,
              'manualInputAuthority': 'UNAUTHENTICATED_SOURCE_TRANSCRIPTION_ONLY',
              'inputPolicy': 'PINNED_PUBLIC_MANIFEST_WHOLE_PDFS_FULL_CACHES_AND_SOURCE_CROP_TRANSCRIPTIONS_NO_LABELS',
              'objectId': sources[0]['objectId'], 'sources': sources,
              'declaredScope': 'selected_V2_series', 'completeConfiguration': False,
              'comparisons': comparisons, 'candidates': candidates, 'refusedRooms': refused,
              'p': None, 'engineeringQualification': False, 'matrixFinding': False, 'coverageDelta': 0,
              'runtime': {'network': 0, 'model': 0, 'OCR': 0, 'database': 0, 'engineImports': 0, 'labelsRead': 0,
                          'nativeReader': f'PyMuPDF-{RENDERER_VERSION}', 'sourceCropRenderCount': len(reader.renders)}}
    report['contentHash'] = content_hash(report)
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline-probe', action='store_true')
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--expected-manifest-sha256', default=EXPECTED_MANIFEST_SHA256)
    for role in ['pd', 'rd']:
        parser.add_argument(f'--{role}-file-id', required=True)
        parser.add_argument(f'--{role}-original', required=True, type=Path)
        parser.add_argument(f'--{role}-canonical', required=True, type=Path)
        parser.add_argument(f'--expected-{role}-canonical-sha256', required=True)
    parser.add_argument('--bindings', type=Path, default=DEFAULT_BINDINGS)
    parser.add_argument('--expected-bindings-sha256', default=DEFAULT_BINDINGS_SHA256)
    parser.add_argument('--evidence-root', type=Path, default=REPOSITORY_ROOT)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args(argv)
    if not args.offline_probe:
        parser.error('--offline-probe is required; this utility emits source-only candidates')
    inputs = [SourceInput(role.upper(), getattr(args, role + '_file_id'), getattr(args, role + '_original'),
                          getattr(args, role + '_canonical'), getattr(args, 'expected_' + role + '_canonical_sha256'))
              for role in ['pd', 'rd']]
    try:
        protected = {args.manifest.resolve(), args.bindings.resolve(),
                     *(p.resolve() for source in inputs for p in [source.original, source.canonical])}
        if args.output.resolve() in protected:
            raise ProbeError('OUTPUT_INPUT_COLLISION')
        if args.output.exists():
            raise ProbeError('OUTPUT_ALREADY_EXISTS')
        report = build_report(args.manifest, inputs, args.expected_manifest_sha256, args.bindings,
                              args.expected_bindings_sha256, args.evidence_root)
        data = (json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + '\n').encode()
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('xb') as stream:
            stream.write(data)
        print(json.dumps({'status': report['status'], 'output': str(args.output),
                          'outputSha256': hashlib.sha256(data).hexdigest(), 'contentHash': report['contentHash'],
                          'candidates': len(report['candidates']), 'refusedRooms': len(report['refusedRooms']),
                          'declaredScope': report['declaredScope'], 'completeConfiguration': False,
                          'engineeringQualification': False, 'p': None}, ensure_ascii=False))
        return 0
    except (ProbeError, OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps({'status': 'REFUSED', 'reason': str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
