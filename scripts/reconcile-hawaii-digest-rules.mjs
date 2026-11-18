// Reconcile only facts explicitly supported by the versioned Hawaii evidence ledger.
import validation from "../shared/hawaiiDigestValidation.json" with { type: "json" };

const conditions = {
  "current_lifetime_total_unverified": "Current lifetime total unverified. Historical checklist membership or Va status alone does not establish the current five-record condition.",
  "pending_committee_decision_after_split": "The 2025 report leaves American Pipit under review after its split from Siberian Pipit; acceptance and lifetime total remain unverified.",
  "taxonomic_split_requires_record_reidentification": "The historical source taxon has since split. Record reidentification and the current lifetime total require verification.",
  "taxonomic_lump_requires_combined_record_total": "The historical source taxon has since lumped. The combined taxon's current lifetime total requires verification.",
  "historical_breeding_status_and_current_total_unverified": "The historical checklist includes breeding status. A current lifetime total within the committee's five-record threshold has not been established."
};

export function reconcileHawaiiDigestRules(registry) {
  const names = new Set();
  const rules = [];
  for (const entry of validation.entries) {
    if (names.has(entry.name)) throw new Error(`Duplicate Hawaii evidence: ${entry.name}`);
    names.add(entry.name);
    if (!["eligible", "hold", "exclude"].includes(entry.decision))
      throw new Error(`Unknown Hawaii decision: ${entry.name}`);
    if (entry.decision === "exclude") continue;
    const rule = {
      id: "HI-" + entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      state: "US-HI",
      name: entry.name,
      sourceId: "HI",
      kind: "state-review",
      sourceUrl: entry.sourceUrl,
    };
    if (entry.decision === "eligible") {
      if (!Number.isInteger(entry.records) || entry.records < 1 || entry.records > 5 ||
          entry.recordsAsOf !== validation.reportCoverageEnd ||
          entry.sourceUrl !== validation.reportUrl)
        throw new Error(`Unsupported Hawaii lifetime total: ${entry.name}`);
      rule.documentedRecords = entry.records;
      rule.recordsAsOf = entry.recordsAsOf;
      rule.reportYear = "2025";
    } else {
      if (!conditions[entry.reason])
        throw new Error(`Unknown Hawaii hold reason: ${entry.name}`);
      rule.requiresReview = true;
      rule.condition = conditions[entry.reason];
    }
    rules.push(rule);
  }
  registry.rules = registry.rules.filter((rule) => rule.sourceId !== "HI");
  registry.rules.push(...rules);
  const source = registry.sources.find((source) => source.id === "HI");
  if (!source) throw new Error("Hawaii source metadata is missing");
  source.scope = validation.limits;
  source.supportingSources = [validation.reportUrl, validation.policyUrl];
  source.validationCapture = "shared/hawaiiDigestValidation.json";
  source.validationReviewed = validation.reviewed;
  registry.version = "review-lists-2026-11-17-hi-validation";
  return registry;
}
