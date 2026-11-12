import { describe, expect, it } from "vitest";
import { recentPastMondays } from "../api/cron/archive-recovery.js";

describe("archive recovery window", () => {
  it("lists past Mondays newest first, excluding today", () => {
    expect(recentPastMondays(new Date("2026-11-12T01:00:00Z"), 3)).toEqual(["2026-11-09", "2026-11-02", "2026-10-26"]);
    expect(recentPastMondays(new Date("2026-11-16T17:30:00Z"), 2)).toEqual(["2026-11-09", "2026-11-02"]);
  });
});
