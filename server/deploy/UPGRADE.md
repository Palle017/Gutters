# Upgrade the existing Ubuntu service

Use `upgrade.py` for an existing, healthy `gutters.service`. Do not rerun the
first-install script. Review and test the exact source commit before deployment.
The updater does not configure DNS, TLS, public ingress, or unrelated services.

Create an archive with `git archive --format=tar FULL_COMMIT server`, calculate its
SHA-256 from that reviewed checkout, and transfer it with the reviewed updater to
Ubuntu. The updater requires the archive's Git PAX commit header to match
`--commit`, as well as the expected SHA-256. A hand-built tar without that commit
header is rejected. The archive must contain `server/deploy/public-service.json`;
its API and website origins must match the deployment arguments and reviewed
frontend. If the verified ingress changes, review both source configurations
together before deploying.

Run the upgrade as a transient systemd unit so an SSH disconnection does not kill
the deployment process. Substitute a unique unit suffix and the verified origin:

```text
sudo systemd-run --unit=gutters-upgrade-UNIQUE_SUFFIX --property=Type=exec --collect /usr/bin/python3 /path/to/upgrade.py --archive /path/to/reviewed-server.tar --commit FULL_COMMIT --sha256 ARCHIVE_SHA256 --public-origin https://VERIFIED_API_HOST:PORT
sudo journalctl -u gutters-upgrade-UNIQUE_SUFFIX --no-pager
```

`--public-origin` must be the actual canonical HTTPS origin of the dedicated API
and owner inbox. Customer CORS is restricted to `https://wisdomscreen.pro`.
The existing loopback address, database path, owner key, service user, and systemd
unit remain unchanged. Unrecognized environment keys and comments are preserved.
Static serving remains off. Proxy trust defaults to `false`; use
`--proxy-mode tailscale` only after a fresh runtime check confirms the dedicated
Tailscale ingress overwrites the forwarded client header. This option does not
configure or authorize public ingress itself.

The HTTP adapter admits at most two simultaneous request bodies or private photo
responses: one public transfer and one reserved for an owner whose bearer key and
owner-origin policy have already been checked. A forged owner route, credential,
or identity header cannot claim the reserve. Each public client can hold at most
one transfer; an owner's authenticated transfer is separate so public activity
behind the same address does not block that owner. Admission uses the verified
proxy identity when configured. The slot remains occupied until both application
work and the response finish or close, including slow photo downloads.

The connection ceiling remains 64, with absolute 15-second ordinary and 75-second
photo deadlines. Excess work receives a retryable busy response; an early-closed
upload can instead appear as a connection reset. Retrying must retain the same
operation and content. These limits bound admitted concurrent transfers, not
total Node/SQLite memory. Multipart parsing, SQLite BLOB reads, HTTP response
copies and garbage collection add memory beyond the photo bytes. The existing
256 MiB systemd limit is unchanged and is not proven sufficient by local tests.
Measure the deployed process/cgroup peak under permitted 5 MiB upload/download
and owner activity before claiming Ubuntu capacity or public launch acceptance.

The updater locks concurrent upgrades, validates the source archive, and keeps
the former release. Before staging, it checks free space on the relevant devices
for the source, backup, probe, migration/WAL headroom, and a 512 MiB reserve. It
checks the reserve again before changing the running service. It makes a private online SQLite backup under
`/var/lib/gutters/backups/`, verifies integrity and foreign keys, then runs the
new additive schema against an isolated backup copy. Every preexisting table
must retain its exact row fingerprints before the live release can change.

The configuration write and release-pointer switch are atomic. The current
configuration and source pointer must still match the preflight state immediately
before switching. Only `gutters.service` restarts. Health readback is followed by a
check of systemd's actual MainPID, its `/proc` working directory, Node executable,
command, and active release pointer. A response from an old process therefore
cannot establish a successful upgrade. A failed restart, identity check, or
health verification restores the prior source pointer and configuration and
restarts that same service. It never
restores or replaces the live database, because doing so could discard requests
accepted during the change. The additive tables are compatible with the prior
server. Protected receipts record source, backup, and verification status without
printing credentials or customer contents. A rollback records both the attempted
commit and active previous commit in the backup receipt and deployment receipt;
it cannot leave a successful new-release receipt after restoring the old code.

If recovery itself fails, the updater attempts to replace both private receipts
with `rollback_failed`. The warning records only fixed failure classifications
and the recovery step, never exception text, commands or environment values.
`active_source_commit` and `running_pid` are unknown (`null`) until the old process
has been verified; a pointer switch or restart attempt alone does not prove the
old release is running. A failure writing either receipt does not prevent trying
the other. Storage failure can make both warnings unavailable, so an unsuccessful
updater exit must be investigated even if an older receipt still says `running`.
Inspect the actual source pointer, protected configuration, systemd process and
loopback health before retrying. The live database is never restored by recovery.

Normal SIGTERM, SIGINT and SIGHUP interruptions trigger the same recovery; further
termination signals are ignored while recovery completes. The tests exercise
successful switching and health, stale-process, final-receipt-write and hangup
failures while retaining a database write accepted during the upgrade.

SIGKILL and loss of power cannot be caught. A private `prepared` receipt is saved
before the switch and identifies the prior release and verified backup. If the
host dies mid-upgrade, inspect the current pointer, environment, systemd process,
and private receipt before taking action. Preserve the live database; do not
blindly restore its backup or retry an already active source release. A successful
deployment has matching `running` receipts in the backup folder and
`/var/lib/gutters/deployment.json`.

Run the updater checks independently of the JavaScript suite:

```text
python3 -m unittest discover -s server/deploy -p 'test_*.py'
```

After deployment, verify the actual public customer request and photo submission,
owner inbox, private draft and preview, explicit publication, customer readback
and reply, exact-operation retries, unauthorized/cross-customer denial, and durable
readback after restart. A healthy loopback response is not proof of public access.
