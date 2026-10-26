# Gutters website messages

Independent Node.js 24–26 HTTP service using the built-in `node:sqlite` module. No packages or paid providers are required. It binds only to loopback. The static website can live on GitHub Pages; a separately configured HTTPS reverse proxy is required before public browser submission is enabled.

## Data

The SQLite database is named `gutters.sqlite3`; production path `/var/lib/gutters/gutters.sqlite3`. Contact names and callback numbers are saved with each conversation. `quote_details` has only the requested business columns: `address`, `size_of_home`, `stories` (1, 2 or null), and `gutter_length`, plus its technical conversation foreign key. Home size and gutter length are raw optional text. No units, formula, price, material, rate, lead stage, marketing attribution, SMS, AI or calendar behavior is defined.

Optional details are the customer's initial message. Optional fields distinguish provided, unknown, and later states; unknown/later do not fabricate customer messages or measurements. John can edit only the four quote details in the private inbox. Those edits preserve the initial customer snapshot and transcript.

Technical tables hold message sequences, hashed guest access, idempotent operation receipts, schema version and rate limits. Transactions save the contact, requested quote details, transcript and receipt atomically. The service acknowledges only committed writes. SQLite uses WAL and FULL synchronous mode. This protects local transaction durability, not against loss of the server or disk.

## Run and verify

Use `.env.example` as a key-name reference; do not commit runtime values. Generate the owner key from 32 cryptographically random bytes and encode as base64url. Its exact length is 43 characters. Provide environment values using the protected systemd EnvironmentFile or a private shell session. Do not put keys in command arguments, URLs, logs or public website configuration.

```text
npm test
npm start
```

`GET /healthz` returns only service/storage readiness. The owner inbox is `/owner`. Its access key stays in page memory; it is sent as a bearer header, never as a query parameter or browser storage value. Reloading/closing requires entering it again. The tab preserves an uncertain owner reply's operation ID and message separately in session storage so a reload can reconcile the original receipt without duplicating a reply. That pending text is sensitive; use a private trusted device.

## Browser contract

`POST /conversations` accepts version 2 `{schemaVersion,conversationId,operationId,accessToken,intake,answers}`. Questions are name, phone, details, address, homeSize, stories, gutterLength, in that order. Only name and phone are required. `intake` contains only the provided camelcase keys; no source, consent, vehicle or unrelated fields. UUIDs and a random 32-byte guest capability are created before sending. Matching retries reuse the exact original operation and access. Changed content or actor under the same operation ID returns 409.

`GET /conversations/:id?after=:sequence` returns at most 100 ordered messages with a contiguous cursor, `conversation.repair` initial snapshot and `fieldStates`. `POST /conversations/:id/messages` accepts `{operationId,body}`. `GET /conversations/:id/operations/:operationId` reconciles an uncertain request. All three require that conversation's bearer capability and an exact allowed browser origin. Guest access expires after 90 days or on owner revocation; it grants access only to one conversation and does not verify a customer identity.

Protected owner routes list/read messages, save replies, edit the four quote details and revoke private links. Owner writes require a valid bearer key and `Origin` equal to `GUTTERS_PUBLIC_ORIGIN`. Native/provider identity headers are not accepted as authorization. No messages are sent outside this website service.

Exact CORS origin `https://palle017.github.io` cannot distinguish different repository paths on that shared origin. Guest bearer capabilities remain the per-conversation authorization boundary. Customer private-link pages must retain no-referrer behavior, strip their fragment before fetching, and avoid third-party/analytics code. Configure only the known website/preview origins.

## Ubuntu preparation

Deploy a reviewed source commit under `/opt/gutters/releases/<commit>/server`, then point `/opt/gutters/current` at its release parent. Use a dedicated nonlogin `gutters` user, `/var/lib/gutters` mode 0700, and `/etc/gutters/gutters.env` mode 0600. The included service requires loopback port 18965 and writes only `/var/lib/gutters`. Do not overwrite unrelated listeners, services, Tailscale routes or reverse proxies. A prepared loopback service is not a publicly connected website.

The owner key is an operational secret shared only with authorized operators. Rotate it by replacing the protected environment value and restarting this service. Guest tokens are stored only as SHA-256 hashes; customer return-link access is separate from owner access. Revocation retains all saved data.

Back up SQLite using its online backup API or `sqlite3` `.backup`, never a bare copy of the main file while WAL writes may be active. Keep backups private and verify integrity plus a restored copy before relying on them. Source rollback must preserve the current database; schema version 1 contains no destructive migrations. Server/disk backup scheduling and an eventual public route remain deployment work, not properties proven by local tests.

## Reuse provenance

This is fresh independent server code. It applies generic browser protocol patterns documented in the public `Palle017/fixingfortmyers-site` customer-conversation modules: scoped guest return links, typed optional answers, stable operation identities, plain-text messages, durable acknowledgments and uncertain-write reconciliation. It contains no private Perfect Timing backend source, endpoint, database, credential, customer record or provider integration.
