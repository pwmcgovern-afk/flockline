# Historical reporting-frequency data

`historical-baselines.json` is a generated registry of county and seasonal frequency summaries. The pilot covers three counties for 2016-2025, downloaded October 14, 2026. Original histogram and taxonomy exports stay outside the repository.

| County | Species | Taxon aliases | Official source |
| --- | ---: | ---: | --- |
| San Francisco, California | 468 | 498 | [2016-2025 histogram](https://ebird.org/barchart?byr=2016&eyr=2025&bmo=1&emo=12&r=US-CA-075) |
| San Mateo, California | 437 | 494 | [2016-2025 histogram](https://ebird.org/barchart?byr=2016&eyr=2025&bmo=1&emo=12&r=US-CA-081) |
| New York, New York | 343 | 412 | [2016-2025 histogram](https://ebird.org/barchart?byr=2016&eyr=2025&bmo=1&emo=12&r=US-NY-061) |

Attribution: eBird and its contributors, Cornell Lab of Ornithology. These derived summaries are provided for Flockline's noncommercial educational use and remain subject to the [eBird Data Access Terms of Use](https://www.birds.cornell.edu/home/ebird-data-access-terms-of-use/). eBird and Cornell do not endorse Flockline.

Each dataset records its geographic scope, selected historical years, source URL, download date, SHA-256 of the original export, taxonomy version and method version. The frequencies preserve the numeric precision of eBird's export. They are proportions of complete checklists, with eBird's sample sizes as the denominator. The export does not supply exact detection counts, so the importer does not reconstruct an integer numerator.

There are four seasonal bins per month: days 1-7, 8-14, 15-21 and 22 through month end. The lookup uses the observation's local calendar date and exact county. It only uses historical editions whose last year precedes the observation year. Missing counties, species or sample sizes return unavailable. An explicitly exported zero frequency remains zero. No fallback changes geographic scope silently.

Species rows match the official English eBird taxonomy exactly. Subspecies and form query codes use the taxonomy's `reportAs` parent species when that parent has a frequency row. The importer excludes ambiguous taxa, hybrids and other non-species rows. It never adds their frequencies to species rows, because their reporting can overlap.

This pooled frequency is descriptive historical context. It does not measure population size, count unusualness, the reason for a sighting, or whether a species is rare. A small checklist sample can make the percentage unstable, and a large sample does not remove observer, habitat or effort bias. The file cannot establish how many separate years a species occurred, so annual recurrence and calibrated confidence remain unavailable. Current report review flags must remain independent of this history.

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

For larger coverage, use an approved eBird Basic Dataset and Sampling Event Data workflow with explicit effort and shared-checklist handling. See [the baseline design](../docs/RARITY_BASELINE.md).
