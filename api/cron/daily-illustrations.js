import { dailyDate } from "../../shared/dailyDigest.js";
import { illustrateDailyEditions } from "../../lib/dailyDigestDelivery.js";
import { dailyGenerationHour } from "./daily-digests.js";

export const config = { maxDuration: 300 };

// Runs at 9:06 and 9:21 Eastern, after the 9:00 editions are published, so the
// :15 and :30 delivery attempts find the new plates in the cache.
export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") { response.setHeader("Allow", "GET"); return response.status(405).end(); }
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret || request.headers.authorization !== "Bearer " + secret)
    return response.status(401).json({ error: "Unauthorized" });
  const now = new Date();
  if (!dailyGenerationHour(now)) return response.status(200).json({ skipped: true, reason: "outside_daily_hour" });
  try {
    const result = await illustrateDailyEditions(dailyDate(now), {
      // Vercel supplies fresh gateway credentials on the cron request; the
      // environment token is for builds and can already be expired.
      environment: { ...process.env, VERCEL_OIDC_TOKEN: request.headers["x-vercel-oidc-token"] || process.env.VERCEL_OIDC_TOKEN },
    });
    console.info(JSON.stringify({ event: "daily_illustrations_completed", ...result }));
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error(JSON.stringify({ event: "daily_illustrations_failed", message: error.message }));
    return response.status(500).json({ ok: false, error: "Daily illustration preparation failed." });
  }
}
