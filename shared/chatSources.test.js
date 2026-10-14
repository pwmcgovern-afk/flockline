import { describe, expect, it } from "vitest";
import { chatReviewStatus, chatSourcesFromTool, selectChatSources } from "./chatSources.js";

describe("Ask checklist evidence", () => {
  it.each([
    [{ obsValid: true, obsReviewed: false }, "Accepted by eBird"],
    [{ obsValid: true, obsReviewed: true }, "Accepted by eBird"],
    [{ obsValid: false, obsReviewed: false }, "Not reviewed by eBird"],
    [{ obsValid: false, obsReviewed: true }, "Not accepted by eBird"],
    [{}, "Review status unavailable"],
    [{ obsValid: "true", obsReviewed: "false" }, "Review status unavailable"],
  ])("uses literal review flags without promising future review: %j", (record, expected) => {
    expect(chatReviewStatus(record)).toBe(expected);
  });

  it("collects only observation evidence, retaining species-level status on shared checklists", () => {
    const rows = [
      { subId: "S123456789", speciesCode: "osprey", comName: "Osprey", locName: "Park", obsDt: "2026-10-14 09:00", reviewStatus: "Accepted by eBird" },
      { subId: "S123456789", speciesCode: "baleag", comName: "Bald Eagle", reviewStatus: "Not reviewed by eBird" },
    ];
    expect(chatSourcesFromTool({ sightings: rows, matches: [{ subId: "S999999999" }], note: "See S999999999" })).toEqual([
      rows[0],
      { ...rows[1], locName: "Location not supplied", obsDt: null },
    ]);
    expect(chatSourcesFromTool({ recent: [{ subId: "https://evil.test/S123456789" }, null] })).toEqual([]);
  });

  it("fills species from a species-scoped response and does not propagate invented review text", () => {
    expect(chatSourcesFromTool({ speciesCode: "osprey", comName: "Osprey", topLocations: [{ subId: "S123456789", reviewStatus: "An expert will verify this tomorrow" }] })).toEqual([
      { subId: "S123456789", speciesCode: "osprey", comName: "Osprey", locName: "Location not supplied", obsDt: null, reviewStatus: "Review status unavailable" },
    ]);
  });

  it("bounds deduplicated sources and prioritizes cited evidence without trusting invented IDs", () => {
    const sources = Array.from({ length: 20 }, (_, index) => ({ subId: `S${123456780 + index}`, speciesCode: "osprey" }));
    const selected = selectChatSources("S123456799 and fabricated S999999999", [...sources, sources[0]]);
    expect(selected).toHaveLength(12);
    expect(selected[0]).toEqual(sources[19]);
    expect(selected.some((source) => source.subId === "S999999999")).toBe(false);
    expect(new Set(selected.map((source) => source.subId)).size).toBe(12);
  });
});
