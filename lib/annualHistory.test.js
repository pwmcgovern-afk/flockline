import { describe, expect, it } from "vitest";
import { importAnnualHistory } from "./annualHistoryImport.js";
import { withAnnualHistory } from "./annualHistory.js";
import { getHistoricalBaseline } from "./historicalBaseline.js";

const bins = (value) => Array(48).fill(value);
const pooled = {
  methodVersion: "ebird-barchart-48-v1", datasetVersion: "pooled", taxonomyVersion: "2025",
  area: { code: "US-NY-061" }, years: { start: 2024, end: 2025 }, sampleSizes: bins(20),
  species: { sora: { comName: "Sora" }, redcro: { comName: "Red Crossbill" } },
};
function input(year, frequencies = bins(0.1), samples = bins(10)) {
  return { year, downloadedAt: "2026-10-14",
    sourceUrl: `https://ebird.org/barchart?byr=${year}&eyr=${year}&bmo=1&emo=12&r=US-NY-061`,
    text: `Number of taxa: 2\nSample Size:\t${samples.join("\t")}\nSora\t${frequencies.join("\t")}\nRed Crossbill (Type 1)\t${bins(0.1).join("\t")}\n` };
}
const baseline = { status: "available", methodVersion: "ebird-barchart-48-v1", datasetVersion: "pooled", taxonomyVersion: "2025",
  area: pooled.area, years: pooled.years, season: { month: 10, startDay: 8 }, speciesCode: "sora" };

describe("annual source import and exact edition join", () => {
  it("preserves values and source hashes, sorts years, and never manufactures a missing parent", () => {
    const data = importAnnualHistory(pooled, [input(2025), input(2024)]);
    expect(data.years.map((entry) => entry.year)).toEqual([2024, 2025]);
    expect(data.years[0].source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(data.years[0].species).toEqual({ sora: bins(0.1) });
    expect(withAnnualHistory(baseline, [data]).annualHistory).toMatchObject({ reportedYears: 2, zeroYears: 0, unknownYears: 0 });
    expect(baseline).not.toHaveProperty("annualHistory");
  });

  it.each([
    ["missing year", () => [input(2024)]],
    ["duplicate year", () => [input(2024), input(2024)]],
    ["future year", () => [input(2024), input(2026)]],
    ["wrong county", () => [input(2024), { ...input(2025), sourceUrl: input(2025).sourceUrl.replace("061", "081") }]],
    ["pooled annual URL", () => [input(2024), { ...input(2025), sourceUrl: input(2025).sourceUrl.replace("byr=2025", "byr=2024") }]],
    ["invalid date", () => [input(2024), { ...input(2025), downloadedAt: "2026-02-30" }]],
    ["unfinished year", () => [input(2024), { ...input(2025), downloadedAt: "2025-12-31" }]],
    ["different sample", () => [input(2024), input(2025, bins(0.1), bins(11))]],
    ["missing sample", () => [input(2024), input(2025, bins(0.1), bins("NA"))]],
  ])("rejects %s rather than silently mixing source editions", (_label, inputs) => {
    expect(() => importAnnualHistory(pooled, inputs())).toThrow();
  });

  it("does not attach evidence from a different edition, county, taxonomy or year window", () => {
    const data = importAnnualHistory(pooled, [input(2024), input(2025)]);
    for (const change of [ { datasetVersion: "old" }, { area: { code: "US-CA-075" } },
      { taxonomyVersion: "2024" }, { years: { start: 2016, end: 2025 } }, { season: undefined },
      { season: { month: 10, startDay: 9 } }, { methodVersion: "different-method" } ]) {
      const original = { ...baseline, ...change };
      expect(withAnnualHistory(original, [data])).toBe(original);
    }
    const published = { ...baseline, annualHistory: { datasetVersion: "published-annual" } };
    expect(withAnnualHistory(published, [data])).toBe(published);
  });

  it("distinguishes zero, missing frequency, missing row, zero sample and occurrence markers", () => {
    const data = importAnnualHistory(pooled, [input(2024, bins(0)), input(2025, bins(0.0015))]);
    expect(withAnnualHistory(baseline, [data]).annualHistory).toMatchObject({ reportedYears: 1, zeroYears: 1, unknownYears: 0,
      entries: [{ status: "zero" }, { status: "occurrence" }] });
    for (const frequency of [null, undefined, NaN, -1, 2]) {
      data.years[0].species.sora[37] = frequency;
      expect(withAnnualHistory(baseline, [data]).annualHistory.unknownYears).toBe(1);
    }
    delete data.years[0].species.sora;
    expect(withAnnualHistory(baseline, [data]).annualHistory.unknownYears).toBe(1);
    data.years[1].sampleSizes[37] = 0;
    expect(withAnnualHistory(baseline, [data]).annualHistory.unknownYears).toBe(2);
  });

  it("requires all four zeros for a monthly zero, but one documented occurrence establishes monthly reporting", () => {
    const data = importAnnualHistory(pooled, [input(2024, bins(0)), input(2025, bins(0))]);
    data.years[0].species.sora[36] = null;
    data.years[1].species.sora[39] = 0.0015;
    const history = withAnnualHistory(baseline, [data]).annualHistory;
    expect(history).toMatchObject({ zeroYears: 2, month: { label: "October (whole month)",
      reportedYears: 1, zeroYears: 0, unknownYears: 1, entries: [{ checklistCount: 40, status: "unknown" }, { checklistCount: 40, status: "occurrence" }] } });
    data.years[0].species.sora[38] = 0.1;
    expect(withAnnualHistory(baseline, [data]).annualHistory.month.reportedYears).toBe(2);
    data.years[0].sampleSizes[36] = null;
    expect(withAnnualHistory(baseline, [data]).annualHistory.month.entries[0]).toMatchObject({ status: "reported", checklistCount: null });
    expect(withAnnualHistory(baseline, [data]).annualHistory.entries[0].checklistCount).toBe(10);
  });
});

describe("verified Manhattan annual anchors", () => {
  const finding = { countyCode: "US-NY-061", obsDt: "2026-10-14" };
  it.each([["sora", 1, 5, 4], ["nstspa", 9, 1, 0], ["rebnut", 10, 0, 0]])(
    "%s preserves the October 8-14 source evidence", (speciesCode, reportedYears, zeroYears, unknownYears) => {
      const history = getHistoricalBaseline({ ...finding, speciesCode }).annualHistory;
      expect(history).toMatchObject({ reportedYears, zeroYears, unknownYears });
      expect(history.entries.map((entry) => entry.year)).toEqual([2016,2017,2018,2019,2020,2021,2022,2023,2024,2025]);
      expect(history.entries.reduce((n, entry) => n + entry.checklistCount, 0)).toBe(5306);
    });
  it("preserves Sora's unknown years and changes the evidence with the seasonal period", () => {
    const baseline = getHistoricalBaseline({ ...finding, speciesCode: "sora" });
    expect(baseline.annualHistory.entries.filter((entry) => entry.status === "unknown").map((entry) => entry.year)).toEqual([2016,2017,2021,2023]);
    expect(getHistoricalBaseline({ ...finding, obsDt: "2026-10-01", speciesCode: "sora" }).annualHistory.entries).not.toEqual(baseline.annualHistory.entries);
    expect(getHistoricalBaseline({ ...finding, obsDt: "2025-10-14", speciesCode: "sora" }).status).toBe("unavailable");
    expect(getHistoricalBaseline({ ...finding, countyCode: "US-CA-001", speciesCode: "sora" })).not.toHaveProperty("annualHistory");
  });
});

describe("Suffolk County source and seasonal context", () => {
  it("keeps exact-period and whole-month recurrence distinct for the original Nelson's Sparrow example", () => {
    const result = getHistoricalBaseline({ countyCode: "US-MA-025", speciesCode: "nstspa", obsDt: "2026-10-12" });
    expect(result).toMatchObject({ status: "available", frequency: 0.008025, checklistCount: 2243,
      area: { name: "Suffolk County, Massachusetts" }, annualHistory: { methodVersion: "ebird-annual-occurrence-v2",
        reportedYears: 6, zeroYears: 4, unknownYears: 0,
        month: { label: "October (whole month)", reportedYears: 10, zeroYears: 0, unknownYears: 0 } } });
    expect(result.annualHistory.entries.find((entry) => entry.year === 2024).status).toBe("occurrence");
    expect(result.annualHistory.month.entries.every((entry) => entry.status === "reported")).toBe(true);
    expect(result.annualHistory.entries[0]).toMatchObject({ year: 2016, checklistCount: 95, status: "zero" });
    expect(result.annualHistory.month.entries[0]).toMatchObject({ year: 2016, checklistCount: 399, status: "reported" });
    expect(result.sourceUrl).toContain("r=US-MA-025");
    expect(getHistoricalBaseline({ countyCode: "US-MA-017", speciesCode: "nstspa", obsDt: "2026-10-12" }).reason).toBe("county_not_covered");
  });
});


describe("verified western annual anchors", () => {
  it.each([
    ["US-CA-075", "redcro", 0.0028482, 3511, 5, 9],
    ["US-CA-075", "rebnut", 0.0786101, 3511, 9, 10],
    ["US-CA-081", "redcro", 0.0051625, 3293, 6, 9],
    ["US-CA-081", "rebnut", 0.0367446, 3293, 7, 10],
  ])("%s %s retains its own county and both October scopes", (countyCode, speciesCode, frequency, checklistCount, periodYears, monthYears) => {
    const value = getHistoricalBaseline({ countyCode, speciesCode, obsDt: "2026-10-12" });
    expect(value).toMatchObject({ status: "available", frequency, checklistCount,
      annualHistory: { reportedYears: periodYears, zeroYears: 10 - periodYears, unknownYears: 0,
        month: { reportedYears: monthYears, zeroYears: 10 - monthYears, unknownYears: 0 } } });
    expect(value.annualHistory.entries.reduce((n, entry) => n + entry.checklistCount, 0)).toBe(checklistCount);
    for (const evidence of [value.annualHistory, value.annualHistory.month]) {
      expect(evidence.entries.map((entry) => entry.year)).toEqual([2016,2017,2018,2019,2020,2021,2022,2023,2024,2025]);
      for (const entry of evidence.entries) expect(new URL(entry.sourceUrl).searchParams.get("r")).toBe(countyCode);
    }
  });

  it("retains the San Mateo 2018 nuthatch occurrence marker in the monthly evidence", () => {
    const value = getHistoricalBaseline({ countyCode: "US-CA-081", speciesCode: "rebnut", obsDt: "2026-10-12" });
    expect(value.annualHistory.entries.find((entry) => entry.year === 2018)).toMatchObject({ status: "zero", checklistCount: 223 });
    expect(value.annualHistory.month.entries.find((entry) => entry.year === 2018)).toMatchObject({ status: "occurrence", checklistCount: 892 });
  });
});
