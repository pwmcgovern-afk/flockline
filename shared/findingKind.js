// One label per finding kind across Insights, the roundup drawer, archived
// issues and the weekly email.
export function findingKindLabel() {
  // Legacy kinds used inferred rarity and trend labels. They describe the same
  // source feed and should not keep implying those conclusions in old issues.
  return "eBird notable report";
}
