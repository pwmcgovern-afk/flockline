import { describe, expect, it, vi } from "vitest";
import { createDigestStore, StaleDigestReadError, withDigestLease } from "./digestDeliveryStore.js";

describe("digest receipt storage versions", () => {
  it("reads the uncompressed representation before a conditional update", async () => {
    const blobGet = vi.fn(async (_path, options) => ({
      stream: new Response(JSON.stringify({ roundup: "large edition ".repeat(1000) })).body,
      blob: { etag: options.headers?.["accept-encoding"] === "identity" ? '"version"' : 'W/"version"' }
    }));
    const blobPut = vi.fn(async () => ({ etag: '"next-version"' }));
    const store = createDigestStore({ blobGet, blobHead: async () => ({ etag: '"version"' }), blobPut });
    const record = await store.read("receipt.json");
    await store.write("receipt.json", { ...record.value, status: "sent" }, record.etag);
    expect(blobPut).toHaveBeenCalledWith("receipt.json", expect.any(String), expect.objectContaining({ ifMatch: '"version"' }));
  });

  it("reports an unexpected weak version as an error rather than a busy lease", async () => {
    const store = createDigestStore({ blobGet: async () => ({ blob: { etag: 'W/"version"' } }), blobHead: async () => ({ etag: '"version"' }) });
    await expect(store.read("receipt.json")).rejects.toThrow("strong version identifier");
  });

  it("re-reads a CDN copy whose version is older than the stored one", async () => {
    const versions = ['"old"', '"old"', '"current"'];
    const blobGet = vi.fn(async () => {
      const etag = versions.shift();
      return { stream: new Response(JSON.stringify({ etag })).body, blob: { etag } };
    });
    const wait = vi.fn(async () => {});
    const store = createDigestStore({ blobGet, blobHead: async () => ({ etag: '"current"' }), wait });
    expect(await store.read("receipt.json")).toEqual({ value: { etag: '"current"' }, etag: '"current"' });
    expect(blobGet).toHaveBeenCalledTimes(3);
  });

  it("re-reads a cached 404 for a receipt that exists", async () => {
    const blobGet = vi.fn().mockResolvedValueOnce(null)
      .mockResolvedValue({ stream: new Response("{}").body, blob: { etag: '"v"' } });
    const store = createDigestStore({ blobGet, blobHead: async () => ({ etag: '"v"' }), wait: async () => {} });
    expect(await store.read("receipt.json")).toMatchObject({ etag: '"v"' });
  });

  it("never hands out a stale version, and the lease reports it", async () => {
    const store = createDigestStore({
      blobGet: async () => ({ stream: new Response("{}").body, blob: { etag: '"old"' } }),
      blobHead: async () => ({ etag: '"current"' }), wait: async () => {}
    });
    await expect(store.read("receipt.json")).rejects.toBeInstanceOf(StaleDigestReadError);
    expect(await withDigestLease({ date: "2026-11-16", region: "south", store }, async () => {}))
      .toEqual({ status: "busy", reason: "stale_read", region: "south", date: "2026-11-16" });
  });

  it("treats a missing receipt as missing when storage agrees", async () => {
    const notFound = Object.assign(new Error("not found"), { name: "BlobNotFoundError" });
    const store = createDigestStore({ blobGet: async () => null, blobHead: async () => { throw notFound; } });
    expect(await store.read("receipt.json")).toBeNull();
  });

  it("retries the lease once after a write conflict", async () => {
    const { BlobPreconditionFailedError } = await import("@vercel/blob");
    let reads = 0;
    const store = {
      read: vi.fn(async () => ({ value: { leaseUntil: 0, attempts: reads++ }, etag: `"v${reads}"` })),
      write: vi.fn()
        .mockRejectedValueOnce(new BlobPreconditionFailedError())
        .mockImplementation(async (_path, value) => ({ value, etag: '"next"' }))
    };
    const task = vi.fn(async () => {});
    expect(await withDigestLease({ date: "2026-11-16", region: "south", store, now: () => 0 }, task)).toMatchObject({ leaseUntil: 0 });
    expect(task).toHaveBeenCalledTimes(1);
    expect(store.read).toHaveBeenCalledTimes(2);
  });
});
