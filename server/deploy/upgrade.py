#!/usr/bin/env python3
"""Upgrade an existing Gutters service without replacing its data or owner key.

Run as root on Ubuntu with a reviewed server-only Git archive. No public ingress,
firewall, DNS, user, or systemd-unit changes are made by this script.
"""
import argparse
from contextlib import closing
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import subprocess
import tarfile
import time
import urllib.request
from urllib.parse import urlsplit
import uuid

BASE = Path('/opt/gutters')
DATA = Path('/var/lib/gutters')
ENVIRONMENT = Path('/etc/gutters/gutters.env')
DATABASE = DATA / 'gutters.sqlite3'
SERVICE = 'gutters.service'
CONFIG_KEYS = {'GUTTERS_PUBLIC_ORIGIN', 'GUTTERS_ALLOWED_ORIGINS',
               'GUTTERS_SERVE_SITE', 'GUTTERS_TRUST_PROXY'}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def canonical_https(value):
    parsed = urlsplit(value)
    require(parsed.scheme == 'https' and parsed.hostname and not parsed.username
            and not parsed.password and not parsed.path and not parsed.query
            and not parsed.fragment and value == 'https://' + parsed.netloc
            and not any(ord(character) <= 32 or ord(character) == 127 for character in value)
            and parsed.netloc == parsed.hostname +
            ((':' + str(parsed.port)) if parsed.port else ''),
            'Use a canonical HTTPS origin, without path, credentials or trailing slash.')
    return value


def environment_values(raw):
    values = {}
    for line in raw.decode('utf-8').splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        require('=' in line, 'Unexpected environment syntax; inspect privately.')
        key, value = line.split('=', 1)
        require(re.fullmatch(r'[A-Z][A-Z0-9_]*', key) and key not in values,
                'Unexpected or duplicate environment key; inspect privately.')
        values[key] = value
    return values


def changed_environment(raw, replacements):
    require(set(replacements) == CONFIG_KEYS, 'Unexpected configuration update.')
    old = environment_values(raw)
    output = []
    remaining = dict(replacements)
    for line in raw.decode('utf-8').splitlines(keepends=True):
        key = line.split('=', 1)[0] if '=' in line else None
        if key in remaining:
            output.append(key + '=' + remaining.pop(key) + '\n')
        else:
            output.append(line)
    if output and not output[-1].endswith(('\n', '\r')):
        output.append('\n')
    output.extend(key + '=' + value + '\n' for key, value in remaining.items())
    updated = ''.join(output).encode('utf-8')
    new = environment_values(updated)
    require(all(new[key] == value for key, value in old.items() if key not in CONFIG_KEYS),
            'An unrelated environment value changed.')
    return updated


def archive_files(archive, expected_digest):
    require(hashlib.sha256(archive.read_bytes()).hexdigest() == expected_digest,
            'Source archive digest mismatch.')
    files = {}
    total = 0
    with tarfile.open(archive, 'r:') as bundle:
        members = bundle.getmembers()
        require(len(members) <= 1000, 'Too many source archive members.')
        names = set()
        for member in members:
            path = PurePosixPath(member.name)
            require(not path.is_absolute() and '..' not in path.parts
                    and '\\' not in member.name and path.parts
                    and path.parts[0] == 'server', 'Unsafe source archive path.')
            require(str(path) not in names, 'Duplicate source archive path.')
            names.add(str(path))
            require(member.isdir() or member.isfile(), 'Archive links or special files are forbidden.')
            require(not any(part in ('data', 'node_modules', '.git', '__pycache__')
                            for part in path.parts)
                    and path.name != '.env' and '.sqlite' not in path.name
                    and not path.name.endswith(('.db', '.pyc', '.pem', '.key')),
                    'Runtime data or credentials are forbidden in the source archive.')
            require(member.size <= 2_000_000, 'Unexpectedly large source file.')
            if member.isfile():
                total += member.size
                require(total <= 20_000_000, 'Source archive is too large.')
                files[str(path)] = bundle.extractfile(member).read()
    required = {'server/package.json', 'server/src/server.mjs', 'server/src/app.mjs',
                'server/src/store.mjs', 'server/src/protocol.mjs', 'server/src/owner-ui.mjs'}
    require(required <= files.keys(), 'The source archive is incomplete.')
    return files


def stage_release(release, files):
    if release.exists():
        require(release.is_dir() and not release.is_symlink(), 'Unexpected release path.')
        actual = set()
        for candidate in release.rglob('*'):
            require(not candidate.is_symlink(), 'A staged release contains a symlink.')
            if candidate.is_file():
                name = candidate.relative_to(release).as_posix()
                require(name in files and candidate.read_bytes() == files[name],
                        'Existing staged source differs from the reviewed archive.')
                actual.add(name)
        require(actual == set(files), 'Existing staged release is incomplete.')
        return
    release.mkdir(mode=0o755)
    for name, content in files.items():
        destination = release / name
        destination.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        with destination.open('xb') as output:
            output.write(content)
        destination.chmod(0o644)


def database_snapshot(path):
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as connection:
        require(connection.execute('PRAGMA integrity_check').fetchall() == [('ok',)],
                'SQLite integrity check failed.')
        require(not connection.execute('PRAGMA foreign_key_check').fetchall(),
                'SQLite foreign-key check failed.')
        tables = {}
        names = connection.execute("SELECT name FROM sqlite_master WHERE type='table' "
                                   "AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
        for (name,) in names:
            quoted = '"' + name.replace('"', '""') + '"'
            rows = connection.execute('SELECT * FROM ' + quoted)
            encoded = []
            for row in rows:
                safe = [{'blob_sha256': hashlib.sha256(value).hexdigest(), 'bytes': len(value)}
                        if isinstance(value, bytes) else value for value in row]
                encoded.append(hashlib.sha256(json.dumps(safe, ensure_ascii=False,
                               separators=(',', ':')).encode('utf-8')).hexdigest())
            tables[name] = {'rows': len(encoded), 'sha256': hashlib.sha256(
                '\n'.join(sorted(encoded)).encode('utf-8')).hexdigest()}
        return tables


def online_backup(source, destination):
    require(not destination.exists(), 'Backup destination already exists.')
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(descriptor)
    with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as original:
        with closing(sqlite3.connect(destination)) as backup:
            original.backup(backup, pages=256, sleep=0.02)
    return database_snapshot(destination)


def atomic_write(destination, content, mode=0o600):
    temporary = destination.with_name(destination.name + '.new-' + uuid.uuid4().hex)
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(descriptor, 'wb') as output:
        output.write(content)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, destination)
    directory = os.open(destination.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def switch_release(target):
    temporary = BASE / ('current.new-' + uuid.uuid4().hex)
    temporary.symlink_to(target, target_is_directory=True)
    os.replace(temporary, BASE / 'current')
    directory = os.open(BASE, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def health():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(50):
        try:
            with opener.open('http://127.0.0.1:18965/healthz', timeout=2) as response:
                value = json.load(response)
            if value.get('ok') is True and value.get('storage') == 'sqlite':
                return
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise RuntimeError('Gutters health readback failed.')


def private_path(path, uid, mode, directory=False):
    require(not path.is_symlink(), 'Protected state must not be a symlink.')
    info = path.stat()
    require(info.st_uid == uid and stat.S_IMODE(info.st_mode) == mode
            and (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)),
            'Protected state ownership or permissions do not match the existing deployment.')


def run(args):
    import fcntl
    import pwd
    require(os.geteuid() == 0, 'Run this updater as root on Ubuntu.')
    require(re.fullmatch('[a-f0-9]{40}', args.commit), 'A full source commit is required.')
    require(re.fullmatch('[a-f0-9]{64}', args.sha256), 'A SHA-256 digest is required.')
    public_origin = canonical_https(args.public_origin)
    allowed_origin = canonical_https(args.allowed_origin)
    require(allowed_origin == 'https://wisdomscreen.pro', 'Unexpected public website origin.')
    lock = open('/run/lock/gutters-upgrade.lock', 'a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    account = pwd.getpwnam('gutters')
    private_path(DATA, account.pw_uid, 0o700, directory=True)
    private_path(DATABASE, account.pw_uid, 0o600)
    private_path(ENVIRONMENT.parent, 0, 0o700, directory=True)
    private_path(ENVIRONMENT, 0, 0o600)
    require((BASE / 'current').is_symlink(), 'The current release must be a symlink.')
    old_release = (BASE / 'current').resolve(strict=True)
    releases = (BASE / 'releases').resolve(strict=True)
    require(old_release.parent == releases, 'The active source is outside the release directory.')
    require(releases.stat().st_uid == 0 and not (releases.stat().st_mode & 0o022),
            'Release directory must be root-owned and not writable by others.')
    unit = subprocess.check_output(['systemctl', 'show', SERVICE,
                                   '--property=User,Group,ExecStart,WorkingDirectory,DropInPaths,EnvironmentFiles'], text=True)
    require('User=gutters\n' in unit and 'Group=gutters\n' in unit
            and 'WorkingDirectory=/opt/gutters/current/server\n' in unit
            and '/usr/bin/node /opt/gutters/current/server/src/server.mjs' in unit
            and 'DropInPaths=\n' in unit and '/etc/gutters/gutters.env' in unit,
            'The effective service differs from the expected dedicated service.')
    require(subprocess.run(['systemctl', 'is-active', '--quiet', SERVICE]).returncode == 0,
            'The existing service must be healthy before upgrading.')
    health()
    old_env = ENVIRONMENT.read_bytes()
    values = environment_values(old_env)
    require(re.fullmatch('[A-Za-z0-9_-]{43}', values.get('GUTTERS_OWNER_TOKEN', '')),
            'The existing owner key format is unexpected; inspect privately.')
    require(values.get('GUTTERS_BIND_HOST') == '127.0.0.1'
            and values.get('GUTTERS_PORT') == '18965'
            and values.get('GUTTERS_DB_PATH') == str(DATABASE),
            'The existing listener or database path is unexpected.')
    replacements = {'GUTTERS_PUBLIC_ORIGIN': public_origin,
                    'GUTTERS_ALLOWED_ORIGINS': allowed_origin,
                    'GUTTERS_SERVE_SITE': 'false', 'GUTTERS_TRUST_PROXY': 'false'}
    new_env = changed_environment(old_env, replacements)
    files = archive_files(Path(args.archive).resolve(strict=True), args.sha256)
    release = releases / args.commit
    require(release != old_release, 'This release is already active; verify it instead of upgrading again.')
    stage_release(release, files)
    for source_path in [release, *release.rglob('*')]:
        info = source_path.lstat()
        require(not source_path.is_symlink() and info.st_uid == 0
                and not (info.st_mode & 0o022),
                'Staged source must be root-owned and not writable by other users.')
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup_root = DATA / 'backups'
    backup_root.mkdir(mode=0o700, exist_ok=True)
    private_path(backup_root, 0, 0o700, directory=True)
    backup_dir = backup_root / (timestamp + '-' + args.commit[:12])
    backup_dir.mkdir(mode=0o700)
    backup_path = backup_dir / 'gutters.sqlite3'
    before = online_backup(DATABASE, backup_path)
    (backup_dir / 'gutters.env').write_bytes(old_env)
    (backup_dir / 'gutters.env').chmod(0o600)
    probe = DATA / ('upgrade-probe-' + uuid.uuid4().hex)
    probe.mkdir(mode=0o700)
    os.chown(probe, account.pw_uid, account.pw_gid)
    probe_db = probe / 'gutters.sqlite3'
    shutil.copyfile(backup_path, probe_db)
    probe_db.chmod(0o600)
    os.chown(probe_db, account.pw_uid, account.pw_gid)
    probe_js = probe / 'migrate.mjs'
    probe_js.write_text('import {openStore} from ' + json.dumps((release / 'server/src/store.mjs').as_uri())
                        + ';\nconst store=openStore(process.argv[2]);store.close();\n', encoding='utf-8')
    probe_js.chmod(0o644)
    migrated = False
    try:
        subprocess.run(['runuser', '-u', 'gutters', '--', '/usr/bin/node', str(probe_js), str(probe_db)],
                       check=True, capture_output=True, text=True)
        after_probe = database_snapshot(probe_db)
        require(all(after_probe.get(name) == signature for name, signature in before.items()),
                'Staged migration changed existing data in the backup copy.')
        require({'photos', 'estimates', 'feature_operations'} <= after_probe.keys(),
                'Staged migration did not create the photo/estimate tables.')
        migrated = True
    finally:
        # This is a newly created, validated child of DATA, never the live database.
        require(probe.parent == DATA and probe.name.startswith('upgrade-probe-') and not probe.is_symlink(),
                'Unsafe probe cleanup path.')
        shutil.rmtree(probe)
    require(migrated, 'Staged migration did not complete.')
    receipt = {'source_commit': args.commit, 'previous_release': str(old_release),
               'archive_sha256': args.sha256, 'backup': str(backup_path),
               'backup_verified': True, 'migration_preserved_existing_rows': True,
               'database': str(DATABASE), 'owner_key_preserved': True,
               'public_origin': public_origin, 'allowed_origin': allowed_origin,
               'public_route_created': False, 'switched_at': timestamp}
    try:
        atomic_write(ENVIRONMENT, new_env)
        switch_release(release)
        subprocess.run(['systemctl', 'restart', SERVICE], check=True)
        health()
        current = database_snapshot(DATABASE)
        require(all(current.get(name, {}).get('rows', -1) >= signature['rows']
                    for name, signature in before.items() if name != 'rate_limits'),
                'A business-table row count decreased during upgrade.')
        require(environment_values(ENVIRONMENT.read_bytes()).get('GUTTERS_OWNER_TOKEN') == values['GUTTERS_OWNER_TOKEN'],
                'The existing owner key changed.')
        receipt.update(state='running', tables={name: entry['rows'] for name, entry in current.items()})
        atomic_write(DATA / 'deployment.json', (json.dumps(receipt, indent=2) + '\n').encode())
    except Exception:
        # Never restore the database: writes accepted during deployment remain durable.
        atomic_write(ENVIRONMENT, old_env)
        switch_release(old_release)
        subprocess.run(['systemctl', 'restart', SERVICE], check=True)
        health()
        receipt.update(state='rolled_back', database_restored=False)
        atomic_write(backup_dir / 'upgrade-receipt.json', (json.dumps(receipt, indent=2) + '\n').encode())
        raise RuntimeError('Upgrade failed; prior code/configuration restored, database preserved. Inspect the private receipt.') from None
    atomic_write(backup_dir / 'upgrade-receipt.json', (json.dumps(receipt, indent=2) + '\n').encode())
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--public-origin', required=True)
    parser.add_argument('--allowed-origin', default='https://wisdomscreen.pro')
    try:
        run(parser.parse_args())
    except Exception as error:
        # Only deliberate, sanitized messages escape; subprocess output can contain runtime data.
        print(json.dumps({'ok': False, 'error': str(error) if isinstance(error, RuntimeError)
                          else type(error).__name__}))
        raise SystemExit(1)
