import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { US_STATES } from "../shared/usGeography.js";

const { createMessage, clientOptions } = vi.hoisted(() => ({ createMessage: vi.fn(), clientOptions: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(options) { clientOptions(options); }
    messages = { create: createMessage };
  },
}));

let chatWithBirds;
let getSpeciesSuggestions;
const body = { messages: [{ role: "user", content: "What birds were reported?" }], regions: ["US-CT"] };
const json = (value) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const complete = (text = "Osprey was reported on the source checklist.") => ({
  stop_reason: "end_turn", content: [{ type: "text", text }],
});
const toolTurn = (calls) => ({
  stop_reason: "tool_use", content: [
    { type: "text", text: "Checking the latest source reports." },
    ...calls.map(([name, input], index) => ({ type: "tool_use", id: `tool_${index}`, name, input })),
  ],
});
function stalled(signal) {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-only-key");
  createMessage.mockReset();
  clientOptions.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => json([])));
  ({ chatWithBirds, getSpeciesSuggestions } = await import("./ebirdCore.js"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Ask request budgets", () => {
  it("uses a default 35-second budget and returns a completed answer unchanged", async () => {
    createMessage.mockResolvedValueOnce(complete("A field mark helps identify a bird."));
    const result = await chatWithBirds(body, "ebird-test-key");
    expect(result).toMatchObject({ generator: "llm", reply: "A field mark helps identify a bird." });
    expect(clientOptions).toHaveBeenCalledWith(expect.objectContaining({ timeout: 35000, maxRetries: 0 }));
  });

  it.each([401, "secret-status"])("logs only bounded status and category for provider failures (%s)", async (status) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    createMessage.mockRejectedValueOnce(Object.assign(new Error("Anthropic rejected secret-key and private question text"), { status }));
    await expect(chatWithBirds(body, "ebird-test-key")).rejects.toMatchObject({
      statusCode: 502, message: "The assistant is unavailable right now. Insights and the map still work from live eBird data.",
    });
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({ event: "chat_failed", category: "assistant", status: status === 401 ? 401 : null });
    expect(log.mock.calls[0][0]).not.toContain("secret");
    expect(log.mock.calls[0][0]).not.toContain("private question");
  });

  it("cancels a stalled model before the browser deadline and disables SDK retries", async () => {
    let modelSignal;
    createMessage.mockImplementation((_payload, options) => {
      modelSignal = options.signal;
      return stalled(modelSignal);
    });
    await expect(chatWithBirds(body, "ebird-test-key", { timeoutMs: 25 }))
      .rejects.toMatchObject({ statusCode: 504, message: expect.stringContaining("could not finish in time") });
    expect(modelSignal.aborted).toBe(true);
    expect(clientOptions).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0, timeout: 25 }));
    expect(createMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["search_species", { query: "osprey" }],
    ["species_sightings", { speciesCode: "osprey", regions: ["US-CT", "US-MA", "US-NY", "US-NJ", "US-PA", "US-ME"] }],
    ["notable_sightings", {}],
    ["nearby_sightings", { lat: 41.3, lng: -72.9 }],
    ["region_activity", {}],
    ["show_on_map", { speciesCode: "osprey" }],
  ])("propagates cancellation through %s and stops further model/tool work", async (name, input) => {
    const upstreamSignals = [];
    createMessage.mockResolvedValueOnce(toolTurn([[name, input]]));
    globalThis.fetch.mockImplementation((_url, options) => {
      upstreamSignals.push(options.signal);
      return stalled(options.signal);
    });
    await expect(chatWithBirds(body, "ebird-test-key", { timeoutMs: 30 })).rejects.toMatchObject({ statusCode: 504 });
    expect(upstreamSignals.length).toBeGreaterThan(0);
    expect(upstreamSignals.every((signal) => signal.aborted)).toBe(true);
    expect(createMessage).toHaveBeenCalledTimes(1);
    if (name === "species_sightings") expect(globalThis.fetch).toHaveBeenCalledTimes(5);
  });

  it("uses one budget across model turns instead of resetting it per call", async () => {
    createMessage.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return toolTurn([["unknown_tool", {}]]);
    }).mockImplementationOnce((_payload, options) => stalled(options.signal));
    await expect(chatWithBirds(body, "ebird-test-key", { timeoutMs: 35 })).rejects.toMatchObject({ statusCode: 504 });
    expect(createMessage).toHaveBeenCalledTimes(2);
    expect(createMessage.mock.calls[0][1].signal).toBe(createMessage.mock.calls[1][1].signal);
  });

  it("honors caller cancellation before making a provider request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(chatWithBirds(body, "ebird-test-key", { signal: controller.signal })).rejects.toMatchObject({ statusCode: 504 });
    expect(createMessage).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns an honest fallback after six model rounds and never publishes the tool preamble", async () => {
    createMessage.mockResolvedValue(toolTurn([["region_activity", {}]]));
    const result = await chatWithBirds(body, "ebird-test-key");
    expect(createMessage).toHaveBeenCalledTimes(6);
    expect(globalThis.fetch).toHaveBeenCalledTimes(5);
    expect(result).toMatchObject({ generator: "template", mapAction: null, speciesRefs: [] });
    expect(result.reply).toContain("could not finish checking");
    expect(result.reply).not.toContain("Checking the latest");
  });

  it("rejects an oversized tool batch without running its upstream calls", async () => {
    createMessage.mockResolvedValueOnce(toolTurn(Array.from({ length: 13 }, () => ["search_species", { query: "osprey" }])));
    const result = await chatWithBirds(body, "ebird-test-key");
    expect(result.generator).toBe("template");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(createMessage).toHaveBeenCalledTimes(1);
  });

  it("shares the tool-call allowance across model rounds", async () => {
    createMessage.mockResolvedValue(toolTurn(Array.from({ length: 5 }, () => ["region_activity", {}])));
    const result = await chatWithBirds(body, "ebird-test-key");
    expect(result.generator).toBe("template");
    expect(createMessage).toHaveBeenCalledTimes(3);
    expect(globalThis.fetch).toHaveBeenCalledTimes(10);
  });

  it("does not publish truncated max-token output as a finished answer", async () => {
    createMessage.mockResolvedValueOnce({ stop_reason: "max_tokens", content: [{ type: "text", text: "The most important finding is" }] });
    expect((await chatWithBirds(body, "ebird-test-key")).generator).toBe("template");
  });

  it("bounds standalone taxonomy lookup and falls back to the local species catalog", async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    globalThis.fetch.mockRejectedValueOnce(new DOMException("Taxonomy unavailable", "TimeoutError"));
    const result = await getSpeciesSuggestions("osprey", "ebird-test-key");
    expect(timeout).toHaveBeenCalledWith(6000);
    expect(globalThis.fetch.mock.calls[0][1].signal).toBe(signal);
    expect(result.items.some((item) => item.speciesCode === "osprey")).toBe(true);
  });
});

describe("Ask map coordinates", () => {
  it.each([
    { lat: null, lng: null }, {},
  ])("keeps omitted coordinates absent: %j", async (coordinates) => {
    createMessage.mockResolvedValueOnce(toolTurn([["show_on_map", { speciesCode: "osprey", ...coordinates }]]))
      .mockResolvedValueOnce(complete());
    const result = await chatWithBirds(body, "ebird-test-key");
    expect(result.mapAction).toMatchObject({ lat: null, lng: null, regionCode: null });
  });

  it.each([
    { lat: "41.3", lng: "-72.9" }, { lat: 91, lng: -72.9 },
    { lat: 41.3, lng: -181 }, { lat: 41.3, lng: null },
    { lat: Number.NaN, lng: -72.9 },
  ])("rejects invalid coordinates before source work: %j", async (coordinates) => {
    createMessage.mockResolvedValueOnce(toolTurn([["show_on_map", { speciesCode: "osprey", ...coordinates }]]))
      .mockResolvedValueOnce(complete());
    const result = await chatWithBirds(body, "ebird-test-key");
    expect(result.mapAction).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const toolResult = JSON.parse(createMessage.mock.calls[1][0].messages.at(-1).content[0].content);
    expect(toolResult.error).toContain("valid geographic ranges");
  });

  it("keeps an authoritative source state when a later map call names a different state", async () => {
    globalThis.fetch.mockResolvedValueOnce(json([{
      speciesCode: "osprey", comName: "Osprey", subId: "S123456789", locName: "Source marsh",
      lat: 41.3, lng: -72.9, obsDt: "2026-10-14 09:00",
    }]));
    createMessage.mockResolvedValueOnce(toolTurn([["species_sightings", { speciesCode: "osprey" }]]))
      .mockResolvedValueOnce(toolTurn([["show_on_map", { speciesCode: "osprey", regionCode: "US-NY", lat: 41.3, lng: -72.9 }]]))
      .mockResolvedValueOnce(complete());
    const result = await chatWithBirds(body, "ebird-test-key");
    expect(result.mapAction).toMatchObject({ regionCode: "US-CT", lat: 41.3, lng: -72.9 });
  });

  it("does not automatically move the map when a source report's state is unknown", async () => {
    globalThis.fetch.mockResolvedValueOnce(json([{
      speciesCode: "osprey", comName: "Osprey", subId: "S123456789", locName: "Source marsh",
      lat: 41.3, lng: -72.9, obsDt: "2026-10-14 09:00",
    }]));
    createMessage.mockResolvedValueOnce(toolTurn([["species_sightings", { speciesCode: "osprey" }]]))
      .mockResolvedValueOnce(complete());
    const result = await chatWithBirds({
      messages: [{ role: "user", content: "Show me Osprey on the map." }],
      regions: US_STATES.map((state) => state.code),
    }, "ebird-test-key");
    expect(result.mapAction).toBeNull();
    expect(result.speciesRefs).toEqual([]);
  });

  it.each([
    { lat: null, lng: null }, { lat: "41.3", lng: "-72.9" },
    { lat: 100, lng: -72.9 }, { lat: 41.3, lng: 200 },
  ])("does not turn missing or invalid source coordinates into map focus: %j", async (coordinates) => {
    globalThis.fetch.mockResolvedValueOnce(json([{
      speciesCode: "osprey", comName: "Osprey", subId: "S123456789", locName: "Source marsh",
      obsDt: "2026-10-14 09:00", ...coordinates,
    }]));
    createMessage.mockResolvedValueOnce(toolTurn([["species_sightings", { speciesCode: "osprey" }]]))
      .mockResolvedValueOnce(complete());
    const result = await chatWithBirds({
      ...body, messages: [{ role: "user", content: "Show me Osprey on the map." }],
    }, "ebird-test-key");
    const toolResult = JSON.parse(createMessage.mock.calls[1][0].messages.at(-1).content[0].content);
    const spot = toolResult.topLocations[0];
    expect(spot.lat === null || spot.lng === null).toBe(true);
    expect(result.mapAction).toBeNull();
  });
});
