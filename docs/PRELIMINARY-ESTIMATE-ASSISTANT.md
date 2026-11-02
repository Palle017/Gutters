# Preliminary estimate assistant

Raj authorized this customer-facing, deterministic estimate flow on November 1, 2026, based on the prices and conditions in his screenshot handoff. The catalog is the sole rate source: [`site/pricing-catalog.json`](../site/pricing-catalog.json). The calculation code contains no hidden price table.

The assistant is a guided form, not a generative AI agent. It does not call a model or send customer text to an AI provider. It handles one service per request, labels measurements as customer-provided, and asks John to review unknown details and unpriced work. The existing manual owner estimate, private draft, preview, and explicit publish flow remains the final pricing step.

## Catalog rules

- Seamless gutters: one-story installation is $10 per linear foot below 100 total feet and $8 per foot above 100 total feet. Two-story footage is $12 per foot. Downspouts are counted separately at $100 for one-story and $200 for two-story, with one standard downspout noted as approximately 10 feet. Mixed-story footage is collected separately. Exactly 100 total feet is sent for owner review because the handoff does not assign a rate.
- Standard screens: lower wall $35, upper wall $75, lower Florida Glass $55, lower pet screen $75, picture windows $3.50 per square foot. Oversized or damaged-frame work is sent for review. Super Screen doubles only standard lower and upper panel rates.
- Pool enclosure panels: standard mesh is $45 lower, $75 upper, and $100 roof; Super Screen is $90, $150, and $200 respectively. Unusual sizes and frame or structural concerns need owner review.
- Pool restoration: rescreening from approximately $900 is displayed as a reference only; cleaning is a $150–$250 range; hurricane cables are $150 each; painting, rescrewing, and new screening is a $1,000-per-run reference, excluded from subtotal until John defines a run.
- Whole-home window rescreening is $30 per screen only when all window screens are serviced and frames can be reused. Partial, custom-size, or repair work needs John’s price.
- Sliding patio screen door rescreening is shown as a $40–$45 range per existing door. Complete door replacement is not priced by this rate.
- Aluminum screen door replacement has a $420 reference, excluded from subtotal until John confirms whether the amount includes the door, material, and hardware.
- Existing regular screen door sections are $30 bottom, $35 top, or $65 for both. Complete door replacement is not priced by these section rates.

## Customer and release behavior

- The customer sees preliminary amounts and review notes before submitting contact details. Submission is still an explicit action. Only then does the existing request service receive the generated summary, contact details, and any selected photos.
- No appointment is booked, no customer message is sent automatically, and no email/SMS notification provider is activated.
- The assistant falls back to the existing manual estimate request form if its catalog cannot be loaded or validated.
- GitHub Pages publishes the catalog as a public asset. The Node service's optional static mode and local previews serve the same file as JSON. The build permits only this named JSON asset; private records and server files remain excluded.
- The prices remain a dated screenshot transcription. John must confirm the catalog is still current before treating any preliminary amount as a final estimate.

## Verification

Run `npm test` and `npm run build`. Browser acceptance should use synthetic answers and stop before submitting a customer request. Production acceptance reads the public page and catalog; it does not create a live customer record.
