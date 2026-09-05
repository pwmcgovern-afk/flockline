import { describe, expect, it } from "vitest";
import { isWeeklyDigestDeliveryTime } from "../api/cron/weekly-digests.js";

describe("weekly digest delivery time", () => {
  it("sends at 10 a.m. Eastern during daylight-saving time", () => {
    expect(isWeeklyDigestDeliveryTime(new Date("2026-08-17T14:00:00.000Z"))).toBe(true);
    expect(isWeeklyDigestDeliveryTime(new Date("2026-08-17T15:00:00.000Z"))).toBe(false);
  });

  it("sends at 10 a.m. Eastern during standard time", () => {
    expect(isWeeklyDigestDeliveryTime(new Date("2026-01-05T15:00:00.000Z"))).toBe(true);
    expect(isWeeklyDigestDeliveryTime(new Date("2026-01-05T14:00:00.000Z"))).toBe(false);
  });

  it("does not send on another weekday", () => {
    expect(isWeeklyDigestDeliveryTime(new Date("2026-08-18T14:00:00.000Z"))).toBe(false);
  });

  it("accepts delayed invocations during the delivery hour without accepting the other UTC schedule", () => {
    expect(isWeeklyDigestDeliveryTime(new Date("2026-08-31T14:01:00.000Z"))).toBe(true);
    expect(isWeeklyDigestDeliveryTime(new Date("2026-08-31T14:59:59.000Z"))).toBe(true);
    expect(isWeeklyDigestDeliveryTime(new Date("2026-08-31T15:00:00.000Z"))).toBe(false);
    expect(isWeeklyDigestDeliveryTime(new Date("2026-01-05T15:04:00.000Z"))).toBe(true);
  });
});
