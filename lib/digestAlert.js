import { Resend } from "resend";
import { DIGEST_REGIONS } from "../shared/digestRegions.js";
import { createDigestStore, deliveryPath } from "./digestDeliveryStore.js";

// Runs once after Monday's delivery hour. Healthy weeks stay silent; a week
// where any region did not go out, or went out without all its artwork,
// sends one email to the owner. Three editions were once held for three weeks
// with nothing but a status file to show for it.
const HEALTHY = new Set(["sent", "submitted", "no_recipients"]);

export function alertPath(date) {
  return `digest-alert/${date}.json`;
}

export function summarizeDigestWeek(date, records) {
  const problems = [];
  for (const region of DIGEST_REGIONS) {
    const value = records[region.id];
    const status = value?.status || "missing";
    if (!HEALTHY.has(status)) {
      const detail = status === "awaiting_illustrations" && value?.unresolved?.length
        ? ` (no artwork for ${value.unresolved.length} of ${value.findings ?? "?"} birds)`
        : status === "failed" && value?.failure
          ? ` (failed during ${value.failure.phase || "unknown phase"}, ${value.failure.code})`
          : status === "missing" ? " (no delivery record: the job may not have run)" : "";
      problems.push({ region: region.id, label: region.name, severity: "not_sent", text: `${region.name}: not sent, status ${status}${detail}` });
    } else if (value?.partialArtwork && status !== "no_recipients") {
      problems.push({
        region: region.id, label: region.name, severity: "partial",
        text: `${region.name}: sent, but ${value.unresolved?.length ?? "some"} birds had no artwork`
      });
    }
  }
  return { date, healthy: problems.length === 0, problems };
}

export function buildDigestAlertEmail(summary, { from, to, appUrl }) {
  const notSent = summary.problems.filter((problem) => problem.severity === "not_sent").length;
  const subject = notSent
    ? `Flockline digest did not go out for ${notSent} ${notSent === 1 ? "region" : "regions"} (${summary.date})`
    : `Flockline digest went out with missing artwork (${summary.date})`;
  const text = [
    `Monday ${summary.date} digest check.`,
    "",
    ...summary.problems.map((problem) => `- ${problem.text}`),
    "",
    ...(summary.problems.some((problem) => /artwork/.test(problem.text))
      ? ["Missing artwork usually means image generation is failing: check AI Gateway credits and the illustration_model_unavailable logs in Vercel."]
      : []),
    `Status per region: node scripts/digest-status.mjs --date ${summary.date}`,
    `Archive: ${appUrl}/roundup`,
    "Runbook: docs/DIGEST_DELIVERY.md in the flockline repo",
    "",
    "You only get this email when something is wrong."
  ].join("\n");
  return { from, to, subject, text };
}

export async function runDigestAlert({ date, environment = process.env }, {
  store = createDigestStore(),
  send = async (message) => {
    const { error } = await new Resend(String(environment.RESEND_API_KEY || "")).emails.send(message, { idempotencyKey: `digest-alert-${date}` });
    if (error) throw new Error(error.message || "Resend could not send the alert.");
  }
} = {}) {
  const to = String(environment.DIGEST_ALERT_EMAIL || "").trim();
  if (!to) throw new Error("DIGEST_ALERT_EMAIL is not configured.");

  const records = {};
  for (const region of DIGEST_REGIONS) {
    records[region.id] = (await store.read(deliveryPath(date, region.id)))?.value || null;
  }
  const summary = summarizeDigestWeek(date, records);
  if (summary.healthy) return { ...summary, alerted: false };

  // One alert per Monday, even if the job is retried or invoked by hand.
  if (await store.read(alertPath(date))) return { ...summary, alerted: false, alreadyAlerted: true };
  const message = buildDigestAlertEmail(summary, {
    from: String(environment.RESEND_FROM || "Flockline <digest@updates.flockline.app>").trim(),
    to,
    appUrl: String(environment.PUBLIC_APP_URL || "https://flockline.app").trim().replace(/\/$/, "")
  });
  await send(message);
  // The record holds no address: the store is public.
  await store.write(alertPath(date), { date, sentAt: new Date().toISOString(), problems: summary.problems }).catch(() => {});
  return { ...summary, alerted: true };
}
