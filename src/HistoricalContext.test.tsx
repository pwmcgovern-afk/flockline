import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getHistoricalBaseline } from "../lib/historicalBaseline.js";
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


describe("annual reporting evidence", () => {
  it("keeps unknown years visible and provides all ten year-specific sources", () => {
    const value = getHistoricalBaseline({ countyCode: "US-NY-061", speciesCode: "sora", obsDt: "2026-10-14" });
    const html = renderToStaticMarkup(<HistoricalContext finding={{ historicalBaseline: value }} />);
    expect(html).toContain("Reports documented in 1 of 10 years during October 8-14; 4 years have unknown results.");
    expect((html.match(/>Unknown<\/td>/g) || []).length).toBe(4);
    expect((html.match(/>Exported zero<\/td>/g) || []).length).toBe(5);
    expect(html).toContain("byr=2022&amp;eyr=2022");
    expect(html).toContain("does not prove absence");
  });
  it("describes repeated reporting without a rarity or return-probability inference", () => {
    const value = getHistoricalBaseline({ countyCode: "US-NY-061", speciesCode: "nstspa", obsDt: "2026-10-14" });
    const html = renderToStaticMarkup(<HistoricalContext finding={{ historicalBaseline: value }} />);
    expect(html).toContain("Reports in 9 of 10 years during October 8-14.");
    expect(html).not.toContain("90%");
    expect(html).not.toContain("years have unknown results");
  });
});


describe("Suffolk exact-period and monthly context", () => {
  it("shows both scopes explicitly without changing the pooled percentage", () => {
    const value = getHistoricalBaseline({ countyCode: "US-MA-025", speciesCode: "nstspa", obsDt: "2026-10-12" });
    const html = renderToStaticMarkup(<HistoricalContext finding={{ historicalBaseline: value }} />);
    expect(html).toContain("0.8%");
    expect(html).toContain("2,243");
    expect(html).toContain("Reports in 6 of 10 years during October 8-14.");
    expect(html).toContain("October (whole month)");
    expect(html).toContain("reports in 10 of 10 years");
    expect(html).toContain("Occurrence recorded*");
    expect(html).not.toContain("0.15%");
  });
});
