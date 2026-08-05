import "dotenv/config";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import {
  getChecklistDetails,
  getConfig,
  getInsights,
  getSightings,
  getSpeciesSuggestions,
  chatWithBirds
} from "../lib/ebirdCore.js";
import { enforceRateLimit } from "../lib/rateLimit.js";
import { US_STATES, getCensusRegion } from "../shared/usGeography.js";

const PORT = Number(process.env.PORT || 8787);
const ebirdApiKey = process.env.EBIRD_API_KEY || "";
const EBIRD_BASE_URL = "https://api.ebird.org/v2";
const CACHE_TTL_MS = 5 * 60 * 1000;
const TAXONOMY_TTL_MS = 24 * 60 * 60 * 1000;
const speciesPresets = JSON.parse(fs.readFileSync(new URL("../shared/speciesCatalog.json", import.meta.url), "utf8"));

const app = express();
app.use(cors());
app.use(express.json({ limit: "64kb" }));

const speciesAliases = new Map();
for (const species of speciesPresets) {
  speciesAliases.set(normalizeSpeciesKey(species.speciesCode), species);
  speciesAliases.set(normalizeSpeciesKey(species.comName), species);
}
speciesAliases.set("coopershawk", speciesPresets.find((species) => species.speciesCode === "coohaw"));
speciesAliases.set("cooperhawk", speciesPresets.find((species) => species.speciesCode === "coohaw"));
speciesAliases.set("redtail", speciesPresets.find((species) => species.speciesCode === "rethaw"));
speciesAliases.set("redtailedhawk", speciesPresets.find((species) => species.speciesCode === "rethaw"));
speciesAliases.set("herringgull", speciesPresets.find((species) => species.speciesCode === "amhgul1"));
speciesAliases.set("warblingvireo", speciesPresets.find((species) => species.speciesCode === "eawvir1"));
speciesAliases.set("housewren", speciesPresets.find((species) => species.speciesCode === "houwre"));
speciesAliases.set("yellowwarbler", speciesPresets.find((species) => species.speciesCode === "yelwar1"));

const responseCache = new Map();
let taxonomyCache = null;

app.get("/api/config", (_request, response) => {
  response.json(getConfig(ebirdApiKey));
});

app.get("/api/species", async (request, response) => {
  const query = String(request.query.q || "").trim();
  response.json(await getSpeciesSuggestions(query, ebirdApiKey));
});

app.get("/api/sightings", async (request, response) => {
  try {
    response.json(await getSightings(request.query, ebirdApiKey));
  } catch (error) {
    response.status(error.statusCode || 502).json({ error: error.message || "Unable to fetch eBird sightings." });
  }
});

app.get("/api/insights", async (request, response) => {
  const fresh = parseBoolean(request.query.fresh, false);
  if (fresh && !enforceRateLimit(request, response, {
    name: "fresh-insights",
    limit: 40,
    windowMs: 60 * 60 * 1000,
    message: "Too many refreshes in a row. Give it a minute and try again."
  })) {
    return;
  }
  try {
    const payload = await getInsights(request.query);
    response.json(payload);
  } catch (error) {
    response.status(502).json({ error: "Unable to build insights.", detail: error.message });
  }
});

app.get("/api/checklist", async (request, response) => {
  try {
    const payload = await getChecklistDetails(request.query);
    response.set("Cache-Control", "public, max-age=0, s-maxage=900, stale-while-revalidate=1800");
    response.json(payload);
  } catch (error) {
    response.status(error.statusCode || 502).json({ error: error.message || "Unable to fetch eBird checklist details." });
  }
});

app.post("/api/chat", async (request, response) => {
  if (!enforceRateLimit(request, response, {
    name: "chat",
    limit: 8,
    windowMs: 10 * 60 * 1000,
    message: "You have reached the Ask limit for now. Please try again in a few minutes."
  })) {
    return;
  }
  try {
    const payload = await chatWithBirds(request.body || {});
    response.json(payload);
  } catch (error) {
    response.status(error.statusCode || 502).json({ error: error.message || "Chat failed." });
  }
});

app.listen(PORT, () => {
  console.log(`eBird proxy running on http://127.0.0.1:${PORT}`);
  console.log(ebirdApiKey ? "Live eBird API mode enabled." : "EBIRD_API_KEY missing; using demo sightings.");
});

async function fetchRegionSightings(regionCode, speciesCode, back, includeProvisional, hotspot) {
  const url = new URL(`${EBIRD_BASE_URL}/data/obs/${regionCode}/recent/${speciesCode}`);
  url.searchParams.set("back", String(back));
  url.searchParams.set("maxResults", "10000");
  url.searchParams.set("includeProvisional", String(includeProvisional));
  url.searchParams.set("hotspot", String(hotspot));
  url.searchParams.set("sppLocale", "en");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);
  try {
    const response = await fetch(url, {
      headers: {
        "x-ebirdapitoken": ebirdApiKey,
        accept: "application/json"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${regionCode} ${response.status}: ${body.slice(0, 180)}`);
    }
    const observations = await response.json();
    return observations.map((observation) => ({ ...observation, regionCode }));
  } finally {
    clearTimeout(timeout);
  }
}

async function getTaxonomy() {
  const now = Date.now();
  if (taxonomyCache && now - taxonomyCache.createdAt < TAXONOMY_TTL_MS) {
    return taxonomyCache.items;
  }

  const url = new URL(`${EBIRD_BASE_URL}/ref/taxonomy/ebird`);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("locale", "en");

  const response = await fetch(url, {
    headers: {
      ...(ebirdApiKey ? { "x-ebirdapitoken": ebirdApiKey } : {}),
      accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`Taxonomy request failed: ${response.status}`);
  }

  const items = (await response.json())
    .filter((item) => item.category === "species")
    .map((item) => ({
      speciesCode: item.speciesCode,
      comName: item.comName,
      sciName: item.sciName,
      group: item.familyComName || item.order || "Species"
    }));

  taxonomyCache = { createdAt: now, items };
  return items;
}

async function resolveSpecies(input) {
  const local = speciesAliases.get(normalizeSpeciesKey(input));
  if (local) {
    return local;
  }

  if (ebirdApiKey && input.length > 2) {
    try {
      const matches = searchSpecies(input, await getTaxonomy());
      if (matches.length) {
        return matches[0];
      }
    } catch {
      // The endpoint can still run if the user supplied a direct species code.
    }
  }

  return {
    speciesCode: input.toLowerCase(),
    comName: titleize(input),
    sciName: "",
    group: "Species"
  };
}

function buildPayloadFromObservations(species, regions, back, observations, source) {
  const deduped = [];
  const seen = new Set();
  for (const observation of observations) {
    if (!Number.isFinite(Number(observation.lat)) || !Number.isFinite(Number(observation.lng))) {
      continue;
    }
    const key = [
      observation.subId,
      observation.speciesCode,
      observation.obsDt,
      Number(observation.lat).toFixed(5),
      Number(observation.lng).toFixed(5)
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(observation);
  }

  const features = deduped.map((observation) => observationToFeature(observation, species));
  const checklists = new Set(features.map((feature) => feature.properties.subId).filter(Boolean));
  const regionCounts = Object.fromEntries(regions.map((region) => [region, 0]));
  for (const feature of features) {
    regionCounts[feature.properties.regionCode] = (regionCounts[feature.properties.regionCode] || 0) + 1;
  }

  return {
    source,
    species,
    back,
    regions,
    generatedAt: new Date().toISOString(),
    featureCollection: {
      type: "FeatureCollection",
      features
    },
    stats: {
      sightings: features.length,
      checklists: checklists.size,
      regionCounts,
      latestObsDt: features
        .map((feature) => feature.properties.obsDt)
        .filter(Boolean)
        .sort()
        .at(-1) || null
    }
  };
}

function observationToFeature(observation, fallbackSpecies) {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [Number(observation.lng), Number(observation.lat)]
    },
    properties: {
      speciesCode: observation.speciesCode || fallbackSpecies.speciesCode,
      comName: observation.comName || fallbackSpecies.comName,
      sciName: observation.sciName || fallbackSpecies.sciName,
      locId: observation.locId,
      locName: observation.locName || "Location",
      obsDt: observation.obsDt,
      howMany: observation.howMany ?? null,
      obsValid: Boolean(observation.obsValid),
      obsReviewed: Boolean(observation.obsReviewed),
      locationPrivate: Boolean(observation.locationPrivate),
      subId: observation.subId,
      regionCode: observation.regionCode || inferRegionCode(observation.lat, observation.lng)
    }
  };
}

function buildDemoPayload(species, regions, back, includeProvisional, hotspot) {
  const now = new Date();
  const observations = [];
  const selectedStates = US_STATES.filter((state) => regions.includes(state.code));
  const density = species.speciesCode === "osprey" ? 8 : species.speciesCode === "coohaw" ? 6 : 5;

  for (const state of selectedStates) {
    for (let day = 0; day < back; day += 1) {
      const dailyCount = Math.max(1, Math.round(density - day * 0.14 + seededNoise(`${species.speciesCode}-${state.code}-${day}`) * 4));
      for (let index = 0; index < dailyCount; index += 1) {
        const seed = `${species.speciesCode}-${state.code}-${day}-${index}`;
        const stateSize = state.code === "US-NY" || state.code === "US-PA" ? 2.8 : 1.2;
        const lat = state.center[0] + (seededNoise(`${seed}-lat`) - 0.5) * stateSize;
        const lng = state.center[1] + (seededNoise(`${seed}-lng`) - 0.5) * stateSize * 1.7;
        const date = new Date(now);
        date.setDate(now.getDate() - day);
        date.setHours(6 + Math.floor(seededNoise(`${seed}-hour`) * 12));
        date.setMinutes(Math.floor(seededNoise(`${seed}-minute`) * 60));

        observations.push({
          speciesCode: species.speciesCode,
          comName: species.comName,
          sciName: species.sciName,
          locId: `DEMO-${state.abbr}-${index}`,
          locName: `${state.name} ${hotspot ? "Hotspot" : "Observation Area"} ${index + 1}`,
          obsDt: formatObservationDate(date),
          howMany: 1 + Math.floor(seededNoise(`${seed}-count`) * 4),
          lat,
          lng,
          obsValid: true,
          obsReviewed: includeProvisional ? seededNoise(`${seed}-reviewed`) > 0.22 : true,
          locationPrivate: seededNoise(`${seed}-private`) > 0.74,
          subId: `SDEMO${state.abbr}${day}${index}`,
          regionCode: state.code
        });
      }
    }
  }

  return buildPayloadFromObservations(species, regions, back, observations, "demo");
}

function searchSpecies(query, items) {
  const normalizedQuery = normalizeSpeciesKey(query);
  if (!normalizedQuery) {
    return [...items];
  }

  return [...items]
    .map((item) => {
      const code = normalizeSpeciesKey(item.speciesCode);
      const common = normalizeSpeciesKey(item.comName);
      const scientific = normalizeSpeciesKey(item.sciName);
      const score =
        code === normalizedQuery
          ? 100
          : common === normalizedQuery
            ? 95
            : common.startsWith(normalizedQuery)
              ? 80
              : code.startsWith(normalizedQuery)
                ? 70
                : common.includes(normalizedQuery)
                  ? 55
                  : scientific.includes(normalizedQuery)
                    ? 35
                    : 0;
      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.item.comName.localeCompare(b.item.comName))
    .map(({ item }) => item);
}

function mergeSpecies(...lists) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const item of list) {
      if (!item?.speciesCode || seen.has(item.speciesCode)) {
        continue;
      }
      seen.add(item.speciesCode);
      merged.push(item);
    }
  }
  return merged;
}

function normalizeSpeciesKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function titleize(value) {
  return String(value || "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(String(value), 10);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function parseBoolean(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function getCache(key) {
  const entry = responseCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value, ttl) {
  responseCache.set(key, {
    value,
    expiresAt: Date.now() + ttl
  });
}

function seededNoise(seed) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

function formatObservationDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function inferRegionCode(lat, lng) {
  let closest = US_STATES[0];
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const state of US_STATES) {
    const distance = Math.abs(Number(lat) - state.center[0]) + Math.abs(Number(lng) - state.center[1]);
    if (distance < closestDistance) {
      closest = state;
      closestDistance = distance;
    }
  }
  return closest.code;
}
