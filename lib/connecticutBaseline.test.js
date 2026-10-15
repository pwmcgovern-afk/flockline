import { describe, expect, it } from "vitest";
import { getHistoricalBaseline } from "./historicalBaseline.js";

// These anchors were reconciled against the original Cornell downloads with
// an independent CSV parser. They protect county identity and source values.
describe("Connecticut source baselines", () => {
  it.each([
    ["001", "Fairfield", 2777, 0.0903853],
    ["003", "Hartford", 2082, 0.0086455],
    ["005", "Litchfield", 1252, 0.0111821],
    ["007", "Middlesex", 714, 0.070028],
    ["009", "New Haven", 3009, 0.1977401],
    ["011", "New London", 1167, 0.108826],
    ["013", "Tolland", 820, 0.0073171],
    ["015", "Windham", 306, 0.0457516],
  ])("uses %s's own October source and ten annual exports", (suffix, name, checklistCount, frequency) => {
    const code = `US-CT-${suffix}`;
    const baseline = getHistoricalBaseline({ countyCode: code, speciesCode: "osprey", obsDt: "2026-10-14" });
    expect(baseline).toMatchObject({ status: "available", frequency, checklistCount,
      area: { code, name: `${name} County, Connecticut` }, years: { start: 2016, end: 2025 },
      sourceUrl: `https://ebird.org/barchart?byr=2016&eyr=2025&bmo=1&emo=12&r=${code}` });
    expect(baseline.annualHistory.entries.map((entry) => entry.year)).toEqual(
      [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
    );
    expect(baseline.annualHistory.entries.reduce((sum, entry) => sum + entry.checklistCount, 0)).toBe(checklistCount);
    expect(baseline.annualHistory.entries.every((entry) => new URL(entry.sourceUrl).searchParams.get("r") === code)).toBe(true);
  });

  it("retains missing crossbill years despite an exported pooled zero", () => {
    const baseline = getHistoricalBaseline({ countyCode: "US-CT-009", speciesCode: "redcro", obsDt: "2026-10-14" });
    expect(baseline).toMatchObject({ status: "available", frequency: 0, checklistCount: 3009,
      annualHistory: { reportedYears: 0, zeroYears: 6, unknownYears: 4,
        month: { reportedYears: 0, zeroYears: 6, unknownYears: 4 } } });
    expect(baseline).not.toHaveProperty("rarity");
  });
});
