import { getDigestConfiguration } from "../../lib/digestSubscriptions.js";
import { archiveConfigured } from "../../lib/roundupArchive.js";
import { runDigestEdition } from "../../lib/digestDelivery.js";

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
  // The guard distinguishes the two UTC schedules, not individual minutes.
  // A delayed invocation at 10:01 must not silently discard the entire week.
  // Durable leases and a saved broadcast ID protect repeated attempts.
  return parts.weekday === "Mon" && parts.hour === "10";
}

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
  const mode = String(request.query?.mode || "send");
  if (!["send", "check"].includes(mode)) {
    response.status(400).json({ error: "Choose send or check mode." });
    return;
  }
  const configuration = getDigestConfiguration();
  const region = configuration.regions.find((item) => item.id === request.query?.region);
  if (!region) {
    response.status(400).json({ error: "Choose one digest region." });
    return;
  }
  if (mode === "send" && !isWeeklyDigestDeliveryTime()) {
    console.info(JSON.stringify({ event: "weekly_digest_skipped", region: region.id, reason: "Outside delivery hour." }));
    response.status(200).json({ ok: true, skipped: true, reason: "Outside the Monday 10 a.m. Eastern delivery hour." });
    return;
  }
  if (!configuration.ready || !archiveConfigured()) {
    console.error(JSON.stringify({ event: "weekly_digest_configuration_failed", region: region.id }));
    response.status(503).json({ error: "Digest delivery is not configured.", missing: [
      ...configuration.missing, ...(!archiveConfigured() ? ["BLOB_READ_WRITE_TOKEN"] : [])
    ] });
    return;
  }
  const startedAt = Date.now();
  console.info(JSON.stringify({ event: "weekly_digest_started", region: region.id, mode }));
  try {
    const result = await runDigestEdition({
      configuration, region, date: new Date().toISOString().slice(0, 10), checkOnly: mode === "check"
    });
    // Return the operational receipt, not the full saved edition.
    const { roundup: _roundup, ...receipt } = result;
    console.info(JSON.stringify({ event: "weekly_digest_completed", mode, durationMs: Date.now() - startedAt, ...receipt }));
    response.status(200).json({ ok: true, ...receipt });
  } catch (error) {
    console.error(JSON.stringify({ event: "weekly_digest_failed", region: region.id, mode, message: error?.message }));
    response.status(500).json({ ok: false, region: region.id, error: "Digest processing failed. The next scheduled attempt can resume." });
  }
}
