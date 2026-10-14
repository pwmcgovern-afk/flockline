import fs from "node:fs";

const registry = JSON.parse(fs.readFileSync(new URL("../data/annual-history.json", import.meta.url), "utf8"));

export function withAnnualHistory(baseline, datasets = registry) {
  if (baseline?.status !== "available" || baseline.annualHistory || baseline.methodVersion !== "ebird-barchart-48-v1") return baseline;
  const dataset = datasets.find((item) => item.pooledDatasetVersion === baseline.datasetVersion
    && item.areaCode === baseline.area?.code && item.taxonomyVersion === baseline.taxonomyVersion
    && item.window.start === baseline.years?.start && item.window.end === baseline.years?.end);
  if (!dataset) return baseline;
  if (!Number.isInteger(baseline.season?.month) || baseline.season.month < 1 || baseline.season.month > 12
      || ![1, 8, 15, 22].includes(baseline.season.startDay)) return baseline;
  const index = (baseline.season.month - 1) * 4 + Math.floor((baseline.season.startDay - 1) / 7);
  if (!Number.isInteger(index) || index < 0 || index >= 48) return baseline;
  const entries = dataset.years.map((entry) => {
    const frequency = Object.hasOwn(entry.species, baseline.speciesCode) ? entry.species[baseline.speciesCode][index] : null;
    const checklistCount = entry.sampleSizes[index];
    let status = "unknown";
    if (Number.isInteger(checklistCount) && checklistCount > 0 && typeof frequency === "number"
        && Number.isFinite(frequency) && frequency >= 0 && frequency <= 1) {
      // Both interpretations of 0.0015 establish occurrence. Neither establishes
      // an exact complete-checklist percentage, so keep it separately labelled.
      status = frequency === 0.0015 ? "occurrence" : frequency > 0 ? "reported" : "zero";
    }
    return { year: entry.year, status, checklistCount,
      sourceUrl: entry.source.url, downloadedAt: entry.source.downloadedAt };
  });
  return { ...baseline, annualHistory: {
    datasetVersion: dataset.datasetVersion, methodVersion: dataset.methodVersion,
    entries,
    reportedYears: entries.filter((entry) => ["reported", "occurrence"].includes(entry.status)).length,
    zeroYears: entries.filter((entry) => entry.status === "zero").length,
    unknownYears: entries.filter((entry) => entry.status === "unknown").length,
  } };
}
