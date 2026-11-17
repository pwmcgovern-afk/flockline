# Digest selection rollout

The November 17 national expansion supersedes the initial twelve-state source inventory below. See [State source coverage](STATE_SOURCE_COVERAGE.md) for all fifty states and DC, conditional holds, Hawaii lifetime-record limitations, and North Dakota archived-source provenance.

Implemented November 16-17, 2026. Policy `review-evidence-v1` applies to new weekly editions in all five regions. Existing sent editions retain their original selections.

The selector evaluates individual reports against documented state review criteria before choosing one featured report per species. Only reports marked accepted by eBird automatically qualify. This is not committee confirmation. Unreviewed matching reports are held in the audit; rejected reports are excluded. At most six stories are featured, with no minimum. State review rules precede seasonal rules, then source local observation time and stable source identifiers break ties. There is no calibrated comparison of rarity severity within a category.

The editorial window is the previous Monday through Sunday, in observation calendar dates. The API fetches fourteen days to retain that week even when previewed later in the current week. Exact start/end dates accompany reporting totals. Source counts, capped feeds, failures, missing policy coverage, and observation acceptance remain separate. Historical county frequencies support context only; they do not establish eligibility.

## Source coverage and limits

`shared/digestSelectionRules.json` contains 1,742 selected rules from twelve state sources. All nine Northeast states have at least some rules; this is not complete list coverage. Rhode Island contains only the three explicit additions in the committee's October 2026 report. New Jersey contains selected unconditional entries read through the PDF tool. Other imported state sources are California, Michigan, and Texas. The other 39 state/DC regions remain unassessed by this policy and are identified in each edition. Activating the selector in every edition does not establish comprehensive national rarity coverage.

NY seasonal windows use explicit committee date limits. Vermont's additional rules use the committee's instruction to document observations more than one month outside listed occurrence dates, excluding plus-marked, multi-interval, and geographically conditional rows. Month additions are clamped to month ends; year-round occurrence cannot become a seasonal exception. These are direct source conditions, not model-inferred ecological classifications. Some committee lists also address identification difficulty; the copy attributes the review requirement rather than claiming every member is a biological rarity.

Scientific or common-name changes and conditional geography/subspecies rules are not guessed. Matching uses exact common names with typographic apostrophe/whitespace normalization. This can omit qualifying reports and is deliberately documented as incomplete selection coverage. Each rule records its source; downloaded source hashes and retrieval dates accompany each captured source. Removed NY entries, breeding-only CT records, PA former/extirpated lists, and partial NJ rules are not blanket eligibility rules.

## Reproduce and inspect

Raw source captures and live snapshots are retained outside Git at `/Users/patrickmcgovern/Code/flockline-editorial-evidence-2026-11-17/`. Run the two import scripts against that directory to reproduce the registry; changes to source structure require inspection, not blind re-import. The PDF source columns and footnotes need inspection before accepting parser changes.

Run `node --env-file=.env --env-file=.env.local scripts/preview-digest-selection.mjs --region northeast --output /tmp/flockline-preview`. It only reads eBird and writes local files. Reuse a snapshot with `--input /path/snapshot.json`. No mail, artwork generation, or publication occurs. The preview JSON contains the full selection ledger and explanatory source for each card.

Production stores compressed candidate decisions separately in public Blob under `digest-selection/`; delivery receipts and API responses retain decision totals, at most fifty held candidates, and the audit URL/status. Audit failure is visible and does not suppress an otherwise valid edition.

## Validation and remaining work

The live Northeast snapshot included 14,486 reports with no failed states. Its six selected species were Purple Gallinule, Brown Booby, Bullock's Oriole, Mountain Bluebird, Swainson's Hawk, and Tundra Bean-Goose. Sixty-five matching unreviewed reports were held. A separate 78,027-row national snapshot was used to exercise all five editions; no state fetch failed. These are contemporary replay previews, not reconstructions of an earlier complete candidate pool.

The regression set includes routine residents, documented review species, conditional and seasonal rules, uncertain/rejected reports, changed dates/places, DST boundaries, publication copy, and bounded audit storage. Independent code review and existing CI must pass before merge. No external birder endorsement is claimed. Future editions on November 23 and November 30 must be inspected after they exist: compare included and held reports, identify mundane inclusions and missed strong candidates, check explanations and source failures, and amend explicit source rules as needed. No persistent goal or automation was created.

National source expansion remains material work. Initial all-region availability should not be described as all-state coverage or as completion of the two future edition reviews.
