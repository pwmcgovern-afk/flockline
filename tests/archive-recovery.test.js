import { describe, expect, it } from "vitest";
import { recentPastMondays } from "../api/cron/archive-recovery.js";

describe("archive recovery window", () => {
  it("lists past Mondays newest first", () => {
    expect(recentPastMondays(new Date("2026-11-12T01:00:00Z"), 3)).toEqual(["2026-11-09", "2026-11-02", "2026-10-26"]);
  });

  it("includes today only after the Eastern delivery hour", () => {
    // 12:30 p.m. EST: today's held edition can be published.
    expect(recentPastMondays(new Date("2026-11-16T17:30:00Z"), 2)).toEqual(["2026-11-16", "2026-11-09"]);
    // 10:30 a.m. EST: delivery is still running.
    expect(recentPastMondays(new Date("2026-11-16T15:30:00Z"), 2)).toEqual(["2026-11-09", "2026-11-02"]);
    // 10:30 a.m. EDT in summer.
    expect(recentPastMondays(new Date("2026-07-13T14:30:00Z"), 1)).toEqual(["2026-07-06"]);
    // 8 p.m. Sunday Eastern is already Monday in UTC; nothing ran yet.
    expect(recentPastMondays(new Date("2026-11-16T01:00:00Z"), 1)).toEqual(["2026-11-09"]);
  });
});
