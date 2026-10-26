# Everything Screen and Gutters

Raj owns the technical work. John Wisdom supplies business value, service scope and quote calculations. Public brand: Everything Screen and Gutters. Existing business: Everything Screen and Aluminum.

## Scope

Keep the product focused on profitable calls, estimate requests and customer follow-up. Netlify holds the original draft. The static site is published by the manual GitHub Pages workflow at https://wisdomscreen.pro/. Tony owns the domain at Porkbun. Do not invent testimonials, response guarantees, prices, service warranties or customer-value claims.

The portable Ubuntu messaging service uses one SQLite database named `gutters`, with default file `/var/lib/gutters/gutters.sqlite3`. All quote requests and their message history belong there. Website source remains in Git; do not put runtime records in Git or GitHub Pages.

PR 2 installed `gutters.service` on Ubuntu with only `127.0.0.1:18965` listening. Preserve its data, root-only `/etc/gutters/gutters.env`, dedicated user and source release. The installer is intentionally first-install-only. Raj authorized connecting the public photo/estimate form and upgrading the existing Ubuntu database on October 26, 2026. Keep the marketing site on GitHub Pages and use a dedicated HTTPS route for this service; never reuse Perfect Timing storage, credentials or routes. Verify the actual public workflow before claiming completion.

## Small schema

Quote intake fields are exactly customer address, home size, one/two stories, and gutter length. Preserve unknown values as empty/NULL. Home size and gutter length are raw supplied text until John defines units and calculations. PR 8 added private photos and manually written estimate scope/amount, saved drafts and explicit publication. These are authorized workflow records; do not add automatic rates, calculations, materials, labor, scores, campaigns or speculative business variables. Minimal contact and technical IDs/timestamps/authorization/idempotency records support the requested messaging, not a general CRM.

Only John can define future quote calculations. Do not evaluate customer text as code, invent a multiplier or issue an automatic quote. New information in a message does not silently rewrite the original quote fields.

## Boundaries and acceptance

Reuse the public Fixing Fort Myers conversation patterns with attribution. No Gutters request may contact Perfect Timing services, copy their credentials, share customer storage or carry over automotive/booking behavior. Keep owner authorization server-side, show saved only after a durable receipt, and preserve the same operation/body after an uncertain send. Test with synthetic records only; no real customer communications or provider activation.

Do not publish databases, owner tokens, private return links, service environment files or customer details. The static build must include only `site/`. Deploy the server only to its own directory, user and loopback listener; preserve existing Ubuntu services and network routes.

Windows shell: write Python/JavaScript to files before execution; no inline `python -c`, `node -e`, `&&` or `||` in PowerShell. Use Node 24 or later. Run meaningful SQLite durability/retry/auth tests, frontend tests and static link/build checks before pushing. Record prepared, running and publicly reachable states separately.
