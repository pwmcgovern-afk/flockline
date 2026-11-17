// Read-only source acquisition and local rendering. No Blob credentials are
// passed into the app, and this script has no provider or publication imports.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { selectDigestReports } from "../lib/digestSelection.js";
import { getRegionPreset } from "../shared/usGeography.js";
import { factualEditorialPayload } from "../shared/findingCopy.js";
import { renderDigestHtml } from "../lib/digestEmail.js";
const args = process.argv.slice(2);
const arg = (name, fallback) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const preset = getRegionPreset(arg("--region", "northeast"));
if (!preset) throw new Error("Unknown region");
const output = resolve(arg("--output", "/tmp/flockline-digest-preview"));
await mkdir(output, { recursive: true });
const input = arg("--input");
let snapshot;
if (input) snapshot = JSON.parse(await readFile(resolve(input), "utf8"));
else {
  const key = process.env.EBIRD_API_KEY || process.env.VITE_EBIRD_API_KEY;
  if (!key) throw new Error("Load the eBird API key without printing it.");
  snapshot = {
    asOf: new Date().toISOString(),
    regions: preset.stateCodes,
    rows: [],
    failedRegions: [],
    limitedRegions: [],
  };
  for (const state of preset.stateCodes) {
    try {
      const response = await fetch(
        `https://api.ebird.org/v2/data/obs/${state}/recent/notable?back=14&detail=full&maxResults=10000`,
        {
          headers: { "x-ebirdapitoken": key },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) throw new Error("Source unavailable");
      const rows = await response.json();
      snapshot.rows.push(...rows.map((row) => ({ ...row, regionCode: state })));
      if (rows.length >= 10000) snapshot.limitedRegions.push(state);
    } catch {
      snapshot.failedRegions.push(state);
    }
  }
  await writeFile(
    resolve(output, "snapshot.json"),
    JSON.stringify(snapshot, null, 2),
  );
}
const scopedRows = snapshot.rows.filter((row) =>
  preset.stateCodes.includes(row.regionCode || row.subnational1Code),
);
const { selected, selection } = selectDigestReports(scopedRows, {
  now: new Date(snapshot.asOf),
  regions: preset.stateCodes,
});
const roundup = factualEditorialPayload({
  scopeId: preset.id,
  scopeLabel: preset.name,
  source: "ebird",
  generatedAt: snapshot.asOf,
  selection,
  coverage: {
    failedRegions: snapshot.failedRegions.filter((state) =>
      preset.stateCodes.includes(state),
    ),
    limitedRegions: snapshot.limitedRegions.filter((state) =>
      preset.stateCodes.includes(state),
    ),
  },
  findings: selected.map((row) => ({
    ...row,
    region: row.regionCode,
    locName: row.locName,
    significance: row.significance,
  })),
});
await writeFile(
  resolve(output, "selection.json"),
  JSON.stringify(roundup, null, 2),
);
await writeFile(resolve(output, "preview.html"), renderDigestHtml(roundup));
console.log(
  JSON.stringify(
    {
      output,
      rows: scopedRows.length,
      selected: selected.map((r) => ({
        name: r.comName,
        state: r.regionCode,
        date: r.obsDt,
        checklist: r.subId,
        reason: r.significance.kind,
      })),
      held: selection.ledger.filter((x) => x.decision === "hold").length,
      uncoveredStates: selection.uncoveredStates,
      failedRegions: snapshot.failedRegions.filter((state) =>
        preset.stateCodes.includes(state),
      ),
    },
    null,
    2,
  ),
);
