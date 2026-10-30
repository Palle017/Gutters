# Website telemetry draft

Prepared from reviewed main `23fb8fbaa4af30153de706525c6e4e5b98264ce5`.
This PR prepares source only. It does not install tracking on the public site,
deploy the service, run Pages, configure DNS, enable notifications, or connect
the owner dashboard. `telemetry-config.js` is disabled with an empty measurement
ID. The numeric GA4 property ID belongs in the private reporting collector,
not this public setting. Only the separate public `G-…` measurement ID belongs
in this file after the Gutters stream is independently verified.

## Event contract

| Event | Trigger | Data |
| --- | --- | --- |
| `page_view` | One sandbox handshake per public page load | Fixed canonical Gutters URL and fixed brand title; blank referrer |
| `contact_click` | Phone, email, or SMS link click | Fixed `contact_channel`: `phone`, `email`, or `sms`; never destination or link text |
| `quote_request_saved` | Matched durable intake operation receipt plus final conversation/photos readback | No customer or request-specific parameters |

A phone click measures intent to open a dialer. It does not prove an answered
call. Email/SMS clicks do not prove a sent message. A saved request is not an
issued estimate, purchase, or collected revenue. PR [#21](https://github.com/Palle017/Gutters/pull/21)
extends the private collector with counts of the two custom events and their
separate GA4 key-event counts. No custom contact-channel dimension is required
for that collector. Marking an event as a GA4 key event is separate property
configuration; this source does not change it.

The estimate flow preserves the same body and operation after uncertainty.
It does not emit for form submission, a failed/mismatched receipt, or a failed
readback. The `analyticsRecorded` marker is persisted in the existing pending
request before attempting the event. Reload and retry preserve it. This gives
at most one analytics attempt per retained request context, not globally exact
delivery. Ad blockers, disabled tracking, storage failure, a closed tab, a lost
frame, and provider failure can undercount. There is no analytics retry that
could duplicate or alter a business request. SQLite remains the source for
actual saved-request counts.

## Privacy boundary

The adaptation follows the public Fixing Fort Myers pattern of fixed coarse
events, omitted customer fields, and receipt-confirmed success. Reference:
`Palle017/fixingfortmyers-site`, `site.js`, public contact metrics and the
receipt-confirmed intake path, read only on 2026-10-30. No automotive behavior,
provider credentials, endpoints, or customer storage are reused.

The parent page loads only local bootstrap scripts. The Google tag is confined
to a hidden `sandbox="allow-scripts"` iframe, without `allow-same-origin`.
That opaque context cannot inspect the estimate form, the parent DOM/session
storage, cookies, selected photos, private return links, or owner authorization.
The frame has no referrer. Its CSP restricts scripts and connections. No tag is
loaded on `customer.html`, owner routes, unknown paths, previews, DNT/GPC opt-outs,
or when configuration/storage is unavailable. The frame also refuses to load a
tag when opened directly without the expected parent handshake.

Only fixed allowlisted public paths, coarse event names/channels, and a random
numeric analytics client ID enter the frame. The random ID is retained only in
the current tab's session storage, separately from request state. It does not
contain or derive from a customer identifier; another tab/session can count as
another user. Every event and tag configuration override `page_location`,
`page_referrer`, and `page_title`; query, fragment, dynamic title, referrer,
message text, field values, request/operation IDs, phone/email, address, access
keys, photo names/content, and private links are never passed. Ad personalization
and Google signals are disabled. No third-party code executes in the form's
origin context.

## Validation and release gate

`npm test`, Python deployment tests, and `npm run build` cover the existing
SQLite durability/retry/auth behavior and static artifact boundaries alongside
synthetic telemetry/UI checks. `node tools/check-telemetry-browser.mjs` uses a
fresh headless installed Chrome with all requests locally fulfilled or blocked.
It enables a synthetic ID only inside intercepted fixtures. The Google SDK is
stubbed, and intake/receipt responses are synthetic. The harness verifies real
sandbox/CSP script execution, handshake, parent isolation, sanitized tag commands,
uncertain-send suppression, exact retries, durable success, reload suppression,
and private-page exclusion. It never uses John's profile or sends real events.
Set `GUTTERS_CHROME_PATH` if Chrome is not available through Playwright's `chrome`
channel. No browser download is needed on this laptop.

Before an independently authorized release:

1. Verify the Gutters property/stream and `G-…` ID. Disable **all Enhanced
   Measurement**, especially browser-history page views, form interactions,
   outbound links, downloads and user-provided data features. Automatic
   collection must not bypass this fixed schema. Keep any Ads integrations off.
2. Validate the real Google tag in this opaque sandbox with synthetic records,
   its effective provider configuration/CSP, and actual GA4 receipt and session
   behavior. The harness proves local isolation and tag commands; it does not
   prove the remote Google SDK works without cookies in an opaque origin or
   preserves a GA4 session across page loads. Only the anonymous client ID is
   retained by the parent; the sandbox cannot persist GA4 session cookies, so
   sessions may restart on navigation. This is an unresolved compatibility
   check, not evidence that the draft can already supply accurate sessions. Do
   not enable the public config until that check succeeds. Use a separate test
   stream for this check to keep test events distinct from business reporting.
3. In a separately reviewed change, set only the verified public measurement ID
   and enable tracking. Publish only through the authorized release workflow,
   then confirm actual event receipt. Review the public privacy disclosure for
   the final collection behavior before activation.

Google's [manual page-view guide](https://developers.google.com/analytics/devguides/collection/ga4/views?technology=websites)
explains that `send_page_view: false` alone does not disable Enhanced Measurement
history events. The [GA4 configuration reference](https://developers.google.com/analytics/devguides/collection/ga4/reference/config)
documents the explicit page context, client ID, and advertising controls.

Configured account access, prepared source, installed tracking, provider event
receipt, collector snapshots, and active dashboard reporting are distinct states.
This draft establishes only prepared and locally verified source.
