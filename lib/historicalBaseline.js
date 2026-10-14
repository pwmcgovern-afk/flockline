import fs from "node:fs";

const datasets = JSON.parse(fs.readFileSync(new URL("../data/historical-baselines.json", import.meta.url), "utf8"));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Exact county and season only. Missing coverage is not a zero, and a state
// baseline cannot silently stand in for a local observation's county.
export function getHistoricalBaseline(finding = {}, availableDatasets = datasets) {
  const countyCode = String(finding.countyCode || finding.subnational2Code || "");
  if (!countyCode) return unavailable("county_missing");
  const season = baselineSeason(finding.obsDt);
  if (!season) return unavailable("date_invalid");
  const candidates = availableDatasets
    .filter((dataset) => dataset.area?.code === countyCode)
    .sort((a, b) => b.years.end - a.years.end || b.source.downloadedAt.localeCompare(a.source.downloadedAt));
  if (!candidates.length) return unavailable("county_not_covered");
  const dataset = candidates.find((item) => item.years.end < season.year);
  if (!dataset) return unavailable("baseline_not_prior");
  const requestedCode = String(finding.speciesCode || "");
  const speciesCode = Object.hasOwn(dataset.taxonAliases, requestedCode) ? dataset.taxonAliases[requestedCode] : requestedCode;
  if (!Object.hasOwn(dataset.species, speciesCode)) return unavailable("species_not_covered");
  const species = dataset.species[speciesCode];
  const checklistCount = dataset.sampleSizes[season.index];
  const frequency = species.frequencies[season.index];
  if (!Number.isInteger(checklistCount) || checklistCount <= 0) return unavailable("sample_unavailable");
  if (typeof frequency !== "number" || !Number.isFinite(frequency) || frequency < 0 || frequency > 1) {
    return unavailable("frequency_unavailable");
  }
  return {
    status: "available",
    speciesCode,
    comName: species.comName,
    area: { ...dataset.area },
    season: { month: season.month, startDay: season.startDay, endDay: season.endDay, label: season.label },
    years: { ...dataset.years },
    frequency,
    checklistCount,
    sourceUrl: dataset.source.url,
    sourceAttribution: dataset.source.attribution,
    termsUrl: dataset.source.termsUrl,
    downloadedAt: dataset.source.downloadedAt,
    datasetVersion: dataset.datasetVersion,
    methodVersion: dataset.methodVersion,
    taxonomyVersion: dataset.taxonomyVersion,
    // The pooled file cannot establish annual recurrence, independent sample
    // structure, or calibrated statistical confidence. Do not reconstruct an
    // integer numerator from its rounded exported frequencies.
    annualRecurrence: null,
    confidence: null,
    coverage: { scope: "county", yearsRepresented: null, pooledYears: true },
  };
}

function unavailable(reason) {
  return { status: "unavailable", reason, confidence: null, annualRecurrence: null };
}

export function baselineSeason(value) {
  const date = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth() + 1;
  const day = parsed.getUTCDate();
  const quarter = Math.min(3, Math.floor((day - 1) / 7));
  const startDay = quarter * 7 + 1;
  const endDay = quarter === 3 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : startDay + 6;
  return { year, month, startDay, endDay, index: (month - 1) * 4 + quarter, label: `${MONTHS[month - 1]} ${startDay}-${endDay}` };
}
