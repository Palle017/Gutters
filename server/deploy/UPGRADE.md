# Upgrade the existing Ubuntu service

Use `upgrade.py` for an existing, healthy `gutters.service`. Do not rerun the
first-install script. Review and test the exact source commit before deployment.
The updater does not configure DNS, TLS, public ingress, or unrelated services.

Create a Git archive containing only `server/`, calculate its SHA-256, and transfer
it with the reviewed updater to Ubuntu. Run:

```text
sudo python3 upgrade.py --archive /path/to/reviewed-server.tar --commit FULL_COMMIT --sha256 ARCHIVE_SHA256 --public-origin https://VERIFIED_API_HOST:PORT
```

`--public-origin` must be the actual canonical HTTPS origin of the dedicated API
and owner inbox. Customer CORS is restricted to `https://wisdomscreen.pro`.
The existing loopback address, database path, owner key, service user, and systemd
unit remain unchanged. Unrecognized environment keys and comments are preserved.
Static serving and trust in forwarded IP headers remain off.

The updater locks concurrent upgrades, validates the source archive, and keeps
the former release. It makes a private online SQLite backup under
`/var/lib/gutters/backups/`, verifies integrity and foreign keys, then runs the
new additive schema against an isolated backup copy. Every preexisting table
must retain its exact row fingerprints before the live release can change.

The configuration write and release-pointer switch are atomic. Only
`gutters.service` restarts. A failed restart or health verification restores the
prior source pointer and configuration and restarts that same service. It never
restores or replaces the live database, because doing so could discard requests
accepted during the change. The additive tables are compatible with the prior
server. Protected receipts record source, backup, and verification status without
printing credentials or customer contents.

Run the updater checks independently of the JavaScript suite:

```text
python3 -m unittest discover -s server/deploy -p test_upgrade.py
```

After deployment, verify the actual public customer request and photo submission,
owner inbox, private draft and preview, explicit publication, customer readback
and reply, exact-operation retries, unauthorized/cross-customer denial, and durable
readback after restart. A healthy loopback response is not proof of public access.
