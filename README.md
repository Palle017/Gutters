# Everything Screen and Gutters

Website and private customer-request/estimate workflow for John Wisdom’s Southwest Florida business. The current local design uses the Heritage Americana direction: navy, faded red, warm cream, rustic details, and owner-supplied project photography.

The implementation includes dedicated gutter and screen pages, a project gallery, supplied advertisements, photo estimate requests, a private customer conversation page, and an owner inbox for manually writing and sending estimates. The static website is published through the manual GitHub Pages workflow at **https://wisdomscreen.pro/**. The Ubuntu request service uses loopback port **18965** behind its dedicated HTTPS route. A source merge, a Pages release, and a verified running request service are separate states; inspect the actual release and protected deployment receipts before upgrading.

## Run locally

Use **Node.js 24 or later** with built-in `node:sqlite` support.

```text
npm ci
npm run dev
```

`tools/dev-preview.mjs` starts the complete website and API together at **http://127.0.0.1:18966/**. John’s private request/estimate inbox is **http://127.0.0.1:18966/owner**.

The local preview creates an isolated SQLite database and owner key in the ignored `.preview-data/` directory. Open `.preview-data/owner-access.json` locally to obtain the preview owner access key; enter it only in the owner inbox. This file, customer records, private return links, and database files must never enter Git or the public build. The owner key stays in page memory after entry and is cleared on reload/lock.

`GUTTERS_PREVIEW_PORT` can select another loopback preview port. The preview launcher does not replace or reconfigure the deployed Ubuntu service.

## Pages and source

| Source | Purpose |
| --- | --- |
| `site/index.html` | Patriotic homepage, project photography, services, offers, and dated Google review excerpts. |
| `site/gutters.html` | Gutters, repairs, maintenance, and underground drainage. |
| `site/screens.html` | Screen repair, rescreening, and outdoor enclosure work. |
| `site/projects.html` | Gallery of the supplied real project photos. |
| `site/offers.html` | The three supplied advertisements and their stated offers. |
| `site/estimate.html` | Customer request, optional project details, and up to six project photos. |
| `site/customer.html` | Customer’s private photos, conversation, and latest published estimate. |
| `site/css/americana.css` | Heritage Americana layout and visual treatment. |
| `site/js/` | Navigation, customer intake, upload, private return, and reply behavior. |
| `server/src/` | Node HTTP API, SQLite storage, owner inbox, and optional same-origin static serving. |

Existing about, contact, services, and rescreening/restoration pages remain available. The public gallery contains 15 unique original project photos and three supplied ads; two separately saved hero photo treatments are documented alongside the untouched originals in [PHOTO-ASSETS.md](docs/PHOTO-ASSETS.md).

## Request → manual estimate

1. A customer provides a name and callback number, describes the work, and optionally supplies the address, home size, stories, gutter length, and project photos.
2. The website saves the request and photos, then provides a private return link for that conversation. Image uploads are private SQLite BLOBs, not public gallery assets.
3. John opens `/owner`, reviews the original request, photos, messages, and quote details, and manually enters the work scope, USD amount, and optional notes.
4. He saves a private draft, previews the saved version, and explicitly sends it. The published estimate and its owner message appear on the customer’s private page after durable readback. A changed draft requires saving and previewing again.
5. The customer can return to the same page to read the estimate and continue the conversation. No email or SMS notification provider is connected.

The original quote fields remain `address`, `size_of_home`, `stories`, and `gutter_length`. Unknown measurements remain blank; no units, automatic price formula, or inferred quantities are added. Supplied ad prices are displayed as advertising only. **John sets each estimate’s actual scope and amount.** See [server/README.md](server/README.md) for authentication, upload limits, retry receipts, and API contracts.

## Evidence and verification

```text
npm test
npm run build
```

The tests cover the existing conversation protocol as well as private uploads, authorization boundaries, durable retries, manual estimate draft/publication, customer-page behavior, and static build boundaries. The build copies only public `site/` files to `dist/`; customer photos, database files, and owner keys are excluded.

The local browser workflow was exercised with synthetic request data, a supplied project photo in a synthetic request, a private draft, an explicit preview/send, customer estimate readback, and a reply retained after page reload. See [LOCAL-ACCEPTANCE.md](docs/LOCAL-ACCEPTANCE.md). Test estimate amounts are validation data, not business prices.

The homepage’s **4.9 / 5 from 32 Google reviews** is a snapshot checked on **October 25, 2026**, with links to the verified business profile. It is not a live API feed. Source identity, excerpts, and attribution are recorded in [GOOGLE-REVIEWS-SOURCES.md](docs/GOOGLE-REVIEWS-SOURCES.md). Business facts and the photo/ad record are maintained in [BUSINESS-FACTS.md](docs/BUSINESS-FACTS.md) and [PHOTO-ASSETS.md](docs/PHOTO-ASSETS.md).

## Publication boundary

GitHub Pages hosts the static website; the upload, SQLite, and estimate APIs require the Node service and its dedicated HTTPS route. The API origin and allowed website origin must match the configured public routing contract in [UPGRADE.md](server/deploy/UPGRADE.md). `GUTTERS_SERVE_SITE=true` enables the service’s optional allowlisted `site/` serving; the local preview sets this automatically.

The public request interface is published, but current end-to-end availability must be checked against the running service. Optional email-contact and notification source must be released deliberately; notification delivery defaults off and requires separate configuration and real delivery acceptance. Any upgrade must preserve the existing Ubuntu data, protected environment, loopback service, unrelated Perfect Timing services, and private customer records. Historical first-install evidence remains in [PR2-SQLITE-RELEASE.txt](docs/PR2-SQLITE-RELEASE.txt); it does not establish current runtime health.
