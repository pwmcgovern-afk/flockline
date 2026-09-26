import { addBirdIllustrations, missingBirdIllustrations } from "../lib/birdIllustrations.js";
import { listArchivedRoundups, normalizeArchiveDate, saveRoundup } from "../lib/roundupArchive.js";
import { generationConfigured } from "../lib/illustrationGeneration.js";

// Repair artwork only. This script has no mail-provider imports and retains
// the original species, wording, observations, and publication date.
const args = process.argv.slice(2);
const date = args[args.indexOf("--date") + 1];
const apply = args.includes("--apply");
if (!args.includes("--date") || !normalizeArchiveDate(date)) {
  throw new Error("Usage: node scripts/repair-digest-illustrations.mjs --date YYYY-MM-DD [--apply]");
}
if (apply && !generationConfigured()) throw new Error("Load Blob and image-service credentials before applying repairs.");
const issues = (await listArchivedRoundups()).filter(issue => issue.date === date);
if (!issues.length) throw new Error("No saved issues exist for that date.");
for (const issue of issues) {
  const response = await fetch(issue.url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Cannot read ${issue.scopeId}: ${response.status}`);
  const original = await response.json();
  let roundup = await addBirdIllustrations(original);
  if (apply) {
    // Two bounded batches cover a six-bird issue; successful plates are reused.
    for (let pass = 0; pass < 2 && missingBirdIllustrations(roundup).length; pass++) {
      roundup = await addBirdIllustrations(roundup, "https://flockline.app", {
        generateMissing: true, generationBudget: 3, generationConcurrency: 3
      });
    }
  }
  const unresolved = missingBirdIllustrations(roundup);
  if (apply && !unresolved.length) await saveRoundup(roundup);
  if (unresolved.length) process.exitCode = 1;
  console.log(JSON.stringify({ region: issue.scopeId, date, findings: roundup.findings.length,
    illustrations: roundup.findings.length - unresolved.length, unresolved, saved: apply && !unresolved.length }));
}
