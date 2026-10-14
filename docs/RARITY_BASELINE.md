# Local seasonal reporting baseline

Research and manual export pilot, October 14, 2026. This is a proposed next feature, not a deployed rarity score.

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

The EBD has a project-access request and monthly releases. Its raw data should remain outside the public app/repository. Confirm the intended Flockline use and permission requirements before deploying derived tables, especially for sponsorship or commercial use. [Download guide](https://support.ebird.org/en/support/solutions/articles/48000838205-download-ebird-data), [data access terms](https://www.birds.cornell.edu/home/ebird-data-access-terms-of-use/).

## Pilot actually verified

Downloaded San Francisco county's official histogram through Chrome, selecting 2016-2025 and the full year. The export has 48 sample-size columns and species frequency rows. For October 8-14, the sample size is 3,511 complete checklists; Red-breasted Nuthatch frequency is 0.0786101 (about 7.86%) and Red Crossbill is 0.0028482 (about 0.285%). These are county-wide historical reporting frequencies, not Mt. Davidson frequencies, annual recurrence, population estimates, or evidence that a flock of 60 is exceptional.

Source: [San Francisco bar charts, 2016-2025](https://ebird.org/barchart?byr=2016&eyr=2025&bmo=1&emo=12&r=US-CA-075), downloaded October 14, 2026. The original export remains local and is not committed to this repository.

## Implementation shape

1. Preserve county code/name from eBird's full notable response. The current candidate builder keeps state information but discards county metadata.
2. Produce versioned summaries keyed by species, geographic scope, seasonal bin, and baseline years. Keep checklist count, detection frequency, eligible/detected years, source release, taxonomy version, and method version.
3. Use completed prior years so the current influx of observers cannot alter its own baseline. eBird Mobile offers a useful precedent: ten years and a centered three-week seasonal window, with broader geographic coverage when local data are sparse. Its own documentation distinguishes infrequent from rare. [Mobile methodology](https://support.ebird.org/en/support/solutions/articles/48000960508-ebird-mobile-tips-tricks)
4. Join the current report to the smallest sufficiently sampled baseline. Show the actual scope if it falls back to county or state. Return insufficient coverage for missing or weak history. Zero historical detections is not proof of absence.
5. Keep current review status independent. A preliminary report must not gain credibility merely because it is historically unusual.
6. Store the baseline version and explanatory facts with every published finding so later data updates do not silently change old editions.
7. Validate with local birders and held-out years, including familiar resident species, annual scarce migrants, true local exceptions, irruptive species, habitat specialists, and under-sampled areas. Choose minimum sample and label thresholds through this validation, not arbitrary universal cutoffs.

Historical frequency tables can be compact static artifacts loaded alongside the existing eBird results. They do not need an LLM or a new online database. Start with a few well-sampled counties/hotspots, prove the labels, then expand through the EBD import.
