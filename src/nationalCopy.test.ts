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

    // Insights no longer simply follow the map: they carry their own scope and
    // that scope is what a shared link encodes.
    expect(methodology).toContain("Insights carry their own region and window");
    expect(methodology).toContain("reopens Flockline directly on");
    expect(methodology).toContain("instead of assuming your location");
    expect(methodology).toContain("Nationwide selects all 50 states plus Washington, D.C.");
    expect(methodology).not.toContain("reported across New England");
  });
});
