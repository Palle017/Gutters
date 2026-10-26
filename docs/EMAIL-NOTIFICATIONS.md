# Inquiry email and owner alerts

Customers can optionally supply a reply email. Phone-only requests and pending
v2 retries from older pages remain valid. The email is saved as minimal contact
data in the existing answers snapshot; the four quote-detail columns are unchanged.
The owner inbox provides an email link even when automatic alerts are disabled.
The new field is revealed only after the API advertises `capabilities.replyEmail`.
Blank email is omitted from the original v2 payload. Publishing the frontend
before upgrading an older API therefore retains the working phone-only flow.

When enabled, new inquiries and customer website replies atomically queue a
notification with the saved request/message. Owner replies, photos and estimates
do not trigger these alerts. Existing requests are not backfilled when enabling
the feature. John receives an email at one configured address and can press Reply
to email a customer who supplied an address. Direct email replies are separate
from the private website conversation and are not imported or synchronized.

## Activation

Delivery is disabled by default. This source release does not create an account,
buy service, verify a domain, provision credentials or send messages. Use a
dedicated Resend account/key or an explicitly approved sender for this business;
never copy Perfect Timing credentials. Confirm the owner recipient and verify
the sending domain before setting protected `/etc/gutters/gutters.env` values:

```text
GUTTERS_EMAIL_ENABLED=true
GUTTERS_EMAIL_FROM=alerts@YOUR_VERIFIED_DOMAIN
GUTTERS_EMAIL_TO=YOUR_VERIFIED_OWNER_EMAIL
GUTTERS_RESEND_API_KEY=YOUR_SEND_ONLY_KEY
```

Use plain validated email addresses for From and To. The authenticated From is
fixed; customer input can only supply Reply-To, never a recipient, sender, URL
or header. Phone-only requests omit Reply-To and tell John to use the callback
number. Notifications contain contact/message text and a protected owner inbox
link; they contain no owner key, guest capability or photo attachment. Confirm
that the chosen provider is authorized to process this contact information.

Inspect current service/configuration and use the existing verified backup and
upgrade procedure before activation. Restart only `gutters.service` after the
approved configuration change. Do not change Pages, DNS or shared routes merely
to enable this sender. Disabling the flag stops dispatch and new enqueueing while
retaining previously saved notifications and customer records.

## Delivery evidence and retries

The worker sends through the fixed HTTPS Resend email endpoint and refuses
redirects. Each notification freezes its exact JSON payload and idempotency key.
[Resend retains keys for 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys);
this worker holds work for review after 23 hours from the first attempt, after
six attempts, or when the frozen sender/recipient no longer matches configuration.
Initial unsent inquiries older than 24 hours expire for manual review. Processing
claims have a 60-second lease; an interrupted worker can retry the original key
after that lease. Stale workers cannot overwrite a newer attempt's result.

Only one message is processed at a time, with a ten-second network deadline,
bounded backoff, and at most 50 provider attempts per UTC calendar day. This is
an attempt ceiling, not a dollar budget or a promise of recipient delivery.
The server runs the worker only when the flag and required credentials are set.

`accepted` means the provider returned an email ID. It does not establish inbox
arrival, that John read the email, or that he contacted/booked the customer.
Pending, failed and unconfirmed states are visible only through authorized owner
readback. No customer-facing success message claims that an email was delivered.
After an uncertain result, inspect the provider log and John's inbox before any
manual resend; never reset a stale key and blindly send a duplicate.

## Required live acceptance

After provider activation, use one clearly labeled synthetic public inquiry with
a controlled reply address. Verify the saved conversation, actual owner inbox
arrival, and Reply-To recipient. Confirm an exact browser retry creates no extra
conversation or queued alert. Verify one customer follow-up, recovery across a
service restart, and the failure/uncertainty display. Confirm phone-only requests
still work and original database records are preserved. Do not claim launch
completion from mocked tests or the provider's accepted response alone.
