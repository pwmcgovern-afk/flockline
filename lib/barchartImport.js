import { createHash } from "node:crypto";

export const BASELINE_METHOD_VERSION = "ebird-barchart-48-v1";
export const EBIRD_DATA_TERMS_URL = "https://www.birds.cornell.edu/home/ebird-data-access-terms-of-use/";

// Histogram exports contain four bins per month, not ISO weeks. Metadata is
// supplied explicitly because the downloaded text does not identify its scope.
export function parseBarchartExport(text) {
  const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/);
  const sampleIndex = lines.findIndex((line) => line.startsWith("Sample Size:"));
  if (sampleIndex < 0) throw new Error("The export has no Sample Size row.");
  const sampleSizes = numericRow(lines[sampleIndex], "Sample Size");
  const expectedColumns = lines[sampleIndex].split("\t").length;
  if (sampleSizes.some((value) => value !== null && !Number.isInteger(value))) {
    throw new Error("Checklist sample sizes must be whole numbers.");
  }
  const declared = lines.map((line) => line.match(/^Number of taxa:\s+(\d+)\s*$/)).find(Boolean);
  if (!declared) throw new Error("The export does not declare its number of taxa.");
  const seen = new Set();
  const taxa = lines.slice(sampleIndex + 1).filter((line) => line.trim()).map((line) => {
    const name = line.split("\t")[0].trim();
    if (!name || seen.has(name)) throw new Error(`Duplicate or missing taxon name: ${name}`);
    seen.add(name);
    if (line.split("\t").length !== expectedColumns) throw new Error(`${name} must have the same 48 seasonal bins as the sample row.`);
    const frequencies = numericRow(line, name);
    if (frequencies.some((value) => value !== null && value > 1)) {
      throw new Error(`Frequency exceeds 1 for ${name}.`);
    }
    return { name, frequencies };
  });
  if (taxa.length !== Number(declared[1])) {
    throw new Error(`Expected ${declared[1]} taxa but found ${taxa.length}.`);
  }
  return { sampleSizes, taxa };
}

function numericRow(line, label) {
  const columns = line.split("\t");
  // eBird appends one empty column. Preserve empty interior bins as missing.
  if (columns.length === 50 && columns.at(-1).trim() === "") columns.pop();
  if (columns.length !== 49) throw new Error(`${label} must have exactly 48 seasonal bins.`);
  return columns.slice(1).map((raw) => {
    const value = raw.trim();
    if (value === "" || value === "NA") return null;
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
      throw new Error(`Invalid numeric value in ${label}: ${value}`);
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid numeric value in ${label}: ${value}`);
    return parsed;
  });
}

export function importBarchartBaseline(text, metadata, taxonomy) {
  validateMetadata(metadata);
  if (!Array.isArray(taxonomy) || !taxonomy.length) throw new Error("An eBird taxonomy snapshot is required.");
  const parsed = parseBarchartExport(text);
  const byName = new Map();
  const speciesByCode = new Map();
  for (const taxon of taxonomy) {
    if (taxon.category === "species") {
      if (byName.has(taxon.comName)) throw new Error(`Ambiguous species name in taxonomy: ${taxon.comName}`);
      byName.set(taxon.comName, taxon);
      speciesByCode.set(taxon.speciesCode, taxon);
    }
  }
  const species = {};
  const skippedTaxa = [];
  for (const row of parsed.taxa) {
    const taxon = byName.get(row.name);
    if (!taxon) {
      skippedTaxa.push(row.name);
      continue;
    }
    species[taxon.speciesCode] = { comName: taxon.comName, frequencies: row.frequencies };
  }
  if (!Object.keys(species).length) throw new Error("No exact species names matched the taxonomy snapshot.");

  // Query aliases use the official reportAs relationship. Never sum pooled
  // subspecies frequencies: the same checklist can report several taxa, and
  // species rows already represent the parent. Missing parents stay missing.
  const taxonAliases = {};
  for (const taxon of taxonomy) {
    if (!["issf", "form", "intergrade"].includes(taxon.category)) continue;
    if (speciesByCode.has(taxon.reportAs) && species[taxon.reportAs]) {
      taxonAliases[taxon.speciesCode] = taxon.reportAs;
    }
  }
  const sourceHash = createHash("sha256").update(text).digest("hex");
  const dataset = {
    schemaVersion: 1,
    datasetVersion: `${metadata.countyCode}:${metadata.startYear}-${metadata.endYear}:taxonomy-${metadata.taxonomyVersion}:${sourceHash.slice(0, 12)}`,
    methodVersion: BASELINE_METHOD_VERSION,
    area: { type: "county", code: metadata.countyCode, name: metadata.countyName },
    years: { start: metadata.startYear, end: metadata.endYear },
    source: {
      name: "eBird bar-chart histogram",
      url: metadata.sourceUrl,
      downloadedAt: metadata.downloadedAt,
      sha256: sourceHash,
      attribution: "eBird and its contributors, Cornell Lab of Ornithology",
      termsUrl: EBIRD_DATA_TERMS_URL,
    },
    taxonomyVersion: String(metadata.taxonomyVersion),
    taxonomySourceUrl: metadata.taxonomySourceUrl,
    coverage: {
      seasonalBins: 48,
      sourceTaxa: parsed.taxa.length,
      importedSpecies: Object.keys(species).length,
      skippedTaxa: skippedTaxa.length,
      yearsRepresented: null,
    },
    sampleSizes: parsed.sampleSizes,
    species,
    taxonAliases,
  };
  return { dataset, skippedTaxa };
}

function validateMetadata(metadata = {}) {
  if (!/^US-[A-Z]{2}-\d{3}$/.test(metadata.countyCode)) throw new Error("A U.S. county code is required.");
  if (typeof metadata.countyName !== "string" || !metadata.countyName.trim()) throw new Error("A county name is required.");
  const { startYear, endYear } = metadata;
  if (![startYear, endYear].every((year) => Number.isInteger(year) && year >= 1800 && year <= 9999) || startYear > endYear) {
    throw new Error("Valid baseline start and end years are required.");
  }
  const downloaded = new Date(metadata.downloadedAt);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.downloadedAt || "") || !Number.isFinite(downloaded.getTime()) || downloaded.toISOString().slice(0, 10) !== metadata.downloadedAt || downloaded.getUTCFullYear() <= endYear) {
    throw new Error("The baseline must use completed years before the download year.");
  }
  const source = new URL(metadata.sourceUrl);
  if (source.protocol !== "https:" || source.hostname !== "ebird.org" || source.pathname !== "/barchart") {
    throw new Error("Use the official eBird bar-chart source URL.");
  }
  for (const [key, expected] of Object.entries({ r: metadata.countyCode, byr: startYear, eyr: endYear, bmo: 1, emo: 12 })) {
    if (source.searchParams.get(key) !== String(expected)) throw new Error(`Source URL does not match the metadata (${key}).`);
  }
  const taxonomySource = new URL(metadata.taxonomySourceUrl);
  if (!metadata.taxonomyVersion || taxonomySource.origin !== "https://api.ebird.org" || taxonomySource.pathname !== "/v2/ref/taxonomy/ebird" || taxonomySource.searchParams.get("version") !== String(metadata.taxonomyVersion) || taxonomySource.searchParams.get("locale") !== "en") {
    throw new Error("Document the official taxonomy snapshot version and source.");
  }
}
