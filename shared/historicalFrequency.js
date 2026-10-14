// eBird histogram exports can use 0.0015 for an occurrence recorded on an
// incomplete checklist. The export does not identify that case separately
// from a genuine frequency of the same value. Preserve the raw registry, but
// never publish this ambiguous value as an exact complete-checklist percentage.
// Evidence and the reproducible source audit are in docs/RARITY_BASELINE.md.
export function normalizeHistoricalBaseline(baseline) {
  if (baseline?.status !== "available"
      || baseline.methodVersion !== "ebird-barchart-48-v1"
      || baseline.frequency !== 0.0015) return baseline;
  return {
    status: "unavailable",
    reason: "frequency_ambiguous",
    confidence: null,
    annualRecurrence: null,
    sourceUrl: baseline.sourceUrl,
  };
}
