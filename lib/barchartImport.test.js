import { describe, expect, it } from "vitest";
import { importBarchartBaseline, parseBarchartExport } from "./barchartImport.js";

const bins = (value) => Array(48).fill(value);
function exportText(rows = [["Red Crossbill", bins("0.0028482")]], samples = bins("3511.0")) {
  return `\uFEFFFrequency of observations in the selected location(s).:\r\nNumber of taxa: \t${rows.length}\r\n\r\nSample Size:\t${samples.join("\t")}\t\r\n\r\n${rows.map(([name, values]) => `${name}\t${values.join("\t")}\t`).join("\r\n")}\r\n`;
}

const metadata = {
  countyCode: "US-CA-075",
  countyName: "San Francisco County, California",
  startYear: 2016,
  endYear: 2025,
  downloadedAt: "2026-10-14",
  taxonomyVersion: "2025",
  taxonomySourceUrl: "https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json&locale=en&cat=species,issf,form&version=2025",
  sourceUrl: "https://ebird.org/barchart?byr=2016&eyr=2025&bmo=1&emo=12&r=US-CA-075",
};
const taxonomy = [
  { speciesCode: "redcro", comName: "Red Crossbill", category: "species" },
  { speciesCode: "redcro11", comName: "Red Crossbill (Type 1)", category: "issf", reportAs: "redcro" },
  { speciesCode: "whwcro", comName: "White-winged Crossbill", category: "species" },
  { speciesCode: "whwcro1", comName: "White-winged Crossbill (White-winged)", category: "issf", reportAs: "whwcro" },
];

describe("eBird histogram import", () => {
  it("parses all 48 source values without rounding or reconstructing detected-checklist counts", () => {
    const frequencies = bins("0.0028482");
    frequencies[0] = "2.848E-4";
    frequencies[1] = "0.0";
    frequencies[2] = "";
    frequencies[3] = "NA";
    const { sampleSizes, taxa } = parseBarchartExport(exportText([["Red Crossbill", frequencies]]));
    expect(sampleSizes).toEqual(bins(3511));
    expect(taxa[0].frequencies).toHaveLength(48);
    expect(taxa[0].frequencies.slice(0, 5)).toEqual([0.0002848, 0, null, null, 0.0028482]);
    expect(taxa[0]).not.toHaveProperty("detectionCount");
  });

  it("uses exact species rows and official parent aliases without summing subspecies", () => {
    const text = exportText([
      ["Red Crossbill", bins("0.1")],
      ["Red Crossbill (Type 1)", bins("0.04")],
      ["Red/White-winged Crossbill", bins("0.2")],
    ]);
    const result = importBarchartBaseline(text, metadata, taxonomy);
    expect(result.dataset.species).toEqual({ redcro: { comName: "Red Crossbill", frequencies: bins(0.1) } });
    expect(result.dataset.taxonAliases).toEqual({ redcro11: "redcro" });
    expect(result.skippedTaxa).toEqual(["Red Crossbill (Type 1)", "Red/White-winged Crossbill"]);
    expect(result.dataset.coverage).toEqual({ seasonalBins: 48, sourceTaxa: 3, importedSpecies: 1, skippedTaxa: 2, yearsRepresented: null });
    expect(result.dataset.source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.dataset.source).toMatchObject({ url: metadata.sourceUrl, downloadedAt: "2026-10-14" });
    expect(result.dataset.datasetVersion).toContain("taxonomy-2025");
  });

  it("also accepts an export without the optional trailing empty column", () => {
    expect(parseBarchartExport(exportText().replace(/\t\r\n/g, "\r\n")).sampleSizes).toEqual(bins(3511));
  });

  it.each([
    ["negative frequency", [["Red Crossbill", bins("-0.1")]], bins("50")],
    ["frequency greater than one", [["Red Crossbill", bins("1.1")]], bins("50")],
    ["non-number", [["Red Crossbill", bins("bird")]], bins("50")],
    ["hexadecimal", [["Red Crossbill", bins("0x01")]], bins("50")],
    ["missing frequency column", [["Red Crossbill", Array(47).fill("0.1")]], bins("50")],
    ["fractional sample", [["Red Crossbill", bins("0.1")]], bins("50.5")],
    ["extra sample column", [["Red Crossbill", bins("0.1")]], Array(49).fill("50")],
  ])("rejects malformed %s", (_label, rows, samples) => {
    expect(() => parseBarchartExport(exportText(rows, samples))).toThrow();
  });

  it("rejects missing sample rows, incorrect taxon totals and duplicate rows", () => {
    expect(() => parseBarchartExport("Number of taxa: 1")).toThrow("Sample Size");
    expect(() => parseBarchartExport(exportText().replace("Number of taxa: \t1", "Number of taxa: \t2"))).toThrow("Expected 2 taxa");
    expect(() => parseBarchartExport(exportText([["Red Crossbill", bins("0")], ["Red Crossbill", bins("0")]]))).toThrow("Duplicate");
  });

  it.each([
    { countyCode: "US-CA" },
    { startYear: 2026 },
    { downloadedAt: "2025-10-14" },
    { downloadedAt: "2026-02-30" },
    { sourceUrl: "https://example.com/barchart" },
    { sourceUrl: metadata.sourceUrl.replace("US-CA-075", "US-CA-001") },
    { sourceUrl: metadata.sourceUrl.replace("eyr=2025", "eyr=2024") },
    { sourceUrl: metadata.sourceUrl.replace("bmo=1", "bmo=2") },
    { taxonomyVersion: "" },
    { taxonomyVersion: "2024" },
    { taxonomySourceUrl: metadata.taxonomySourceUrl.replace("locale=en", "locale=es") },
  ])("requires valid explicit source scope and provenance: %j", (changes) => {
    expect(() => importBarchartBaseline(exportText(), { ...metadata, ...changes }, taxonomy)).toThrow();
  });

  it("rejects a taxonomy with ambiguous species names or no exact match", () => {
    expect(() => importBarchartBaseline(exportText(), metadata, [...taxonomy, { ...taxonomy[0], speciesCode: "other" }])).toThrow("Ambiguous");
    expect(() => importBarchartBaseline(exportText([["Invented Crossbill", bins("0.1")]]), metadata, taxonomy)).toThrow("No exact species");
  });
});
