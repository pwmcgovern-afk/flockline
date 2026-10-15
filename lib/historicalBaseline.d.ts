import type { AnnualHistory } from "./annualHistory.js";
export type HistoricalBaselineUnavailableReason =
  | "county_missing" | "date_invalid" | "county_not_covered" | "baseline_not_prior"
  | "species_not_covered" | "sample_unavailable" | "frequency_unavailable" | "frequency_ambiguous" | "source_unavailable";

export interface AvailableHistoricalBaseline {
  status: "available";
  speciesCode: string;
  comName: string;
  area: { type: "county"; code: string; name: string };
  season: { month: number; startDay: number; endDay: number; label: string };
  years: { start: number; end: number };
  frequency: number;
  checklistCount: number;
  sourceUrl: string;
  sourceAttribution: string;
  termsUrl: string;
  downloadedAt: string;
  datasetVersion: string;
  methodVersion: string;
  taxonomyVersion: string;
  annualHistory?: AnnualHistory;
  annualRecurrence: null;
  confidence: null;
  coverage: { scope: "county"; yearsRepresented: null; pooledYears: true };
}

export interface UnavailableHistoricalBaseline {
  status: "unavailable";
  reason: HistoricalBaselineUnavailableReason;
  confidence: null;
  annualRecurrence: null;
  sourceUrl?: string;
}

export type HistoricalBaseline = AvailableHistoricalBaseline | UnavailableHistoricalBaseline;

export function getHistoricalBaseline(finding: {
  speciesCode?: string;
  countyCode?: string;
  subnational2Code?: string;
  obsDt?: string;
}): HistoricalBaseline;

export function loadHistoricalBaseline(finding: {
  speciesCode?: string;
  countyCode?: string;
  subnational2Code?: string;
  obsDt?: string;
}): Promise<HistoricalBaseline>;

export function baselineSeason(value: string): {
  year: number; month: number; startDay: number; endDay: number; index: number; label: string;
} | null;
