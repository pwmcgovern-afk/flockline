# Preparing broader historical coverage

The four-county histogram pilot is live. Nationwide EBD-based baselines are not yet implemented or published. Cornell shows a data-access request under review; its submitted scope is not visible. This workflow prepares the first processing gate while access is pending.

## Source evidence that changes the design

Cornell's public [sample download](https://ebird.org/downloads/samples/ebd-datafile-SAMPLE.zip) contains accepted observations, Sampling Event Data (SED), and metadata v1.16 (revised February 19, 2025). The metadata requires several distinctions:

- A complete checklist with no accepted observation for a species may still contain a provisional, unreviewed report. The companion provisional file must be considered before inferring a non-detection. Missing provisional coverage is unknown, not an empty file.
- Some SED checklists genuinely contain no bird observations. They must not disappear through an inner join to observations.
- Shared checklists have a group identifier. Their owners can change the species, counts, completeness or effort independently. Matching time/location alone does not identify a shared outing.
- An observation count of `X` indicates a bird without a numerical count. An explicit count of zero can describe an old nest with no live birds. The existence of an observation row is not sufficient evidence of a live-bird detection.
- The 2025 metadata renamed `PROTOCOL TYPE` to `OBSERVATION TYPE`. Match fields by header, never by a fixed column number.
- Sensitive species can be withheld by geography and season. A missing observation cannot automatically establish non-detection for a withheld taxon.

Cornell's [analytical guide](https://ebird.github.io/ebird-best-practices/ebird.html) and [`auk_unique`](https://cornelllabofornithology.github.io/auk/reference/auk_unique.html) describe shared-checklist handling and effort filters. [`auk_zerofill`](https://cornelllabofornithology.github.io/auk/reference/auk_zerofill.html) requires complete checklists and matching taxonomy. These sources guide the next stage; passing an input audit does not substitute for those analytical choices.

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

## Remaining processing stages

1. Confirm approved project scope and request a matched regional EBD/SED/provisional release with complete prior years and explicit query coverage. Read its accompanying metadata, taxonomy and sensitive-species policy.
2. Pin taxonomy; roll species-level occurrences up using source-supported relationships. Exclude ambiguous higher taxa and account explicitly for domestic/exotic status and withheld taxa. Do not sum observations to estimate independent birds.
3. Choose a documented shared-checklist rule and effort filters. Validate the chosen rule against disagreements in complete status, dates, geography and effort. Report exclusion counts and retained coverage by county/year/period.
4. Join all eligible complete checklist/group units to accepted and provisional occurrences. Preserve unresolved evidence separately instead of filling it with zero. Calculate descriptive reporting fractions and annual evidence only for covered scopes. Use a distinct method/version from histogram exports.
5. Independently reconcile candidate results, test held-out years and obtain local birding review. Add the new evidence type to the app only with clear denominator, scope, source, method and missing-data labels. Calibrated rarity or unusual-count labels remain a separate validation task.
