import { EventEmitter, once } from "node:events";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import configHandler from "../api/config.js";
import insightsHandler from "../api/insights.js";
import roundupHandler from "../api/roundup.js";
import sightingsHandler from "../api/sightings.js";
import checklistHandler from "../api/checklist.js";
import archiveHandler from "../api/roundup-archive.js";

const { chat } = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock("../lib/ebirdCore.js", async (importOriginal) => ({
  ...await importOriginal(), chatWithBirds: chat,
}));

vi.mock("../lib/operationalEvents.js", () => ({ recordOperationalEvent: vi.fn(async () => ({ recorded: true })) }));

let server;
let baseUrl;
beforeEach(async () => {
  vi.stubEnv("EBIRD_API_KEY", "");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
  chat.mockReset();
  const actualFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, options) => {
    if (new URL(String(input)).hostname !== "127.0.0.1") throw new Error("Unexpected external request in local-route test.");
    return actualFetch(input, options);
  });
  server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function productionResponse(handler, path) {
  const url = new URL(path, "https://flockline.app");
  const request = Object.assign(new EventEmitter(), { method: "GET", query: Object.fromEntries(url.searchParams), headers: {} });
  const result = { status: null, headers: new Headers(), body: null };
  const response = {
    setHeader(name, value) { result.headers.set(name, value); },
    status(value) { result.status = value; return this; },
    json(body) { result.body = body; return this; },
  };
  await handler(request, response);
  return result;
}

describe("local and production API parity", () => {
  it.each([
    ["/api/insights?regions=invalid", insightsHandler],
    ["/api/roundup?region=invalid", roundupHandler],
    ["/api/sightings?regions=invalid&species=osprey", sightingsHandler],
    ["/api/checklist?subId=invalid&species=osprey", checklistHandler],
    ["/api/roundup-archive?scope=invalid", archiveHandler],
  ])("preserves validation status and cache headers for %s", async (path, handler) => {
    const production = await productionResponse(handler, path);
    const local = await fetch(`${baseUrl}${path}`);
    expect(production.status).toBe(400);
    expect(local.status).toBe(production.status);
    expect(await local.json()).toEqual(production.body);
    expect(local.headers.get("cache-control")).toBe(production.headers.get("cache-control"));
  });

  it("serves production cache policy and configuration through Express", async () => {
    const production = await productionResponse(configHandler, "/api/config");
    const local = await fetch(`${baseUrl}/api/config`);
    expect(local.status).toBe(200);
    expect(local.headers.get("cache-control")).toBe("s-maxage=60, stale-while-revalidate=300");
    expect(await local.json()).toEqual(production.body);
  });

  it.each(["config", "species", "sightings", "insights", "roundup", "checklist", "sighting", "roundup-archive"])(
    "uses the production method rejection for /api/%s", async (route) => {
      const response = await fetch(`${baseUrl}/api/${route}`, { method: "POST" });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
      expect(await response.json()).toEqual({ error: "Method not allowed." });
    },
  );

  it("preserves the subscription validation route without adding a sending cron", async () => {
    const response = await fetch(`${baseUrl}/api/digest-subscription`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "invalid", regions: ["northeast"] }),
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Enter a valid email address." });
    expect((await fetch(`${baseUrl}/api/cron/weekly-digests?region=northeast`)).status).toBe(404);
  });

  it("uses Ask's production timeout response and rate-limit headers", async () => {
    chat.mockRejectedValue(Object.assign(new Error("The assistant could not finish in time."), { statusCode: 504 }));
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "Where are ospreys?" }] }),
    });
    expect(response.status).toBe(504);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("ratelimit-limit")).toBe("8");
    expect(await response.json()).toEqual({ error: "The assistant could not finish in time." });
    expect(chat.mock.calls[0][2].signal).toBeInstanceOf(AbortSignal);
  });

  it("cancels Ask's work when the real local HTTP client disconnects", async () => {
    let started;
    const called = new Promise(resolve => { started = resolve; });
    let signal;
    chat.mockImplementation((_body, _key, options) => {
      signal = options.signal;
      started();
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const request = http.request(`${baseUrl}/api/chat`, { method: "POST", headers: { "content-type": "application/json" } });
    request.on("error", () => {});
    request.end(JSON.stringify({ messages: [{ role: "user", content: "Where are ospreys?" }] }));
    await called;
    request.destroy();
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    expect(chat).toHaveBeenCalledTimes(1);
  });
});
