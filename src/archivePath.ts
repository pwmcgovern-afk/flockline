import { US_REGION_PRESETS } from "../shared/usGeography.js";

export function parseArchivePath(pathname: string) {
  const path = pathname.replace(/\/+$/, "");
  if (path === "/roundup") return { valid: true, scopeId: null, date: null };
  const match = path.match(/^\/roundup\/([a-z]+)(?:\/(\d{4}-\d{2}-\d{2}))?$/);
  if (!match || !US_REGION_PRESETS.some((region) => region.id === match[1])) {
    return { valid: false, scopeId: null, date: null };
  }
  const date = match[2] ?? null;
  if (date) {
    const parsed = new Date(`${date}T12:00:00Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    ) {
      return { valid: false, scopeId: null, date: null };
    }
  }
  return { valid: true, scopeId: match[1], date };
}
