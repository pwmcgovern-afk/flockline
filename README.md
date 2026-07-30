# Flockline

Flockline is a live, eBird-backed map for following recent bird movement across the United States. It combines a 1,400+ species national catalog, four U.S. Census region presets with state-level refinement, resilient multi-state data loading, a daily timeline, region-aware notable-sighting insights, a grounded birding assistant, original field-guide artwork, Field/Dusk themes, and a persistent My Birds watchlist with in-app field alerts.

Production: [flockline.vercel.app](https://flockline.vercel.app)

## Nationwide scope

- Choose Northeast, Midwest, South, or West, then include or remove individual states.
- Share links store compact region presets when possible and explicit state lists for custom selections.
- Sightings and Insights load states with bounded concurrency, cache each state independently, and keep successful results visible if one eBird request fails.
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

## Quality checks

```bash
npm run check
```

This runs the state/share-link tests, TypeScript compilation, and the production Vite build.

## Deployment

The app is deployed on Vercel. Production secrets belong in Vercel environment variables; the public UI never accepts or mutates API credentials.
