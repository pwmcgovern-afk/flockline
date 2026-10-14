import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSightingRecord } from "./sightingStore.js";

const prefix = "sightings/S402323216/sora.json";
const listed = { blobs: [{ pathname: prefix, url: "https://example.test/saved.json" }] };
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-only");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("saved sighting read deadlines", () => {
  it("stops waiting at four seconds when Blob list ignores cancellation", async () => {
    let finishList;
    const blobList = vi.fn(() => new Promise(resolve => { finishList = resolve; }));
    const fetcher = vi.fn();
    const caller = new AbortController();
    const pending = readSightingRecord(prefix, { blobList, fetcher, signal: caller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(4000);
    await rejected;
    const sdkSignal = blobList.mock.calls[0][0].abortSignal;
    expect(sdkSignal.aborted).toBe(true);
    expect(sdkSignal.reason.name).toBe("AbortError");
    expect(getEventListeners(sdkSignal, "abort")).toHaveLength(0);
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    finishList(listed);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["fetch", "json"])("bounds the entire content stage when %s ignores cancellation", async (stage) => {
    let rejectLate;
    const stalled = new Promise((_resolve, reject) => { rejectLate = reject; });
    const blobList = vi.fn(async () => listed);
    const fetcher = vi.fn(() => stage === "fetch" ? stalled : Promise.resolve({ ok: true, json: () => stalled }));
    const pending = readSightingRecord(prefix, { blobList, fetcher });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(fetcher.mock.calls[0][1].signal.reason.name).toBe("AbortError");
    rejectLate(new Error("late content failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps JSON parsing within the five-second fetch budget", async () => {
    const blobList = vi.fn(async () => listed);
    const fetcher = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 4000));
      return { ok: true, json: () => new Promise(() => {}) };
    });
    let settled = false;
    const pending = readSightingRecord(prefix, { blobList, fetcher }).finally(() => { settled = true; });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(settled).toBe(true);
  });

  it.each(["list", "fetch"])("propagates caller cancellation promptly during a stalled %s", async (stage) => {
    const caller = new AbortController();
    const blobList = vi.fn(() => stage === "list" ? new Promise(() => {}) : Promise.resolve(listed));
    const fetcher = vi.fn(() => new Promise(() => {}));
    const pending = readSightingRecord(prefix, { blobList, fetcher, signal: caller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    caller.abort();
    await rejected;
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves a successful saved record and removes deadline timers", async () => {
    const saved = { speciesCode: "sora", subId: "S402323216", locName: "Bryant Park" };
    const blobList = vi.fn(async () => listed);
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => saved }));
    const caller = new AbortController();
    expect(await readSightingRecord(prefix, { blobList, fetcher, signal: caller.signal })).toEqual(saved);
    expect(fetcher).toHaveBeenCalledWith(listed.blobs[0].url, expect.any(Object));
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
  });

  it("returns null for an absent exact record without fetching a nearby prefix", async () => {
    const fetcher = vi.fn();
    const result = await readSightingRecord(prefix, {
      blobList: async () => ({ blobs: [{ pathname: `${prefix}.other`, url: "https://example.test/other.json" }] }), fetcher,
    });
    expect(result).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
