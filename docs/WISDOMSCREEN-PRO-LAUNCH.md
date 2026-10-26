# WisdomScreen.pro launch handoff

Tony purchased **wisdomscreen.pro** at Porkbun. The static website is live on GitHub Pages with trusted HTTPS. Raj is connecting its customer forms to the existing private Gutters service on Ubuntu. Local tests are necessary, but completion requires the public workflow below against the deployed service.

## Verified domain state

- Tony changed the apex ALIAS and www CNAME to palle017.github.io on October 26, 2026.
- GitHub Pages is bound to wisdomscreen.pro; both names have a trusted certificate and HTTPS enforcement is enabled.
- Existing Porkbun nameservers and unrelated records are retained.
- Do not infer a public IP from the service's loopback address.

## Hosting and data

The existing deployment record identifies serv2-linux, gutters.service, /opt/gutters/current, /var/lib/gutters/gutters.sqlite3, protected /etc/gutters/gutters.env, and 127.0.0.1:18965. Inspect these on the actual machine before changing anything. The proposed dedicated API route is https://serv2-linux.tail68bd87.ts.net:8443; confirm that port is available and dedicated to Gutters before enabling it or publishing the matching browser configuration.

Before upgrading, inspect the live unit, release, listeners, reverse proxy and backup state. Create a SQLite online backup and verify it separately. Preserve the current database, dedicated account, owner key and unrelated services. The new photo/estimate schema is additive; do not rerun the first-install script or replace the database.

The October 26 launch keeps the marketing and customer pages on GitHub Pages at https://wisdomscreen.pro/. GitHub Pages does not run or proxy the private API. Upgrade only the dedicated Ubuntu service, test migration using an isolated backup copy, and retain the prior release for rollback. Configure its own HTTPS origin and permit the exact customer origin https://wisdomscreen.pro. The browser's fixed service address must match that verified route; local previews continue to use their local service. Keep GUTTERS_SERVE_SITE=false and preserve the owner key and database path. Support a request body above 5 MiB for the permitted single-photo multipart upload and allow the browser's 60-second upload window. Owner access is at /owner on the service origin; private requests and images must never be cached or published as static assets.

The apex and www records already point to GitHub Pages, with trusted HTTPS and HTTPS enforcement enabled. Leave those domain records in place. Add only the dedicated service ingress after checking existing routes and confirming that the Ubuntu upgrade passed. Never reset a shared Serve/Funnel configuration or expose an unrelated listener.

The frontend only maps the canonical apex to the API; GitHub redirects www to the apex. `server/deploy/public-service.json` records the reviewed API and website origins. The routing test and updater must agree with that contract before release. If a different port is required, update and review the contract and browser address together.

Proxy identity stays disabled by default. Before selecting the explicit `tailscale` mode, verify the installed proxy version and that the dedicated route overwrites `X-Forwarded-For` with one client IP, including when a caller supplies forged forwarding headers. [Tailscale's proxy implementation](https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go) supplies that header from the connection source. The service only accepts a single valid IP from a loopback peer in this mode; it never selects an address from a caller-supplied chain. Check that two clients have separate limits and that bad request bodies do not consume the shared create budget. Do not enable generic trust in arbitrary forwarding headers.

## Acceptance on the real domain

Confirm the homepage, gutter and screen pages, project gallery, ads and dated Google reviews on the exact external HTTPS domain. Then use synthetic data for customer request and photo → private owner inbox → saved private draft → exact preview → explicit send → customer estimate readback → reply after reload. Confirm unauthorized/cross-customer photo access is denied. An accepted DNS edit or a healthy local service alone does not establish public launch.

Run the private acceptance runner's create/resume and verify steps around an actual `gutters.service` restart. Its own HTTPS connection can still use a private tailnet route, so separately prove access through the public Funnel from outside the tailnet. Test a permitted 5 MiB upload and the public browser workflow; describe desktop/mobile emulation accurately and do not claim a physical phone test unless one was performed. After acceptance, revoke only the runner's two synthetic customer capabilities with its cleanup step. Retain their clearly labeled records and evidence instead of deleting production data.

This source change does not establish a working public request service. Record the reviewed revision, successful upgrade/backup receipt, dedicated ingress configuration, public acceptance results, and deployed frontend revision after the connection is actually verified. Keep credentials, customer capabilities and private backup files out of the repository and the completion email.
