# Sighting pages

Each real finding links to `/sightings/{eBird checklist ID}/{species code}`. The same address works from Insights, the weekly drawer, archived issues, newsletter previews, and future emails. `/api/sighting` and the server-rendered page use the same loader. The loader confirms that the species appears on the checklist before returning a page.

Source facts and observer notes come from the authenticated eBird checklist API. Notes are excerpts, capped at 25 words in total per checklist and credited to the observer. Missing effort stays missing instead of becoming a zero. Dates remain in the observation's local time.

The detail page describes one species on one checklist. Its only bird count comes from that checklist's observation, shown once near the top. Broader report totals and maximum counts stay in Insights and roundups; saved regional prose is not rendered on an individual sighting page. Outing metadata is available in the collapsed Checklist details section, with explicit person/species units and missing effort omitted.

## Saved context

The rolling notable feed cannot reconstruct old stories. `saveSightingFindings` saves the headline, regional summary, location and illustration reference to public Blob at `sightings/{subId}/{speciesCode}.json` when Insights or a roundup is generated or archived. The write is bounded and best effort: a storage outage must not stop the existing map or weekly send. Readers can still load the verified checklist if saved story context is unavailable.

The September 21, 2026 editions and the September 26 Northeast insights were backfilled at launch.

## Photos

Photos use Macaulay Library's official iframe embed. The file remains hosted by Cornell and includes the contributor, checklist and source links. One frame is loaded at a time; the selector switches between up to six photographs.

The normal eBird API returns photo counts, not asset IDs. `sightingMedia.js` first uses verified references or saved media metadata, then attempts to read the public checklist's photo metadata. It rejects challenge/login pages and never solves challenges or forwards login cookies. Successful discoveries are saved in `sighting-media/{subId}/{speciesCode}.json`. Unavailable lookups are retried after a short cache period.

`shared/verifiedSightingPhotos.json` contains references checked against public eBird checklists or the species-filtered Media gallery on September 26, 2026. Each record includes the asset ID, species and credit. A checklist ID is included only when the relationship was verified. Records without one are reference images, never evidence of the particular sighting. This initial set covers all 30 findings in the five September 21 editions and the current four Northeast insights.

If no exact photo is available, a verified image of that species appears with an explicit "different report" caption. If neither is available, the existing species illustration is used when available. A failed media lookup is distinct from a checklist with no attached photographs. Cornell may display its own brief browser check while an embed opens; Flockline does not bypass it.

To add a verified reference, inspect the actual checklist or species-filtered Media results, record its asset ID and photographer, and include `subId` only for an exact checklist match. Verify the resulting page in a real browser. Cornell's embedding guidance is for noncommercial use; revisit permissions before enabling sponsorship or other revenue: https://support.ebird.org/en/support/solutions/articles/48001064570.

## Verification

Run `npm run check`, `npm run test:ui` and `npm run test:ui:webkit`. The fixture suite covers title links, Learn more, direct reload, photo switching, retries and phone overflow. It blocks external requests, so also visually verify at least one real Cornell embed on the deployed page.
