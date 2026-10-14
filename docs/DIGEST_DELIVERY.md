# Weekly digest delivery

## September 5 investigation

Resend's broadcast history and API logs show no August 31 broadcast attempt. The latest five public archive issues are August 24. The four August 24 regional draft broadcasts correspond to Resend 422 responses for empty audiences; Northeast was sent. The Vercel log API rejected the historical query with `ExceedsBillingLimitError`, so the exact August 31 invocation outcome cannot be recovered from that query. A missing log result must not be interpreted as a successful run.

Confirmed weaknesses were a minute-only time gate (fixed in PR #46), serial processing of all five regions within one 300-second function, image generation and an unbounded prose request before archive/send, no automatic retries, and no durable delivery evidence. Resend's create-and-send request also made uncertain outcomes difficult to reconcile.

The August 31 edition cannot be faithfully reconstructed from today's rolling eBird feed. Do not publish today's observations under an August 31 date or send a catch-up edition without Pat's explicit instruction.

## Editorial policy

Insights and roundups use `source-facts-v1`: deterministic selection by recency and geographic variety, followed by templates populated from the source's species, location, date, and count. No LLM writes or selects digest findings. eBird notable flags are local and date-specific, not a ranking of biological rarity or evidence of movement. Available source review status is preserved; missing status is labeled unavailable. Ask remains generative and can make mistakes. Illustration generation is unchanged.

The archive API and server renderer correct legacy web descriptions on read from the original saved observations and show a correction note. They preserve the edition date, checklist IDs, observations, and artwork without rewriting historical blobs merely to display them. New archive writes and email rendering apply the same factual policy. Resumed provider drafts without the current editorial-policy marker are corrected in place before sending, preserving the campaign ID and recipient routing. Delivery saves the marker only after a confirmed update; an uncertain update or marker write stops that attempt. Already-delivered email cannot be changed, and correcting web copy does not send another email.

## Current schedule and recovery

- Five regional prewarm jobs run at :05, :25, and :40 in the 13, 14, and 15 UTC hours on Monday, staggered by region (Northeast one minute later, West four). Each generates at most three images in one batch. The first job saves the actual edition before generating any artwork; all later preparation, checks, and delivery reuse those exact birds and source records, with descriptions formatted under the factual policy. Preparation skips existing campaigns, sent editions, and archived `no_recipients` editions without changing their receipts. A later delivery retry can still recheck recipients.
- Five no-send checks run at 13:45-13:49 UTC. Their dashboard Run buttons are safe for manual verification on any day.
- Five delivery jobs begin at 10:00-10:04 a.m. Eastern. They retry three times at 15-minute intervals. Both possible UTC hours are scheduled; the Eastern-time guard accepts only the correct hour.
- Every delivery acquires a conditional Blob lease that outlasts the 300-second function but expires before the next retry.
- The first attempt saves a fixed roundup and archive. It creates a draft, saves the broadcast ID, then sends that ID. Retries reconcile provider state before sending, including after a lost create/send response. They never intentionally create another campaign for the same named edition.
- A region with no subscribed recipients still gets an archive issue and a `no_recipients` receipt. It does not create an orphan draft. Failed recipient lookups remain failures.
- An edition with missing artwork stays `awaiting_illustrations` and is not archived or sent. Preparation continues during the delivery hour so a later delivery retry can send once every bird has art. This also applies to empty-audience archive editions. The no-send check reports missing species instead of claiming readiness, and both handlers return HTTP 503 for incomplete art. Delivery only reads cached art; it never waits on image generation. If generation remains unavailable, delivery stays pending and requires repair rather than sending partial artwork. Digest prose uses templates and has no model timeout or fallback path; image field-mark generation retains its 10-second timeout.

## Verify a Monday run

1. In Vercel Settings → Cron Jobs, inspect the five `mode=check` invocations. They should each have a `ready` record with equal finding and illustration counts. `awaiting_illustrations` lists the missing species and needs a later preparation pass; if it persists, inspect the image-service authentication, credits, and generation errors. These checks do not send email.
2. Load the project's Blob token locally and run `node scripts/digest-status.mjs --date YYYY-MM-DD --check` and `node scripts/digest-status.mjs --date YYYY-MM-DD`. These commands only read stored status. A production `vercel env pull` can retrieve the Blob token; sensitive Resend and cron secrets cannot be pulled and appear as placeholders. Never pass those placeholders as working credentials.
3. After the final delivery attempt, all regions should be `sent` or `no_recipients`. `submitted` means Resend is still processing; `missing`, `busy` past its lease, `awaiting_illustrations`, or `failed` needs investigation.
4. Open the saved broadcast ID in Resend, verify its recipient delivery metrics, and confirm the corresponding message in Pat's inbox. `sent` is provider acceptance/completion, not proof that every recipient received it.
5. A retry during Monday's delivery hour resumes the saved broadcast. Do not create a replacement campaign when an earlier request had an uncertain result. Outside the delivery hour, the route skips sends.

Records live at `digest-delivery/YYYY-MM-DD/REGION.json` and `digest-check/YYYY-MM-DD/REGION.json` in the existing Blob store. Preparation and delivery persist the attempt operation, start time, and last phase before external work. Failures record the operation, phase, time, and a sanitized HTTP/timeout/general failure code. A later successful retry retains the last failure for diagnosis; inspect it alongside the current status. Receipts contain no recipient addresses, credentials, or raw provider error bodies. Reads used for coordination bypass CDN caches, and updates use ETags. If the storage write itself fails or a function terminates abruptly, only the last successfully saved phase is available.

## October 12 Midwest archive gap

Read-only investigation on October 14 found a complete Midwest snapshot in `digest-delivery/2026-10-12/midwest.json`, generated at `2026-10-12T13:07:43.360Z`. Its check was `ready` at 13:47 UTC with six findings, six illustrations, and no recipients. The delivery receipt ended at 14:07 UTC as `prepared`, with no archive marker or broadcast ID. Direct Blob listing confirmed that the Midwest web archive stopped at October 5. Vercel rejected the historical runtime-log query because the date was outside the plan's retention window, so the exact missing-delivery cause is not established.

Separately, preparation could overwrite a completed `no_recipients` status with `prepared`. Archived Nationwide, South, and West receipts exhibited this regression. The preparation skip described above prevents it going forward; it does not retroactively rewrite old receipts or prove that an email was sent.

To inspect a missing archive without changing production, run:

```sh
node --env-file=.env.local scripts/repair-missing-digest-archive.mjs --date 2026-10-12 --region midwest
```

The command requires a matching saved eBird snapshot, original checklist IDs and observation dates, complete reachable artwork, an expired worker lease, a past edition date, and no existing archive. It prints the exact source facts and validation results. Add `--apply` only when publication of that inspected edition is authorized. Applying conditionally creates the missing web archive through `saveRoundup`, including its linked sighting records and current factual copy. It preserves the original observations, artwork, and edition date. It cannot overwrite an existing archive, refresh birds, generate artwork, or send email. The delivery receipt remains unchanged, so publication must not be described as delivery or a provider confirmation.

## Sources

- [Vercel cron behavior](https://vercel.com/docs/cron-jobs/manage-cron-jobs): best-effort invocations, no built-in failed-run retry, function duration limits, duplicate invocation risk.
- [Vercel Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk): uncached reads and conditional writes.
- [Resend broadcasts](https://resend.com/docs/api-reference/broadcasts/create-broadcast): draft creation and separate send operations.

## Illustration authentication and repairs

Vercel Function OIDC credentials arrive on the `x-vercel-oidc-token` request header. The prewarm handler passes this token through a request-scoped environment to the image generator. An explicitly configured `AI_GATEWAY_API_KEY` still takes precedence. Reading only `process.env.VERCEL_OIDC_TOKEN` is insufficient for scheduled production functions: that token is intended for builds/local development and can expire. Never copy a request token into the global process environment or a saved receipt. Reference: [Vercel function OIDC](https://vercel.com/docs/oidc#in-vercel-functions).

To inspect a saved issue's artwork, run `node --env-file=.env.production.local scripts/repair-digest-illustrations.mjs --date YYYY-MM-DD`. Add `--apply` to generate missing drawings and republish complete web editions. This preserves the original issue's birds, dates, and observations; republishing applies `source-facts-v1` to the descriptions. It cannot change already-delivered email and has no email-sending code. Refresh local OIDC credentials with `vercel env pull` first; local tokens expire after 12 hours.
