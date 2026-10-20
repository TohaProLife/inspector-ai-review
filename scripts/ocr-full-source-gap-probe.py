#!/usr/bin/env python3
"""Bounded OCR for every OCR_REQUIRED page of one pinned public native V4 source.

Uses an existing CPU service over the authorized homeserver SSH alias. Does not
start services, install models, alter native artifacts or create matrix facts.
Raw OCR responses, source raster hashes and exact geometry remain separate.
"""
from __future__ import annotations

import argparse
from decimal import Decimal, ROUND_HALF_EVEN
import hashlib
import json
import math
from pathlib import Path
import shlex
import subprocess
import sys
import time


PROFILE_ID = 'ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1'
IMAGE_ID = 'sha256:fa3ea8ae024e7a0a2c00c55b3f404cab68cd6a9fdeaf5238e5c7485cf5a39628'
RENDERER_VERSION = '1.27.2.2'
MAX_PAGES = 12
MAX_PIXELS = 2500000
MIN_AVAILABLE_KIB = 1500000
MAX_RESPONSE_BYTES = 16000000
DEFAULT_PDF_SHA = '0c398d7bca356455568413a6fc3b14044b7e538a902251b80e2a5574d80184fd'
DEFAULT_NATIVE_SHA = '64d86a69aeafcd5c8f27ffbd2ad44060d165b68b387318905392027fbb548aa9'
DEFAULT_MANIFEST_SHA = '853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7'


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1048576), b''):
            h.update(chunk)
    return h.hexdigest()


def content_hash(value) -> str:
    return digest(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode())


def save_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + '\n')


def select_gaps(artifact: dict) -> list[dict]:
    if (artifact.get('schemaVersion') != 'document-text-v4'
            or artifact.get('coordinateSystem') != 'PDF_BOTTOM_LEFT_MILLI_POINTS'
            or type(artifact.get('pageCount')) is not int
            or not isinstance(artifact.get('pages'), list)
            or len(artifact['pages']) != artifact['pageCount']):
        raise ValueError('NATIVE_V4_SCHEMA_OR_PAGE_COUNT_UNVERIFIED')
    gaps = []
    for number, page in enumerate(artifact['pages'], 1):
        if (page.get('pageNumber') != number
                or any(type(page.get(k)) is not int or page[k] <= 0 for k in ['widthMilliPoints', 'heightMilliPoints'])):
            raise ValueError('NATIVE_PAGE_SEQUENCE_UNVERIFIED')
        disposition = page.get('quality', {}).get('disposition')
        if disposition not in {'OCR_REQUIRED', 'TEXT_LAYER_CANDIDATE', 'PARTIAL_TEXT_LAYER'}:
            raise ValueError('NATIVE_QUALITY_UNVERIFIED')
        if disposition == 'OCR_REQUIRED':
            gaps.append(page)
    if len(gaps) > MAX_PAGES:
        raise ValueError('OCR_GAP_PAGE_LIMIT_NO_PREFIX_SAMPLING')
    return gaps


def verify_sources(manifest: Path, pdf: Path, native: Path, manifest_sha: str, pdf_sha: str, native_sha: str):
    for path, expected, name in [(manifest, manifest_sha, 'MANIFEST'), (pdf, pdf_sha, 'SOURCE_PDF'), (native, native_sha, 'NATIVE_V4')]:
        if len(expected) != 64 or any(c not in '0123456789abcdef' for c in expected) or file_sha(path) != expected:
            raise ValueError(name + '_SHA256_MISMATCH')
    if manifest.stat().st_size > 16000000 or native.stat().st_size > 100000000 or pdf.stat().st_size > 100000000:
        raise ValueError('SOURCE_INPUT_SIZE_LIMIT')
    artifact = json.loads(native.read_text())
    gaps = select_gaps(artifact)
    rows = [json.loads(line) for line in manifest.read_text().splitlines() if line.strip()]
    rows = [r for r in rows if r.get('file_id') == artifact.get('sourceFileId')]
    if len(rows) != 1:
        raise ValueError('PUBLIC_SOURCE_MANIFEST_IDENTITY_UNVERIFIED')
    row = rows[0]
    if (row.get('split') != 'TRAIN_PUBLIC' or row.get('distribution_status') != 'INCLUDE'
            or row.get('label_visibility') != 'PUBLIC_TRAIN' or row.get('extension') != '.pdf'
            or row.get('sha256') != pdf_sha or row.get('size_bytes') != pdf.stat().st_size
            or row.get('pdf_pages') != artifact['pageCount'] or artifact.get('inputSha256') != pdf_sha):
        raise ValueError('PUBLIC_SOURCE_MANIFEST_OR_NATIVE_BINDING_UNVERIFIED')
    return artifact, gaps, row


def pixel_box_to_pdf(box: list, dpi: int, width: int, height: int) -> list[int]:
    scale = Decimal(72000) / Decimal(dpi)
    x0, y0, x1, y1 = [int((Decimal(str(v)) * scale).to_integral_value(rounding=ROUND_HALF_EVEN)) for v in box]
    result = [max(0, min(width, x0)), max(0, min(height, height - y1)),
              max(0, min(width, x1)), max(0, min(height, height - y0))]
    if result[0] >= result[2] or result[1] >= result[3]:
        raise ValueError('INVALID_OCR_BOX_AFTER_SOURCE_FRAME_CLAMP')
    return result


def normalize_response(response: dict, raster_width: int, raster_height: int, dpi: int, width: int, height: int) -> list[dict]:
    if (not isinstance(response, dict) or response.get('schemaVersion') != 'document-ai-ocr-response-v1'
            or response.get('profileId') != PROFILE_ID or response.get('script') != 'eslav'
            or not isinstance(response.get('results'), list) or len(response['results']) != 1):
        raise ValueError('PROVIDER_IDENTITY_MISMATCH')
    result = response['results'][0]
    if result.get('width') != raster_width or result.get('height') != raster_height:
        raise ValueError('OCR_RASTER_FRAME_MISMATCH')
    overall = result.get('overall_ocr_res')
    if not isinstance(overall, dict):
        raise ValueError('OCR_ARRAY_LENGTH_MISMATCH')
    texts, scores, boxes = (overall.get(k) for k in ['rec_texts', 'rec_scores', 'rec_boxes'])
    if (not all(isinstance(v, list) for v in [texts, scores, boxes])
            or not len(texts) == len(scores) == len(boxes) or len(texts) > 10000):
        raise ValueError('OCR_ARRAY_LENGTH_MISMATCH')
    lines = []
    for index, (text, score, box) in enumerate(zip(texts, scores, boxes)):
        if (not isinstance(text, str) or len(text) > 12000
                or type(score) not in {float, int} or not math.isfinite(score) or not 0 <= score <= 1):
            raise ValueError('INVALID_OCR_TEXT_OR_SCORE')
        if (not isinstance(box, list) or len(box) != 4
                or any(type(v) not in {int, float} or not math.isfinite(v) for v in box)
                or not 0 <= box[0] < box[2] <= raster_width or not 0 <= box[1] < box[3] <= raster_height):
            raise ValueError('INVALID_OCR_BOX')
        # Paddle can return an empty string for a detected image/footer region.
        # Preserve it in the raw response and count it, never invent a text line.
        if not text.strip():
            continue
        lines.append({'lineIndex': index, 'text': text, 'evidenceKind': 'OCR',
                      'bboxRasterPixels': box, 'bboxMilliPoints': pixel_box_to_pdf(box, dpi, width, height),
                      'coordinateSystem': 'PDF_BOTTOM_LEFT_MILLI_POINTS', 'recognitionScore': score,
                      'recognitionScoreMeaning': 'UNCALIBRATED_OCR_RECOGNITION_SCORE_NOT_ENGINEERING_PROBABILITY',
                      'humanVerified': False, 'factEligible': False, 'absenceProof': False, 'p': None})
    return lines


def render_page(page, native_page: dict, dpi: int) -> tuple[bytes, int, int]:
    import fitz
    if fitz.VersionBind != RENDERER_VERSION:
        raise ValueError('RENDERER_VERSION_MISMATCH')
    width, height = native_page['widthMilliPoints'], native_page['heightMilliPoints']
    # Both native V4 and get_pixmap use the rotated visible page frame. The
    # PDF's raw MediaBox orientation is not the V4 frame on rotated scan pages.
    if page.rotation not in {0, 90, 180, 270} or abs(page.rect.width * 1000 - width) > 1 or abs(page.rect.height * 1000 - height) > 1:
        raise ValueError('SOURCE_NATIVE_FRAME_MISMATCH')
    frame = native_page.get('nativeFrame')
    if frame is not None:
        visible = [Decimal(v) for v in frame.get('visibleBoxPointStrings', [])]
        if (len(visible) != 4 or visible[:2] != [0, 0]
                or abs(visible[2] * 1000 - width) > 1 or abs(visible[3] * 1000 - height) > 1):
            raise ValueError('UNSUPPORTED_NATIVE_VISIBLE_FRAME')
    if math.ceil(page.rect.width * dpi / 72) * math.ceil(page.rect.height * dpi / 72) > MAX_PIXELS:
        raise ValueError('RENDER_PIXEL_LIMIT')
    pix = page.get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72), alpha=False)
    if pix.x != 0 or pix.y != 0 or pix.width * pix.height > MAX_PIXELS:
        raise ValueError('UNSUPPORTED_RASTER_ORIGIN_OR_SIZE')
    return pix.tobytes('png'), pix.width, pix.height


def check_live_gate(snapshot: dict) -> None:
    health = snapshot.get('health', {})
    if snapshot.get('memAvailableKiB', 0) < MIN_AVAILABLE_KIB:
        raise ValueError('HOMESERVER_MEMORY_GATE')
    if (snapshot.get('imageId') != IMAGE_ID or health.get('status') != 'ok'
            or health.get('profileId') != PROFILE_ID or health.get('device') != 'cpu'
            or 'eslav' not in health.get('loadedScripts', [])):
        raise ValueError('EXISTING_CPU_PROVIDER_IDENTITY_OR_LOADED_MODEL_UNVERIFIED')


class ExistingSshCpuProvider:
    """Fixed alias and loopback destination; no tunnel/service/model lifecycle."""
    def remote(self, code: str, payload: bytes = b'', timeout: int = 20) -> bytes:
        result = subprocess.run(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
                                 'homeserver', 'python3 -c ' + shlex.quote(code)],
                                input=payload, capture_output=True, timeout=timeout)
        if result.returncode != 0:
            raise ValueError('EXISTING_PROVIDER_SSH_OR_HTTP_FAILURE:' + result.stderr.decode(errors='replace')[-1500:])
        if len(result.stdout) > MAX_RESPONSE_BYTES:
            raise ValueError('PROVIDER_RESPONSE_SIZE_LIMIT')
        return result.stdout

    def preflight(self) -> dict:
        code = """import json,subprocess,urllib.request
from pathlib import Path
mem={line.split(':')[0]:int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines()}
health=json.load(urllib.request.urlopen('http://127.0.0.1:18084/health',timeout=8))
image=subprocess.check_output(['docker','inspect','inspector-ai-local-model-probe-document-ai-1','--format','{{.Image}}'],text=True).strip()
print(json.dumps({'memAvailableKiB':mem['MemAvailable'],'swapFreeKiB':mem['SwapFree'],'imageId':image,'health':health}))
"""
        value = json.loads(self.remote(code))
        check_live_gate(value)
        return value

    def ocr(self, png: bytes) -> bytes:
        boundary = 'inspector-ocr-gap-v1'
        payload = (f'--{boundary}\r\nContent-Disposition: form-data; name="script"\r\n\r\neslav\r\n--{boundary}\r\n'
                   'Content-Disposition: form-data; name="file"; filename="source-page.png"\r\n'
                   'Content-Type: image/png\r\n\r\n').encode() + png + f'\r\n--{boundary}--\r\n'.encode()
        code = """import sys,urllib.request
data=sys.stdin.buffer.read(10000000)
req=urllib.request.Request('http://127.0.0.1:18084/v1/ocr',data=data,headers={'Content-Type':'multipart/form-data; boundary=inspector-ocr-gap-v1'})
response=urllib.request.urlopen(req,timeout=180).read(16000001)
assert len(response)<=16000000
sys.stdout.buffer.write(response)
"""
        return self.remote(code, payload, 195)


def read_replay_response(directory: Path, receipt: dict) -> bytes:
    data = (directory / 'response.json').read_bytes()
    if len(data) > MAX_RESPONSE_BYTES or digest(data) != receipt['responseSha256']:
        raise ValueError('REPLAY_RESPONSE_SHA256_MISMATCH')
    return data


def run_probe(manifest: Path, pdf: Path, native: Path, output: Path, *,
              manifest_sha: str = DEFAULT_MANIFEST_SHA, pdf_sha: str = DEFAULT_PDF_SHA,
              native_sha: str = DEFAULT_NATIVE_SHA, dpi: int = 144, execute: bool = False,
              replay: Path | None = None, expected_replay_report_sha: str | None = None,
              provider=None) -> dict:
    if dpi not in {120, 144} or (execute and replay is not None):
        raise ValueError('BOUNDED_MODE_OR_DPI_REQUIRED')
    artifact, gaps, row = verify_sources(manifest, pdf, native, manifest_sha, pdf_sha, native_sha)
    if output.exists():
        raise ValueError('OUTPUT_DIRECTORY_ALREADY_EXISTS')
    if any(path.resolve().is_relative_to(output.resolve()) for path in [manifest, pdf, native]):
        raise ValueError('OUTPUT_INPUT_PATH_COLLISION')
    replay_report = None
    if replay is not None:
        if expected_replay_report_sha is None or file_sha(replay / 'report.json') != expected_replay_report_sha:
            raise ValueError('REPLAY_REPORT_SHA256_MISMATCH')
        replay_report = json.loads((replay / 'report.json').read_text())
        if (replay_report['sourcePdfSha256'] != pdf_sha or replay_report['nativeV4Sha256'] != native_sha
                or replay_report['dpi'] != dpi or replay_report['selectedPageNumbers'] != [p['pageNumber'] for p in gaps]):
            raise ValueError('REPLAY_SOURCE_OR_SELECTION_MISMATCH')
        if (not isinstance(replay_report.get('pages'), list)
                or [p.get('pageNumber') for p in replay_report['pages']] != [p['pageNumber'] for p in gaps]):
            raise ValueError('REPLAY_PAGE_SEQUENCE_INCOMPLETE_OR_AMBIGUOUS')
    report = {'schemaVersion': 'full-source-ocr-gap-probe-v1', 'sourceFileId': artifact['sourceFileId'],
              'objectId': row['object_id'], 'manifestSha256': manifest_sha, 'sourcePdfSha256': pdf_sha,
              'nativeV4Sha256': native_sha, 'nativePageCount': artifact['pageCount'], 'dpi': dpi,
              'selectionPolicy': 'ALL_EXACT_OCR_REQUIRED_PAGES_NO_PREFIX_SAMPLING',
              'selectedPageNumbers': [p['pageNumber'] for p in gaps], 'pages': [], 'failures': [],
              'outputAuthority': 'OCR_REVIEW_ONLY_NOT_FACT_OR_ABSENCE_PROOF', 'factEligible': False,
              'nativeArtifactModified': False, 'engineeringQualification': False, 'coverageDelta': 0, 'p': None,
              'runtime': {'newServices': 0, 'modelDownloads': 0, 'labelsRead': 0, 'engineImports': 0,
                          'providerInferenceRequests': 0, 'sequential': True,
                          'mode': 'LIVE_EXISTING_CPU' if execute else 'REPLAY_NO_INFERENCE' if replay else 'PLAN_ONLY',
                          'providerProfile': PROFILE_ID, 'providerImageId': IMAGE_ID,
                          'renderer': 'PyMuPDF-' + RENDERER_VERSION}}
    output.mkdir(parents=True)
    if not execute and replay is None:
        report['status'] = 'PLAN_ONLY_NO_OCR_EXECUTED'
        report['contentHash'] = content_hash(report); save_json(output / 'report.json', report)
        return report
    import fitz
    provider = provider or ExistingSshCpuProvider()
    with fitz.open(pdf) as document:
        if len(document) != artifact['pageCount'] or document.is_encrypted:
            raise ValueError('ORIGINAL_PDF_PAGE_SEQUENCE_UNVERIFIED')
        for page in gaps:
            number = page['pageNumber']; page_dir = output / f'p{number:03d}'; page_dir.mkdir()
            try:
                png, raster_width, raster_height = render_page(document[number - 1], page, dpi)
                (page_dir / 'render.png').write_bytes(png)
                started = time.monotonic()
                if execute:
                    snapshot = provider.preflight(); check_live_gate(snapshot)
                    raw = provider.ocr(png); report['runtime']['providerInferenceRequests'] += 1
                else:
                    old = next(p for p in replay_report['pages'] if p['pageNumber'] == number)
                    if (old['renderSha256'] != digest(png) or old['widthMilliPoints'] != page['widthMilliPoints']
                            or old['heightMilliPoints'] != page['heightMilliPoints']):
                        raise ValueError('REPLAY_RENDER_OR_SOURCE_FRAME_MISMATCH')
                    raw = read_replay_response(replay / f'p{number:03d}', old)
                    snapshot = {'mode': 'REPLAY_NO_LIVE_RESOURCE_CLAIM', 'originalPreflight': old['preflight']}
                (page_dir / 'response.json').write_bytes(raw)
                lines = normalize_response(json.loads(raw), raster_width, raster_height, dpi,
                                           page['widthMilliPoints'], page['heightMilliPoints'])
                evidence = {'pageNumber': number, 'sourceFileId': artifact['sourceFileId'], 'sourcePdfSha256': pdf_sha,
                            'nativeV4Sha256': native_sha, 'nativeDisposition': page['quality']['disposition'],
                            'status': 'OCR_TEXT_FOR_REVIEW' if lines else 'OCR_RETURNED_NO_TEXT_UNRESOLVED',
                            'widthMilliPoints': page['widthMilliPoints'], 'heightMilliPoints': page['heightMilliPoints'],
                            'rasterWidth': raster_width, 'rasterHeight': raster_height, 'dpi': dpi,
                            'pageRotationDegrees': document[number - 1].rotation,
                            'sourceFrameBasis': 'V4_ROTATED_VISIBLE_PAGE_MATCHED_TO_RENDER',
                            'renderSha256': digest(png), 'responseSha256': digest(raw), 'profileId': PROFILE_ID,
                            'providerImageId': IMAGE_ID, 'preflight': snapshot,
                            'wallSeconds': round(time.monotonic() - started, 3), 'lines': lines,
                            'emptyRecognitionsNotPromoted': len(json.loads(raw)['results'][0]['overall_ocr_res']['rec_texts']) - len(lines),
                            'recognitionCompleteness': 'UNVERIFIED',
                            'factEligible': False, 'absenceProof': False, 'p': None}
                save_json(page_dir / 'evidence.json', evidence); report['pages'].append(evidence)
            except (ValueError, OSError, subprocess.SubprocessError, KeyError, TypeError) as error:
                report['failures'].append({'pageNumber': number, 'reason': str(error), 'status': 'UNRESOLVED'})
                # Stop on failure: do not conceal provider/resource trouble by continuing a batch.
                break
            finally:
                save_json(output / 'progress.json', report)
    report['status'] = ('ALL_SELECTED_PAGES_REPLAYED_REVIEW_ONLY' if replay else 'ALL_SELECTED_PAGES_OCR_EXECUTED_REVIEW_ONLY') if len(report['pages']) == len(gaps) else 'INCOMPLETE_OCR_GAPS_UNRESOLVED'
    if file_sha(native) != native_sha or file_sha(pdf) != pdf_sha:
        raise ValueError('SOURCE_CHANGED_DURING_EXECUTION')
    report['contentHash'] = content_hash(report); save_json(output / 'report.json', report)
    return report


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--pdf', type=Path, required=True)
    parser.add_argument('--native-v4', type=Path, required=True)
    parser.add_argument('--expected-manifest-sha256', default=DEFAULT_MANIFEST_SHA)
    parser.add_argument('--expected-pdf-sha256', default=DEFAULT_PDF_SHA)
    parser.add_argument('--expected-native-sha256', default=DEFAULT_NATIVE_SHA)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--dpi', type=int, choices=[120, 144], default=144)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--plan-only', action='store_true')
    mode.add_argument('--execute-ocr', action='store_true')
    mode.add_argument('--replay-dir', type=Path)
    parser.add_argument('--expected-replay-report-sha256')
    args = parser.parse_args(argv)
    try:
        report = run_probe(args.manifest, args.pdf, args.native_v4, args.output_dir,
                           manifest_sha=args.expected_manifest_sha256, pdf_sha=args.expected_pdf_sha256,
                           native_sha=args.expected_native_sha256, dpi=args.dpi, execute=args.execute_ocr,
                           replay=args.replay_dir, expected_replay_report_sha=args.expected_replay_report_sha256)
        print(json.dumps({'status': report['status'], 'selectedPages': report['selectedPageNumbers'],
                          'completedPages': len(report['pages']), 'ocrLines': sum(len(p['lines']) for p in report['pages']),
                          'failures': report['failures'], 'reportSha256': file_sha(args.output_dir / 'report.json'),
                          'factEligible': False, 'p': None}, ensure_ascii=False))
        return 0 if not report['failures'] else 2
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(json.dumps({'status': 'REFUSED', 'reason': str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
