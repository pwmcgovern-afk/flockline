# Flockline

A local, eBird-backed map for recent species sightings across the Northeast United States. The built-in catalog includes 100 common New England species with current eBird species codes.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Live eBird Data

Use the eBird Key panel in the app, or create a `.env` file with your eBird API token:

```bash
EBIRD_API_KEY=your_ebird_api_key_here
```

Without a token, the app runs with deterministic demo sightings so the map, filters, and playback controls remain usable.
