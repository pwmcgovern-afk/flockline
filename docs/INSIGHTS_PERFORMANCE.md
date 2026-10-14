# Insights loading

October 14, 2026.

Insights already uses source-fact templates, so no language model is involved in this screen. The cold-load bottleneck was a capped nationwide feed triggering a full expansion across 50 states plus Washington, D.C., with rate-limit retries. In a local live-source comparison for a seven-day nationwide request, the original path took 20.225 seconds and 78 eBird requests. The revised path took 0.322 seconds and one eBird request. These timings exclude Blob writes and are measurements, not latency guarantees.

Nationwide Insights now uses the bounded country feed as a selection. If it reaches the 10,000-row cap, coverage and saved report counts are explicitly partial. It does not imply an exhaustive national search. Weekly editions and the separate full-reporting lookup retain their state expansion. A saved partial snapshot remains labelled partial on the linked sighting page.

Concurrent requests for the same scope share an in-flight read. The API registers sighting-context persistence with Vercel `waitUntil` so background writes can complete after the response. In-process and CDN caching remain; the browser also keeps up to twelve visited scopes for five minutes. Explicit refresh bypasses cached results. Sorted region parameters improve CDN reuse, and opening the panel waits 100 milliseconds instead of 700 before loading.

Historical baseline lookups use a small server-side static registry and add no network round trip. The full registry is not included in the browser bundle.

Verification covers a capped feed making only one country request, partial reporting, coalescing, deferred persistence, county provenance, cached scope switching, cancellation of outdated requests, explicit refresh and mobile rendering.
