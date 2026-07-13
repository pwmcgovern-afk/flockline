import { describe, expect, it } from "vitest";
import { takeRateLimit } from "./rateLimit.js";

describe("takeRateLimit", () => {
  it("allows requests through the limit and then blocks", () => {
    const key = `test-limit-${Date.now()}`;
    expect(takeRateLimit(key, 2, 1000, 100).allowed).toBe(true);
    expect(takeRateLimit(key, 2, 1000, 200).allowed).toBe(true);
    expect(takeRateLimit(key, 2, 1000, 300)).toMatchObject({ allowed: false, remaining: 0 });
  });

  it("opens a fresh window after reset", () => {
    const key = `test-reset-${Date.now()}`;
    takeRateLimit(key, 1, 1000, 100);
    expect(takeRateLimit(key, 1, 1000, 1200)).toMatchObject({ allowed: true, remaining: 0 });
  });
});
