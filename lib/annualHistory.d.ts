import type { HistoricalBaseline } from "./historicalBaseline.js";
export interface AnnualPeriodEvidence {
  reportedYears: number;
  zeroYears: number;
  unknownYears: number;
  entries: Array<{
    year: number;
    status: "reported" | "occurrence" | "zero" | "unknown";
    checklistCount: number | null;
    sourceUrl: string;
    downloadedAt: string;
  }>;
}
export interface AnnualHistory extends AnnualPeriodEvidence {
  datasetVersion: string;
  methodVersion: string;
  month?: AnnualPeriodEvidence & { label: string };
}
export function withAnnualHistory(baseline: HistoricalBaseline): HistoricalBaseline;
export function loadAnnualHistory(baseline: HistoricalBaseline): Promise<HistoricalBaseline>;
