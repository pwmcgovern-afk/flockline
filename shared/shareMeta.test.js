import { describe, expect, it } from "vitest";
import { buildMeta } from "./shareMeta.js";

const meta = (query) => buildMeta(new URL(`https://flockline.app/${query}`));

describe("buildMeta", () => {
  it("names the bird and the scope a link is actually carrying", () => {
    expect(meta("?bird=osprey&region=northeast&days=7").title).toBe("Osprey · Northeast · Flockline");
    expect(meta("?bird=osprey&region=northeast&days=7").description).toBe(
      "Where Osprey has been reported in the Northeast over the past 7 days, from live eBird checklists."
    );
  });

  it("lists a few states by name and counts the rest", () => {
    expect(meta("?bird=norcar&states=US-CT,US-MA").title).toBe(
      "Northern Cardinal · Connecticut, Massachusetts · Flockline"
    );
    expect(meta("?states=US-CT,US-MA,US-NY,US-NJ").title).toBe("Bird sightings across 4 states · Flockline");
  });

  // Nationwide is the default scope, so repeating it in a title is noise, and
  // "in Nationwide" is not something a person would write.
  it("does not name the default scope in a species title", () => {
    expect(meta("?bird=osprey&region=nationwide").title).toBe("Osprey · Flockline");
    expect(meta("?region=nationwide").description).toContain("across the United States");
  });

  it("falls back cleanly for junk and for the bare homepage", () => {
    expect(meta("").title).toBe("Flockline · Live U.S. Bird Sightings");
    expect(meta("?bird=notarealbird").title).toBe("Flockline · Live U.S. Bird Sightings");
    expect(meta("?states=ZZ,QQ").title).toBe("Flockline · Live U.S. Bird Sightings");
  });

  it("escapes nothing dangerous into the head", () => {
    const out = meta('?states=US-CT&bird="><script>alert(1)</script>');
    expect(out.title).not.toContain("<script");
  });
});
