import type { HistoricalBaseline, HistoricalBaselineUnavailableReason } from "../lib/historicalBaseline.js";
import { normalizeHistoricalBaseline } from "../shared/historicalFrequency.js";

const missingContext: Record<HistoricalBaselineUnavailableReason, string> = {
  county_missing: "County context is unavailable for this report.",
  county_not_covered: "Historical baseline not yet available for this county.",
  date_invalid: "Historical context needs a valid observation date.",
  baseline_not_prior: "No historical baseline is available from before this observation year.",
  species_not_covered: "This species is not covered by the county baseline.",
  sample_unavailable: "No historical checklist sample is available for this period.",
  frequency_unavailable: "Historical reporting frequency is unavailable for this species and period.",
  frequency_ambiguous: "eBird records this species in this period, but the export does not establish an exact complete-checklist percentage.",
};

type HistoricalFinding = {
  historicalBaseline?: HistoricalBaseline;
  countyCode?: string | null;
  countyName?: string | null;
  regionCode?: string;
  region?: string;
};

export default function HistoricalContext({ finding }: { finding: HistoricalFinding }) {
  // Browser caches can contain snapshots created before a source interpretation
  // correction, so apply the same guard at the final display boundary too.
  const baseline = normalizeHistoricalBaseline(finding.historicalBaseline);
  if (baseline?.status !== "available") {
    const county = /^US-[A-Z]{2}-\d{3}$/.test(finding.countyCode || "") ? finding.countyCode : null;
    const state = /^US-[A-Z]{2}$/.test(finding.regionCode || "") ? finding.regionCode : null;
    const code = county || state;
    const sourceUrl = baseline?.sourceUrl || (code ? `https://ebird.org/barchart?r=${encodeURIComponent(code)}` : null);
    return (
      <div className="historical-context unavailable">
        <p>{baseline ? missingContext[baseline.reason] : "Historical baseline not yet available for this report."}</p>
        {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">View eBird's {baseline?.sourceUrl ? "source" : county ? "county" : "state"} history →</a> : null}
        {baseline?.reason === "frequency_ambiguous" ? <p><a href="/methodology#historical-context">Why this percentage is withheld</a></p> : null}
      </div>
    );
  }

  const percent = baseline.frequency > 0 && baseline.frequency < 0.0001
    ? "less than 0.01%"
    : new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }).format(baseline.frequency);
  return (
    <div className="historical-context">
      <strong className="historical-context-label">Historical context</strong>
      <p>
        <strong>{percent}</strong> of complete eBird checklists reported {baseline.comName} in{" "}
        {baseline.area.name} during {baseline.season.label}, {baseline.years.start}–{baseline.years.end}.
      </p>
      <p className="historical-context-sample">Based on {baseline.checklistCount.toLocaleString("en-US")} complete checklists. County reporting frequency, not a rarity rating.</p>
      <details>
        <summary>Source and limits</summary>
        <p>
          This county-wide sample pools the selected years. It does not establish how regularly
          the species returned each year, how likely you are to find it at this spot, or whether
          this flock size is unusual. Percentages can be unstable when few checklists are available.
          Habitat, observer effort and repeated visits affect reporting.
          A zero does not establish absence.
        </p>
        <p>
          {baseline.sourceAttribution}. Downloaded {baseline.downloadedAt.slice(0, 10)}.
          {" "}<a href={baseline.sourceUrl} target="_blank" rel="noreferrer">eBird source chart</a>
          {" · "}<a href="/methodology#historical-context">Method</a>
          {" · "}<a href={baseline.termsUrl} target="_blank" rel="noreferrer">Data terms</a>
        </p>
      </details>
    </div>
  );
}
