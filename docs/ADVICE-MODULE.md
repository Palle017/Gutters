# Homeowner advice module
The later production instruction selects **Option A: browseable cards** for the small release. **Option B: a short guide** remains documented for Tony's future choice; it is not implemented or a dependency of this release. No advertising is activated.

## Two concrete options for Tony
| | A: browseable cards — recommended and implemented | B: short guided reading — documented alternative |
|---|---|---|
| Entry | Home/gutter service link -> one guide -> open any topic | Optional link -> where is water noticed? -> when? -> suggested reading |
| Behavior | All five topics available together, native HTML disclosures | Offer unsure/back/restart; show one or more of these same records, plus a link to all topics |
| Advantage | Least friction; searchable, shareable page; reading and disclosures work without JavaScript | May help someone who does not recognize a topic title |
| Tradeoff | More reading on one page | Adds interaction and can imply diagnostic certainty if worded badly |
| Contact | Optional call/text after useful advice | Equally optional; never gate results |
| Data | No answers collected | Keep selections in page memory only; no scoring, storage, backend, chat or diagnosis |

Tony can choose to keep the card format, request a lightweight guided view over the same content, or revise labels/order. John should validate the proposed examples and their technical wording. Do not say John authored or reviewed the guide before that review happens. There is no pending UI decision blocking the user-authorized card release.

## Shared model and publication
- `content/gutter-advice.mjs`: stable topic IDs, source provenance, safe observations, when gutter work may help, limits, next steps and source references.
- `tools/render-advice.mjs`: generates `site/gutter-advice.html` from that data, reusing the existing gutter-page header and footer. Run `node tools/render-advice.mjs` after content or shared header/footer edits. A parity test catches stale generated output.
- `site/css/gutter-advice.css`: scoped presentation; native `details/summary` disclosure behavior.
- Home and gutter service pages each link to the guide. Existing contact routes, offers, request/estimate workflow, backend and schema are unchanged.
- No runtime advice script or third-party service is needed. Only public `site/` files enter the existing static build. Internal provenance and strategy docs are not shipped.

**Recovered input:** `docs/JOHN-INTERVIEW-20261025.txt` verifies wet/soaking ground between nearby homes as an interview topic. It is a summary, not a verbatim transcript. No complete symptom list was recovered from repo history or the relevant local October 25 project records checked. Personal Context was unavailable. Four other records are proposed examples/routing, explicitly marked in the content source. Public wording is general education and makes no owner-authorship claim.

Guardrails: dry safe ground-level/indoor observations; no climbing, opening pipes, entering water or hazardous-weather observation; no water-intrusion diagnosis; no scare claims or promised repair savings; maintenance/repair before assuming replacement; no grading service; appropriate qualified inspection when the source/building concern is unresolved; no new price, offer, warranty or credential claims. General external sources support water-management concepts, not a local discharge design.

## Feature map and repeatable checks
Scope: the new guide and its two entry links, on Chromium desktop/mobile. No application-wide feature or accessibility audit is claimed.

| Stable feature | Entry and actual affordance | Source / expected result | Evidence |
|---|---|---|---|
| advice.discover | Home or gutter page: ordinary link “Read the homeowner guide” | `site/index.html`, `site/gutters.html` -> `gutter-advice.html` | Static tests cover both links; browser drives homepage entry |
| advice.read | Guide: five native `details > summary` controls | Generated page, shared content; mouse, Enter and Space toggle the same reading | Desktop, mobile and JavaScript-disabled browser journeys passed |
| advice.contact | Guide: optional call/text anchors after the advice | `tel:+12393553686`, `sms:+12393553686`; no form or saved answers | Target URLs asserted; actual calls/texts deliberately not placed |
| advice.route-uncertainty | Building concern and unclear-source cards | Readable limits and appropriate professional-assessment guidance | Both content parity and browser visible-reading assertions |

Source UI attributes: `main#main[tabindex="-1"]` skip target, `section[aria-labelledby="advice-heading"]`, five stable topic IDs, native summary controls; no custom shortcut handlers. Native Enter/Space behavior was exercised. The browser harness retains the live main accessibility snapshot for each run; labels and headings were inspected. Screen-reader, Safari/Firefox and complete site navigation coverage remain unverified.

## Verification — October 26, 2026
Base revision: `272ee52332329a1a9cb5cae280844fcf8e0077a9`. Isolated checkout on branch `feat/symptom-advice-options`; the pre-existing October 25 checkout had untracked work and was only read, not changed.

- Node 24.18.1 on Windows; `npm ci` succeeded with 0 reported vulnerabilities.
- `npm test`: **61 passed, 0 failed**. Includes all existing protocol/SQLite, private photos/estimates, fallback, frontend/static checks and two new shared-content/discovery checks.
- `npm run build`: **47 public assets** prepared; server/private data excluded. No workflow or domain configuration changed.
- `git diff --check`: passed.
- `node tools/preview.mjs --port=18974`: isolated loopback static preview.
- `tools/verify-advice-browser.mjs`: actual homepage link navigation, all five disclosures, mouse plus Enter/Space, visible building-concern guidance, contact target assertions, no data form, no horizontal overflow, no page errors, no failed responses and no external requests. Passed at **1280×900**, **390×844**, and **390×844 with JavaScript disabled**. Screenshots visually inspected.
- Raw local results, screenshots and accessibility snapshots: `C:/Users/LP15/2026-10-26/task/advice-browser-proof/`. These synthetic/no-customer artifacts remain local; they are not uploaded to a public viewer.
- Browser harness prerequisites: set `PLAYWRIGHT_MODULE` to a Playwright package entry; optionally set `CHROME_EXECUTABLE`, `ADVICE_PREVIEW_URL` and `ADVICE_EVIDENCE_DIR`. Playwright was installed into a temporary tooling directory, not added to application dependencies.

Production publication and hosted readback must be reported separately after PR checks/merge and the existing manual Pages workflow. HTTPS/domain readiness is owned by the separate domain task. No ad account, pixel, analytics integration, outbound communication or real customer record was used by this module.

## Advertising handoff
See [the qualified-call strategy](QUALIFIED-CALL-STRATEGY.md) for ranked organic/local channels, three educational briefs, optional qualification questions, actual-call/booked-job measurements and a paid test contingent on an explicit budget.
