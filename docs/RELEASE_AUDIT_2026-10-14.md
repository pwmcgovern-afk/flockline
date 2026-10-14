# October 14 evidence and reliability audit

Verdict: **GO-WITH-RISKS** for the public map, factual Insights, and historical-context pilot. This is not certification of biological rarity or a claim that every possible technical failure has been eliminated.

## Release verification

The audit below began before the follow-up fixes. The broader application audit concluded with [PR #71](https://github.com/pwmcgovern-afk/flockline/pull/71), merged main `b81aa3d85b8cb614047108f3b5b9fa645119a4a1`, production `dpl_2LjmMrA9uX4xMfMBGfLsworg6f27`. Vercel reported Ready with the exact SHA and `flockline.app` aliases. Exact-head PR CI `38642631743` and merged-main CI `38643131410` passed: 493 unit tests, TypeScript, client/server builds, dependency audit and Chromium/WebKit flows across desktop and phone sizes. Live Chrome verified both western report pages, the monthly evidence selector, source links and 375px layout. The release error/fatal log query returned no entries; this was a bounded observation, not an uptime guarantee.

Subsequent offline data work through [PR #78](https://github.com/pwmcgovern-afk/flockline/pull/78), main `7dac536736364efd0dc388be0aa755d599332ded`, did not alter the public app or four-county registry. Its exact-head and merged-main CI passed 493 JavaScript and 72 Python tests, builds/audit, 32 Chromium and 15 WebKit test cases (some cover multiple viewports). Production `dpl_DyjGjEssAaR7aENEpbLFiSzAar8L` is Ready on the exact merged SHA with production aliases. The [processing runbook](EBD_PROCESSING.md) records independent validation on 1,249,905 source checklists and all 68,688 candidate species-period cells. These results remain nonpublishable and do not expand public baseline coverage.

A wording follow-up found Ask starter questions still inviting rarity rankings, individual-bird movement and activity comparisons despite the tool limits. The suggestions now ask about recent reports. Local Chrome verified the revised text on desktop and at 375px, with no horizontal overflow; existing Ask citation, recovery and touch-navigation regressions pass. No model or source-tool behavior changed. A fresh production Sora check still shows the real Cornell embed, Helen Wang's credit/date/source checklist, the same-individual caveat, original observer note and 0.49% / 5,306-checklist county context. A fresh signed-in Cornell check still shows the existing access request under review.

## Original feedback: disposition

| Concern | Current behavior and evidence | Remaining limit |
| --- | --- | --- |
| Common or seasonal birds described as regionally rare | Insights and weekly prose use source facts and recency/geographic sampling, without a computed rarity rank. Ask suggestions request recent reports. The methodology explains why the notable feed can contain species expected elsewhere in a region. | Selection is not expert editorial curation or validated rarity classification. |
| A large flock used to infer widespread food-driven movement | Deterministic prose reports the source count and location without causal or movement claims. Archived web prose and future email rendering use the same policy. | Already-sent emails and the original Reddit post are unchanged. |
| No local historical baseline | Four counties have official 2016-2025 seasonal frequencies, complete-checklist samples, annual reporting evidence and year-specific source links. Unknown, exported zero and occurrence markers remain distinct. | Coverage is a four-county pilot. County frequency is not hotspot expectedness, encounter probability or count unusualness. |
| Slow Insights | National selection uses one bounded country feed, coalesces requests and reuses a short browser cache. It uses no language model. | Source latency varies. Measured timings are not an SLA; the capped feed is not exhaustive. |
| No state filtering | CT filtering existed and is verified in production and desktop/phone tests. Desktop now visibly labels its control Filters. | Discoverability can improve further with user feedback. |
| Missing Bryant Park Sora photos | Four Cornell photos from Helen Wang's October 12 checklist at the exact hotspot are embedded, with date, observer and source link. The October 14 featured checklist has no photos. | The app explicitly cannot confirm the same individual. General photo discovery remains bounded and best effort. |
| Sighting pages bury useful facts | Location, date, featured count and original checklist/map actions come first, followed by photos and observer notes. Detailed history and reporting lists expand on demand. Missing public-hotspot names are recovered from exact source IDs. | A missing/private source location stays unknown rather than being inferred. |
| Unclear purpose or superiority claims | The stated use is a quick map, shareable source-linked reports and a weekly selection. Methodology links the ABA's distinct expert-authored reporting. | Presentation preference and repeat-user demand are not established by technical tests. |

These changes address software behavior and evidence quality. They do not establish that AI-generated art appeals to the birding community or that Flockline replaces eBird or expert rare-bird reporting.

## Source-backed cases for independent birding review

The following are implementation checks, not expert-approved rarity labels. Compare the linked county sources and report pages, then record whether the scope, wording and prominence are useful to a local birder. All figures refer to October 8-14 during 2016-2025. The whole-month column separately considers all four October periods.

| Case and source | Pooled frequency / complete checklists | Matching periods with reports | Whole Octobers with reports |
| --- | --- | --- | --- |
| [Mt. Davidson Red Crossbill](https://flockline.app/sightings/S401148419/redcro), San Francisco | 0.28% / 3,511 | 5 of 10 | 9 of 10 |
| [Gazos Creek Red Crossbill](https://flockline.app/sightings/S401562944/redcro), San Mateo | 0.52% / 3,293 | 6 of 10 | 9 of 10 |
| Red-breasted Nuthatch, [San Francisco source](https://ebird.org/barchart?byr=2016&eyr=2025&bmo=1&emo=12&r=US-CA-075) | 7.86% / 3,511 | 9 of 10 | 10 of 10 |
| Red-breasted Nuthatch, [San Mateo source](https://ebird.org/barchart?byr=2016&eyr=2025&bmo=1&emo=12&r=US-CA-081) | 3.67% / 3,293 | 7 of 10 | 10 of 10 |
| [Bryant Park Sora](https://flockline.app/sightings/S402323216/sora), New York | 0.49% / 5,306 | 1 reported, 5 zero, 4 unknown | 2 reported, 4 zero, 4 unknown |
| [Belle Isle Nelson's Sparrow](https://flockline.app/sightings/S401644346/nstspa), Suffolk, Massachusetts | 0.8% / 2,243 | 6 of 10 | 10 of 10 |

Reported-year totals include occurrence markers, which do not establish an exact complete-checklist frequency. Missing rows are not zeros. The San Mateo nuthatch October 2018 and Suffolk sparrow October 8-14, 2024 markers are explicitly identified in the annual tables. None of these figures proves that a particular flock size is unusual.

Before adding any rarity labels, obtain independent local feedback on these examples and test held-out years, habitat specialists, familiar residents, scarce seasonal visitors, genuine local exceptions and under-sampled places. Choose sample/label thresholds from that validation, not from an arbitrary universal percentage. No independent birder sign-off has been obtained as part of this audit.

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

- **Risk:** historical coverage includes four counties (San Francisco, San Mateo, New York and Suffolk, Massachusetts), each with ten annual exports and pooled seasonal frequencies. Nationwide denominators, effort-adjusted count distributions and defensible rarity thresholds remain incomplete. The offline pipeline now passes independent checks on a larger real dataset, but no approved regional dataset has passed the provisional/query/sensitivity coverage review, and no new evidence type is integrated into the app. On October 14, a fresh signed-in visit to Cornell's data-request page showed an existing request under review. The page does not expose its contents or submission time, so it cannot establish whether the submitted request matches `docs/EBIRD_ACCESS_REQUEST.md`. No duplicate request or terms acceptance was performed during this check. Cornell access approval and independent birder validation remain separate steps. Original source exports remain outside the repository; provenance and import instructions are in `data/README.md`.
- **Operational limit:** Ask now has shared private-store admission quotas and bounded sanitized failure samples, documented in `docs/ASK_RELIABILITY.md`. Request quotas are not a dollar ceiling. Samples are best effort, not full error tracking or alerting. No external monitoring test event was performed.
- **Risk:** the Midwest archive repair is prepared but unapplied. No catch-up email should be inferred or sent. Its exact historical failure cause is unavailable.
- Local Express now uses the production handlers. Invalid scopes, cache headers, method guards and Ask disconnect behavior have direct parity tests. Ask citations now link only to retrieved source records and show plain-language review status.
- Cornell media can challenge automated requests; known embeds and illustrated fallbacks remain. OpenStreetMap public tiles remain best effort. These existing external dependencies are not reliability guarantees.

## Initial audit validation

Before the follow-up releases, local validation: 351 unit tests, TypeScript and client/server builds passed. The browser suite passed 34 Chromium scenarios and 17 WebKit scenarios, including returning to a scope after a transient source failure. Clean installation and audit reported zero vulnerabilities. The latest verified release and its CI/production evidence are recorded above; this earlier count is retained as the initial audit record.
