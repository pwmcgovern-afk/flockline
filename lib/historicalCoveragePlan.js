import { createHash } from "node:crypto";

export function createHistoricalCoveragePlan({ counties, states, pooled, annual, startYear, endYear, createdAt }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(createdAt || "") || !Number.isFinite(Date.parse(createdAt))
      || new Date(createdAt).toISOString().slice(0, 10) !== createdAt) throw new Error("Use a valid plan date.");
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear < 1800
      || startYear > endYear || endYear >= Number(createdAt?.slice(0, 4))) throw new Error("Use completed historical years.");
  const stateNames = new Map(states.regions.map((s) => [s.code, s.name]));
  const seen = new Set();
  const regions = counties.regions.map(({ code, name }) => {
    const stateCode = code.slice(0, 5);
    if (!/^US-[A-Z]{2}-\d{3}$/.test(code) || seen.has(code) || !name || !stateNames.has(stateCode)) {
      throw new Error("Invalid, duplicate or unrecognized county region.");
    }
    seen.add(code);
    const source = pooled.filter((d) => d.area.code === code && d.years.start === startYear && d.years.end === endYear)
      .sort((a, b) => b.source.downloadedAt.localeCompare(a.source.downloadedAt))[0];
    const history = source && annual.find((a) => a.pooledDatasetVersion === source.datasetVersion
      && a.areaCode === code && a.taxonomyVersion === source.taxonomyVersion
      && a.window.start === startYear && a.window.end === endYear);
    const requests = [{ kind: "pooled", startYear, endYear, imported: Boolean(source) },
      ...Array.from({ length: endYear - startYear + 1 }, (_, i) => ({ kind: "annual", startYear: startYear + i,
        endYear: startYear + i, imported: Boolean(history?.years.some((y) => y.year === startYear + i)) }))]
      .map((request) => ({ ...request, sourceUrl: chartUrl(code, request.startYear, request.endYear) }));
    return { code, name, stateCode, stateName: stateNames.get(stateCode),
      complete: requests.every((r) => r.imported), pooledDatasetVersion: source?.datasetVersion || null, requests };
  }).sort((a, b) => a.code.localeCompare(b.code));
  return { schemaVersion: 1, createdAt, scope: "U.S. eBird county regions", years: { start: startYear, end: endYear },
    sources: [counties, states].map((inventory) => ({ url: inventory.sourceUrl, retrievedAt: inventory.retrievedAt,
      regionsSha256: createHash("sha256").update(JSON.stringify(inventory.regions)).digest("hex") })),
    totals: { counties: regions.length, states: new Set(regions.map((r) => r.stateCode)).size,
      completeCounties: regions.filter((r) => r.complete).length,
      importedExports: regions.flatMap((r) => r.requests).filter((r) => r.imported).length,
      missingExports: regions.flatMap((r) => r.requests).filter((r) => !r.imported).length },
    regions };
}

function chartUrl(code, startYear, endYear) {
  const url = new URL("https://ebird.org/barchart");
  url.search = new URLSearchParams({ byr: startYear, eyr: endYear, bmo: 1, emo: 12, r: code }).toString();
  return url.href;
}
