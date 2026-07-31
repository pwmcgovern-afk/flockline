import { describe, expect, it } from "vitest";
import {
  DEFAULT_REGION_ID,
  US_CENSUS_REGIONS,
  US_REGION_PRESETS,
  US_STATES,
  getCensusRegion,
  getRegionPreset,
  matchingCensusRegion,
  matchingRegionPreset,
  statesForRegion
} from "./usGeography.js";

describe("U.S. geography", () => {
  it("covers all 50 states and Washington, D.C. exactly once", () => {
    expect(US_STATES).toHaveLength(51);
    expect(new Set(US_STATES.map((state) => state.code)).size).toBe(51);
    expect(US_STATES.some((state) => state.code === "US-DC")).toBe(true);

    const grouped = US_CENSUS_REGIONS.flatMap((region) => region.stateCodes);
    expect(grouped).toHaveLength(51);
    expect(new Set(grouped).size).toBe(51);
    expect(new Set(grouped)).toEqual(new Set(US_STATES.map((state) => state.code)));
  });

  it("uses the existing nine-state Northeast as the default region", () => {
    const northeast = getCensusRegion(DEFAULT_REGION_ID);
    expect(northeast?.stateCodes).toEqual([
      "US-ME", "US-NH", "US-VT", "US-MA", "US-RI", "US-CT", "US-NY", "US-NJ", "US-PA"
    ]);
    expect(statesForRegion("northeast").map((state) => state.code)).toEqual(northeast?.stateCodes);
  });

  it("recognizes exact region selections and rejects custom subsets", () => {
    const west = getCensusRegion("west");
    expect(matchingCensusRegion([...(west?.stateCodes ?? [])].reverse())?.id).toBe("west");
    expect(matchingCensusRegion(["US-CA", "US-OR"])).toBeNull();
  });

  it("offers all states and Washington, D.C. as a Nationwide preset", () => {
    expect(US_REGION_PRESETS.map((region) => region.id)).toEqual([
      "nationwide", "northeast", "midwest", "south", "west"
    ]);
    expect(getRegionPreset("nationwide")?.stateCodes).toEqual(US_STATES.map((state) => state.code));
    expect(statesForRegion("nationwide")).toHaveLength(51);
    expect(matchingRegionPreset(US_STATES.map((state) => state.code).reverse())?.id).toBe("nationwide");
  });
});
