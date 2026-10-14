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
    expect(getHistoricalBaseline({ ...finding, countyCode: "US-CA-075", speciesCode: "sora" })).not.toHaveProperty("annualHistory");
  });
});
