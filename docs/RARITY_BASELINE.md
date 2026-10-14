# Local seasonal reporting baseline

Historical-context pilot, October 14, 2026. The app now supports a county and seasonal reporting baseline. It is not a rarity score.

## Implemented pilot

The bundled registry covers San Francisco County (468 species, 498 taxon aliases), San Mateo County (437 species, 494 aliases), and New York County (343 species, 412 aliases), all for 2016-2025. Live Insights and future roundups retain eBird's county metadata and attach the matching seasonal frequency. Sighting pages can recover legacy county metadata through the official hotspot-info endpoint when the checklist identifies a public hotspot. Existing available historical snapshots are preserved; missing county coverage remains unavailable, with a link to eBird's history. No model or new request is needed for the baseline lookup itself.

The public UI shows frequency, sample size, years, county, attribution, source chart and limitations. It does not infer annual recurrence, a detection numerator from rounded percentages, unusual flock size, movement, or a cause. The importer and lookup explicitly distinguish absent data from an exported zero.

The histogram occurrence-marker exception below is corrected at lookup, saved-sighting/archive reads, and the final browser display boundary. Ambiguous values retain a source link but do not appear as an exact complete-checklist percentage.

See [data provenance and import instructions](../data/README.md). The original histogram and taxonomy files remain outside the repository. Nationwide EBD plus Sampling Event Data access is a separate [prepared request](EBIRD_ACCESS_REQUEST.md); broader coverage is not yet available.

## Recommended approach

Use historical reporting frequency for the featured location and season, then distinguish a regularly returning seasonal visitor from an exceptional occurrence. The denominator must be eligible complete checklists, including those that did not report the species. The recent notable feed contains selected observations and cannot supply this denominator.

First ship an explicit historical-context label: "Reported on X% of complete checklists in AREA during PERIOD, YEARS (N checklists)." Do not translate a low percentage directly into "rare". Habitat specialists and difficult-to-detect birds can have low regional frequency despite returning predictably.

Keep four questions separate:

- How often was this species reported here in this season?
- In how many sufficiently sampled historical years did it return?
- Is the reported count unusual among comparable positive checklists?
- Has eBird accepted the current report?

The first two can support seasonal context. The third needs a separate count distribution with comparable effort and habitat. None establishes a cause such as food-driven movement.

## Supported data path

For a small pilot, use eBird's own Download Histogram Data action on county and hotspot bar charts. It supplies frequencies and checklist sample sizes. Cornell's `auk::process_barcharts()` already parses this format. There are 48 seasonal bins: days 1-7, 8-14, 15-21, and 22 through month end. They are not ISO weeks. A pooled ten-year export does not expose year-by-year recurrence; that needs separate annual exports or checklist data.

Sources: [eBird bar-chart documentation](https://support.ebird.org/en/support/solutions/articles/48001255130-ebird-bar-charts-and-graphs), [Cornell's parser documentation](https://cornelllabofornithology.github.io/auk/reference/process_barcharts.html).

For sustained coverage, request an eBird Basic Dataset regional subset with Sampling Event Data and preprocess it offline. The companion checklist records establish non-detections and effort. Apply shared-checklist deduplication using group identifiers, consistent effort filters, taxonomic rollup, and attention to spatial and temporal sampling bias. Do not reconstruct history through thousands of recent-API calls. [Cornell analytical guidance](https://ebird.github.io/ebird-best-practices/ebird.html)

The EBD has a project-access request and monthly releases. Its raw data remains outside the public app/repository. The current free educational pilot publishes attributed derived summaries under the applicable terms. The access request discloses the intended use and asks about classification and any permission needed for future sponsorship or commercial use. [Download guide](https://support.ebird.org/en/support/solutions/articles/48000838205-download-ebird-data), [data access terms](https://www.birds.cornell.edu/home/ebird-data-access-terms-of-use/).

## Pilot actually verified

Downloaded San Francisco county's official histogram through Chrome, selecting 2016-2025 and the full year. The export has 48 sample-size columns and species frequency rows. For October 8-14, the sample size is 3,511 complete checklists; Red-breasted Nuthatch frequency is 0.0786101 (about 7.86%) and Red Crossbill is 0.0028482 (about 0.285%). These are county-wide historical reporting frequencies, not Mt. Davidson frequencies, annual recurrence, population estimates, or evidence that a flock of 60 is exceptional.

Source: [San Francisco bar charts, 2016-2025](https://ebird.org/barchart?byr=2016&eyr=2025&bmo=1&emo=12&r=US-CA-075), downloaded October 14, 2026. The original export remains local and is not committed to this repository.

The same official download action and year selection were verified for [San Mateo County](https://ebird.org/barchart?byr=2016&eyr=2025&bmo=1&emo=12&r=US-CA-081) and [New York County](https://ebird.org/barchart?byr=2016&eyr=2025&bmo=1&emo=12&r=US-NY-061) on October 14, 2026. For October 8-14, San Mateo has 3,293 complete checklists, Red Crossbill frequency 0.0051625 (about 0.516%) and Red-breasted Nuthatch 0.0367446 (about 3.67%). New York has 5,306 complete checklists and Sora frequency 0.0049001 (about 0.490%). Bryant Park can now show the New York county baseline; Gazos Creek uses San Mateo, never neighboring San Francisco. These remain county averages, not hotspot or individual-bird probabilities.

## Implementation shape

### Histogram occurrence marker

The 2021 primary research paper [Not just trash birds: Quantifying avian diversity at landfills using community science data](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0255391) describes `0.0015` in eBird histogram exports as a down-weighted representation of occurrence on incomplete checklists. Cornell's general bar-chart documentation describes complete-checklist frequency but does not explain this exception. The export has no separate flag to distinguish this value from a genuine exact frequency of `0.0015`.

On October 14, the three imported datasets contain 441 such cells: San Francisco 142, San Mateo 147, New York 152. A diagnostic check of all 59,904 species/bin cells found those 441 to be the only positive values inconsistent with an integer number of detections divided by the supplied sample size, allowing for the export's seven decimal places. That corroborates the source-format ambiguity; it does not reconstruct or publish a detection numerator, establish the provider's full implementation, or identify the underlying incomplete checklists.

`shared/historicalFrequency.js` conservatively withholds this exact value for `ebird-barchart-48-v1`. A genuine matching frequency can also be withheld because the export cannot disambiguate it. Nearby values, explicit zero, and future methods based on actual complete-checklist counts are not suppressed. The raw registry and provenance hashes remain unchanged. Saved available snapshots are corrected on read, and the same display guard protects browser-cached records. Existing Sora, Red Crossbill and Red-breasted Nuthatch October 8-14 anchors are unaffected.

### Annual occurrence evidence

The Manhattan pilot now imports all ten official annual histograms for 2016-2025 in a separate registry. `lib/annualHistoryImport.js` binds each set to its exact pooled edition, checks all annual scopes and dates, and reconciles all 48 checklist denominator sums. Matching uses the pooled edition's exact official species names, without adding subspecies or guessing taxonomic changes. The original exports remain outside the repo. [Import and provenance details](../data/README.md#annual-evidence).

For October 8-14, Nelson's Sparrow has positive values in nine years and an explicit zero in 2018. Red-breasted Nuthatch has positive values in all ten. Sora has a positive value in 2022, explicit zeros in 2018, 2019, 2020, 2024 and 2025, and missing species rows in 2016, 2017, 2021 and 2023. Missing rows remain unknown. By contrast, considering all four October bins would show Nelson's Sparrow in all ten years and Sora in 2019 and 2022. The UI deliberately uses the same seasonal period as its pooled percentage, not a wider month presented as the same comparison.

The summary counts years with documented occurrence, including ambiguous `0.0015` markers. Such markers establish occurrence under either interpretation but do not establish an exact complete-checklist percentage; annual rows distinguish them explicitly. An annual zero does not prove absence. Missing or zero checklist samples cannot establish an interpretable result. The display exposes year-specific sources and sample sizes and does not turn the count of reported years into a return probability, confidence score or rarity label.

New findings save the annual evidence version. Existing available pooled snapshots receive supplementary annual evidence only for an exact edition/county/taxonomy/window match. Their original frequency, sample size and source version remain unchanged. Published annual snapshots stay pinned. Older browser caches may omit the new optional evidence until their normal expiry or refresh. County baselines with ambiguous pooled frequencies continue to show their source explanation instead of a percentage; annual evidence is currently attached only to available pooled contexts.

Independent source audit verified all 122,928 annual frequency cells, 480 checklist samples, ten original SHA-256 hashes and 48 pooled sums. Unit and browser tests cover missing rows, explicit zeros, occurrence markers, source scope, missing years, incompatible editions, immutable snapshots and phone layout. These checks validate the descriptive implementation; ecological labels still require independent birder review and broader validation.

### Broader baseline design

1. Preserve county code/name from eBird's full notable response. The candidate builder now keeps both state and county metadata.
2. Produce versioned summaries keyed by species, geographic scope, seasonal bin, and baseline years. Keep checklist count, detection frequency, eligible/detected years, source release, taxonomy version, and method version.
3. Use completed prior years so the current influx of observers cannot alter its own baseline. eBird Mobile offers a useful precedent: ten years and a centered three-week seasonal window, with broader geographic coverage when local data are sparse. Its own documentation distinguishes infrequent from rare. [Mobile methodology](https://support.ebird.org/en/support/solutions/articles/48000960508-ebird-mobile-tips-tricks)
4. Join the current report to the smallest sufficiently sampled baseline. Show the actual scope if it falls back to county or state. Return insufficient coverage for missing or weak history. Zero historical detections is not proof of absence.
5. Keep current review status independent. A preliminary report must not gain credibility merely because it is historically unusual.
6. Store the baseline version and explanatory facts with every published finding so later data updates do not silently change old editions.
7. Validate with local birders and held-out years, including familiar resident species, annual scarce migrants, true local exceptions, irruptive species, habitat specialists, and under-sampled areas. Choose minimum sample and label thresholds through this validation, not arbitrary universal cutoffs.

Historical frequency tables can be compact static artifacts loaded alongside the existing eBird results. They do not need an LLM or a new online database. Start with a few well-sampled counties/hotspots, prove the labels, then expand through the EBD import.
