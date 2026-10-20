#!/usr/bin/env python3
"""Build a deterministic public real-pair companion from the pinned v3 ZIP.

Only a fixed, SHA-pinned public allowlist is appended. Existing payload bytes are
preserved except README.md, SOURCE_REVISION.txt and SHA256SUMS. No OCR, renderer,
provider, original-PDF execution or source-engine replay is performed here.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BASE_SHA256 = '528ba31d6158b860ee305eb8b744ccb1a1e0f6ddc73a7f4837e9d1d3783c6913'
RD_V4_SHA256 = '64d86a69aeafcd5c8f27ffbd2ad44060d165b68b387318905392027fbb548aa9'
MAX_ZIP_BYTES = 128 * 1024 * 1024
MAX_ENTRY_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 256 * 1024 * 1024
MAX_ENTRIES = 512
MAX_RATIO = 256
REPLACED = frozenset({'README.md', 'SOURCE_REVISION.txt', 'SHA256SUMS'})
# Archive path, exact local public input path, whole-file SHA256. No globbing.
ADDITIONS = (
    ('audits/F0171-native-v4.json', 'output/local-work-20261020/native-capacity-comparison-v1/F0171-document-text-v4.json', '39860d4278f002cfd43a598a97b6b0c4849b38ed6bed2cb5561f820e1e55ef09'),
    ('audits/native-ocr-import-engine-v1/F0201-source-ocr-import-bundle-v1.json', 'output/native-ocr-import-engine-v1/F0201-source-ocr-import-bundle-v1.json', '8806ba05fdace4901010cc3b75a4f9ba46c16eedc37306c70d95cd43399d5d5a'),
    ('audits/native-ocr-import-engine-v1/F0201-source-ocr-import-derived-v1.json', 'output/native-ocr-import-engine-v1/F0201-source-ocr-import-derived-v1.json', 'dfef3dfa207f51b6357c62ecf779355639a5dd470e7576f09f980be50672829d'),
    ('audits/native-ocr-import-engine-v1/READY.json', 'output/native-ocr-import-engine-v1/READY.json', '7e45eb964af221d7520fab3879283bb96bda9c8cfab0300e88cbdbd7c5b34d44'),
    ('audits/native-ocr-import-engine-v1/source-pins.json', 'output/native-ocr-import-engine-v1/source-pins.json', 'd26c2886bb6b50d540531066cccd5122e17f0f12daabb9e6ce54e908e78d0208'),
    ('audits/native-ocr-import-engine-v1/replay-v1.json', 'output/native-ocr-import-engine-v1/replay-v1.json', '61bc3ebd71bd73f46676aa38ac3ab6104be5de7d6a468f5bef3f6c22a1d6a9ab'),
    ('audits/native-capacity-comparison-v1/READY.json', 'output/local-work-20261020/native-capacity-comparison-v1/READY.json', 'e0cb056e93fe28b364ea1a11b17c3a0fdaded068b9add063a97ad37580cf3a29'),
    ('audits/native-capacity-comparison-v1/source-pins.json', 'output/local-work-20261020/native-capacity-comparison-v1/source-pins.json', '95eb7dabc3da60608b6ebd03c71fff3b2ff1aa5dccd211d310bdcba7980efc34'),
    ('audits/native-capacity-comparison-v1/real-engine-result-v1.json', 'output/local-work-20261020/native-capacity-comparison-v1/real-engine-result-v1.json', 'f12e275f4a502c4000770a8b3218cd62d085c61452b1af81b46019ecf6954390'),
    ('audits/native-airflow-engine-v1/native-airflow-engine-ready-v1.json', 'output/local-work-20261020/native-airflow-engine-v1/native-airflow-engine-ready-v1.json', 'c79373d13eb2cde058ff22aa1fae2aecc734c213c6a7171b3cb07b47cfc852bc'),
    ('audits/native-airflow-engine-v1/source-pins.json', 'output/local-work-20261020/native-airflow-engine-v1/source-pins.json', 'd4d07f9c2f3dd0d526a5111c0e203e25bcc3f4cce56bbe7bf5ae91e932c58f96'),
    ('audits/native-airflow-engine-v1/native-airflow-real-result-v1.json', 'output/local-work-20261020/native-airflow-engine-v1/native-airflow-real-result-v1.json', 'bdf6e21cbfa9634a84a5f678feb05082b79c6755c24266a0548eb39f1298543a'),
)


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def safe_name(name: str) -> str:
    if (not isinstance(name, str) or not 1 <= len(name) <= 240
            or not re.fullmatch(r'[A-Za-z0-9._/-]+', name)
            or name.startswith('/') or str(PurePosixPath(name)) != name
            or any(p in {'.', '..', ''} or p.endswith('.') for p in name.split('/'))):
        raise ValueError('UNSAFE_ARCHIVE_PATH')
    for part in name.lower().split('/'):
        stem = part.split('.')[0]
        if (part in {'.git', '.ssh', 'node_modules', 'credentials', 'cookies', 'sessions', 'id_rsa', 'id_ed25519'}
                or part.startswith('.env') or part.endswith(('.key', '.pem', '.p12', '.pfx', '.log', '.sqlite', '.db'))
                or stem in {'con', 'prn', 'aux', 'nul', *(f'com{i}' for i in range(1, 10)), *(f'lpt{i}' for i in range(1, 10))}):
            raise ValueError('SECRET_OR_NONPORTABLE_ARCHIVE_PATH')
    return name


def read_bounded(path: Path, maximum: int) -> bytes:
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError('REGULAR_INPUT_FILE_REQUIRED')
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd, 'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode) or not 0 < os.fstat(stream.fileno()).st_size <= maximum:
            raise ValueError('INPUT_BYTE_LIMIT')
        raw = stream.read(maximum + 1)
    if not raw or len(raw) > maximum:
        raise ValueError('INPUT_BYTE_LIMIT')
    return raw


def checksum_bytes(entries: dict[str, bytes]) -> bytes:
    return ''.join(f'{sha256(entries[name])}  {name}\n' for name in sorted(entries) if name != 'SHA256SUMS').encode('ascii')


def verify_checksums(entries: dict[str, bytes]):
    raw = entries.get('SHA256SUMS', b'')
    if not 0 < len(raw) <= 256 * 1024 or not raw.endswith(b'\n'):
        raise ValueError('CHECKSUM_MANIFEST_REQUIRED')
    listed = {}
    for line in raw.decode('ascii').splitlines():
        match = re.fullmatch(r'([a-f0-9]{64})  ([A-Za-z0-9._/-]+)', line)
        if not match or match[2] in listed:
            raise ValueError('INVALID_CHECKSUM_MANIFEST')
        listed[safe_name(match[2])] = match[1]
    if set(listed) != set(entries) - {'SHA256SUMS'}:
        raise ValueError('CHECKSUM_CLOSURE_MISMATCH')
    if any(sha256(entries[name]) != expected for name, expected in listed.items()):
        raise ValueError('ENTRY_SHA256_MISMATCH')


def read_archive(path: Path, expected_sha256: str) -> dict[str, bytes]:
    raw = read_bounded(path, MAX_ZIP_BYTES)
    if sha256(raw) != expected_sha256:
        raise ValueError('ARCHIVE_SHA256_MISMATCH')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        info = archive.infolist()
        if not 1 <= len(info) <= MAX_ENTRIES:
            raise ValueError('ARCHIVE_ENTRY_LIMIT')
        seen, total = set(), 0
        for item in info:
            if item.orig_filename != item.filename:
                raise ValueError('UNSAFE_ARCHIVE_PATH')
            name = safe_name(item.filename)
            if name.casefold() in seen:
                raise ValueError('DUPLICATE_ARCHIVE_PATH')
            seen.add(name.casefold())
            mode = item.external_attr >> 16
            if item.is_dir() or stat.S_IFMT(mode) not in {0, stat.S_IFREG}:
                raise ValueError('ARCHIVE_REGULAR_FILES_ONLY')
            if item.flag_bits & 1 or item.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
                raise ValueError('UNSUPPORTED_ARCHIVE_ENCODING')
            total += item.file_size
            if not 0 <= item.file_size <= MAX_ENTRY_BYTES or total > MAX_TOTAL_BYTES:
                raise ValueError('ARCHIVE_EXPANSION_LIMIT')
            if item.file_size > max(1, item.compress_size) * MAX_RATIO:
                raise ValueError('ARCHIVE_COMPRESSION_RATIO_LIMIT')
        entries = {}
        for item in info:
            # Reading every member validates its CRC, even entries subsequently replaced.
            with archive.open(item) as stream:
                payload = stream.read(MAX_ENTRY_BYTES + 1)
            if len(payload) != item.file_size:
                raise ValueError('ARCHIVE_ENTRY_SIZE_MISMATCH')
            entries[item.filename] = payload
    verify_checksums(entries)
    return entries


def verify_revision(revision: str, repository: Path = ROOT) -> str:
    if not re.fullmatch(r'[a-f0-9]{40}|[a-f0-9]{64}', revision):
        raise ValueError('FULL_GIT_COMMIT_REQUIRED')
    result = subprocess.run(['git', '-C', str(repository), 'cat-file', '-t', revision],
                            capture_output=True, text=True, timeout=10, check=False)
    if result.returncode != 0 or result.stdout.strip() != 'commit':
        raise ValueError('EXISTING_GIT_COMMIT_REQUIRED')
    return revision


def scan_public_json(raw: bytes):
    raw.decode('utf-8')
    json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('NONFINITE_JSON')))
    if any(re.search(pattern, raw) for pattern in (
        rb'-----BEGIN [A-Z ]*PRIVATE KEY-----', rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
        rb'\bgh[pousr]_[A-Za-z0-9]{24,}\b', rb'\bxox[baprs]-[A-Za-z0-9-]{16,}\b',
        rb'(?i)authorization\s*:\s*bearer\s+[A-Za-z0-9._-]{16,}',
    )):
        raise ValueError('SECRET_PATTERN_IN_ADDITION')


def collect_additions(repository: Path = ROOT) -> dict[str, bytes]:
    additions = {}
    for archive_name, local_name, expected in ADDITIONS:
        safe_name(archive_name)
        local = repository / local_name
        for parent in local.relative_to(repository).parents:
            if (repository / parent).is_symlink():
                raise ValueError('SYMLINK_ASSET_PARENT')
        raw = read_bounded(local, MAX_ENTRY_BYTES)
        if sha256(raw) != expected:
            raise ValueError(f'ADDITION_SHA256_MISMATCH:{archive_name}')
        scan_public_json(raw)
        additions[archive_name] = raw
    return additions


def readme(previous: bytes, revision: str) -> bytes:
    addition = f'''

## Companion v4: native source engines and separate OCR import

SOURCE ZIP revision: `{revision}`. `SOURCE_REVISION.txt` records this exact
commit; the unchanged v3 payloads retain their original historical receipts.
Current v4 app/engine source and npm dependencies belong in the separate SOURCE
ZIP, not this companion. No local logs, credentials, models or private fixtures
were added. All 12 additions are fixed whole-file SHA-pinned public artifacts.

Verify all companion payloads first, from its extracted root:

```sh
sha256sum -c SHA256SUMS
```

For TypeScript real replay, set COMPANION to the **absolute** extracted companion
path and run from the extracted SOURCE ZIP root with its npm dependencies installed:

```sh
COMPANION=/absolute/path/to/extracted-companion
cd /absolute/path/to/extracted-source
INSPECTOR_NATIVE_CAPACITY_PD_V4="$COMPANION/audits/F0171-native-v4.json" \\
INSPECTOR_NATIVE_CAPACITY_RD_V4="$COMPANION/audits/F0201-native-v4.json" \\
./node_modules/.bin/vitest run apps/api/test/native-capacity-comparison.test.ts --maxWorkers=1
INSPECTOR_NATIVE_AIRFLOW_PD_V4="$COMPANION/audits/F0171-native-v4.json" \\
INSPECTOR_NATIVE_AIRFLOW_RD_V4="$COMPANION/audits/F0201-native-v4.json" \\
./node_modules/.bin/vitest run apps/api/test/native-airflow-comparison.test.ts --maxWorkers=1
INSPECTOR_SOURCE_OCR_IMPORT_BUNDLE="$COMPANION/audits/native-ocr-import-engine-v1/F0201-source-ocr-import-bundle-v1.json" \\
INSPECTOR_SOURCE_OCR_IMPORT_NATIVE_V4="$COMPANION/audits/F0201-native-v4.json" \\
./node_modules/.bin/vitest run apps/api/test/source-ocr-import.test.ts --maxWorkers=1
```

Expected engine checkpoints: capacity 600=600, 30 PD declarations (29 single-line
and one explicit same-block two-line declaration), nine RD declarations; selected
P17 group 9060=3340+5720 with seven complete quotes, repeated declarations not
summed again. OCR import derives 264 nonempty candidates on exactly 12 native gap
pages; eight pages remain UNRESOLVED. The copied READY/pins/result files are
historical pure-engine checkpoints; their diagnostic log references/local paths
are provenance, not required companion paths or a current runtime attestation.

**Limits:** TS engine tests validate whole native artifacts and their pinned
artifact bytes. They do **not** open or authenticate the original PDF bytes, run
the PDF extractor/OCR provider, authenticate a repository run, or verify raster
derivation. `sha256sum -c` checks included PDF byte pins; the unchanged Python
probes above also read/rerender the originals for their explicitly bounded scopes.
The OCR bundle is an external saved-response import: providerExecutionVerified=false,
renderDerivationVerified=false; raster coordinates are never trusted PDF highlights.
Native comparisons remain source-only candidates: p=null, factEligible=false,
coverageDelta=0; no identity/revision/operating-mode/engineering qualification or
absence conclusion. IOS4-079 PUBLIC_MAPPING_CONFLICT stays unresolved. H100 was
not available; no target-GPU execution is claimed.
'''
    return previous + addition.encode('utf-8')


def compose(entries: dict[str, bytes], additions: dict[str, bytes], revision: str) -> dict[str, bytes]:
    if not REPLACED <= entries.keys() or sha256(entries.get('audits/F0201-native-v4.json', b'')) != RD_V4_SHA256:
        raise ValueError('REQUIRED_BASE_PAYLOAD_MISMATCH')
    if set(entries) & set(additions):
        raise ValueError('ADDITION_COLLIDES_WITH_BASE')
    result = {**entries, **additions}
    result['README.md'] = readme(entries['README.md'], revision)
    result['SOURCE_REVISION.txt'] = (revision + '\n').encode('ascii')
    result['SHA256SUMS'] = checksum_bytes(result)
    if len(result) > MAX_ENTRIES or sum(map(len, result.values())) > MAX_TOTAL_BYTES:
        raise ValueError('OUTPUT_ARCHIVE_LIMIT')
    verify_checksums(result)
    return result


def write_archive(entries: dict[str, bytes], output: Path) -> dict:
    if output.exists() or output.is_symlink():
        raise ValueError('OUTPUT_ALREADY_EXISTS')
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix='.companion-', suffix='.tmp', dir=output.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, 'w+b') as stream:
            with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for name in sorted(entries):
                    info = zipfile.ZipInfo(safe_name(name), (1980, 1, 1, 0, 0, 0))
                    info.create_system = 3
                    info.external_attr = (stat.S_IFREG | 0o644) << 16
                    archive.writestr(info, entries[name], compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
            stream.flush()
            os.fsync(stream.fileno())
        raw = read_bounded(temporary, MAX_ZIP_BYTES)
        archive_sha = sha256(raw)
        verified = read_archive(temporary, archive_sha)
        if verified != entries:
            raise ValueError('OUTPUT_REPLAY_MISMATCH')
        os.chmod(temporary, 0o644)
        os.link(temporary, output)  # Atomic publication, refuses overwrite even under a race.
        return {'status': 'PACKAGED_PUBLIC_COMPANION_V4', 'output': str(output), 'byteLength': len(raw),
                'sha256': archive_sha, 'entries': len(entries), 'uncompressedBytes': sum(map(len, entries.values()))}
    finally:
        temporary.unlink(missing_ok=True)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--base-zip', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.output.exists() or args.output.is_symlink():
            raise ValueError('OUTPUT_ALREADY_EXISTS')
        revision = verify_revision(args.revision)
        base = read_archive(args.base_zip, BASE_SHA256)
        additions = collect_additions()
        result = compose(base, additions, revision)
        receipt = write_archive(result, args.output)
        receipt.update({'revision': revision, 'baseSha256': BASE_SHA256, 'retainedPayloads': len(base) - len(REPLACED),
                        'addedPayloads': len(additions), 'providerExecutionVerified': False, 'renderDerivationVerified': False,
                        'h100Executed': False, 'p': None, 'coverageDelta': 0})
        print(json.dumps(receipt, sort_keys=True))
        return 0
    except (ValueError, OSError, UnicodeError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        parser.exit(2, str(error) + '\n')


if __name__ == '__main__':
    raise SystemExit(main())
