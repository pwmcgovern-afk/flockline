import { afterEach, describe, expect, it, vi } from "vitest";
import { createOperationalRecorder, readOperationalSnapshots } from "./operationalEvents.js";

const START = Date.parse("2026-10-14T12:00:00.000Z");
const DAY = 86_400_000;
afterEach(() => vi.useRealTimers());

function recorder(options = {}) {
  const blobPut = vi.fn(async () => ({}));
  return { blobPut, record: createOperationalRecorder({ blobPut, now: () => START, environment: "production", token: "test-public-token", ...options }) };
}

describe("sanitized operational samples", () => {
  it("never persists raw provider errors, prompts, addresses, identifiers, or supplied times", async () => {
    const { record, blobPut } = recorder();
    await expect(record({ route: "chat", category: "source", httpStatus: 502, occurredAt: "attacker-time",
      error: new Error("provider-secret"), message: "prompt-secret", headers: { authorization: "secret" }, ip: "192.0.2.8", requestId: "private-id" })).resolves.toEqual({ recorded: true });
    expect(JSON.parse(blobPut.mock.calls[0][1])).toEqual({ version: 1, route: "chat", category: "source", httpStatus: 502, occurredAt: new Date(START).toISOString() });
    expect(blobPut.mock.calls[0][0]).toMatch(/^operational-samples\/flockline\/v1\/production\/chat\/source\/\d+\.json$/);
  });

  it("rejects uncontrolled labels and strips invalid status values", async () => {
    const { record, blobPut } = recorder();
    expect(await record({ route: "chat?prompt=secret", category: "timeout" })).toEqual({ recorded: false, reason: "invalid_event" });
    expect(await record({ route: "chat", category: "provider-secret" })).toEqual({ recorded: false, reason: "invalid_event" });
    await record({ route: "chat", category: "unknown", httpStatus: "500 secret" });
    expect(JSON.parse(blobPut.mock.calls[0][1])).not.toHaveProperty("httpStatus");
    expect(blobPut).toHaveBeenCalledTimes(1);
  });

  it("bounds storage paths while reusing slots every 14 days", async () => {
    let time = START;
    const { record, blobPut } = recorder({ now: () => time, cooldownMs: 0 });
    for (let day = 0; day < 30; day += 1) {
      time = START + day * DAY;
      await record({ route: "insights", category: "source" });
    }
    expect(new Set(blobPut.mock.calls.map(([path]) => path)).size).toBe(14);
    expect(blobPut.mock.calls[0][0]).toBe(blobPut.mock.calls[14][0]);
    expect(blobPut.mock.calls[0][2]).toMatchObject({ addRandomSuffix: false, allowOverwrite: true });
  });

  it("suppresses a concurrent error storm locally including failed writes", async () => {
    const blobPut = vi.fn(async () => { throw new Error("provider-secret"); });
    const { record } = recorder({ blobPut });
    const results = await Promise.all(Array.from({ length: 20 }, () => record({ route: "chat", category: "admission" })));
    expect(blobPut).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.reason === "suppressed")).toHaveLength(19);
    expect(JSON.stringify(results)).not.toContain("provider-secret");
  });

  it("settles and aborts a stuck writer within its diagnostic deadline", async () => {
    vi.useFakeTimers();
    const blobPut = vi.fn(() => new Promise(() => {}));
    const { record } = recorder({ blobPut });
    const pending = record({ route: "roundup", category: "timeout" });
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toEqual({ recorded: false, reason: "write_timeout" });
    expect(blobPut.mock.calls[0][2].abortSignal.aborted).toBe(true);
  });

  it("isolates namespaces without relying on deployment identifiers", async () => {
    const prod = recorder();
    const preview = recorder({ environment: "preview" });
    await prod.record({ route: "sighting", category: "unknown" });
    await preview.record({ route: "sighting", category: "unknown" });
    expect(prod.blobPut.mock.calls[0][0]).not.toBe(preview.blobPut.mock.calls[0][0]);
  });

  it("pins the public-store token and skips writes if it is unavailable", async () => {
    const { record, blobPut } = recorder();
    await record({ route: "chat", category: "unknown" });
    expect(blobPut.mock.calls[0][2].token).toBe("test-public-token");
    const missing = recorder({ token: "" });
    expect(await missing.record({ route: "chat", category: "unknown" })).toEqual({ recorded: false, reason: "storage_unavailable" });
    expect(missing.blobPut).not.toHaveBeenCalled();
  });
});

describe("operational sample inspection", () => {
  it("re-sanitizes read data and hides expired ring slots without claiming service health", async () => {
    const current = { version: 1, route: "chat", category: "source", httpStatus: 503, occurredAt: new Date(START).toISOString(), message: "secret", ip: "192.0.2.8" };
    const expired = { ...current, category: "unknown", occurredAt: new Date(START - 14 * DAY).toISOString() };
    const slot = Math.floor(START / DAY) % 14;
    const currentPath = `operational-samples/flockline/v1/production/chat/source/${slot}.json`;
    const expiredPath = `operational-samples/flockline/v1/production/chat/unknown/${slot}.json`;
    const blobList = vi.fn(async () => ({ hasMore: false, blobs: [{ pathname: currentPath }, { pathname: expiredPath }] }));
    const blobGet = vi.fn(async (path) => ({ statusCode: 200, stream: new Response(JSON.stringify(path === currentPath ? current : expired)).body }));
    const result = await readOperationalSnapshots({ now: () => START, blobList, blobGet, token: "test-public-token" });
    expect(result.events).toEqual([{ version: 1, route: "chat", category: "source", httpStatus: 503, occurredAt: current.occurredAt }]);
    expect(result.omittedRecords).toBe(1);
    expect(result.completeHistory).toBe(false);
    expect(result.visibility).toContain("No samples does not establish service health");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("reports unavailable reads without exposing upstream exceptions", async () => {
    const slot = Math.floor(START / DAY) % 14;
    const result = await readOperationalSnapshots({ now: () => START, token: "test-public-token",
      blobList: async () => ({ hasMore: false, blobs: [{ pathname: `operational-samples/flockline/v1/production/chat/timeout/${slot}.json` }] }),
      blobGet: async () => { throw new Error("provider-secret"); } });
    expect(result.failedReads).toBe(1);
    expect(result.events).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("provider-secret");
  });
});
