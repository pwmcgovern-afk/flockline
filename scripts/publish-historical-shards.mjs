import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { put, head, BlobNotFoundError } from "@vercel/blob";

const { values } = parseArgs({ options: {
  index: { type: "string" }, directory: { type: "string" }, output: { type: "string" },
  county: { type: "string" }, publish: { type: "boolean", default: false },
} });
for (const name of ["index", "directory", "output"]) if (!values[name]) throw new Error(`Missing --${name}`);
if (path.resolve(values.output) === path.resolve(values.index)) throw new Error("Write a separate candidate index for review.");
const index = JSON.parse(await fs.readFile(values.index, "utf8"));
const entries = Object.entries(index.counties).filter(([code]) => !values.county || code === values.county);
if (!entries.length) throw new Error("No selected county entries.");
const verified = [];
for (const [code, entry] of entries) {
  if (!/^US-[A-Z]{2}-\d{3}$/.test(code) || entry.file !== `${code}.${entry.sha256?.slice(0, 12)}.json.gz`) {
    throw new Error("Expected a locally built county file.");
  }
  const bytes = await fs.readFile(path.join(values.directory, entry.file));
  if (bytes.length !== entry.compressedBytes || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
    throw new Error("County file hash or size mismatch.");
  }
  verified.push({ code, entry });
}
if (!values.publish) {
  console.log(JSON.stringify({ dryRun: true, counties: verified.length, bytes: verified.reduce((n, d) => n + d.entry.compressedBytes, 0) }));
} else {
  // Content-addressed paths are immutable. Never overwrite an existing source
  // edition or expose raw checklists; these files contain derived summaries.
  for (const { code, entry } of verified) {
    const bytes = await fs.readFile(path.join(values.directory, entry.file));
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error("County file changed after validation.");
    const pathname = `historical-context/v1/${entry.file}`;
    let result;
    try { result = await head(pathname); }
    catch (error) { if (!(error instanceof BlobNotFoundError)) throw error; }
    result ||= await put(pathname, bytes, {
        access: "public", addRandomSuffix: false, allowOverwrite: false,
        contentType: "application/octet-stream", cacheControlMaxAge: 31536000,
      });
    const response = await fetch(result.url, { signal: AbortSignal.timeout(10000), redirect: "error" });
    if (!response.ok) throw new Error(`Uploaded county read failed: ${code}`);
    const downloaded = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(downloaded).digest("hex") !== entry.sha256) throw new Error(`Uploaded county hash mismatch: ${code}`);
    index.counties[code] = { url: result.url, sha256: entry.sha256, compressedBytes: entry.compressedBytes };
  }
  // Publication alone does not switch the app. Commit the reviewed candidate
  // index separately after validation. Existing bundled coverage can stay local.
  await fs.writeFile(values.output, JSON.stringify(index, null, 2) + "\n");
  console.log(JSON.stringify({ publishedCounties: verified.length, candidateIndex: values.output }));
}
