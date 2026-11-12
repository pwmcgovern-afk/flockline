import { put } from "@vercel/blob";
import { addBirdIllustrations } from "../../lib/birdIllustrations.js";
import { repairMissingDigestArchive } from "../../lib/digestArchiveRepair.js";
import { archiveConfigured, listArchivedRoundups } from "../../lib/roundupArchive.js";
import { DIGEST_REGIONS } from "../../shared/digestRegions.js";

export const config = { maxDuration: 300 };

const WEEKS_BACK = 8;
// Leave room for one slow edition (artwork can take ~2 minutes) before the
// 300 s limit, so the summary record is always written.
const TIME_BUDGET_MS = 120_000;

// Mondays strictly before today (UTC), newest first.
export function recentPastMondays(now = new Date(), weeks = WEEKS_BACK) {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - (sinceMonday === 0 ? 7 : sinceMonday));
  return Array.from({ length: weeks }, (_, index) => {
    const monday = new Date(day);
    monday.setUTCDate(day.getUTCDate() - index * 7);
    return monday.toISOString().slice(0, 10);
  });
}

// Publishes the web archive page for any recent Monday edition that was saved
// but never archived (for example, held for missing artwork). It draws missing
// birds first and publishes only complete editions. It never sends email,
// never refreshes observations, and never replaces an existing page.
// Runs weekly after the alert job; safe to trigger again at any time.
export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }
  const secret = String(process.env.CRON_SECRET || "");
  if (!secret || request.headers.authorization !== `Bearer ${secret}`) {
    response.status(401).json({ error: "Unauthorized." });
    return;
  }
  if (!archiveConfigured()) {
    response.status(503).json({ error: "Archive storage is not configured." });
    return;
  }
  const startedAt = Date.now();
  const appUrl = String(process.env.PUBLIC_APP_URL || "https://flockline.app").replace(/\/$/, "");
  // Same request-scoped image credentials as the prewarm job.
  const environment = {
    ...process.env,
    VERCEL_OIDC_TOKEN: request.headers["x-vercel-oidc-token"] || process.env.VERCEL_OIDC_TOKEN
  };
  const results = [];
  let archived;
  try {
    archived = new Set((await listArchivedRoundups()).map(({ scopeId, date }) => `${scopeId}/${date}`));
  } catch (error) {
    results.push({ status: "failed", reason: `Archive listing failed: ${String(error?.message || "error").slice(0, 120)}` });
    archived = null;
  }
  for (const date of archived ? recentPastMondays() : []) {
    for (const region of DIGEST_REGIONS) {
      if (archived.has(`${region.id}/${date}`)) continue;
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        results.push({ date, region: region.id, status: "deferred" });
        continue;
      }
      try {
        const result = await repairMissingDigestArchive({ date, regionId: region.id, apply: true }, {
          prepare: (snapshot) => addBirdIllustrations(snapshot, appUrl, {
            generateMissing: true, generationBudget: 3, generationConcurrency: 3, environment
          })
        });
        results.push({ date, region: region.id, status: result.saved ? "published" : "checked" });
      } catch (error) {
        results.push({ date, region: region.id, status: "skipped", reason: String(error?.message || "error").slice(0, 160) });
      }
    }
  }
  const summary = { ranAt: new Date().toISOString(), durationMs: Date.now() - startedAt, results };
  // Public, address-free record so the outcome can be read without logs.
  await put("digest-archive-recovery/last.json", JSON.stringify(summary), {
    access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60
  }).catch(() => {});
  console.info(JSON.stringify({ event: "digest_archive_recovery", ...summary }));
  response.status(200).json({ ok: true, ...summary });
}
