import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { US_STATES } from "../shared/usGeography.js";

const { createMessage } = vi.hoisted(() => ({ createMessage: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create: createMessage }; },
}));

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});
const row = {
  speciesCode: "ambduc", comName: "American Black Duck", locId: "L2987656",
  locName: "Main Street Park, Brooklyn", subId: "S402304279",
  obsDt: "2026-10-14 08:30", howMany: 3, lat: 40.704402, lng: -73.9897981,
  obsValid: true, obsReviewed: false,
};
const hotspot = (locId) => ({
  locId, isHotspot: true, subnational2Code: "US-NY-047", subnational2Name: "Kings",
});

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  createMessage.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function runTool(name, input, { regions = ["US-CA"], reply = row.comName, question = "What reports are available?" } = {}) {
  let evidence;
  createMessage.mockResolvedValueOnce({
    stop_reason: "tool_use", content: [{ type: "tool_use", id: "tool-1", name, input }],
  }).mockImplementationOnce(async (request) => {
    evidence = JSON.parse(request.messages.at(-1).content[0].content);
    return { stop_reason: "end_turn", content: [{ type: "text", text: reply }] };
  });
  const { chatWithBirds } = await import("./ebirdCore.js");
  const response = await chatWithBirds({ messages: [{ role: "user", content: question }], regions }, "test-ebird-key");
  return { evidence, response };
}

describe("Ask source geography", () => {
  it("uses exact Brooklyn hotspot county instead of the nearer New Jersey state center", async () => {
    const fetcher = vi.fn(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/geo/recent")) return json([row]);
      expect(url.pathname).toBe("/v2/ref/hotspot/info/L2987656");
      return json(hotspot(row.locId));
    });
    vi.stubGlobal("fetch", fetcher);

    const { evidence, response } = await runTool("nearby_sightings", { lat: 40.7033, lng: -74.017, dist: 3, back: 7 });
    expect(evidence).toMatchObject({
      lat: 40.7033, lng: -74.017, dist: 3, back: 7,
      sightings: [{ regionCode: "US-NY", subId: row.subId, howMany: 3, reviewStatus: "Accepted by eBird" }],
    });
    expect(response.speciesRefs).toEqual([{ speciesCode: "ambduc", comName: row.comName, regionCode: "US-NY" }]);
    expect(evidence.limited).toBeUndefined();
  });

  it.each(["missing", "private", "different-location"])("keeps %s location geography unknown and omits a misleading map chip", async (mode) => {
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      if (String(input).includes("/geo/recent")) return json([row]);
      if (mode === "missing") return json({}, 404);
      return json({ ...hotspot(row.locId), ...(mode === "private" ? { isHotspot: false } : { locId: "L999" }) });
    }));
    const { evidence, response } = await runTool("nearby_sightings", { lat: row.lat, lng: row.lng });
    expect(evidence.sightings[0].regionCode).toBeNull();
    expect(evidence.locationNote).toContain("do not guess a state");
    expect(response.speciesRefs).toEqual([]);
    expect(response.mapAction).toBeNull();
  });

  it("bounds exact-location lookups to six in flight and the observations actually shown", async () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({ ...row, speciesCode: `bird${index}`, comName: `Bird ${index}`, locId: `L${1000 + index}`, subId: `S${400000000 + index}` }));
    let active = 0;
    let peak = 0;
    const lookedUp = [];
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/geo/recent")) {
        expect(url.searchParams.get("maxResults")).toBe("200");
        return json(rows);
      }
      const locId = url.pathname.split("/").at(-1);
      lookedUp.push(locId);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return json(hotspot(locId));
    }));
    const { evidence } = await runTool("nearby_sightings", { lat: row.lat, lng: row.lng, dist: 50, back: 30 }, { reply: "Bird 0" });
    expect(peak).toBe(6);
    expect(lookedUp).toHaveLength(30);
    expect(new Set(lookedUp).size).toBe(30);
    expect(evidence).toMatchObject({ speciesCount: 200, shown: 30, dist: 50, back: 30 });
    expect(evidence.limited).toContain("may be incomplete");
  });

  it("reuses one authoritative lookup for species on the same hotspot", async () => {
    const fetcher = vi.fn(async (input) => String(input).includes("/geo/recent")
      ? json([row, { ...row, speciesCode: "mallar3", comName: "Mallard" }])
      : json(hotspot(row.locId)));
    vi.stubGlobal("fetch", fetcher);
    const { evidence } = await runTool("nearby_sightings", { lat: row.lat, lng: row.lng });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(evidence.sightings.every((item) => item.regionCode === "US-NY")).toBe(true);
  });

  it.each([
    {}, { lat: null, lng: null }, { lat: "40.7", lng: -74 },
    { lat: 40.7, lng: "-74" }, { lat: 91, lng: -74 },
    { lat: -91, lng: -74 }, { lat: 40.7, lng: 181 }, { lat: 40.7, lng: -181 },
    { lat: Number.NaN, lng: -74 }, { lat: 40.7, lng: Infinity },
  ])("rejects invalid coordinates without contacting eBird: %j", async (input) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { evidence } = await runTool("nearby_sightings", input);
    expect(evidence.error).toContain("numeric latitude");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts numeric zero coordinates without treating them as missing", async () => {
    const fetcher = vi.fn(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("lat")).toBe("0.0000");
      expect(url.searchParams.get("lng")).toBe("0.0000");
      return json([]);
    });
    vi.stubGlobal("fetch", fetcher);
    expect((await runTool("nearby_sightings", { lat: 0, lng: 0 })).evidence).toMatchObject({ lat: 0, lng: 0, speciesCount: 0 });
  });
});

describe("Ask partial-feed evidence", () => {
  it("preserves the nationwide notable cap warning despite duplicate source rows", async () => {
    const regions = US_STATES.map((state) => state.code);
    vi.stubGlobal("fetch", vi.fn(async () => json(Array(10000).fill({ ...row, subnational1Code: "US-NY" }))));
    const { evidence } = await runTool("notable_sightings", { back: 3 }, { regions });
    expect(evidence).toMatchObject({ back: 3, regions, scopeLabel: "Nationwide", speciesCount: 1, shown: 1 });
    expect(evidence.limited).toContain("may be incomplete");
  });

  it("retains state failures and caps independently without silently broadening the requested scope", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input) => String(input).includes("/US-MA/")
      ? json({}, 503) : json(Array(10000).fill(row))));
    const { evidence } = await runTool("notable_sightings", { regions: ["US-NY", "US-MA"], back: 5 });
    expect(evidence).toMatchObject({ regions: ["US-NY", "US-MA"], scopeLabel: "New York and Massachusetts", back: 5, failedStates: ["MA"] });
    expect(evidence.limited).toContain("may be incomplete");
  });

  it("keeps an uncapped result free of a false truncation warning", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([row])));
    const { evidence } = await runTool("notable_sightings", { regions: ["US-NY"], back: 2 });
    expect(evidence).toMatchObject({ regions: ["US-NY"], scopeLabel: "New York", back: 2, speciesCount: 1 });
    expect(evidence.limited).toBeUndefined();
  });

  it.each([["species_sightings", 10000], ["region_activity", 300]])("passes cap and scope evidence for %s", async (name, limit) => {
    vi.stubGlobal("fetch", vi.fn(async () => json(Array(limit).fill(row))));
    const { evidence } = await runTool(name, { speciesCode: "ambduc", regions: ["US-NY"], back: 9 });
    expect(evidence).toMatchObject({ regions: ["US-NY"], scopeLabel: "New York", back: 9 });
    expect(evidence.limited).toContain("may be incomplete");
    expect(evidence.limited).not.toContain("is higher");
  });
});

describe("Ask nearby species lookup", () => {
  const sora = {
    ...row, speciesCode: "sora", comName: "Sora", locId: "L683555", locName: "Bryant Park",
    subId: "S402323216", obsDt: "2026-10-14 09:00", howMany: 1,
    lat: 40.7536729, lng: -73.9832322,
  };

  it("queries the documented species endpoint and retains date, review label, and checklist evidence", async () => {
    const fetcher = vi.fn(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/v2/ref/hotspot/info/")) return json(hotspot(sora.locId));
      expect(url.pathname).toBe("/v2/data/obs/geo/recent/sora");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        lat: "40.7537", lng: "-73.9832", back: "14", dist: "1", maxResults: "200", includeProvisional: "false", sppLocale: "en",
      });
      return json([sora]);
    });
    vi.stubGlobal("fetch", fetcher);
    const { evidence, response } = await runTool("nearby_sightings", {
      speciesCode: " SORA ", lat: sora.lat, lng: sora.lng, dist: 1, back: 14,
    }, {
      question: "Give one recent Sora report from Bryant Park in New York, including date, status and link. Don't move the map.",
      reply: `Sora, Bryant Park, ${sora.obsDt}. Accepted by eBird. https://ebird.org/checklist/${sora.subId}`,
    });
    expect(evidence).toMatchObject({ speciesCode: "sora", returnedRecords: 1, speciesCount: 1, shown: 1, sourceLimited: false, selectionLimited: false });
    expect(evidence.sightings[0]).toMatchObject({ speciesCode: "sora", locName: "Bryant Park", obsDt: sora.obsDt, subId: sora.subId, reviewStatus: "Accepted by eBird" });
    expect(evidence.limited).toBeUndefined();
    expect(response.checklistSources[0]).toMatchObject({ speciesCode: "sora", subId: sora.subId, obsDt: sora.obsDt });
    expect(response.mapAction).toBeNull();
    const request = createMessage.mock.calls[0][0];
    expect(request.tools.find(tool => tool.name === "nearby_sightings").input_schema.properties.speciesCode.type).toBe("string");
    expect(request.system).toContain("perform the targeted lookup now instead of asking the user whether to search");
  });

  it.each([null, "", " ", 123, {}, "sora/../notable", "sora?dist=50", "notable"])("rejects a malformed or reserved species code without a request: %j", async (speciesCode) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { evidence } = await runTool("nearby_sightings", { speciesCode, lat: sora.lat, lng: sora.lng });
    expect(evidence.error).toContain("speciesCode from search_species");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("distinguishes the visible 30-record excerpt from the 111-species feed and can then find the omitted Sora", async () => {
    const broadRows = [...Array.from({ length: 110 }, (_, index) => ({ ...row, speciesCode: `bird${index}`, comName: `Bird ${index}` })), sora];
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/data/obs/geo/recent") return json(broadRows);
      if (url.pathname === "/v2/data/obs/geo/recent/sora") return json([sora]);
      return json(hotspot(url.pathname.split("/").at(-1)));
    }));
    const broad = (await runTool("nearby_sightings", { lat: sora.lat, lng: sora.lng })).evidence;
    expect(broad).toMatchObject({ speciesCode: null, returnedRecords: 111, speciesCount: 111, shown: 30, selectionLimited: true, sourceLimited: false });
    expect(broad.sightings.some(item => item.speciesCode === "sora")).toBe(false);
    expect(broad.limited).toContain("Only 30 of 111 returned records are shown");
    expect(broad.scopeNote).toContain("search again with speciesCode before concluding");
    const targeted = (await runTool("nearby_sightings", { speciesCode: "sora", lat: sora.lat, lng: sora.lng })).evidence;
    expect(targeted.sightings[0]).toMatchObject({ speciesCode: "sora", subId: sora.subId });
  });

  it("preserves both the upstream result cap and visible selection cap for a species search", async () => {
    vi.stubGlobal("fetch", vi.fn(async input => String(input).includes("/geo/recent/sora")
      ? json(Array.from({ length: 200 }, (_, index) => ({ ...sora, subId: `S${402323000 + index}` })))
      : json(hotspot(sora.locId))));
    const { evidence } = await runTool("nearby_sightings", { speciesCode: "sora", lat: sora.lat, lng: sora.lng });
    expect(evidence).toMatchObject({ returnedRecords: 200, speciesCount: 1, shown: 30, sourceLimited: true, selectionLimited: true });
    expect(evidence.limited).toContain("Only 30 of 200");
    expect(evidence.limited).toContain("may be incomplete");
  });

  it("describes an empty species result without asserting absence", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([])));
    const { evidence } = await runTool("nearby_sightings", { speciesCode: "sora", lat: sora.lat, lng: sora.lng });
    expect(evidence).toMatchObject({ speciesCode: "sora", returnedRecords: 0, speciesCount: 0, shown: 0, sightings: [] });
    expect(evidence.scopeNote).toContain("cannot establish a bird's absence");
  });
});

describe("Ask source presentation evidence", () => {
  it.each(["species_sightings", "notable_sightings", "region_activity"])("returns source-backed citations and plain review labels for %s", async (name) => {
    vi.stubGlobal("fetch", vi.fn(async () => json([{ ...row, obsValid: false, obsReviewed: false }])));
    const { evidence, response } = await runTool(name, { speciesCode: row.speciesCode, regions: ["US-NY"] }, {
      reply: `See https://ebird.org/checklist/${row.subId}, plus an invented S999999999.`,
    });
    expect(JSON.stringify(evidence)).not.toMatch(/obsValid|obsReviewed/);
    expect(JSON.stringify(evidence)).toContain("Not reviewed by eBird");
    expect(response.checklistSources).toEqual([{
      subId: row.subId, speciesCode: row.speciesCode, comName: row.comName,
      locName: row.locName, obsDt: row.obsDt, reviewStatus: "Not reviewed by eBird",
    }]);
    const systemPrompt = createMessage.mock.calls[0][0].system;
    expect(systemPrompt).toContain("does not promise that someone will review the report later");
    expect(systemPrompt).not.toMatch(/obsValid|obsReviewed/);
  });
});

describe("nationwide map source geography", () => {
  const examples = [
    { ...row, locId: "L683555", subId: "S402107527", locName: "Bryant Park", lat: 40.7536729, lng: -73.9832322 },
    { ...row, locId: "L367627", subId: "S402131770", locName: "Salton Sea--Young Rd.", lat: 33.1330196, lng: -115.6666589 },
    { ...row, locId: "L5640834", subId: "S401983759", locName: "Huntley Meadows", lat: 38.7555851, lng: -77.1024156 },
  ];

  it("keeps unlabelled country reports visible without assigning nearby states", async () => {
    const fetcher = vi.fn(async () => json(examples));
    vi.stubGlobal("fetch", fetcher);
    const { getSightings } = await import("./ebirdCore.js");
    const result = await getSightings({ species: "sora", regions: US_STATES.map((state) => state.code), fresh: true }, "test-key");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.featureCollection.features.map((feature) => feature.properties.regionCode)).toEqual([null, null, null]);
    expect(result.stats.unknownRegionCount).toBe(3);
    expect(Object.values(result.stats.regionCounts).reduce((sum, count) => sum + count, 0)).toBe(0);
    expect(result.stats.regionCounts).not.toHaveProperty("null");
  });

  it("uses explicit source state metadata when available and keeps territorial scope separate", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([
      { ...examples[0], subnational1Code: "US-NY" },
      { ...examples[1], subnational1Code: "US-CA" },
      { ...examples[2], subnational1Code: "US-VA" },
      { ...row, subnational1Code: "US-PR" },
    ])));
    const { getSightings } = await import("./ebirdCore.js");
    const result = await getSightings({ species: "sora", regions: US_STATES.map((state) => state.code), fresh: true }, "test-key");
    expect(result.featureCollection.features.map((feature) => feature.properties.regionCode)).toEqual(["US-NY", "US-CA", "US-VA"]);
    expect(result.stats.unknownRegionCount).toBe(0);
    expect(result.stats.regionCounts).toMatchObject({ "US-NY": 1, "US-CA": 1, "US-VA": 1 });
  });

  it("uses the requested state for state-scoped reports without hotspot fanout", async () => {
    const fetcher = vi.fn(async (input) => {
      expect(new URL(String(input)).pathname).toBe("/v2/data/obs/US-NY/recent/sora");
      return json([examples[0]]);
    });
    vi.stubGlobal("fetch", fetcher);
    const { getSightings } = await import("./ebirdCore.js");
    const result = await getSightings({ species: "sora", regions: ["US-NY"], fresh: true }, "test-key");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.featureCollection.features[0].properties.regionCode).toBe("US-NY");
    expect(result.stats).toMatchObject({ unknownRegionCount: 0, regionCounts: { "US-NY": 1 } });
  });

  it("does not turn missing country-feed state into an Ask map chip", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([examples[0]])));
    const { evidence, response } = await runTool("species_sightings", { speciesCode: "ambduc" }, { regions: US_STATES.map((state) => state.code) });
    expect(evidence.byState).toEqual({ "State not supplied": 1 });
    expect(evidence.topLocations[0].state).toBe("State not supplied");
    expect(response.speciesRefs).toEqual([]);
  });
});
