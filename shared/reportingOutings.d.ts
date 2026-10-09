type OutingReport = {
  subId?: string | null;
  locId?: string | null;
  locName?: string | null;
  observedAt?: string | null;
  obsDt?: string | null;
};
export function outingKey(report: OutingReport): string;
export function countOutings(reports: OutingReport[] | null | undefined): number;
