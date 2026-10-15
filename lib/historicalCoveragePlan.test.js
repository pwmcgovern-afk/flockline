import { describe, expect, it } from "vitest";
import { createHistoricalCoveragePlan } from "./historicalCoveragePlan.js";

const options = () => ({ startYear: 2024, endYear: 2025, createdAt: "2026-10-15",
  counties: { sourceUrl: "https://api.ebird.org/v2/ref/region/list/subnational2/US?fmt=json", retrievedAt: "2026-10-15",
    regions: [{ code: "US-CT-009", name: "New Haven" }, { code: "US-NY-061", name: "New York" }] },
  states: { sourceUrl: "https://api.ebird.org/v2/ref/region/list/subnational1/US?fmt=json", retrievedAt: "2026-10-15",
    regions: [{ code: "US-CT", name: "Connecticut" }, { code: "US-NY", name: "New York" }] },
  pooled: [{ area: { code: "US-CT-009" }, years: { start: 2024, end: 2025 }, taxonomyVersion: "2025",
    datasetVersion: "fixture", source: { downloadedAt: "2026-10-14" } }],
  annual: [{ areaCode: "US-CT-009", pooledDatasetVersion: "fixture", taxonomyVersion: "2025",
    window: { start: 2024, end: 2025 }, years: [{ year: 2024 }, { year: 2025 }] }],
});

describe("national coverage plan", () => {
  it("counts only matching imported editions and lists every missing source", () => {
    const plan = createHistoricalCoveragePlan(options());
    expect(plan.totals).toEqual({ counties: 2, states: 2, completeCounties: 1, importedExports: 3, missingExports: 3 });
    expect(plan.regions[1].requests.map((r) => [r.kind, r.startYear, r.endYear, r.imported]))
      .toEqual([["pooled", 2024, 2025, false], ["annual", 2024, 2024, false], ["annual", 2025, 2025, false]]);
    expect(plan.regions[1].requests[1].sourceUrl).toBe("https://ebird.org/barchart?byr=2024&eyr=2024&bmo=1&emo=12&r=US-NY-061");
    expect(plan.sources.every((s) => /^[a-f0-9]{64}$/.test(s.regionsSha256))).toBe(true);
  });

  it("does not count another pooled edition's annual sources as complete", () => {
    const input = options(); input.annual[0].pooledDatasetVersion = "old-edition";
    expect(createHistoricalCoveragePlan(input).totals).toMatchObject({ completeCounties: 0, importedExports: 1, missingExports: 5 });
  });

  it("rejects duplicate regions, unknown states and incomplete historical years", () => {
    const input = options(); input.counties.regions.push(input.counties.regions[0]);
    expect(() => createHistoricalCoveragePlan(input)).toThrow("county region");
    const other = options(); other.states.regions = [];
    expect(() => createHistoricalCoveragePlan(other)).toThrow("county region");
    expect(() => createHistoricalCoveragePlan({ ...options(), endYear: 2026 })).toThrow("completed historical years");
  });
});
