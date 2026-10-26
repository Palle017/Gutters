# Everything Screen and Gutters

Raj owns the technical work. John Wisdom supplies business value, service scope and quote calculations. Public brand: Everything Screen and Gutters. Existing business: Everything Screen and Aluminum.

## Scope

Keep the product focused on profitable calls, estimate requests and customer follow-up. Preserve the working Netlify site until the replacement is checked and Raj directs the migration. GitHub Pages publication is prepared as a manual workflow; no domain is owned or selected yet. Do not invent a domain, testimonials, response guarantees, prices, service warranties or customer-value claims.

The portable Ubuntu messaging service uses one SQLite database named `gutters`, with default file `/var/lib/gutters/gutters.sqlite3`. All quote requests and their message history belong there. Website source remains in Git; do not put runtime records in Git or GitHub Pages.

## Small schema

Quote business fields are exactly customer address, home size, one/two stories, and gutter length. Preserve unknown values as empty/NULL. Home size and gutter length are raw supplied text until John defines units and calculations. Do not add rate, price, materials, labor, score, campaign, estimate-stage or other speculative business variables. Minimal contact and technical IDs/timestamps/authorization/idempotency records are necessary for the requested messaging, not a general CRM.

Only John can define future quote calculations. Do not evaluate customer text as code, invent a multiplier or issue an automatic quote. New information in a message does not silently rewrite the original quote fields.

## Boundaries and acceptance

Reuse the public Fixing Fort Myers conversation patterns with attribution. No Gutters request may contact Perfect Timing services, copy their credentials, share customer storage or carry over automotive/booking behavior. Keep owner authorization server-side, show saved only after a durable receipt, and preserve the same operation/body after an uncertain send. Test with synthetic records only; no real customer communications or provider activation.

Do not publish databases, owner tokens, private return links, service environment files or customer details. The static build must include only `site/`. Deploy the server only to its own directory, user and loopback listener; preserve existing Ubuntu services and network routes.

Windows shell: write Python/JavaScript to files before execution; no inline `python -c`, `node -e`, `&&` or `||` in PowerShell. Use Node 24 or later. Run meaningful SQLite durability/retry/auth tests, frontend tests and static link/build checks before pushing. Record prepared, running and publicly reachable states separately.
