import { statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const featuredArt = ["osprey", "baleag", "comloo", "rthhum", "scatan", "balori"];

describe("featured bird artwork", () => {
  it.each(featuredArt)("ships a production image for %s", (speciesCode) => {
    const file = statSync(resolve(process.cwd(), "public", "birds", `${speciesCode}.jpg`));
    expect(file.isFile()).toBe(true);
    expect(file.size).toBeGreaterThan(100_000);
  });
});
