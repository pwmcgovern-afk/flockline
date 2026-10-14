# October 14 evidence and reliability audit

Verdict: **GO-WITH-RISKS** for the public map, factual Insights, and historical-context pilot. This is not certification of biological rarity or a claim that every possible technical failure has been eliminated.

## Scope and ground truth

Critical flows: discover reports in Insights; open a species on the map and change its date/region; read a source-linked sighting and its historical context; browse a weekly issue and open regional signup; ask a birding question and navigate to a supported location. Signup verification stops before sending mail. No email, cron delivery, account changes, or data-access agreement was triggered.

The audit started from clean main `a23a15f2005fa3da5f8d6405c719e59667ec3f60`, verified as the Ready production deployment `dpl_DGFht4BKs95i7UwRx9iowe9BXdqh`. Vercel Git integration is active. GitHub Actions on the exact commit passed. README's earlier manual-only deployment claim was stale and is corrected.

`flockline.app` and `flockline.vercel.app` serve the app. `www.flockline.app` redirects permanently to the apex. The project and branch aliases are SSO-protected. Production contains the eBird, Anthropic, Blob, Resend, sender, segment, topic and cron/signing configuration. Preview and development contain only Blob configuration, so their source-dependent flows are not production-equivalent. The connector's environment-list operation returned 403; the authenticated CLI provided the names. No secret values were needed.

## Findings and fixes

| Severity | User-visible finding | Resolution |
| --- | --- | --- |
| Risk | Nationwide map and nearby Ask inferred state from the nearest state center. Bryant Park and Brooklyn appeared in New Jersey; Salton Sea in Arizona; Huntley Meadows in D.C. | Removed all centroid guesses. State-specific endpoints and explicit source metadata remain authoritative. Unassigned country-feed reports stay plotted with “State not supplied”; state totals exclude them. Nearby Ask checks exact public-hotspot records with bounded cached lookups. Unknown states cannot create misleading map actions. |
| Risk | Ask hid the 10,000-row notable and 200-row nearby result caps. | All source tools retain scope and incomplete-coverage messages. Counts are described as the available selection. |
| Risk | Null/invalid coordinates could become `(0,0)`, and a tool-loop preamble could be returned as the answer. | Strict coordinate validation, a 12-tool budget, and an explicit incomplete-work response with no map action. |
| Risk | Browser timeout was 45 seconds, but the model SDK could retry and wait far longer. Taxonomy had no timeout. | One 35-second deadline propagates through model and source calls, retries are disabled, taxonomy is bounded to six seconds, and client disconnects cancel work. |
| Risk | A temporary failed state remained absent from cached Insights for six hours or roundup for one hour. | Partial failures bypass memory, CDN, and browser caches. Capped but otherwise successful selections remain cacheable. |
| Risk | Prewarm regressed archived empty-audience editions from `no_recipients` to `prepared`. | Completed preparation is skipped; delivery retains its existing late-subscriber reconciliation. Durable receipts now record operation, phase and sanitized failure evidence. |
| Risk, pending | Midwest's October 12 prepared issue was never archived. | A guarded repair script validates the original snapshot, date/scope, artwork and absent archive. Dry-run passed; publication awaits Pat's explicit approval. It never sends email or generates replacement reports. |
| Wording | Same-place/time grouping was presented as confirmed shared outings and independent sightings. | Labels now say “report groups” and explain the heuristic. Every checklist remains linked. |
| Wording | Map status reduced accepted/rejected/pending states to “Reviewed” or “Recent”; signup promised an exact arrival time. | Shared review-status labels now apply to map details. Signup describes Monday mornings and the usual scheduled time. |

## Evidence

- The live national Sora feed ignores `detail=full` for state metadata. The corrected local loader retained all 540 returned reports in a seven-day sample, assigned none an invented state, and used one request (211ms in that measurement). Known state-selected requests still preserve their source scope. Exact nearby hotspot `L2987656`, Main Street Park in Brooklyn, is `US-NY`.
- Source comparisons included Bryant Park `S402107527`, Salton Sea `S402131770`, Huntley Meadows `S401983759`, Brooklyn `S402304279`, and Mt. Davidson `S401148419`. Coordinates are source coordinates, not state centers.
- The prior historical-context release verified Mt. Davidson's October 10 Red Crossbill record (`redcro2` maps to `redcro`), 16 birds. The San Francisco October 8–14 baseline is 0.28482% across 3,511 complete checklists from 2016–2025. Red-breasted Nuthatch in the same period is 7.86101%. Gazos Creek is in San Mateo and cannot inherit San Francisco's baseline.
- A 3-day nationwide notable response reached 10,000 raw rows, representing 5,738 unique species/checklist pairs and 548 species. These are a capped sample, not a national census. Core deduplication preserved this distinction.
- Midwest's original preparation is dated October 12 at 13:07:43 UTC with six findings and six illustrations. Its 13:47 check was ready with no recipients. The final saved delivery state was prepared, unarchived, without a broadcast ID. Vercel rejected historical-log retrieval as beyond retention. The precise missing-delivery cause remains unknown; no empty log query was treated as proof of no activity.
- The pinned Ask model `claude-opus-4-8` remains active according to [Anthropic's official model documentation](https://platform.claude.com/docs/en/models/opus-4-8/overview). A live factual Ask request returned 200 in 2.382 seconds. Insights and weekly prose use no language model. Local invalid-key handling returns a safe actionable error.

## Validation and limits

Clean dependency installation and security audit passed with zero reported vulnerabilities. Local Node 25 produced engine warnings because the project and CI require Node 22; GitHub Actions verifies the release on Node 22. The transitive `whatwg-encoding` deprecation remains non-blocking. No direct dependency upgrades were made solely for version drift. Known-token-prefix scans found no matches in tracked Git history or the built browser output; this is not exhaustive secret detection.

Regression coverage includes county/date/taxonomy baseline guards, source caps, unknown-state handling, null and out-of-range coordinates, model/tool deadlines, client disconnect, tool exhaustion, recovered-state caches, delivery-state preservation and safe archive recovery. The real installed Anthropic SDK was exercised against an intercepted hanging request: a 40ms test deadline stopped it at approximately 42ms, without retries or an external model call.

Production map, Insights, roundup preview, archive, methodology, newsletter, and sighting routes loaded. Phone checks use 375px width. The user's Chrome extensions emitted message-channel and MetaMask warnings; isolated browser tests distinguish those from product regressions.

## Remaining work

- **Risk:** historical coverage is one county and pooled across years. Nationwide denominators, annual recurrence, effort-adjusted count distributions and defensible rarity thresholds remain incomplete. Pat's terms approval for the prepared Cornell EBD/SED request is pending; Cornell access approval and birder validation are separate steps.
- **Operational limit:** Ask now has shared private-store admission quotas and bounded sanitized failure samples, documented in `docs/ASK_RELIABILITY.md`. Request quotas are not a dollar ceiling. Samples are best effort, not full error tracking or alerting. No external monitoring test event was performed.
- **Risk:** the Midwest archive repair is prepared but unapplied. No catch-up email should be inferred or sent. Its exact historical failure cause is unavailable.
- Local Express now uses the production handlers. Invalid scopes, cache headers, method guards and Ask disconnect behavior have direct parity tests. Ask citations now link only to retrieved source records and show plain-language review status.
- Cornell media can challenge automated requests; known embeds and illustrated fallbacks remain. OpenStreetMap public tiles remain best effort. These existing external dependencies are not reliability guarantees.

## Release proof

Local validation: 351 unit tests, TypeScript and client/server builds passed. The browser suite passed 34 Chromium scenarios and 17 WebKit scenarios, including returning to a scope after a transient source failure. Clean installation and audit reported zero vulnerabilities. Final Git SHA, CI, deployment and live smoke verification belong in the release pull request and the dated Flockline project log, so deployment evidence is not inferred from these local results.
