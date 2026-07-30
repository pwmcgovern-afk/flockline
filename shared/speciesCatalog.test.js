import { describe, expect, it } from "vitest";
import speciesCatalog from "./speciesCatalog.json";

describe("nationwide species catalog", () => {
  it("covers distinctive birds from across the United States", () => {
    const byCode = new Map(speciesCatalog.map((species) => [species.speciesCode, species]));

    expect(speciesCatalog.length).toBeGreaterThan(1000);
    expect(byCode.get("calcon")?.comName).toBe("California Condor");
    expect(byCode.get("flsjay")?.comName).toBe("Florida Scrub-Jay");
    expect(byCode.get("placha")?.comName).toBe("Plain Chachalaca");
    expect(byCode.get("akiapo")?.comName).toBe("Akiapolaau");
  });

  it("contains only unique species records", () => {
    expect(new Set(speciesCatalog.map((species) => species.speciesCode)).size).toBe(speciesCatalog.length);
    expect(speciesCatalog.every((species) => (
      species.speciesCode
      && species.comName
      && species.sciName
      && species.group
    ))).toBe(true);
  });
});
