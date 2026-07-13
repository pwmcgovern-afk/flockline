import { describe, expect, it } from "vitest";
import { buildAppUrl, parseAppState, type AppState } from "./appState";

const regions = ["US-ME", "US-NH", "US-VT", "US-MA", "US-RI", "US-CT"];

describe("parseAppState", () => {
  it("parses and validates a shared map URL", () => {
    expect(
      parseAppState(
        "?bird=baleag&days=14&states=US-ME,US-CT,NOPE&mode=new&provisional=0&hotspots=1",
        regions
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
    expect(parseAppState("?bird=browse&days=90", regions)).toMatchObject({
      speciesCode: null,
      lookbackDays: 30
    });
  });
});

describe("buildAppUrl", () => {
  it("produces a compact, durable URL", () => {
    const state: AppState = {
      speciesCode: "osprey",
      lookbackDays: 7,
      regions,
      timelineMode: "cumulative",
      includeProvisional: true,
      hotspotsOnly: false
    };
    expect(buildAppUrl("https://flockline.vercel.app/?old=1#methodology", state, regions)).toBe(
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
    expect(buildAppUrl("https://example.com", state, regions)).toContain(
      "bird=browse&days=21&states=US-MA%2CUS-CT&mode=new&provisional=0&hotspots=1"
    );
  });
});
