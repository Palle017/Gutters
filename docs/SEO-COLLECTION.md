# Private aggregate SEO collection

Prepared source, not an operating ingestion service. No Gutters Search Console property, GA4 property or GBP performance location has yet been verified here. No fresh metrics were collected. The Google Maps place ID is **not** the GBP API's numeric location ID or a GA4 property ID. Ahrefs access remains rejected by the existing plan; this collector does not call or bypass Ahrefs.

The collector makes only aggregate report reads to official Google endpoints. It does not retrieve search queries, page URLs, customer records, messages, photos or raw sessions. It saves only named numeric metrics, source status, property provenance, requested dates and limitations. Sources remain separate; clicks, sessions and call clicks are not added together as leads, unique people or jobs. Snapshots do not accumulate prior totals.

## Explicit setup, after mapping existing authorized properties

1. Copy `config/seo.example.json` into ignored `private/seo-config.json`. Leave `enabled: false` until the existing properties and access are confirmed.
2. Set an inclusive start/end window of 1–31 days. Prefer settled past dates; recent results can change. Source calendar time zones differ. Search Console uses Pacific dates, GA4 reports its property time zone, and GBP retains provider calendar dates without assuming a time zone.
3. Enter the actual identifiers and set each `mappingConfirmed` only after verifying it belongs to this business. GSC accepts the exact wisdomscreen.pro URL-prefix or domain property and filters pages to the exact HTTPS website host. GA4 requires its numeric property ID and filters the report to hostName wisdomscreen.pro. GBP requires its verified numeric performance location ID. Omit unavailable IDs as `null`.
4. Supply existing authorized, unexpired tokens through the current process environment: `GUTTERS_GSC_ACCESS_TOKEN`, `GUTTERS_GA4_ACCESS_TOKEN`, `GUTTERS_GBP_ACCESS_TOKEN`. Never put tokens in the config, Git, an issue, command arguments or report. Existing GSC read-only and Analytics read-only access are sufficient; GBP performance requires Google's business.manage scope even though this tool only reads. This PR creates no credential or OAuth grant and implements no refresh flow.
5. Explicitly enable and run `node tools/seo-collect.mjs private/seo-config.json` locally. Nothing schedules this command. Results go only to ignored `private/seo/` as create-only timestamped JSON. On Windows protect the project/user folder with the existing account ACL; POSIX mode bits alone do not set a Windows ACL. Do not publish the private folder or reuse Perfect Timing storage/routes.

Exit code 0 means the command saved the report (it can still be explicitly disabled or have no data); 2 means a source lacks inputs or failed; 1 means configuration/output failed. Inspect each source state. Missing metrics are `null`, not zero. The documented GBP exception is a **present** datedValue with no value field: Google defines that as measured zero. Missing dates or series remain incomplete; GBP totals require every date in the requested window. Duplicate dates/series are rejected, not summed twice. Provider error text is not persisted or logged. Calls and response-body reads share a 20-second abort deadline; redirects are rejected and tokens go only to fixed official endpoints.

The website does not yet have a verified GA4 measurement ID/tag. Historical GA4 data may be unavailable even with report access. Adding a tag requires identifying the correct stream and reviewing the site's tracking/consent setup; this collector activates none. Confirm profile hours, service areas, photos, branding and setup prompts in the signed-in Google profile separately. No completion percentage is assumed.

## Verification and limits

`node --test tests/seo-collector.test.mjs` uses synthetic mocked providers only, plus a disabled CLI run. It checks scoping, opt-in behavior, unknown versus zero, provider failures, redaction, duplicate handling and private output. Run the full existing Node/Python/build checks before pushing. Actual API authorization and numerical reconciliation against the corresponding provider report remain required before calling collection operational. Different providers' totals need not agree.

Primary API contracts checked October 28, 2026:

- [Search Console aggregate query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)
- [GA4 Data API runReport](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport)
- [GBP multi-metric performance](https://developers.google.com/my-business/reference/performance/rest/v1/locations/fetchMultiDailyMetricsTimeSeries)
- [GBP zero and dated-value semantics](https://developers.google.com/my-business/reference/performance/rest/v1/TimeSeries)
