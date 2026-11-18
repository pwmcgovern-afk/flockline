export type DailyScope = { id: string; label: string; regions: string[] };
export const DAILY_WINDOWS: number[];
export function dailyDate(now?: Date): string;
export function validDailyDate(value: string): boolean;
export function dailyScope(input: string[]): DailyScope | null;
export function scopeFromId(id: string): DailyScope | null;
export function dailyDigestPath(scopeId: string, date: string, back?: number): string | null;
export function parseDailyDigestPath(path: string): { valid: boolean; scopeId?: string | null; date?: string | null; back?: number };
