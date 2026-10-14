const REVIEW_LABELS = new Set([
  "Accepted by eBird", "Not reviewed by eBird", "Not accepted by eBird", "Review status unavailable",
]);

export function chatReviewStatus(record) {
  if (record.obsValid === true) return "Accepted by eBird";
  if (record.obsValid === false && record.obsReviewed === false) return "Not reviewed by eBird";
  if (record.obsValid === false && record.obsReviewed === true) return "Not accepted by eBird";
  return "Review status unavailable";
}

// Only these structured observation lists are source evidence. Model prose and
// user-supplied conversation history never contribute a trusted checklist ID.
export function chatSourcesFromTool(result) {
  const rows = [result?.topLocations, result?.notable, result?.sightings, result?.recent]
    .flatMap((items) => Array.isArray(items) ? items : []);
  return rows.filter((row) => /^S\d{6,15}$/.test(row?.subId || "")).map((row) => ({
    subId: row.subId,
    speciesCode: row.speciesCode || result.speciesCode || "",
    comName: row.comName || result.comName || "Bird report",
    locName: row.locName || "Location not supplied",
    obsDt: row.obsDt || null,
    reviewStatus: REVIEW_LABELS.has(row.reviewStatus) ? row.reviewStatus : "Review status unavailable",
  }));
}

export function selectChatSources(reply, sources) {
  const citedIds = new Set(String(reply).match(/\bS\d{6,15}\b/g) || []);
  const unique = new Map(sources.map((source) => [`${source.subId}:${source.speciesCode}`, source]));
  return [...unique.values()].sort((a, b) => Number(citedIds.has(b.subId)) - Number(citedIds.has(a.subId))).slice(0, 12);
}
