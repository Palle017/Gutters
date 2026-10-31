# Gutters website messages

Independent Node.js 24–26 HTTP service using the built-in `node:sqlite` module. No packages or paid providers are required. It binds only to loopback. It can optionally serve the website and customer request pages from the same origin. A separately configured HTTPS reverse proxy is required before public browser submission is enabled.

## Data

The SQLite database is named `gutters.sqlite3`; production path `/var/lib/gutters/gutters.sqlite3`. Contact names and callback numbers are saved with each conversation. `quote_details` retains exactly the original business columns: `address`, `size_of_home`, `stories` (1, 2 or null), and `gutter_length`, plus its technical conversation foreign key. Home size and gutter length are raw optional text. No measurement formula or automatic price calculation is defined.

Optional details are the customer's initial message. Optional fields distinguish provided, unknown, and later states; unknown/later do not fabricate customer messages or measurements. John can edit the four quote details in the private inbox. Those edits preserve the initial customer snapshot and transcript. John can also write a separate manual estimate containing scope, a USD amount and optional notes. These fields are owner-authored; they do not introduce a rate, formula, tax calculation or automatic quote.

Customer project images are private SQLite BLOBs in `photos`, never static website assets. There are at most six photos per conversation and each image is at most 5 MiB. JPEG, PNG and WebP signatures must match their declared MIME and filename extension; SVG, executable signatures, truncated supported headers, mismatches and oversized uploads are rejected. Upload bytes and their idempotent receipt commit in one transaction. The service does not claim malware scanning or full image decoding.

`estimates` stores immutable saved drafts and their publication status. Saving a draft creates a new estimate number, leaving prior versions intact. Drafts appear only in authorized owner responses. Explicit publication atomically records a customer-visible estimate, an owner transcript message and its receipt. This sends through the customer's private website page. Optional owner email alerts for new inquiries/customer replies are disabled by default; see [activation and delivery evidence](../docs/EMAIL-NOTIFICATIONS.md). Publishing an estimate does not send customer email or SMS.

Technical tables hold message sequences, hashed guest access, idempotent operation receipts, schema version and rate limits. `feature_operations` adds receipts for photos, draft saves and sends without changing the existing message-receipt protocol. Reusing an operation ID for changed content, actor or operation type returns 409. Transactions acknowledge only committed writes. SQLite uses WAL and FULL synchronous mode. This protects local transaction durability, not against loss of the server or disk.

`/meta/webhook` is the phase-1 Instagram and Messenger intake. It stays disabled until `META_INTAKE_ENABLED=1` and it does not send to Graph unless `META_SEND_MODE=live`. Setup, the simulator, and John's schedule file are in [META-INTAKE.md](../docs/META-INTAKE.md). A completed social thread becomes a normal inbox conversation. It does not calculate a price. Email alerts remain off unless the existing notification switch is already enabled.

Optional customer email is minimal contact information in the saved answers snapshot. `owner_notifications` and `owner_notification_attempts` hold atomic notification intent and bounded delivery attempts. These additive technical tables do not change quote fields. Notification payloads remain private and include no access keys or photo attachments. Direct replies from John's email app go to the customer and are separate from website messages.

## Run and verify

Use `.env.example` as a key-name reference; do not commit runtime values. Generate the owner key from 32 cryptographically random bytes and encode as base64url. Its exact length is 43 characters. Provide environment values using the protected systemd EnvironmentFile or a private shell session. Do not put keys in command arguments, URLs, logs or public website configuration.

```text
npm test
npm start
```

`GET /healthz` returns only service/storage readiness. The owner inbox is `/owner`. Its access key stays in page memory; it is sent as a bearer header, never as a query parameter or browser storage value. Reloading/closing requires entering it again. The tab preserves uncertain reply/estimate operation IDs and their exact content separately in session storage so a reload can retry without duplicating a write. That pending text is sensitive; use a private trusted device.

To serve the checked-out `site/` alongside the API, set `GUTTERS_SERVE_SITE=true` in the private process environment. This is opt-in; the existing standalone API response at `/` remains the default. `GUTTERS_PUBLIC_ORIGIN` must be the canonical externally visible HTTPS origin, or the explicit loopback preview origin. The server always permits this configured origin for customer APIs. Static serving allows only public HTML/CSS/JS/image/font/text/XML types inside `site/`, rejects dotfiles and files outside that root (including symlink escapes), and leaves `/owner`, `/owner/api/*`, `/conversations*` and `/healthz` routed to the service. No runtime configuration has been changed by this source update.

## Browser contract

`POST /conversations` accepts version 2 `{schemaVersion,conversationId,operationId,accessToken,intake,answers}`. Questions are name, phone, details, address, homeSize, stories, gutterLength, in that order. Only name and phone are required. `intake` contains only the provided camelcase keys; no source, consent, vehicle or unrelated fields. UUIDs and a random 32-byte guest capability are created before sending. Matching retries reuse the exact original operation and access. Changed content or actor under the same operation ID returns 409.

`GET /conversations/:id?after=:sequence` returns at most 100 ordered messages with a contiguous cursor, `conversation.repair` initial snapshot and `fieldStates`, top-level `photos: []`, and top-level `estimate: null | {id,number,scope,amount,currency,notes,status,createdAt,publishedAt}` for the latest published estimate. `amount` is a canonical decimal string such as `1250.50`, `currency` is `USD`, and `number` looks like `ESG-000001`. No draft estimate or draft scope/amount is returned to a customer.

`POST /conversations/:id/messages` accepts `{operationId,body}`. `GET /conversations/:id/operations/:operationId` reconciles an uncertain create, message or photo operation. These routes require that conversation's bearer capability. Mutations require an exact allowed browser origin. Authenticated same-origin GETs can omit `Origin` (as browsers normally do); a supplied unapproved Origin is rejected. Guest access expires after 90 days or on owner revocation; it grants access only to one conversation and does not verify a customer identity.

`POST /conversations/:id/photos` accepts multipart form fields `operationId` (UUID) and `file` (one JPEG/PNG/WebP per call). Reuse the original operation ID and identical file on uncertain retries. The response is `{ok:true,photo:{id,filename,mime,size,createdAt},receipt:{operationId,photoId},duplicate?:true}`. Exceeding six saved images returns 409 `photo_limit`; an exact retry still succeeds at capacity. Metadata does not contain the image bytes, capability or a tokenized URL.

`GET /conversations/:id/photos/:photoId` returns private image bytes only with the matching conversation bearer capability. Use an authenticated fetch and a temporary blob URL for the displayed image. Never put the guest capability in an image URL, query string or public asset path. Responses use the sniffed Content-Type, `nosniff`, `no-store` and a private content disposition.

Protected owner routes list/read messages, save replies, edit quote details and revoke private links. Owner writes require a valid bearer key and `Origin` equal to `GUTTERS_PUBLIC_ORIGIN`. Native/provider identity headers are not accepted as authorization. An owner conversation GET additionally returns `quoteDetails`, `guestAccess`, `photos` metadata and `estimates` (up to 50 newest saved versions, including private drafts).

| Owner route | Result |
| --- | --- |
| `GET /owner/api/conversations/:id/photos/:photoId` | Authorized private image bytes; works for retained records even after guest-link expiry/revocation. |
| `POST /owner/api/conversations/:id/estimates` | Accepts `{operationId,scope,amount,notes?}`. Saves a private immutable draft, returning `{ok,estimate,receipt:{operationId,estimateId}}`. Scope is required, amount is a nonnegative USD decimal string with up to two decimal places, and notes are optional. No price is calculated. |
| `POST /owner/api/conversations/:id/estimates/:estimateId/publish` | Accepts `{operationId}`. Atomically publishes that saved version and appends its customer-visible owner message. Returns `{ok,estimate,receipt:{operationId,estimateId,messageId,sequence}}`. Matching retries return the same receipt; a new publish operation for an already published estimate returns 409. Expired/revoked customer access prevents a new send. |
| `GET /owner/api/conversations/:id/operations/:operationId` | Reconciles authorized owner reply, draft-save or publish operations. |

The owner workflow is review customer photos/request → enter manual scope, amount and notes → save private draft → preview the saved, unchanged version → explicitly send → verify durable readback. Editing after preview disables sending until the changed version is saved and previewed. Creating a revision leaves the customer's latest published estimate visible until John explicitly sends the revision.

Exact CORS origin `https://palle017.github.io` cannot distinguish different repository paths on that shared origin. Guest bearer capabilities remain the per-conversation authorization boundary. Customer private-link pages must retain no-referrer behavior, strip their fragment before fetching, and avoid third-party/analytics code. Configure only the known website/preview origins.

## Ubuntu preparation

Deploy a reviewed source commit under `/opt/gutters/releases/<commit>/server`, then point `/opt/gutters/current` at its release parent. Use a dedicated nonlogin `gutters` user, `/var/lib/gutters` mode 0700, and `/etc/gutters/gutters.env` mode 0600. The included service requires loopback port 18965 and writes only `/var/lib/gutters`. Do not overwrite unrelated listeners, services, Tailscale routes or reverse proxies. A prepared loopback service is not a publicly connected website.

The owner key is an operational secret shared only with authorized operators. Rotate it by replacing the protected environment value and restarting this service. Guest tokens are stored only as SHA-256 hashes; customer return-link access is separate from owner access. Revocation retains all saved data.

The HTTP adapter reserves one of its two buffered body/photo-transfer slots for an authenticated owner. The other admits one public transfer, with at most one per verified client address. Owner authorization includes the existing bearer and origin checks before reservation; spoofed owner paths or identity headers grant no capacity. Slow uploads/downloads keep their slot until application work and the response finish or close, with absolute deadlines. Health and ordinary bounded inbox reads do not need a photo/body slot. Busy responses require retrying the same operation and content. This bounds transfer concurrency; the retained 256 MiB systemd limit still requires real Ubuntu peak-memory measurement, including permitted 5 MiB photo transfers and owner activity.

One slow public request can occupy the only public lane for up to the 15-second ordinary or 75-second photo deadline; other public clients then receive a retryable `503`. A per-client cap does not add fairness at this default single-public-slot budget. The owner lane is protected from public transfers, but owner photos and writes share that lane and can return busy responses to each other. The inbox reports a busy response and keeps uncertain reply/estimate operations for an unchanged retry. These bounds do not promise uninterrupted public intake, and more slots require actual memory acceptance first.

Back up SQLite using its online backup API or `sqlite3` `.backup`, never a bare copy of the main file while WAL writes may be active. Keep backups private and verify integrity plus a restored copy before relying on them. Photos increase database/backup size by up to 30 MiB per conversation. Source rollback must preserve the current database. The photo/estimate tables are additive `CREATE TABLE IF NOT EXISTS` changes; existing tables/rows and schema version 1 remain intact. Server/disk backup scheduling and an eventual public route remain deployment work, not properties proven by local tests.

## Reuse provenance

This is fresh independent server code. It applies generic browser protocol patterns documented in the public `Palle017/fixingfortmyers-site` customer-conversation modules: scoped guest return links, typed optional answers, stable operation identities, plain-text messages, durable acknowledgments and uncertain-write reconciliation. It contains no private Perfect Timing backend source, endpoint, database, credential, customer record or provider integration.
