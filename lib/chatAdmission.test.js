import { afterEach, describe, expect, it, vi } from "vitest";
import { getEventListeners } from "node:events";
import { chatClientAddress, createChatAdmissionStore, enforceChatAdmission, reserveChatRequest } from "./chatAdmission.js";

const { blobGet, blobPut } = vi.hoisted(() => ({ blobGet: vi.fn(), blobPut: vi.fn() }));
vi.mock("@vercel/blob", async (importOriginal) => ({ ...await importOriginal(), get: blobGet, put: blobPut }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  blobGet.mockReset();
  blobPut.mockReset();
});
const minute = 60_000;
const day = 24 * 60 * minute;
const secret = "test-admission-secret";
const path = "ask-admission/flockline/v1/production.json";
function memoryStore() {
  let record;
  let version = 0;
  return {
    read: vi.fn(async () => record ? structuredClone(record) : null),
    write: vi.fn(async (_path, value, etag) => {
      if (etag !== record?.etag) throw new Error("Precondition failed");
      record = { value: structuredClone(value), etag: String(++version) };
      return record;
    }),
  };
}
function request(store, options = {}) {
  return reserveChatRequest({ store, path, secret, client: "192.0.2.1", now: () => day + minute, ...options });
}

function deployedAdmission() {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-only");
  vi.stubEnv("DIGEST_SIGNING_SECRET", secret);
  vi.stubEnv("ASK_READ_WRITE_TOKEN", "test-only-private");
  return {
    req: { headers: { "x-vercel-forwarded-for": "192.0.2.1" } },
    res: { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() },
  };
}

describe("shared Ask admission", () => {
  it("bounds an unresponsive read to three seconds and prevents a late write", async () => {
    vi.useFakeTimers();
    const { req, res } = deployedAdmission();
    let finishRead;
    blobGet.mockImplementation(() => new Promise(resolve => { finishRead = resolve; }));
    const incoming = new AbortController();
    const pending = enforceChatAdmission(req, res, { signal: incoming.signal });
    const rejected = expect(pending).rejects.toMatchObject({ statusCode: 503, code: "admission_unavailable" });
    await vi.advanceTimersByTimeAsync(3_000);
    await rejected;
    const sdkSignal = blobGet.mock.calls[0][1].abortSignal;
    expect(sdkSignal.aborted).toBe(true);
    expect(sdkSignal.reason.name).toBe("AbortError");
    expect(getEventListeners(incoming.signal, "abort")).toHaveLength(0);
    expect(getEventListeners(sdkSignal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    finishRead(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(blobPut).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"])("never grants after a timed-out write that later %ss", async (settle) => {
    vi.useFakeTimers();
    const { req, res } = deployedAdmission();
    let finishWrite;
    blobGet.mockResolvedValue(null);
    blobPut.mockImplementation(() => new Promise((resolve, reject) => {
      finishWrite = () => settle === "resolve" ? resolve({}) : reject(new Error("late SDK failure"));
    }));
    const pending = enforceChatAdmission(req, res);
    const rejected = expect(pending).rejects.toMatchObject({ statusCode: 503 });
    await vi.advanceTimersByTimeAsync(0);
    expect(blobPut).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3_000);
    await rejected;
    finishWrite();
    await vi.advanceTimersByTimeAsync(0);
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles caller cancellation promptly even while the SDK ignores its signal", async () => {
    vi.useFakeTimers();
    const { req, res } = deployedAdmission();
    blobGet.mockImplementation(() => new Promise(() => {}));
    const incoming = new AbortController();
    const pending = enforceChatAdmission(req, res, { signal: incoming.signal });
    const rejected = expect(pending).rejects.toMatchObject({ statusCode: 503 });
    incoming.abort(new DOMException("Caller deadline", "TimeoutError"));
    await rejected;
    expect(blobGet.mock.calls[0][1].abortSignal.reason.name).toBe("AbortError");
    expect(getEventListeners(incoming.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(blobPut).not.toHaveBeenCalled();
  });

  it("cleans up deadline and cancellation listeners after successful admission", async () => {
    vi.useFakeTimers();
    const { req, res } = deployedAdmission();
    blobGet.mockResolvedValue(null);
    blobPut.mockResolvedValue({});
    const incoming = new AbortController();
    expect(await enforceChatAdmission(req, res, { signal: incoming.signal })).toBe(true);
    expect(res.setHeader).toHaveBeenCalledWith("RateLimit-Remaining", "7");
    expect(getEventListeners(incoming.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3_001);
    expect(blobPut.mock.calls[0][2].abortSignal.aborted).toBe(false);
  });

  it("enforces the client quota across independent callers without storing addresses", async () => {
    const store = memoryStore();
    for (let i = 0; i < 8; i++) expect((await request(store)).allowed).toBe(true);
    expect(await request(store)).toMatchObject({ allowed: false, scope: "client", remaining: 0 });
    expect(store.write).toHaveBeenCalledTimes(8);
    const state = (await store.read(path)).value;
    expect(state.dailyCount).toBe(8);
    expect(JSON.stringify(state)).not.toContain("192.0.2.1");
    expect(Object.keys(state.clients)[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("atomically reserves all quotas when multiple instances race at the last slot", async () => {
    const store = memoryStore();
    const limits = { client: 8, window: 2, day: 3 };
    await request(store, { limits });
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => request(store, { client: `client-${i}`, limits })));
    expect(results.filter(result => result.allowed)).toHaveLength(1);
    expect((await store.read(path)).value).toMatchObject({ dailyCount: 2, windowCount: 2 });
  });

  it("retains the daily ceiling while expiring the ten-minute and client buckets", async () => {
    const store = memoryStore();
    const limits = { client: 1, window: 1, day: 2 };
    await request(store, { limits });
    expect((await request(store, { limits, now: () => day + 11 * minute })).allowed).toBe(true);
    const state = (await store.read(path)).value;
    expect(Object.keys(state.clients)).toHaveLength(1);
    expect(await request(store, { limits, now: () => day + 21 * minute })).toMatchObject({ allowed: false, scope: "day", resetAt: 2 * day });
    expect((await request(store, { limits, now: () => 2 * day })).allowed).toBe(true);
  });

  it("fails closed on corrupt state, storage failure, conflict exhaustion and cancellation", async () => {
    for (const value of [{}, null, false, 0, ""]) {
      await expect(request({ read: async () => ({ value, etag: "1" }) })).rejects.toMatchObject({ statusCode: 503 });
    }
    await expect(request({ read: async () => { throw new Error("offline"); } })).rejects.toThrow("offline");
    const conflicting = { read: vi.fn(async () => null), write: vi.fn(async () => { throw new Error("Precondition failed"); }) };
    await expect(request(conflicting)).rejects.toMatchObject({ statusCode: 503 });
    expect(conflicting.write).toHaveBeenCalledTimes(4);
    const store = memoryStore();
    await expect(request(store, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(store.write).not.toHaveBeenCalled();
  });

  it("keeps production and preview client fingerprints separate", async () => {
    const one = memoryStore();
    const two = memoryStore();
    await request(one);
    await request(two, { path: "ask-admission/flockline/v1/preview.json" });
    expect(Object.keys((await one.read(path)).value.clients)).not.toEqual(Object.keys((await two.read(path)).value.clients));
  });

  it("uses private origin reads and conditional writes, rejecting weak versions", async () => {
    vi.stubEnv("ASK_READ_WRITE_TOKEN", "store-private-test");
    const blobGet = vi.fn(async () => ({ statusCode: 200, blob: { etag: '"1"' }, stream: new Response('{"version":1}').body }));
    const blobPut = vi.fn(async () => ({ etag: '"2"' }));
    const signal = new AbortController().signal;
    const store = createChatAdmissionStore(signal, { blobGet, blobPut });
    expect(await store.read(path)).toEqual({ value: { version: 1 }, etag: '"1"' });
    expect(blobGet).toHaveBeenCalledWith(path, expect.objectContaining({ access: "private", token: "store-private-test", useCache: false, abortSignal: signal }));
    await store.write(path, { version: 1 }, '"1"');
    expect(blobPut).toHaveBeenLastCalledWith(path, '{"version":1}', expect.objectContaining({ access: "private", ifMatch: '"1"', allowOverwrite: true }));
    await store.write(path, {}, undefined);
    expect(blobPut.mock.calls.at(-1)[2]).toMatchObject({ allowOverwrite: false });
    blobGet.mockResolvedValue({ statusCode: 200, blob: { etag: 'W/"1"' } });
    await expect(store.read(path)).rejects.toMatchObject({ statusCode: 503 });
  });

  it("does not fall back to an in-memory allowance if deployed configuration is missing", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "test");
    vi.stubEnv("DIGEST_SIGNING_SECRET", "");
    await expect(enforceChatAdmission({}, {})).rejects.toMatchObject({ statusCode: 503 });
  });

  it("trusts only Vercel's forwarding identity in deployment and the socket locally", () => {
    const req = { headers: { "x-vercel-forwarded-for": "192.0.2.10", "x-forwarded-for": "192.0.2.20" }, socket: { remoteAddress: "127.0.0.1" } };
    vi.stubEnv("VERCEL", "");
    expect(chatClientAddress(req)).toBe("127.0.0.1");
    vi.stubEnv("VERCEL", "1");
    expect(chatClientAddress(req)).toBe("192.0.2.10");
    expect(chatClientAddress({ headers: { "x-forwarded-for": "invalid" } })).toBe("unknown");
  });
});
