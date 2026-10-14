// Shared checklists often repeat the same place and start time. This feed lacks
// eBird's groupId, so place/time grouping is only a duplicate-reduction heuristic,
// never proof of an independent outing. Reports without a start time stay separate.
export function outingKey(report) {
  const when = String(report?.observedAt ?? report?.obsDt ?? "");
  const where = report?.locId || report?.locName;
  return where && /\d{1,2}:\d{2}/.test(when) ? `${where}|${when}` : `sub:${report?.subId}`;
}

export function countOutings(reports) {
  return new Set((reports || []).map(outingKey)).size;
}
