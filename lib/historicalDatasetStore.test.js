import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHistoricalDatasetStore } from "./historicalDatasetStore.js";
import { loadHistoricalBaseline } from "./historicalBaseline.js";
import { loadAnnualHistory } from "./annualHistory.js";

function fixture(code = "US-CT-009", remote = false) {
  const data = { schemaVersion: 1, areaCode: code, pooled: [], annual: [] };
  const bytes = gzipSync(JSON.stringify(data));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const file = `${code}.${sha256.slice(0, 12)}.json.gz`;
  const entry = { sha256, compressedBytes: bytes.length,
    ...(remote ? { url: `https://fixture.public.blob.vercel-storage.com/baselines/${file}` } : { file }) };
  return { code, data, bytes, entry };
}

describe("county data storage", () => {
  it("loads only the requested county and does not read missing counties", () => {
    const a = fixture(); const b = fixture("US-NY-061"); const read = vi.fn(() => a.bytes);
    const store = createHistoricalDatasetStore({ entries: { [a.code]: a.entry, [b.code]: b.entry }, read });
    expect(store.stats()).toEqual({ counties: 0, decodedBytes: 0, pending: 0 });
    expect(store.local("US-WA-033")).toBeNull();
    expect(store.local("../../file")).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(store.local(a.code)).toEqual(a.data);
    expect(store.local(a.code)).toEqual(a.data);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("evicts old counties at the decoded-byte budget", () => {
    const a = fixture(); const b = fixture("US-NY-061");
    const read = vi.fn((file) => file.startsWith(a.code) ? a.bytes : b.bytes);
    const store = createHistoricalDatasetStore({ entries: { [a.code]: a.entry, [b.code]: b.entry }, read,
      maxCacheBytes: Buffer.byteLength(JSON.stringify(a.data)) });
    store.local(a.code); store.local(b.code); store.local(a.code);
    expect(read).toHaveBeenCalledTimes(3);
    expect(store.stats().counties).toBe(1);
  });

  it("rejects changed bytes and unsafe local paths without caching them", () => {
    const a = fixture();
    const store = createHistoricalDatasetStore({ entries: { [a.code]: a.entry }, read: () => Buffer.from("corrupt") });
    expect(() => store.local(a.code)).toThrow("pinned index");
    expect(store.stats().counties).toBe(0);
    const unsafe = createHistoricalDatasetStore({ entries: { [a.code]: { ...a.entry, file: "../secret" } }, read: vi.fn() });
    expect(() => unsafe.local(a.code)).toThrow("filename");
  });

  it("rejects the wrong county even if its bytes match the supplied hash", () => {
    const a = fixture();
    const store = createHistoricalDatasetStore({ entries: { "US-NY-061": { ...a.entry, file: `US-NY-061.${a.entry.sha256.slice(0, 12)}.json.gz` } }, read: () => a.bytes });
    expect(() => store.local("US-NY-061")).toThrow("geographic scope");
  });

  it("coalesces remote reads and caches the verified result", async () => {
    const a = fixture("US-CT-009", true);
    const fetcher = vi.fn(async () => new Response(a.bytes));
    const store = createHistoricalDatasetStore({ entries: { [a.code]: a.entry }, fetcher });
    const results = await Promise.all([store.load(a.code), store.load(a.code)]);
    expect(results).toEqual([a.data, a.data]);
    expect(await store.load(a.code)).toEqual(a.data);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
  });

  it("bounds oversized remote bodies and permits a subsequent retry", async () => {
    const a = fixture("US-CT-009", true);
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(Buffer.concat([a.bytes, a.bytes])))
      .mockResolvedValueOnce(new Response(a.bytes));
    const store = createHistoricalDatasetStore({ entries: { [a.code]: a.entry }, fetcher });
    await expect(store.load(a.code)).rejects.toThrow("pinned size");
    expect(store.stats().pending).toBe(0);
    expect(await store.load(a.code)).toEqual(a.data);
  });

  it("stops a stalled source at the caller deadline", async () => {
    const a = fixture("US-CT-009", true);
    const fetcher = vi.fn(() => new Promise(() => {}));
    const store = createHistoricalDatasetStore({ entries: { [a.code]: a.entry }, fetcher, timeoutMs: 20 });
    await expect(store.load(a.code)).rejects.toThrow("timed out");
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    expect(store.stats()).toEqual({ counties: 0, decodedBytes: 0, pending: 0 });
  });

  it("does not request arbitrary URLs from an invalid index", async () => {
    const a = fixture("US-CT-009", true); const fetcher = vi.fn();
    const store = createHistoricalDatasetStore({ entries: { [a.code]: { ...a.entry, url: "https://example.com/data" } }, fetcher });
    await expect(store.load(a.code)).rejects.toThrow("pinned public Blob");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps source failure separate from absent coverage and does not erase saved facts", async () => {
    const finding = { countyCode: "US-CT-009", speciesCode: "willet1", obsDt: "2026-10-12" };
    const failed = { load: async () => { throw new Error("offline"); } };
    expect(await loadHistoricalBaseline(finding, failed)).toMatchObject({ status: "unavailable", reason: "source_unavailable" });
    expect(await loadHistoricalBaseline(finding, { load: async () => null })).toMatchObject({ reason: "county_not_covered" });
    const saved = { status: "available", area: { code: finding.countyCode }, methodVersion: "ebird-barchart-48-v1", frequency: 0.001 };
    expect(await loadAnnualHistory(saved, failed)).toBe(saved);
  });

  it("preserves every original pooled and annual value in all twelve county files", () => {
    const readJson = (name) => JSON.parse(fs.readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));
    const pooled = readJson("historical-baselines.json"); const annual = readJson("annual-history.json");
    const index = readJson("historical-index.json");
    expect(Object.keys(index.counties).sort()).toEqual([...new Set(pooled.map((d) => d.area.code))].sort());
    for (const [code, entry] of Object.entries(index.counties)) {
      const bytes = fs.readFileSync(new URL(`../data/historical-counties/${entry.file}`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
      expect(bytes.length).toBe(entry.compressedBytes);
      expect(JSON.parse(gunzipSync(bytes))).toEqual({ schemaVersion: 1, areaCode: code,
        pooled: pooled.filter((d) => d.area.code === code), annual: annual.filter((d) => d.areaCode === code) });
    }
  });
});
