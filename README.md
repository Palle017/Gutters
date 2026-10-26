# Everything Screen and Gutters

Website and simple customer-message system for John Wisdom's business, currently Everything Screen and Aluminum and being renamed Everything Screen and Gutters.

This repository prepares migration of the existing public website from Netlify to GitHub Pages. The Netlify website remains the working public site during preparation. No custom domain has been selected or purchased.

## Product direction

Help homeowners call John, describe their gutter or screen project, request an estimate, and continue the same conversation. John also supplies underground drainage; he does not offer grading. The customer value to investigate is collecting roof runoff and moving it away from the home, including wet areas between houses where a suitable drainage solution is possible.

The website must not promise to solve every standing-water problem, diagnose structural damage, claim universal code requirements or forecast repair costs from an anecdote. Site inspection and a suitable discharge route matter.

## Small data model

All quote requests and messages use the isolated Ubuntu SQLite database `gutters`, at `/var/lib/gutters/gutters.sqlite3`. Quote details are limited to customer address, home size, one/two stories and gutter length. Name and callback number support the contact request. Other database fields are technical identifiers, message records, timestamps and authorization/retry information required for messaging.

Home size and gutter length are stored as supplied text. Unknown values stay empty. No price or measurement formula is invented. A ballpark is a preliminary estimate; John defines the rules and verifies the site before a firm quote.

## Delivery sequence

Incremental draft PRs separate the static website, SQLite service, customer messages, drainage value/education and the held ballpark-estimate specification. See `docs/PR-SEQUENCE.txt` as it is completed. GitHub Pages publication remains a manual workflow until the replacement and its contact path are verified.

Ask John's ten customer-value questions in `docs/john-revenue-questions.txt`. The Astra review chat owns the question draft; answers belong to John.

No customer records, credentials, private return links or runtime databases belong in this repository. Keep the existing Perfect Timing services and data separate.
