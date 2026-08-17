# Flockline

Flockline is a live, eBird-backed map for following recent bird movement across the United States. It combines a 1,400+ species national catalog, a Nationwide view plus four U.S. Census region presets with state-level refinement, resilient multi-state data loading, a daily timeline, region-aware notable-sighting insights, weekly regional email digests, a grounded birding assistant, original field-guide artwork, Field/Dusk themes, and a persistent My Birds watchlist with in-app field alerts.

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

Without an eBird token, Flockline uses deterministic demo sightings so the map and timeline remain usable. Without an Anthropic key, live map data still works and AI-authored features fall back gracefully.

### Weekly email digest

The email flow uses Resend Contacts, one subscriber Segment, and five opt-in Topics. An encrypted confirmation link prevents an address from being subscribed without its owner's approval. A secured Vercel Cron sends each regional edition at 10:00 a.m. Eastern every Monday, with a daylight-saving guard around its two possible UTC invocations.

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

## Deployment

The app is deployed on Vercel. Production secrets belong in Vercel environment variables; the public UI never accepts or mutates API credentials.

Pull requests and pushes to `main` run the GitHub Actions quality gate in `.github/workflows/ci.yml`.

`package.json` pins Node.js 22 for local tooling, CI, and Vercel functions. Keeping those environments aligned avoids runtime-only surprises.

Flockline does not currently rely on Vercel Git auto-deployments. After merging to `main`, deploy the exact merged commit manually:

```bash
npx vercel deploy --prod --yes
```

Confirm that `flockline.app` points to that deployment before treating the change as shipped.
