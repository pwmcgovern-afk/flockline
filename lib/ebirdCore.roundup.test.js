import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getChecklistDetails, getInsights, getWeeklyRoundup, getRecentSightingReporting } from "./ebirdCore.js";
import { US_STATES, getCensusRegion } from "../shared/usGeography.js";

const originalFetch = globalThis.fetch;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAnthropicKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  }
});

function notable(speciesCode, index, regionCode = "US-CT") {
  return {
    speciesCode,
    comName: `Test Bird ${index + 1}`,
    sciName: `Avis testus ${index + 1}`,
    locId: `L${index + 1}`,
    locName: `Verified marsh ${index + 1}`,
    obsDt: `2026-08-${String(17 - index).padStart(2, "0")} 08:30`,
    howMany: index + 1,
    lat: 41.5 + index / 100,
    lng: -72.7 - index / 100,
    obsValid: true,
    obsReviewed: true,
    locationPrivate: false,
    subId: `S38437${String(index).padStart(4, "0")}`,
    subnational1Code: regionCode
  };
}

function jsonResponse(rows) {
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("getWeeklyRoundup", () => {
  it("rejects an unknown regional preset before contacting eBird", async () => {
    globalThis.fetch = vi.fn();

    await expect(getWeeklyRoundup({ region: "new-england" }, "test-key"))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("uses a fixed seven-day window and returns six unique verified findings", async () => {
    const rows = Array.from({ length: 8 }, (_, index) => notable(`bird${index + 1}`, index));
    globalThis.fetch = vi.fn(async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toContain("/data/obs/US/recent/notable");
      expect(url.searchParams.get("back")).toBe("7");
      return jsonResponse(rows);
    });

    const payload = await getWeeklyRoundup({
      region: "nationwide",
      back: "30",
      fresh: "1"
    }, "test-key");

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(payload).toMatchObject({
      scopeId: "nationwide",
      scopeLabel: "Nationwide",
      back: 7,
      source: "ebird",
      generator: "template"
    });
    expect(payload.summary).toContain("past seven days");
    expect(payload.findings).toHaveLength(6);
    expect(new Set(payload.findings.map((finding) => finding.speciesCode)).size).toBe(6);
    expect(payload.findings.every((finding) => (
      finding.detail.match(/[.!?](?:\s|$)/g) || []
    ).length >= 2)).toBe(true);
    expect(payload.findings[0]).toMatchObject({
      sciName: expect.stringMatching(/^Avis testus/),
      locName: expect.stringMatching(/^Verified marsh/),
      region: "Connecticut",
      regionCode: "US-CT",
      subId: expect.stringMatching(/^S38437/),
      howMany: expect.any(Number),
      lat: expect.any(Number),
      lng: expect.any(Number)
    });
  });

  it("reports partial state coverage while retaining successful findings", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/US-MA/")) {
        return new Response("temporary failure", { status: 503 });
      }
      const match = url.match(/\/data\/obs\/(US-[A-Z]{2})\//);
      return jsonResponse([notable("regionalbird", 0, match?.[1] || "US-CT")]);
    });

    const payload = await getWeeklyRoundup({ region: "northeast", fresh: "1" }, "test-key");
    const northeast = getCensusRegion("northeast").stateCodes;

    expect(payload.coverage.requestedRegions).toEqual(northeast);
    expect(payload.coverage.failedRegions).toEqual(["US-MA"]);
    expect(payload.coverage.successfulRegions).not.toContain("US-MA");
    expect(payload.findings).toHaveLength(1);
  });

  it("reuses the one-hour result unless fresh generation is requested", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse([notable("cachebird", 0)]));

    await getWeeklyRoundup({ region: "nationwide", fresh: "1" }, "test-key");
    const cached = await getWeeklyRoundup({ region: "nationwide" }, "test-key");
    await getWeeklyRoundup({ region: "nationwide", fresh: "1" }, "test-key");

    expect(cached.cached).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("Insights after the shared notable-data refactor", () => {
  it("keeps the existing four-finding response", async () => {
    const rows = Array.from({ length: 8 }, (_, index) => notable(`insight${index + 1}`, index));
    globalThis.fetch = vi.fn(async () => jsonResponse(rows));
    const nationwide = US_STATES.map((state) => state.code);

    const payload = await getInsights({
      regions: nationwide.join(","),
      back: "7",
      fresh: "1",
      phrasing: "fast"
    }, "test-key");

    expect(payload.findings).toHaveLength(4);
  });
});

describe("source-backed reporting counts", () => {
  it("counts each checklist once, retains every source link, and preserves the requested window", async () => {
    const first = notable("parjae", 0, "US-NY");
    const second = { ...notable("parjae", 1, "US-NY"), howMany: undefined };
    globalThis.fetch = vi.fn(async (input) => {
      expect(new URL(String(input)).searchParams.get("maxResults")).toBe("10000");
      return jsonResponse([first, first, first, second, { ...first, subId: "invalid" }]);
    });
    const result = await getInsights({ regions: "US-NY", back: "3", fresh: "1", phrasing: "fast" }, "test-key");
    expect(result.findings[0].reporting).toEqual({
      timing: "published", scopeLabel: "New York", back: 3, asOf: result.generatedAt, partial: false,
      reports: [
        { subId: first.subId, observedAt: first.obsDt, locId: first.locId, locName: first.locName, count: "1" },
        { subId: second.subId, observedAt: second.obsDt, locId: second.locId, locName: second.locName, count: null },
      ],
    });
    expect(result.findings[0].detail).toContain("2 notable reports");
    expect(result.findings[0].detail).toContain("3-day eBird feed");
  });
  it("treats copies of one shared outing as one sighting when ranking and describing", async () => {
    // Eight birders on one boat file eight checklists with the same place and start time.
    const boat = Array.from({ length: 8 }, (_, index) => ({
      ...notable("parjae", 0, "US-MA"), locId: "L1", locName: "Pelagic trip", obsDt: "2026-08-16 07:00",
      howMany: 1, subId: `S3843700${String(index).padStart(2, "0")}`,
    }));
    globalThis.fetch = vi.fn(async () => jsonResponse(boat));
    const result = await getInsights({ regions: "US-MA", back: "7", fresh: "1", phrasing: "fast" }, "test-key");
    expect(result.findings[0].kind).toBe("rarity");
    expect(result.findings[0].detail).toContain("8 notable reports from 1 separate outing");
    expect(result.findings[0].reporting.reports).toHaveLength(8);
  });
  it("never attaches the regional maximum count to the featured location", async () => {
    const big = { ...notable("parjae", 1, "US-NY"), locName: "Big flock point", howMany: 9 };
    const latest = { ...notable("parjae", 0, "US-NY"), locName: "Latest beach", howMany: 1 };
    globalThis.fetch = vi.fn(async () => jsonResponse([big, latest]));
    const result = await getInsights({ regions: "US-NY", back: "7", fresh: "1", phrasing: "fast" }, "test-key");
    const { detail, locName, comName } = result.findings[0];
    expect(locName).toBe("Latest beach");
    expect(detail).not.toContain("(up to 9)");
    expect(detail).not.toMatch(/9\)? was reported at Latest beach/);
    expect(detail).toContain(`${comName} was reported at Latest beach`);
    expect(detail).toContain("up to 9 birds in a single report");
  });
  it("marks totals as partial if a region fails or an upstream result limit is reached", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      if (String(input).includes("US-NJ")) return new Response("unavailable", { status: 503 });
      return jsonResponse(Array(10000).fill(notable("parjae", 0, "US-NY")));
    });
    const result = await getInsights({ regions: "US-NY,US-NJ", back: "3", fresh: "1", phrasing: "fast" }, "test-key");
    expect(result.findings[0].reporting.partial).toBe(true);
    expect(result.findings[0].reporting.reports).toHaveLength(1);
    expect(result.coverage.limitedRegions).toEqual(["US-NY"]);
    expect(result.coverage.failedRegions).toEqual(["US-NJ"]);
  });
});

it("dates legacy reporting as current, uses the known Census region, and caches the source snapshot", async () => {
  const regions = getCensusRegion("northeast").stateCodes;
  globalThis.fetch = vi.fn(async () => jsonResponse([notable("parjae", 0, "US-NY")]));
  const result = await getRecentSightingReporting({ speciesCode: "parjae", regionCode: "US-NY" }, "test-key");
  expect(result).toMatchObject({ timing: "recent", scopeLabel: "Northeast", back: 7, partial: false });
  expect(result.reports).toHaveLength(1);
  expect(globalThis.fetch).toHaveBeenCalledTimes(regions.length);
  const absent = await getRecentSightingReporting({ speciesCode: "absent", scopeId: "northeast" }, "test-key");
  expect(absent.reports).toEqual([]);
  expect(absent.asOf).toBe(result.asOf);
  expect(globalThis.fetch).toHaveBeenCalledTimes(regions.length);
});

describe("checklist species matching", () => {
  const checklist = (obs) => ({ subId: "S123456789", obsDt: "2026-09-21 08:00", obs });
  it("finds a bird the birder logged as a subspecies group of the linked species", async () => {
    const urls = [];
    globalThis.fetch = vi.fn(async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname.includes("/product/checklist/view/")) {
        return jsonResponse(checklist([
          { speciesCode: "osprey", howManyStr: "1" },
          { speciesCode: "brnpel1", howManyStr: "4", mediaCounts: { P: 2 } },
        ]));
      }
      expect(url.searchParams.get("species")).toBe("brnpel1");
      return jsonResponse([{ speciesCode: "brnpel1", category: "issf", reportAs: "brnpel" }]);
    });
    const result = await getChecklistDetails({ subId: "S123456789", species: "brnpel" }, "test-key");
    expect(result.observation).toMatchObject({ speciesCode: "brnpel1", count: "4", media: { photos: 2 } });
    expect(urls).toHaveLength(2);
  });
  it("skips the taxonomy lookup on an exact match and still reports a truly absent bird", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(checklist([{ speciesCode: "osprey", howManyStr: "1" }])));
    const exact = await getChecklistDetails({ subId: "S123456788", species: "osprey" }, "test-key");
    expect(exact.observation.speciesCode).toBe("osprey");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const absent = await getChecklistDetails({ subId: "S123456787", species: "brnpel" }, "test-key");
    expect(absent.observation).toBeNull();
  });
});
