import { describe, expect, it } from "vitest";
import { baselineSeason, getHistoricalBaseline } from "./historicalBaseline.js";

function fixtureDataset() {
  return {
    area: { type: "county", code: "US-CA-075", name: "San Francisco County, California" },
    years: { start: 2016, end: 2025 },
    source: { url: "https://ebird.org/barchart?r=US-CA-075", attribution: "eBird and its contributors", termsUrl: "https://www.birds.cornell.edu/home/ebird-data-access-terms-of-use/", downloadedAt: "2026-10-14" },
    datasetVersion: "fixture", methodVersion: "ebird-barchart-48-v1", taxonomyVersion: "2025",
    sampleSizes: Array(48).fill(10),
    species: { redcro: { comName: "Red Crossbill", frequencies: Array(48).fill(0.1) } },
    taxonAliases: { redcro11: "redcro" },
  };
}
const finding = { countyCode: "US-CA-075", speciesCode: "redcro", obsDt: "2026-10-14 07:45" };

describe("historical county and season lookup", () => {
  it.each([
    ["2026-01-01", 0, 1, 7], ["2026-01-07", 0, 1, 7],
    ["2026-01-08", 1, 8, 14], ["2026-01-14", 1, 8, 14],
    ["2026-01-15", 2, 15, 21], ["2026-01-21", 2, 15, 21],
    ["2026-01-22", 3, 22, 31], ["2026-01-31", 3, 22, 31],
    ["2026-02-28", 7, 22, 28], ["2028-02-29", 7, 22, 29],
    ["2026-12-31", 47, 22, 31],
  ])("uses eBird's four monthly bins for %s", (date, index, startDay, endDay) => {
    expect(baselineSeason(date)).toMatchObject({ index, startDay, endDay });
  });

  it("uses the source's calendar day without timezone shifts", () => {
    expect(baselineSeason("2026-10-14T23:50:00-07:00")).toMatchObject({ index: 37, label: "October 8-14" });
    expect(baselineSeason("2026-02-29")).toBeNull();
    expect(baselineSeason("2026-13-01")).toBeNull();
    expect(baselineSeason("not a date")).toBeNull();
  });

  it("returns small-sample descriptive facts without inferred recurrence, confidence or rarity", () => {
    const result = getHistoricalBaseline(finding, [fixtureDataset()]);
    expect(result).toMatchObject({ status: "available", frequency: 0.1, checklistCount: 10, confidence: null, annualRecurrence: null, coverage: { pooledYears: true, yearsRepresented: null } });
    expect(result).not.toHaveProperty("rarity");
    expect(result).not.toHaveProperty("detectionCount");
    expect(result).not.toHaveProperty("countAnomaly");
  });

  it("maps a subspecies report to an explicitly identified parent baseline", () => {
    expect(getHistoricalBaseline({ ...finding, speciesCode: "redcro11" }, [fixtureDataset()])).toMatchObject({ status: "available", speciesCode: "redcro", comName: "Red Crossbill", frequency: 0.1 });
  });

  it.each([
    [{ countyCode: undefined }, "county_missing"],
    [{ countyCode: "US-CA-001" }, "county_not_covered"],
    [{ obsDt: "invalid" }, "date_invalid"],
    [{ obsDt: "2025-10-14" }, "baseline_not_prior"],
    [{ speciesCode: "not-in-export" }, "species_not_covered"],
    [{ speciesCode: "__proto__" }, "species_not_covered"],
  ])("keeps missing or ineligible coverage unavailable: %j", (changes, reason) => {
    expect(getHistoricalBaseline({ ...finding, ...changes }, [fixtureDataset()])).toEqual({ status: "unavailable", reason, confidence: null, annualRecurrence: null });
  });

  it("distinguishes missing frequencies and sample sizes from a reported zero", () => {
    const dataset = fixtureDataset();
    dataset.species.redcro.frequencies[37] = 0;
    expect(getHistoricalBaseline(finding, [dataset])).toMatchObject({ status: "available", frequency: 0 });
    dataset.species.redcro.frequencies[37] = null;
    expect(getHistoricalBaseline(finding, [dataset])).toMatchObject({ status: "unavailable", reason: "frequency_unavailable" });
    dataset.species.redcro.frequencies[37] = 0;
    for (const size of [0, null, 0.5]) {
      dataset.sampleSizes[37] = size;
      expect(getHistoricalBaseline(finding, [dataset])).toMatchObject({ status: "unavailable", reason: "sample_unavailable" });
    }
  });

  it("withholds the histogram's ambiguous occurrence value without changing the export", () => {
    const dataset = fixtureDataset();
    dataset.species.redcro.frequencies[37] = 0.0015;
    expect(getHistoricalBaseline(finding, [dataset])).toMatchObject({
      status: "unavailable", reason: "frequency_ambiguous", sourceUrl: dataset.source.url,
    });
    expect(dataset.species.redcro.frequencies[37]).toBe(0.0015);
    dataset.species.redcro.frequencies[37] = 0.0014999;
    expect(getHistoricalBaseline(finding, [dataset])).toMatchObject({ status: "available", frequency: 0.0014999 });
    dataset.species.redcro.frequencies[37] = 0.0015;
    dataset.methodVersion = "complete-checklist-counts-v1";
    expect(getHistoricalBaseline(finding, [dataset])).toMatchObject({ status: "available", frequency: 0.0015 });
  });

  it("chooses the latest eligible prior edition without a future edition shadowing it", () => {
    const older = fixtureDataset();
    older.years = { start: 2015, end: 2024 };
    older.datasetVersion = "older";
    const current = fixtureDataset();
    const future = fixtureDataset();
    future.years = { start: 2017, end: 2026 };
    future.datasetVersion = "future";
    const registry = [older, future, current];
    expect(getHistoricalBaseline(finding, registry)).toMatchObject({ datasetVersion: "fixture", years: { start: 2016, end: 2025 } });
    expect(registry.map((entry) => entry.datasetVersion)).toEqual(["older", "future", "fixture"]);
    expect(getHistoricalBaseline({ ...finding, obsDt: "2025-10-14" }, registry)).toMatchObject({ datasetVersion: "older" });
  });
});

describe("bundled county pilots", () => {
  it("preserves the verified October 8-14 source frequency, denominator and attribution", () => {
    expect(getHistoricalBaseline(finding)).toMatchObject({
      status: "available", frequency: 0.0028482, checklistCount: 3511,
      area: { code: "US-CA-075", name: "San Francisco County, California" },
      season: { label: "October 8-14" }, years: { start: 2016, end: 2025 },
      sourceUrl: "https://ebird.org/barchart?byr=2016&eyr=2025&bmo=1&emo=12&r=US-CA-075",
      sourceAttribution: "eBird and its contributors, Cornell Lab of Ornithology", downloadedAt: "2026-10-14",
      confidence: null, annualRecurrence: null,
    });
    expect(getHistoricalBaseline({ ...finding, speciesCode: "rebnut" })).toMatchObject({ frequency: 0.0786101, checklistCount: 3511 });
  });

  it("serves official parent aliases without extending coverage to other counties", () => {
    for (const speciesCode of ["redcro2", "redcro11"]) {
      expect(getHistoricalBaseline({ ...finding, speciesCode })).toMatchObject({ status: "available", speciesCode: "redcro", comName: "Red Crossbill", frequency: 0.0028482 });
    }
    expect(getHistoricalBaseline({ ...finding, countyCode: "US-CA-001" })).toMatchObject({ status: "unavailable", reason: "county_not_covered" });
  });

  it.each([
    ["US-NY-061", "New York County, New York", "sora", 0.0049001, 5306],
    ["US-CA-081", "San Mateo County, California", "redcro2", 0.0051625, 3293],
  ])("uses the verified %s export for local seasonal context", (countyCode, name, speciesCode, frequency, checklistCount) => {
    expect(getHistoricalBaseline({ ...finding, countyCode, speciesCode })).toMatchObject({
      status: "available", frequency, checklistCount,
      area: { code: countyCode, name }, season: { label: "October 8-14" },
      years: { start: 2016, end: 2025 },
      sourceUrl: `https://ebird.org/barchart?byr=2016&eyr=2025&bmo=1&emo=12&r=${countyCode}`,
      sourceAttribution: "eBird and its contributors, Cornell Lab of Ornithology",
      downloadedAt: "2026-10-14", annualRecurrence: null, confidence: null,
    });
  });
});
