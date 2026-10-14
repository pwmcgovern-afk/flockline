import { createHash } from "node:crypto";
import { parseBarchartExport } from "./barchartImport.js";

// Bind annual evidence to the exact pooled edition. Annual files must never be
// added to the pooled registry, where they could shadow the ten-year baseline.
export function importAnnualHistory(pooled, inputs) {
  if (pooled?.methodVersion !== "ebird-barchart-48-v1") throw new Error("A histogram baseline is required.");
  const expectedYears = pooled.years.end - pooled.years.start + 1;
  if (inputs.length !== expectedYears) throw new Error("Supply one export for every pooled year.");
  const seen = new Set();
  const years = inputs.map(({ year, text, sourceUrl, downloadedAt }) => {
    if (!Number.isInteger(year) || year < pooled.years.start || year > pooled.years.end || seen.has(year)) {
      throw new Error("Annual years must be unique and within the pooled window.");
    }
    seen.add(year);
    const url = new URL(sourceUrl);
    if (url.origin !== "https://ebird.org" || url.pathname !== "/barchart") throw new Error("Use an official eBird chart URL.");
    for (const [key, value] of Object.entries({ byr: year, eyr: year, bmo: 1, emo: 12, r: pooled.area.code })) {
      if (url.searchParams.get(key) !== String(value)) throw new Error(`Annual source scope mismatch: ${key}`);
    }
    const date = new Date(downloadedAt);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(downloadedAt || "") || !Number.isFinite(date.getTime())
        || date.toISOString().slice(0, 10) !== downloadedAt || date.getUTCFullYear() <= year) {
      throw new Error("Annual exports must describe completed years and have a valid download date.");
    }
    const parsed = parseBarchartExport(text);
    const byName = new Map(parsed.taxa.map((row) => [row.name, row.frequencies]));
    // Reuse the pooled edition's exact official taxonomy mapping. Missing parent
    // rows stay missing; never add subspecies frequencies or guess renamed taxa.
    const species = Object.fromEntries(Object.entries(pooled.species)
      .filter(([, taxon]) => byName.has(taxon.comName))
      .map(([code, taxon]) => [code, byName.get(taxon.comName)]));
    if (!Object.keys(species).length) throw new Error("No annual species match the pooled taxonomy.");
    return { year, source: { url: sourceUrl, downloadedAt, sha256: createHash("sha256").update(text).digest("hex") },
      sampleSizes: parsed.sampleSizes, species };
  }).sort((a, b) => a.year - b.year);
  for (let index = 0; index < 48; index++) {
    const samples = years.map((entry) => entry.sampleSizes[index]);
    if (samples.some((n) => !Number.isInteger(n) || n < 0)
        || samples.reduce((sum, n) => sum + n, 0) !== pooled.sampleSizes[index]) {
      throw new Error(`Annual checklist samples do not reconcile with the pooled export in bin ${index}. Recheck source scopes and editions.`);
    }
  }
  const hash = createHash("sha256").update(JSON.stringify(years)).digest("hex");
  return { schemaVersion: 1, methodVersion: "ebird-annual-occurrence-v1",
    datasetVersion: `${pooled.area.code}:annual:${hash.slice(0, 12)}`,
    pooledDatasetVersion: pooled.datasetVersion, taxonomyVersion: pooled.taxonomyVersion,
    areaCode: pooled.area.code, window: { ...pooled.years }, years };
}
