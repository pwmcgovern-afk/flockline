import { dailyDate } from "../../shared/dailyDigest.js";
import { DIGEST_REGIONS } from "../../shared/digestRegions.js";
import { ensureDailyDigest } from "../../lib/dailyDigestArchive.js";

import { deliverDailyDigest } from "../../lib/dailyDigestDelivery.js";

export const config = { maxDuration: 300 };
export function dailyGenerationHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(now)) === 9;
}
// Four attempts per morning (:00, :15, :30, :45 plus a per-region offset).
// The first two draw missing species art and wait for a complete set. The
// last two send with whatever art is cached, so an image outage never cancels
// the morning email and one missed attempt still leaves another.
export function isFinalDailyAttempt(now = new Date()) {
  return dailyGenerationHour(now) && now.getUTCMinutes() >= 30;
}
export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") { response.setHeader("Allow", "GET"); return response.status(405).end(); }
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret || request.headers.authorization !== "Bearer " + secret)
    return response.status(401).json({ error: "Unauthorized" });
  const scopeId = String(request.query.region || "");
  if (!DIGEST_REGIONS.some((region) => region.id === scopeId))
    return response.status(400).json({ error: "Choose a regional edition" });
  const now = new Date();
  if (!dailyGenerationHour(now)) return response.status(200).json({ skipped: true, reason: "outside_daily_hour" });
  try {
    const digest = await ensureDailyDigest({ scopeId, date: dailyDate(now), back: 1 }, { now });
    const final = isFinalDailyAttempt(now);
    const receipt = await deliverDailyDigest(digest, {
      generateMissing: !final, allowPartialArtwork: final,
      // Vercel supplies fresh gateway credentials on the cron request; the
      // environment token is for builds and can already be expired.
      environment: { ...process.env, VERCEL_OIDC_TOKEN: request.headers["x-vercel-oidc-token"] || process.env.VERCEL_OIDC_TOKEN },
    });
    return response.status(200).json({ ok: true, delivery: receipt.status, scopeId, date: digest.date, findings: digest.findings.length, illustrations: receipt.illustrations, unresolved: receipt.unresolved });
  } catch (error) {
    console.error("Daily digest publication or delivery failed", scopeId, error.message);
    return response.status(503).json({ error: "Daily digest publication or delivery failed", scopeId });
  }
}
