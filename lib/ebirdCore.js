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
  // fresh=1 forces a live re-pull, bypassing the 5-minute cache read.
  const fresh = parseBoolean(query.fresh, false);
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
  if (!fresh) {
    const cached = getCache(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }
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

/* ============================================================================
   Chat assistant — an agentic loop that answers bird-activity questions by
   calling live eBird tools (claude-opus-4-8). The model phrases the answer;
   the tools supply the facts, so sightings, counts, and places are never made
   up. Degrades to a friendly notice when no Anthropic key is present.
   ========================================================================== */
const CHAT_MODEL = "claude-opus-4-8";
const CHAT_MAX_TURNS = 6; // tool round-trips per user message before we answer
const CHAT_MAX_TOKENS = 1400;
const CHAT_NEARBY_ANCHOR = { lat: 41.31, lng: -72.92, label: "New Haven, Connecticut" };

const CHAT_TOOLS = [
  {
    name: "search_species",
    description:
      "Resolve a bird name (or partial name, or eBird code) to its exact eBird species code. Call this FIRST whenever the user names a bird, before looking up its sightings.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "A bird name or code, e.g. 'scarlet tanager', 'osprey', or 'rethaw'." }
      },
      required: ["query"]
    }
  },
  {
    name: "species_sightings",
    description:
      "Recent eBird reports of ONE species across the focus states. Returns the top locations (with counts and dates), a per-state breakdown, and the total number of reporting locations. Call search_species first to get the code.",
    input_schema: {
      type: "object",
      properties: {
        speciesCode: { type: "string", description: "Exact eBird species code from search_species." },
        regions: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of state codes (e.g. ['US-CT','US-MA']). Omit to use the user's focus states."
        },
        back: { type: "integer", description: "How many days back to look, 1-30. Default 14." }
      },
      required: ["speciesCode"]
    }
  },
  {
    name: "notable_sightings",
    description:
      "Recent rare or locally notable birds across the focus states (eBird's reviewed 'notable' feed). Use for 'what's rare', 'anything unusual', or 'good birds lately'.",
    input_schema: {
      type: "object",
      properties: {
        regions: { type: "array", items: { type: "string" }, description: "Optional state codes. Omit to use the focus states." },
        back: { type: "integer", description: "How many days back to look, 1-30. Default 14." }
      }
    }
  },
  {
    name: "nearby_sightings",
    description:
      "Recent sightings of any species near a latitude/longitude. Use for 'near me' or a named town, park, or hotspot. For a named place, supply coordinates from your own knowledge of Northeast birding spots.",
    input_schema: {
      type: "object",
      properties: {
        lat: { type: "number", description: "Latitude." },
        lng: { type: "number", description: "Longitude." },
        back: { type: "integer", description: "How many days back to look, 1-30. Default 7." },
        dist: { type: "integer", description: "Search radius in km, 1-50. Default 25." }
      },
      required: ["lat", "lng"]
    }
  },
  {
    name: "region_activity",
    description:
      "A snapshot of what's being reported lately across the focus states (recent observations, one entry per species). Use for broad 'what's around' or 'what should I look for' questions.",
    input_schema: {
      type: "object",
      properties: {
        regions: { type: "array", items: { type: "string" }, description: "Optional state codes. Omit to use the focus states." },
        back: { type: "integer", description: "How many days back to look, 1-30. Default 7." }
      }
    }
  },
  {
    name: "show_on_map",
    description:
      "Load a species onto the user's map, optionally zooming to a specific spot. Call this whenever the user wants to SEE a bird, asks where to find it, or says 'show me' / 'put it on the map'. If you have a good recent location for it (from a sightings tool), pass that lat/lng so the map zooms there; otherwise pass just the species code and the map shows all recent sightings.",
    input_schema: {
      type: "object",
      properties: {
        speciesCode: { type: "string", description: "Exact eBird species code (from search_species or a sightings tool)." },
        lat: { type: "number", description: "Optional latitude of a spot to zoom to, e.g. a hotspot where it was just reported." },
        lng: { type: "number", description: "Optional longitude of the spot to zoom to." },
        locName: { type: "string", description: "Optional name of the spot you're zooming to." }
      },
      required: ["speciesCode"]
    }
  }
];

export async function chatWithBirds(body, apiKey = getApiKey()) {
  const messages = sanitizeChatMessages(body?.messages);
  if (!messages.length) {
    const error = new Error("Ask a question to start.");
    error.statusCode = 400;
    throw error;
  }

  const focusRegions = normalizeChatRegions(body?.regions);
  const hasLlm = Boolean(process.env.ANTHROPIC_API_KEY);

  if (!hasLlm) {
    return {
      reply:
        "The Flockline assistant needs an Anthropic API key to answer questions. You can still browse species and open Insights without it.",
      speciesRefs: [],
      toolsUsed: [],
      generator: "template",
      source: apiKey ? "ebird" : "demo"
    };
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // speciesSeen maps every code surfaced by a tool to its common name, so we can
  // offer accurate "view on map" chips for any species named in the final reply.
  const speciesSeen = new Map();
  const toolsUsed = new Set();
  // The show_on_map tool writes here; we send the last action to the client.
  const mapActionBox = { action: null };
  // species_sightings records its focal species + best spot here, so we can
  // drive the map even if the model forgets to call show_on_map.
  const focusBox = { species: null, spot: null };
  const lastUserText = [...messages].reverse().find((message) => message.role === "user")?.content || "";
  const conversation = messages.map((message) => ({ role: message.role, content: message.content }));
  const system = buildChatSystemPrompt(focusRegions);

  let finalText = "";
  try {
    for (let turn = 0; turn < CHAT_MAX_TURNS; turn += 1) {
      const response = await client.messages.create({
        model: CHAT_MODEL,
        max_tokens: CHAT_MAX_TOKENS,
        system,
        tools: CHAT_TOOLS,
        messages: conversation
      });

      if (response.stop_reason === "refusal") {
        finalText = "I can’t help with that one. Try asking about recent bird sightings or activity in the Northeast.";
        break;
      }

      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      if (text) {
        finalText = text;
      }

      if (response.stop_reason !== "tool_use") {
        break;
      }

      // Replay the assistant turn (tool_use blocks included) verbatim, then
      // answer each tool call with a tool_result in the next user turn.
      conversation.push({ role: "assistant", content: response.content });
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") {
          continue;
        }
        toolsUsed.add(block.name);
        const result = await runChatTool(block.name, block.input, focusRegions, apiKey, speciesSeen, mapActionBox, focusBox);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result).slice(0, 12000)
        });
      }
      conversation.push({ role: "user", content: toolResults });
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "chat_failed", message: error?.message }));
    const wrapped = new Error("The assistant ran into a problem reaching eBird. Please try again.");
    wrapped.statusCode = 502;
    throw wrapped;
  }

  if (!finalText) {
    finalText = "I wasn’t able to put that together. Try rephrasing, or ask about a specific bird or area.";
  }

  // Reliability net: if the user clearly asked to see or find a bird and the
  // model looked it up but forgot to call show_on_map, drive the map anyway.
  if (!mapActionBox.action && focusBox.species && wantsMapIntent(lastUserText)) {
    mapActionBox.action = {
      speciesCode: focusBox.species.speciesCode,
      comName: focusBox.species.comName,
      lat: focusBox.spot?.lat ?? null,
      lng: focusBox.spot?.lng ?? null,
      locName: focusBox.spot?.locName ?? null
    };
  }

  return {
    reply: finalText,
    speciesRefs: pickSpeciesRefs(finalText, speciesSeen),
    mapAction: mapActionBox.action,
    toolsUsed: [...toolsUsed],
    generator: "llm",
    source: apiKey ? "ebird" : "demo"
  };
}

async function runChatTool(name, input, focusRegions, apiKey, speciesSeen, mapActionBox, focusBox) {
  if (!apiKey && name !== "show_on_map") {
    return { error: "No live eBird key is configured, so live sightings are unavailable. Say so plainly." };
  }
  try {
    switch (name) {
      case "search_species":
        return await toolSearchSpecies(input, apiKey, speciesSeen);
      case "species_sightings":
        return await toolSpeciesSightings(input, focusRegions, apiKey, speciesSeen, focusBox);
      case "notable_sightings":
        return await toolNotableSightings(input, focusRegions, apiKey, speciesSeen);
      case "nearby_sightings":
        return await toolNearbySightings(input, apiKey, speciesSeen);
      case "region_activity":
        return await toolRegionActivity(input, focusRegions, apiKey, speciesSeen);
      case "show_on_map":
        return await toolShowOnMap(input, apiKey, speciesSeen, mapActionBox);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    return { error: error?.message || "The tool call failed." };
  }
}

async function toolShowOnMap(input, apiKey, speciesSeen, mapActionBox) {
  const speciesCode = String(input?.speciesCode || "").trim().toLowerCase();
  if (!speciesCode) {
    return { error: "Provide a speciesCode to show on the map." };
  }

  let comName = speciesSeen.get(speciesCode);
  if (!comName && apiKey) {
    try {
      const taxonomy = await getTaxonomy(apiKey);
      comName = taxonomy.find((item) => item.speciesCode === speciesCode)?.comName;
    } catch {
      // Fall back to the code if the taxonomy lookup fails.
    }
  }
  comName = comName || speciesCode;

  const lat = Number(input?.lat);
  const lng = Number(input?.lng);
  const hasFocus = Number.isFinite(lat) && Number.isFinite(lng);
  const locName = input?.locName ? String(input.locName).slice(0, 120) : null;

  mapActionBox.action = {
    speciesCode,
    comName,
    lat: hasFocus ? lat : null,
    lng: hasFocus ? lng : null,
    locName
  };
  speciesSeen.set(speciesCode, comName);

  return {
    ok: true,
    shown: comName,
    centeredOn: hasFocus ? locName || `${lat.toFixed(3)}, ${lng.toFixed(3)}` : "all recent sightings"
  };
}

async function toolSearchSpecies(input, apiKey, speciesSeen) {
  const query = String(input?.query || "").trim();
  if (!query) {
    return { matches: [] };
  }
  let matches = searchSpecies(query, speciesPresets).slice(0, 8);
  try {
    const taxonomy = await getTaxonomy(apiKey);
    matches = mergeSpecies(matches, searchSpecies(query, taxonomy)).slice(0, 8);
  } catch {
    // Local catalog matches are enough to keep going.
  }
  for (const match of matches) {
    speciesSeen.set(match.speciesCode, match.comName);
  }
  return {
    matches: matches.map((match) => ({ speciesCode: match.speciesCode, comName: match.comName, sciName: match.sciName }))
  };
}

async function toolSpeciesSightings(input, focusRegions, apiKey, speciesSeen, focusBox) {
  const speciesCode = String(input?.speciesCode || "").trim().toLowerCase();
  if (!speciesCode) {
    return { error: "Provide a speciesCode. Call search_species first." };
  }
  const regions = pickChatRegions(input?.regions, focusRegions);
  const back = clampInteger(input?.back, 1, 30, 14);
  const settled = await Promise.allSettled(
    regions.map((region) => fetchRegionSightings(region, speciesCode, back, true, false, apiKey))
  );
  const rows = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  if (!rows.length) {
    return { speciesCode, back, totalLocations: 0, note: "No eBird reports in this window for these states." };
  }

  const comName = rows[0].comName || speciesCode;
  speciesSeen.set(speciesCode, comName);
  const byState = {};
  for (const row of rows) {
    const abbr = stateAbbr(row.regionCode);
    byState[abbr] = (byState[abbr] || 0) + 1;
  }
  const topLocations = [...rows]
    .sort(
      (a, b) =>
        String(b.obsDt).localeCompare(String(a.obsDt)) || (Number(b.howMany) || 0) - (Number(a.howMany) || 0)
    )
    .slice(0, 12)
    .map((row) => ({
      locName: row.locName,
      state: stateAbbr(row.regionCode),
      howMany: row.howMany ?? null,
      obsDt: row.obsDt,
      lat: roundCoord(row.lat),
      lng: roundCoord(row.lng)
    }));

  // Remember this as the focal species (and its freshest located spot) so the
  // map can be driven to it even if the model forgets to call show_on_map.
  if (focusBox) {
    focusBox.species = { speciesCode, comName };
    const spot = topLocations.find((location) => location.lat != null && location.lng != null);
    focusBox.spot = spot ? { lat: spot.lat, lng: spot.lng, locName: spot.locName } : null;
  }

  return { speciesCode, comName, back, totalLocations: rows.length, byState, topLocations };
}

async function toolNotableSightings(input, focusRegions, apiKey, speciesSeen) {
  const regions = pickChatRegions(input?.regions, focusRegions);
  const back = clampInteger(input?.back, 1, 30, 14);
  const settled = await Promise.allSettled(regions.map((region) => fetchNotable(region, back, apiKey)));
  const rows = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  const bySpecies = new Map();
  for (const row of rows) {
    if (!row.speciesCode) {
      continue;
    }
    speciesSeen.set(row.speciesCode, row.comName);
    const current = bySpecies.get(row.speciesCode);
    if (!current || String(row.obsDt) > String(current.obsDt)) {
      bySpecies.set(row.speciesCode, row);
    }
  }

  const notable = [...bySpecies.values()]
    .sort((a, b) => String(b.obsDt).localeCompare(String(a.obsDt)))
    .slice(0, 25)
    .map((row) => ({
      comName: row.comName,
      speciesCode: row.speciesCode,
      locName: row.locName,
      state: stateAbbr(row.regionCode),
      howMany: row.howMany ?? null,
      obsDt: row.obsDt,
      lat: roundCoord(row.lat),
      lng: roundCoord(row.lng)
    }));

  return { back, count: notable.length, notable };
}

async function toolNearbySightings(input, apiKey, speciesSeen) {
  const lat = Number(input?.lat);
  const lng = Number(input?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { error: "Provide numeric lat and lng." };
  }
  const back = clampInteger(input?.back, 1, 30, 7);
  const dist = clampInteger(input?.dist, 1, 50, 25);
  const rows = await fetchNearbyObs(lat, lng, back, dist, apiKey);
  for (const row of rows) {
    if (row.speciesCode) {
      speciesSeen.set(row.speciesCode, row.comName);
    }
  }
  const sightings = rows.slice(0, 30).map((row) => ({
    comName: row.comName,
    speciesCode: row.speciesCode,
    locName: row.locName,
    howMany: row.howMany ?? null,
    obsDt: row.obsDt,
    lat: roundCoord(row.lat),
    lng: roundCoord(row.lng)
  }));
  return { lat, lng, back, dist, count: sightings.length, sightings };
}

async function toolRegionActivity(input, focusRegions, apiKey, speciesSeen) {
  const regions = pickChatRegions(input?.regions, focusRegions);
  const back = clampInteger(input?.back, 1, 30, 7);
  const settled = await Promise.allSettled(regions.map((region) => fetchRegionRecent(region, back, apiKey)));
  const rows = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  const bySpecies = new Map();
  for (const row of rows) {
    if (!row.speciesCode) {
      continue;
    }
    speciesSeen.set(row.speciesCode, row.comName);
    const current = bySpecies.get(row.speciesCode);
    if (!current || String(row.obsDt) > String(current.obsDt)) {
      bySpecies.set(row.speciesCode, row);
    }
  }

  const recent = [...bySpecies.values()]
    .sort((a, b) => String(b.obsDt).localeCompare(String(a.obsDt)))
    .slice(0, 40)
    .map((row) => ({
      comName: row.comName,
      speciesCode: row.speciesCode,
      locName: row.locName,
      state: stateAbbr(row.regionCode),
      obsDt: row.obsDt
    }));

  return { back, speciesCount: bySpecies.size, recent };
}

async function fetchNearbyObs(lat, lng, back, dist, apiKey) {
  const url = new URL(`${EBIRD_BASE_URL}/data/obs/geo/recent`);
  url.searchParams.set("lat", lat.toFixed(4));
  url.searchParams.set("lng", lng.toFixed(4));
  url.searchParams.set("back", String(back));
  url.searchParams.set("dist", String(dist));
  url.searchParams.set("maxResults", "200");
  url.searchParams.set("sppLocale", "en");
  return ebirdJson(url, apiKey);
}

async function fetchRegionRecent(regionCode, back, apiKey) {
  const url = new URL(`${EBIRD_BASE_URL}/data/obs/${regionCode}/recent`);
  url.searchParams.set("back", String(back));
  url.searchParams.set("maxResults", "300");
  url.searchParams.set("sppLocale", "en");
  const rows = await ebirdJson(url, apiKey);
  return rows.map((row) => ({ ...row, regionCode }));
}

async function ebirdJson(url, apiKey, timeoutMs = 14000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "x-ebirdapitoken": apiKey, accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`eBird returned ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function buildChatSystemPrompt(focusRegions) {
  const focusNames = focusRegions.map((code) => regionLabel(code)).join(", ");
  const today = new Date().toISOString().slice(0, 10);
  const codeList = northeastStates.map((state) => `${state.code} ${state.name}`).join(", ");
  return `You are the Flockline field assistant, a warm, knowledgeable birding guide. You help people understand recent bird activity across the US Northeast using LIVE eBird data.

Today is ${today}. The user's current focus area is: ${focusNames}. When they say "here", "near me", or "the area" without naming a place, assume this focus area. For a "near me" coordinate lookup with no named place, use ${CHAT_NEARBY_ANCHOR.label} (lat ${CHAT_NEARBY_ANCHOR.lat}, lng ${CHAT_NEARBY_ANCHOR.lng}).

State codes you can pass to tools: ${codeList}.

How to answer:
- For anything about real sightings, counts, locations, or what is around, CALL TOOLS to get live eBird data. Never invent sightings, counts, dates, or places. If a tool returns nothing, say so plainly.
- When the user names a bird, call search_species first to get the exact code, then species_sightings.
- For a named town, park, or hotspot, use coordinates from your own knowledge with nearby_sightings.
- You can call several tools and combine the results. Prefer the focus states unless the user names a specific state.
- General birding knowledge (habits, identification tips, seasonality) you can answer directly, but ground anything about current activity in tool data.
- DRIVE THE MAP: when the user wants to SEE a bird, asks where to find it, or says "show me", "zoom", or "put it on the map", call show_on_map with the species code. If a sightings tool gave you a good recent location, pass its lat/lng (and locName) so the map zooms right to that spot. Do not call show_on_map for purely factual questions where they did not ask to see anything.
- THE MAP MOVES ONLY THROUGH show_on_map. Never tell the user you have shown, loaded, zoomed, or centered anything unless you actually call show_on_map in that same turn. If you say you are zooming to a spot, you MUST pass that spot's lat/lng to show_on_map.

Style: friendly and concise. Lead with the answer. Use short paragraphs or tight bullet points (start bullets with "- "). Name specific places and dates from the data. Be honest about the data: eBird shows one record per location and common birds are under-reported, so describe figures as "reports" or "locations", not totals. Never use em dashes; use periods, commas, or parentheses. Do not output markdown tables or headings.`;
}

function sanitizeChatMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages
    .filter((message) => message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
    .map((message) => ({ role: message.role, content: message.content.trim().slice(0, 2000) }))
    .filter((message) => message.content)
    .slice(-12);
}

function normalizeChatRegions(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  const codes = list
    .map((code) => String(code).trim().toUpperCase())
    .filter((code) => northeastStates.some((state) => state.code === code));
  return codes.length ? codes : NEW_ENGLAND;
}

function pickChatRegions(requested, focusRegions) {
  if (Array.isArray(requested) && requested.length) {
    const codes = requested
      .map((code) => String(code).trim().toUpperCase())
      .filter((code) => northeastStates.some((state) => state.code === code));
    if (codes.length) {
      return codes.slice(0, 9);
    }
  }
  return focusRegions;
}

function stateAbbr(code) {
  return northeastStates.find((state) => state.code === code)?.abbr || code || "";
}

function roundCoord(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10000) / 10000 : null;
}

// Did the user clearly want to see/find a bird on the map (vs. ask a fact)?
function wantsMapIntent(text) {
  return /\b(show|see|find|finding|where|spot|spots|hotspot|hotspots|zoom|map|closest|nearest|near me|take me|go to|pull up|look for)\b/i.test(
    String(text || "")
  );
}

// Offer a "view on map" chip only for species the assistant actually named in
// its reply, matched against the names the tools surfaced.
function pickSpeciesRefs(text, speciesSeen) {
  const lower = String(text || "").toLowerCase();
  const refs = [];
  const used = new Set();
  for (const [speciesCode, comName] of speciesSeen) {
    if (!comName || used.has(speciesCode)) {
      continue;
    }
    if (lower.includes(comName.toLowerCase())) {
      refs.push({ speciesCode, comName });
      used.add(speciesCode);
    }
    if (refs.length >= 6) {
      break;
    }
  }
  return refs;
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
