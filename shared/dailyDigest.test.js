import { describe, expect, it } from "vitest";
import { dailyDate, dailyDigestPath, dailyScope, parseDailyDigestPath, scopeFromId } from "./dailyDigest.js";
import { dailyGenerationHour, isFinalDailyAttempt } from "../api/cron/daily-digests.js";

describe("daily digest addresses and Eastern dates", () => {
  it("uses the Eastern calendar across midnight and both DST offsets", () => {
    expect(dailyDate(new Date("2026-11-18T03:30:00Z"))).toBe("2026-11-17");
    expect(dailyGenerationHour(new Date("2026-11-17T14:15:00Z"))).toBe(true);
    expect(dailyGenerationHour(new Date("2026-07-17T13:15:00Z"))).toBe(true);
    expect(dailyGenerationHour(new Date("2026-07-17T14:15:00Z"))).toBe(false);
    expect(isFinalDailyAttempt(new Date("2026-11-17T14:16:00Z"))).toBe(false);
    expect(isFinalDailyAttempt(new Date("2026-11-17T14:31:00Z"))).toBe(true);
    expect(isFinalDailyAttempt(new Date("2026-11-17T13:31:00Z"))).toBe(false);
  });
  it("canonicalizes custom states and rejects aliases or malformed scopes", () => {
    expect(dailyScope(["US-NY", "US-CT", "US-NY"]).id).toBe("states-ct-ny");
    expect(scopeFromId("states-ny-ct")).toBe(null);
    expect(scopeFromId("states-xx")).toBe(null);
    expect(dailyScope(["US-XX"])).toBe(null);
    expect(dailyScope([])).toBe(null);
  });
  it("preserves region, date, and window and rejects unsupported windows/dates", () => {
    expect(dailyDigestPath("west", "2026-11-17")).toBe("/digest/west/2026-11-17");
    expect(parseDailyDigestPath("/digest/states-ct-ny/2026-11-17/7d")).toMatchObject({ valid: true, scopeId: "states-ct-ny", date: "2026-11-17", back: 7 });
    for (const path of ["/digest/west/2026-02-30", "/digest/west/2026-11-17/2d", "/digest/west/2026-11-17/1d", "/digest/nope"])
      expect(parseDailyDigestPath(path).valid).toBe(false);
    expect(dailyDigestPath("west", "2026-11-17", 2)).toBe(null);
  });
});
