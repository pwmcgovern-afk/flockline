# Flockline

Flockline is a live, eBird-backed map for exploring recent bird reports across the United States. It combines a 1,400+ species national catalog, a Nationwide view plus four U.S. Census region presets with state-level refinement, resilient multi-state data loading, a timeline of the latest reports at each location, region-aware selections from eBird's notable feed, weekly regional email digests, an AI birding assistant with eBird tools, original field-guide artwork, responsive map controls, and a persistent My Birds watchlist with in-app field alerts.

Insights and digests select reports deterministically by recency and geographic variety and describe source facts using templates. They do not rank biological rarity or infer movement from separate sightings. A historical reporting-frequency pilot adds county and seasonal context where supported, currently San Francisco County using 2016–2025 eBird bar-chart data. Missing coverage is explicit. See [the baseline method and limits](docs/RARITY_BASELINE.md). eBird notable flags are local and date-specific; reports retain their available review status. The map's reported count sums supplied numeric counts, omitting unknown counts. It is not a count of distinct birds or a population lower bound.

Production: [flockline.app](https://flockline.app)

## Nationwide scope

- Choose Nationwide, Northeast, Midwest, South, or West, then include or remove individual states.
- Share links store compact region presets when possible and explicit state lists for custom selections.
- Regional and custom views load states with bounded concurrency, while Nationwide uses eBird's country-level feed to avoid a 51-request burst. Successful state results remain visible if one regional request fails.
- Ask receives the same selected states. It can answer for anywhere in the U.S. and asks for a town, park, ZIP code, or coordinates instead of guessing what “near me” means.
- The committed species catalog is regenerated from eBird's all-time U.S. bird list with `node scripts/build-catalog.mjs`.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Configuration

Create a `.env` file for live data and AI-assisted features:

```bash
EBIRD_API_KEY=your_ebird_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

Without an eBird token, Flockline uses deterministic demo sightings so the map and timeline remain usable. Without an Anthropic key, live map data, Insights, and digest summaries still work; Ask is unavailable.

### Weekly email digest

The email flow uses Resend Contacts, one subscriber Segment, and five opt-in Topics. An encrypted confirmation link prevents an address from being subscribed without its owner's approval. Each edition has its own secured Vercel Cron beginning at 10 a.m. Eastern on Monday, staggered over five minutes. Three further attempts at 15-minute intervals resume incomplete work. A daylight-saving guard rejects the alternate UTC hour.

Delivery saves the issue and a Resend draft ID in Blob before sending. A retry resumes that same broadcast, including after an uncertain network result. Conditional Blob writes prevent overlapping workers, and completed receipts survive function-log expiration. Empty regional audiences are archived without creating or sending a broadcast. Image generation runs separately before delivery; the send path requires a cached illustration for every entry and stays pending if artwork is incomplete.

The `source-facts-v1` editorial policy also corrects legacy web editions on read, with a visible note, while preserving their original saved observations, dates, and artwork. This does not rewrite historical blobs or change already-delivered email. New archive writes and email rendering use factual templates; Ask remains generative.

Each region also has a protected `mode=check` cron. Its dashboard **Run** button checks the actual sender, subscriber routing, live eBird data, rendering, and Blob writes without creating a broadcast, sending mail, or publishing a new archive issue. These checks run before Monday delivery and can be run manually on any day. All cron paths require `CRON_SECRET`; a region is mandatory. The old all-region `persist-only` shortcut has been removed.

To read durable evidence using a locally loaded Flockline Blob token:

```bash
node --env-file=.env.local scripts/digest-status.mjs --date 2026-09-07 --check
node --env-file=.env.local scripts/digest-status.mjs --date 2026-09-07
```

The command is read-only and exits nonzero for missing, failed, or still-pending work. A `sent` receipt means Resend reports the broadcast sent. Verify recipient delivery in Resend and the destination inbox separately. See [the delivery runbook](docs/DIGEST_DELIVERY.md).

After connecting Resend and verifying `flockline.app`, pull the Vercel environment and run the one-time mailing-list setup:

```bash
npx vercel env pull .env.local --yes
npm run setup:digest
```

The script prints the Segment and Topic IDs to add to Vercel. Configure every digest variable shown in `.env.example`, including separate random values for `DIGEST_SIGNING_SECRET` and `CRON_SECRET`. Resend Broadcasts supply the preference page and unsubscribe handling.

## Quality checks

```bash
npm run check
```

This runs the state/share-link tests, TypeScript compilation, and the production Vite build.

`npm run test:ui` runs Chrome regressions for mobile signup, history, search,
map and Insights request races, keyboard navigation, and archive recovery. It
starts Vite if needed and intercepts every API and external resource, so tests
never send email or consume live eBird/AI requests. Local runs use installed
Google Chrome; CI installs Playwright Chromium.

## Deployment

The app is deployed on Vercel. Production secrets belong in Vercel environment variables; the public UI never accepts or mutates API credentials.

Pull requests and pushes to `main` run the GitHub Actions quality gate in `.github/workflows/ci.yml`.

`package.json` pins Node.js 22 for local tooling, CI, and Vercel functions. Keeping those environments aligned avoids runtime-only surprises.

Vercel's Git integration creates preview deployments for feature branches and deploys merges to `main` to production. Confirm the production deployment's Git SHA matches the merged commit and `flockline.app` points to it before treating the change as shipped. GitHub Actions verifies the same commit, but is a separate pipeline, so wait for its checks before merging.

If the Git deployment fails to appear, the explicit fallback from the clean merged checkout is:

```bash
npx vercel deploy --prod --yes
```

Then verify the deployment and alias as above. Preview has Blob access but no production eBird, Anthropic, or email secrets. Test source-backed flows in local configuration and verify them on production after deployment; a working preview alone does not prove those integrations.
