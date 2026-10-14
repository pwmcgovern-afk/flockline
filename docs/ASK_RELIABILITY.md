# Ask admission, sources, and operational evidence

Ask remains a generative assistant. Insights and weekly editorial copy use factual templates and do not wait for a language model.

## Shared admission

Production Ask reserves an allowance before making a model request. All instances and deployments share one conditional record in the private `flockline-operations` Blob store (`store_mAg7SXzW8Kll3J4f`, iad1). The project connection uses the `ASK_` prefix, supplying `ASK_READ_WRITE_TOKEN` separately from the existing public `BLOB_READ_WRITE_TOKEN`. The new store is connected to production, preview, and development. It does not change the public archive or illustration store.

Default limits in `lib/chatAdmission.js`:

- 8 admitted requests per client IP per fixed ten-minute UTC interval.
- 40 admitted requests across all clients per ten-minute interval.
- 200 admitted requests across all clients per UTC calendar day.

One read and conditional write reserve every quota together. A successful reservation is never refunded after a timeout, disconnect, or uncertain provider outcome. Deployment does not reset the counters. Preview has a separate path. Local development and deployments without a model key retain the existing in-memory limit because they do not invoke the paid model.

The private store uses `get(..., { access: "private", useCache: false })` and a strong ETag with `ifMatch` on update, or `allowOverwrite: false` on creation. Missing configuration, corrupt state, storage errors, deadline expiry, or exhausted contention retries return 503 before any model work. The admission deadline is three seconds, separate from Ask's existing 35-second model/source deadline. A quota denial returns 429 and `Retry-After`; both paths retain `no-store`. Empty questions return 400 before consuming an allowance.

The private record stores only aggregate counters and a purpose-separated HMAC of the IP plus the current window and environment path. It does not store raw IPs, prompts, answers, or provider errors. Fingerprints rotate each window and old client entries are replaced on the next admitted write. Idle state can remain stored until reused; this is logical expiry, not a physical-deletion promise. Rotating the digest signing secret changes client fingerprints but preserves aggregate counters.

Fixed windows allow bursts around a boundary. Shared networks share a client allowance, and changing IPs can evade that client allowance but not the aggregate quotas. The daily request limit is not a dollar ceiling: model input and tool-call counts vary. These defaults suit the current small public app. Review actual use before increasing them. A high-traffic product should use a purpose-built shared counter service rather than increasing contention on this record.

Vercel WAF's native counters are regional. The installed Blob SDK ignores `useCache:false` for public blobs, so public storage must not be substituted for this private admission store. Conditional writes prevent an incorrect allowance, but stale public reads would repeatedly deny legitimate requests.

## Source presentation

`checklistSources` comes from structured observations returned by completed source tools. Model prose and user-supplied chat history cannot add trusted checklist IDs. Source records include species, checklist, location, observation date, and plain-language eBird acceptance status. The response retains up to 12 distinct checklist/species pairs, prioritizing IDs mentioned in the answer.

The browser constructs links only to canonical `https://ebird.org/checklist/S...` URLs backed by those records. Unsupported URLs stay plain text, and no generated HTML is executed. The Source reports disclosure makes the underlying records inspectable even when the model omits an inline citation. Tool data uses plain review labels rather than raw flags. Acceptance can be automatic; it does not prove expert review, and no later individual review is promised.

These controls establish where a linked report came from. They do not certify every interpretation in a generated answer or that a cited source supports every nearby sentence.

For a named bird at a named place, Ask resolves the species code and uses eBird's species-specific nearby endpoint. The broad nearby feed can omit the bird even when a matching report exists. Tool evidence distinguishes records returned by eBird from the 30 records shown to the model, preserves the upstream 200-record cap, and states that nearby results include accepted reports only. A missing record in a broad sample triggers a targeted lookup; an empty targeted result still cannot establish absence. The species endpoint returns the latest report per location, not full checklist history. Endpoint semantics: [official eBird API documentation](https://documenter.getpostman.com/view/664302/S1ENwy59#20fb2c3b-ee7f-49ae-a912-9c3f16a40397).

## Durable diagnostic samples

Chat, Insights, roundup, and sighting handlers schedule sanitized failure samples through `waitUntil`. Partial upstream coverage failures in Insights and roundups are also sampled. Expected validation failures, quota denials, and visitor disconnects are not reported as incidents. In Ask, the source category covers either upstream service, eBird or Anthropic; it is not proof that eBird failed.

`lib/operationalEvents.js` permits only an allowlisted route/category, HTTP status when available, and occurrence time. It never writes request bodies, IPs, addresses, prompts, error messages, credentials, or provider response bodies. Samples use the explicit existing public Blob token, a two-second write bound, and local suppression of repeated route/category writes for one minute. No notifications or synthetic production incident were sent.

Storage is bounded to 224 paths per environment: 14 day slots, four routes, and four categories. Concurrent writes may preserve either sample. Old inactive slots persist until reused, and public reads may lag by up to 60 seconds. A read filters out records outside its requested calendar-day window.

Read the last two UTC calendar days with the existing local public Blob configuration:

```sh
node --env-file=.env.local scripts/operational-status.mjs --environment production --days 2
```

Add `--route chat` to narrow the view. The maximum inspection window is 14 UTC calendar days. Failed reads return a nonzero exit status. An empty result does not establish service health. These are best-effort diagnostic samples, not exact counts, an ordered incident history, client-side error tracking, or an alerting service. A Blob outage can prevent a sample from being saved; Vercel runtime logs remain another source of evidence.

## Local and production parity

`server/app.js` mounts the real ordinary API handlers. Development now preserves production validation statuses, method checks, cache/rate headers, and Ask disconnect cancellation. The server entry point only starts Express. Existing subscription, confirmation, and authenticated artwork-preparation routes remain; the email-sending cron is not mounted locally.

## Primary references

- [Private Blob consistent reads](https://vercel.com/docs/vercel-blob/private-storage#consistent-reads)
- [Blob conditional writes](https://vercel.com/docs/vercel-blob#conditional-writes)
- [Vercel forwarding headers](https://vercel.com/docs/headers/request-headers)
- [Vercel WAF regional counters](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)
