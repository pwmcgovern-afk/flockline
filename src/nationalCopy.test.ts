import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("nationwide product copy", () => {
  it("keeps public metadata aligned with U.S. coverage", () => {
    const publicCopy = [
      read("README.md"),
      read("index.html"),
      read("public/manifest.webmanifest")
    ].join("\n");

    expect(publicCopy).toMatch(/United States|U\.S\./);
    expect(publicCopy).not.toMatch(/Live Northeast Bird Sightings|across the Northeast with live/);
  });

  it("documents region-aware Insights and location-safe Ask behavior", () => {
    const methodology = read("src/Methodology.tsx");

    expect(methodology).toContain("selected states and timeline window");
    expect(methodology).toContain("instead of assuming your location");
    expect(methodology).not.toContain("reported across New England");
  });
});
