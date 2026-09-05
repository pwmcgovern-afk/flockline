import { describe, expect, it, vi } from "vitest";
import { BlobPreconditionFailedError } from "@vercel/blob";
import { runDigestEdition } from "./digestDelivery.js";
import { deliveryPath, withDigestLease } from "./digestDeliveryStore.js";

const date = "2026-09-07";
const region = { id: "northeast", name: "Northeast", topicId: "topic_ne" };
const configuration = { apiKey: "test", publicAppUrl: "https://flockline.app", from: "Flockline <digest@flockline.app>", segmentId: "segment", regions: [region] };
const roundup = { scopeId: region.id, scopeLabel: region.name, source: "ebird", generatedAt: `${date}T14:01:00Z`, findings: [], summary: "No notable reports." };

function memoryStore() {
  const records = new Map();
  let version = 0;
  return {
    records,
    read: vi.fn(async (path) => records.get(path) ? structuredClone(records.get(path)) : null),
    write: vi.fn(async (path, value, etag) => {
      if (records.get(path)?.etag !== etag) throw new BlobPreconditionFailedError();
      const saved = { value: structuredClone(value), etag: String(++version) };
      records.set(path, saved);
      return structuredClone(saved);
    })
  };
}

function fixture() {
  const store = memoryStore();
  let broadcast = null;
  const provider = {
    verifySender: vi.fn(async () => {}), hasRecipients: vi.fn(async () => true),
    findBroadcast: vi.fn(async () => broadcast),
    getBroadcast: vi.fn(async () => structuredClone(broadcast)),
    createDraft: vi.fn(async () => { broadcast = { id: "broadcast-1", status: "draft" }; return broadcast; }),
    sendBroadcast: vi.fn(async () => {
      expect(store.records.get(deliveryPath(date, region.id)).value.broadcastId).toBe("broadcast-1");
      broadcast = { id: "broadcast-1", status: "sent", sent_at: `${date}T14:02:00Z` };
      return { id: broadcast.id };
    })
  };
  const dependencies = {
    store, provider, getRoundup: vi.fn(async () => roundup),
    illustrate: vi.fn(async (value) => value), archive: vi.fn(async () => ({})),
    now: () => Date.parse(`${date}T14:01:00Z`)
  };
  const run = (checkOnly = false) => runDigestEdition({ configuration, region, date, checkOnly }, dependencies);
  return { store, provider, dependencies, run };
}

describe("recoverable weekly delivery", () => {
  it("saves the broadcast ID before sending and stops all work on a completed retry", async () => {
    const f = fixture();
    expect(await f.run()).toMatchObject({ status: "sent", archived: true, broadcastId: "broadcast-1", leaseUntil: 0 });
    expect(f.dependencies.illustrate).toHaveBeenCalledWith(roundup, configuration.publicAppUrl, { generateMissing: false });
    expect(await f.run()).toMatchObject({ status: "sent", alreadyComplete: true });
    expect(f.provider.createDraft).toHaveBeenCalledTimes(1);
    expect(f.provider.sendBroadcast).toHaveBeenCalledTimes(1);
    expect(f.dependencies.getRoundup).toHaveBeenCalledTimes(1);
  });

  it("reconciles a send whose successful response was lost without sending twice", async () => {
    const f = fixture();
    const send = f.provider.sendBroadcast.getMockImplementation();
    f.provider.sendBroadcast.mockImplementationOnce(async () => { await send(); throw new Error("Response lost"); });
    await expect(f.run()).rejects.toThrow("Response lost");
    expect(await f.run()).toMatchObject({ status: "sent" });
    expect(f.provider.createDraft).toHaveBeenCalledTimes(1);
    expect(f.provider.sendBroadcast).toHaveBeenCalledTimes(1);
    expect(f.dependencies.getRoundup).toHaveBeenCalledTimes(1);
  });

  it("finds a draft by its stable name when the create response was lost", async () => {
    const f = fixture();
    const create = f.provider.createDraft.getMockImplementation();
    f.provider.createDraft.mockImplementationOnce(async () => { await create(); throw new Error("Create response lost"); });
    await expect(f.run()).rejects.toThrow("Create response lost");
    expect(await f.run()).toMatchObject({ status: "sent", broadcastId: "broadcast-1" });
    expect(f.provider.createDraft).toHaveBeenCalledTimes(1);
    expect(f.provider.sendBroadcast).toHaveBeenCalledTimes(1);
  });

  it("archives empty-audience editions without creating orphan drafts", async () => {
    const f = fixture(); f.provider.hasRecipients.mockResolvedValue(false);
    expect(await f.run()).toMatchObject({ status: "no_recipients", archived: true });
    expect(f.provider.createDraft).not.toHaveBeenCalled();
    expect(f.provider.sendBroadcast).not.toHaveBeenCalled();
    f.provider.hasRecipients.mockResolvedValue(true);
    expect(await f.run()).toMatchObject({ status: "sent" });
    expect(f.dependencies.getRoundup).toHaveBeenCalledTimes(1);
  });

  it("does not send if its durable archive cannot be saved", async () => {
    const f = fixture(); f.dependencies.archive.mockRejectedValue(new Error("Blob unavailable"));
    await expect(f.run()).rejects.toThrow("Blob unavailable");
    expect(f.provider.createDraft).not.toHaveBeenCalled();
    expect(f.provider.sendBroadcast).not.toHaveBeenCalled();
    expect(f.store.records.get(deliveryPath(date, region.id)).value).toMatchObject({ status: "failed", leaseUntil: 0, roundup });
  });

  it("checks live data, recipient routing, rendering, and storage without sending or publishing an issue", async () => {
    const f = fixture();
    expect(await f.run(true)).toMatchObject({ status: "ready", sent: false, hasRecipients: true });
    expect(f.provider.verifySender).toHaveBeenCalled();
    expect(f.provider.createDraft).not.toHaveBeenCalled();
    expect(f.provider.sendBroadcast).not.toHaveBeenCalled();
    expect(f.dependencies.archive).not.toHaveBeenCalled();
    expect(f.store.records.has(deliveryPath(date, region.id))).toBe(false);
    expect(f.store.records.has(deliveryPath(date, region.id, "check"))).toBe(true);
  });

  it("persists check failures without putting provider messages or contacts in public storage", async () => {
    const f = fixture(); f.provider.verifySender.mockRejectedValue(new Error("Private provider detail"));
    await expect(f.run(true)).rejects.toThrow("Private provider detail");
    expect(f.store.records.get(deliveryPath(date, region.id, "check")).value.status).toBe("failed");
    expect(JSON.stringify([...f.store.records])).not.toContain("Private provider detail");
  });

  it("rejects demo or wrong-day data before sending", async () => {
    const f = fixture(); f.dependencies.getRoundup.mockResolvedValue({ ...roundup, source: "demo" });
    await expect(f.run()).rejects.toThrow("live roundup");
    expect(f.provider.sendBroadcast).not.toHaveBeenCalled();
  });

  it("does not claim a queued broadcast was sent or send it again", async () => {
    const f = fixture();
    f.provider.findBroadcast.mockResolvedValue({ id: "queued-broadcast", status: "queued" });
    expect(await f.run()).toMatchObject({ status: "submitted", providerStatus: "queued" });
    expect(f.provider.sendBroadcast).not.toHaveBeenCalled();
  });
});

describe("delivery leases", () => {
  it("allows only one of two simultaneous workers to run", async () => {
    const store = memoryStore(); const task = vi.fn(async () => {});
    const results = await Promise.all([1, 2].map(() => withDigestLease({ date, region: region.id, store, now: () => 1000 }, task)));
    expect(task).toHaveBeenCalledTimes(1);
    expect(results.some((result) => result.status === "busy")).toBe(true);
  });

  it("reclaims a timed-out worker's lease while preserving its broadcast", async () => {
    const store = memoryStore();
    await store.write(deliveryPath(date, region.id), { leaseUntil: 1000, broadcastId: "existing" });
    const task = vi.fn(async () => {});
    expect(await withDigestLease({ date, region: region.id, store, now: () => 1001 }, task)).toMatchObject({ broadcastId: "existing", leaseUntil: 0 });
    expect(task).toHaveBeenCalledTimes(1);
  });
});
