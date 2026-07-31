import { describe, expect, it } from "vitest";
import { buildAppUrl, parseAppState, type AppState } from "./appState";
import { US_REGION_PRESETS, US_STATES } from "../shared/usGeography.js";

const regions = US_STATES.map((state) => state.code);
const northeast = US_REGION_PRESETS.find((region) => region.id === "northeast")?.stateCodes ?? [];

describe("parseAppState", () => {
  it("parses and validates a shared map URL", () => {
    expect(
      parseAppState(
        "?bird=baleag&days=14&states=US-ME,US-CT,NOPE&mode=new&provisional=0&hotspots=1",
        regions,
        US_REGION_PRESETS
      )
    ).toEqual({
      speciesCode: "baleag",
      lookbackDays: 14,
      regions: ["US-ME", "US-CT"],
      timelineMode: "daily",
      includeProvisional: false,
      hotspotsOnly: true
    });
  });

  it("preserves the browse state and clamps the window", () => {
    expect(parseAppState("?bird=browse&days=90", regions, US_REGION_PRESETS)).toMatchObject({
      speciesCode: null,
      lookbackDays: 30
    });
  });

  it("expands a compact Census-region URL", () => {
    expect(parseAppState("?bird=osprey&region=west", regions, US_REGION_PRESETS)).toMatchObject({
      speciesCode: "osprey",
      regions: US_REGION_PRESETS.find((region) => region.id === "west")?.stateCodes
    });
  });

  it("expands a compact Nationwide URL", () => {
    expect(parseAppState("?bird=osprey&region=nationwide", regions, US_REGION_PRESETS)).toMatchObject({
      speciesCode: "osprey",
      regions
    });
  });
});

describe("buildAppUrl", () => {
  it("produces a compact, durable URL", () => {
    const state: AppState = {
      speciesCode: "osprey",
      lookbackDays: 7,
      regions: northeast,
      timelineMode: "cumulative",
      includeProvisional: true,
      hotspotsOnly: false
    };
    expect(buildAppUrl("https://flockline.vercel.app/?old=1#methodology", state, regions, US_REGION_PRESETS)).toBe(
      "https://flockline.vercel.app/?bird=osprey"
    );
  });

  it("serializes non-default filters", () => {
    const state: AppState = {
      speciesCode: null,
      lookbackDays: 21,
      regions: ["US-MA", "US-CT"],
      timelineMode: "daily",
      includeProvisional: false,
      hotspotsOnly: true
    };
    expect(buildAppUrl("https://example.com", state, regions, US_REGION_PRESETS)).toContain(
      "bird=browse&days=21&states=US-MA%2CUS-CT&mode=new&provisional=0&hotspots=1"
    );
  });

  it("serializes complete non-default regions compactly", () => {
    const west = US_REGION_PRESETS.find((region) => region.id === "west")?.stateCodes ?? [];
    const state: AppState = {
      speciesCode: "annhum",
      lookbackDays: 7,
      regions: west,
      timelineMode: "cumulative",
      includeProvisional: true,
      hotspotsOnly: false
    };
    expect(buildAppUrl("https://example.com", state, regions, US_REGION_PRESETS)).toBe(
      "https://example.com/?bird=annhum&region=west"
    );
  });

  it("serializes the Nationwide preset compactly", () => {
    const state: AppState = {
      speciesCode: "osprey",
      lookbackDays: 7,
      regions,
      timelineMode: "cumulative",
      includeProvisional: true,
      hotspotsOnly: false
    };
    expect(buildAppUrl("https://example.com", state, regions, US_REGION_PRESETS)).toBe(
      "https://example.com/?bird=osprey&region=nationwide"
    );
  });
});
