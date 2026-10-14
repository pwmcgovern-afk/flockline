import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getInsights, getWeeklyRoundup } from "../lib/ebirdCore.js";
import insightsHandler from "../api/insights.js";
import roundupHandler from "../api/roundup.js";

vi.mock("../lib/sightingStore.js", () => ({ saveSightingFindings: vi.fn(async () => {}) }));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

const response = () => ({ setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() });
const json = (data) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });

beforeEach(() => vi.stubEnv("EBIRD_API_KEY", "test-key"));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("recovery after a state temporarily fails", () => {
  it.each([
    ["Insights", getInsights, { regions: "US-CT,US-MA", back: "22" }],
    ["weekly roundup", getWeeklyRoundup, { region: "northeast" }],
  ])("retries %s after a partial refresh, including when a complete result was previously cached", async (_, load, query) => {
    let unavailable = false;
    const fetcher = vi.fn(async (input) => {
      const state = String(input).match(/\/obs\/(US-[A-Z]{2})\//)?.[1];
      return unavailable && state === "US-MA" ? new Response("unavailable", { status: 503 }) : json([]);
    });
    vi.stubGlobal("fetch", fetcher);
    await load({ ...query, fresh: "1" }, "test-key");
    unavailable = true;
    const partial = await load({ ...query, fresh: "1" }, "test-key");
    expect(partial.coverage.failedRegions).toEqual(["US-MA"]);
    unavailable = false;
    const calls = fetcher.mock.calls.length;
    const recovered = await load(query, "test-key");
    expect(fetcher.mock.calls.length).toBeGreaterThan(calls);
    expect(recovered.cached).toBe(false);
    expect(recovered.coverage.failedRegions).toEqual([]);
    expect(recovered.coverage.successfulRegions).toContain("US-MA");
    expect((await load(query, "test-key")).cached).toBe(true);
  });

  it.each([
    ["Insights", insightsHandler, { regions: "US-NY,US-MA", back: "23" }],
    ["roundup", roundupHandler, { region: "south" }],
  ])("keeps partial and failed %s responses out of the CDN cache", async (_, handler, query) => {
    vi.stubGlobal("fetch", vi.fn(async (input) => /\/US-(MA|FL)\//.test(String(input))
      ? new Response("unavailable", { status: 503 }) : json([])));
    const result = response();
    await handler({ method: "GET", query, headers: {}, socket: { remoteAddress: "cache-test" } }, result);
    expect(result.status).toHaveBeenCalledWith(200);
    expect(result.setHeader).toHaveBeenLastCalledWith("Cache-Control", "no-store");
    expect(result.json.mock.calls[0][0].coverage.failedRegions).toHaveLength(1);

    const invalid = response();
    await handler({ method: "GET", query: { regions: "invalid", region: "invalid" } }, invalid);
    expect(invalid.status).toHaveBeenCalledWith(400);
    expect(invalid.setHeader).toHaveBeenLastCalledWith("Cache-Control", "no-store");
  });
});
