# Local website and estimate acceptance

Observed October 25, 2026 (America/New_York client date). This records the local browser acceptance run for the patriotic redesign and customer photo/estimate workflow. It does not assert a public deployment or changes to the existing Ubuntu service.

## Environment

- Website and API served together on `http://127.0.0.1:18966/` by the local preview launcher.
- Owner inbox at `/owner`; authentication used the local preview key without recording it here.
- Preview records and key are kept only in the ignored `.preview-data/` directory.
- Customer identity, request text, estimate, and reply used for acceptance were synthetic test data. The uploaded image was one of the supplied project photos.

## Browser workflow observed

| Step | Observed result |
| --- | --- |
| Customer request and photo | The customer submitted a request with a supplied project photo in a synthetic request, received durable saved-request confirmation, and opened the conversation’s private customer page. |
| Owner review | The authorized owner inbox loaded the saved request, original messages, quote details, and uploaded photo. |
| Manual draft | A synthetic work scope and **USD 125.00** were entered manually and saved as a private estimate draft. The customer did not receive the unpublished draft. |
| Preview and explicit send | The saved draft was previewed, then the owner explicitly selected **Send estimate to customer**. The service saved the published estimate and its customer-visible message. |
| Customer readback | The customer’s private page displayed the published synthetic scope and **USD 125.00** estimate. |
| Continued conversation | A customer reply was saved, and the saved reply remained visible after reloading the private page. |

**USD 125.00 was chosen only to test manual entry and delivery. It is not an actual business rate, advertised special, automatic calculation, or customer quote.** The supplied advertisements do not calculate or prefill this manual estimate amount.

## Supporting automated verification

The Node test suite checks request/message durability, operation replay and conflict handling, customer/owner authorization, cross-customer isolation, photo type/size/count restrictions, private BLOB persistence, draft visibility, atomic estimate publication, and safe optional static serving. Frontend checks cover customer intake, private return, replies, and uncertain-write retry behavior. Run `npm test` against the current checkout for the current results; no fixed test count is asserted here.

`npm run build` packages public `site/` assets only. The private preview database, uploaded customer BLOBs, owner access key, and customer return capabilities are excluded from the public build.

## State boundary

This acceptance run verifies the local same-origin workflow. The existing deployed Ubuntu listener on port **18965** was not replaced or reconfigured. No production photo form was activated, and no source commit, push, deployment, domain change, SMS, or email send was performed for this local work. The estimate “send” means publication inside the customer’s private website conversation.

No owner key, customer capability, private return URL, or customer record identifier is included in this document.
