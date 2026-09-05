import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "./request";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("bounded UI requests", () => {
  it("returns server validation errors for the caller to display", async () => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Choose a region" }), { status: 400 })));
    const { response, body } = await requestJson<{ error: string }>("/api/test");
    expect(response.status).toBe(400);
    expect(body.error).toBe("Choose a region");
  });

  it("turns a stalled request into a recoverable timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const result = expect(requestJson("/api/test", {}, 100)).rejects.toThrow("took too long");
    await vi.advanceTimersByTimeAsync(100);
    await result;
  });

  it("preserves caller cancellation so superseded results stay silent", async () => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const controller = new AbortController();
    const result = expect(requestJson("/api/test", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await result;
  });
});
