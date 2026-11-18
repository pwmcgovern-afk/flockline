# Daily share pages

Insights now links to /digest/{scope}/{Eastern-date}, with /3d, /7d, /14d, or /30d for longer report windows. /digest lists saved editions. Standard regions and custom state selections share the same address format. These are snapshots of the interactive notable-feed selection, not the weekly sourced rarity filter.

"Open digest" opens a standalone page. "Share digest" first saves the dated edition, then copies its address. On an already saved page, supported devices can use their native share sheet. If clipboard access fails, the page provides a selectable address. The existing map-view link remains available.

The first complete eBird snapshot for each region/date/window is immutable. Concurrent publishers use allowOverwrite:false, and the loser reads the winner. Public requests cannot submit their own observations. Demo or failed-state coverage is not published. Result-capped source samples are labeled as partial. Saved pages retain their original facts and historical context; existing weekly issues remain in /roundup.

Daily generation runs for all five standard one-day editions at 9:00-9:04 a.m. America/New_York, with one retry at 9:30-9:34. UTC jobs cover both DST offsets; the handler exits outside the 9 a.m. Eastern hour. Each invocation handles one region in a bounded 60-second pass, requires the existing CRON_SECRET, and never sends email. Longer windows and custom scopes are generated when opened or shared.

Reads of old dates never reconstruct an unsaved edition from today's rolling feed. Missing historical editions return 404. A current unsaved page renders a temporary, uncached, noindex shell, then creates its edition through the rate-limited POST API. Future and malformed addresses are rejected. Once saved, the page is rendered on the server with its exact dated canonical URL, share metadata, and Article data.

Storage uses immutable public Vercel Blob objects under daily-digests/{scope}/{date}/{window}d.json. This uses the existing configured Blob store. Cached/curated species illustrations are reused without new image generation, and their disclaimer is preserved. Sighting context continues through the existing source loader.

Operational limits: failed generation returns 503 and may recover on the scheduled retry or a reader retry. No new daily success emails, monitoring automation, or persistent goal is created. Search engines control actual indexing. Public generated pages may contain private-yard location names already present in the public source; they are not invitations to visit.

Validation covers date/DST boundaries, canonical custom scopes, immutable publication and race recovery, missing old days, invalid/demo/partial-source rejection, saved-page rendering, clipboard fallback, scope changes, mobile layout, and historical links.
