import { US_REGION_PRESETS, US_STATES } from "./usGeography.js";

export const DAILY_WINDOWS = [1, 3, 7, 14, 30];
const states = new Set(US_STATES.map((state) => state.code));
export function dailyDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function validDailyDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const date = new Date(value + "T12:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function dailyScope(input) {
  const codes = Array.isArray(input) ? [...new Set(input)].sort() : [];
  if (!codes.length || codes.some((code) => !states.has(code))) return null;
  const preset = US_REGION_PRESETS.find((preset) =>
    preset.stateCodes.length === codes.length && preset.stateCodes.every((code) => codes.includes(code)));
  return {
    id: preset?.id || "states-" + codes.map((code) => code.slice(3).toLowerCase()).join("-"),
    label: preset?.name || codes.map((code) => US_STATES.find((state) => state.code === code).name).join(", "),
    regions: codes,
  };
}
export function scopeFromId(id) {
  const preset = US_REGION_PRESETS.find((preset) => preset.id === id);
  if (preset) return dailyScope(preset.stateCodes);
  if (!/^states-(?:[a-z]{2})(?:-[a-z]{2})*$/.test(String(id))) return null;
  const scope = dailyScope(id.slice(7).split("-").map((code) => "US-" + code.toUpperCase()));
  return scope?.id === id ? scope : null;
}
export function dailyDigestPath(scopeId, date, back = 1) {
  if (!scopeFromId(scopeId) || !validDailyDate(date) || !DAILY_WINDOWS.includes(back)) return null;
  return "/digest/" + scopeId + "/" + date + (back === 1 ? "" : "/" + back + "d");
}
export function parseDailyDigestPath(path) {
  const clean = String(path).replace(/\/+$/, "");
  if (clean === "/digest") return { valid: true, scopeId: null, date: null, back: 1 };
  const match = clean.match(/^\/digest\/([a-z-]+)(?:\/(\d{4}-\d{2}-\d{2})(?:\/(3|7|14|30)d)?)?$/);
  if (!match || !scopeFromId(match[1]) || (match[2] && !validDailyDate(match[2]))) return { valid: false };
  return { valid: true, scopeId: match[1], date: match[2] || null, back: Number(match[3] || 1) };
}
