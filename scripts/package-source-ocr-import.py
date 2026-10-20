#!/usr/bin/env python3
"""Package saved source-bound OCR responses. No OCR, network, rendering or execution claim.

The API authenticates the actual V4 parent and derives all lines independently.
This command checks receipt/source byte pins, the complete OCR_REQUIRED page set,
and existing response/raster hashes; render authenticity remains UNVERIFIED.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re

PROFILE = 'ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1'
MAX_BUNDLE_BYTES = 8 * 1024 * 1024
SHA = re.compile(r'[a-f0-9]{64}\Z')


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def read_bounded(path: Path, maximum: int) -> bytes:
    if not path.is_file() or not 0 < path.stat().st_size <= maximum:
        raise ValueError('INPUT_FILE_LIMIT_OR_MISSING')
    with path.open('rb') as stream:
        raw = stream.read(maximum + 1)
    if len(raw) > maximum:
        raise ValueError('INPUT_FILE_LIMIT_OR_CHANGED')
    return raw


def unique(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError('DUPLICATE_JSON_KEY')
        obj[key] = value
    return obj


def load(raw: bytes):
    return json.loads(raw.decode('utf-8'), object_pairs_hook=unique,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError('NONFINITE_JSON')))


def package(probe_dir: Path, native_v4: Path, pdf: Path, expected_report_sha256: str) -> dict:
    if not isinstance(expected_report_sha256, str) or not SHA.fullmatch(expected_report_sha256):
        raise ValueError('EXPECTED_REPORT_SHA256_REQUIRED')
    raw_report = read_bounded(probe_dir / 'report.json', 16 * 1024 * 1024)
    if digest(raw_report) != expected_report_sha256:
        raise ValueError('REPORT_SHA256_MISMATCH')
    report = load(raw_report)
    native_raw = read_bounded(native_v4, 32 * 1024 * 1024)
    pdf_raw = read_bounded(pdf, 64 * 1024 * 1024)
    if digest(native_raw) != report.get('nativeV4Sha256') or digest(pdf_raw) != report.get('sourcePdfSha256'):
        raise ValueError('SOURCE_SHA256_MISMATCH')
    native = load(native_raw)
    if (report.get('schemaVersion') != 'full-source-ocr-gap-probe-v1'
            or report.get('status') not in {'ALL_SELECTED_PAGES_OCR_EXECUTED_REVIEW_ONLY', 'ALL_SELECTED_PAGES_REPLAYED_REVIEW_ONLY'}
            or report.get('failures') != [] or report.get('selectionPolicy') != 'ALL_EXACT_OCR_REQUIRED_PAGES_NO_PREFIX_SAMPLING'
            or native.get('schemaVersion') != 'document-text-v4' or native.get('sourceFileId') != report.get('sourceFileId')
            or native.get('inputSha256') != report.get('sourcePdfSha256')
            or native.get('pageCount') != report.get('nativePageCount')
            or type(native.get('pageCount')) is not int or not 1 <= native['pageCount'] <= 1024
            or not isinstance(native.get('pages'), list) or len(native['pages']) != native['pageCount']):
        raise ValueError('COMPLETE_SOURCE_BOUND_REPORT_REQUIRED')
    gaps = []
    for ordinal, page in enumerate(native['pages'], 1):
        if type(page.get('pageNumber')) is not int or page['pageNumber'] != ordinal:
            raise ValueError('NATIVE_PAGE_SEQUENCE_MISMATCH')
        if page['quality']['disposition'] == 'OCR_REQUIRED':
            gaps.append(page)
    numbers = [p['pageNumber'] for p in gaps]
    if not 1 <= len(gaps) <= 12:
        raise ValueError('EXACT_OCR_GAP_SET_LIMIT')
    if (report.get('selectedPageNumbers') != numbers or not isinstance(report.get('pages'), list)
            or [p.get('pageNumber') for p in report['pages']] != numbers):
        raise ValueError('EXACT_OCR_GAP_SET_REQUIRED')
    pages = []
    for native_page, entry in zip(gaps, report['pages']):
        number = native_page['pageNumber']
        folder = probe_dir / f'p{number:03d}'
        raw = read_bounded(folder / 'response.json', MAX_BUNDLE_BYTES)
        raster = read_bounded(folder / 'render.png', 8 * 1024 * 1024)
        if (digest(raw) != entry.get('responseSha256') or digest(raster) != entry.get('renderSha256')
                or entry.get('sourcePdfSha256') != report['sourcePdfSha256']
                or entry.get('nativeV4Sha256') != report['nativeV4Sha256'] or entry.get('profileId') != PROFILE
                or entry.get('widthMilliPoints') != native_page['widthMilliPoints']
                or entry.get('heightMilliPoints') != native_page['heightMilliPoints']):
            raise ValueError('PAGE_RESPONSE_RASTER_OR_SOURCE_PIN_MISMATCH')
        response = load(raw)
        if (set(response) != {'schemaVersion', 'profileId', 'script', 'results'}
                or response['schemaVersion'] != 'document-ai-ocr-response-v1'
                or response['profileId'] != PROFILE or response['script'] != 'eslav'
                or not isinstance(response['results'], list) or len(response['results']) != 1
                or response['results'][0].get('width') != entry.get('rasterWidth')
                or response['results'][0].get('height') != entry.get('rasterHeight')):
            raise ValueError('OCR_RESPONSE_PROFILE_OR_FRAME_MISMATCH')
        pages.append({'pageNumber': number, 'pdfWidthMilliPoints': native_page['widthMilliPoints'],
                      'pdfHeightMilliPoints': native_page['heightMilliPoints'], 'rasterWidth': entry['rasterWidth'],
                      'rasterHeight': entry['rasterHeight'], 'renderSha256': entry['renderSha256'],
                      'rawResponseJson': raw.decode('utf-8')})
    bundle = {'schemaVersion': 'source-ocr-import-bundle-v1', 'sourceSha256': report['sourcePdfSha256'],
              'profileId': PROFILE, 'pages': pages}
    if len(encode(bundle)) > MAX_BUNDLE_BYTES:
        raise ValueError('BUNDLE_BYTE_LIMIT')
    return bundle


def encode(bundle: dict) -> bytes:
    return json.dumps(bundle, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--probe-dir', type=Path, required=True)
    parser.add_argument('--native-v4', type=Path, required=True)
    parser.add_argument('--pdf', type=Path, required=True)
    parser.add_argument('--expected-report-sha256', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.output.exists():
            raise ValueError('OUTPUT_ALREADY_EXISTS')
        bundle = package(args.probe_dir, args.native_v4, args.pdf, args.expected_report_sha256)
        raw = encode(bundle)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('xb') as stream:
            stream.write(raw)
        print(json.dumps({'status': 'PACKAGED_SAVED_RESPONSES_NOT_EXECUTED', 'output': str(args.output),
                          'byteLength': len(raw), 'sha256': digest(raw), 'pages': [p['pageNumber'] for p in bundle['pages']],
                          'providerExecutionVerified': False, 'renderDerivationVerified': False}))
        return 0
    except (ValueError, OSError, KeyError, TypeError, UnicodeError) as error:
        parser.exit(2, str(error) + '\n')


if __name__ == '__main__':
    raise SystemExit(main())
