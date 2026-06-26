import fs from "node:fs";

const EBIRD_BASE_URL = "https://api.ebird.org/v2";
const CACHE_TTL_MS = 5 * 60 * 1000;
const TAXONOMY_TTL_MS = 24 * 60 * 60 * 1000;

// Insights: rare/notable bird activity across New England, regenerated at most
// once per 6h. LLM phrasing when ANTHROPIC_API_KEY is present, deterministic
// templating otherwise.
const INSIGHTS_TTL_MS = 6 * 60 * 60 * 1000;
const INSIGHTS_BACK_DAYS = 14;
const INSIGHTS_MODEL = "claude-opus-4-8";
const NEW_ENGLAND = ["US-ME", "US-NH", "US-VT", "US-MA", "US-RI", "US-CT"];

export const northeastStates = [
  { code: "US-ME", abbr: "ME", name: "Maine", center: [44.6939, -69.3819] },
  { code: "US-NH", abbr: "NH", name: "New Hampshire", center: [43.6805, -71.5811] },
  { code: "US-VT", abbr: "VT", name: "Vermont", center: [44.0459, -72.7107] },
  { code: "US-MA", abbr: "MA", name: "Massachusetts", center: [42.4072, -71.3824] },
  { code: "US-RI", abbr: "RI", name: "Rhode Island", center: [41.5801, -71.4774] },
  { code: "US-CT", abbr: "CT", name: "Connecticut", center: [41.6032, -73.0877] },
  { code: "US-NY", abbr: "NY", name: "New York", center: [42.9538, -75.5268] },
  { code: "US-NJ", abbr: "NJ", name: "New Jersey", center: [40.0583, -74.4057] },
  { code: "US-PA", abbr: "PA", name: "Pennsylvania", center: [41.2033, -77.1945] }
];

export const speciesPresets = JSON.parse(fs.readFileSync(new URL("../shared/speciesCatalog.json", import.meta.url), "utf8"));

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
let runtimeApiKey = "";

export function activateApiKey(apiKey) {
  runtimeApiKey = apiKey;
  responseCache.clear();
  taxonomyCache = null;
}

export function getApiKey() {
  return runtimeApiKey || process.env.EBIRD_API_KEY || "";
}

export function getConfig(apiKey = getApiKey()) {
  return {
    hasApiKey: Boolean(apiKey),
    states: northeastStates,
    presets: speciesPresets,
    maxBackDays: 30
  };
}

export async function getSpeciesSuggestions(query, apiKey = getApiKey()) {
  const cleanedQuery = String(query || "").trim();
  const localMatches = searchSpecies(cleanedQuery, speciesPresets);

  if (!apiKey || cleanedQuery.length < 2) {
    return { source: "local", items: localMatches.slice(0, 18) };
  }

  try {
    const taxonomy = await getTaxonomy(apiKey);
    const taxonomyMatches = searchSpecies(cleanedQuery, taxonomy).slice(0, 28);
    const merged = mergeSpecies(localMatches, taxonomyMatches).slice(0, 28);
    return { source: "ebird", items: merged };
  } catch (error) {
    return { source: "local", items: localMatches.slice(0, 18), warning: error.message };
  }
}

export async function getSightings(query, apiKey = getApiKey()) {
  const speciesInput = String(query.species || "osprey").trim();
  const species = await resolveSpecies(speciesInput, apiKey);
  const back = clampInteger(query.back, 1, 30, 7);
  const includeProvisional = parseBoolean(query.includeProvisional, true);
  const hotspot = parseBoolean(query.hotspot, false);
  const requestedRegions = String(query.regions || "")
    .split(",")
    .map((region) => region.trim().toUpperCase())
    .filter(Boolean);
  const regions = requestedRegions.length
    ? requestedRegions.filter((region) => northeastStates.some((state) => state.code === region))
    : northeastStates.map((state) => state.code);

  if (!regions.length) {
    const error = new Error("No valid Northeast regions selected.");
    error.statusCode = 400;
    throw error;
  }

  const cacheKey = JSON.stringify({
    mode: apiKey ? "live" : "demo",
    speciesCode: species.speciesCode,
    back,
    includeProvisional,
    hotspot,
    regions
  });
  const cached = getCache(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  if (!apiKey) {
    const demoPayload = buildDemoPayload(species, regions, back, includeProvisional, hotspot);
    setCache(cacheKey, demoPayload, CACHE_TTL_MS);
    return demoPayload;
  }

  const observationsByRegion = await Promise.all(
    regions.map((regionCode) => fetchRegionSightings(regionCode, species.speciesCode, back, includeProvisional, hotspot, apiKey))
  );
  const payload = buildPayloadFromObservations(species, regions, back, observationsByRegion.flat(), "ebird");
  setCache(cacheKey, payload, CACHE_TTL_MS);
  return payload;
}

export async function getInsights(query, apiKey = getApiKey()) {
  const back = clampInteger(query?.back, 1, 30, INSIGHTS_BACK_DAYS);
  const hasLlm = Boolean(process.env.ANTHROPIC_API_KEY);
  const cacheKey = JSON.stringify({ insights: true, back, gen: hasLlm ? "llm" : "tpl" });
  const cached = getCache(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  const base = {
    generatedAt: new Date().toISOString(),
    back,
    regions: NEW_ENGLAND,
    cached: false
  };

  if (!apiKey) {
    const payload = { ...base, source: "demo", generator: "template", findings: [] };
    setCache(cacheKey, payload, INSIGHTS_TTL_MS);
    return payload;
  }

  const settled = await Promise.allSettled(NEW_ENGLAND.map((region) => fetchNotable(region, back, apiKey)));
  const rows = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const candidates = buildInsightCandidates(rows);

  let generator = "template";
  let findings = buildDeterministicFindings(candidates);

  if (hasLlm && candidates.length) {
    const llm = await generateLlmFindings(candidates.slice(0, 8));
    if (llm && llm.length) {
      findings = mergeLlmFindings(llm, candidates);
      generator = "llm";
    }
  }

  const payload = { ...base, source: "ebird", generator, findings: findings.slice(0, 4) };
  setCache(cacheKey, payload, INSIGHTS_TTL_MS);
  return payload;
}

async function fetchNotable(regionCode, back, apiKey) {
  const url = new URL(`${EBIRD_BASE_URL}/data/obs/${regionCode}/recent/notable`);
  url.searchParams.set("back", String(back));
  url.searchParams.set("detail", "full");
  url.searchParams.set("maxResults", "50");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);
  try {
    const response = await fetch(url, {
      headers: { "x-ebirdapitoken": apiKey, accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`${regionCode} notable ${response.status}`);
    }
    const rows = await response.json();
    return rows.map((row) => ({ ...row, regionCode }));
  } finally {
    clearTimeout(timeout);
  }
}

// Collapse notable rows to one ranked candidate per species: how widely (state
// count) and often (report count) it showed up, plus its best single record.
function buildInsightCandidates(rows) {
  const bySpecies = new Map();
  for (const row of rows) {
    if (!row.speciesCode || !row.comName) {
      continue;
    }
    const entry = bySpecies.get(row.speciesCode) ?? {
      speciesCode: row.speciesCode,
      comName: row.comName,
      sciName: row.sciName ?? "",
      regions: new Set(),
      reportCount: 0,
      maxCount: 0,
      best: null
    };
    entry.regions.add(row.regionCode);
    entry.reportCount += 1;
    entry.maxCount = Math.max(entry.maxCount, Number(row.howMany) || 0);
    if (!entry.best || String(row.obsDt) > String(entry.best.obsDt)) {
      entry.best = row;
    }
    bySpecies.set(row.speciesCode, entry);
  }

  const candidates = [...bySpecies.values()].map((entry) => {
    const stateCount = entry.regions.size;
    const kind = stateCount >= 3 ? "wide" : entry.reportCount >= 6 ? "surge" : "rarity";
    const daysAgo = daysSince(entry.best?.obsDt);
    const score = stateCount * 5 + entry.reportCount * 2 + Math.min(entry.maxCount, 20) * 0.2 + Math.max(0, 5 - daysAgo);
    return {
      kind,
      speciesCode: entry.speciesCode,
      comName: entry.comName,
      sciName: entry.sciName,
      stateCount,
      reportCount: entry.reportCount,
      maxCount: entry.maxCount,
      locName: entry.best?.locName || "an undisclosed location",
      regionName: regionLabel(entry.best?.regionCode),
      obsDt: entry.best?.obsDt || "",
      subId: entry.best?.subId || "",
      score
    };
  });

  return candidates.sort((a, b) => b.score - a.score);
}

function buildDeterministicFindings(candidates) {
  return candidates.slice(0, 4).map((candidate) => ({
    ...templateFinding(candidate),
    generatedBy: "template"
  }));
}

function templateFinding(c) {
  const when = formatInsightDate(c.obsDt);
  const meta = { speciesCode: c.speciesCode, comName: c.comName, locName: c.locName, region: c.regionName, obsDt: c.obsDt, subId: c.subId };
  if (c.kind === "wide") {
    return {
      kind: "wide",
      title: `${c.comName} turning up across New England`,
      detail: `Notable ${c.comName} reports in ${c.stateCount} New England states over the past two weeks, including ${c.locName}, ${c.regionName}.`,
      ...meta
    };
  }
  if (c.kind === "surge") {
    return {
      kind: "surge",
      title: `A cluster of ${c.comName} reports`,
      detail: `${c.reportCount} notable ${c.comName} sightings across New England recently, an unusual run for the region.`,
      ...meta
    };
  }
  const count = c.maxCount > 1 ? ` (up to ${c.maxCount})` : "";
  return {
    kind: "rarity",
    title: `Rare sighting: ${c.comName}`,
    detail: `${c.comName}${count} reported at ${c.locName}, ${c.regionName}${when ? ` on ${when}` : ""}. A notable record for the area.`,
    ...meta
  };
}

// Let the model write kind/title/detail, but always overwrite the linkable
// fields from the chosen candidate so checklist links can't be hallucinated.
// Top up with deterministic findings if the model returns fewer than 4 valid.
function mergeLlmFindings(items, candidates) {
  const byCode = new Map(candidates.map((c) => [c.speciesCode, c]));
  const used = new Set();
  const findings = [];

  for (const item of items) {
    const candidate = byCode.get(item?.speciesCode);
    if (!candidate || used.has(candidate.speciesCode)) {
      continue;
    }
    const kind = ["rarity", "wide", "surge"].includes(item.kind) ? item.kind : candidate.kind;
    const title = String(item.title || "").trim().slice(0, 80) || templateFinding(candidate).title;
    const detail = String(item.detail || "").trim() || templateFinding(candidate).detail;
    used.add(candidate.speciesCode);
    findings.push({
      kind,
      title,
      detail,
      speciesCode: candidate.speciesCode,
      comName: candidate.comName,
      locName: candidate.locName,
      region: candidate.regionName,
      obsDt: candidate.obsDt,
      subId: candidate.subId,
      generatedBy: "llm"
    });
  }

  for (const candidate of candidates) {
    if (findings.length >= 4) {
      break;
    }
    if (!used.has(candidate.speciesCode)) {
      used.add(candidate.speciesCode);
      findings.push({ ...templateFinding(candidate), generatedBy: "template" });
    }
  }

  return findings;
}

async function generateLlmFindings(candidates) {
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: INSIGHTS_MODEL,
      max_tokens: 1024,
      output_config: { format: { type: "json_schema", schema: INSIGHTS_SCHEMA } },
      messages: [{ role: "user", content: buildInsightPrompt(candidates) }]
    });
    if (response.stop_reason === "refusal") {
      return null;
    }
    const text = response.content.find((block) => block.type === "text")?.text || "";
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed) ? parsed : parsed.findings;
    return Array.isArray(items) ? items : null;
  } catch (error) {
    console.error(JSON.stringify({ event: "insights_llm_failed", message: error?.message }));
    return null;
  }
}

const INSIGHTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["rarity", "wide", "surge"] },
          title: { type: "string" },
          detail: { type: "string" },
          speciesCode: { type: "string" }
        },
        required: ["kind", "title", "detail", "speciesCode"]
      }
    }
  },
  required: ["findings"]
};

function buildInsightPrompt(candidates) {
  const list = candidates
    .map((c, index) => {
      const counts = `${c.stateCount} state(s), ${c.reportCount} report(s)${c.maxCount > 1 ? `, up to ${c.maxCount} birds` : ""}`;
      const where = `${c.locName}, ${c.regionName}${c.obsDt ? ` (${String(c.obsDt).slice(0, 10)})` : ""}`;
      return `${index + 1}. ${c.comName} [${c.speciesCode}] — ${counts}; latest at ${where}`;
    })
    .join("\n");

  return `You are writing exactly 4 short, interesting findings about recent notable bird activity across New England (Maine, New Hampshire, Vermont, Massachusetts, Rhode Island, Connecticut), for birders looking at a live sightings map.

Below are candidate notable species from eBird over the past two weeks, each with how widely and how often it was reported. Choose the 4 most interesting and varied. For each, write:
- "kind": one of "rarity" (locally rare), "wide" (reported across several states), or "surge" (an unusual cluster of reports).
- "title": a punchy headline, 70 characters or fewer, with no trailing period.
- "detail": ONE plain sentence a birder would find interesting. Name the species, and the place when it helps.
- "speciesCode": copy the exact eBird code in brackets from the candidate you chose.

Rules: use only species from the list; do not invent locations, dates, or counts; use periods and commas, never em dashes. Return JSON matching the schema.

Candidates:
${list}`;
}

function daysSince(obsDt) {
  if (!obsDt) {
    return 99;
  }
  const then = new Date(String(obsDt).slice(0, 10)).getTime();
  if (!Number.isFinite(then)) {
    return 99;
  }
  return Math.max(0, Math.round((Date.now() - then) / (24 * 60 * 60 * 1000)));
}

function regionLabel(code) {
  return northeastStates.find((state) => state.code === code)?.name || code || "New England";
}

function formatInsightDate(value) {
  if (!value) {
    return "";
  }
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) {
    return "";
  }
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(year, month - 1, day));
}

export function sanitizeApiKey(value) {
  const apiKey = String(value || "").trim();
  if (apiKey.length < 8 || apiKey.length > 160 || /[\s"'`]/.test(apiKey)) {
    return "";
  }
  return apiKey;
}

export async function validateEbirdKey(apiKey) {
  const url = new URL(`${EBIRD_BASE_URL}/data/obs/US-MA/recent/osprey`);
  url.searchParams.set("back", "1");
  url.searchParams.set("maxResults", "1");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      headers: {
        "x-ebirdapitoken": apiKey,
        accept: "application/json"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`eBird returned ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRegionSightings(regionCode, speciesCode, back, includeProvisional, hotspot, apiKey) {
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
        "x-ebirdapitoken": apiKey,
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

async function getTaxonomy(apiKey) {
  const now = Date.now();
  if (taxonomyCache && now - taxonomyCache.createdAt < TAXONOMY_TTL_MS) {
    return taxonomyCache.items;
  }

  const url = new URL(`${EBIRD_BASE_URL}/ref/taxonomy/ebird`);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("locale", "en");

  const response = await fetch(url, {
    headers: {
      ...(apiKey ? { "x-ebirdapitoken": apiKey } : {}),
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

async function resolveSpecies(input, apiKey) {
  const local = speciesAliases.get(normalizeSpeciesKey(input));
  if (local) {
    return local;
  }

  if (apiKey && input.length > 2) {
    try {
      const matches = searchSpecies(input, await getTaxonomy(apiKey));
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
  const selectedStates = northeastStates.filter((state) => regions.includes(state.code));
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
  let closest = northeastStates[0];
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const state of northeastStates) {
    const distance = Math.abs(Number(lat) - state.center[0]) + Math.abs(Number(lng) - state.center[1]);
    if (distance < closestDistance) {
      closest = state;
      closestDistance = distance;
    }
  }
  return closest.code;
}
