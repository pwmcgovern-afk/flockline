import { getWeeklyRoundup } from "../../lib/ebirdCore.js";
import { addBirdIllustrations } from "../../lib/birdIllustrations.js";
import { generationConfigured } from "../../lib/illustrationGeneration.js";
import { DIGEST_REGIONS } from "../../shared/digestRegions.js";

export const config = { maxDuration: 300 };

// Runs Monday 13:30 UTC (before the 14:00/15:00 UTC digest send in both DST
// and standard time). Pulls the same fresh roundups the send will use, unions
// their species, and generates any missing illustration into the Blob cache so
// the 10 a.m. email finds art for every finding. The send path keeps a small
// generation budget of its own for species that shift between the two runs.
export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  response.setHeader("Cache-Control", "no-store");
  const cronSecret = String(process.env.CRON_SECRET || "");
  const authorization = Array.isArray(request.headers.authorization)
    ? request.headers.authorization[0]
    : request.headers.authorization;
  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    response.status(401).json({ error: "Unauthorized." });
    return;
  }

  if (!generationConfigured()) {
    response.status(200).json({
      ok: true,
      skipped: true,
      reason: "Illustration generation is not configured."
    });
    return;
  }

  const appUrl = String(process.env.PUBLIC_APP_URL || "https://flockline.app").replace(/\/$/, "");
  const findings = [];
  const regions = [];
  for (const region of DIGEST_REGIONS) {
    try {
      const roundup = await getWeeklyRoundup({ region: region.id, fresh: "1" });
      if (roundup.source === "ebird") {
        findings.push(...(roundup.findings || []));
        regions.push({ region: region.id, ok: true, findings: roundup.findings?.length || 0 });
      } else {
        regions.push({ region: region.id, ok: false, error: "Live eBird data was unavailable." });
      }
    } catch (error) {
      regions.push({ region: region.id, ok: false, error: error?.message || "Unknown error" });
    }
  }

  // One combined pass so a species shared by several regions generates once.
  const combined = await addBirdIllustrations({ findings }, appUrl, {
    generateMissing: true,
    generationBudget: 16,
    generationConcurrency: 4
  });
  const unresolved = [...new Set(
    (combined.findings || [])
      .filter((finding) => !finding.image)
      .map((finding) => finding.speciesCode)
      .filter(Boolean)
  )];

  response.status(200).json({
    ok: true,
    generatedAt: new Date().toISOString(),
    regions,
    species: [...new Set(findings.map((finding) => finding.speciesCode).filter(Boolean))].length,
    unresolved
  });
}
