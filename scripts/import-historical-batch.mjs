import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { importBarchartBaseline } from "../lib/barchartImport.js";
import { importAnnualHistory } from "../lib/annualHistoryImport.js";

// A download receipt records the scope actually selected in Cornell's UI.
// Filenames alone are insufficient: histogram bytes do not identify geography.
const { values } = parseArgs({ options: Object.fromEntries([
  "receipts", "taxonomy", "taxonomy-version", "output-directory",
].map((name) => [name, { type: "string" }])) });
for (const name of ["receipts", "taxonomy", "taxonomy-version", "output-directory"]) {
  if (!values[name]) throw new Error(`Missing --${name}`);
}
const receipts = JSON.parse(await fs.readFile(values.receipts, "utf8"));
const taxonomy = JSON.parse(await fs.readFile(values.taxonomy, "utf8"));
const source = new URL("https://api.ebird.org/v2/ref/taxonomy/ebird");
source.search = new URLSearchParams({ fmt: "json", locale: "en", cat: "species,issf,form", version: values["taxonomy-version"] }).toString();
if (!Array.isArray(receipts.counties)) throw new Error("Expected a counties array of download receipts.");
await fs.mkdir(values["output-directory"], { recursive: true });
const results = [];
const seen = new Set();
for (const receipt of receipts.counties) {
  if (!/^US-[A-Z]{2}-\d{3}$/.test(receipt.countyCode) || seen.has(receipt.countyCode)) {
    throw new Error("Invalid or duplicate county receipt.");
  }
  seen.add(receipt.countyCode);
  try {
    const pooledInput = await readReceipt(receipt.pooled);
    const { dataset, skippedTaxa } = importBarchartBaseline(pooledInput.text, {
      countyCode: receipt.countyCode, countyName: receipt.countyName,
      startYear: receipt.startYear, endYear: receipt.endYear,
      downloadedAt: pooledInput.downloadedAt, sourceUrl: pooledInput.sourceUrl,
      taxonomyVersion: values["taxonomy-version"], taxonomySourceUrl: source.href,
    }, taxonomy);
    const inputs = [];
    for (const item of receipt.annual || []) inputs.push(await readReceipt(item));
    const history = importAnnualHistory(dataset, inputs);
    const output = path.join(values["output-directory"], `${receipt.countyCode}.json`);
    const data = JSON.stringify({ schemaVersion: 1, areaCode: receipt.countyCode, pooled: [dataset], annual: [history] }) + "\n";
    let existing;
    try { existing = await fs.readFile(output, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (existing && existing !== data) throw new Error("A different county edition already exists; choose a new staging directory.");
    if (!existing) {
      await fs.writeFile(`${output}.tmp`, data);
      await fs.rename(`${output}.tmp`, output);
    }
    results.push({ code: receipt.countyCode, status: existing ? "already_imported" : "imported",
      datasetVersion: dataset.datasetVersion, skippedTaxa: skippedTaxa.length });
  } catch (error) {
    results.push({ code: receipt.countyCode, status: "unavailable", error: error.message });
  }
}
await fs.writeFile(path.join(values["output-directory"], "import-report.json"), JSON.stringify({ results }, null, 2) + "\n");
console.log(JSON.stringify({ counties: results.length, imported: results.filter((r) => r.status !== "unavailable").length,
  unavailable: results.filter((r) => r.status === "unavailable").length }));
if (results.some((r) => r.status === "unavailable")) process.exitCode = 1;

async function readReceipt(item) {
  if (item?.scopeVerified !== true || !/^[a-f0-9]{64}$/.test(item.sha256)) {
    throw new Error("Each download needs a verified source scope and SHA-256 receipt.");
  }
  const text = await fs.readFile(path.resolve(path.dirname(values.receipts), item.path), "utf8");
  if (createHash("sha256").update(text).digest("hex") !== item.sha256) throw new Error("Source file hash mismatch.");
  return { ...item, text };
}
