import { afterEach, describe, expect, it, vi } from "vitest";
import { getSightings } from "./ebirdCore.js";

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
