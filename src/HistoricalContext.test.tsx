import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HistoricalContext from "./HistoricalContext";
import type { AvailableHistoricalBaseline } from "../lib/historicalBaseline.js";

const baseline: AvailableHistoricalBaseline = {
  status: "available", speciesCode: "bargoo", comName: "Barnacle Goose",
  area: { type: "county", code: "US-NY-061", name: "New York County, New York" },
  season: { month: 12, startDay: 1, endDay: 7, label: "December 1-7" },
  years: { start: 2016, end: 2025 }, frequency: 0.0015, checklistCount: 2932,
  sourceUrl: "https://ebird.org/barchart?r=US-NY-061&byr=2016&eyr=2025&bmo=1&emo=12",
  sourceAttribution: "eBird and its contributors, Cornell Lab of Ornithology",
  termsUrl: "https://www.birds.cornell.edu/home/ebird-data-access-terms-of-use/",
  downloadedAt: "2026-10-14", datasetVersion: "source-fixture", methodVersion: "ebird-barchart-48-v1",
  taxonomyVersion: "2025", annualRecurrence: null, confidence: null,
  coverage: { scope: "county", yearsRepresented: null, pooledYears: true },
};

describe("historical percentage interpretation", () => {
  it("corrects a saved available snapshot at the display boundary and retains its historical source", () => {
    const html = renderToStaticMarkup(<HistoricalContext finding={{ countyCode: "US-NY-061", historicalBaseline: baseline }} />);
    expect(html).toContain("does not establish an exact complete-checklist percentage");
    expect(html).not.toContain("0.15%");
    expect(html).toContain("byr=2016&amp;eyr=2025");
    expect(html).toContain("Why this percentage is withheld");
    expect(baseline.frequency).toBe(0.0015);
    expect(baseline.status).toBe("available");
  });

  it.each([[0, "0%"], [0.0049001, "0.49%"]])("preserves unambiguous frequency %s", (frequency, expected) => {
    const html = renderToStaticMarkup(<HistoricalContext finding={{ historicalBaseline: { ...baseline, frequency } }} />);
    expect(html).toContain(expected);
    expect(html).toContain("complete eBird checklists reported");
    expect(html).not.toContain("percentage is withheld");
  });
});
