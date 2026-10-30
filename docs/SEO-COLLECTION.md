# Private aggregate SEO collection

Prepared source, not an operating ingestion service. Property mapping, current access and live numerical reconciliation must be recorded separately from these synthetic source tests. No fresh metrics were collected by this change. The Google Maps place ID is **not** the GBP API's numeric location ID or a GA4 property ID. This collector does not call or bypass Ahrefs.

The collector makes only aggregate report reads to official Google endpoints. It does not retrieve search queries, page URLs, customer records, messages, photos or raw sessions. It saves only named numeric metrics, source status, property provenance, requested dates and limitations. Sources remain separate; clicks, sessions and call clicks are not added together as leads, unique people or jobs. Snapshots do not accumulate prior totals.

## Explicit setup, after mapping existing authorized properties

1. Copy `config/seo.example.json` into ignored `private/seo-config.json`. Leave `enabled: false` until the existing properties and access are confirmed.
2. Set an inclusive start/end window of 1–31 days. Prefer settled past dates; recent results can change. Source calendar time zones differ. Search Console uses Pacific dates, GA4 reports its property time zone, and GBP retains provider calendar dates without assuming a time zone.
3. Enter the actual identifiers and set each `mappingConfirmed` only after verifying it belongs to this business. GSC accepts the exact wisdomscreen.pro URL-prefix or domain property and filters pages to the exact HTTPS website host. GA4 requires its numeric property ID and filters the report to hostName wisdomscreen.pro. GBP requires its verified numeric performance location ID. Omit unavailable IDs as `null`.
4. Supply existing authorized, unexpired tokens through the current process environment: `GUTTERS_GSC_ACCESS_TOKEN`, `GUTTERS_GA4_ACCESS_TOKEN`, `GUTTERS_GBP_ACCESS_TOKEN`. Never put tokens in the config, Git, an issue, command arguments or report. Existing GSC read-only and Analytics read-only access are sufficient; GBP performance requires Google's business.manage scope even though this tool only reads. This PR creates no credential or OAuth grant and implements no refresh flow.
5. Explicitly enable and run `node tools/seo-collect.mjs private/seo-config.json` locally. Nothing schedules this command. Results go only to ignored `private/seo/` as create-only timestamped JSON. On Windows protect the project/user folder with the existing account ACL; POSIX mode bits alone do not set a Windows ACL. Do not publish the private folder or reuse Perfect Timing storage/routes.

Exit code 0 means the command saved the report (it can still be explicitly disabled or have no data); 2 means a source lacks inputs or failed; 1 means configuration/output failed. Inspect each source state. Missing metrics are `null`, not zero. The documented GBP exception is a **present** datedValue with no value field: Google defines that as measured zero. Missing dates or series remain incomplete; GBP totals require every date in the requested window. Duplicate dates/series are rejected, not summed twice. Provider error text is not persisted or logged. Calls and response-body reads share a 20-second abort deadline; redirects are rejected and tokens go only to fixed official endpoints.

The website does not yet have a verified GA4 measurement ID/tag. Historical GA4 data may be unavailable even with report access. Adding a tag requires identifying the correct stream and reviewing the site's tracking/consent setup; this collector activates none. Confirm profile hours, service areas, photos, branding and setup prompts in the signed-in Google profile separately. No completion percentage is assumed.

## GA4 contact and saved-request reports

This extension is stacked on draft [#17](https://github.com/Palle017/Gutters/pull/17) at `606640f051a135faa68d58fddf999daa9c9cd241`. Its review base is that collector branch, so the diff contains only event reporting. The separate website instrumentation draft emits the event contract below; neither draft installs a live tag, changes the Google property, enables collection, or connects the dashboard.

Schema version 2 preserves `sources.ga4.metrics` (`sessions`, `activeUsers`, `screenPageViews`) and adds `sources.ga4.events`. The overview and event report are independent reads of the same property/date range and exact `hostName` filter. The event report requests only the `eventName` dimension, filtered case-sensitively to two fixed values, with `eventCount` and `keyEvents` metrics. It retrieves no page URLs, user identifiers, contact channel custom dimension, or arbitrary event parameters.

| Event | Meaning | Limitation |
| --- | --- | --- |
| `contact_click` | A phone, email or other supported contact-link tap emitted by the reviewed website code | A tap does not establish an answered call, sent email, qualified lead or job. Channels are not broken down without a separately reviewed custom-dimension setup. |
| `quote_request_saved` | Website code received a valid durable backend receipt for a new quote request, including a recovered idempotent receipt | Client analytics is best effort. SQLite remains the authoritative request count. A form attempt, timeout, validation failure, photo upload or follow-up message is not this event. |

Each allowlisted event has its own state and numeric metrics. A present numeric zero remains zero; an absent row remains `no_data` with `metrics: null`. Empty results cannot establish that tracking was installed or that no requests occurred. Malformed, duplicate, unexpected and truncated rows fail closed. Key-event values can be fractional; event counts require safe integers. Thresholding and sampling indicators are retained for the event report independently from the overview.

`keyEvents` reflects the property's actual configuration and counting rules. Marking an event as a key event is a separate setup decision and affects future reporting; this tool does not perform it. Zero `keyEvents` does not prove whether the event is registered. Do not sum `eventCount` with `keyEvents`, or either event with website/database/GBP counts to invent a total. No answered-call metric is present.

An event-report failure preserves available overview metrics and other sources, marks GA4 `partial`, and causes CLI exit code 2. An overview failure can likewise retain available event metrics; `overviewState` makes that explicit. Partial/missing rows are preserved without inference. Repeat runs remain independent snapshots, not accumulated counters.

The privacy and receipt boundary follows the existing [Fixing Fort Myers source](https://github.com/Palle017/fixingfortmyers-site): bounded client event names, aggregate reporting and stored-request success grounded in durable storage. That source was inspected read-only (`site.js`, `README.md`, `_website-intake/pipeline.test.mjs`). No Perfect Timing endpoint, credential, storage or automotive behavior was imported.

## Verification and limits

`node --test tests/seo-collector.test.mjs` uses synthetic mocked providers only, plus a disabled CLI run. It checks scoping, opt-in behavior, unknown versus zero, provider failures, redaction, duplicate handling and private output. Run the full existing Node/Python/build checks before pushing. Actual API authorization and numerical reconciliation against the corresponding provider report remain required before calling collection operational. Different providers' totals need not agree.

Primary API contracts checked October 28, 2026:

- [Search Console aggregate query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)
- [GA4 Data API runReport](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport)
- [GBP multi-metric performance](https://developers.google.com/my-business/reference/performance/rest/v1/locations/fetchMultiDailyMetricsTimeSeries)
- [GBP zero and dated-value semantics](https://developers.google.com/my-business/reference/performance/rest/v1/TimeSeries)

Event extension contracts checked October 30, 2026:

- [GA4 eventName, eventCount and keyEvents schema](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)
- [GA4 filter expressions and exact/in-list filters](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/FilterExpression)

Acceptance states stay separate: granting access allows report reads; installing the website tag allows collection; an observed provider receipt establishes event delivery; a reconciled report establishes measured values for its date range; a deployed dashboard connection establishes active dashboard reporting. This draft establishes synthetic parsing, filtering, privacy and failure behavior only.
