# Flockline UI/UX and bug audit, September 5, 2026

The audit covered the live map, species search, time windows and timeline, state and hotspot filters, field records, Insights, Ask, My Birds, Weekly Roundup, newsletter signup, archive, methodology, keyboard navigation, and responsive layouts. Confirmed defects were fixed in one branch.

## Findings and changes

| Priority | What a reader experienced | Change and verification |
| --- | --- | --- |
| High | “API KEY REQUIRED” watermarks covered the production map. | Replaced the CARTO layers with standard OpenStreetMap tiles, retained readable labels and linked attribution, and added a recoverable tile-load error. Visually verified actual map tiles. |
| High | On a 375px phone, the header signup form extended off the left edge and beneath the timeline. | Made signup a viewport-level, scrollable dialog with a persistent launcher. Checked 320×568, 375×812, and 812×375. |
| Medium | Editing signup values during submission could make the confirmation describe different editions than those requested. | Disabled submitted controls while waiting and included the submitted address in confirmation. Mocked success and failure; no real signup email was sent. |
| Medium | A docked side panel squeezed the desktop title and statistics into a narrow column. | Reflowed the header when the panel removes 400px from the map. Visually checked desktop and mobile layouts. |
| Medium | The keyboard skip link pointed at a missing element, panels did not receive focus, and field records required tabbing past the sighting list. | Added a permanent controls target and focus placement/restoration for drawers, field records, and the signup dialog. Tested Tab and Escape. |
| High | Changing filters could leave old bird dots beneath new filter labels. Clearing all states during an active request could leave loading stuck. | Matched displayed results to their full request scope, cancelled outgoing requests immediately, and restored the no-states recovery action. Tested delayed responses and cancellation. |
| Medium | A slow Insights response could land after changing regions. An empty selection could display an endless loading message. | Cancelled obsolete requests, guarded both fast and full responses, cleared results on scope changes, and added an actionable empty-scope state. |
| Medium | Pressing Enter before a new species search finished could select the previous query's single result. | Bound results and Enter selection to the resolved query and displayed a searching state. Tested a delayed nonmatching query after an exact match. |
| High | A configuration API error could place undefined lists into React state and crash the screen. | Validated the response before applying it, retained the starter catalog on failure, and distinguished unknown source status from demo data. |
| Medium | Back/Forward could retain later filters or pinned Insights settings. Roundup links did not restore the panel or edition. | Made every drawer addressable, serialized explicit filter values and the weekly edition, reset omitted history fields, and preserved intentional empty state selections. |
| Medium | A typo in an archive region/date could silently show the index or a different issue; archive outages offered no retry. | Added strict route and real-calendar validation, a missing-page view, cancellable requests, and retry controls. Email and archive map links explicitly reset hidden filters. |
| Medium | Stalled requests could keep map, AI panels, archive, or signup waiting indefinitely. | Added bounded JSON requests with caller cancellation and recoverable timeout behavior. Tested timeouts and cancellation separately. |
| Medium | A late Ask answer could redirect a map after its context changed; failures needed a dependable retry path. | Checked the current species, panel, and states before applying map actions. Preserved failed questions and prevented edits while a request is pending. |
| Low | Generated timestamps displayed UTC clock values as if they were local. Archive captions and links narrowly missed contrast thresholds. | Formatted generation instants in the reader's timezone while preserving eBird's observation-local times, and increased archive text contrast. |
| Medium | The Monday delivery guard rejected invocations beginning at 10:01 or later. | Allowed the intended Monday 10 a.m. Eastern hour, retained the existing region/date Resend idempotency key, and logged skipped, started, and completed runs. Tests cover daylight saving, standard time, delays, and the alternate UTC invocation. |
| Medium | The dependency audit reported a vulnerable `qs` version. | Updated the transitive package within its existing compatible range. The audit now reports zero vulnerabilities. |

## Verification

- Baseline: production deployment `dpl_7frq1UDycWkrmEdGKgbbykGoakHP` matched main commit `c28c960`.
- 112 unit tests, TypeScript, and production build passed. Node 22 was used for the final local check.
- 11 browser regression groups cover 13 scenarios, including three signup viewport sizes. All API and tile requests in this suite are intercepted; it cannot send email or consume live AI/eBird requests.
- Browser regressions are part of GitHub Actions and can be run with `npm run test:ui`.
- An axe accessibility pass covered 14 surfaces. The archive contrast findings were corrected and rechecked.
- Live eBird map data, a grounded Ask response for Osprey near New Haven, newsletter regional defaults, six illustrated archive findings, and methodology were checked interactively.
- Newsletter submission success and failure were exercised with mocked responses. Actual confirmation delivery and the next scheduled broadcast were not triggered by the audit.
- Screenshot evidence is saved in Pat's `~/Desktop/Screenshots/` folder with the `flockline-` prefix.

## Remaining operational uncertainty

The latest archived issue in all five regions is August 24. Pat's connected inbox has the August 24 Northeast delivery and no later Flockline message. The production scheduler is enabled and has both configured jobs, but the queried Vercel logs did not include the August 31 run. The exact cause of that missing issue is unproven. The narrow time guard is fixed, and new run logs make the next execution diagnosable. An August 31 edition was not fabricated from today's rolling feed, and no catch-up email was sent.

The next scheduled send is Monday, September 7 at 10 a.m. Eastern. Actual scheduled delivery remains to be verified in Vercel project Settings → Cron Jobs and Resend → Broadcasts. Production error tracking is still a separate open item from earlier audits.

## Hosting notes

The replacement map uses the [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/): normal browser caching, HTTPS, visible linked attribution, and no prefetch/offline feature. This public service is best effort. A dedicated tile provider remains an option if traffic warrants it.

Production deployment follows the repository's documented manual workflow from the exact merged main commit. Deployment and final production checks are recorded in the pull request and Claudex project note.
