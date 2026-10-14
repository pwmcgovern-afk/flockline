const EDITORIAL_POLICY = "source-facts-v1";
const CORRECTION_NOTE = "Descriptions updated to show recorded facts only. Original sightings and dates are unchanged.";

// Rebuild prose from structured evidence at every publication boundary. Old
// model-written titles and descriptions are deliberately never consulted.
export function factualFinding(finding = {}, { count = finding.howMany } = {}) {
  const name = cleanText(finding.comName);
  const place = [cleanText(finding.locName), cleanText(finding.region || finding.regionName)]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(", ");
  const date = observationDate(finding.obsDt);
  const description = name
    ? `${name} was reported${place ? ` at ${place}` : ""}${date ? ` on ${date}` : ""}.`
    : /^S\d{6,15}$/.test(String(finding.subId || ""))
      ? "See the linked eBird checklist for the recorded observation."
      : "This saved entry does not include enough source detail to restate the observation.";
  const countText = checklistCount(count);
  return {
    ...finding,
    kind: "notable",
    title: name || "eBird report",
    detail: `${description}${countText ? ` ${countText}` : ""}`,
    generatedBy: "template",
  };
}

export function factualEditorialPayload(payload = {}, { correctLegacy = false } = {}) {
  const findings = (Array.isArray(payload.findings) ? payload.findings : [])
    .map((finding) => factualFinding(finding));
  return {
    ...payload,
    generator: "template",
    editorialPolicy: EDITORIAL_POLICY,
    ...(correctLegacy && payload.editorialPolicy !== EDITORIAL_POLICY
      ? { editorialNote: CORRECTION_NOTE }
      : {}),
    summary: findings.length
      ? "Selected reports from eBird's notable feed, with source checklist links where available. This selection is not a ranking of rarity."
      : "No reports are included in this edition. This does not establish that no birds were reported in the region.",
    findings,
  };
}

export function reviewStatusLabel(finding = {}) {
  if (finding.obsValid === true) return "Accepted by eBird";
  if (finding.obsValid === false && finding.obsReviewed === false) return "Not yet reviewed";
  if (finding.obsValid === false && finding.obsReviewed === true) return "Not accepted by eBird";
  return "Review status unavailable";
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function observationDate(value) {
  const date = cleanText(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(parsed);
}

function checklistCount(value) {
  if (value === null || value === undefined || value === "") return "";
  const count = String(value).trim();
  if (count.toUpperCase() === "X") return "The featured checklist records presence without a count.";
  if (/^\d+(?:\.\d+)?$/.test(count)) {
    return `The featured checklist recorded ${count} ${Number(count) === 1 ? "bird" : "birds"}.`;
  }
  if (/^\d+(?:\.\d+)?-\d+(?:\.\d+)?$/.test(count)) {
    return `The featured checklist recorded ${count} birds.`;
  }
  return "";
}
