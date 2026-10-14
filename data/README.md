# Historical reporting-frequency data

`historical-baselines.json` is a generated registry of county and seasonal frequency summaries. The pilot covers four counties for 2016-2025, downloaded October 14, 2026. Original histogram and taxonomy exports stay outside the repository.

| County | Species | Taxon aliases | Official source |
| --- | ---: | ---: | --- |
| San Francisco, California | 468 | 498 | [2016-2025 histogram](https://ebird.org/barchart?byr=2016&eyr=2025&bmo=1&emo=12&r=US-CA-075) |
| San Mateo, California | 437 | 494 | [2016-2025 histogram](https://ebird.org/barchart?byr=2016&eyr=2025&bmo=1&emo=12&r=US-CA-081) |
| New York, New York | 343 | 412 | [2016-2025 histogram](https://ebird.org/barchart?byr=2016&eyr=2025&bmo=1&emo=12&r=US-NY-061) |
| Suffolk, Massachusetts | 344 | 420 | [2016-2025 histogram](https://ebird.org/barchart?byr=2016&eyr=2025&bmo=1&emo=12&r=US-MA-025) |

Attribution: eBird and its contributors, Cornell Lab of Ornithology. These derived summaries are provided for Flockline's noncommercial educational use and remain subject to the [eBird Data Access Terms of Use](https://www.birds.cornell.edu/home/ebird-data-access-terms-of-use/). eBird and Cornell do not endorse Flockline.

Each dataset records its geographic scope, selected historical years, source URL, download date, SHA-256 of the original export, taxonomy version and method version. The frequencies preserve the numeric precision of eBird's export. They generally represent proportions of complete checklists, with eBird's sample sizes as the denominator, but `0.0015` is ambiguous: it can represent occurrence from incomplete checklists. The API and display return `frequency_ambiguous` for that value under the histogram method, with the source link instead of an exact percentage. Original registry values remain untouched. See [the evidence and limits](../docs/RARITY_BASELINE.md#histogram-occurrence-marker). The export does not supply exact detection counts, so the importer does not reconstruct an integer numerator.

There are four seasonal bins per month: days 1-7, 8-14, 15-21 and 22 through month end. The lookup uses the observation's local calendar date and exact county. It only uses historical editions whose last year precedes the observation year. Missing counties, species or sample sizes return unavailable. An explicitly exported zero frequency remains zero. No fallback changes geographic scope silently.

Species rows match the official English eBird taxonomy exactly. Subspecies and form query codes use the taxonomy's `reportAs` parent species when that parent has a frequency row. The importer excludes ambiguous taxa, hybrids and other non-species rows. It never adds their frequencies to species rows, because their reporting can overlap.

This pooled frequency is descriptive historical context. It does not measure population size, count unusualness, the reason for a sighting, or whether a species is rare. A small checklist sample can make the percentage unstable, and a large sample does not remove observer, habitat or effort bias. The pooled file cannot establish how many separate years a species occurred. Separate annual evidence is available for all four pilot counties as described below; calibrated confidence and return probabilities remain unavailable. Current report review flags must remain independent of this history.

## Reproduce or add a county export

Use eBird's **Download Histogram Data** action on the county bar chart, selecting complete prior years and January through December. Save the original file outside the repository. Obtain the corresponding official English taxonomy JSON through the eBird API, requesting `species,issf,form` and pinning its version. Keep API credentials and the taxonomy export outside the repository too.

```sh
node scripts/import-barchart-baseline.mjs \
  --input /path/to/ebird_US-CA-075__2016_2025_1_12_barchart.txt \
  --taxonomy /path/to/ebird-taxonomy-2025.json \
  --county US-CA-075 \
  --county-name 'San Francisco County, California' \
  --start-year 2016 --end-year 2025 \
  --downloaded-at 2026-10-14 --taxonomy-version 2025 \
  --output data/historical-baselines.json
```

The script validates the export's 48 columns, frequency bounds, whole checklist sample sizes, declared taxon total, metadata and source scope. It preserves other counties and year windows, replacing only the matching county/year edition. Review the imported and skipped row counts, and run `npx vitest run lib/barchartImport.test.js lib/historicalBaseline.test.js` before using the result. A new historical period or taxonomy needs deliberate review; the app does not scrape or refresh data automatically.

For larger coverage, use an approved eBird Basic Dataset and Sampling Event Data workflow with explicit effort and shared-checklist handling. The [offline processing runbook](../docs/EBD_PROCESSING.md) covers source auditing, taxonomy, cohort selection, species evidence and candidate fractions gated by a preserved coverage review. No approved regional dataset has passed that review, and outputs remain nonpublishable. The tools do not create a production registry or infer biological absence. See [the baseline design](../docs/RARITY_BASELINE.md).

## Annual evidence

`annual-history.json` contains separate 2016-2025 exports for all four pilot counties downloaded October 14, 2026. It is bound to the exact pooled dataset version, county, taxonomy and year window. The runtime sends only the featured species's ten annual results for each of the seasonal period and whole month, not this entire registry. It makes no new network requests. New findings retain the annual version; matching older pooled snapshots gain supplementary annual evidence on read without changing their pooled facts or stored source record. Existing annual snapshots stay pinned. Older snapshots without whole-month evidence retain their original scope.

An annual value above zero documents reporting. Exact `0.0015` also documents occurrence under either interpretation, but is separately labelled and never turned into an exact percentage. An explicit zero stays zero. Missing species rows, missing frequencies and missing/zero checklist samples are unknown. Each year exposes its own source chart and checklist sample. No detection count, recurrence probability, confidence or rarity classification is inferred. `annualRecurrence` remains null; descriptive evidence lives in `annualHistory`.

The whole-month view combines the four seasonal bins as occurrence evidence, never by adding or averaging their frequencies. Any positive bin documents reporting; otherwise an occurrence marker documents occurrence; only four valid explicit zeros yield a monthly zero. Missing bins without positive evidence remain unknown. Monthly checklist samples sum the four disjoint periods when all samples are present. The UI labels both scopes and switches table rows, samples and caption together. Derived evidence uses `ebird-annual-occurrence-v2`; the imported source registry retains `ebird-annual-occurrence-v1`.

Download each year via the official chart UI, with the start and end year equal and all twelve months selected. Prepare a local JSON manifest with `pooledDatasetVersion` copied from the intended pooled dataset and a `years` array. Each entry supplies `year`, `path` (absolute or relative to the manifest), `sourceUrl` and `downloadedAt`. Include every year exactly once. Then run:

```sh
node scripts/import-annual-history.mjs \
  --manifest /path/to/annual-manifest.json \
  --pooled data/historical-baselines.json \
  --output data/annual-history.json
```

The importer reuses exact species names from the pooled edition's official taxonomy mapping. It never sums subspecies or substitutes renamed species. It validates source URL scope, completed years, source hashes and every seasonal checklist total against the pooled file. A mismatch requires source/edition review, not relaxing validation. The CLI rejects a pooled registry as its output. Keep original exports and local manifests outside the repository.

Independent October 14 Manhattan audit: all 122,928 frequency cells across 2,561 annual species rows, all 480 checklist samples, ten SHA-256 hashes, and all 48 pooled sample sums match the downloaded sources. October 8-14 anchors: Sora has one reported year, five explicit zeros and four unknown rows; Nelson's Sparrow has nine reported years and one explicit zero; Red-breasted Nuthatch has reports in all ten years. These summaries concern that seven-day period, not the entire month or year.

Independent October 14 Suffolk audit: all 16,512 pooled frequency cells, 48 pooled samples and 420 taxonomy aliases matched the original export and official taxonomy. All 130,080 annual frequency cells across 2,710 annual species rows, 480 annual samples, eleven source hashes (pooled plus annual), and 48 annual-to-pooled sample sums also matched. Existing county datasets were unchanged. Nelson's Sparrow during October 8-14 has frequency 0.008025 across 2,243 complete checklists: six years document occurrence (including a 2024 occurrence marker), four export zero and none are unknown. Across the whole month of October, all ten years have unambiguous positive reporting. This is historical reporting evidence, not a rarity classification.

Independent October 14 western audit: San Francisco has 165,744 annual frequency cells across 3,453 species rows; San Mateo has 159,984 across 3,333 rows. All 325,728 cells, 960 samples, twenty source hashes and 96 annual-to-pooled sums matched independently parsed downloads and official taxonomy. The pooled registry and existing Manhattan/Suffolk annual datasets were unchanged.

| County | Species | October 8-14 reported years | Whole October reported years |
| --- | --- | ---: | ---: |
| San Francisco | Red Crossbill | 5 / 10 | 9 / 10 |
| San Francisco | Red-breasted Nuthatch | 9 / 10 | 10 / 10 |
| San Mateo | Red Crossbill | 6 / 10 | 9 / 10 |
| San Mateo | Red-breasted Nuthatch | 7 / 10 | 10 / 10 |

All remaining years in these comparisons are explicit exported zeros, not unknowns. San Mateo nuthatch's October 2018 evidence is an ambiguous occurrence marker and remains labelled as such; it does not establish an exact percentage. These county histories do not assess a flock's size or explain movements.
