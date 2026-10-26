# WisdomScreen.pro launch handoff

Tony purchased **wisdomscreen.pro** at Porkbun and selected Raj's existing Gutters server for hosting. Tony selected Raj to handle the final merge and launch. The site and private photo/estimate workflow pass the local checks; the actual server connection is still required.

## Verified domain state

- Porkbun registrar account has access to the exact domain.
- The inspected zone contained only the default parking ALIAS at the apex and a wildcard CNAME, both pointing to pixie.porkbun.com, TTL 600.
- Existing Porkbun nameservers are retained. DNS has not been redirected while the server target is unknown.
- Do not infer a public IP from the service's loopback address.

## Hosting and data

The existing deployment record identifies serv2-linux, gutters.service, /opt/gutters/current, /var/lib/gutters/gutters.sqlite3, protected /etc/gutters/gutters.env, and 127.0.0.1:18965. These are retained deployment records, not fresh server verification. This Windows workspace currently has no working SSH/Tailscale/Desktop Commander path to that server.

Before upgrading, inspect the live unit, release, listeners, reverse proxy and backup state. Create a SQLite online backup and verify it separately. Preserve the current database, dedicated account, owner key and unrelated services. The new photo/estimate schema is additive; do not rerun the first-install script or replace the database.

Stage the reviewed release with both server/ and site/, test using an isolated database, and retain the prior release for rollback. Use the actual existing reverse proxy for a dedicated wisdomscreen.pro HTTPS host forwarding to the existing loopback service. Set the production origin and allowed customer origin to https://wisdomscreen.pro, enable GUTTERS_SERVE_SITE=true, and preserve the protected owner key and database path. Support a request body above 5 MiB for the permitted single-photo multipart upload. Owner access is at /owner; private requests and images must never be cached or published as static assets.

After the server target is verified, replace only the apex parking record with the actual hosting record and add a specific www record if that hostname is configured. Preserve unrelated zone records and nameservers. Issue/verify HTTPS and redirect www to the canonical apex if used.

## Acceptance on the real domain

Confirm the homepage, gutter and screen pages, project gallery, ads and dated Google reviews on the exact external HTTPS domain. Then use synthetic data for customer request and photo → private owner inbox → saved private draft → exact preview → explicit send → customer estimate readback → reply after reload. Confirm unauthorized/cross-customer photo access is denied. An accepted DNS edit or a healthy local service alone does not establish public launch.

No public deployment or DNS change is claimed by this handoff. Final server/DNS evidence must be recorded after the actual connection and launch.
