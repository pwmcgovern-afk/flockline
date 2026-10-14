# Preparing broader historical coverage

The four-county histogram pilot is live. Nationwide EBD-based baselines are not yet published. Cornell shows a data-access request under review; its submitted scope is not visible. Local tools audit inputs, check taxonomy, select a candidate cohort, aggregate supplied species evidence and calculate candidate fractions only after a documented coverage review. No approved regional dataset has passed that review, and these tools have no publication path.

## Source evidence that changes the design

Cornell's public [sample download](https://ebird.org/downloads/samples/ebd-datafile-SAMPLE.zip) contains accepted observations, Sampling Event Data (SED), and metadata v1.16 (revised February 19, 2025). The metadata requires several distinctions:

- A complete checklist with no accepted observation for a species may still contain a provisional, unreviewed report. The companion provisional file must be considered before inferring a non-detection. Missing provisional coverage is unknown, not an empty file.
- Some SED checklists genuinely contain no bird observations. They must not disappear through an inner join to observations.
- Shared checklists have a group identifier. Their owners can change the species, counts, completeness or effort independently. Matching time/location alone does not identify a shared outing.
- An observation count of `X` indicates a bird without a numerical count. An explicit count of zero can describe an old nest with no live birds. The existence of an observation row is not sufficient evidence of a live-bird detection.
- The 2025 metadata renamed `PROTOCOL TYPE` to `OBSERVATION TYPE`. Match fields by header, never by a fixed column number.
- Sensitive species can be withheld by geography and season. A missing observation cannot automatically establish non-detection for a withheld taxon.

Cornell's [analytical guide](https://ebird.github.io/ebird-best-practices/ebird.html) and [`auk_unique`](https://cornelllabofornithology.github.io/auk/reference/auk_unique.html) describe shared-checklist handling and effort filters. [`auk_zerofill`](https://cornelllabofornithology.github.io/auk/reference/auk_zerofill.html) requires complete checklists and matching taxonomy. [`auk_rollup`](https://cornelllabofornithology.github.io/auk/reference/auk_rollup.html) documents taxonomic categories and species relationships. Passing an input audit does not substitute for those analytical choices.

## Local input audit

`scripts/ebd_inputs.py` uses Python 3.10+ and the standard library. It streams the files through a temporary disk-backed SQLite database with a bounded page cache. It makes no network calls and has no deployment, publication or email path. It retains only the identifiers and checklist metadata needed for matching, not observer details, coordinates, media or comments. Temporary records are removed at exit; the report contains aggregate diagnostics and original-file hashes.

Keep source downloads outside the repository and retain their original filenames. Use a regional custom download rather than the global dataset. Include SED and its companion provisional data from the same query and release.

```sh
python3 scripts/ebd_inputs.py \
  --ebd /private/ebd_REGION_smp_relMon-YYYY.txt \
  --sampling /private/ebd_REGION_smp_relMon-YYYY_sampling.txt \
  --provisional /private/ebd_REGION_smp_relMon-YYYY_provisional.txt \
  --output /private/new-input-audit.json
```

The command rejects mismatched subset/release filenames, missing or ambiguous columns, malformed TSV rows, invalid dates/identifiers/completeness, duplicate source IDs, observations without matching SED entries, inconsistent checklist metadata, and invalid review/count/taxonomic-category fields. Shared copies with conflicting geography or dates fail. Differences in completeness or effort remain explicit review items rather than being silently resolved. Existing files are never overwritten.

Exit 0 means the implemented input checks passed. Exit 1 means a source/format/join check failed. Neither is publication approval: every report has `publicationReady: false`. Omitting `--provisional` is permitted for inspection, but records `provisionalCoverage: unknown` and explicitly prevents interpreting missing accepted rows as non-detections. Even a supplied empty provisional file requires confirmation against the original source package. The auditor cannot establish that files have not been manually filtered or renamed, that a query includes every species, or that a source package covers every expected month.

Run synthetic regression tests with `npm run test:ebd`. They are also part of `npm run check` and CI. Original Cornell records are not test fixtures or committed files.

## Candidate taxonomy and checklist selection

`scripts/ebd_cohort.py` reruns the input audit, loads a pinned official taxonomy export, then produces aggregate mapping and selection diagnostics. It uses temporary SQLite storage and no network access. It rechecks source hashes after selection, rejecting files changed between passes. Output paths must be new.

Obtain the English taxonomy for the **source release's taxonomy year**, requesting `species,issf,form,intergrade,domestic` through the official eBird API. Preserve its original JSON and SHA-256 outside the repository. Verify the year against the release metadata: a pinned hash establishes which bytes were used, not that the operator chose the right edition.

```sh
python3 scripts/ebd_cohort.py \
  --ebd /private/ebd_REGION_smp_relMon-YYYY.txt \
  --sampling /private/ebd_REGION_smp_relMon-YYYY_sampling.txt \
  --provisional /private/ebd_REGION_smp_relMon-YYYY_provisional.txt \
  --taxonomy /private/ebird-taxonomy-2024.json \
  --taxonomy-version 2024 --taxonomy-sha256 ORIGINAL_FILE_SHA256 \
  --counties US-CT-009 \
  --start-date 2016-01-01 --end-date 2025-12-31 \
  --output /private/new-candidate-cohort.json
```

Species map by exact scientific name. Subspecies, intergrades and forms additionally require an official `reportAs` species and agreement with the EBD parent name. Unknown names or missing relationships remain unresolved; common names and fuzzy matching are never substitutes. Domestic, hybrid, slash and unidentified higher taxa have explicit exclusion counts. They are not species absences. Exotic flags (`N`, `P`, `X`, or unflagged) remain separate from accepted/provisional review states, with no natural-origin inference. Observation `X`, explicit zero and positive counts also remain distinct. Taxonomy coverage counts rows, including shared copies, not birds or independent detections.

Candidate selection uses complete Stationary or Traveling checklists in the exact requested counties and completed prior years. Cornell's modeling example supplies provisional effort limits: at most 360 minutes, 10 km, 100 km/h and 10 observers, with positive duration and a whole positive observer count. Missing or invalid effort is excluded. Stationary blank distance becomes zero; an explicitly positive stationary distance is excluded for review. These filters do not correct every effort, habitat or observer bias and are not validated rarity thresholds.

One exact group ID contributes at most one candidate unit. Unshared checklist IDs remain separate even when place and date match. Shared copies must agree on country/state/county/date, completeness, protocol and numeric effort. Equivalent numeric representations agree; any substantive difference excludes the entire group. This conservative candidate rule differs from `auk_unique`'s representative-checklist selection and needs ecological review before production use. Optional species-level evidence aggregation is described below.

The report includes exclusions and retained counts by county/year/month/seasonal bin (0-3: days 1-7, 8-14, 15-21, 22 through month end). Units with no supplied observations remain in the selection diagnostics. Counts for a missing provisional file are `null`, not zero. No non-detection, denominator for a published frequency, or rarity conclusion follows from these diagnostics. Exit 0 means input and taxonomy checks passed; unresolved taxa produce a diagnostic report and exit 1. All reports remain `publicationReady: false`.

## Aggregate supplied species evidence

Append `--evidence-species sora redcro rebnut` to the cohort command to request species evidence in the same pass. Use distinct parent-species codes from the pinned taxonomy. `scripts/ebd_evidence.py` groups the mapped records by candidate unit and species, then emits county/year/seasonal-period summaries under `speciesEvidence`, method `flockline-ebd-species-evidence-v1`. The report inherits the input hashes, source release, selected scope and taxonomy provenance from the cohort report.

- A unit has an accepted positive when at least one supplied accepted row for the species or its supported subtaxon has a positive count or `X`. Multiple subtaxa and shared copies still contribute one unit. Bird counts are never summed or compared to select a maximum.
- Provisional positives are counted separately. A unit can contain both accepted and provisional positives; the report exposes that overlap and the provisional-only count. An unreviewed row cannot promote itself to accepted.
- Explicit zero rows have separate unit counts and do not establish a live-bird detection. Positive/zero overlap remains visible rather than being silently resolved.
- `unitsWithoutSuppliedPositiveRows` is a bookkeeping remainder, **not non-detections**. It can contain no supplied record, an explicit zero, an excluded ambiguous/domestic taxon or evidence unavailable from the supplied package. Accepted and provisional files also cannot establish completeness of a query or sensitive-species coverage by themselves.
- Positive exotic flags are counted once per unit/species/source role/flag. These counts may overlap if shared copies or subtaxa have different flags. Unflagged does not mean known wild origin. Missing provisional statistics remain `null`; a supplied empty file can produce zero, without implying that source coverage is verified.

Every requested county and intersecting seasonal period is present, including periods with no candidate units. Partial first/last bins expose the exact included dates and `partialSeasonalBin: true`; they are never silently presented as full bins. A no-candidate period is explicitly unavailable for inference. Unresolved taxonomy withholds the whole species-evidence table. To bound output size, requests above 100,000 species/period cells fail with instructions to use smaller explicit batches, rather than truncating the report.

`reportingFrequency` remains `null` and `publicationReady` remains false, even when a provisional file is supplied. Confirm original query completeness, sensitive-species coverage, approved use and ecological suitability before deriving and publishing reporting fractions. These aggregates are auditable inputs for that next step, not a substitute for it.

## Coverage review and candidate fractions

`scripts/ebd_frequency.py` consumes the generated species-evidence report and a separate local coverage-review manifest. First create an **unreviewed** template bound to the exact report bytes, source-file hashes, release and taxonomy:

```sh
python3 scripts/ebd_frequency.py template \
  --evidence /private/species-evidence.json \
  --output /private/new-coverage-review.json
```

Review the original download query before changing `query.status` to `reviewed`. Preserve its supporting capture/document outside the repository, with path, SHA-256, canonical Cornell URL, reviewer, review date and a statement of what it establishes. The original geographic/date scope must cover the selected scope. Confirm that SED contains all matching checklists, including those without the requested species. Either confirm an all-species query, or list the queried parent-species codes and confirm their supported subtaxa are included. A species-filtered EBD can be valid with a full SED; Cornell's [Wood Thrush example](https://ebird.github.io/ebird-best-practices/ebird.html#downloading-ebird-data) demonstrates that distinction. A species-filtered checklist denominator is not valid.

Separately record `sensitivityWindows` for each requested species/county/date range. Each window has `countyCodes`, `speciesCodes`, `startDate`, `endDate` and `status` (`not_withheld`, `withheld` or `unknown`). A positive coverage assertion or known withholding needs its own preserved review evidence and `appliesToRelease` matching the source release. Cornell's [sensitivity policy](https://support.ebird.org/en/support/solutions/articles/48000803210-sensitive-species-in-ebird) includes regional and seasonal treatments; absence from a file cannot establish that it was not withheld. A window must cover every day of a seasonal cell. One withheld day blocks the cell; gaps and overlapping unknowns remain unknown. Do not apply a newer policy to an older release without evidence that it applies.

These fields are **operator assertions supported by preserved evidence**. Hashes detect different or changed bytes; they cannot verify that a document supports the assertion. Never fill a review from assumptions, filenames or the absence of observations. This review also does not grant data-use permission or replace independent ecological validation.

```sh
python3 scripts/ebd_frequency.py calculate \
  --evidence /private/species-evidence.json \
  --coverage /private/coverage-review.json \
  --output /private/new-candidate-fractions.json
```

The calculator validates report versions, scope, period/species completeness, source bindings and count reconciliation. It rejects changed review evidence or mismatched report/source/taxonomy hashes. Missing provisional coverage, unknown query/sensitivity coverage, partial bins and zero candidate samples produce unavailable cells. Provisional-only positives withhold the cell, as does any provisional explicit zero because the current aggregate cannot establish that each such row overlaps an accepted positive. Provisional positive copies already backed by an accepted positive do not add a detection or change the denominator. These conservative candidate rules still require validation before public use.

An available cell retains the exact accepted-reporting numerator and candidate complete-checklist-group denominator, plus their ratio. An explicit zero numerator with verified coverage and a nonzero denominator is different from unavailable data; it describes no accepted reports in that dataset, not biological absence. Taxonomic exclusions and exotic flags retain the cohort's stated method. No natural-origin, rarity or unusual-flock conclusion is inferred. Pooling sums numerators and denominators across the explicitly listed years, never averages their percentages. A year with unverified coverage withholds the pooled fraction. A fully covered year with zero eligible effort instead retains known zero counts, no annual percentage, and an explicit `unsampledYears` entry; it contributes zero to the pooled sums without disappearing from the declared window. An entirely unsampled pool has no percentage. Annual results remain available for inspection.

Outputs use `flockline-ebd-candidate-frequency-v1` and always retain `publicationReady: false`. They omit private evidence paths and reviewer names, retaining source URLs, hashes and review dates. No raw records, approval request, registry mutation, email or network call is produced. Output files must be new. The existing app cannot consume this evidence type yet; integration follows approved regional data, independent reconciliation, ecological review and appropriate sampling/label choices.

## Verified public sample

On October 14, 2026, the public sample contained Tuscaloosa County, Alabama (`US-AL-125`), March 1-31, 2025, release `Mar-2025`:

| Check | Result |
| --- | ---: |
| Accepted observation rows | 4,863 |
| SED checklists | 317 |
| Complete checklists before shared-copy handling | 243 |
| Distinct checklist/group IDs | 270 |
| Groups with multiple supplied copies | 41 |
| Additional shared copies | 47 |
| SED checklists without a row in the supplied observations | 4 |
| Accepted/SED metadata mismatches | 0 |

The archive supplies no provisional file. The four unmatched checklists are **not classified as non-detections**. The count of provisional-only checklists is `null` (unknown), not zero. A supplied empty provisional file can instead produce zero, subject to the source-coverage review above. Neither these counts nor this one-month sample become a production baseline. The current four-county registry is unchanged.

Audit method v2 corrects this count's missing-file representation. Earlier v1 reports may contain zero for this field even when `provisionalCoverage` is `unknown`; that value must not be interpreted as evidence of no provisional-only checklists. Re-run the audit to a new report path.

The accepted file SHA-256 is `a82a632acc61c95fdbe6f8f1d3ea8fcb4beafd3f3ff909b37406ca473b2625db`; SED is `e9d81b6d20b02b508e91e491d116988b43bb4eefd055a852bd57c52639e242d6`. Original files, supporting metadata and the aggregate audit remain in Downloads, outside the repository. Re-fetching the public sample may produce a later edition; compare hashes rather than assuming these anchors still apply.

The October 14 candidate audit uses official taxonomy 2024 (15,013 records), SHA-256 `6fe5107f00615b3b48f2736f762c2e5c514db1ee03c0a73719e5d4b3df98464b`. All 4,817 species/subspecies rows map to 120 species; 38 domestic and eight unidentified higher-taxon rows are excluded. There are no unresolved mappings. Among 270 checklist/group units, 189 pass the candidate filters, 68 are incomplete, 11 exceed the distance limit, one exceeds the observer limit and one exceeds the speed limit. Retained counts across March's four seasonal bins are 38, 36, 40 and 75. Selected units contain 3,382 mapped observation rows, still including shared copies.

An independent CSV parser and rational-number calculation, without application helpers, reconciled all 317 checklists, 4,863 observation rows, 270 units, selection bins, mapping/exotic/count diagnostics and three source hashes. Aggregate reports are `~/Downloads/flockline-ebd-cohort-reviewed-2026-10-14.json` and `~/Downloads/flockline-ebd-cohort-independent-audit-2026-10-14.json`. Missing provisional coverage remains unknown. This verifies implementation against the sample, not the ecological suitability of the filters.

The separate species-evidence audit requested all 120 mapped species and reconciled all 480 species/period cells using an independent CSV parser, rational effort calculations and sets of source group IDs. The 3,382 mapped observation rows in selected units collapse to 2,818 species/unit reports. That total sums reporting units across species, not individual birds. Every accepted/provisional/zero/flag statistic and the three input hashes matched. The source sample has no provisional file, so its provisional fields remain unknown and its frequency stays unavailable. Synthetic tests cover the accepted/provisional overlap and explicit-zero cases missing from this sample. Reports remain outside the repo: `~/Downloads/flockline-ebd-species-evidence-2026-10-14.json` and `~/Downloads/flockline-ebd-species-evidence-independent-audit-2026-10-14.json`.

Running the coverage calculator against that sample with its unreviewed template leaves all 480 annual and 480 pooled cells unavailable. Each annual cell records the three genuine gaps: unreviewed query coverage, missing provisional source, and unknown sensitivity coverage. No review was fabricated to obtain a percentage. Both report/manifest hashes were independently checked. The final draft and result remain in Downloads as `flockline-ebd-coverage-review-final-draft-2026-10-14.json` and `flockline-ebd-candidate-frequency-final-2026-10-14.json`. Arithmetic, known zero versus missing samples, shared accepted/provisional positives, source/review mismatches, seasonal withholding and unequal annual denominators are covered by synthetic tests; this is not a real-data validation of available EBD frequencies.

## Remaining processing stages

1. Confirm approved project scope and request a matched regional EBD/SED/provisional release with complete prior years and explicit query coverage. Read its accompanying metadata, taxonomy and sensitive-species policy.
2. Validate the implemented taxonomy and cohort rules on approved regional data, including source edition, domestic/exotic status, withheld taxa and shared-copy disagreements. The public-sample reconciliation above is an implementation check, not production approval.
3. Review coverage losses and the ecological suitability of effort filters and group exclusions. Retain source-specific diagnostics; do not sum observation rows to estimate independent birds.
4. The species/unit aggregation and coverage-gated calculator are implemented above. Apply them to an approved regional dataset with a genuinely completed coverage review, then independently reconcile the resulting candidate fractions and their missing-data cases. No real EBD percentage has passed this gate yet.
5. Independently reconcile candidate results, test held-out years and obtain local birding review. Add the new evidence type to the app only with clear denominator, scope, source, method and missing-data labels. Calibrated rarity or unusual-count labels remain a separate validation task.
