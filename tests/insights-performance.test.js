import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getInsights } from "../lib/ebirdCore.js";
import insightsHandler from "../api/insights.js";
import { US_STATES } from "../shared/usGeography.js";

const { saveFindings, waitUntil } = vi.hoisted(() => ({
  saveFindings: vi.fn(),
  waitUntil: vi.fn(),
}));
vi.mock("../lib/sightingStore.js", () => ({ saveSightingFindings: saveFindings }));
vi.mock("@vercel/functions", () => ({ waitUntil }));

const row = {
  speciesCode: "redcro", comName: "Red Crossbill", sciName: "Loxia curvirostra",
  subId: "S123456789", obsDt: "2026-10-14 08:30", howMany: 3,
  locId: "L12345", locName: "Source pine grove", subnational1Code: "US-CA",
  subnational2Code: "US-CA-075", subnational2Name: "San Francisco",
  obsValid: false, obsReviewed: false,
};
const jsonResponse = (rows) => new Response(JSON.stringify(rows), {
  headers: { "content-type": "application/json" },
});
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubEnv("EBIRD_API_KEY", "test-key");
  saveFindings.mockReset().mockResolvedValue(undefined);
  waitUntil.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("bounded interactive Insights", () => {
  it("answers a capped nationwide API request without state expansion or waiting for Blob saves", async () => {
    const saving = deferred();
    saveFindings.mockReturnValue(saving.promise);
    const fetcher = vi.fn(async (input) => {
      expect(new URL(String(input)).pathname).toBe("/v2/data/obs/US/recent/notable");
      return jsonResponse(Array(10000).fill(row));
    });
    vi.stubGlobal("fetch", fetcher);
    const nationwide = US_STATES.map((state) => state.code);
    const response = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };

    try {
      await insightsHandler({
        method: "GET", query: { regions: nationwide.join(","), back: "7", fresh: "1" },
        headers: {}, socket: { remoteAddress: "127.0.0.1" },
      }, response);

      expect(response.status).toHaveBeenCalledWith(200);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(waitUntil).toHaveBeenCalledWith(saving.promise);
      const payload = response.json.mock.calls[0][0];
      expect(payload.coverage).toMatchObject({ failedRegions: [], limitedRegions: nationwide });
      expect(payload.findings[0]).toMatchObject({
        speciesCode: row.speciesCode, howMany: 3, obsValid: false, obsReviewed: false,
        countyCode: "US-CA-075", countyName: "San Francisco",
        reporting: { partial: true, reports: [{
          subId: row.subId, count: "3", countyCode: "US-CA-075", countyName: "San Francisco",
        }] },
      });
      expect(payload.findings[0].reporting.reports).toHaveLength(1);
    } finally {
      saving.resolve();
    }
  });

  it("coalesces simultaneous refreshes and caches the finished result", async () => {
    const upstream = deferred();
    const fetcher = vi.fn(() => upstream.promise);
    vi.stubGlobal("fetch", fetcher);
    const query = { regions: "US-CA", back: "11", fresh: "1" };
    const first = getInsights(query, "test-key");
    const second = getInsights(query, "test-key");
    expect(fetcher).toHaveBeenCalledTimes(1);
    upstream.resolve(jsonResponse([row]));

    const results = await Promise.all([first, second]);
    expect(results[0]).toEqual(results[1]);
    expect(saveFindings).toHaveBeenCalledTimes(1);
    const cached = await getInsights({ ...query, fresh: "0" }, "test-key");
    expect(cached.cached).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("allows the next request to retry after a shared upstream failure", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse([row]));
    vi.stubGlobal("fetch", fetcher);
    const query = { regions: "US-CA", back: "12", fresh: "1" };
    const failed = await Promise.allSettled([
      getInsights(query, "test-key"), getInsights(query, "test-key"),
    ]);
    expect(failed.every((result) => result.status === "rejected")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const recovered = await getInsights(query, "test-key");
    expect(recovered.findings).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("still awaits saved context when no background lifetime is supplied", async () => {
    const saving = deferred();
    saveFindings.mockReturnValue(saving.promise);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([row])));
    let returned = false;
    const request = getInsights({ regions: "US-CA", back: "13", fresh: "1" }, "test-key")
      .then((payload) => { returned = true; return payload; });
    await vi.waitFor(() => expect(saveFindings).toHaveBeenCalledTimes(1));
    expect(returned).toBe(false);
    saving.resolve();
    expect((await request).findings).toHaveLength(1);
  });
});
