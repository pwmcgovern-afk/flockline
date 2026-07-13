# Flockline

Flockline is a live, eBird-backed map for following recent bird movement across the Northeast United States. It combines 714 searchable species, state and hotspot filters, a daily timeline, notable-sighting insights, and a grounded birding assistant.

Production: [flockline.vercel.app](https://flockline.vercel.app)

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
