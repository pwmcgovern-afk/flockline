import { describe, expect, it, vi } from "vitest";
import { createDigestStore } from "./digestDeliveryStore.js";

describe("digest receipt storage versions", () => {
  it("reads the uncompressed representation before a conditional update", async () => {
    const blobGet = vi.fn(async (_path, options) => ({
      stream: new Response(JSON.stringify({ roundup: "large edition ".repeat(1000) })).body,
      blob: { etag: options.headers?.["accept-encoding"] === "identity" ? '"version"' : 'W/"version"' }
    }));
    const blobPut = vi.fn(async () => ({ etag: '"next-version"' }));
    const store = createDigestStore({ blobGet, blobPut });
    const record = await store.read("receipt.json");
    await store.write("receipt.json", { ...record.value, status: "sent" }, record.etag);
    expect(blobPut).toHaveBeenCalledWith("receipt.json", expect.any(String), expect.objectContaining({ ifMatch: '"version"' }));
  });

  it("reports an unexpected weak version as an error rather than a busy lease", async () => {
    const store = createDigestStore({ blobGet: async () => ({ blob: { etag: 'W/"version"' } }) });
    await expect(store.read("receipt.json")).rejects.toThrow("strong version identifier");
  });
});
