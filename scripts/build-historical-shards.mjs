import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  pooled: { type: "string", default: "data/historical-baselines.json" },
  annual: { type: "string", default: "data/annual-history.json" },
  "staged-directory": { type: "string" },
  directory: { type: "string", default: "data/historical-counties" },
  index: { type: "string", default: "data/historical-index.json" },
} });
let sources;
if (values["staged-directory"]) {
  // Batch imports already separate counties. Read them sequentially rather than
  // concatenating several gigabytes into one national registry in memory.
  sources = (await fs.readdir(values["staged-directory"]))
    .filter((name) => /^US-[A-Z]{2}-\d{3}\.json$/.test(name)).sort()
    .map((name) => ({ code: name.slice(0, -5), read: async () => JSON.parse(await fs.readFile(path.join(values["staged-directory"], name), "utf8")) }));
} else {
  const pooled = JSON.parse(await fs.readFile(values.pooled, "utf8"));
  const annual = JSON.parse(await fs.readFile(values.annual, "utf8"));
  if (!Array.isArray(pooled) || !Array.isArray(annual)) throw new Error("Expected source registry arrays.");
  const codes = [...new Set(pooled.map((d) => d.area.code))].sort();
  if (annual.some((a) => !codes.includes(a.areaCode))) throw new Error("Annual county has no pooled source.");
  sources = codes.map((code) => ({ code, read: async () => ({ schemaVersion: 1, areaCode: code,
    pooled: pooled.filter((d) => d.area.code === code), annual: annual.filter((d) => d.areaCode === code) }) }));
}
if (!sources.length) throw new Error("No county data to build.");
await fs.mkdir(values.directory, { recursive: true });
const counties = {};
let totalBytes = 0;
for (const { code, read } of sources) {
  const data = await read();
  if (!/^US-[A-Z]{2}-\d{3}$/.test(code) || data.schemaVersion !== 1 || data.areaCode !== code
      || !Array.isArray(data.pooled) || !data.pooled.length || !Array.isArray(data.annual)
      || data.pooled.some((d) => d.area.code !== code)
      || data.annual.some((a) => a.areaCode !== code || !data.pooled.some((d) => d.datasetVersion === a.pooledDatasetVersion))) {
    throw new Error("County file and annual evidence must match their pooled scope and edition.");
  }
  const bytes = gzipSync(JSON.stringify(data), { level: 9 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const file = `${code}.${sha256.slice(0, 12)}.json.gz`;
  await fs.writeFile(path.join(values.directory, file), bytes);
  counties[code] = { file, sha256, compressedBytes: bytes.length };
  totalBytes += bytes.length;
}
// Write the index last. A partial build cannot point at unfinished files.
await fs.writeFile(values.index, JSON.stringify({ schemaVersion: 1, counties }, null, 2) + "\n");
console.log(JSON.stringify({ counties: sources.length, compressedBytes: totalBytes, index: values.index }));
