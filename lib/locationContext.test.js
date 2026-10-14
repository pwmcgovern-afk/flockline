import { afterEach, describe, expect, it, vi } from "vitest";
import { getHotspotCounty, getHotspotContext } from "./locationContext.js";

const hotspot = {
  locId: "L419667", isHotspot: true,
  subnational2Code: "US-CA-075", subnational2Name: "San Francisco",
};
const setup = (location = hotspot) => ({
  apiKey: "test-key", cache: new Map(), now: () => 1000,
  fetcher: vi.fn().mockResolvedValue({ ok: true, json: async () => location }),
});

afterEach(() => vi.useRealTimers());

describe("exact hotspot county context", () => {
  it("uses an identified public hotspot and caches its county", async () => {
    const options = setup();
    expect(await getHotspotCounty("L419667", options)).toEqual({ countyCode: "US-CA-075", countyName: "San Francisco" });
    await getHotspotCounty("L419667", options);
    expect(options.fetcher).toHaveBeenCalledTimes(1);
    expect(options.fetcher.mock.calls[0][0]).toBe("https://api.ebird.org/v2/ref/hotspot/info/L419667");
  });

  it.each([
    { ...hotspot, locId: "L999999" },
    { ...hotspot, isHotspot: false },
    { ...hotspot, subnational2Code: undefined },
    { ...hotspot, subnational2Name: "" },
  ])("keeps unmatched, private, or incomplete locations unknown", async (location) => {
    expect(await getHotspotCounty("L419667", setup(location))).toBeNull();
  });

  it("caches a failed lookup briefly and retries after expiry", async () => {
    const options = setup();
    options.fetcher.mockRejectedValueOnce(new Error("temporarily unavailable"));
    expect(await getHotspotCounty("L419667", options)).toBeNull();
    expect(await getHotspotCounty("L419667", options)).toBeNull();
    expect(options.fetcher).toHaveBeenCalledTimes(1);
    options.now = () => 301001;
    expect(await getHotspotCounty("L419667", options)).toMatchObject({ countyCode: "US-CA-075" });
    expect(options.fetcher).toHaveBeenCalledTimes(2);
  });

  it("aborts a slow response and keeps optional context unavailable", async () => {
    vi.useFakeTimers();
    const options = setup();
    options.timeoutMs = 20;
    options.fetcher.mockImplementation((_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const result = getHotspotCounty("L419667", options);
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toBeNull();
    expect(await getHotspotCounty("L419667", options)).toBeNull();
    expect(options.fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not send requests without a valid location or credential", async () => {
    const options = setup();
    expect(await getHotspotCounty(undefined, options)).toBeNull();
    expect(await getHotspotCounty("L419667", { ...options, apiKey: "" })).toBeNull();
    expect(options.fetcher).not.toHaveBeenCalled();
  });
});


describe("public hotspot display context", () => {
  it("recovers a name and state from the same exact hotspot without widening county callers", async () => {
    const options = setup({ ...hotspot, locName: "Mt. Davidson", subnational1Code: "US-CA", subnational1Name: "California" });
    expect(await getHotspotContext("L419667", options)).toMatchObject({ locId: "L419667", locName: "Mt. Davidson", region: "California", regionCode: "US-CA" });
    expect(await getHotspotCounty("L419667", options)).toEqual({ countyCode: "US-CA-075", countyName: "San Francisco" });
    expect(options.fetcher).toHaveBeenCalledTimes(1);
  });
  it("can retain a public place name without inventing missing county data", async () => {
    const options = setup({ ...hotspot, locName: "Public place", subnational2Code: undefined });
    expect(await getHotspotContext("L419667", options)).toEqual({ locId: "L419667", locName: "Public place" });
    expect(await getHotspotCounty("L419667", options)).toBeNull();
  });
  it.each([{ ...hotspot, locId: "L999999", locName: "Wrong place" }, { ...hotspot, isHotspot: false, locName: "Private place" }])("never fills display context from an unmatched or private location", async (location) => {
    expect(await getHotspotContext("L419667", setup(location))).toBeNull();
  });
});
