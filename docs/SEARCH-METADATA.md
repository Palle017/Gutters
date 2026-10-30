# Search metadata

The sitemap includes every indexable HTML page's canonical URL. Customer return access remains `noindex,nofollow,noarchive` and is excluded, alongside owner/API routes. `tests/seo-foundation.test.mjs` checks coverage against the actual pages so a new service or guide cannot silently be omitted.

The homepage title describes the existing gutter and screen services and Southwest Florida coverage. Its Organization JSON-LD reuses the public brand, phone and region in [BUSINESS-FACTS.md](BUSINESS-FACTS.md) and the Google profile link already visible on the homepage. No hours, street address, geo coordinates, pricing, logo or rating is inferred. Update the visible page and source record together when confirmed facts change.

This is Organization markup, not a claim of LocalBusiness rich-result eligibility. Google's LocalBusiness feature requires a physical address; this service-area business has no verified public street address in the source record. Organization markup has no required properties and can describe the verified identity without publishing a home address. Google does not guarantee a special search appearance or indexing.

Primary references checked October 28, 2026:

- [Google Organization structured data](https://developers.google.com/search/docs/appearance/structured-data/organization)
- [Google LocalBusiness requirements](https://developers.google.com/search/docs/appearance/structured-data/local-business)

These changes are source-only. After a separately authorized Pages publication, verify the deployed sitemap and homepage readback, validate the published markup, then submit the sitemap through the actual Gutters Search Console property. No Google account or property was changed by this PR.
