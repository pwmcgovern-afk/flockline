import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { US_STATES } from "../shared/usGeography.js";

vi.mock("../lib/sightingStore.js", () => ({ saveSightingFindings: vi.fn(async () => {}) }));

const row = {
  speciesCode: "sora", comName: "Sora", subId: "S402107527", locName: "Bryant Park",
  locId: "L683555", obsDt: "2026-10-14 08:00", howMany: 1,
  lat: 40.7536729, lng: -73.9832322, subnational1Code: "US-NY",
};
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});
const response = () => ({ setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() });

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv("EBIRD_API_KEY", "test-key");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("roundup recovery after country-feed fallback", () => {
  it.each(["one-state", "all-states"])("does not cache a country fallback after %s expansion fails", async (mode) => {
    let recovering = false;
    const fetcher = vi.fn(async (input) => {
      const region = new URL(String(input)).pathname.match(/\/obs\/([^/]+)\//)?.[1];
      if (region === "US") return json(Array(10000).fill(row));
      if (!recovering && (mode === "all-states" || region === "US-MA")) return json({}, 503);
      return json(region === "US-NY" ? [row] : []);
    });
    vi.stubGlobal("fetch", fetcher);
    const { default: handler } = await import("../api/roundup.js");
    const { getWeeklyRoundup } = await import("../lib/ebirdCore.js");
    const initial = response();
    const pending = handler({ method: "GET", query: { region: "nationwide" } }, initial);
    await vi.runAllTimersAsync();
    await pending;

    expect(initial.status).toHaveBeenCalledWith(200);
    expect(initial.setHeader).toHaveBeenLastCalledWith("Cache-Control", "no-store");
    const payload = initial.json.mock.calls[0][0];
    expect(payload.coverage.failedRegions).toEqual([]);
    expect(payload.coverage.retryableRegions).toEqual(mode === "all-states" ? US_STATES.map((state) => state.code) : ["US-MA"]);
    expect(payload.findings[0]).toMatchObject({ speciesCode: "sora", subId: row.subId });

    recovering = true;
    const beforeRecovery = fetcher.mock.calls.length;
    const recoveredResponse = response();
    await handler({ method: "GET", query: { region: "nationwide" } }, recoveredResponse);
    const recovered = recoveredResponse.json.mock.calls[0][0];
    expect(fetcher.mock.calls.length).toBeGreaterThan(beforeRecovery);
    expect(recovered.cached).toBe(false);
    expect(recovered.coverage.retryableRegions).toBeUndefined();
    expect(recovered.coverage.limitedRegions).toEqual([]);
    expect(recoveredResponse.setHeader).toHaveBeenLastCalledWith("Cache-Control", "s-maxage=3600, stale-while-revalidate=21600");

    const callsAfterRecovery = fetcher.mock.calls.length;
    expect((await getWeeklyRoundup({ region: "nationwide" }, "test-key")).cached).toBe(true);
    expect(fetcher.mock.calls.length).toBe(callsAfterRecovery);
  });
});
