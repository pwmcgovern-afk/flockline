import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getChecklistDetails, getInsights, getWeeklyRoundup, getRecentSightingReporting } from "./ebirdCore.js";
import { US_STATES, getCensusRegion } from "../shared/usGeography.js";

const { createMessage } = vi.hoisted(() => ({ createMessage: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMessage };
  },
}));

const originalFetch = globalThis.fetch;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  createMessage.mockReset();
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

  it("uses a fixed seven-day window and returns six unique source-backed findings", async () => {
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
    expect(payload.summary).toContain("not a ranking of rarity");
    expect(payload.editorialPolicy).toBe("source-facts-v1");
    expect(payload.editorialNote).toBeUndefined();
    expect(payload.findings).toHaveLength(6);
    expect(new Set(payload.findings.map((finding) => finding.speciesCode)).size).toBe(6);
    expect(payload.findings.every((finding) => finding.kind === "notable")).toBe(true);
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

describe("evidence-only editorial selection", () => {
  it("never asks a configured model to select or explain Insights or the weekly roundup", async () => {
    process.env.ANTHROPIC_API_KEY = "configured-test-key";
    createMessage.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({
        summary: "Crossbills are moving because of a seed shortage.",
        findings: [{ speciesCode: "redcro", kind: "surge", title: "Seed-driven invasion", detail: "A seed shortage caused this irruption." }],
      }) }],
    });
    const row = { ...notable("redcro", 0, "US-NY"), comName: "Red Crossbill", locName: "Source pine grove", howMany: 3 };
    globalThis.fetch = vi.fn(async (input) => {
      expect(new URL(String(input)).hostname).toBe("api.ebird.org");
      return jsonResponse([row]);
    });

    const insights = await getInsights({ regions: "US-NY", back: "3", fresh: "1" }, "test-key");
    const roundup = await getWeeklyRoundup({ region: "nationwide", fresh: "1" }, "test-key");

    expect(createMessage).not.toHaveBeenCalled();
    for (const result of [insights, roundup]) {
      expect(result.generator).toBe("template");
      expect(result.findings[0]).toMatchObject({
        kind: "notable", generatedBy: "template", title: "Red Crossbill",
        locName: "Source pine grove", howMany: 3, subId: row.subId,
      });
      expect(result.findings[0].detail).toContain("Source pine grove");
      expect(JSON.stringify(result)).not.toMatch(/seed|irruption|invasion|migration|surge/i);
    }
  });

  it("does not promote older species because they have more reports, states, or birds", async () => {
    const fresh = Array.from({ length: 6 }, (_, index) => ({
      ...notable(`recent${index}`, index, "US-CT"), howMany: 1,
    }));
    const states = ["US-NY", "US-MA", "US-NJ", "US-VT", "US-ME", "US-NH"];
    const busy = Array.from({ length: 80 }, (_, index) => ({
      ...notable("busyolder", 7, states[index % states.length]),
      obsDt: "2026-08-09 08:30", howMany: 999,
      locId: `Lbusy${index}`, subId: `S80000${String(index).padStart(4, "0")}`,
    }));
    // Its latest report is in the same state as the recent species, so its
    // wider spread cannot create a new featured-state slot either.
    busy.push({ ...notable("busyolder", 7, "US-CT"), obsDt: "2026-08-10 08:30" });
    globalThis.fetch = vi.fn(async () => jsonResponse([...busy, ...fresh]));

    const result = await getWeeklyRoundup({ region: "nationwide", fresh: "1" }, "test-key");
    expect(result.findings.map((finding) => finding.speciesCode)).toEqual(fresh.map((row) => row.speciesCode));
  });

  it("samples distinct featured states before filling remaining slots and is stable across feed order", async () => {
    const rows = [
      notable("newct", 0, "US-CT"),
      notable("nextct", 1, "US-CT"),
      notable("thirdct", 2, "US-CT"),
      notable("fourthct", 3, "US-CT"),
      notable("olderma", 4, "US-MA"),
      notable("olderny", 5, "US-NY"),
    ];
    globalThis.fetch = vi.fn(async () => jsonResponse(rows));
    const query = { regions: US_STATES.map((state) => state.code).join(","), back: "7", fresh: "1" };
    const result = await getInsights(query, "test-key");
    globalThis.fetch = vi.fn(async () => jsonResponse([...rows].reverse()));
    const reversed = await getInsights(query, "test-key");

    expect(result.findings.map((finding) => finding.speciesCode)).toEqual(["newct", "nextct", "olderma", "olderny"]);
    expect(reversed.findings).toEqual(result.findings.map((finding) => ({
      ...finding, reporting: { ...finding.reporting, asOf: reversed.generatedAt },
    })));
  });

  it("preserves each source review status without treating the latest unreviewed report as confirmed", async () => {
    const accepted = notable("reviewbird", 1, "US-NY");
    const pending = { ...notable("reviewbird", 0, "US-NY"), obsValid: false, obsReviewed: false };
    const unknown = { ...notable("unknownbird", 2, "US-NY"), obsValid: undefined, obsReviewed: undefined, howMany: undefined };
    globalThis.fetch = vi.fn(async () => jsonResponse([accepted, pending, unknown]));

    const result = await getInsights({ regions: "US-NY", back: "7", fresh: "1" }, "test-key");
    expect(result.findings[0]).toMatchObject({ subId: pending.subId, obsValid: false, obsReviewed: false });
    expect(result.findings[0].reporting.reports).toMatchObject([
      { subId: pending.subId, obsValid: false, obsReviewed: false },
      { subId: accepted.subId, obsValid: true, obsReviewed: true },
    ]);
    expect(result.findings[1]).toMatchObject({ howMany: null, obsValid: null, obsReviewed: null });
    expect(result.findings[1].reporting.reports[0]).toMatchObject({ count: null, obsValid: null, obsReviewed: null });
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
        { subId: first.subId, observedAt: first.obsDt, locId: first.locId, locName: first.locName, count: "1", obsValid: true, obsReviewed: true },
        { subId: second.subId, observedAt: second.obsDt, locId: second.locId, locName: second.locName, count: null, obsValid: true, obsReviewed: true },
      ],
    });
    expect(result.findings[0].detail).toContain(first.locName);
    expect(result.findings[0].subId).toBe(first.subId);
  });
  it("retains shared checklist copies as evidence without calling them a surge or separate sightings", async () => {
    // Eight birders on one boat file eight checklists with the same place and start time.
    const boat = Array.from({ length: 8 }, (_, index) => ({
      ...notable("parjae", 0, "US-MA"), locId: "L1", locName: "Pelagic trip", obsDt: "2026-08-16 07:00",
      howMany: 1, subId: `S3843700${String(index).padStart(2, "0")}`,
    }));
    globalThis.fetch = vi.fn(async () => jsonResponse(boat));
    const result = await getInsights({ regions: "US-MA", back: "7", fresh: "1", phrasing: "fast" }, "test-key");
    expect(result.findings[0].kind).toBe("notable");
    expect(result.findings[0].detail).not.toMatch(/surge|8.*sightings|8.*outings/);
    expect(result.findings[0].reporting.reports).toHaveLength(8);
  });
  it("never attaches the regional maximum count to the featured location", async () => {
    const big = { ...notable("parjae", 1, "US-NY"), locName: "Big flock point", howMany: 9 };
    const latest = { ...notable("parjae", 0, "US-NY"), locName: "Latest beach", howMany: 1 };
    globalThis.fetch = vi.fn(async () => jsonResponse([big, latest]));
    const result = await getInsights({ regions: "US-NY", back: "7", fresh: "1", phrasing: "fast" }, "test-key");
    const { detail, locName, howMany } = result.findings[0];
    expect(locName).toBe("Latest beach");
    expect(detail).not.toContain("(up to 9)");
    expect(detail).not.toMatch(/9\)? was reported at Latest beach/);
    expect(detail).toContain("Latest beach");
    expect(howMany).toBe(1);
    expect(detail).not.toContain("9 birds");
    expect(result.findings[0].reporting.reports.find((report) => report.subId === big.subId)).toMatchObject({
      locName: "Big flock point", count: "9",
    });
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

describe("nationwide notable coverage", () => {
  const nationwide = US_STATES.map((state) => state.code);
  const country = (rows) => Array.from({ length: 10000 }, (_, index) => ({
    ...rows[index % rows.length], subId: `S9${String(index).padStart(8, "0")}`
  }));

  it("re-reads state by state when the single country request hits eBird's row limit", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (input) => {
      const region = new URL(String(input)).pathname.match(/\/data\/obs\/([^/]+)\//)[1];
      calls.push(region);
      if (region === "US") return jsonResponse(country([notable("truncbird", 0, "US-CA")]));
      // Each state answers with its own complete, unlimited feed.
      return jsonResponse(region === "US-NY" ? [notable("parjae", 0, "US-NY"), notable("parjae", 1, "US-NY")] : []);
    });
    const result = await getWeeklyRoundup({ region: "nationwide", fresh: "1" }, "test-key");
    expect(calls[0]).toBe("US");
    expect(calls.filter((region) => region !== "US").sort()).toEqual([...nationwide].sort());
    expect(result.coverage).toMatchObject({ failedRegions: [], limitedRegions: [] });
    expect(result.findings.map((finding) => finding.speciesCode)).toEqual(["parjae"]);
    expect(result.findings[0].reporting).toMatchObject({ partial: false });
    expect(result.findings[0].reporting.reports).toHaveLength(2);
  });

  it("keeps country rows only for states whose own request fails, and labels them partial", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const region = new URL(String(input)).pathname.match(/\/data\/obs\/([^/]+)\//)[1];
      if (region === "US") {
        return jsonResponse(country([notable("txbird", 0, "US-TX"), notable("nybird", 1, "US-NY")]));
      }
      if (region === "US-TX") return new Response("unavailable", { status: 503 });
      return jsonResponse(region === "US-NY" ? [notable("nybird", 1, "US-NY")] : []);
    });
    const result = await getInsights({ regions: nationwide.join(","), back: "7", fresh: "1", phrasing: "fast" }, "test-key");
    expect(result.coverage.failedRegions).toEqual([]);
    expect(result.coverage.limitedRegions).toEqual(["US-TX"]);
    const bySpecies = Object.fromEntries(result.findings.map((finding) => [finding.speciesCode, finding.reporting]));
    // New York comes only from its own request, not the 5,000 truncated country copies.
    expect(bySpecies.nybird.reports).toHaveLength(1);
    expect(bySpecies.txbird.reports.length).toBeGreaterThan(1);
    expect(bySpecies.txbird.partial).toBe(true);
  }, 15000);

  it("retries states eBird refused in the first burst and then counts them in full", async () => {
    const attempts = {};
    globalThis.fetch = vi.fn(async (input) => {
      const region = new URL(String(input)).pathname.match(/\/data\/obs\/([^/]+)\//)[1];
      attempts[region] = (attempts[region] || 0) + 1;
      if (region === "US") return jsonResponse(country([notable("wybird", 0, "US-WY")]));
      // Late states are refused on their first try, as in the live burst.
      if (region >= "US-MT" && attempts[region] === 1) return new Response("too many", { status: 429 });
      return jsonResponse(region === "US-WY" ? [notable("wybird", 0, "US-WY")] : []);
    });
    const result = await getWeeklyRoundup({ region: "nationwide", fresh: "1" }, "test-key");
    expect(result.coverage).toMatchObject({ failedRegions: [], limitedRegions: [] });
    expect(attempts["US-WY"]).toBe(2);
    expect(attempts["US-AL"]).toBe(1);
    expect(result.findings[0].reporting.reports).toHaveLength(1);
  }, 15000);

  it("does not re-read states when the country feed is complete", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse([notable("onebird", 0, "US-CA")]));
    await getWeeklyRoundup({ region: "nationwide", fresh: "1" }, "test-key");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
