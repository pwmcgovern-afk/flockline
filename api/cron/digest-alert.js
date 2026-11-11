import { runDigestAlert } from "../../lib/digestAlert.js";
import { archiveConfigured } from "../../lib/roundupArchive.js";

export const config = { maxDuration: 60 };

// Scheduled at 16:15 UTC on Mondays, after the 10 a.m. Eastern delivery hour in
// both daylight-saving (14 UTC) and standard time (15 UTC).
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
    response.status(503).json({ error: "Digest storage is not configured." });
    return;
  }
  // A manual run can check an earlier Monday with ?date=YYYY-MM-DD.
  const requested = String(request.query?.date || "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : new Date().toISOString().slice(0, 10);
  try {
    const result = await runDigestAlert({ date });
    console.info(JSON.stringify({ event: "digest_alert_checked", date, healthy: result.healthy, alerted: result.alerted }));
    response.status(200).json({ ok: true, date, healthy: result.healthy, alerted: result.alerted, problems: result.problems });
  } catch (error) {
    console.error(JSON.stringify({ event: "digest_alert_failed", date, message: error?.message }));
    response.status(500).json({ ok: false, error: "The digest alert check failed." });
  }
}
