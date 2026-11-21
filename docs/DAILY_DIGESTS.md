# Daily share pages

Insights now links to /digest/{scope}/{Eastern-date}, with /3d, /7d, /14d, or /30d for longer report windows. /digest lists saved editions. Standard regions and custom state selections share the same address format. These are snapshots of the interactive notable-feed selection, not the weekly sourced rarity filter.

"Open digest" opens a standalone page. "Share digest" first saves the dated edition, then copies its address. On an already saved page, supported devices can use their native share sheet. If clipboard access fails, the page provides a selectable address. The existing map-view link remains available.

The first complete eBird snapshot for each region/date/window is immutable. Concurrent publishers use allowOverwrite:false, and the loser reads the winner. Public requests cannot submit their own observations. Demo or failed-state coverage is not published. Result-capped source samples are labeled as partial. Saved pages retain their original facts and historical context; existing weekly issues remain in /roundup.

Daily generation runs for all five standard one-day editions at 9:00-9:04 a.m. America/New_York, with attempts again at :15, :30 and :45. UTC jobs cover both DST offsets; the handler exits outside the 9 a.m. Eastern hour. Each invocation handles one region, requires CRON_SECRET, and has up to 300 seconds. At 9:08 and 9:21 a single daily-illustrations job draws missing species plates across all five saved editions: each species once, at most six per run (the second run starts from the other end of the list), cached forever in Blob. A busy morning can still send a few text-only cards. Delivery never generates art itself: each attempt re-reads the plate cache, holds before :30 while a drawable bird still lacks art (HTTP 200 with `held: true`, receipt `awaiting_illustrations`), and from :30 sends with text-only cards for the rest, marking `partialArtwork` on the receipt. The saved web page keeps the art it was published with. Longer windows and custom scopes are generated when opened or shared.

Reads of old dates never reconstruct an unsaved edition from today's rolling feed. Missing historical editions return 404. Opening a current unsaved page creates its first edition through a rate-limited server render, so the first share already has full HTML and link metadata. Browser-only development pages use the rate-limited POST API instead. Future and malformed addresses are rejected. Once saved, the page is rendered on the server with its exact dated canonical URL, share metadata, and Article data.

Storage uses immutable public Vercel Blob objects under daily-digests/{scope}/{date}/{window}d.json. This uses the existing configured Blob store. Cached/curated species illustrations are reused without new image generation, and their disclaimer is preserved. Sighting context continues through the existing source loader.

Operational limits: snapshots above 1 MB of UTF-8 JSON are rejected before publication, with a request to choose a shorter window. This prevents an immutable address from ever containing a snapshot that its reader cannot load. Other failed generation returns 503 and may recover on the scheduled retry or a reader retry. Search engines control actual indexing. Public generated pages may contain private-yard location names already present in the public source; they are not invitations to visit.

Validation covers date/DST boundaries, canonical custom scopes, immutable publication and race recovery, missing old days, invalid/demo/partial-source rejection, saved-page rendering, clipboard fallback, scope changes, mobile layout, and historical links.

## Daily email

The form at /digest#subscribe defaults to daily delivery. Readers can also choose a schedule and regions in the map signup form. Each confirmed request sets the regional preferences for its chosen schedule. Readers who want both schedules can confirm each separately.

Provision the dedicated daily segment and five default-opt-out topics with `npm run setup:digest -- --daily` in the Flockline Resend environment. Set the emitted RESEND_DAILY_SEGMENT_ID and RESEND_DAILY_TOPIC_* values in production. The morning cron sends the saved one-day selection to the confirmed audience for that region. Each message includes its dated page and the provider preference link. Receipts at digest-daily-delivery/{date}/{region}.json retain the provider broadcast ID so retries can resume the same campaign.
