"""Run with python3 -m unittest discover -s server/deploy -p test_upgrade.py."""
import hashlib
from contextlib import closing
import importlib.util
import io
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('gutters_upgrade', HERE / 'upgrade.py')
upgrade = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(upgrade)


class UpgradeTests(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp(prefix='gutters-upgrade-test-')).resolve()
        self.parent = self.temp.parent.resolve()

    def tearDown(self):
        # Check the final absolute target before recursive Windows cleanup.
        self.assertEqual(self.temp.parent.resolve(), self.parent)
        self.assertTrue(self.temp.name.startswith('gutters-upgrade-test-'))
        self.assertFalse(self.temp.is_symlink())
        shutil.rmtree(self.temp)

    def archive(self, extra=None):
        path = self.temp / 'source.tar'
        names = ['server/package.json', 'server/src/server.mjs', 'server/src/app.mjs',
                 'server/src/store.mjs', 'server/src/protocol.mjs', 'server/src/owner-ui.mjs']
        with tarfile.open(path, 'w') as bundle:
            for name in names:
                item = tarfile.TarInfo(name)
                item.size = 7
                bundle.addfile(item, io.BytesIO(b'source\n'))
            if extra:
                bundle.addfile(extra, io.BytesIO(b'x') if extra.size else None)
        return path, hashlib.sha256(path.read_bytes()).hexdigest()

    def test_archive_digest_and_existing_stage_must_match(self):
        archive, digest = self.archive()
        with self.assertRaisesRegex(RuntimeError, 'digest mismatch'):
            upgrade.archive_files(archive, '0' * 64)
        files = upgrade.archive_files(archive, digest)
        release = self.temp / 'release'
        upgrade.stage_release(release, files)
        upgrade.stage_release(release, files)
        (release / 'server/src/app.mjs').write_text('unexpected changed code')
        with self.assertRaisesRegex(RuntimeError, 'differs'):
            upgrade.stage_release(release, files)

    def test_archive_rejects_traversal_runtime_and_links(self):
        for name in ['../outside', '/etc/gutters/gutters.env', 'server/../../outside',
                     'server\\..\\outside', 'server/.env', 'server/data/customer.json',
                     'server/gutters.sqlite3', 'server/owner.key']:
            with self.subTest(name=name):
                entry = tarfile.TarInfo(name)
                entry.size = 1
                archive, digest = self.archive(entry)
                with self.assertRaises(RuntimeError):
                    upgrade.archive_files(archive, digest)
        link = tarfile.TarInfo('server/src/linked.mjs')
        link.type = tarfile.SYMTYPE
        link.linkname = '/etc/gutters/gutters.env'
        archive, digest = self.archive(link)
        with self.assertRaisesRegex(RuntimeError, 'links'):
            upgrade.archive_files(archive, digest)

    def test_environment_preserves_owner_and_unknown_lines(self):
        raw = (b'# Existing deployment\nGUTTERS_OWNER_TOKEN=' + b'A' * 43
               + b'\nUNRELATED_OPTION=keep exactly\nGUTTERS_PUBLIC_ORIGIN=http://127.0.0.1:18965\n')
        replacements = {'GUTTERS_PUBLIC_ORIGIN': 'https://api.example.com:8443',
                        'GUTTERS_ALLOWED_ORIGINS': 'https://wisdomscreen.pro',
                        'GUTTERS_SERVE_SITE': 'false', 'GUTTERS_TRUST_PROXY': 'false'}
        result = upgrade.changed_environment(raw, replacements)
        self.assertIn(b'GUTTERS_OWNER_TOKEN=' + b'A' * 43 + b'\n', result)
        self.assertIn(b'UNRELATED_OPTION=keep exactly\n', result)
        self.assertTrue(result.startswith(b'# Existing deployment\n'))
        self.assertEqual(upgrade.environment_values(result)['GUTTERS_PUBLIC_ORIGIN'],
                         'https://api.example.com:8443')
        with self.assertRaises(RuntimeError):
            upgrade.changed_environment(raw, {**replacements, 'GUTTERS_OWNER_TOKEN': 'replace'})
        with self.assertRaises(RuntimeError):
            upgrade.environment_values(raw + b'GUTTERS_OWNER_TOKEN=duplicate\n')

    def test_https_origin_rejects_credentials_paths_or_plaintext(self):
        self.assertEqual(upgrade.canonical_https('https://api.example.com:8443'),
                         'https://api.example.com:8443')
        for origin in ['http://example.com', 'https://user:secret@example.com',
                       'https://example.com/', 'https://example.com/path',
                       'https://example.com?x=1', 'https://example.com#key',
                       'https://example.com\nGUTTERS_OWNER_TOKEN=injected']:
            with self.subTest(origin=origin), self.assertRaises(RuntimeError):
                upgrade.canonical_https(origin)

    def test_online_backup_captures_committed_wal_and_does_not_overwrite(self):
        source = self.temp / 'live.sqlite3'
        target = self.temp / 'backup.sqlite3'
        with closing(sqlite3.connect(source)) as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE retained (id INTEGER PRIMARY KEY, value TEXT, image BLOB)')
            db.execute('INSERT INTO retained VALUES (1, ?, ?)', ('committed', b'photo-bytes'))
            db.commit()
            self.assertTrue(source.with_name(source.name + '-wal').exists())
            copied = upgrade.online_backup(source, target)
            self.assertEqual(copied, upgrade.database_snapshot(source))
            db.execute('INSERT INTO retained VALUES (2, ?, ?)', ('later', b'new-photo'))
            db.commit()
            self.assertEqual(upgrade.database_snapshot(target)['retained']['rows'], 1)
            self.assertEqual(upgrade.database_snapshot(source)['retained']['rows'], 2)
            with self.assertRaisesRegex(RuntimeError, 'already exists'):
                upgrade.online_backup(source, target)

    def test_current_additive_schema_preserves_pr2_data_on_backup_copy(self):
        source = self.temp / 'live.sqlite3'
        copy = self.temp / 'probe.sqlite3'
        store_path = HERE.parent / 'src/store.mjs'
        schema = store_path.read_text(encoding='utf-8').split('const SCHEMA=`', 1)[1].split('`;', 1)[0]
        legacy = schema.split('CREATE TABLE IF NOT EXISTS photos(', 1)[0]
        with closing(sqlite3.connect(source)) as db:
            db.executescript(legacy)
            db.execute('INSERT INTO conversations VALUES (?,?,?,?,?,?,?,?,?,?)',
                       ('test-id', 'hash', 'operation', 'hash2', 'SYNTHETIC QA', '5550100123',
                        '[]', '2026-10-26T00:00:00Z', '2027-01-24T00:00:00Z', None))
            db.commit()
        before = upgrade.online_backup(source, copy)
        probe = self.temp / 'probe.mjs'
        probe.write_text('import {openStore} from ' + json.dumps(store_path.as_uri())
                         + ';const store=openStore(process.argv[2]);store.close();', encoding='utf-8')
        completed = subprocess.run(['node', str(probe), str(copy)], capture_output=True, text=True)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        migrated = upgrade.database_snapshot(copy)
        for table, fingerprint in before.items():
            self.assertEqual(migrated[table], fingerprint)
        self.assertTrue({'photos', 'estimates', 'feature_operations'} <= migrated.keys())
        self.assertNotIn('photos', upgrade.database_snapshot(source))


if __name__ == '__main__':
    unittest.main()
