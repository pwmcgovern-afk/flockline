import registry from "../shared/digestSelectionRules.json" with { type: "json" };
import { getState } from "../shared/usGeography.js";

export const DIGEST_SELECTION_VERSION = "review-evidence-v1";
const normalize = (value) =>
  String(value || "")
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
const sources = new Map(registry.sources.map((source) => [source.id, source]));
const rules = new Map();
for (const rule of registry.rules) {
  const key = `${rule.state}:${normalize(rule.name)}`;
  rules.set(key, [...(rules.get(key) || []), rule]);
}

// Source dates have no time zones. The editorial week is calendar dates in
// Eastern time, ending on the Sunday before the current week's Monday.
export function digestWeek(now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const monday = new Date(`${date}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const end = new Date(monday);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(monday);
  start.setUTCDate(start.getUTCDate() - 7);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export function assessDigestReport(row, week) {
  const date = String(row.obsDt || "").slice(0, 10);
  if (!row.speciesCode || !row.comName || !/^S\d{6,15}$/.test(row.subId || ""))
    return { decision: "exclude", reason: "invalid_source" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < week.start || date > week.end)
    return { decision: "exclude", reason: "outside_week" };
  const state = row.regionCode || row.subnational1Code;
  const candidates = rules.get(`${state}:${normalize(row.comName)}`) || [];
  const rule = candidates.find((item) => matchesSeason(item, date));
  if (!rule) return { decision: "exclude", reason: "no_supported_rule" };
  if (row.obsReviewed === true && row.obsValid === false)
    return { decision: "exclude", reason: "not_accepted" };
  // Review-list membership establishes relevance, not the identification.
  // For automatic publication require eBird acceptance; other candidates are
  // retained in the ledger for a future explicit evidence review.
  if (row.obsValid !== true)
    return {
      decision: "hold",
      reason: "observation_not_accepted",
      ruleId: rule.id,
    };
  const source = sources.get(rule.sourceId);
  const area = getState(state)?.name || state;
  return {
    decision: "eligible",
    reason: rule.kind,
    ruleId: rule.id,
    significance: {
      policyVersion: DIGEST_SELECTION_VERSION,
      registryVersion: registry.version,
      ruleId: rule.id,
      kind: rule.kind,
      sourceUrl: source.url,
      sourceTitle: source.authority,
      sourceRetrieved: source.retrieved,
      area,
      explanation:
        rule.kind === "seasonal-outside"
          ? `${source.authority} requests documentation more than one month outside this species' listed occurrence dates (${rule.arrival} to ${rule.departure}, where A-D are weeks of the month). This report meets that seasonal condition.`
          : rule.kind === "seasonal-review"
            ? `${source.authority} requests documentation of ${row.comName} during ${rule.start} through ${rule.end}. This report falls within that seasonal review window.`
            : `${row.comName} is on the ${source.authority} review list for ${area}. The committee requests documentation of reports covered by this rule.`,
    },
  };
}

export function selectDigestReports(
  rows,
  { now = new Date(), limit = 6, regions = [] } = {},
) {
  const week = digestWeek(now);
  const seen = new Set();
  const assessed = [];
  for (const row of rows) {
    const key = `${row.speciesCode}:${row.subId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    assessed.push({ row, ...assessDigestReport(row, week) });
  }
  const eligible = assessed
    .filter((item) => item.decision === "eligible")
    .sort(
      (a, b) =>
        (a.reason === "state-review" ? 0 : 1) -
          (b.reason === "state-review" ? 0 : 1) ||
        String(b.row.obsDt).localeCompare(String(a.row.obsDt)) ||
        String(a.row.speciesCode).localeCompare(String(b.row.speciesCode)) ||
        String(a.row.subId).localeCompare(String(b.row.subId)),
    );
  const species = new Set();
  const selected = [];
  for (const item of eligible) {
    if (species.has(item.row.speciesCode)) {
      item.decision = "exclude";
      item.reason = "species_already_featured";
      continue;
    }
    if (selected.length >= limit) {
      item.decision = "exclude";
      item.reason = "edition_limit";
      continue;
    }
    species.add(item.row.speciesCode);
    item.decision = "selected";
    selected.push({ ...item.row, significance: item.significance });
  }
  return {
    selected,
    selection: {
      version: DIGEST_SELECTION_VERSION,
      registryVersion: registry.version,
      week,
      sourceStates: registry.sources
        .map((source) => source.state)
        .filter((state) => regions.includes(state)),
      uncoveredStates: regions.filter(
        (state) => !registry.sources.some((source) => source.state === state),
      ),
      coverageNote:
        "Selection uses a limited set of documented state review rules. Unmatched reports are not classified as ordinary; conditional and unsupported rules can be omitted.",
      ledger: assessed.map(({ row, decision, reason, ruleId }) => ({
        speciesCode: row.speciesCode,
        subId: row.subId,
        observedAt: row.obsDt,
        state: row.regionCode || row.subnational1Code || null,
        decision,
        reason,
        ...(ruleId ? { ruleId } : {}),
      })),
    },
  };
}

function matchesSeason(rule, date) {
  if (rule.kind === "seasonal-review")
    return date.slice(5) >= rule.start && date.slice(5) <= rule.end;
  if (rule.kind !== "seasonal-outside") return true;
  // Use a leap reference year and the outside edge of each week. A full
  // calendar month of tolerance prevents normal arrival variation qualifying.
  const observed = new Date(`2000-${date.slice(5)}T12:00:00Z`).getTime();
  const edge = (value, end) => {
    const match = value.match(/^(\d{1,2})([ABCD])$/);
    const month = Number(match[1]);
    const week = "ABCD".indexOf(match[2]);
    const day = end
      ? week === 3
        ? new Date(2000, month, 0).getDate()
        : (week + 1) * 7
      : week * 7 + 1;
    return new Date(Date.UTC(2000, month - 1, day, 12));
  };
  const start = edge(rule.arrival, false);
  const finish = edge(rule.departure, true);
  // Clamp calendar-month additions instead of JS date overflow at month end.
  const shift = (value, delta) => {
    const month = value.getUTCMonth() + delta;
    return new Date(
      Date.UTC(
        value.getUTCFullYear(),
        month,
        Math.min(
          value.getUTCDate(),
          new Date(Date.UTC(value.getUTCFullYear(), month + 1, 0)).getUTCDate(),
        ),
        12,
      ),
    );
  };
  const arrival = shift(start, -1).getTime();
  const departure = shift(finish, 1).getTime();
  // Check neighboring annual occurrences as well, including winter intervals.
  for (const offset of [-1, 0, 1]) {
    const a = new Date(arrival);
    a.setUTCFullYear(a.getUTCFullYear() + offset);
    const b = new Date(departure);
    b.setUTCFullYear(b.getUTCFullYear() + offset + (finish < start ? 1 : 0));
    if (observed >= a.getTime() && observed <= b.getTime()) return false;
  }
  return true;
}
