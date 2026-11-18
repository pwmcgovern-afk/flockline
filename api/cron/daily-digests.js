import { dailyDate } from "../../shared/dailyDigest.js";
import { DIGEST_REGIONS } from "../../shared/digestRegions.js";
import { ensureDailyDigest } from "../../lib/dailyDigestArchive.js";

import { deliverDailyDigest } from "../../lib/dailyDigestDelivery.js";

export const config = { maxDuration: 180 };
export function dailyGenerationHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(now)) === 9;
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
    const receipt = await deliverDailyDigest(digest);
    return response.status(200).json({ ok: true, delivery: receipt.status, scopeId, date: digest.date, findings: digest.findings.length });
  } catch (error) {
    console.error("Daily digest publication or delivery failed", scopeId, error.message);
    return response.status(503).json({ error: "Daily digest publication or delivery failed", scopeId });
  }
}
