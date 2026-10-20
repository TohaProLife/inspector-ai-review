"""Bounded independent synthetic ZIP fixtures; no original/provider/GPU execution."""
import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'package-real-pair-companion.py'
SPEC = importlib.util.spec_from_file_location('package_real_pair_companion', SCRIPT)
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)
sha = lambda raw: hashlib.sha256(raw).hexdigest()
REVISION = '1' * 40


class CompanionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def archive(self, entries=None, *, mode=None, compression=zipfile.ZIP_STORED, duplicates=False):
        entries = dict(entries or {'README.md': b'historical public notes\n', 'SOURCE_REVISION.txt': b'0' * 40 + b'\n',
            'audits/F0201-native-v4.json': b'{"synthetic":true}', 'inputs/public.pdf': b'%PDF-1.4 synthetic fixture\n'})
        if 'SHA256SUMS' not in entries:
            entries['SHA256SUMS'] = ''.join(f'{sha(raw)}  {name}\n' for name, raw in sorted(entries.items())).encode()
        path = self.root / 'base.zip'
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(path, 'w', compression=compression) as archive:
                for name, raw in entries.items():
                    info = zipfile.ZipInfo(name, (2000, 2, 3, 4, 5, 6))
                    info.create_system = 3
                    info.external_attr = (mode or stat.S_IFREG | 0o644) << 16
                    archive.writestr(info, raw, compress_type=compression)
                if duplicates:
                    archive.writestr('README.md', b'duplicate')
        return path, sha(path.read_bytes()), entries

    def test_archive_validates_every_sha_crc_and_payload(self):
        path, digest, expected = self.archive()
        self.assertEqual(MOD.read_archive(path, digest), expected)
        with self.assertRaisesRegex(ValueError, 'ARCHIVE_SHA256_MISMATCH'):
            MOD.read_archive(path, 'f' * 64)

    def test_payload_substitution_with_valid_archive_sha_rejected_by_member_sha(self):
        path, digest, entries = self.archive()
        entries['inputs/public.pdf'] += b' changed'
        path, digest, _ = self.archive(entries)
        with self.assertRaisesRegex(ValueError, 'ENTRY_SHA256_MISMATCH'):
            MOD.read_archive(path, digest)

    def test_crc_corruption_rejected_even_if_outer_sha_recomputed(self):
        path, _, _ = self.archive()
        with zipfile.ZipFile(path) as archive:
            item = archive.getinfo('inputs/public.pdf')
            offset = item.header_offset + 30 + len(item.filename.encode()) + len(item.extra)
        raw = bytearray(path.read_bytes())
        raw[offset] ^= 1
        path.write_bytes(raw)
        with self.assertRaisesRegex(zipfile.BadZipFile, 'CRC'):
            MOD.read_archive(path, sha(raw))

    def test_missing_extra_duplicate_or_ambiguous_checksum_entries_rejected(self):
        _, _, baseline = self.archive()
        for manifest in (b'', baseline['SHA256SUMS'] + baseline['SHA256SUMS'].splitlines(keepends=True)[0],
                baseline['SHA256SUMS'].replace(b'  README.md', b'  unknown.md'),
                baseline['SHA256SUMS'].replace(b'  README.md', b' README.md'),
                baseline['SHA256SUMS'].rstrip(b'\n')):
            entries = {**baseline, 'SHA256SUMS': manifest}
            path, digest, _ = self.archive(entries)
            with self.subTest(manifest=manifest[:70]), self.assertRaises(ValueError):
                MOD.read_archive(path, digest)

    def test_path_traversal_absolute_backslash_control_and_windows_aliases_rejected(self):
        for name in ('../outside', '/root/file', 'inputs/../../outside', 'inputs\\file', 'inputs//file',
                'inputs/./file', 'C:/file', 'inputs/abc\nfile', 'inputs/..../file', 'inputs/file.', 'inputs/NUL.txt', 'inputs/COM1'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                MOD.safe_name(name)
        path, digest, _ = self.archive({'../outside': b'bad'})
        with self.assertRaisesRegex(ValueError, 'UNSAFE_ARCHIVE_PATH'):
            MOD.read_archive(path, digest)

    def test_hidden_nul_in_archive_name_rejected(self):
        path, _, _ = self.archive({'inputs/abc.json': b'{}'})
        raw = path.read_bytes().replace(b'inputs/abc.json', b'inputs/a\x00c.json')
        path.write_bytes(raw)
        with self.assertRaisesRegex(ValueError, 'UNSAFE_ARCHIVE_PATH'):
            MOD.read_archive(path, sha(raw))

    def test_duplicate_and_case_alias_paths_rejected(self):
        for duplicates, entries in ((True, None), (False, {'inputs/file': b'a', 'inputs/FILE': b'b'})):
            path, digest, _ = self.archive(entries, duplicates=duplicates)
            with self.assertRaisesRegex(ValueError, 'DUPLICATE_ARCHIVE_PATH'):
                MOD.read_archive(path, digest)

    def test_archive_symlink_and_directory_metadata_rejected(self):
        for mode in (stat.S_IFLNK | 0o777, stat.S_IFDIR | 0o755, stat.S_IFIFO | 0o644):
            path, digest, _ = self.archive(mode=mode)
            with self.assertRaisesRegex(ValueError, 'ARCHIVE_REGULAR_FILES_ONLY'):
                MOD.read_archive(path, digest)

    def test_byte_entry_total_count_and_compression_bomb_limits(self):
        path, digest, _ = self.archive()
        for field, bound in (('MAX_ZIP_BYTES', 4), ('MAX_ENTRY_BYTES', 4), ('MAX_TOTAL_BYTES', 4), ('MAX_ENTRIES', 1)):
            with self.subTest(field=field), patch.object(MOD, field, bound), self.assertRaises(ValueError):
                MOD.read_archive(path, digest)
        path, digest, _ = self.archive({'audits/repeated.json': b' ' * 1000000}, compression=zipfile.ZIP_DEFLATED)
        with self.assertRaisesRegex(ValueError, 'ARCHIVE_COMPRESSION_RATIO_LIMIT'):
            MOD.read_archive(path, digest)

    def test_non_deflate_compression_rejected(self):
        path, digest, _ = self.archive(compression=zipfile.ZIP_BZIP2)
        with self.assertRaisesRegex(ValueError, 'UNSUPPORTED_ARCHIVE_ENCODING'):
            MOD.read_archive(path, digest)

    def test_secret_names_and_patterns_excluded_but_public_hashes_allowed(self):
        for name in ('inputs/.env', 'inputs/.env.local', '.git/config', 'inputs/private.pem', 'inputs/session.log', 'inputs/credentials'):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'SECRET_OR_NONPORTABLE'):
                MOD.safe_name(name)
        for value in ('-----BEGIN PRIVATE KEY-----', 'AKIA' + 'A' * 16, 'ghp_' + 'A' * 24, 'xoxb-' + 'a' * 20, 'Authorization: Bearer ' + 'a' * 24):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'SECRET_PATTERN_IN_ADDITION'):
                MOD.scan_public_json(json.dumps({'data': value}).encode())
        MOD.scan_public_json(json.dumps({'sha256': 'a' * 64, 'providerExecutionVerified': False}).encode())

    def test_additions_are_exact_allowlist_pinned_and_no_local_symlinks(self):
        root = self.root / 'repo'
        local = root / 'output/public.json'
        local.parent.mkdir(parents=True)
        local.write_bytes(b'{"public":true}')
        row = ('audits/public.json', 'output/public.json', sha(local.read_bytes()))
        with patch.object(MOD, 'ADDITIONS', (row,)):
            self.assertEqual(MOD.collect_additions(root), {'audits/public.json': local.read_bytes()})
            local.write_bytes(b'{"public":false}')
            with self.assertRaisesRegex(ValueError, 'ADDITION_SHA256_MISMATCH'):
                MOD.collect_additions(root)
            local.unlink()
            outside = self.root / 'outside.json'
            outside.write_bytes(b'{"public":true}')
            local.symlink_to(outside)
            with self.assertRaisesRegex(ValueError, 'REGULAR_INPUT_FILE_REQUIRED'):
                MOD.collect_additions(root)
            local.unlink()
            local.parent.rmdir()
            local.parent.symlink_to(outside.parent, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'SYMLINK_ASSET_PARENT'):
                MOD.collect_additions(root)

    def test_compose_preserves_all_old_payload_bytes_except_three_declared_entries(self):
        _, _, base = self.archive()
        with patch.object(MOD, 'RD_V4_SHA256', sha(base['audits/F0201-native-v4.json'])):
            composed = MOD.compose(base, {'audits/new.json': b'{"new":true}'}, REVISION)
            for name, raw in base.items():
                if name not in MOD.REPLACED:
                    self.assertEqual(composed[name], raw)
            self.assertEqual(composed['SOURCE_REVISION.txt'], (REVISION + '\n').encode())
            self.assertTrue(composed['README.md'].startswith(base['README.md']))
            MOD.verify_checksums(composed)
            with self.assertRaisesRegex(ValueError, 'ADDITION_COLLIDES_WITH_BASE'):
                MOD.compose(base, {'README.md': b'overwrite'}, REVISION)
        with self.assertRaisesRegex(ValueError, 'REQUIRED_BASE_PAYLOAD_MISMATCH'):
            MOD.compose(base, {}, REVISION)

    def test_readme_has_portable_source_root_commands_and_honest_boundaries(self):
        text = MOD.readme(b'Original Python probe commands retained\n', REVISION).decode()
        for token in ('INSPECTOR_NATIVE_CAPACITY_PD_V4=', 'INSPECTOR_NATIVE_CAPACITY_RD_V4=', 'INSPECTOR_NATIVE_AIRFLOW_PD_V4=',
                'INSPECTOR_NATIVE_AIRFLOW_RD_V4=', 'INSPECTOR_SOURCE_OCR_IMPORT_BUNDLE=', 'INSPECTOR_SOURCE_OCR_IMPORT_NATIVE_V4=',
                'cd /absolute/path/to/extracted-source', 'do **not** open or authenticate the original PDF bytes',
                'renderDerivationVerified=false', 'coverageDelta=0', 'H100', 'Original Python probe commands retained'):
            self.assertIn(token, text)
        self.assertIn(' \\\nINSPECTOR_NATIVE_CAPACITY_RD_V4=', text)

    def test_zip_bytes_stable_including_order_timestamp_permissions_and_full_manifest(self):
        _, _, entries = self.archive()
        first, second = self.root / 'one.zip', self.root / 'two.zip'
        a = MOD.write_archive(entries, first)
        b = MOD.write_archive(dict(reversed(list(entries.items()))), second)
        self.assertEqual(first.read_bytes(), second.read_bytes())
        self.assertEqual(a['sha256'], b['sha256'])
        with zipfile.ZipFile(first) as archive:
            self.assertEqual(archive.namelist(), sorted(entries))
            for item in archive.infolist():
                self.assertEqual(item.date_time, (1980, 1, 1, 0, 0, 0))
                self.assertEqual(item.external_attr >> 16, stat.S_IFREG | 0o644)
        self.assertEqual(MOD.read_archive(first, a['sha256']), entries)

    def test_output_never_overwritten_and_racing_file_kept_temp_cleaned(self):
        _, _, entries = self.archive()
        output = self.root / 'out.zip'
        output.write_bytes(b'preexisting')
        with self.assertRaisesRegex(ValueError, 'OUTPUT_ALREADY_EXISTS'):
            MOD.write_archive(entries, output)
        self.assertEqual(output.read_bytes(), b'preexisting')
        output.unlink()
        def raced(_source, destination):
            Path(destination).write_bytes(b'concurrent owner')
            raise FileExistsError('raced')
        with patch.object(MOD.os, 'link', side_effect=raced), self.assertRaises(FileExistsError):
            MOD.write_archive(entries, output)
        self.assertEqual(output.read_bytes(), b'concurrent owner')
        self.assertEqual(list(self.root.glob('.companion-*.tmp')), [])

    def test_revision_is_full_existing_commit_and_cli_requires_it(self):
        repository = self.root / 'git'
        repository.mkdir()
        for command in (['git', 'init', '-q', str(repository)], ['git', '-C', str(repository), '-c', 'user.name=Synthetic',
                '-c', 'user.email=synthetic@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'Synthetic portable revision fixture']):
            subprocess.run(command, check=True, capture_output=True, timeout=10)
        commit = subprocess.run(['git', '-C', str(repository), 'rev-parse', 'HEAD'], check=True, capture_output=True, text=True).stdout.strip()
        self.assertEqual(MOD.verify_revision(commit, repository), commit)
        for value in ('HEAD', commit[:7], '--all', 'f' * 40, commit + '\n'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                MOD.verify_revision(value, repository)
        cli = subprocess.run([sys.executable, str(SCRIPT), '--base-zip', 'unused.zip', '--output', str(self.root / 'missing.zip')],
            capture_output=True, text=True, timeout=10)
        self.assertEqual(cli.returncode, 2)
        self.assertIn('--revision', cli.stderr)
        self.assertFalse((self.root / 'missing.zip').exists())


if __name__ == '__main__':
    unittest.main()
