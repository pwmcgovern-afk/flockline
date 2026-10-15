import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const folders = [];
afterEach(() => { for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });
function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "flockline-historical-import-")); folders.push(directory);
  const write = (name, value) => fs.writeFileSync(path.join(directory, name), typeof value === "string" ? value : JSON.stringify(value));
  const source = (start, end, sample) => {
    const text = `Number of taxa:\t1\nSample Size:\t${Array(48).fill(sample).join("\t")}\nSora\t${Array(48).fill("0.1").join("\t")}\n`;
    const name = `${start}-${end}.txt`; write(name, text);
    return { path: name, year: start, sourceUrl: `https://ebird.org/barchart?byr=${start}&eyr=${end}&bmo=1&emo=12&r=US-CT-009`,
      downloadedAt: "2026-10-15", scopeVerified: true, sha256: createHash("sha256").update(text).digest("hex") };
  };
  const receipts = { counties: [{ countyCode: "US-CT-009", countyName: "New Haven County, Connecticut",
    startYear: 2024, endYear: 2025, pooled: source(2024, 2025, 20), annual: [source(2024, 2024, 10), source(2025, 2025, 10)] }] };
  write("taxonomy.json", [{ speciesCode: "sora", comName: "Sora", category: "species" }]);
  return { directory, receipts, write, run: () => {
    write("receipts.json", receipts);
    return spawnSync(process.execPath, ["scripts/import-historical-batch.mjs", "--receipts", path.join(directory, "receipts.json"),
      "--taxonomy", path.join(directory, "taxonomy.json"), "--taxonomy-version", "2025", "--output-directory", path.join(directory, "output")], { encoding: "utf8" });
  } };
}

describe("resumable source import", () => {
  it("imports a whole county and resumes without changing its bytes", () => {
    const f = setup(); expect(f.run().status).toBe(0);
    const file = path.join(f.directory, "output/US-CT-009.json"); const original = fs.readFileSync(file, "utf8");
    expect(f.run().status).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
    expect(JSON.parse(fs.readFileSync(path.join(f.directory, "output/import-report.json"))).results[0].status).toBe("already_imported");
  });

  it("does not publish a partial county when an annual source is missing", () => {
    const f = setup(); f.receipts.counties[0].annual.pop();
    expect(f.run().status).toBe(1);
    expect(fs.existsSync(path.join(f.directory, "output/US-CT-009.json"))).toBe(false);
  });

  it("rejects unverified scopes and changed source bytes", () => {
    const f = setup(); f.receipts.counties[0].pooled.scopeVerified = false;
    expect(f.run().status).toBe(1);
    f.receipts.counties[0].pooled.scopeVerified = true;
    f.write("2024-2025.txt", "changed");
    expect(f.run().status).toBe(1);
    const report = JSON.parse(fs.readFileSync(path.join(f.directory, "output/import-report.json")));
    expect(report.results[0].error).toBe("Source file hash mismatch.");
    expect(fs.existsSync(path.join(f.directory, "output/US-CT-009.json"))).toBe(false);
  });

  it("retains an existing edition when a new receipt would replace it", () => {
    const f = setup(); expect(f.run().status).toBe(0);
    const file = path.join(f.directory, "output/US-CT-009.json"); const original = fs.readFileSync(file, "utf8");
    f.receipts.counties[0].countyName = "Different published label";
    expect(f.run().status).toBe(1);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });
});
