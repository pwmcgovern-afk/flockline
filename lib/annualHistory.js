import fs from "node:fs";

const registry = JSON.parse(fs.readFileSync(new URL("../data/annual-history.json", import.meta.url), "utf8"));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function binStatus(frequency, sample) {
  if (!Number.isInteger(sample) || sample <= 0 || typeof frequency !== "number"
      || !Number.isFinite(frequency) || frequency < 0 || frequency > 1) return "unknown";
  // Either interpretation of 0.0015 establishes occurrence, not an exact percentage.
  return frequency === 0.0015 ? "occurrence" : frequency > 0 ? "reported" : "zero";
}

function evidenceForBins(dataset, speciesCode, indices) {
  const entries = dataset.years.map((entry) => {
    const frequencies = Object.hasOwn(entry.species, speciesCode) ? entry.species[speciesCode] : [];
    const samples = indices.map((index) => entry.sampleSizes[index]);
    const statuses = indices.map((index) => binStatus(frequencies[index], entry.sampleSizes[index]));
    // Any positive bin documents occurrence in the wider period. In contrast,
    // zero requires valid explicit zeros in every bin; missing bins stay unknown.
    const status = statuses.includes("reported") ? "reported" : statuses.includes("occurrence") ? "occurrence"
      : statuses.every((value) => value === "zero") ? "zero" : "unknown";
    const checklistCount = samples.every((n) => Number.isInteger(n) && n >= 0)
      ? samples.reduce((sum, n) => sum + n, 0) : null;
    return { year: entry.year, status, checklistCount,
      sourceUrl: entry.source.url, downloadedAt: entry.source.downloadedAt };
  });
  return {
    entries,
    reportedYears: entries.filter((entry) => ["reported", "occurrence"].includes(entry.status)).length,
    zeroYears: entries.filter((entry) => entry.status === "zero").length,
    unknownYears: entries.filter((entry) => entry.status === "unknown").length,
  };
}

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
  const monthIndices = Array.from({ length: 4 }, (_, offset) => (baseline.season.month - 1) * 4 + offset);
  return { ...baseline, annualHistory: {
    datasetVersion: dataset.datasetVersion, methodVersion: "ebird-annual-occurrence-v2",
    ...evidenceForBins(dataset, baseline.speciesCode, [index]),
    month: { label: `${MONTHS[baseline.season.month - 1]} (whole month)`,
      ...evidenceForBins(dataset, baseline.speciesCode, monthIndices) },
  } };
}
