import { describe, expect, it } from "vitest";
import { settleWithConcurrency } from "./asyncPool.js";

describe("settleWithConcurrency", () => {
  it("preserves input order while bounding active work", async () => {
    let active = 0;
    let peak = 0;
    const results = await settleWithConcurrency([40, 5, 20, 1, 10], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active -= 1;
      return value * 2;
    });

    expect(peak).toBe(2);
    expect(results.map((result) => result.status === "fulfilled" ? result.value : null)).toEqual([80, 10, 40, 2, 20]);
  });

  it("captures individual failures without cancelling the remaining work", async () => {
    const results = await settleWithConcurrency(["CT", "MA", "NY"], 2, async (value) => {
      if (value === "MA") throw new Error("temporary failure");
      return value;
    });

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(results[2]).toMatchObject({ status: "fulfilled", value: "NY" });
  });
});
