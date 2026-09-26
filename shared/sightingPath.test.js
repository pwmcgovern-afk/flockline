import { describe, it, expect } from "vitest";
import { sightingPath, parseSightingPath } from "./sightingPath.js";
describe("sighting addresses", () => {
  it("uses permanent source identifiers and rejects demo or malformed records", () => {
    expect(sightingPath({ subId: "S394925341", speciesCode: "corplo" })).toBe(
      "/sightings/S394925341/corplo",
    );
    for (const subId of ["SDEMO1", "../checklist", "S1", "S394925341?q=x"])
      expect(sightingPath({ subId, speciesCode: "corplo" })).toBeNull();
    expect(
      sightingPath({ subId: "S394925341", speciesCode: "<script>" }),
    ).toBeNull();
    expect(parseSightingPath("/sightings/S394925341/corplo/")).toEqual({
      subId: "S394925341",
      speciesCode: "corplo",
    });
    expect(parseSightingPath("/sightings/S394925341/corplo/extra")).toBeNull();
  });
});
