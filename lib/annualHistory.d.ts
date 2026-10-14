import type { HistoricalBaseline } from "./historicalBaseline.js";
export interface AnnualHistory {
  datasetVersion: string;
  methodVersion: string;
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
export function withAnnualHistory(baseline: HistoricalBaseline): HistoricalBaseline;
