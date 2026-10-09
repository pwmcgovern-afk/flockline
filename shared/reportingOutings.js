// eBird gives every birder on a shared outing their own copy of the checklist,
// with the same location and start time. Ten people on one boat therefore
// produce ten checklists for one sighting. Group those copies so a single
// shared outing is not presented as many independent reports. Checklists
// without a start time stay separate rather than guessing.
export function outingKey(report) {
  const when = String(report?.observedAt ?? report?.obsDt ?? "");
  const where = report?.locId || report?.locName;
  return where && /\d{1,2}:\d{2}/.test(when) ? `${where}|${when}` : `sub:${report?.subId}`;
}

export function countOutings(reports) {
  return new Set((reports || []).map(outingKey)).size;
}
