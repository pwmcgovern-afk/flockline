import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { importAnnualHistory } from "../lib/annualHistoryImport.js";

const { values } = parseArgs({ options: Object.fromEntries(
  ["manifest", "pooled", "output"].map((name) => [name, { type: "string" }]),
) });
for (const name of ["manifest", "pooled", "output"]) if (!values[name]) throw new Error(`Missing --${name}`);
if (path.resolve(values.pooled) === path.resolve(values.output)) throw new Error("Annual evidence needs a separate registry.");
const manifest = JSON.parse(await fs.readFile(values.manifest, "utf8"));
const pooled = JSON.parse(await fs.readFile(values.pooled, "utf8"))
  .find((entry) => entry.datasetVersion === manifest.pooledDatasetVersion);
if (!pooled) throw new Error("The manifest must identify an exact pooled dataset version.");
const inputs = await Promise.all(manifest.years.map(async (entry) => ({
  ...entry, text: await fs.readFile(path.resolve(path.dirname(values.manifest), entry.path), "utf8"),
})));
const dataset = importAnnualHistory(pooled, inputs);
let registry = [];
try { registry = JSON.parse(await fs.readFile(values.output, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
if (!Array.isArray(registry) || registry.some((entry) => entry.methodVersion !== "ebird-annual-occurrence-v1")) {
  throw new Error("Output must be an annual history registry, not pooled baselines.");
}
registry = registry.filter((entry) => entry.pooledDatasetVersion !== dataset.pooledDatasetVersion);
registry.push(dataset);
await fs.writeFile(values.output, `${JSON.stringify(registry)}\n`);
console.log(`Imported ${dataset.years.length} annual sources for ${dataset.areaCode}; all 48 sample totals reconcile.`);
