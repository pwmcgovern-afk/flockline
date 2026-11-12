import { Resend } from "resend";
import { DIGEST_REGIONS } from "../shared/digestRegions.js";
import { createDigestStore, deliveryPath } from "./digestDeliveryStore.js";

// Runs once after Monday's delivery hour. Healthy weeks stay silent; a week
// where any region did not go out, or went out without all its artwork,
// sends one email to the owner. Three editions were once held for three weeks
// with nothing but a status file to show for it.
// "submitted" an hour after the send window means Resend never finished the
// campaign, so it is reported too.
const HEALTHY = new Set(["sent", "no_recipients"]);

export function alertPath(date) {
  return `digest-alert/${date}.json`;
}

// Plain-language reason for each receipt status. The alert is read by a
// person, not a developer; the raw status stays in the details section.
function describeProblem(status, value) {
  const birds = value?.findings ?? 6;
  const missingArt = value?.unresolved?.length;
  switch (status) {
    case "missing":
      return "no record that the send job ran";
    case "awaiting_illustrations":
      return missingArt
        ? `held because ${missingArt} of ${birds} bird drawings could not be made`
        : "held waiting for bird drawings";
    case "failed":
      return `the send job hit an error${value?.failure?.phase ? ` during the "${String(value.failure.phase).replace(/_/g, " ")}" step` : ""}`;
    case "submitted":
      return "handed to the email service, which never confirmed delivery";
    default:
      return "the send job started but never finished";
  }
}

export function summarizeDigestWeek(date, records) {
  const problems = [];
  for (const region of DIGEST_REGIONS) {
    const value = records[region.id];
    const status = value?.status || "missing";
    if (!HEALTHY.has(status)) {
      problems.push({
        region: region.id, label: region.name, severity: "not_sent", status,
        text: `${region.name}: not sent, ${describeProblem(status, value)}.`
      });
    } else if (value?.partialArtwork) {
      const missing = value.unresolved?.length;
      problems.push({
        region: region.id, label: region.name, severity: "partial", status,
        text: `${region.name}: ${status === "no_recipients" ? "web page published" : "sent"}, but ${missing ? `${missing} of ${value.findings ?? 6}` : "some"} birds had no drawing.`
      });
    }
  }
  return { date, healthy: problems.length === 0, problems };
}

export function formatAlertDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC"
  }).format(new Date(`${date}T12:00:00Z`));
}

export function buildDigestAlertEmail(summary, { from, to, appUrl }) {
  const notSent = summary.problems.filter((problem) => problem.severity === "not_sent").length;
  const day = formatAlertDate(summary.date);
  const subject = notSent
    ? `Flockline digest did not go out for ${notSent} ${notSent === 1 ? "region" : "regions"} (${day})`
    : `Flockline digest went out with missing drawings (${day})`;
  const heldForDrawings = summary.problems.some((problem) => problem.status === "awaiting_illustrations");
  const drawingTrouble = heldForDrawings || summary.problems.some((problem) => problem.severity === "partial");
  const text = [
    `Flockline digest check for ${day}.`,
    "",
    ...summary.problems.map((problem) => `- ${problem.text}`),
    "",
    ...(drawingTrouble
      ? [`Missing drawings usually mean the image service is failing (often out of credits or a retired model).${heldForDrawings ? " Missed web pages are published automatically on Monday afternoon once the drawings can be made." : ""}`, ""]
      : []),
    "What to do: forward this email to Claude or Codex and ask it to fix the Flockline weekly digest. The details below are for it.",
    "",
    "Details for the agent",
    `Edition date: ${summary.date}`,
    ...summary.problems.map((problem) => `${problem.region}: receipt status ${problem.status}`),
    `Receipts: digest-delivery/${summary.date}/REGION.json in the Flockline Blob store`,
    "Runbook: docs/DIGEST_DELIVERY.md in the pwmcgovern-afk/flockline repo",
    `Archive: ${appUrl}/roundup`,
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

  const values = await Promise.all(DIGEST_REGIONS.map((region) => store.read(deliveryPath(date, region.id))));
  const records = Object.fromEntries(DIGEST_REGIONS.map((region, index) => [region.id, values[index]?.value || null]));
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
