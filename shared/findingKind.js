// One label per finding kind across Insights, the roundup drawer, archived
// issues and the weekly email.
export function findingKindLabel(kind) {
  if (kind === "wide") return "Across the region";
  if (kind === "surge") return "Notable run";
  return "Rare report";
}
