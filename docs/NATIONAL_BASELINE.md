# Nationwide historical context

October 15, 2026. The target is county-level historical reporting context across the app's U.S. scope: the fifty states and Washington, DC. A state or national average must not silently replace a county's frequency. These are descriptive frequencies, not calibrated rarity labels.

## Coverage actually available

The official eBird region-list API returned 3,143 county regions in 51 state-level regions. The existing twelve counties have 132 source exports: one pooled 2016-2025 export and ten annual exports each. Another 3,131 counties lack imported data. Repeating this method requires another 34,441 exports. The inventory is a source-acquisition plan, not evidence of historical bird reporting.

Sources: [county inventory](https://api.ebird.org/v2/ref/region/list/subnational2/US?fmt=json), [state inventory](https://api.ebird.org/v2/ref/region/list/subnational1/US?fmt=json), retrieved October 15. These are authenticated API endpoints; API credentials stay outside the repository. Saved inventories and the generated national plan are in the operator's Downloads folder under `flockline-us-{counties,states}-2026-10-15.json` and `flockline-national-baseline-plan-2026-10-15.json`.

Cornell's supported histogram download action remains a valid source path. Bulk EBD access is separate and was last observed under review on October 14. On October 15 the browser connector failed before reaching Cornell; a public HTTP chart request returned a bot-check page, and the research-browser tool could not access the chart. Native Chrome control also rejected actions because its state had changed. No challenge was bypassed, no fresh signed-in access status was established, and no new county frequencies were obtained. The existing workflow can resume when normal download access is available. The [EBD runbook](EBD_PROCESSING.md) remains the bulk-data option after access and source-coverage review.

## County files and runtime

`data/historical-index.json` pins each available county's compressed file by SHA-256 and byte size. `data/historical-counties/` contains the twelve existing counties. They preserve the original pooled and annual registries exactly, without new numerical interpretation. Those source registries remain the reproducible import inputs and are no longer read at function startup.

The loader reads a county only when requested and retains at most 16 MiB of decoded JSON in its cache. This bounds retained source bytes, not JavaScript heap size. Each compressed file is capped at 2 MiB and decoded content at 8 MiB. Immutable remote files can use a pinned public Vercel Blob URL in place of a local filename; downloads have a 2.5-second caller deadline, coalesce concurrent requests, reject redirects, verify size/hash/scope, and do not cache failures. An unavailable source remains unavailable, never zero. Previously saved pooled/annual facts remain pinned. All twelve currently published counties stay local and add no network request.

Vercel Node File Trace includes the small index and twelve compressed files in the tested sighting, Insights, archive and weekly-digest dependency graph. It excludes both full source registries. The bundled county files total 2,720,043 bytes. Keep nationwide files outside the function bundle and use the remote entries as coverage grows; simply bundling thousands of local files would still exceed deployment limits.

Local measurements in a fresh Node process: module import 11.12 ms and RSS increase 2,473,984 bytes, with zero counties decoded; first New Haven lookup 6.91 ms and total RSS increase 9,699,328 bytes. The selected Willet response remains 4,391 bytes. These are development observations, not production latency or memory guarantees.

One content-addressed New Haven summary was uploaded to the existing public Blob store to verify the remote route. The downloaded hash and returned baseline, including annual evidence, exactly match the bundled version. Two lookups made one request; the measured combined operation was 301.19 ms. Its candidate index and validation report remain in Downloads (`flockline-national-remote-{index,validation}-2026-10-15.json`); the app index still selects the local file.

## Resume acquisition and import

Generate a complete plan from preserved official region inventories and the current source registries:

```sh
node scripts/plan-historical-coverage.mjs \
  --counties /path/to/counties.json --states /path/to/states.json \
  --pooled data/historical-baselines.json --annual data/annual-history.json \
  --start-year 2016 --end-year 2025 --created-at 2026-10-15 \
  --output /path/to/national-plan.json
```

Download through Cornell's supported chart control. Preserve a receipt for every file with `path`, `sourceUrl`, `downloadedAt`, `sha256`, and `scopeVerified: true`, plus `year` for annual sources. Scope verification means the operator actually checked the selected geography, years and months. The text export does not encode geography, and a filename or hash alone cannot establish it. Do not turn a planned URL into a verified receipt without checking the source selection.

The batch receipt has a `counties` array. Each entry supplies `countyCode`, `countyName`, `startYear`, `endYear`, one `pooled` receipt and an `annual` receipt array. Use the same pinned official English taxonomy. Then import into a staging directory outside the repository:

```sh
node scripts/import-historical-batch.mjs \
  --receipts /path/to/download-receipts.json \
  --taxonomy /path/to/taxonomy-2025.json --taxonomy-version 2025 \
  --output-directory /path/to/staged-counties
```

The importer checks original hashes and scope metadata, then uses the existing species mapper and annual-to-pooled sample reconciliation. It publishes a staging file only after the entire county passes. Failures are listed in `import-report.json`, produce a nonzero exit, and do not replace a valid county. A repeat import of identical inputs is a no-op; a different edition needs a new staging directory. This stages summaries only and does not update the app.

The October 15 validation reimported all 132 existing sources, then repeated the batch. Independent JSON comparisons confirmed all twelve pooled frequencies, samples, source records, versions and aliases, and every complete annual dataset, remained identical. Receipts and staging outputs are in Downloads under `flockline-national-existing-receipts-2026-10-15.json` and `flockline-national-import-validation-2026-10-15/`.

## Build and publish reviewed summaries

After independently reconciling new sources, build county files sequentially, without assembling a national registry in memory:

```sh
node scripts/build-historical-shards.mjs \
  --staged-directory /path/to/staged-counties \
  --directory /path/to/compressed-counties --index /path/to/candidate-index.json
```

For changes to the original bundled registries, running `node scripts/build-historical-shards.mjs` without options rebuilds their local files and index. Tests compare all original values against the generated files, so a stale build fails verification.

The publisher defaults to validation without uploading. Supply the existing public Blob credentials through the environment, never command-line arguments:

```sh
node scripts/publish-historical-shards.mjs \
  --index /path/to/candidate-index.json --directory /path/to/compressed-counties \
  --output /path/to/remote-index.json
```

Add `--publish` to upload and verify each immutable object. `--county US-CT-009` restricts the operation to a selected county. Existing identical objects are verified and reused; overwrites are forbidden. The publisher writes a separate candidate index only after successful readback. Review and merge the intended entries into the app's index, preserving existing counties and historical editions. Keep raw source exports out of the repository and public Blob store. Run source comparisons, unit/build checks, and deployed source-to-page verification before claiming new coverage.

National acquisition, independent reconciliation of new county sources, and publication of those counties remain unfinished. The storage and import changes do not make those data available by themselves.
