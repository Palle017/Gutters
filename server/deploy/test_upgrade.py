"""Run with python3 -m unittest discover -s server/deploy -p test_upgrade.py."""
import hashlib
from contextlib import closing, ExitStack
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import shutil
import sqlite3
import stat
import subprocess
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('gutters_upgrade', HERE / 'upgrade.py')
upgrade = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(upgrade)
COMMIT = '1' * 40
ORIGINS = {'apiOrigin': 'https://api.example.com:8443', 'websiteOrigin': 'https://wisdomscreen.pro'}

# Frozen PR2 schema read from deployed commit 5d41ea69a440d6d783f68a1a28fafd91c9499ce9.
# Deliberately independent of the current store source so destructive changes cannot
# redefine the legacy fixture to make the migration check pass.
LEGACY_SCHEMA = '''
CREATE TABLE schema_version(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO schema_version(version) VALUES(1);
CREATE TABLE conversations(
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, initial_operation TEXT NOT NULL, initial_hash TEXT NOT NULL,
 name TEXT NOT NULL, phone TEXT NOT NULL, answers_json TEXT NOT NULL,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE quote_details(
 conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),
 address TEXT, size_of_home TEXT, stories INTEGER CHECK(stories IS NULL OR stories IN(1,2)), gutter_length TEXT
);
CREATE TABLE messages(
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), sequence INTEGER NOT NULL CHECK(sequence>0),
 role TEXT NOT NULL CHECK(role IN('guide','customer','owner')), body TEXT NOT NULL, created_at TEXT NOT NULL,
 operation_id TEXT NOT NULL, part INTEGER NOT NULL, UNIQUE(conversation_id,sequence), UNIQUE(conversation_id,operation_id,part)
);
CREATE TABLE operations(
 conversation_id TEXT NOT NULL REFERENCES conversations(id), operation_id TEXT NOT NULL,
 content_hash TEXT NOT NULL, actor TEXT NOT NULL CHECK(actor IN('create','customer','owner')),
 message_id TEXT NOT NULL REFERENCES messages(id), sequence INTEGER NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(conversation_id,operation_id)
);
CREATE TABLE rate_limits(bucket TEXT PRIMARY KEY,window_start INTEGER NOT NULL,count INTEGER NOT NULL);
CREATE INDEX conversations_created ON conversations(created_at DESC,id);
CREATE INDEX messages_conversation ON messages(conversation_id,sequence);
'''


class UpgradeTests(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp(prefix='gutters-upgrade-test-')).resolve()
        self.parent = self.temp.parent.resolve()

    def tearDown(self):
        # Check the final absolute target before recursive Windows cleanup.
        self.assertEqual(self.temp.parent.resolve(), self.parent)
        self.assertTrue(self.temp.name.startswith('gutters-upgrade-test-'))
        self.assertFalse(self.temp.is_symlink())
        def writable_retry(function, path, _error):
            target = Path(path).resolve()
            self.assertTrue(target.is_relative_to(self.temp))
            os.chmod(target, stat.S_IRUSR | stat.S_IWUSR)
            function(path)
        shutil.rmtree(self.temp, onerror=writable_retry)

    def archive(self, extra=None):
        path = self.temp / 'source.tar'
        names = ['server/package.json', 'server/src/server.mjs', 'server/src/app.mjs',
                 'server/src/store.mjs', 'server/src/protocol.mjs', 'server/src/owner-ui.mjs',
                 'server/deploy/public-service.json']
        with tarfile.open(path, 'w', format=tarfile.PAX_FORMAT, pax_headers={'comment': COMMIT}) as bundle:
            for name in names:
                item = tarfile.TarInfo(name)
                content = json.dumps(ORIGINS).encode() if name.endswith('public-service.json') else b'source\n'
                item.size = len(content)
                bundle.addfile(item, io.BytesIO(content))
            if extra:
                bundle.addfile(extra, io.BytesIO(b'x') if extra.size else None)
        return path, hashlib.sha256(path.read_bytes()).hexdigest()

    def test_archive_digest_and_existing_stage_must_match(self):
        archive, digest = self.archive()
        with self.assertRaisesRegex(RuntimeError, 'digest mismatch'):
            upgrade.archive_files(archive, '0' * 64, COMMIT)
        with self.assertRaisesRegex(RuntimeError, 'commit does not match'):
            upgrade.archive_files(archive, digest, '2' * 40)
        files = upgrade.archive_files(archive, digest, COMMIT)
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
                    upgrade.archive_files(archive, digest, COMMIT)
        link = tarfile.TarInfo('server/src/linked.mjs')
        link.type = tarfile.SYMTYPE
        link.linkname = '/etc/gutters/gutters.env'
        archive, digest = self.archive(link)
        with self.assertRaisesRegex(RuntimeError, 'links'):
            upgrade.archive_files(archive, digest, COMMIT)

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

    def test_deployment_origins_must_match_reviewed_contract(self):
        archive, digest = self.archive()
        files = upgrade.archive_files(archive, digest, COMMIT)
        upgrade.validate_origin_contract(files, ORIGINS['apiOrigin'], ORIGINS['websiteOrigin'])
        with self.assertRaisesRegex(RuntimeError, 'do not match'):
            upgrade.validate_origin_contract(files, 'https://another.example.com', ORIGINS['websiteOrigin'])

    def test_space_budget_covers_backup_probe_and_reserve_before_writes(self):
        database = self.temp / 'data.sqlite3'
        releases = self.temp / 'releases'
        releases.mkdir()
        with closing(sqlite3.connect(database)) as db:
            db.execute('CREATE TABLE retained(value TEXT)')
            db.commit()
        needed = 3 * database.stat().st_size + 1234 + upgrade.SPACE_RESERVE
        with patch.object(upgrade.shutil, 'disk_usage', return_value=SimpleNamespace(free=needed - 1)):
            with self.assertRaisesRegex(RuntimeError, 'Insufficient disk space'):
                upgrade.require_free_space(database, releases, 1234)
        with patch.object(upgrade.shutil, 'disk_usage', return_value=SimpleNamespace(free=needed)):
            budget = upgrade.require_free_space(database, releases, 1234)
        self.assertEqual(sum(budget.values()), needed)

    def test_git_archive_pax_header_is_bound_to_real_commit(self):
        fixture = self.temp / 'git-fixture'
        fixture.mkdir()
        archive, digest = self.archive()
        files = upgrade.archive_files(archive, digest, COMMIT)
        for name, content in files.items():
            destination = fixture / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
        def git(*args):
            return subprocess.check_output(['git', '-c', 'core.autocrlf=false',
                                            '-c', 'core.attributesFile=' + os.devnull,
                                            '-C', str(fixture), *args], text=True).strip()
        git('init', '--quiet')
        git('add', '--', 'server')
        git('-c', 'user.name=Gutters QA', '-c', 'user.email=qa@example.invalid',
            '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Synthetic archive fixture')
        commit = git('rev-parse', 'HEAD')
        real_archive = self.temp / 'git-source.tar'
        git('archive', '--format=tar', '--output=' + str(real_archive), commit, 'server')
        real_digest = hashlib.sha256(real_archive.read_bytes()).hexdigest()
        self.assertEqual(upgrade.archive_files(real_archive, real_digest, commit), files)

    def test_signal_handlers_raise_for_cleanup_and_are_restored(self):
        previous = signal.getsignal(signal.SIGTERM)
        with self.assertRaises(upgrade.UpgradeInterrupted):
            with upgrade.interruption_guard():
                signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
        self.assertEqual(signal.getsignal(signal.SIGTERM), previous)
        with upgrade.interruption_guard(ignore=True):
            self.assertEqual(signal.getsignal(signal.SIGTERM), signal.SIG_IGN)
        self.assertEqual(signal.getsignal(signal.SIGTERM), previous)

    def test_running_release_checks_pid_cwd_executable_and_command(self):
        release = self.temp / 'release'
        (release / 'server').mkdir(parents=True)
        proc = self.temp / 'proc'
        (proc / '321').mkdir(parents=True)
        (proc / '321/cmdline').write_bytes(b'/usr/bin/node\0/opt/gutters/current/server/src/server.mjs\0')
        real_resolve = Path.resolve
        def resolve(path, *args, **kwargs):
            if path == self.temp / 'current':
                return release
            return real_resolve(path, *args, **kwargs)
        def readlink(path):
            return str(release / 'server') if path.name == 'cwd' else '/usr/bin/node'
        with patch.object(upgrade, 'PROC_ROOT', proc), patch.object(upgrade, 'BASE', self.temp), \
                patch.object(upgrade.subprocess, 'run', return_value=SimpleNamespace(returncode=0)), \
                patch.object(upgrade.subprocess, 'check_output', return_value='321\n'), \
                patch.object(upgrade.os, 'readlink', side_effect=readlink), patch.object(Path, 'resolve', resolve):
            self.assertEqual(upgrade.verify_running_release(release), 321)
            with patch.object(upgrade.os, 'readlink', return_value=str(self.temp / 'old/server')):
                with self.assertRaisesRegex(RuntimeError, 'working directory'):
                    upgrade.verify_running_release(release)

    def exercise_transaction(self, failure=None):
        data = self.temp / 'data'
        data.mkdir()
        database = data / 'gutters.sqlite3'
        with closing(sqlite3.connect(database)) as db:
            db.execute('CREATE TABLE retained(id INTEGER PRIMARY KEY, value TEXT, photo BLOB)')
            db.execute('INSERT INTO retained VALUES(1, ?, ?)', ('before', b'original-photo'))
            db.commit()
        before = upgrade.database_snapshot(database)
        environment = self.temp / 'gutters.env'
        old_env = b'GUTTERS_OWNER_TOKEN=' + b'A' * 43 + b'\nGUTTERS_PUBLIC_ORIGIN=https://old.example.com\n'
        new_env = old_env.replace(b'https://old.example.com', b'https://new.example.com')
        environment.write_bytes(old_env)
        backup = self.temp / 'backup'
        backup.mkdir()
        old_release, release = self.temp / 'old', self.temp / 'new'
        old_release.mkdir(); release.mkdir()
        active = [old_release]
        transitions = []
        def switch(target):
            active[0] = target
            transitions.append(target)
        first_health = True
        def health():
            nonlocal first_health
            if first_health and active[0] == release:
                first_health = False
                # Simulate a request durably accepted by the new service before the check fails.
                with closing(sqlite3.connect(database)) as db:
                    db.execute('INSERT INTO retained VALUES(2, ?, ?)', ('accepted-during-upgrade', b'new-photo'))
                    db.commit()
                if failure == 'health':
                    raise RuntimeError('Synthetic health readback failure')
                if failure == 'signal':
                    raise upgrade.UpgradeInterrupted('Synthetic SSH hangup')
        def running(target):
            if target == release and failure == 'identity':
                raise RuntimeError('Synthetic stale PID')
            return 200 if target == release else 100
        receipt = {'source_commit': COMMIT, 'backup_verified': True, 'proxy_mode': 'tailscale'}
        real_write = upgrade.atomic_write
        write_failed = False
        def write(destination, content, mode=0o600):
            nonlocal write_failed
            if (failure == 'final_receipt' and not write_failed and destination == backup / 'upgrade-receipt.json'
                    and json.loads(content).get('state') == 'running'):
                write_failed = True
                raise OSError('Synthetic final receipt write failure after deployment receipt')
            return real_write(destination, content, mode)
        with ExitStack() as stack:
            for name, value in [('DATA', data), ('DATABASE', database), ('ENVIRONMENT', environment)]:
                stack.enter_context(patch.object(upgrade, name, value))
            stack.enter_context(patch.object(upgrade, 'sync_directory', return_value=None))
            stack.enter_context(patch.object(upgrade, 'switch_release', side_effect=switch))
            stack.enter_context(patch.object(upgrade, 'current_release', side_effect=lambda: active[0]))
            stack.enter_context(patch.object(upgrade, 'atomic_write', side_effect=write))
            stack.enter_context(patch.object(upgrade, 'health', side_effect=health))
            stack.enter_context(patch.object(upgrade, 'verify_running_release', side_effect=running))
            restart = stack.enter_context(patch.object(upgrade.subprocess, 'run', return_value=SimpleNamespace(returncode=0)))
            if failure:
                with self.assertRaisesRegex(RuntimeError, 'prior code/configuration restored'):
                    upgrade.apply_update(old_release, release, old_env, new_env, receipt, before, backup)
                self.assertEqual(environment.read_bytes(), old_env)
                self.assertEqual(active[0], old_release)
                self.assertEqual(transitions, [release, old_release])
                self.assertEqual(receipt['state'], 'rolled_back')
                self.assertFalse(receipt['database_restored'])
                deployed = json.loads((data / 'deployment.json').read_text())
                self.assertEqual(deployed['state'], 'rolled_back')
                self.assertEqual(deployed['source_commit'], old_release.name)
                self.assertEqual(deployed['active_source_commit'], old_release.name)
                self.assertEqual(deployed['attempted_source_commit'], COMMIT)
                self.assertEqual(deployed['proxy_mode'], 'false')
                self.assertEqual(deployed['attempted_proxy_mode'], 'tailscale')
                self.assertEqual(restart.call_count, 2)
            else:
                upgrade.apply_update(old_release, release, old_env, new_env, receipt, before, backup)
                self.assertEqual(environment.read_bytes(), new_env)
                self.assertEqual(active[0], release)
                self.assertEqual(receipt['state'], 'running')
                self.assertEqual(receipt['running_pid'], 200)
                self.assertEqual(json.loads((data / 'deployment.json').read_text())['state'], 'running')
                self.assertEqual(restart.call_count, 1)
            for call in restart.call_args_list:
                self.assertEqual(call.args[0], ['systemctl', 'restart', 'gutters.service'])
        with closing(sqlite3.connect(database)) as db:
            self.assertEqual(db.execute('SELECT * FROM retained ORDER BY id').fetchall(),
                             [(1, 'before', b'original-photo'), (2, 'accepted-during-upgrade', b'new-photo')])
        self.assertEqual(json.loads((backup / 'upgrade-receipt.json').read_text())['state'], receipt['state'])

    def test_switch_orchestration_and_receipts(self):
        self.exercise_transaction()

    def test_health_failure_rolls_back_code_but_keeps_new_writes(self):
        self.exercise_transaction('health')

    def test_wrong_running_release_rolls_back_without_data_restore(self):
        self.exercise_transaction('identity')

    def test_ssh_interruption_rolls_back_without_losing_accepted_writes(self):
        self.exercise_transaction('signal')

    def test_final_receipt_failure_rewrites_deployment_receipt_to_active_old_release(self):
        self.exercise_transaction('final_receipt')

    def test_concurrent_release_change_is_rejected_before_any_configuration_write(self):
        environment = self.temp / 'gutters.env'
        environment.write_bytes(b'unchanged')
        with patch.object(upgrade, 'ENVIRONMENT', environment), \
                patch.object(upgrade, 'current_release', return_value=self.temp / 'someone-elses-release'), \
                patch.object(upgrade, 'atomic_write') as write:
            with self.assertRaisesRegex(RuntimeError, 'active release changed'):
                upgrade.apply_update(self.temp / 'old', self.temp / 'new', b'unchanged', b'new', {}, {}, self.temp)
            write.assert_not_called()
        self.assertEqual(environment.read_bytes(), b'unchanged')

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
        with closing(sqlite3.connect(source)) as db:
            db.executescript(LEGACY_SCHEMA)
            db.execute('INSERT INTO conversations VALUES (?,?,?,?,?,?,?,?,?,?)',
                       ('test-id', 'hash', 'operation', 'hash2', 'SYNTHETIC QA', '5550100123',
                        '[]', '2026-10-26T00:00:00Z', '2027-01-24T00:00:00Z', None))
            db.execute('INSERT INTO quote_details VALUES (?,?,?,?,?)', ('test-id', 'SYNTHETIC QA', None, 1, None))
            db.execute('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)',
                       ('message-id', 'test-id', 1, 'customer', 'SYNTHETIC retained request', '2026-10-26T00:00:00Z', 'operation', 1))
            db.execute('INSERT INTO operations VALUES (?,?,?,?,?,?,?)',
                       ('test-id', 'operation', 'hash2', 'create', 'message-id', 1, '2026-10-26T00:00:00Z'))
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
