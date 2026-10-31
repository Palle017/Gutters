# Meta message intake, phase 1

Source only. The webhook is off until `META_INTAKE_ENABLED=1`. This change does not deploy the Ubuntu service, publish GitHub Pages, edit DNS, or place tokens in Git.

People who message Everything Screen and Gutters on Instagram, Facebook Messenger, or a Meta ad can be walked through a fixed set of questions: job scope, name, phone, service address, and the soonest estimate window. A finished conversation is saved as a normal lead in the existing Gutters SQLite database and shows up in `/owner`. The bot does not calculate a price. It tells the customer that John will confirm the estimate. John's public number in the replies is 239-355-3686.

The intake is separate from Fixing Fort Myers and Perfect Timing. It uses the Gutters database, Gutters environment file, and the Gutters HTTPS route. It does not call those other services or reuse their credentials, storage, or routes.

## What is included

- `GET` and `POST /meta/webhook`. Both answer 404 until intake is enabled.
- `GET` checks `hub.mode`, `hub.verify_token`, and `hub.challenge` against `META_VERIFY_TOKEN` and echoes the challenge as plain text.
- `POST` checks `X-Hub-Signature-256` with `META_APP_SECRET` using a timing-safe compare of the raw body. A bad signature is rejected. The body limit is the same 24,000-byte JSON cap used by the other JSON routes.
- Messenger (`object: page`) and Instagram (`object: instagram`) messaging events are read. Echoes are ignored. A repeated message `mid` does not advance the conversation again. The handler commits the SQLite work and returns 200 before a live Graph send.
- The state machine is deterministic. It collects gutters, screens, custom screen doors, or other, plus a short description, then name, a callable phone number, the service address, and an estimate window. `stop` pauses the thread. `restart` starts a new request and leaves any lead already saved unchanged. Unknown address text such as "unknown" is stored as an empty quote address.
- Estimate openings come only from John's schedule file. The service offers the next three slots in `America/New_York`. If that file is missing or invalid, the bot asks for the customer's preferred day and time and does not invent openings.
- A completed thread creates one website-style conversation with source `instagram` or `meta_messenger`. Home size, stories, and gutter length stay empty. Existing email notifications stay off unless `GUTTERS_EMAIL_ENABLED` was already turned on.
- Outbound replies go through a Send API client. The default mode is `dry-run`, which stores the reply and does not call Graph. Live mode needs `META_SEND_MODE=live` and `META_PAGE_ACCESS_TOKEN`.
- An optional OpenAI-compatible rewrite hook lives in `server/src/meta-llm.mjs`. It stays off unless `META_LLM_ENABLED=1`. Phase 1 does not need it. If a model reply adds a `$` price the draft did not contain, the draft is kept.

Webhook posts use the existing public body-transfer slot. Health checks and ordinary inbox reads still do not.

## Run the simulator

From the repository root, with Node 24 or newer:

```text
node tools/meta-intake-sim.mjs
```

That runs a synthetic Instagram conversation against a temporary database, prints each bot reply, and prints the saved lead. Nothing is sent to Meta.

To exercise John's schedule instead of the preferred-time question, pass a file he has confirmed:

```text
node tools/meta-intake-sim.mjs --availability /path/to/estimate-availability.json
```

The last simulated answer is then `1`, choosing the first generated slot. Do not point this at the production database.

## Environment

Add these names to the root-only `/etc/gutters/gutters.env` when Raj is ready. Leave them unset until then. Do not commit values.

| Name | Purpose |
| --- | --- |
| `META_INTAKE_ENABLED` | `1` turns the webhook on. Any other value, including empty, leaves it at 404. |
| `META_VERIFY_TOKEN` | The verify token entered in the Meta webhook form. |
| `META_APP_SECRET` | Meta app secret used to check `X-Hub-Signature-256`. |
| `META_PAGE_ACCESS_TOKEN` | Page token for the Send API. Required only for live sends. |
| `META_SEND_MODE` | `dry-run` (default) or `live`. |
| `META_GRAPH_VERSION` | Optional. Defaults to `v21.0`. |
| `META_AVAILABILITY_PATH` | John's schedule file. Use a path outside the release directory, for example `/etc/gutters/estimate-availability.json`, so an upgrade does not replace it. |
| `META_LLM_ENABLED` | Leave unset. `1` enables the optional rewrite hook. |
| `META_LLM_BASE_URL` | OpenAI-compatible base URL, used only when the hook is enabled. |
| `META_LLM_API_KEY` | Credential for that endpoint. Never commit it. |
| `META_LLM_MODEL` | Model name for that endpoint. |

Restart only `gutters.service` after the protected environment changes. Do not rerun the first-install script. Preserve the database, owner key, dedicated user, and loopback listener.

## Schedule file John edits

Copy `server/config/estimate-availability.example.json` to the path in `META_AVAILABILITY_PATH` after John confirms the hours. The example hours are not his schedule and are not loaded automatically.

```json
{
  "timezone": "America/New_York",
  "weekdays": ["mon", "tue", "wed", "thu", "fri"],
  "hours": {"start": "09:00", "end": "16:00"},
  "leadTimeHours": 24,
  "slotMinutes": 120
}
```

`timezone` must be `America/New_York`. `weekdays` use `mon` through `sun`. `hours` are local start and end on those weekdays. `leadTimeHours` is the soonest a slot may begin, counted from the message. `slotMinutes` is the length of each opening. The bot offers the next three slots that fit. Editing the file takes effect on the next message. A missing file, broken JSON, or a different timezone makes the bot ask for a preferred day and time instead.

The offered window is not a booked appointment. John still confirms it.

## What Raj does before this can receive real messages

1. Create a Meta app for Everything Screen and Gutters. Add the Messenger and Instagram products. Connect John's Facebook Page and the linked Instagram professional account. Do not attach this app to Fixing Fort Myers or Perfect Timing.
2. Request `pages_messaging` and `instagram_manage_messages`. Complete Meta app review before production traffic. Development-mode access is limited to roles on the app.
3. In the Meta webhook form, subscribe the Page and Instagram account to the `messages` field.
4. Set the callback URL to the existing dedicated Gutters Tailscale Funnel host plus `/meta/webhook`. The recorded route to confirm on the machine is `https://serv2-linux.tail68bd87.ts.net:8443/meta/webhook`. Confirm that host and port still belong only to Gutters before using them. Add this path on that existing Funnel. Do not reset a shared Serve or Funnel config, change Porkbun DNS, or publish the webhook through GitHub Pages.
5. Put the verify token, app secret, and, only when sending for real, the page access token in `/etc/gutters/gutters.env`.
6. Leave `META_SEND_MODE=dry-run`. Enable `META_INTAKE_ENABLED=1` only after the signature check succeeds against the loopback service. Send one synthetic message. Confirm the lead in `/owner` and confirm no Graph send happened.
7. Switch `META_SEND_MODE` to `live` only after that dry-run receipt. Live sends can fail without losing the saved lead; the failure is stored on the outbound row and is not retried in this phase.
8. Ask John for the schedule file and set `META_AVAILABILITY_PATH` before expecting offered times.

Prepared source, a running service, and a publicly reachable webhook are separate states. This repository change is only the prepared source.

## What John does

- Confirm the weekday hours, lead time, and slot length, then give Raj the schedule file. Until that file is installed, customers are asked what day and time they prefer.
- Review new Instagram and Messenger requests in the existing `/owner` inbox. The list labels them Instagram or Messenger. The saved description includes the source value `instagram` or `meta_messenger`.
- Write any price himself in the existing manual estimate draft. The bot will not produce one.
- Customers can still call or text 239-355-3686.

## Phase 2

- Read free/busy time from John's Google Calendar instead of the static schedule file.
- Turn on the optional LLM rewrite hook for phrasing only, still with no automatic price, warranty, or invented appointment.
- Alert John when a Meta lead is saved. The current email notification switch stays off by default and is not a Meta-specific alert.
