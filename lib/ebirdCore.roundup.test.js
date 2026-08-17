import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getInsights, getWeeklyRoundup } from "./ebirdCore.js";
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
