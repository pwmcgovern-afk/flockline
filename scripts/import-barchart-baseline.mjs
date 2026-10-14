import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { importBarchartBaseline } from "../lib/barchartImport.js";

const flagNames = ["input", "taxonomy", "county", "county-name", "start-year", "end-year", "downloaded-at", "taxonomy-version", "output"];
const { values } = parseArgs({
  options: Object.fromEntries(flagNames.map((name) => [name, { type: "string" }])),
});
for (const name of flagNames) {
  if (!values[name]) throw new Error(`Missing --${name}. See data/README.md for an import example.`);
}

const sourceUrl = new URL("https://ebird.org/barchart");
sourceUrl.search = new URLSearchParams({
  byr: values["start-year"], eyr: values["end-year"], bmo: "1", emo: "12", r: values.county,
}).toString();
const taxonomySourceUrl = new URL("https://api.ebird.org/v2/ref/taxonomy/ebird");
taxonomySourceUrl.search = new URLSearchParams({
  fmt: "json", locale: "en", cat: "species,issf,form", version: values["taxonomy-version"],
}).toString();
const [text, taxonomyText] = await Promise.all([
  fs.readFile(values.input, "utf8"),
  fs.readFile(values.taxonomy, "utf8"),
]);
const { dataset, skippedTaxa } = importBarchartBaseline(text, {
  countyCode: values.county,
  countyName: values["county-name"],
  startYear: Number(values["start-year"]),
  endYear: Number(values["end-year"]),
  downloadedAt: values["downloaded-at"],
  taxonomyVersion: values["taxonomy-version"],
  sourceUrl: sourceUrl.href,
  taxonomySourceUrl: taxonomySourceUrl.href,
}, JSON.parse(taxonomyText));

// A registry can hold several county or historical editions. Replace only the
// same county and year window, leaving other coverage and past windows intact.
let registry = [];
try {
  registry = JSON.parse(await fs.readFile(values.output, "utf8"));
  if (!Array.isArray(registry)) throw new Error("The output must be a baseline registry array.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
registry = registry.filter((entry) => entry.area.code !== dataset.area.code || entry.years.start !== dataset.years.start || entry.years.end !== dataset.years.end);
registry.push(dataset);
registry.sort((a, b) => a.area.code.localeCompare(b.area.code) || a.years.start - b.years.start || a.years.end - b.years.end);
await fs.writeFile(values.output, `${JSON.stringify(registry)}\n`);
console.log(`Imported ${dataset.coverage.importedSpecies} species and ${Object.keys(dataset.taxonAliases).length} taxon aliases for ${dataset.area.code}, ${dataset.years.start}-${dataset.years.end}.`);
console.log(`Skipped ${skippedTaxa.length} rows without an exact species match. Frequencies were not summed or changed.`);
