import { getWeeklyRoundup } from "../../lib/ebirdCore.js";
import { addBirdIllustrations } from "../../lib/birdIllustrations.js";
import { generationConfigured } from "../../lib/illustrationGeneration.js";
import { DIGEST_REGIONS } from "../../shared/digestRegions.js";

export const config = { maxDuration: 300 };

// Each regional job warms at 13:00 and 13:20 UTC, staggered by one minute.
// A single image batch fits the function lifetime; the second pass fills any
// remaining gaps. Email delivery never waits for image generation.
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

  const selected = DIGEST_REGIONS.find((region) => region.id === request.query?.region);
  if (!selected) {
    response.status(400).json({ error: "Choose one digest region." });
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
  for (const region of [selected]) {
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

  // One bounded batch; later invocations reuse every completed cached plate.
  const combined = await addBirdIllustrations({ findings }, appUrl, {
    generateMissing: true,
    generationBudget: 3,
    generationConcurrency: 3
  });
  const unresolved = [...new Set(
    (combined.findings || [])
      .filter((finding) => !finding.image)
      .map((finding) => finding.speciesCode)
      .filter(Boolean)
  )];

  const ok = regions.every((region) => region.ok);
  console.info(JSON.stringify({ event: "illustration_prewarm_completed", region: selected.id, ok, unresolved }));
  response.status(ok ? 200 : 500).json({
    ok,
    generatedAt: new Date().toISOString(),
    regions,
    species: [...new Set(findings.map((finding) => finding.speciesCode).filter(Boolean))].length,
    unresolved
  });
}
