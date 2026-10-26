#!/usr/bin/env python3
"""First install of a reviewed Gutters release. Run as root on Ubuntu.

Usage: python3 install.py --archive SOURCE.tar --commit FULL_SHA --sha256 DIGEST
Existing application state is never overwritten. Secrets are generated here and
are never printed or placed in the source archive.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import re
import secrets
import socket
import subprocess
import tarfile
import time
import urllib.request

parser=argparse.ArgumentParser()
parser.add_argument('--archive',required=True)
parser.add_argument('--commit',required=True)
parser.add_argument('--sha256',required=True)
args=parser.parse_args()
if os.geteuid()!=0: raise SystemExit('Run this installer as root.')
if not re.fullmatch(r'[a-f0-9]{40}',args.commit): raise SystemExit('A full source commit is required.')
if not re.fullmatch(r'[a-f0-9]{64}',args.sha256): raise SystemExit('A SHA-256 digest is required.')
archive=Path(args.archive).resolve(strict=True)
if hashlib.sha256(archive.read_bytes()).hexdigest()!=args.sha256: raise SystemExit('Source archive digest mismatch.')
owned=[Path('/opt/gutters'),Path('/var/lib/gutters'),Path('/etc/gutters'),Path('/etc/systemd/system/gutters.service')]
if any(p.exists() or p.is_symlink() for p in owned): raise SystemExit('Gutters paths already exist. Inspect and use a reviewed update; nothing was overwritten.')
try:
    pwd.getpwnam('gutters')
except KeyError:
    pass
else:
    raise SystemExit('The gutters account already exists. Inspect its ownership before installing.')
with socket.socket() as probe:
    probe.bind(('127.0.0.1',18965))
node=subprocess.check_output(['/usr/bin/node','--version'],text=True).strip()
if not re.match(r'^v(?:24|25|26)\.',node): raise SystemExit('This release requires Node 24–26.')

release=Path('/opt/gutters/releases')/args.commit
with tarfile.open(archive,'r:') as bundle:
    members=bundle.getmembers()
    for member in members:
        relative=PurePosixPath(member.name)
        if relative.is_absolute() or '..' in relative.parts or not relative.parts or relative.parts[0]!='server': raise SystemExit('Unsafe archive path.')
        if not(member.isdir() or member.isfile()): raise SystemExit('Archive links and special files are not accepted.')
        if member.size>2_000_000 or relative.name=='.env' or any(p in ('data','node_modules','.git') for p in relative.parts) or '.sqlite' in relative.name: raise SystemExit('Runtime or unexpected data in source archive.')
    release.mkdir(parents=True,mode=0o755)
    for member in members:
        destination=release.joinpath(*PurePosixPath(member.name).parts)
        if member.isdir(): destination.mkdir(parents=True,exist_ok=True,mode=0o755)
        else:
            destination.parent.mkdir(parents=True,exist_ok=True,mode=0o755)
            with bundle.extractfile(member) as source, destination.open('xb') as output: output.write(source.read())
            destination.chmod(0o644)

subprocess.run(['useradd','--system','--user-group','--home-dir','/var/lib/gutters','--shell','/usr/sbin/nologin','gutters'],check=True)
account=pwd.getpwnam('gutters')
data=Path('/var/lib/gutters');data.mkdir(mode=0o700);os.chown(data,account.pw_uid,account.pw_gid)
configuration=Path('/etc/gutters');configuration.mkdir(mode=0o700)
environment=configuration/'gutters.env'
values={
    'GUTTERS_BIND_HOST':'127.0.0.1',
    'GUTTERS_PORT':'18965',
    'GUTTERS_DB_PATH':'/var/lib/gutters/gutters.sqlite3',
    'GUTTERS_OWNER_TOKEN':secrets.token_urlsafe(32),
    'GUTTERS_PUBLIC_ORIGIN':'http://127.0.0.1:18965',
    'GUTTERS_ALLOWED_ORIGINS':'https://palle017.github.io',
    'GUTTERS_TRUST_PROXY':'false',
}
descriptor=os.open(environment,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(descriptor,'w') as stream:
    stream.write(''.join(key+'='+value+'\n' for key,value in values.items()))
Path('/opt/gutters/current').symlink_to(release,target_is_directory=True)
unit=release/'server/deploy/gutters.service'
subprocess.run(['systemd-analyze','verify',str(unit)],check=True)
Path('/etc/systemd/system/gutters.service').write_bytes(unit.read_bytes())
Path('/etc/systemd/system/gutters.service').chmod(0o644)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','gutters.service'],check=True)
for attempt in range(30):
    try:
        with urllib.request.urlopen('http://127.0.0.1:18965/healthz',timeout=2) as response:
            health=json.load(response)
        if health.get('ok') and health.get('storage')=='sqlite': break
    except (OSError,ValueError): pass
    time.sleep(0.2)
else: raise SystemExit('Service did not pass its startup health check; inspect only gutters.service.')
receipt={'service':'gutters.service','source_commit':args.commit,'archive_sha256':args.sha256,'database':'/var/lib/gutters/gutters.sqlite3','bind':'127.0.0.1:18965','node':node,'public_route_created':False}
state=data/'deployment.json'
state.write_text(json.dumps(receipt,indent=2)+'\n');state.chmod(0o600)
print(json.dumps(receipt,indent=2))
