#!/usr/bin/env python3
"""Upgrade an existing Gutters service without replacing its data or owner key.

Run as root on Ubuntu with a reviewed server-only Git archive. No public ingress,
firewall, DNS, user, or systemd-unit changes are made by this script.
"""
import argparse
from contextlib import closing, contextmanager
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
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
PROC_ROOT = Path('/proc')
SPACE_RESERVE = 512 * 1024 * 1024
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


def archive_files(archive, expected_digest, expected_commit):
    digest = hashlib.sha256()
    with archive.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    require(digest.hexdigest() == expected_digest,
            'Source archive digest mismatch.')
    files = {}
    total = 0
    with tarfile.open(archive, 'r:') as bundle:
        require(bundle.pax_headers.get('comment') == expected_commit,
                'Git archive commit does not match the reviewed commit.')
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
                'server/src/store.mjs', 'server/src/protocol.mjs', 'server/src/owner-ui.mjs',
                'server/deploy/public-service.json'}
    require(required <= files.keys(), 'The source archive is incomplete.')
    return files


def validate_origin_contract(files, public_origin, allowed_origin):
    try:
        contract = json.loads(files['server/deploy/public-service.json'])
    except (KeyError, ValueError):
        raise RuntimeError('The reviewed public-service origin contract is missing or invalid.') from None
    require(set(contract) == {'apiOrigin', 'websiteOrigin'}
            and contract['apiOrigin'] == public_origin
            and contract['websiteOrigin'] == allowed_origin,
            'Deployment origins do not match the reviewed frontend/backend contract.')


def require_free_space(database, releases, source_bytes):
    with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as connection:
        logical = (connection.execute('PRAGMA page_count').fetchone()[0]
                   * connection.execute('PRAGMA page_size').fetchone()[0])
    wal = database.with_name(database.name + '-wal')
    logical = max(logical, database.stat().st_size) + (wal.stat().st_size if wal.exists() else 0)
    # Backup + probe + migration/WAL headroom; preserve free space for accepted writes.
    budgets = {}
    for path, needed in ((database.parent, 3 * logical), (releases, source_bytes)):
        device = path.stat().st_dev
        entry = budgets.setdefault(device, {'path': path, 'bytes': SPACE_RESERVE})
        entry['bytes'] += needed
    for entry in budgets.values():
        require(shutil.disk_usage(entry['path']).free >= entry['bytes'],
                'Insufficient disk space for the verified backup, probe, source and safety reserve.')
    return {str(entry['path']): entry['bytes'] for entry in budgets.values()}


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


def sync_directory(path):
    directory = os.open(path, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def atomic_write(destination, content, mode=0o600):
    temporary = destination.with_name(destination.name + '.new-' + uuid.uuid4().hex)
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(descriptor, 'wb') as output:
        output.write(content)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, destination)
    sync_directory(destination.parent)


def switch_release(target):
    temporary = BASE / ('current.new-' + uuid.uuid4().hex)
    temporary.symlink_to(target, target_is_directory=True)
    os.replace(temporary, BASE / 'current')
    sync_directory(BASE)


def current_release():
    return (BASE / 'current').resolve(strict=True)


class UpgradeInterrupted(RuntimeError):
    pass


@contextmanager
def interruption_guard(ignore=False):
    """Make normal SSH/termination interruptions recoverable; SIGKILL cannot be handled."""
    previous = {}
    def interrupt(_number, _frame):
        raise UpgradeInterrupted('Upgrade interrupted by a termination signal.')
    try:
        for name in ('SIGHUP', 'SIGTERM', 'SIGINT'):
            number = getattr(signal, name, None)
            if number is not None:
                previous[number] = signal.signal(number, signal.SIG_IGN if ignore else interrupt)
        yield
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)


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


def verify_running_release(release):
    require(subprocess.run(['systemctl', 'is-active', '--quiet', SERVICE]).returncode == 0,
            'The upgraded service is not active.')
    value = subprocess.check_output(['systemctl', 'show', SERVICE, '--property=MainPID', '--value'],
                                    text=True).strip()
    require(value.isdecimal() and int(value) > 1, 'The upgraded service has no live main PID.')
    process = PROC_ROOT / value
    require(Path(os.readlink(process / 'cwd')).resolve() == (release / 'server').resolve(),
            'The running service working directory is not the expected release.')
    require(Path(os.readlink(process / 'exe')).resolve() == Path('/usr/bin/node').resolve(),
            'The service main process is not the expected Node executable.')
    arguments = (process / 'cmdline').read_bytes().split(b'\0')
    require(arguments[:2] == [b'/usr/bin/node', b'/opt/gutters/current/server/src/server.mjs']
            and not any(arguments[2:]), 'The running service command is unexpected.')
    require(current_release() == release.resolve(),
            'The active source pointer does not match the running release.')
    return int(value)


def failure_code(error):
    """Bounded classifications only: exception text/commands may contain secrets."""
    if isinstance(error, UpgradeInterrupted):
        return 'interrupted'
    if isinstance(error, subprocess.TimeoutExpired):
        return 'process_timeout'
    if isinstance(error, subprocess.CalledProcessError):
        return 'process_failed'
    if isinstance(error, OSError):
        return 'io_failed'
    if isinstance(error, RuntimeError):
        return 'check_failed'
    return 'unexpected_failure'


def apply_update(old_release, release, old_env, new_env, receipt, before, backup_dir):
    require(ENVIRONMENT.read_bytes() == old_env, 'Configuration changed during preparation; nothing switched.')
    require(current_release() == old_release.resolve(),
            'The active release changed during preparation; nothing switched.')
    receipt_path = backup_dir / 'upgrade-receipt.json'
    # Keep reviewed attempt metadata separate from the active-runtime fields.
    # A later rolled_back receipt write may fail after those fields were changed.
    attempted = {'attempted_source_commit': receipt['source_commit'],
                 'attempted_public_origin': receipt.get('public_origin'),
                 'attempted_allowed_origin': receipt.get('allowed_origin'),
                 'attempted_proxy_mode': receipt.get('proxy_mode')}
    receipt.update(state='prepared')
    atomic_write(receipt_path, (json.dumps(receipt, indent=2) + '\n').encode())
    try:
        atomic_write(ENVIRONMENT, new_env)
        switch_release(release)
        subprocess.run(['systemctl', 'restart', SERVICE], check=True)
        health()
        pid = verify_running_release(release)
        current = database_snapshot(DATABASE)
        require(all(current.get(name, {}).get('rows', -1) >= signature['rows']
                    for name, signature in before.items() if name != 'rate_limits'),
                'A business-table row count decreased during upgrade.')
        require(environment_values(ENVIRONMENT.read_bytes()).get('GUTTERS_OWNER_TOKEN')
                == environment_values(old_env).get('GUTTERS_OWNER_TOKEN'),
                'The existing owner key changed.')
        receipt.update(state='running', running_pid=pid, active_source_commit=release.name,
                       tables={name: entry['rows'] for name, entry in current.items()})
        atomic_write(DATA / 'deployment.json', (json.dumps(receipt, indent=2) + '\n').encode())
        atomic_write(receipt_path, (json.dumps(receipt, indent=2) + '\n').encode())
    except BaseException as upgrade_error:
        # Never restore the database: writes accepted during deployment remain durable.
        # A second normal termination signal must not interrupt recovery midway.
        with interruption_guard(ignore=True):
            recovery_step = 'restore_configuration'
            restored_pid = None
            restored_config = None
            try:
                atomic_write(ENVIRONMENT, old_env)
                recovery_step = 'restore_source_pointer'
                switch_release(old_release)
                recovery_step = 'restart_previous_service'
                subprocess.run(['systemctl', 'restart', SERVICE], check=True)
                recovery_step = 'previous_service_health'
                health()
                recovery_step = 'verify_previous_process'
                restored_pid = verify_running_release(old_release)
                restored_config = environment_values(old_env)
                receipt.update(state='rolled_back', database_restored=False, running_pid=restored_pid,
                               source_commit=old_release.name, active_source_commit=old_release.name,
                               public_origin=restored_config.get('GUTTERS_PUBLIC_ORIGIN'),
                               allowed_origin=restored_config.get('GUTTERS_ALLOWED_ORIGINS'),
                               proxy_mode=restored_config.get('GUTTERS_TRUST_PROXY', 'false'), **attempted)
                recovery_step = 'record_rollback_receipts'
                atomic_write(DATA / 'deployment.json', (json.dumps(receipt, indent=2) + '\n').encode())
                atomic_write(receipt_path, (json.dumps(receipt, indent=2) + '\n').encode())
            except BaseException as recovery_error:
                receipt.update(state='rollback_failed', database_restored=False,
                               rollback_target_commit=old_release.name,
                               source_commit=old_release.name if restored_pid is not None else None,
                               active_source_commit=old_release.name if restored_pid is not None else None,
                               public_origin=restored_config.get('GUTTERS_PUBLIC_ORIGIN') if restored_config is not None else None,
                               allowed_origin=restored_config.get('GUTTERS_ALLOWED_ORIGINS') if restored_config is not None else None,
                               proxy_mode=restored_config.get('GUTTERS_TRUST_PROXY', 'false') if restored_config is not None else None,
                               running_pid=restored_pid, rollback_runtime_verified=restored_pid is not None,
                               upgrade_failure=failure_code(upgrade_error),
                               recovery_failure={'step': recovery_step, 'code': failure_code(recovery_error)}, **attempted)
                # Try both independent protected receipts even if one location
                # is unwritable. Neither a stale success receipt nor a failed
                # recovery may be reported as a restored/running release.
                for destination in (DATA / 'deployment.json', receipt_path):
                    try:
                        atomic_write(destination, (json.dumps(receipt, indent=2) + '\n').encode())
                    except BaseException:
                        pass
                raise RuntimeError('Upgrade recovery failed; service state requires inspection. '
                                   'Database preserved. Private rollback_failed receipts were attempted '
                                   'but may be unavailable.') from None
        raise RuntimeError('Upgrade failed; prior code/configuration restored, database preserved. Inspect the private receipt.') from None
    return receipt


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
    lock = os.open('/run/lock/gutters-upgrade.lock',
                   os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    lock_info = os.fstat(lock)
    require(lock_info.st_uid == 0 and stat.S_ISREG(lock_info.st_mode)
            and stat.S_IMODE(lock_info.st_mode) == 0o600, 'Unexpected upgrade lock ownership or mode.')
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
    require(args.proxy_mode in ('false', 'tailscale'), 'Unexpected proxy trust mode.')
    replacements = {'GUTTERS_PUBLIC_ORIGIN': public_origin,
                    'GUTTERS_ALLOWED_ORIGINS': allowed_origin,
                    'GUTTERS_SERVE_SITE': 'false', 'GUTTERS_TRUST_PROXY': args.proxy_mode}
    new_env = changed_environment(old_env, replacements)
    files = archive_files(Path(args.archive).resolve(strict=True), args.sha256, args.commit)
    validate_origin_contract(files, public_origin, allowed_origin)
    space_budget = require_free_space(DATABASE, releases, sum(map(len, files.values())))
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
               'proxy_mode': args.proxy_mode, 'space_budget_bytes': space_budget,
               'public_route_created': False, 'switched_at': timestamp}
    # Refresh the safety margin after copying the backup/probe and before changing service state.
    for path in (DATA, releases):
        require(shutil.disk_usage(path).free >= SPACE_RESERVE,
                'Disk safety reserve fell below the required margin during preparation.')
    apply_update(old_release, release, old_env, new_env, receipt, before, backup_dir)
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--public-origin', required=True)
    parser.add_argument('--allowed-origin', default='https://wisdomscreen.pro')
    parser.add_argument('--proxy-mode', choices=('false', 'tailscale'), default='false')
    try:
        with interruption_guard():
            run(parser.parse_args())
    except Exception as error:
        # Only deliberate, sanitized messages escape; subprocess output can contain runtime data.
        print(json.dumps({'ok': False, 'error': str(error) if isinstance(error, RuntimeError)
                          else type(error).__name__}))
        raise SystemExit(1)
