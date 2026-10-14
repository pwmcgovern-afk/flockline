import { describe, expect, it } from "vitest";
import { factualEditorialPayload, factualFinding, reviewStatusLabel } from "./findingCopy.js";

const source = {
  speciesCode: "redcro", comName: "Red Crossbill", sciName: "Loxia curvirostra",
  subId: "S123456789", locName: "Coastal park", region: "Oregon", regionCode: "US-OR",
  obsDt: "2026-10-11 08:30", howMany: 3, lat: 45, lng: -123,
  obsValid: true, obsReviewed: false,
  title: "An irruption driven by food shortages",
  detail: "Crop failure pushed thousands of crossbills south.",
  kind: "surge", generatedBy: "llm",
  image: { url: "https://example.com/bird.jpg", kind: "species-illustration" },
  reporting: { reports: [{ subId: "S123456789" }], asOf: "2026-10-12" },
};

describe("evidence-only finding descriptions", () => {
  it("replaces inferred causes with recorded facts and preserves the source snapshot", () => {
    const result = factualFinding(source);
    expect(result).toEqual({
      ...source, kind: "notable", title: "Red Crossbill", generatedBy: "template",
      detail: "Red Crossbill was reported at Coastal park, Oregon on Oct 11, 2026. The featured checklist recorded 3 birds.",
    });
    expect(source.detail).toContain("Crop failure");
    expect(factualFinding(result)).toEqual(result);
  });

  it("does not infer missing identities, dates or counts from old prose", () => {
    const result = factualFinding({
      title: "Three Red Crossbills", detail: "Three birds on October 11.",
      subId: "S123456789", obsDt: "2026-02-30", howMany: null,
    });
    expect(result.title).toBe("eBird report");
    expect(result.detail).toBe("See the linked eBird checklist for the recorded observation.");
    expect(result.subId).toBe("S123456789");
  });

  it("keeps presence and range counts distinct from an exact count", () => {
    expect(factualFinding(source, { count: "X" }).detail).toContain("presence without a count");
    expect(factualFinding(source, { count: "2-4" }).detail).toContain("recorded 2-4 birds");
    expect(factualFinding(source, { count: null }).detail).not.toContain("recorded 3");
  });

  it("corrects historical prose on read without altering the publication date or evidence", () => {
    const payload = { generatedAt: "2026-10-12T14:00:00Z", generator: "llm", summary: "A food shortage caused an irruption.", findings: [source] };
    const result = factualEditorialPayload(payload, { correctLegacy: true });
    expect(JSON.stringify(result)).not.toMatch(/food shortage|Crop failure|thousands|irruption/);
    expect(result.editorialNote).toContain("Original sightings and dates are unchanged");
    expect(result.generatedAt).toBe(payload.generatedAt);
    expect(result.findings[0].reporting).toEqual(source.reporting);
    expect(factualEditorialPayload(result, { correctLegacy: true })).toEqual(result);
    expect(factualEditorialPayload(payload).editorialNote).toBeUndefined();
  });

  it("reports eBird status without implying manual verification", () => {
    expect(reviewStatusLabel({ obsValid: true, obsReviewed: false })).toBe("Accepted by eBird");
    expect(reviewStatusLabel({ obsValid: true, obsReviewed: true })).toBe("Accepted by eBird");
    expect(reviewStatusLabel({ obsValid: false, obsReviewed: false })).toBe("Not yet reviewed");
    expect(reviewStatusLabel({ obsValid: false, obsReviewed: true })).toBe("Not accepted by eBird");
    expect(reviewStatusLabel({})).toBe("Review status unavailable");
    expect(reviewStatusLabel({ obsReviewed: true })).toBe("Review status unavailable");
  });
});
