# Weekly digest delivery

## September 5 investigation

Resend's broadcast history and API logs show no August 31 broadcast attempt. The latest five public archive issues are August 24. The four August 24 regional draft broadcasts correspond to Resend 422 responses for empty audiences; Northeast was sent. The Vercel log API rejected the historical query with `ExceedsBillingLimitError`, so the exact August 31 invocation outcome cannot be recovered from that query. A missing log result must not be interpreted as a successful run.

Confirmed weaknesses were a minute-only time gate (fixed in PR #46), serial processing of all five regions within one 300-second function, image generation and an unbounded prose request before archive/send, no automatic retries, and no durable delivery evidence. Resend's create-and-send request also made uncertain outcomes difficult to reconcile.

The August 31 edition cannot be faithfully reconstructed from today's rolling eBird feed. Do not publish today's observations under an August 31 date or send a catch-up edition without Pat's explicit instruction.

## Current schedule and recovery

- Five regional prewarm jobs run twice at 13:00-13:04 and 13:20-13:24 UTC on Monday. Each generates at most three images in one batch.
- Five no-send checks run at 13:45-13:49 UTC. Their dashboard Run buttons are safe for manual verification on any day.
- Five delivery jobs begin at 10:00-10:04 a.m. Eastern. They retry three times at 15-minute intervals. Both possible UTC hours are scheduled; the Eastern-time guard accepts only the correct hour.
- Every delivery acquires a conditional Blob lease that outlasts the 300-second function but expires before the next retry.
- The first attempt saves a fixed roundup and archive. It creates a draft, saves the broadcast ID, then sends that ID. Retries reconcile provider state before sending, including after a lost create/send response. They never intentionally create another campaign for the same named edition.
- A region with no subscribed recipients still gets an archive issue and a `no_recipients` receipt. It does not create an orphan draft. Failed recipient lookups remain failures.
- A cache miss for bird art falls back to text during delivery. Prose generation has a 25-second timeout and a deterministic fallback; image field-mark generation has a 10-second timeout.

## Verify a Monday run

1. In Vercel Settings → Cron Jobs, inspect the five `mode=check` invocations. They should each have a `ready` record. These checks do not send email.
2. Load the project's Blob token locally and run `node scripts/digest-status.mjs --date YYYY-MM-DD --check` and `node scripts/digest-status.mjs --date YYYY-MM-DD`. These commands only read stored status. A production `vercel env pull` can retrieve the Blob token; sensitive Resend and cron secrets cannot be pulled and appear as placeholders. Never pass those placeholders as working credentials.
3. After the final delivery attempt, all regions should be `sent` or `no_recipients`. `submitted` means Resend is still processing; `missing`, `busy` past its lease, or `failed` needs investigation.
4. Open the saved broadcast ID in Resend, verify its recipient delivery metrics, and confirm the corresponding message in Pat's inbox. `sent` is provider acceptance/completion, not proof that every recipient received it.
5. A retry during Monday's delivery hour resumes the saved broadcast. Do not create a replacement campaign when an earlier request had an uncertain result. Outside the delivery hour, the route skips sends.

Records live at `digest-delivery/YYYY-MM-DD/REGION.json` and `digest-check/YYYY-MM-DD/REGION.json` in the existing Blob store. They contain no recipient addresses, credentials, or raw provider error bodies. Reads used for coordination bypass CDN caches, and updates use ETags.

## Sources

- [Vercel cron behavior](https://vercel.com/docs/cron-jobs/manage-cron-jobs): best-effort invocations, no built-in failed-run retry, function duration limits, duplicate invocation risk.
- [Vercel Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk): uncached reads and conditional writes.
- [Resend broadcasts](https://resend.com/docs/api-reference/broadcasts/create-broadcast): draft creation and separate send operations.
