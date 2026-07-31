import { afterEach, describe, expect, it, vi } from "vitest";
import { getInsights, getSightings } from "./ebirdCore.js";
import { US_STATES, getCensusRegion } from "../shared/usGeography.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function observation(regionCode) {
  return {
    speciesCode: "osprey",
    comName: "Osprey",
    sciName: "Pandion haliaetus",
    locId: `L-${regionCode}`,
    locName: `${regionCode} test location`,
    obsDt: "2026-07-28 08:30",
    howMany: 2,
    lat: regionCode === "US-CT" ? 41.6 : 42.4,
    lng: regionCode === "US-CT" ? -72.7 : -71.4,
    obsValid: true,
    obsReviewed: true,
    locationPrivate: false,
    subId: `S-${regionCode}`
  };
}

describe("getSightings regional resilience", () => {
  it("returns successful states and identifies failed states", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/US-MA/")) {
        return new Response("temporary upstream failure", { status: 503 });
      }
      return new Response(JSON.stringify([observation("US-CT")]), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    const payload = await getSightings({
      species: "osprey",
      regions: "US-CT,US-MA",
      back: "7",
      fresh: "true"
    }, "test-key");

    expect(payload.featureCollection.features).toHaveLength(1);
    expect(payload.coverage).toEqual({
      requestedRegions: ["US-CT", "US-MA"],
      successfulRegions: ["US-CT"],
      failedRegions: ["US-MA"]
    });
  });

  it("fails only when every selected state is unavailable", async () => {
    globalThis.fetch = vi.fn(async () => new Response("unavailable", { status: 503 }));

    await expect(getSightings({
      species: "osprey",
      regions: "US-CT,US-MA",
      fresh: "true"
    }, "test-key")).rejects.toMatchObject({
      statusCode: 502,
      failedRegions: ["US-CT", "US-MA"]
    });
  });
});

describe("nationwide feature scoping", () => {
  it("uses one country request for the Nationwide view", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toContain("/data/obs/US/recent/osprey");
      expect(url.searchParams.get("detail")).toBe("full");
      return new Response(JSON.stringify([
        { ...observation("US-CA"), subnational1Code: "US-CA" }
      ]), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    const nationwide = US_STATES.map((state) => state.code);
    const payload = await getSightings({
      species: "osprey",
      regions: nationwide.join(","),
      back: "7",
      fresh: "true"
    }, "test-key");

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(payload.coverage).toEqual({
      requestedRegions: nationwide,
      successfulRegions: nationwide,
      failedRegions: []
    });
    expect(payload.featureCollection.features[0].properties.regionCode).toBe("US-CA");
  });

  it("builds demo sightings inside selected western states", async () => {
    const payload = await getSightings({
      species: "calcon",
      regions: "US-CA,US-HI",
      back: "2",
      fresh: "true"
    }, "");

    expect(payload.regions).toEqual(["US-CA", "US-HI"]);
    expect(payload.featureCollection.features.length).toBeGreaterThan(0);
    expect(new Set(payload.featureCollection.features.map(
      (feature) => feature.properties.regionCode
    ))).toEqual(new Set(["US-CA", "US-HI"]));
    expect(payload.coverage.failedRegions).toEqual([]);
  });

  it("scopes Insights to the requested Census region", async () => {
    const west = getCensusRegion("west").stateCodes;
    const payload = await getInsights({ regions: west.join(","), back: "7" }, "");

    expect(payload.regions).toEqual(west);
    expect(payload.scopeLabel).toBe("the West");
    expect(payload.coverage).toEqual({
      requestedRegions: west,
      successfulRegions: west,
      failedRegions: []
    });
  });

  it("labels all-state Insights as Nationwide", async () => {
    const nationwide = US_STATES.map((state) => state.code);
    const payload = await getInsights({ regions: nationwide.join(","), back: "7" }, "");

    expect(payload.regions).toEqual(nationwide);
    expect(payload.scopeLabel).toBe("Nationwide");
  });
});
