import { Resend } from "resend";
import { getDigestRegion } from "../shared/digestRegions.js";

const UNSUBSCRIBE_URL = "{{{RESEND_UNSUBSCRIBE_URL}}}";

export function buildWeeklyDigestBroadcast(roundup, configuration) {
  const region = getDigestRegion(roundup?.scopeId);
  const configuredRegion = configuration.regions.find((item) => item.id === region?.id);
  if (!region || !configuredRegion?.topicId) {
    throw new Error("The roundup does not match a configured digest region.");
  }

  const findings = Array.isArray(roundup.findings) ? roundup.findings : [];
  const count = findings.length;
  const weekEnding = formatEmailDate(roundup.generatedAt);
  const subject = `${region.name} birding roundup: ${count || "No"} notable ${count === 1 ? "species" : "species"} this week`;
  const previewText = count
    ? `${findings.slice(0, 3).map((finding) => finding.comName || finding.title).join(", ")}, and more from the past seven days.`
    : `The ${region.name} notable-sightings report for the week ending ${weekEnding}.`;

  return {
    segmentId: configuration.segmentId,
    topicId: configuredRegion.topicId,
    from: configuration.from,
    ...(configuration.replyTo ? { replyTo: configuration.replyTo } : {}),
    name: `Flockline ${region.name} weekly digest ${String(roundup.generatedAt).slice(0, 10)}`,
    subject,
    previewText,
    html: renderDigestHtml(roundup, configuration.publicAppUrl),
    text: renderDigestText(roundup, configuration.publicAppUrl),
    send: true
  };
}

export async function sendWeeklyDigestBroadcast(
  roundup,
  configuration,
  resend = new Resend(configuration.apiKey)
) {
  const broadcast = buildWeeklyDigestBroadcast(roundup, configuration);
  const keyDate = String(roundup.generatedAt || new Date().toISOString()).slice(0, 10);
  const { data, error } = await resend.broadcasts.create(broadcast, {
    headers: { "Idempotency-Key": `flockline-weekly-${roundup.scopeId}-${keyDate}` }
  });
  if (error) {
    throw new Error(error.message || `Resend could not send the ${roundup.scopeLabel} digest.`);
  }
  return data;
}

export function renderDigestHtml(roundup, appUrl = "https://flockline.app") {
  const safeAppUrl = String(appUrl).replace(/\/$/, "");
  const findings = Array.isArray(roundup.findings) ? roundup.findings : [];
  const weekEnding = formatEmailDate(roundup.generatedAt);
  const cards = findings.map((finding) => renderFindingHtml(finding, roundup.scopeId, safeAppUrl)).join("");
  const coverageNotice = roundup.coverage?.failedRegions?.length
    ? `<p style="margin:18px 0 0;padding:12px 14px;background:#f5eadf;border-radius:10px;color:#72543e;font-size:13px;line-height:1.5;">Partial edition: eBird did not respond for ${roundup.coverage.failedRegions.length} ${roundup.coverage.failedRegions.length === 1 ? "state" : "states"}.</p>`
    : "";

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f0eee8;color:#252722;font-family:Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(roundup.summary)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f0eee8;padding:24px 10px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fbfaf6;border:1px solid #d9d5ca;border-radius:18px;overflow:hidden;">
          <tr><td style="padding:30px 32px 8px;font-family:Georgia,serif;font-size:14px;letter-spacing:.18em;text-transform:uppercase;">Flockline</td></tr>
          <tr><td style="padding:2px 32px 0;color:#777970;font-size:11px;letter-spacing:.13em;text-transform:uppercase;">Weekly roundup · ${escapeHtml(roundup.scopeLabel)} · week ending ${escapeHtml(weekEnding)}</td></tr>
          <tr><td style="padding:18px 32px 4px;font-family:Georgia,serif;font-size:30px;line-height:1.22;">The week in rare birds</td></tr>
          <tr><td style="padding:8px 32px 24px;color:#4f514b;font-family:Georgia,serif;font-size:18px;line-height:1.55;">${escapeHtml(roundup.summary)}</td></tr>
          <tr><td style="padding:0 32px;">${coverageNotice}</td></tr>
          <tr><td style="padding:4px 32px 20px;">${cards || renderEmptyEdition(roundup.scopeLabel)}</td></tr>
          <tr><td align="center" style="padding:8px 32px 30px;">
            <a href="${escapeHtml(safeAppUrl)}" style="display:inline-block;background:#384c3e;color:#fff;text-decoration:none;border-radius:999px;padding:13px 20px;font-size:15px;font-weight:700;">Explore the live map</a>
          </td></tr>
          <tr><td style="padding:24px 32px;background:#e9e6de;color:#696b64;font-size:12px;line-height:1.65;">
            Flockline summarizes public eBird notable-observation data. Reports are not population estimates, and locations or counts may change when checklists are reviewed.<br><br>
            You chose the ${escapeHtml(roundup.scopeLabel)} weekly edition. <a href="${UNSUBSCRIBE_URL}" style="color:#4f5d50;">Manage your regional editions or unsubscribe</a>.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function renderDigestText(roundup, appUrl = "https://flockline.app") {
  const safeAppUrl = String(appUrl).replace(/\/$/, "");
  const findings = Array.isArray(roundup.findings) ? roundup.findings : [];
  const sections = findings.map((finding, index) => {
    const lines = [
      `${index + 1}. ${finding.title}`,
      finding.detail
    ];
    if (finding.locName) {
      lines.push(`Location: ${finding.locName}`);
    }
    if (finding.obsDt) {
      lines.push(`Reported: ${formatEmailDate(finding.obsDt)}`);
    }
    if (finding.subId) {
      lines.push(`eBird checklist: https://ebird.org/checklist/${encodeURIComponent(finding.subId)}`);
    }
    if (finding.speciesCode) {
      lines.push(`View on Flockline: ${buildMapUrl(safeAppUrl, finding.speciesCode, roundup.scopeId)}`);
    }
    return lines.join("\n");
  });

  return [
    "FLOCKLINE WEEKLY ROUNDUP",
    `${roundup.scopeLabel} · week ending ${formatEmailDate(roundup.generatedAt)}`,
    "",
    roundup.summary,
    "",
    ...sections.flatMap((section) => [section, ""]),
    `Explore the live map: ${safeAppUrl}`,
    "",
    "Flockline summarizes public eBird notable-observation data. Reports are not population estimates.",
    `Manage your regional editions or unsubscribe: ${UNSUBSCRIBE_URL}`
  ].join("\n");
}

function renderFindingHtml(finding, scopeId, appUrl) {
  const mapUrl = finding.speciesCode ? buildMapUrl(appUrl, finding.speciesCode, scopeId) : "";
  const checklistUrl = finding.subId
    ? `https://ebird.org/checklist/${encodeURIComponent(finding.subId)}`
    : "";
  const meta = [
    finding.locName,
    finding.obsDt ? formatEmailDate(finding.obsDt) : "",
    Number.isFinite(finding.howMany) && finding.howMany > 0
      ? `${finding.howMany.toLocaleString()} ${finding.howMany === 1 ? "bird" : "birds"}`
      : ""
  ].filter(Boolean).join(" · ");
  const links = [
    mapUrl ? `<a href="${escapeHtml(mapUrl)}" style="color:#38503f;font-weight:700;text-decoration:none;">View on map</a>` : "",
    checklistUrl ? `<a href="${escapeHtml(checklistUrl)}" style="color:#38503f;font-weight:700;text-decoration:none;">eBird checklist</a>` : ""
  ].filter(Boolean).join("&nbsp;&nbsp;&nbsp;");

  return `<div style="padding:24px 0;border-top:1px solid #ddd9cf;">
    <div style="color:#74766e;font-size:10px;letter-spacing:.14em;text-transform:uppercase;">${escapeHtml(kindLabel(finding.kind))}</div>
    <h2 style="margin:7px 0 8px;font-family:Georgia,serif;font-size:22px;font-weight:400;line-height:1.3;">${escapeHtml(finding.title)}</h2>
    <p style="margin:0;color:#50524c;font-size:15px;line-height:1.6;">${escapeHtml(finding.detail)}</p>
    ${meta ? `<p style="margin:12px 0 0;color:#76786f;font-size:12px;line-height:1.5;">${escapeHtml(meta)}</p>` : ""}
    ${links ? `<p style="margin:13px 0 0;font-size:13px;">${links}</p>` : ""}
  </div>`;
}

function renderEmptyEdition(scopeLabel) {
  return `<div style="padding:24px 0;border-top:1px solid #ddd9cf;color:#50524c;font-size:15px;line-height:1.6;">No rare or locally notable sightings were returned for ${escapeHtml(scopeLabel)} this week.</div>`;
}

function buildMapUrl(appUrl, speciesCode, scopeId) {
  const url = new URL(appUrl);
  url.searchParams.set("bird", speciesCode);
  url.searchParams.set("days", "7");
  url.searchParams.set("region", scopeId);
  return url.toString();
}

function formatEmailDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value || "").slice(0, 10);
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York"
  }).format(parsed);
}

function kindLabel(kind) {
  if (kind === "wide") return "Across the region";
  if (kind === "surge") return "Notable run";
  return "Rare report";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
