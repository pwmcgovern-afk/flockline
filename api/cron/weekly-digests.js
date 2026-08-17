import { Resend } from "resend";
import { getWeeklyRoundup } from "../../lib/ebirdCore.js";
import { sendWeeklyDigestBroadcast } from "../../lib/digestEmail.js";
import { getDigestConfiguration } from "../../lib/digestSubscriptions.js";

export const config = { maxDuration: 300 };

const DELIVERY_TIME_ZONE = "America/New_York";

// Vercel cron expressions run in UTC. The deployment calls this route at both
// possible UTC equivalents of 10:00 a.m. Eastern, then this guard lets only the
// correct daylight-saving or standard-time invocation send mail.
export function isWeeklyDigestDeliveryTime(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: DELIVERY_TIME_ZONE,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(now).map((part) => [part.type, part.value])
  );
  return parts.weekday === "Mon" && parts.hour === "10" && parts.minute === "00";
}

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

  if (!isWeeklyDigestDeliveryTime()) {
    response.status(200).json({
      ok: true,
      skipped: true,
      reason: "Not 10:00 a.m. Eastern."
    });
    return;
  }

  const configuration = getDigestConfiguration();
  if (!configuration.ready) {
    response.status(503).json({
      error: "Digest delivery is not configured.",
      missing: configuration.missing
    });
    return;
  }

  const resend = new Resend(configuration.apiKey);
  const results = [];
  // Run editions one at a time. Each regional eBird pull already has bounded
  // concurrency, so parallelizing all five here would create an unnecessary
  // burst of upstream requests.
  for (const region of configuration.regions) {
    try {
      const roundup = await getWeeklyRoundup({ region: region.id, fresh: "1" });
      if (roundup.source !== "ebird") {
        throw new Error("Live eBird data was unavailable.");
      }
      const sent = await sendWeeklyDigestBroadcast(roundup, configuration, resend);
      results.push({ region: region.id, ok: true, broadcastId: sent?.id || null });
    } catch (error) {
      console.error(JSON.stringify({
        event: "weekly_digest_failed",
        region: region.id,
        message: error?.message
      }));
      results.push({ region: region.id, ok: false, error: error?.message || "Unknown error" });
    }
  }

  const failed = results.filter((result) => !result.ok);
  response.status(failed.length ? 500 : 200).json({
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    results
  });
}
